//! Ícone de MCP remoto e de conector do claude.ai para a aba Extensões, do jeito que o Claude faz:
//!
//! 1. o que o próprio servidor anuncia: `initialize` do MCP → `serverInfo.icons` (spec nova do MCP);
//! 2. senão, o ícone do site: `<link rel="icon">` da página inicial do domínio, depois `/favicon.ico`
//!    (primeiro no host do MCP, depois no domínio dele: `mcp.notion.com` → `notion.com`).
//!
//! Volta como `data:` URI: a tela mostra sem liberar site nenhum no CSP do app. O achado fica salvo como
//! imagem na pasta `icones/` do engine (`stitch-1a2b3c4d.png`) e não vai mais à rede; "não achei" vira um
//! `.sem-icone` vazio, refeito depois de 1 dia. Apagar a pasta força buscar tudo de novo.
//! Só a URL já limpa (sem query nem credencial, ver `omni_core::extensoes`) chega aqui.

use base64::Engine as _;
use serde_json::Value;
use std::path::Path;
use std::time::Duration;

const LIMITE_BYTES: usize = 300 * 1024;
const REFAZER_FALHA: Duration = Duration::from_secs(24 * 60 * 60);
const TIPOS: &[(&str, &str)] = &[
    ("png", "image/png"), ("svg", "image/svg+xml"), ("ico", "image/x-icon"), ("jpg", "image/jpeg"),
    ("gif", "image/gif"), ("webp", "image/webp"),
];

/// Nome do arquivo sem extensão: o nome da extensão legível + hash (FNV-1a) da chave inteira.
fn nome_do_arquivo(chave: &str, nome: &str) -> String {
    let legivel: String = nome.to_ascii_lowercase().chars().map(|c| if c.is_ascii_alphanumeric() { c } else { '-' }).collect();
    let legivel = legivel.trim_matches('-');
    let hash = chave.bytes().fold(0x811c9dc5u32, |h, b| (h ^ b as u32).wrapping_mul(0x01000193));
    format!("{}-{hash:08x}", if legivel.is_empty() { "extensao" } else { legivel })
}

/// `Some(Some(icone))` salvo, `Some(None)` "não achei" recente, `None` ainda não buscado (ou falha velha).
fn ler_salvo(pasta: &Path, base: &str) -> Option<Option<String>> {
    for (ext, tipo) in TIPOS {
        if let Ok(bytes) = std::fs::read(pasta.join(format!("{base}.{ext}"))) {
            return Some(Some(format!("data:{tipo};base64,{}", base64::engine::general_purpose::STANDARD.encode(bytes))));
        }
    }
    let idade = std::fs::metadata(pasta.join(format!("{base}.sem-icone"))).ok()?.modified().ok()?.elapsed().ok()?;
    (idade < REFAZER_FALHA).then_some(None)
}

/// Grava e devolve o nome do arquivo da imagem (`None` quando não achou ou não deu para gravar).
fn salvar(pasta: &Path, base: &str, icone: &Option<String>) -> Option<String> {
    let _ = std::fs::create_dir_all(pasta);
    let sem = pasta.join(format!("{base}.sem-icone"));
    let Some(icone) = icone else { let _ = std::fs::write(sem, b""); return None };
    // `data:<tipo>;base64,<dados>`; SVG em texto puro (sem base64) não é salvo, só não vira "sem ícone".
    let (tipo, dados) = icone.strip_prefix("data:")?.split_once(";base64,")?;
    let ext = TIPOS.iter().find(|(_, t)| *t == tipo)?.0;
    let arquivo = format!("{base}.{ext}");
    std::fs::write(pasta.join(&arquivo), base64::engine::general_purpose::STANDARD.decode(dados).ok()?).ok()?;
    let _ = std::fs::remove_file(sem);
    Some(arquivo)
}

/// Arquivo já salvo para `base`, para o índice por nome.
fn arquivo_salvo(pasta: &Path, base: &str) -> Option<String> {
    TIPOS.iter().map(|(ext, _)| format!("{base}.{ext}")).find(|a| pasta.join(a).is_file())
}

