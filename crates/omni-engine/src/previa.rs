//! Prévia de um servidor local do PC (`localhost:3000`, Vite, Next…) no celular e na web.
//!
//! Cada prévia é um repasse TCP numa porta própria, não um caminho dentro do engine: o Next e o
//! Vite pedem `/_next/…` e `/@vite/client` pela raiz e abrem websocket, e um prefixo de caminho
//! quebraria os dois. O repasse reescreve `Host` e `Origin` para `localhost:<porta>` — sem isso o
//! Vite recusa o host ("Blocked request") e o Next bloqueia o recarregamento de outra origem.
//!
//! Acesso: o link sai com `?__omni=<segredo>`, que vira cookie na primeira visita. Sem o cookie a
//! prévia responde 403 — estar no tailnet não basta, como no resto da API.
use anyhow::{anyhow, Result};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::net::{IpAddr, Ipv4Addr, Ipv6Addr, SocketAddr};
use std::sync::{Arc, LazyLock, Mutex};
use std::time::Duration;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};

/// Portas que os servidores de desenvolvimento mais usam. Testar a máquina inteira (netstat) traria
/// dezenas de portas do sistema; a pessoa digita qualquer outra na tela.
const PORTAS_COMUNS: &[u16] = &[3000, 3001, 3002, 3003, 4000, 4173, 4200, 4321, 5000, 5173, 5174, 5175, 8000, 8080, 8081, 8787, 8888, 9000];
const CABECALHO_MAX: usize = 64 * 1024;

struct Previa { porta: u16, url: String, serve: bool, servidor: tokio::task::JoinHandle<()> }

static PREVIAS: LazyLock<Mutex<HashMap<u16, Previa>>> = LazyLock::new(|| Mutex::new(HashMap::new()));

/// O servidor local responde em `localhost`? O Vite no Node 18+ às vezes escuta só em `::1`.
async fn conectar(alvo: u16) -> std::io::Result<TcpStream> {
    match TcpStream::connect((Ipv4Addr::LOCALHOST, alvo)).await {
        Ok(fluxo) => Ok(fluxo),
        Err(_) => TcpStream::connect((Ipv6Addr::LOCALHOST, alvo)).await,
    }
}

/// Portas comuns com alguém escutando agora, mais as que já têm prévia.
pub async fn listar() -> Value {
    let testes = PORTAS_COMUNS.iter().map(|&porta| async move {
        tokio::time::timeout(Duration::from_millis(300), conectar(porta)).await.is_ok_and(|r| r.is_ok()).then_some(porta)
    });
    let abertas: Vec<u16> = futures_join(testes).await.into_iter().flatten().collect();
    let ativas: Vec<Value> = PREVIAS.lock().expect("previas poisoned").iter()
        .map(|(alvo, previa)| json!({"alvo": alvo, "url": previa.url})).collect();
    json!({"abertas": abertas, "ativas": ativas})
}

/// `join_all` sem puxar a crate `futures` para um uso só.
async fn futures_join<F: std::future::Future<Output = Option<u16>> + Send + 'static>(testes: impl Iterator<Item = F>) -> Vec<Option<u16>> {
    let tarefas: Vec<_> = testes.map(tokio::spawn).collect();
    let mut saida = Vec::with_capacity(tarefas.len());
    for tarefa in tarefas { saida.push(tarefa.await.unwrap_or(None)); }
    saida
}

/// Abre (ou devolve a já aberta) a prévia de `alvo`. `bind` é o IP em que o acesso do celular
/// escuta; com o Serve ligado é loopback e o Tailscale publica a porta em HTTPS no nome `magic`.
pub async fn abrir(alvo: u16, bind: IpAddr, serve: bool, magic: Option<String>) -> Result<Value> {
    if let Some(previa) = PREVIAS.lock().expect("previas poisoned").get(&alvo) {
        return Ok(json!({"alvo": alvo, "url": previa.url}));
    }
    if tokio::time::timeout(Duration::from_secs(1), conectar(alvo)).await.map_or(true, |r| r.is_err()) {
        return Err(anyhow!("Nada respondendo em localhost:{alvo} no PC. Rode o servidor (npm run dev) e tente de novo."));
    }
    // Mesma porta + 10000 (3000 → 13000) é fácil de reconhecer; ocupada, o sistema escolhe outra.
    let preferida = alvo.checked_add(10_000);
    let listener = match preferida { Some(p) => TcpListener::bind((bind, p)).await.ok(), None => None };
    let listener = match listener { Some(l) => l, None => TcpListener::bind((bind, 0)).await? };
    let porta = listener.local_addr()?.port();

    let segredo = format!("{:032x}", rand::random::<u128>());
    let url = if serve {
        let nome = magic.ok_or_else(|| anyhow!("O nome do Tailscale ainda não foi lido; tente de novo em alguns segundos."))?;
        let alvo_local = format!("http://127.0.0.1:{porta}");
        let publicado = tokio::task::spawn_blocking(move || crate::mobile::tailscale(&["serve", "--bg", &format!("--https={porta}"), &alvo_local], 15)).await?;
        match publicado {
            Some((true, _)) => format!("https://{nome}:{porta}/?__omni={segredo}"),
            Some((false, saida)) => return Err(anyhow!("O Tailscale não publicou a porta {porta}: {}", saida.trim())),
            None => return Err(anyhow!("Tailscale não encontrado neste PC.")),
        }
    } else {
        format!("http://{}/?__omni={segredo}", SocketAddr::new(bind, porta))
    };

    let segredo: Arc<str> = segredo.into();
    let servidor = tokio::spawn(async move {
        while let Ok((cliente, _)) = listener.accept().await {
            let segredo = segredo.clone();
            tokio::spawn(async move { let _ = atender(cliente, alvo, porta, &segredo).await; });
        }
    });
    PREVIAS.lock().expect("previas poisoned").insert(alvo, Previa { porta, url: url.clone(), serve, servidor });
    Ok(json!({"alvo": alvo, "url": url}))
}

pub async fn fechar(alvo: u16) {
    let Some(previa) = PREVIAS.lock().expect("previas poisoned").remove(&alvo) else { return };
    previa.servidor.abort();
    if previa.serve {
        let porta = previa.porta;
        let _ = tokio::task::spawn_blocking(move || crate::mobile::tailscale(&["serve", &format!("--https={porta}"), "off"], 15)).await;
    }
}

#[derive(Debug, PartialEq)]
enum Pedido {
    /// Cabeçalho reescrito para mandar ao servidor local.
    Seguir(String),
    /// Primeira visita com o segredo na URL: grava o cookie e volta ao mesmo endereço sem ele.
    Liberar { local: String },
    Negado,
}

fn nome_do_cookie(porta: u16) -> String { format!("omni_previa_{porta}") }