/// Ícone de uma ferramenta chamada na conversa (`mcp:stitch`, `plugin:vercel`, `conector:gmail`, ver
/// `omni_core::extensoes::chave_do_icone`): o já salvo, senão busca como a aba Extensões buscaria.
#[tauri::command]
pub async fn icone_da_ferramenta(chave: String) -> Result<Option<String>, String> {
    let dir = crate::engine_client::engine_dir()?;
    let (conhecido, destino) = {
        let (dir, chave) = (dir.clone(), chave.clone());
        tokio::task::spawn_blocking(move || {
            let conhecido = omni_core::extensoes::icone_conhecido(&dir, &chave);
            let destino = if conhecido.is_some() { None } else { omni_core::extensoes::destino_do_icone(&dir, &chave) };
            (conhecido, destino)
        }).await.map_err(|e| e.to_string())?
    };
    if conhecido.is_some() { return Ok(conhecido); }
    let (Some(destino), Some((_, nome))) = (destino, chave.split_once(':')) else { return Ok(None) };
    icone_da_extensao(destino, Some(nome.to_owned())).await
}

/// `destino`: URL de um MCP remoto, `conector:<nome>` (conector do claude.ai) ou `pacote:<url>` (site do
/// manifesto de um plugin, pode vir vazio). `nome` é a pista para marcas conhecidas (`stitch` →
/// stitch.withgoogle.com). Comando local (stdio) sem marca conhecida volta `None` sem ir à rede.
#[tauri::command]
pub async fn icone_da_extensao(destino: String, nome: Option<String>) -> Result<Option<String>, String> {
    let nome = nome.unwrap_or_default();
    let Some(alvo) = Alvo::de(&destino, &nome) else { return Ok(None) };
    let dir = crate::engine_client::engine_dir()?;
    let pasta = dir.join("icones");
    let base = nome_do_arquivo(&format!("{destino}|{nome}"), &nome);
    let chave = omni_core::extensoes::chave_do_icone(&destino, &nome);
    if let Some(salvo) = ler_salvo(&pasta, &base) {
        if let Some(arquivo) = salvo.as_ref().and_then(|_| arquivo_salvo(&pasta, &base)) {
            omni_core::extensoes::guardar_nome_do_icone(&dir, &chave, &arquivo);
        }
        return Ok(salvo);
    }
    // Mesmo provedor TLS que o updater instala (ring); sem ele o reqwest "no-provider" não conecta.
    if rustls::crypto::CryptoProvider::get_default().is_none() {
        let _ = rustls::crypto::ring::default_provider().install_default();
    }
    let cliente = reqwest::Client::builder()
        .timeout(Duration::from_secs(5))
        .user_agent("Mozilla/5.0 (OMNI AGENTS)")
        .build()
        .map_err(|e| e.to_string())?;
    let mut icone = None;
    if let Some(url) = &alvo.mcp {
        icone = do_servidor_mcp(&cliente, url).await;
    }
    for dominio in &alvo.dominios {
        if icone.is_some() { break; }
        icone = do_site(&cliente, dominio).await;
    }
    for src in &alvo.imagens {
        if icone.is_some() { break; }
        icone = baixar_imagem(&cliente, src, src).await;
    }
    if let Some(arquivo) = salvar(&pasta, &base, &icone) {
        omni_core::extensoes::guardar_nome_do_icone(&dir, &chave, &arquivo);
    }
    Ok(icone)
}

struct Alvo {
    /// URL do MCP para o `initialize` (só MCP remoto).
    mcp: Option<String>,
    /// Domínios onde procurar o favicon, na ordem.
    dominios: Vec<String>,
    /// Imagens diretas, por último: o avatar do dono no GitHub quando o plugin só aponta o repositório.
    imagens: Vec<String>,
}

impl Alvo {
    fn de(destino: &str, nome: &str) -> Option<Self> {
        let mut alvo = Alvo { mcp: None, dominios: Vec::new(), imagens: Vec::new() };
        if let Some(conector) = destino.strip_prefix("conector:") {
            alvo.dominios.extend(dominio_da_marca(conector, true));
        } else if let Some(site) = destino.strip_prefix("pacote:") {
            alvo.dominios.extend(dominio_da_marca(nome, false));
            match dono_no_github(site) {
                Some(dono) => alvo.imagens.push(format!("https://github.com/{dono}.png?size=64")),
                None => alvo.dominios.extend(dominios_da_url(site)),
            }
        } else if destino.starts_with("https://") || destino.starts_with("http://") {
            alvo.mcp = Some(destino.to_owned());
            let mut dominios = dominios_da_url(destino).into_iter();
            alvo.dominios.extend(dominios.next());
            alvo.dominios.extend(dominio_da_marca(nome, false));
            alvo.dominios.extend(dominios);
        } else {
            alvo.dominios.extend(dominio_da_marca(nome, false));
        }
        let mut vistos = std::collections::HashSet::new();
        alvo.dominios.retain(|d| vistos.insert(d.clone()));
        (alvo.mcp.is_some() || !alvo.dominios.is_empty() || !alvo.imagens.is_empty()).then_some(alvo)
    }
}

/// Host e domínio de uma URL (`mcp.notion.com` → `notion.com`); rede local não tem favicon público.
fn dominios_da_url(url: &str) -> Vec<String> {
    let Some(resto) = url.strip_prefix("https://").or_else(|| url.strip_prefix("http://")) else { return Vec::new() };
    let host = resto.split(['/', ':', '?', '#']).next().unwrap_or("").to_ascii_lowercase();
    let local = host.is_empty() || host == "localhost" || host.starts_with('[') || host.parse::<std::net::Ipv4Addr>().is_ok();
    if local { return Vec::new(); }
    let mut dominios = vec![host.clone()];
    let partes: Vec<&str> = host.split('.').collect();
    if partes.len() > 2 { dominios.push(partes[1..].join(".")); }
    dominios
}

/// `github.com/<dono>/...` → dono (o avatar dele é o logo da organização na maioria dos plugins).
fn dono_no_github(url: &str) -> Option<String> {
    let resto = url.strip_prefix("https://").or_else(|| url.strip_prefix("http://"))?;
    let resto = resto.strip_prefix("www.").unwrap_or(resto).strip_prefix("github.com/")?;
    let dono = resto.split(['/', '?', '#']).next()?;
    (!dono.is_empty() && dono.chars().all(|c| c.is_ascii_alphanumeric() || c == '-')).then(|| dono.to_owned())
}

/// Site de uma marca pelo nome ("Gmail", "Google Drive", "claude.ai Notion", "stitch"…). Com `chutar`
/// (conector, que só tem o nome), nome de uma palavra vira `<nome>.com`; MCP e plugin só usam a lista.
fn dominio_da_marca(nome: &str, chutar: bool) -> Option<String> {
    let nome = nome.trim().trim_start_matches("claude.ai").trim().to_ascii_lowercase().replace(['-', '_'], " ");
    const CONHECIDOS: &[(&str, &str)] = &[
        ("gmail", "mail.google.com"), ("google drive", "drive.google.com"), ("google calendar", "calendar.google.com"),
        ("google docs", "docs.google.com"), ("google sheets", "sheets.google.com"), ("stitch", "stitch.withgoogle.com"),
        ("notion", "notion.so"), ("linear", "linear.app"), ("figma", "figma.com"), ("slack", "slack.com"), ("asana", "asana.com"),
        ("atlassian", "atlassian.com"), ("jira", "atlassian.com"), ("confluence", "atlassian.com"), ("canva", "canva.com"),
        ("stripe", "stripe.com"), ("github", "github.com"), ("vercel", "vercel.com"), ("supabase", "supabase.com"),
        ("hubspot", "hubspot.com"), ("intercom", "intercom.com"), ("zapier", "zapier.com"), ("box", "box.com"),
        ("cloudflare", "cloudflare.com"), ("sentry", "sentry.io"), ("paypal", "paypal.com"), ("monday", "monday.com"),
        ("lucid", "lucid.app"), ("miro", "miro.com"), ("airtable", "airtable.com"), ("dropbox", "dropbox.com"),
        ("mercado pago", "mercadopago.com.br"), ("mercadopago", "mercadopago.com.br"), ("netlify", "netlify.com"),
        ("clickup", "clickup.com"), ("firecrawl", "firecrawl.dev"), ("playwright", "playwright.dev"), ("n8n", "n8n.io"),
        ("context7", "context7.com"), ("postgres", "postgresql.org"), ("docker", "docker.com"), ("shadcn", "ui.shadcn.com"),
    ];
    if let Some((_, dominio)) = CONHECIDOS.iter().find(|(chave, _)| nome == *chave || nome.starts_with(&format!("{chave} "))) {
        return Some((*dominio).to_owned());
    }
    (chutar && !nome.is_empty() && nome.chars().all(|c| c.is_ascii_alphanumeric())).then(|| format!("{nome}.com"))
}