/// Decide o que fazer com um pedido HTTP. Puro, para testar sem rede.
fn reescrever(cabeca: &str, alvo: u16, porta: u16, segredo: &str) -> Pedido {
    let mut linhas = cabeca.split("\r\n");
    let Some(primeira) = linhas.next() else { return Pedido::Negado };
    let mut partes = primeira.splitn(3, ' ');
    let (Some(metodo), Some(caminho), Some(versao)) = (partes.next(), partes.next(), partes.next()) else { return Pedido::Negado };

    let marca = format!("__omni={segredo}");
    if let Some((base, consulta)) = caminho.split_once('?') {
        if consulta.split('&').any(|par| par == marca) {
            let resto: Vec<&str> = consulta.split('&').filter(|par| !par.starts_with("__omni=")).collect();
            let local = if resto.is_empty() { base.to_owned() } else { format!("{base}?{}", resto.join("&")) };
            return Pedido::Liberar { local };
        }
    }

    let cookie = format!("{}={segredo}", nome_do_cookie(porta));
    let mut liberado = false;
    let mut upgrade = false;
    let mut cabecalhos = Vec::new();
    for linha in linhas.filter(|l| !l.is_empty()) {
        let Some((nome, valor)) = linha.split_once(':') else { continue };
        let (nome_min, valor) = (nome.trim().to_ascii_lowercase(), valor.trim());
        match nome_min.as_str() {
            "cookie" => { liberado |= valor.split(';').any(|c| crate::mobile::token_confere(c.trim(), &cookie)); cabecalhos.push(linha.to_owned()); }
            "upgrade" => { upgrade = true; cabecalhos.push(linha.to_owned()); }
            "origin" => cabecalhos.push(format!("Origin: http://localhost:{alvo}")),
            "host" | "connection" | "keep-alive" | "proxy-connection" => {}
            _ => cabecalhos.push(linha.to_owned()),
        }
    }
    if !liberado { return Pedido::Negado }
    // ponytail: uma conexão por pedido (`Connection: close`) para não ter de achar o fim de cada
    // pedido num keep-alive; se a prévia ficar lenta pela rede, ler Content-Length e reaproveitar.
    let conexao = if upgrade { "Upgrade" } else { "close" };
    let mut saida = vec![format!("{metodo} {caminho} {versao}"), format!("Host: localhost:{alvo}"), format!("Connection: {conexao}")];
    saida.extend(cabecalhos);
    Pedido::Seguir(format!("{}\r\n\r\n", saida.join("\r\n")))
}