/// `initialize` do MCP (Streamable HTTP): resposta em JSON ou em SSE, ícone em `serverInfo.icons`.
/// Servidor que pede login (401) simplesmente não responde — cai no favicon.
async fn do_servidor_mcp(cliente: &reqwest::Client, url: &str) -> Option<String> {
    let corpo = serde_json::json!({
        "jsonrpc": "2.0", "id": 1, "method": "initialize",
        "params": { "protocolVersion": "2025-11-25", "capabilities": {}, "clientInfo": { "name": "omni-agents", "version": env!("CARGO_PKG_VERSION") } }
    });
    let resposta = cliente.post(url)
        .header("Accept", "application/json, text/event-stream")
        .header("Content-Type", "application/json")
        .body(corpo.to_string())
        .send().await.ok()?;
    if !resposta.status().is_success() { return None; }
    let sessao = resposta.headers().get("mcp-session-id").and_then(|v| v.to_str().ok()).map(str::to_owned);
    let texto = resposta.text().await.ok()?;
    // Encerra a sessão que o servidor abriu para nós (cortesia; falha não importa).
    if let Some(sessao) = sessao {
        let _ = cliente.delete(url).header("mcp-session-id", sessao).send().await;
    }
    let icones = icones_do_initialize(&texto);
    for src in icones {
        if let Some(icone) = baixar_imagem(cliente, &src, url).await { return Some(icone); }
    }
    None
}

/// `src` dos ícones de uma resposta de `initialize`, o maior primeiro (o SVG conta como maior).
fn icones_do_initialize(texto: &str) -> Vec<String> {
    let json: Option<Value> = serde_json::from_str(texto.trim()).ok().or_else(|| {
        texto.lines().filter_map(|linha| linha.strip_prefix("data:")).find_map(|dado| serde_json::from_str(dado.trim()).ok())
    });
    let Some(icones) = json.as_ref().and_then(|v| v.pointer("/result/serverInfo/icons")).and_then(Value::as_array) else { return Vec::new() };
    let tamanho = |icone: &Value| -> u32 {
        if icone.get("mimeType").and_then(Value::as_str) == Some("image/svg+xml") { return u32::MAX; }
        icone.get("sizes").and_then(Value::as_array).into_iter().flatten().filter_map(Value::as_str)
            .filter_map(|s| s.split('x').next()?.parse().ok()).max().unwrap_or(0)
    };
    let mut lista: Vec<&Value> = icones.iter().filter(|i| i.get("src").and_then(Value::as_str).is_some()).collect();
    lista.sort_by_key(|i| std::cmp::Reverse(tamanho(i)));
    lista.into_iter().filter_map(|i| i.get("src")?.as_str().map(str::to_owned)).collect()
}

/// Ícone declarado na página inicial do site; sem isso, o `/favicon.ico`.
async fn do_site(cliente: &reqwest::Client, dominio: &str) -> Option<String> {
    let base = format!("https://{dominio}/");
    if let Ok(resposta) = cliente.get(&base).send().await {
        let final_url = resposta.url().to_string();
        if let Ok(html) = resposta.text().await {
            for href in links_de_icone(&html) {
                if let Some(icone) = baixar_imagem(cliente, &href, &final_url).await { return Some(icone); }
            }
        }
    }
    baixar_imagem(cliente, "/favicon.ico", &base).await
}

/// `href` dos `<link rel="…icon…">` do HTML, o melhor primeiro: apple-touch (grande), svg, o resto.
fn links_de_icone(html: &str) -> Vec<String> {
    let minusculo = html.to_ascii_lowercase();
    let mut achados: Vec<(u8, String)> = Vec::new();
    let mut inicio = 0;
    while let Some(pos) = minusculo[inicio..].find("<link") {
        let abre = inicio + pos;
        let Some(fim) = minusculo[abre..].find('>') else { break };
        let tag = &html[abre..abre + fim];
        let tag_min = &minusculo[abre..abre + fim];
        inicio = abre + fim;
        let Some(rel) = atributo(tag_min, tag_min, "rel") else { continue };
        if !rel.split_whitespace().any(|r| r == "icon" || r == "apple-touch-icon" || r == "apple-touch-icon-precomposed") { continue; }
        let Some(href) = atributo(tag_min, tag, "href") else { continue };
        let svg = href.to_ascii_lowercase().ends_with(".svg") || atributo(tag_min, tag_min, "type").as_deref() == Some("image/svg+xml");
        let peso = if rel.contains("apple-touch") { 0 } else if svg { 1 } else { 2 };
        achados.push((peso, href));
    }
    achados.sort_by_key(|(peso, _)| *peso);
    achados.into_iter().map(|(_, href)| href).collect()
}