async fn atender(mut cliente: TcpStream, alvo: u16, porta: u16, segredo: &str) -> std::io::Result<()> {
    let mut lido = Vec::with_capacity(4096);
    let fim = loop {
        let mut pedaco = [0u8; 4096];
        let n = cliente.read(&mut pedaco).await?;
        if n == 0 { return Ok(()) }
        lido.extend_from_slice(&pedaco[..n]);
        if let Some(i) = lido.windows(4).position(|w| w == b"\r\n\r\n") { break i + 4 }
        if lido.len() > CABECALHO_MAX { return Ok(()) }
    };
    match reescrever(&String::from_utf8_lossy(&lido[..fim]), alvo, porta, segredo) {
        Pedido::Negado => {
            let corpo = "Abra esta prévia pelo OMNI AGENTS (o link de lá já traz o acesso).";
            cliente.write_all(format!("HTTP/1.1 403 Forbidden\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{corpo}", corpo.len()).as_bytes()).await
        }
        Pedido::Liberar { local } => {
            cliente.write_all(format!("HTTP/1.1 302 Found\r\nLocation: {local}\r\nSet-Cookie: {}={segredo}; Path=/; HttpOnly; SameSite=Lax; Max-Age=604800\r\nContent-Length: 0\r\nConnection: close\r\n\r\n", nome_do_cookie(porta)).as_bytes()).await
        }
        Pedido::Seguir(cabeca) => {
            let mut servidor = conectar(alvo).await?;
            servidor.write_all(cabeca.as_bytes()).await?;
            servidor.write_all(&lido[fim..]).await?;
            tokio::io::copy_bidirectional(&mut cliente, &mut servidor).await.map(|_| ())
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test] fn segredo_na_url_vira_cookie_e_sai_do_endereco() {
        let pedido = "GET /pagina?x=1&__omni=abc HTTP/1.1\r\nHost: 100.1.2.3:13000\r\n\r\n";
        assert_eq!(reescrever(pedido, 3000, 13000, "abc"), Pedido::Liberar { local: "/pagina?x=1".into() });
        assert_eq!(reescrever("GET /?__omni=abc HTTP/1.1\r\n\r\n", 3000, 13000, "abc"), Pedido::Liberar { local: "/".into() });
    }

    #[test] fn sem_cookie_ou_com_segredo_errado_nega() {
        assert_eq!(reescrever("GET / HTTP/1.1\r\nHost: x\r\n\r\n", 3000, 13000, "abc"), Pedido::Negado);
        assert_eq!(reescrever("GET /?__omni=zzz HTTP/1.1\r\nCookie: omni_previa_13000=zzz\r\n\r\n", 3000, 13000, "abc"), Pedido::Negado);
    }

    #[test] fn com_cookie_reescreve_host_e_origin_e_fecha_a_conexao() {
        let pedido = "GET /@vite/client HTTP/1.1\r\nHost: pc.ts.net:13000\r\nOrigin: https://pc.ts.net:13000\r\nConnection: keep-alive\r\nCookie: a=1; omni_previa_13000=abc\r\n\r\n";
        let Pedido::Seguir(cabeca) = reescrever(pedido, 3000, 13000, "abc") else { panic!("devia seguir") };
        assert!(cabeca.starts_with("GET /@vite/client HTTP/1.1\r\nHost: localhost:3000\r\nConnection: close\r\n"));
        assert!(cabeca.contains("Origin: http://localhost:3000\r\n"));
        assert!(!cabeca.contains("pc.ts.net"));
        assert!(cabeca.ends_with("\r\n\r\n"));
    }

    /// De ponta a ponta: um "servidor de dev" de mentira devolve o `Host` que recebeu.
    #[tokio::test] async fn repassa_ao_servidor_local_com_host_de_localhost() {
        let dev = TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).await.unwrap();
        let alvo = dev.local_addr().unwrap().port();
        tokio::spawn(async move {
            while let Ok((mut fluxo, _)) = dev.accept().await {
                let mut buf = vec![0u8; 4096];
                let n = fluxo.read(&mut buf).await.unwrap();
                let host = String::from_utf8_lossy(&buf[..n]).lines().find(|l| l.starts_with("Host:")).unwrap_or("").to_owned();
                let _ = fluxo.write_all(format!("HTTP/1.1 200 OK\r\nContent-Length: {}\r\n\r\n{host}", host.len()).as_bytes()).await;
            }
        });
        let aberta = abrir(alvo, IpAddr::V4(Ipv4Addr::LOCALHOST), false, None).await.unwrap();
        let url = aberta["url"].as_str().unwrap().to_owned();
        let (endereco, consulta) = url.trim_start_matches("http://").split_once('/').unwrap();
        let pedir = |cabeca: String| { let endereco = endereco.to_owned(); async move {
            let mut fluxo = TcpStream::connect(endereco).await.unwrap();
            fluxo.write_all(cabeca.as_bytes()).await.unwrap();
            let mut resposta = String::new();
            fluxo.read_to_string(&mut resposta).await.unwrap();
            resposta
        }};
        let primeira = pedir(format!("GET /{consulta} HTTP/1.1\r\nHost: {endereco}\r\n\r\n")).await;
        assert!(primeira.starts_with("HTTP/1.1 302"), "{primeira}");
        let cookie = primeira.lines().find_map(|l| l.strip_prefix("Set-Cookie: ")).unwrap().split(';').next().unwrap().to_owned();
        assert!(pedir(format!("GET / HTTP/1.1\r\nHost: {endereco}\r\n\r\n")).await.starts_with("HTTP/1.1 403"));
        let pagina = pedir(format!("GET / HTTP/1.1\r\nHost: {endereco}\r\nCookie: {cookie}\r\n\r\n")).await;
        assert!(pagina.ends_with(&format!("Host: localhost:{alvo}")), "{pagina}");
        fechar(alvo).await;
    }

    #[test] fn websocket_mantem_o_upgrade() {
        let pedido = "GET /_next/webpack-hmr HTTP/1.1\r\nConnection: Upgrade\r\nUpgrade: websocket\r\nCookie: omni_previa_13000=abc\r\n\r\n";
        let Pedido::Seguir(cabeca) = reescrever(pedido, 3000, 13000, "abc") else { panic!("devia seguir") };
        assert!(cabeca.contains("Connection: Upgrade\r\n") && cabeca.contains("Upgrade: websocket"));
    }
}