/// Valor de `nome="…"`/`nome='…'`/`nome=…` numa tag; procura em minúsculas, devolve do original.
fn atributo(tag_min: &str, tag: &str, nome: &str) -> Option<String> {
    let mut busca = 0;
    while let Some(pos) = tag_min[busca..].find(nome) {
        let i = busca + pos;
        busca = i + nome.len();
        let antes_ok = i == 0 || tag_min.as_bytes()[i - 1].is_ascii_whitespace();
        let depois = tag_min[busca..].trim_start();
        if !antes_ok || !depois.starts_with('=') { continue; }
        let valor_ini = tag_min.len() - depois.len() + 1;
        let resto = tag[valor_ini..].trim_start();
        let valor = match resto.chars().next()? {
            aspas @ ('"' | '\'') => resto[1..].split(aspas).next()?,
            _ => resto.split(char::is_whitespace).next()?,
        };
        return Some(valor.trim().to_owned());
    }
    None
}

/// Baixa e devolve em `data:` URI — só imagem de verdade (tipo ou assinatura) e até 300 KB.
async fn baixar_imagem(cliente: &reqwest::Client, src: &str, base: &str) -> Option<String> {
    if src.starts_with("data:image/") { return (src.len() <= LIMITE_BYTES * 2).then(|| src.to_owned()); }
    let url = resolver(src, base)?;
    let resposta = cliente.get(&url).send().await.ok()?;
    if !resposta.status().is_success() { return None; }
    let tipo_dito = resposta.headers().get("content-type").and_then(|v| v.to_str().ok()).unwrap_or("").split(';').next().unwrap_or("").trim().to_ascii_lowercase();
    let bytes = resposta.bytes().await.ok()?;
    if bytes.is_empty() || bytes.len() > LIMITE_BYTES { return None; }
    let tipo = tipo_da_imagem(&bytes).map(str::to_owned).or_else(|| tipo_dito.starts_with("image/").then_some(tipo_dito))?;
    Some(format!("data:{tipo};base64,{}", base64::engine::general_purpose::STANDARD.encode(&bytes)))
}

/// Pela assinatura dos bytes: o servidor às vezes manda o favicon como `text/html` ou `octet-stream`.
fn tipo_da_imagem(bytes: &[u8]) -> Option<&'static str> {
    if bytes.starts_with(b"\x89PNG") { return Some("image/png"); }
    if bytes.starts_with(&[0, 0, 1, 0]) { return Some("image/x-icon"); }
    if bytes.starts_with(b"\xFF\xD8\xFF") { return Some("image/jpeg"); }
    if bytes.starts_with(b"GIF8") { return Some("image/gif"); }
    if bytes.len() > 12 && &bytes[0..4] == b"RIFF" && &bytes[8..12] == b"WEBP" { return Some("image/webp"); }
    let inicio = String::from_utf8_lossy(&bytes[..bytes.len().min(512)]).to_ascii_lowercase();
    (inicio.contains("<svg")).then_some("image/svg+xml")
}

/// `href` relativo (`/x.png`, `x.png`, `//cdn/x.png`) contra a página de onde veio. Só http(s).
fn resolver(href: &str, base: &str) -> Option<String> {
    if href.starts_with("https://") || href.starts_with("http://") { return Some(href.to_owned()); }
    let (esquema, resto) = base.split_once("://")?;
    if let Some(sem) = href.strip_prefix("//") { return Some(format!("{esquema}://{sem}")); }
    let origem = format!("{esquema}://{}", resto.split('/').next()?);
    if href.starts_with('/') { return Some(format!("{origem}{href}")); }
    let pasta = base.rsplit_once('/').map(|(p, _)| p).filter(|p| p.len() > origem.len()).unwrap_or(&origem);
    Some(format!("{pasta}/{href}"))
}

#[cfg(test)]
mod testes {
    use super::*;

    #[test]
    fn icones_do_initialize_em_json_e_sse_maior_primeiro() {
        let json = r#"{"jsonrpc":"2.0","id":1,"result":{"serverInfo":{"name":"x","icons":[
            {"src":"https://x.com/16.png","sizes":["16x16"]},{"src":"https://x.com/128.png","sizes":["128x128"]}]}}}"#;
        assert_eq!(icones_do_initialize(json), ["https://x.com/128.png", "https://x.com/16.png"]);
        let sse = format!("event: message\ndata: {}\n\n", json.replace('\n', ""));
        assert_eq!(icones_do_initialize(&sse)[0], "https://x.com/128.png");
        assert!(icones_do_initialize(r#"{"result":{"serverInfo":{"name":"sem"}}}"#).is_empty());
    }

    #[test]
    fn links_de_icone_preferem_apple_touch_e_svg() {
        let html = r#"<head><link rel="stylesheet" href="a.css"><link rel="icon" href="/favicon.ico">
            <LINK REL='icon' type="image/svg+xml" href='/logo.svg'><link href=/apple.png rel="apple-touch-icon"></head>"#;
        assert_eq!(links_de_icone(html), ["/apple.png", "/logo.svg", "/favicon.ico"]);
    }

    #[test]
    fn resolve_relativo_contra_a_pagina() {
        assert_eq!(resolver("/f.ico", "https://a.com/x/y").unwrap(), "https://a.com/f.ico");
        assert_eq!(resolver("//cdn.a.com/f.png", "https://a.com/").unwrap(), "https://cdn.a.com/f.png");
        assert_eq!(resolver("img/f.png", "https://a.com/x/pagina").unwrap(), "https://a.com/x/img/f.png");
        assert_eq!(resolver("f.png", "https://a.com").unwrap(), "https://a.com/f.png");
    }

    #[test]
    fn alvo_do_mcp_do_conector_e_do_plugin() {
        let alvo = Alvo::de("https://mcp.notion.com/mcp", "notion").unwrap();
        assert_eq!(alvo.dominios, ["mcp.notion.com", "notion.so", "notion.com"]);
        assert_eq!(Alvo::de("https://stitch.googleapis.com/mcp", "stitch").unwrap().dominios,
            ["stitch.googleapis.com", "stitch.withgoogle.com", "googleapis.com"]);
        let local = Alvo::de("http://127.0.0.1:3100/mcp", "openpencil").unwrap();
        assert!(local.mcp.is_some() && local.dominios.is_empty());
        assert!(Alvo::de("npx -y pacote", "meu-mcp").is_none());
        assert_eq!(Alvo::de("npx -y @playwright/mcp", "playwright").unwrap().dominios, ["playwright.dev"]);
        assert_eq!(Alvo::de("conector:Google Drive", "").unwrap().dominios, ["drive.google.com"]);
        assert_eq!(Alvo::de("conector:claude.ai Gmail", "").unwrap().dominios, ["mail.google.com"]);
        assert_eq!(Alvo::de("conector:Granola", "").unwrap().dominios, ["granola.com"]);
        assert!(Alvo::de("conector:Meu servidor interno", "").is_none());
        let caveman = Alvo::de("pacote:https://github.com/JuliusBrussee", "caveman").unwrap();
        assert!(caveman.dominios.is_empty());
        assert_eq!(caveman.imagens, ["https://github.com/JuliusBrussee.png?size=64"]);
        assert_eq!(Alvo::de("pacote:https://docs.stripe.com", "stripe").unwrap().dominios, ["stripe.com", "docs.stripe.com"]);
        assert_eq!(Alvo::de("pacote:", "mercadopago").unwrap().dominios, ["mercadopago.com.br"]);
        assert!(Alvo::de("pacote:", "humanizer").is_none());
    }

    #[test]
    fn pasta_guarda_imagem_e_falha_recente() {
        let pasta = std::env::temp_dir().join(format!("omni-icones-{}", std::process::id()));
        let base = nome_do_arquivo("https://stitch.googleapis.com/mcp|stitch", "stitch");
        assert!(base.starts_with("stitch-") && base.len() == "stitch-".len() + 8);
        assert_eq!(ler_salvo(&pasta, &base), None);
        salvar(&pasta, &base, &None);
        assert_eq!(ler_salvo(&pasta, &base), Some(None));
        salvar(&pasta, &base, &Some("data:image/png;base64,iVBORw==".into()));
        assert!(pasta.join(format!("{base}.png")).is_file() && !pasta.join(format!("{base}.sem-icone")).exists());
        assert_eq!(ler_salvo(&pasta, &base), Some(Some("data:image/png;base64,iVBORw==".into())));
        let _ = std::fs::remove_dir_all(&pasta);
    }

    #[test]
    fn tipo_pela_assinatura() {
        assert_eq!(tipo_da_imagem(b"\x89PNG\r\n"), Some("image/png"));
        assert_eq!(tipo_da_imagem(&[0, 0, 1, 0, 1]), Some("image/x-icon"));
        assert_eq!(tipo_da_imagem(b"<?xml?><svg xmlns=''/>"), Some("image/svg+xml"));
        assert_eq!(tipo_da_imagem(b"<html>nope</html>"), None);
    }
}
