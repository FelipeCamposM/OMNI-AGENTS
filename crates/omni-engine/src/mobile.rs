use super::*;
use axum::{Router, Json, extract::{State, Path as RoutePath, Query, DefaultBodyLimit, Request},
    http::{StatusCode, HeaderMap}, response::{IntoResponse, Response}, routing::{get,post}, middleware::{self, Next}};
use omni_protocol::{MobileConfig, PublishedAgent, PublishedProject, PublishedWorkspace, TotpAction};
use serde::{Serialize, Deserialize};
use serde_json::{Value, json};
use std::net::{SocketAddr, IpAddr};
use tokio::sync::Notify;

#[cfg(mobile_assets)]
static ASSETS: include_dir::Dir<'_> = include_dir::include_dir!("$CARGO_MANIFEST_DIR/../../dist-mobile");

pub struct MobileRuntime {
    config: Mutex<MobileConfig>,
    workspace: Mutex<PublishedWorkspace>,
    /// Nome MagicDNS resolvido na última leitura das configurações. Cacheado porque o
    /// `same_origin` roda em **toda** requisição e não pode disparar a CLI do Tailscale.
    magic_dns: Mutex<Option<String>>,
    /// `(url pública, link para habilitar o Serve na conta)`. Preenchido pela tarefa do servidor,
    /// nunca pela tela: `tailscale serve` pode levar dezenas de segundos e não pode segurar as
    /// Configurações esperando.
    serve_state: Mutex<(Option<String>,Option<String>)>,
    /// Tentativas de pareamento pelo Authy: instantes das falhas recentes e o último passo TOTP aceito.
    pareamento: Mutex<Pareamento>,
    status: Mutex<(Option<String>,Option<String>)>,
    changed: Notify,
    actions: Mutex<VecDeque<Action>>,
    pending: Notify,
}
#[derive(Clone, Serialize)]
struct Action {
    id: String, conversation_id: String, session_id: String, state: String,
    created_at_ms: u64, error: Option<String>,
    #[serde(skip)] key: String,
    #[serde(skip)] revision: String,
    #[serde(skip)] kind: ActionKind,
}
#[derive(Clone, PartialEq)]
enum ActionKind { Prompt(String), Approval(bool), Spawn(SpawnPlan) }

/// Tudo já resolvido **no servidor** antes de entrar na fila. O corpo do request não contribui com
/// nenhum caminho nem binário: o `cwd` vem do projeto conhecido, o `command` da lista de CLIs que o
/// desktop publicou, e o `env` do perfil gravado em `profiles.json`.
#[derive(Clone, PartialEq)]
struct SpawnPlan {
    project_id: String,
    cwd: String,
    title: String,
    provider: String,
    profile_id: Option<String>,
    command: String,
    env: Vec<(String,String)>,
    external_session_id: Option<String>,
    transcript_path: Option<String>,
}

impl MobileRuntime {
    pub fn new(dir: &Path) -> Self {
        Self { config: Mutex::new(omni_protocol::read_json_or_default(&dir.join("mobile.json"))),
            // Em disco, não só em memória: o engine reinicia sem o desktop aberto (update, crash), e
            // aí a lista sumiria justamente quando o celular é a única via de acesso.
            workspace: Mutex::new(omni_protocol::read_json_or_default(&dir.join("workspace.json"))),
            magic_dns: Mutex::new(None),
            serve_state: Mutex::new((None,None)),
            pareamento: Mutex::new(Pareamento::default()),
            status: Mutex::new((None,None)),changed: Notify::new(),actions: Mutex::new(VecDeque::new()),pending: Notify::new() }
    }
}

/// Roda a CLI do Tailscale e devolve (sucesso, stdout+stderr). Timeout curto: o cliente pode estar
/// travado e a tela de Configurações não pode ficar pendurada esperando por ele.
fn tailscale(args: &[&str], segundos: u64) -> Option<(bool,String)> {
    let app = PathBuf::from("/Applications/Tailscale.app/Contents/MacOS/Tailscale"); // app da Mac App Store / site
    let path = if cfg!(windows) { PathBuf::from("C:/Program Files/Tailscale/tailscale.exe") }
        else if cfg!(target_os = "macos") && app.is_file() { app } else { PathBuf::from("tailscale") };
    let mut command = std::process::Command::new(path);
    command.args(args).stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::piped()).stderr(std::process::Stdio::piped());
    #[cfg(windows)] { use std::os::windows::process::CommandExt; command.creation_flags(0x08000000); }
    let mut child = command.spawn().ok()?;
    let started = std::time::Instant::now();
    let mut estourou = false;
    loop {
        if child.try_wait().ok()?.is_some() { break; }
        if started.elapsed() > std::time::Duration::from_secs(segundos) { let _ = child.kill(); estourou = true; break; }
        std::thread::sleep(std::time::Duration::from_millis(25));
    }
    // A saída é lida **mesmo no timeout**. `tailscale serve --bg` com o Serve desabilitado imprime o
    // link de liberação e fica esperando, sem sair; antes a saída era descartada aqui e a tela só
    // dizia "o Tailscale não respondeu", escondendo justamente o link que resolvia.
    let output = child.wait_with_output().ok()?;
    let mut texto = String::from_utf8_lossy(&output.stdout).into_owned();
    texto.push_str(&String::from_utf8_lossy(&output.stderr));
    Some((output.status.success() && !estourou,texto))
}

fn tailscale_ip() -> Option<IpAddr> {
    // The installed Tailscale client is the authority, not a guess based on a 100.x address.
    let (ok,saida) = tailscale(&["ip","-4"],2)?;
    ok.then(|| saida.trim().lines().next()?.trim().parse().ok()).flatten()
}

/// Nome MagicDNS deste PC (`pc-felipe.tail68f850.ts.net`). É o endereço que o `tailscale serve`
/// publica, e ele não muda quando o IP do tailnet muda.
fn magic_dns() -> Option<String> {
    let (ok,saida) = tailscale(&["status","--json"],3)?;
    if !ok { return None }
    let valor: Value = serde_json::from_str(&saida).ok()?;
    let nome = valor["Self"]["DNSName"].as_str()?.trim_end_matches('.').to_string();
    (!nome.is_empty()).then_some(nome)
}

/// Publica a porta local pelo `tailscale serve`. Devolve `Err(link)` quando o Serve ainda não foi
/// habilitado na conta — é uma ação de uma vez só, por tailnet, e a UI mostra o link como botão.
fn serve_start(porta: u16) -> Result<(),String> {
    // 10 s bastam: liberado, o comando volta em poucos segundos; não liberado, ele **nunca** volta
    // (imprime o link e fica esperando), então esperar mais só atrasa a tela.
    let Some((ok,saida)) = tailscale(&["serve","--bg",&porta.to_string()],10) else {
        return Err("Tailscale não encontrado neste PC.".into());
    };
    if ok { return Ok(()) }
    Err(motivo_do_serve(&saida))
}

/// Tira da saída do `tailscale serve` o que a tela precisa: o link de liberação, quando houver.
/// Separado para testar sem um Tailscale de verdade.
fn motivo_do_serve(saida: &str) -> String {
    if let Some(link) = saida.split_whitespace().find(|palavra| palavra.starts_with("https://login.tailscale.com/")) {
        return link.to_owned();
    }
    let texto = saida.trim();
    if texto.is_empty() { "O Tailscale não respondeu.".into() } else { texto.to_owned() }
}

fn serve_reset() { let _ = tailscale(&["serve","reset"],15); }

/// Resolve MagicDNS e publica (ou despublica) pelo Serve. Roda na tarefa do servidor, fora do
/// caminho da tela, porque a CLI do Tailscale pode levar dezenas de segundos para responder.
async fn publicar(state: &Arc<EngineState>, config: &MobileConfig) {
    // Zera antes de tentar: o aviso da tentativa anterior ("falta liberar") pararia o polling da
    // tela, e depois de a pessoa liberar e clicar em Aplicar o QR nunca apareceria.
    *state.mobile.serve_state.lock().expect("serve poisoned") = (None,None);
    let serve = config.serve;
    let porta: u16 = config.bind.rsplit(':').next().and_then(|p|p.parse().ok()).unwrap_or(0);
    let resultado = tokio::task::spawn_blocking(move || {
        let nome = magic_dns();
        if !serve { serve_reset(); return (nome,Ok(())) }
        let publicado = serve_start(porta);
        (nome,publicado)
    }).await;
    let Ok((nome,publicado)) = resultado else { return };

    *state.mobile.magic_dns.lock().expect("magic poisoned") = nome.clone();
    *state.mobile.serve_state.lock().expect("serve poisoned") = match publicado {
        Ok(()) if serve => (nome.map(|n| format!("https://{n}")),None),
        Ok(()) => (None,None),
        Err(motivo) if motivo.starts_with("https://login.tailscale.com/") => (None,Some(motivo)),
        Err(motivo) => (None,Some(motivo)),
    };
}


/// Bate na porta do próprio servidor e conta o que aconteceu, em português.
///
/// Existe porque `listening` só prova que o `bind` deu certo — não prova que alguém consegue
/// chegar. Era exatamente esse o buraco: a tela dizia "no ar" e o celular dava tempo esgotado, sem
/// nada para diferenciar um problema de rede de um servidor que nunca subiu.
///
/// TCP cru e um GET de uma linha em vez de um cliente HTTP: são 15 linhas contra uma dependência
/// nova no engine.
pub fn check(state: &EngineState) -> Result<EngineResponse> {
    use std::io::{Read as _, Write as _};
    let config = state.mobile.config.lock().map_err(|_|anyhow!("config poisoned"))?.clone();
    if !config.enabled { return Ok(EngineResponse::MobileCheck{ok:false,message:"Acesso pelo celular está desativado.".into()}); }

    let address: SocketAddr = config.bind.parse().context("Endereço inválido")?;
    let Ok(mut fluxo) = std::net::TcpStream::connect_timeout(&address,std::time::Duration::from_secs(3)) else {
        return Ok(EngineResponse::MobileCheck{ok:false,
            message:format!("Nada atendeu em {}. O servidor não chegou a subir — desative e ative de novo.",config.bind)});
    };
    fluxo.set_read_timeout(Some(std::time::Duration::from_secs(3)))?;
    write!(fluxo,"GET /conversas HTTP/1.1\r\nHost: {}\r\nConnection: close\r\n\r\n",config.bind)?;
    let mut resposta = String::new();
    let _ = fluxo.take(256).read_to_string(&mut resposta);

    // 401 é o resultado **bom**: prova que o servidor atendeu e que o token está sendo exigido.
    Ok(if resposta.contains(" 401") {
        EngineResponse::MobileCheck{ok:true,message:"Servidor no ar e exigindo o código de acesso, como deve ser.".into()}
    } else if resposta.contains(" 200") {
        EngineResponse::MobileCheck{ok:false,message:"Servidor no ar, mas respondeu sem exigir código — desative e ative de novo.".into()}
    } else {
        EngineResponse::MobileCheck{ok:false,
            message:format!("Resposta inesperada do servidor: {}",resposta.lines().next().unwrap_or("(vazia)"))}
    })
}

/// `127.0.0.1` nunca é alcançável pelo celular. No modo direto, se o Tailscale está no ar, troca o
/// loopback pelo IP dele mantendo a porta. Devolve se trocou.
///
/// Sem isto a tela gerava um QR apontando para `127.0.0.1:47322`: abria no PC, e no 4G falhava sem
/// explicação nenhuma. O IP vem injetado para o teste não depender de um Tailscale de verdade.
fn preferir_ip(config: &mut MobileConfig, tailscale: Option<IpAddr>) -> bool {
    if config.serve { return false } // o Serve exige loopback de propósito
    let Ok(endereco) = config.bind.parse::<SocketAddr>() else { return false };
    let Some(ip) = tailscale.filter(|_| endereco.ip().is_loopback()) else { return false };
    config.bind = SocketAddr::new(ip,endereco.port()).to_string();
    true
}

fn preferir_tailscale(config: &mut MobileConfig) -> bool {
    if config.serve || !config.bind.starts_with("127.") { return false }
    preferir_ip(config,tailscale_ip())
}

fn validate(config: &MobileConfig) -> Result<SocketAddr> {
    let address: SocketAddr = config.bind.parse().context("Use IP:porta, por exemplo 100.x.x.x:47322")?;
    if address.port() == 0 || address.port() == DEFAULT_ENGINE_PORT { return Err(anyhow!("Porta HTTP inválida")); }
    // No modo serve quem atende a rede é o tailscaled; escutar num IP roteável além disso só
    // aumentaria a superfície exposta sem serventia.
    if config.serve && address.ip() != IpAddr::V4(std::net::Ipv4Addr::LOCALHOST) {
        return Err(anyhow!("Com o Tailscale Serve ligado, use 127.0.0.1 no endereço"));
    }
    if address.ip() == IpAddr::V4(std::net::Ipv4Addr::LOCALHOST) { return Ok(address); }
    if address.ip().is_unspecified() || Some(address.ip()) != tailscale_ip() {
        return Err(anyhow!("Escolha 127.0.0.1 ou o IP da interface Tailscale instalada neste PC"));
    }
    Ok(address)
}

pub fn settings(state: &EngineState, config: Option<MobileConfig>, rotate: bool) -> Result<EngineResponse> {
    if let Some(mut config) = config {
        // O `token` que veio do desktop é descartado: quem guarda o segredo é o engine. Assim uma
        // tela de configuração não consegue plantar um token escolhido por ela.
        let atual = state.mobile.config.lock().map_err(|_|anyhow!("config poisoned"))?.token.clone();
        config.token = if rotate || (config.enabled && atual.is_empty()) { random_token() } else { atual };
        // Mesmo motivo do token: o cadastro do Authy é do engine. Uma tela de configuração que
        // mandasse `totp_confirmed: true` não pode pular a confirmação.
        {
            let guardado = state.mobile.config.lock().map_err(|_|anyhow!("config poisoned"))?;
            config.totp_secret = guardado.totp_secret.clone();
            config.totp_confirmed = guardado.totp_confirmed;
        }
        if config.enabled { preferir_tailscale(&mut config); validate(&config)?; }
        atomic_write_json(&state.state_file.with_file_name("mobile.json"),&config)?;
        *state.mobile.config.lock().map_err(|_|anyhow!("config poisoned"))? = config;
        // Rotacionar reinicia o listener junto: é o que derruba quem estava com o token antigo.
        state.mobile.changed.notify_one();
    }
    let config = state.mobile.config.lock().map_err(|_|anyhow!("config poisoned"))?.clone();
    let (listening,error) = state.mobile.status.lock().map_err(|_|anyhow!("status poisoned"))?.clone();
    let magic = state.mobile.magic_dns.lock().map_err(|_|anyhow!("magic poisoned"))?.clone();
    let (serve_url,serve_hint) = state.mobile.serve_state.lock().map_err(|_|anyhow!("serve poisoned"))?.clone();

    // No modo Serve o endereço público só existe quando o Tailscale confirmou a publicação; até
    // lá a tela mostra "ligando" em vez de um link de loopback que o celular não alcança.
    let public_url = if config.serve {
        serve_url
    } else {
        // Loopback só abre neste PC: não vira QR. Sem Tailscale, a tela explica em vez de gerar um
        // código que falha no celular.
        listening.clone().filter(|_| !config.bind.starts_with("127."))
    };

    // O link do QR só existe quando há endereço público; sem isso o celular leria um endereço morto.
    let qr = public_url.as_ref().map(|url| format!("{url}/#t={}",config.token));
    let totp_confirmed = config.totp_confirmed;
    let totp_uri = (!config.totp_confirmed && !config.totp_secret.is_empty())
        .then(|| totp_de(&config.totp_secret, magic.as_deref()).map(|t| t.get_url()))
        .flatten();
    Ok(EngineResponse::MobileSettings { config,listening,error,qr,public_url,magic_dns:magic,serve_hint,totp_confirmed,totp_uri })
}

/// Passo do TOTP (RFC 6238). Padrão do Authy e do Google Authenticator: 30 s, 6 dígitos, SHA-1.
const TOTP_PASSO: u64 = 30;
/// Janela de tolerância, em passos, para relógio do PC e do celular fora de sincronia.
const TOTP_JANELA: i64 = 1;
/// Erros de pareamento tolerados dentro de `TRAVA_MS` antes de recusar tudo.
const MAX_FALHAS: usize = 5;
const TRAVA_MS: u64 = 5 * 60_000;

#[derive(Default)]
pub struct Pareamento { falhas: VecDeque<u64>, ultimo_passo: u64 }

/// Monta o TOTP a partir do segredo guardado. `None` com segredo corrompido.
fn totp_de(secret: &str, conta: Option<&str>) -> Option<totp_rs::TOTP> {
    let bytes = totp_rs::Secret::Encoded(secret.to_owned()).to_bytes().ok()?;
    // `:` é separador no `otpauth://`: nome com dois pontos invalida o cadastro.
    let conta = conta.unwrap_or("PC").replace(':', "-");
    totp_rs::TOTP::new(totp_rs::Algorithm::SHA1, 6, 0, TOTP_PASSO, bytes, Some("OMNI AGENTS".into()), conta).ok()
}

/// Passo aceito para `code` no instante `agora` (segundos), com janela ±`TOTP_JANELA`.
///
/// Devolve o passo, e não só `bool`, porque o pareamento recusa reuso: um código visto por cima do
/// ombro não pode ser digitado de novo nos segundos seguintes. Comparação em tempo constante.
fn totp_confere(secret: &str, code: &str, agora: u64) -> Option<u64> {
    if code.len() != 6 || !code.bytes().all(|b| b.is_ascii_digit()) { return None }
    let totp = totp_de(secret, None)?;
    let atual = (agora / TOTP_PASSO) as i64;
    (-TOTP_JANELA..=TOTP_JANELA).map(|delta| atual + delta).filter(|passo| *passo >= 0)
        .find(|passo| token_confere(code, &totp.generate(*passo as u64 * TOTP_PASSO)))
        .map(|passo| passo as u64)
}

fn agora_segundos() -> u64 { now_ms() / 1000 }

/// Cadastro do Authy, pedido pelo desktop.
pub fn totp(state: &EngineState, action: TotpAction) -> Result<EngineResponse> {
    {
        let mut config = state.mobile.config.lock().map_err(|_|anyhow!("config poisoned"))?;
        match action {
            TotpAction::Reset => {
                let totp_rs::Secret::Encoded(novo) = totp_rs::Secret::generate_secret().to_encoded() else {
                    return Err(anyhow!("Falha ao gerar o segredo do Authy"));
                };
                config.totp_secret = novo;
                config.totp_confirmed = false;
            }
            TotpAction::Confirm { code } => {
                if config.totp_secret.is_empty() { return Err(anyhow!("Gere o código do Authy primeiro")); }
                if totp_confere(&config.totp_secret, code.trim(), agora_segundos()).is_none() {
                    return Err(anyhow!("Código do Authy não confere. Confira se leu o QR desta tela e use o código atual."));
                }
                config.totp_confirmed = true;
            }
        }
        atomic_write_json(&state.state_file.with_file_name("mobile.json"),&*config)?;
    }
    settings(state,None,false)
}

#[derive(Deserialize)] #[serde(deny_unknown_fields)] struct PareamentoBody { codigo: String }

/// Troca um código atual do Authy pelo token de dispositivo.
///
/// Existe porque o app da tela inicial do iPhone **não enxerga** o armazenamento do Safari (decisão
/// da Apple, WebKit bug 181849): o token gravado pelo QR não chega nele. É rota pública — quem
/// chama é justamente quem ainda não tem token — então a trava de tentativas é o que segura força
/// bruta: 3 códigos válidos em 10^6 e 5 tentativas a cada 5 minutos.
async fn parear(State(state): State<Arc<EngineState>>, Json(body): Json<PareamentoBody>) -> Result<Json<Value>,ApiError> {
    tokio::task::spawn_blocking(move || parear_em(&state,&body.codigo,agora_segundos()))
        .await.map_err(|_|error(StatusCode::INTERNAL_SERVER_ERROR,"Falha no pareamento"))?
}

fn parear_em(state: &EngineState, codigo: &str, agora: u64) -> Result<Json<Value>,ApiError> {
    let config = state.mobile.config.lock().expect("config poisoned").clone();
    if !config.totp_confirmed || config.totp_secret.is_empty() {
        return Err(error(StatusCode::CONFLICT,"Configure o Authy na aba Celular do PC primeiro"));
    }
    let mut pareamento = state.mobile.pareamento.lock().expect("pareamento poisoned");
    let agora_ms = agora * 1000;
    pareamento.falhas.retain(|instante| agora_ms.saturating_sub(*instante) < TRAVA_MS);
    if pareamento.falhas.len() >= MAX_FALHAS {
        return Err(error(StatusCode::TOO_MANY_REQUESTS,"Muitas tentativas erradas. Espere alguns minutos e tente de novo."));
    }
    match totp_confere(&config.totp_secret, codigo.trim(), agora) {
        Some(passo) if passo > pareamento.ultimo_passo => {
            pareamento.ultimo_passo = passo;
            pareamento.falhas.clear();
            Ok(Json(json!({"token":config.token})))
        }
        // Passo já usado conta como erro: é exatamente a tentativa de reaproveitar um código visto.
        _ => {
            pareamento.falhas.push_back(agora_ms);
            Err(error(StatusCode::UNAUTHORIZED,"Código do Authy não confere. Use o código que está aparecendo agora."))
        }
    }
}

pub fn start(state: Arc<EngineState>) {
    let worker = state.clone();
    tokio::spawn(async move {
        loop {
            worker.mobile.pending.notified().await;
            loop {
                let next = { let mut actions = worker.mobile.actions.lock().expect("actions poisoned");
                    actions.iter_mut().find(|a| a.state == "queued").map(|a| { a.state = "executing".into(); a.clone() }) };
                let Some(action) = next else { break };
                let engine = worker.clone(); let input = action.clone();
                let outcome = tokio::task::spawn_blocking(move || execute(&engine,&input)).await;
                let error = match outcome { Ok(Ok(())) => None, Ok(Err(e)) => Some(e.to_string()), Err(e) => Some(e.to_string()) };
                if let Some(record) = worker.mobile.actions.lock().expect("actions poisoned").iter_mut().find(|a| a.id == action.id) {
                    record.state = if error.is_some() { "rejected" } else { "sent" }.into(); record.error = error;
                }
            }
        }
    });
    tokio::spawn(async move {
        loop {
            let config = state.mobile.config.lock().expect("config poisoned").clone();
            *state.mobile.status.lock().expect("status poisoned") = (None,None);
            if !config.enabled { state.mobile.changed.notified().await; continue; }
            let mut checked = config.clone();
            let resultado = tokio::task::spawn_blocking(move || {
                let trocou = preferir_tailscale(&mut checked);
                (validate(&checked),checked,trocou)
            }).await;
            let (address,config) = match resultado {
                Ok((address,atualizada,trocou)) => {
                    if trocou {
                        // Configuração gravada com loopback (a padrão) se corrige sozinha na subida.
                        let _ = atomic_write_json(&state.state_file.with_file_name("mobile.json"),&atualizada);
                        *state.mobile.config.lock().expect("config poisoned") = atualizada.clone();
                    }
                    (Ok(address),atualizada)
                }
                Err(e) => (Err(e),config),
            };
            let listener = match address {
                Ok(Ok(address)) => TcpListener::bind(address).await.map_err(|e|e.to_string()),
                Ok(Err(e)) => Err(e.to_string()), Err(e) => Err(e.to_string()),
            };
            match listener {
                Ok(listener) => {
                    *state.mobile.status.lock().expect("status poisoned") = (Some(format!("http://{}",config.bind)),None);
                    publicar(&state,&config).await;
                    let shutdown = state.clone();
                    let _ = axum::serve(listener,router(state.clone())).with_graceful_shutdown(async move { shutdown.mobile.changed.notified().await; }).await;
                }
                Err(error) => { *state.mobile.status.lock().expect("status poisoned") = (None,Some(error)); state.mobile.changed.notified().await; }
            }
        }
    });
}

fn router(state: Arc<EngineState>) -> Router {
    Router::new().route("/conversas",get(conversations))
        .route("/projetos",get(projects))
        .route("/conversas/{id}/timeline",get(timeline))
        .route("/conversas/{id}/prompt",post(prompt))
        .route("/conversas/{id}/aprovar",post(approve))
        .route("/atencao",get(attention))
        .route("/sessoes",post(create_session))
        .route("/parear",post(parear))
        .fallback(get(asset)).layer(DefaultBodyLimit::max(32 * 1024))
        .layer(middleware::from_fn_with_state(state.clone(),same_origin)).with_state(state)
}

type ApiError = (StatusCode, Json<Value>);
fn error(status: StatusCode, message: &str) -> ApiError { (status,Json(json!({"error":message}))) }

/// Comparação de tempo constante: `==` em string sai no primeiro byte diferente, e isso vaza o
/// prefixo correto para quem conseguir medir. Três linhas resolvem sem dependência nova.
fn token_confere(recebido: &str, esperado: &str) -> bool {
    recebido.len() == esperado.len()
        && recebido.bytes().zip(esperado.bytes()).fold(0_u8,|acumulado,(a,b)| acumulado | (a ^ b)) == 0
}

/// Hosts aceitos. No modo serve o `Host` que chega é o nome MagicDNS, não o bind de loopback —
/// mas o nome continua sendo uma lista fechada, não um curinga: o check existe para barrar CSRF e
/// DNS rebinding, e aceitar qualquer `Host` desfaria exatamente isso.
fn hosts_aceitos(state: &EngineState) -> (Vec<String>, Vec<String>) {
    let config = state.mobile.config.lock().expect("config poisoned").clone();
    let mut hosts = vec![config.bind.clone()];
    let mut origens = vec![format!("http://{}",config.bind)];
    if config.serve {
        if let Some(nome) = state.mobile.magic_dns.lock().expect("magic poisoned").clone() {
            // O serve termina TLS na 443, então o `Host` chega sem porta.
            hosts.push(nome.clone());
            origens.push(format!("https://{nome}"));
        }
    }
    (hosts,origens)
}

async fn same_origin(State(state): State<Arc<EngineState>>, request: Request, next: Next) -> Response {
    let (hosts,origens) = hosts_aceitos(&state);
    let host = request.headers().get("host").and_then(|v|v.to_str().ok()).unwrap_or("");
    if !hosts.iter().any(|aceito| aceito == host) {
        // A mensagem nomeia a causa real: o Host tem que bater com o bind literal, então abrir pelo
        // nome MagicDNS do Tailscale cai aqui. Afrouxar a checagem não é opção — ela é a defesa
        // contra CSRF e DNS rebinding.
        return error(StatusCode::FORBIDDEN,"Host não permitido; abra pelo IP do Tailscale (100.x.x.x:porta), não pelo nome MagicDNS").into_response();
    }
    if request.method() != axum::http::Method::GET {
        let origin = request.headers().get("origin").and_then(|v|v.to_str().ok()).unwrap_or("");
        if !origens.iter().any(|aceita| aceita == origin) {
            return error(StatusCode::FORBIDDEN,"Origem não permitida").into_response();
        }
    }
    // Token de dispositivo, em cima do Tailscale. Deny-by-default com uma allow-list de duas
    // entradas: o bundle precisa carregar antes de existir token na mão do celular, e todo o resto
    // é API. Rota nova nasce protegida sem ninguém lembrar de protegê-la.
    let token = state.mobile.config.lock().expect("config poisoned").token.clone();
    let path = request.uri().path();
    let publico = caminho_publico(path);
    if !publico && !token.is_empty()
        && !token_confere(request.headers().get("x-omni-token").and_then(|v|v.to_str().ok()).unwrap_or(""),&token) {
        return error(StatusCode::UNAUTHORIZED,"Dispositivo não autorizado; leia o QR de novo no PC").into_response();
    }
    let mut response = next.run(request).await;
    let headers = response.headers_mut();
    headers.insert("cache-control","no-store".parse().unwrap());
    headers.insert("x-content-type-options","nosniff".parse().unwrap());
    headers.insert("referrer-policy","no-referrer".parse().unwrap());
    headers.insert("content-security-policy","default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'".parse().unwrap());
    response
}

fn current(state: &EngineState, id: &str) -> Result<(omni_core::conversations::Conversation, Option<Arc<LiveSession>>), ApiError> {
    let dir = state.state_file.parent().unwrap();
    let conversation = omni_core::conversations::read_index(dir).into_iter().find(|c|c.id == id)
        .ok_or_else(||error(StatusCode::NOT_FOUND,"Conversa não encontrada"))?;
    let session = linked_session(state,&conversation);
    Ok((conversation,session))
}

fn linked_session(state: &EngineState, conversation: &omni_core::conversations::Conversation) -> Option<Arc<LiveSession>> {
    conversation.segments.last().and_then(|segment| {
        let sessions = state.sessions.lock().ok()?;
        let SessionEntry::Live(session) = sessions.get(segment.terminal_session_id.as_deref()?)? else { return None };
        let meta = session.meta.lock().ok()?;
        (meta.conversation_id.as_deref() == Some(conversation.id.as_str()) && meta.profile_id == segment.profile_id && meta.provider.as_deref() == Some(segment.provider.as_str()))
            .then(||session.clone())
    })
}

fn summaries(state: &EngineState) -> Vec<Value> {
    let dir = state.state_file.parent().unwrap();
    let mut index = omni_core::conversations::read_index(dir);
    index.sort_by_key(|c|std::cmp::Reverse(c.created_at_ms));
    index.iter().map(|c| {
        let live = linked_session(state,c);
        let capabilities = live.as_ref().map(interaction::capabilities);
        let status = live.as_ref().map(|s| {
            settle(s).state
        });
        json!({"id":c.id,"title":c.title,"project_id":c.project_id,"provider":c.segments.last().map(|s|&s.provider),
            "profile_id":c.segments.last().and_then(|s|s.profile_id.as_ref()),"state":status,"capabilities":capabilities})
    }).collect()
}

pub fn publish(state: &EngineState, projects: Vec<PublishedProject>, agents: Vec<PublishedAgent>) -> Result<EngineResponse> {
    let published = PublishedWorkspace { projects, agents, published_at_ms: now_ms() };
    atomic_write_json(&state.state_file.with_file_name("workspace.json"),&published)?;
    *state.mobile.workspace.lock().map_err(|_|anyhow!("workspace poisoned"))? = published;
    Ok(EngineResponse::Ok)
}

/// Projetos que o celular pode escolher: os publicados pelo desktop, **mais** os que aparecem em
/// conversas já registradas. A união é o que faz o celular continuar útil quando o desktop nunca
/// publicou (instalação antiga) ou está fechado há muito tempo.
fn known_projects(state: &EngineState) -> Vec<PublishedProject> {
    let dir = state.state_file.parent().unwrap();
    let mut projects = state.mobile.workspace.lock().expect("workspace poisoned").projects.clone();
    for conversation in omni_core::conversations::read_index(dir) {
        if projects.iter().any(|p| p.id == conversation.project_id) { continue }
        let name = Path::new(&conversation.cwd).file_name().map(|n|n.to_string_lossy().into_owned())
            .unwrap_or_else(|| conversation.cwd.clone());
        projects.push(PublishedProject { id: conversation.project_id.clone(), name, path: conversation.cwd.clone() });
    }
    projects
}

async fn projects(State(state): State<Arc<EngineState>>) -> Json<Value> {
    Json(tokio::task::spawn_blocking(move || {
        let dir = state.state_file.parent().unwrap();
        let (agents,published_at_ms) = {
            let workspace = state.mobile.workspace.lock().expect("workspace poisoned");
            (workspace.agents.clone(),workspace.published_at_ms)
        };
        // `config_dir` fica de fora de propósito: é caminho de credencial e o celular não precisa.
        let profiles: Vec<_> = omni_core::profiles(dir).into_iter()
            .map(|p| json!({"id":p.id,"provider":p.provider,"name":p.name})).collect();
        json!({"published_at_ms":published_at_ms,"projects":known_projects(&state),"agents":agents,"profiles":profiles})
    }).await.unwrap_or(json!({"published_at_ms":0,"projects":[],"agents":[],"profiles":[]})))
}

async fn conversations(State(state): State<Arc<EngineState>>) -> Json<Value> {
    Json(tokio::task::spawn_blocking(move || json!(summaries(&state))).await.unwrap_or(json!([])))
}
async fn attention(State(state): State<Arc<EngineState>>) -> Json<Value> {
    Json(tokio::task::spawn_blocking(move || json!(summaries(&state).into_iter().filter(|c|
        c["capabilities"]["approve"] == true || c["capabilities"]["prompt"] == true || c["state"] == "approval_required").collect::<Vec<_>>())).await.unwrap_or(json!([])))
}
#[derive(Deserialize)] struct Page { #[serde(default)] cursor: usize }
async fn timeline(State(state): State<Arc<EngineState>>, RoutePath(id): RoutePath<String>, Query(page): Query<Page>) -> Result<Json<Value>, ApiError> {
    tokio::task::spawn_blocking(move || {
        let (conversation,_) = current(&state,&id)?;
        let dir = state.state_file.parent().unwrap();
        let timeline = omni_core::conversations::timeline(&conversation,&omni_core::profiles(dir),page.cursor,100);
        let actions: Vec<_> = state.mobile.actions.lock().expect("actions poisoned").iter().filter(|a|a.conversation_id == id).cloned().collect();
        Ok(Json(json!({"timeline":timeline,"actions":actions})))
    }).await.map_err(|_|error(StatusCode::INTERNAL_SERVER_ERROR,"Falha ao ler timeline"))?
}
#[derive(Deserialize)] #[serde(deny_unknown_fields)] struct PromptBody { texto: String }
#[derive(Deserialize)] #[serde(deny_unknown_fields)] struct ApprovalBody { permitir: bool }
async fn prompt(State(state): State<Arc<EngineState>>, RoutePath(id): RoutePath<String>, headers: HeaderMap, Json(body): Json<PromptBody>) -> Result<(StatusCode,Json<Value>),ApiError> {
    if body.texto.trim().is_empty() || body.texto.len() > 16_000 || body.texto.chars().any(|c|c.is_control() && c != '\n' && c != '\t') || body.texto.trim_start().starts_with('/') {
        return Err(error(StatusCode::BAD_REQUEST,"Envie texto de até 16000 bytes, sem comandos slash ou caracteres de controle"));
    }
    enqueue_async(state,id,headers,ActionKind::Prompt(body.texto)).await
}
async fn approve(State(state): State<Arc<EngineState>>, RoutePath(id): RoutePath<String>, headers: HeaderMap, Json(body): Json<ApprovalBody>) -> Result<(StatusCode,Json<Value>),ApiError> {
    enqueue_async(state,id,headers,ActionKind::Approval(body.permitir)).await
}
/// `deny_unknown_fields` é peça de segurança, não capricho: um `cwd` contrabandeado no corpo vira
/// **400**, em vez de um campo ignorado em silêncio que dá a falsa impressão de ter sido aceito.
#[derive(Deserialize)] #[serde(deny_unknown_fields)]
struct SpawnBody { project_id: String, provider: String, profile_id: Option<String>, #[serde(default)] titulo: Option<String> }

/// Teto de sessões vivas abertas pelo celular somadas às do desktop. Sem ele, um toque repetido no
/// botão enche o PC de PTYs.
/// ponytail: número fixo; se incomodar, vira configuração na tela de Celular.
const MAX_SESSOES: usize = 16;

/// Resolve o pedido do celular contra o que o servidor já conhece. Nada aqui sai do corpo do
/// request além de escolhas dentro de listas fechadas.
fn resolve_spawn(state: &Arc<EngineState>, body: &SpawnBody) -> Result<SpawnPlan, ApiError> {
    let dir = state.state_file.parent().unwrap();

    let project = known_projects(state).into_iter().find(|p| p.id == body.project_id)
        .ok_or_else(||error(StatusCode::CONFLICT,"Projeto desconhecido; abra o app no PC uma vez para publicar a lista"))?;
    if !Path::new(&project.path).is_dir() {
        return Err(error(StatusCode::CONFLICT,"A pasta do projeto não existe mais neste PC"));
    }

    // O comando vem da lista publicada: o celular escolhe um id, nunca nomeia um binário.
    let agent = state.mobile.workspace.lock().expect("workspace poisoned").agents.iter()
        .find(|a| a.id == body.provider).cloned()
        .ok_or_else(||error(StatusCode::CONFLICT,"CLI não publicada pelo desktop; abra o app no PC uma vez"))?;

    let profiles = omni_core::profiles(dir);
    let profile = match &body.profile_id {
        Some(id) => Some(profiles.iter().find(|p| &p.id == id && p.provider == body.provider)
            .ok_or_else(||error(StatusCode::CONFLICT,"Conta desconhecida para este agente"))?.clone()),
        None => profiles.iter().find(|p| p.provider == body.provider && p.builtin).cloned(),
    };

    let titulo = body.titulo.clone().unwrap_or_else(|| format!("{} · celular",agent.label));
    if titulo.len() > 120 || titulo.chars().any(|c| c.is_control()) {
        return Err(error(StatusCode::BAD_REQUEST,"Título inválido"));
    }

    if state.sessions.lock().expect("sessions poisoned").values()
        .filter(|entry| matches!(entry,SessionEntry::Live(_))).count() >= MAX_SESSOES {
        return Err(error(StatusCode::TOO_MANY_REQUESTS,"Muitas sessões abertas neste PC; feche alguma antes"));
    }

    // Fixar o `--session-id` do Claude aqui é o que torna o caminho do transcript conhecido de
    // imediato — sem isso a timeline do celular ficaria vazia até alguém descobrir o arquivo.
    let (command,external_session_id,transcript_path) = if body.provider == "claude" {
        let session_id = uuid::Uuid::new_v4().to_string();
        let path = profile.as_ref().map(|p| omni_core::conversations::claude_transcript_path(
            Path::new(&p.config_dir),&project.path,&session_id).to_string_lossy().into_owned());
        (format!("{} --session-id {session_id}",agent.command),Some(session_id),path)
    } else {
        (agent.command.clone(),None,None)
    };

    Ok(SpawnPlan {
        project_id: project.id, cwd: project.path, title: titulo, provider: body.provider.clone(),
        profile_id: profile.as_ref().map(|p| p.id.clone()),
        env: profile.as_ref().map(omni_core::env_for).unwrap_or_default(),
        command, external_session_id, transcript_path,
    })
}

async fn create_session(State(state): State<Arc<EngineState>>, headers: HeaderMap, Json(body): Json<SpawnBody>) -> Result<(StatusCode,Json<Value>),ApiError> {
    tokio::task::spawn_blocking(move || {
        let plan = resolve_spawn(&state,&body)?;
        enqueue(&state,"",&headers,ActionKind::Spawn(plan))
    }).await.map_err(|_|error(StatusCode::INTERNAL_SERVER_ERROR,"Falha na fila"))?
}

async fn enqueue_async(state: Arc<EngineState>,id:String,headers:HeaderMap,kind:ActionKind) -> Result<(StatusCode,Json<Value>),ApiError> {
    tokio::task::spawn_blocking(move || enqueue(&state,&id,&headers,kind)).await.map_err(|_|error(StatusCode::INTERNAL_SERVER_ERROR,"Falha na fila"))?
}
fn enqueue(state:&Arc<EngineState>,id:&str,headers:&HeaderMap,kind:ActionKind) -> Result<(StatusCode,Json<Value>),ApiError> {
    let key = headers.get("idempotency-key").and_then(|h|h.to_str().ok()).filter(|s|!s.is_empty() && s.len() <= 128)
        .ok_or_else(||error(StatusCode::BAD_REQUEST,"Idempotency-Key obrigatório"))?;
    let mut actions = state.mobile.actions.lock().expect("actions poisoned");
    if let Some(action) = actions.iter().find(|a| a.key == key) {
        if action.conversation_id != id || action.kind != kind { return Err(error(StatusCode::CONFLICT,"Chave já usada para outra ação")); }
        return Ok((StatusCode::ACCEPTED,Json(json!(action))));
    }
    actions.retain(|a| now_ms().saturating_sub(a.created_at_ms) < 600_000 || a.state == "queued" || a.state == "executing");
    if actions.len() >= 1024 || actions.iter().filter(|a|a.state == "queued").count() >= 128 {
        return Err(error(StatusCode::TOO_MANY_REQUESTS,"Fila cheia; aguarde"));
    }
    // Spawn não tem tela viva para ficar obsoleta: pula `capabilities` e `If-Match`, mas mantém
    // idempotência, limite de fila e expiração — o que impede um toque repetido de abrir duas PTYs.
    if let ActionKind::Spawn(plan) = &kind {
        let action = Action { id: state.next_id(),conversation_id:String::new(),session_id:String::new(),
            state:"queued".into(),created_at_ms:now_ms(),error:None,key:key.into(),revision:String::new(),
            kind:ActionKind::Spawn(plan.clone()) };
        let response = json!(action); actions.push_back(action); drop(actions);
        state.mobile.pending.notify_one();
        return Ok((StatusCode::ACCEPTED,Json(response)));
    }
    let (_,session) = current(state,id)?;
    let session = session.ok_or_else(||error(StatusCode::CONFLICT,"Nenhuma sessão existente para esta conversa"))?;
    let capability = interaction::capabilities(&session);
    let supported = match kind { ActionKind::Prompt(_) => capability.prompt, ActionKind::Approval(_) => capability.approve, ActionKind::Spawn(_) => false };
    if !supported { return Err(error(StatusCode::CONFLICT,"Sessão ocupada ou tela não reconhecida; atualize o status")); }
    if headers.get("if-match").and_then(|h|h.to_str().ok()) != Some(capability.revision.as_str()) {
        return Err(error(StatusCode::PRECONDITION_FAILED,"O contexto mudou; atualize antes de responder"));
    }
    let session_id = session.meta.lock().expect("metadata poisoned").id.clone();
    let action = Action { id: state.next_id(),conversation_id:id.into(),session_id,state:"queued".into(),created_at_ms:now_ms(),error:None,key:key.into(),revision:capability.revision,kind };
    let response = json!(action); actions.push_back(action); drop(actions);
    state.mobile.pending.notify_one();
    Ok((StatusCode::ACCEPTED,Json(response)))
}

fn execute(state:&Arc<EngineState>, action:&Action) -> Result<()> {
    match &action.kind {
        ActionKind::Spawn(plan) => spawn_from_mobile(state,action,plan),
        _ => execute_checked(state,action,interaction::provider_running),
    }
}

/// Abre a sessão que o celular pediu e registra a conversa que vai dar a timeline dela.
///
/// A conversa é criada **aqui** e não no desktop porque a janela pode estar fechada — é justamente
/// esse o caso de uso. Sem a conversa, a sessão existiria mas o celular não teria o que ler.
fn spawn_from_mobile(state:&Arc<EngineState>, action:&Action, plan:&SpawnPlan) -> Result<()> {
    if now_ms().saturating_sub(action.created_at_ms) >= 60_000 { return Err(anyhow!("Ação expirada")); }
    let dir = state.state_file.parent().unwrap().to_path_buf();

    let conversation = omni_core::conversations::Conversation {
        id: format!("conv-{}",uuid::Uuid::new_v4()),
        project_id: plan.project_id.clone(),
        cwd: plan.cwd.clone(),
        title: plan.title.clone(),
        created_at_ms: now_ms(),
        segments: vec![omni_core::conversations::Segment {
            provider: plan.provider.clone(),
            profile_id: plan.profile_id.clone(),
            external_session_id: plan.external_session_id.clone(),
            transcript_path: plan.transcript_path.clone(),
            terminal_session_id: None,
            started_at_ms: now_ms(),
            ended_at_ms: None,
        }],
    };

    let session = spawn_terminal_inner(
        state,
        state.next_id(),
        plan.project_id.clone(),
        plan.title.clone(),
        plan.cwd.clone(),
        None,
        Some(plan.command.clone()),
        // A PTY nasce sem ninguém olhando; o desktop redimensiona quando anexar a aba.
        // ponytail: tamanho fixo, suficiente até alguém reclamar.
        30,
        120,
        now_ms(),
        SessionOrigin {
            // Aberta sem nenhum terminal exibindo: o engine responde o `ESC[6n` do ConPTY.
            headless: true,
            env: plan.env.clone(),
            provider: Some(plan.provider.clone()),
            profile_id: plan.profile_id.clone(),
            conversation_id: Some(conversation.id.clone()),
            external_session_id: plan.external_session_id.clone(),
        },
    )?;

    // Grava a conversa só depois do spawn dar certo: falhou, não fica conversa órfã na lista.
    let mut index = omni_core::conversations::read_index(&dir);
    let mut conversation = conversation;
    conversation.segments[0].terminal_session_id = Some(session.id.clone());
    index.push(conversation);
    omni_core::conversations::write_index(&dir,&index)?;
    Ok(())
}

fn execute_checked(state:&Arc<EngineState>, action:&Action, is_running: impl Fn(Option<u32>, &str) -> bool) -> Result<()> {
    if now_ms().saturating_sub(action.created_at_ms) >= 60_000 { return Err(anyhow!("Ação expirada")); }
    let (_,current_session) = current(state,&action.conversation_id).map_err(|_|anyhow!("Conversa removida"))?;
    let session = current_session.ok_or_else(||anyhow!("Sessão encerrada"))?;
    // Hold the sessions registry through validation/write so close cannot replace this session.
    let sessions = state.sessions.lock().map_err(|_|anyhow!("sessions poisoned"))?;
    if !matches!(sessions.get(&action.session_id),Some(SessionEntry::Live(s)) if Arc::ptr_eq(s,&session)) { return Err(anyhow!("Sessão trocada")); }
    let mut context = session.interaction.lock().map_err(|_|anyhow!("screen poisoned"))?;
    if session.reserved.load(Ordering::SeqCst) || context.revision(&session) != action.revision { return Err(anyhow!("Contexto mudou antes da execução")); }
    let meta = session.meta.lock().map_err(|_|anyhow!("metadata poisoned"))?.clone();
    let provider = meta.provider.as_deref().unwrap_or("");
    if !is_running(meta.pid,provider) { return Err(anyhow!("CLI não está mais ativo")); }
    let data = match &action.kind {
        ActionKind::Prompt(text) if interaction::ready(context.parser.screen(),provider) => format!("\x1b[200~{text}\x1b[201~\r"),
        ActionKind::Approval(allow) => { let dialog = interaction::approval(&context.parser.screen().contents(),provider).ok_or_else(||anyhow!("Aprovação não reconhecida"))?; if *allow { dialog.0 } else { dialog.1 } },
        _ => return Err(anyhow!("Entrada não está disponível")),
    };
    context.input_revision += 1;
    let mut writer = session.writer.lock().map_err(|_|anyhow!("writer poisoned"))?;
    writer.write_all(data.as_bytes())?; writer.flush()?;
    Ok(())
}

/// Caminhos servidos sem código de acesso. Lista **fechada**, não prefixo: todo o resto é API e nasce
/// protegido.
///
/// Ícones e manifest precisam estar aqui porque o navegador os busca **sozinho**, sem o
/// `X-Omni-Token` — ao adicionar à tela inicial, e antes mesmo de o JavaScript rodar. Antes eles
/// caíam no 401 e o celular ficava sem ícone.
// `/parear` é pública porque quem chama ainda não tem token; quem a protege é a trava de tentativas.
const ARQUIVOS_PUBLICOS: [&str; 6] =
    ["/manifest.webmanifest", "/apple-touch-icon.png", "/icon-192.png", "/icon-512.png", "/favicon.png", "/parear"];

fn caminho_publico(path: &str) -> bool {
    path == "/" || path.starts_with("/assets/") || ARQUIVOS_PUBLICOS.contains(&path)
}

/// `nosniff` está ligado em toda resposta, então o tipo tem de estar certo: ícone ou manifest
/// servidos como `application/octet-stream` são ignorados pelo celular.
fn tipo_do_arquivo(path: &str) -> &'static str {
    match path.rsplit('.').next().unwrap_or("") {
        "html" => "text/html; charset=utf-8",
        "js" => "text/javascript; charset=utf-8",
        "css" => "text/css; charset=utf-8",
        "png" => "image/png",
        "webmanifest" => "application/manifest+json",
        _ => "application/octet-stream",
    }
}

async fn asset(request: Request) -> Response {
    let path = request.uri().path().trim_start_matches('/');
    let path = if path.is_empty() { "index.html" } else { path };
    #[cfg(mobile_assets)]
    if let Some(file) = ASSETS.get_file(path) {
        return ([("content-type",tipo_do_arquivo(path))],file.contents()).into_response();
    }
    let _ = path;
    (StatusCode::NOT_FOUND,"Página não encontrada; em desenvolvimento, execute npm run build:mobile antes de compilar o engine").into_response()
}

#[cfg(test)]
mod tests {
    use super::*;
    use tower::ServiceExt;
    use axum::body::{Body,to_bytes};

    fn fixture() -> (tempfile::TempDir, Arc<EngineState>) {
        let dir = tempfile::tempdir().unwrap();
        let state = Arc::new(EngineState { persist_lock:Mutex::new(()),mobile:MobileRuntime::new(dir.path()),
            token:"test-only".into(),state_file:dir.path().join("sessions.json"),sessions:Mutex::new(HashMap::new()),id_sequence:AtomicU64::new(1) });
        atomic_write_json(&dir.path().join("conversations.json"),&json!({"version":1,"conversations":[{
            "id":"c","project_id":"p","cwd":"C:/test","title":"Teste","created_at_ms":1,"segments":[]
        }]})).unwrap();
        (dir,state)
    }

    /// Local visual harness: no real profiles, credentials, sessions or user data.
    #[tokio::test]
    #[ignore = "Run explicitly while checking the mobile UI in a browser (3 minutes)"]
    async fn browser_fixture() {
        let (_dir,state) = fixture();
        *state.mobile.config.lock().unwrap() = MobileConfig{enabled:true,bind:"127.0.0.1:47329".into(),token:"fixture-token".into(),serve:false,totp_secret:String::new(),totp_confirmed:false};
        let listener = TcpListener::bind("127.0.0.1:47329").await.unwrap();
        let stop = Arc::new(Notify::new());
        let notify = stop.clone();
        let app = router(state).route("/__test_stop",post(move || { let notify = notify.clone(); async move { notify.notify_one(); StatusCode::OK } }));
        axum::serve(listener,app).with_graceful_shutdown(async move {
            tokio::select! { _ = stop.notified() => {}, _ = tokio::time::sleep(std::time::Duration::from_secs(180)) => {} }
        }).await.unwrap();
    }
    fn req(method:&str, uri:&str, origin:&str, body:&str) -> Request {
        Request::builder().method(method).uri(uri).header("host","127.0.0.1:47322").header("origin",origin)
            .header("content-type","application/json").header("idempotency-key","test-key").body(Body::from(body.to_owned())).unwrap()
    }

    /// O celular pode abrir sessão, mas **só** escolhendo dentro de listas que o servidor já
    /// conhece. Cada asserção aqui corresponde a uma forma de tentar escapar disso.
    #[tokio::test] async fn http_so_abre_sessao_dentro_do_que_ja_e_conhecido() {
        let (_dir,state) = fixture();
        publish(&state,
            vec![PublishedProject{id:"p".into(),name:"Teste".into(),path:"C:/test".into()}],
            vec![PublishedAgent{id:"claude".into(),label:"Claude".into(),command:"claude".into(),resume:None}],
        ).unwrap();
        let app = router(state.clone());
        let post = |corpo:&str| req("POST","/sessoes","http://127.0.0.1:47322",corpo);

        // Caminho vindo do celular: recusado como campo desconhecido, não ignorado em silêncio.
        // 422 é o que o axum devolve quando o corpo não desserializa — o que importa é que
        // `deny_unknown_fields` transforma o `cwd` contrabandeado em recusa, não em campo ignorado.
        assert_eq!(app.clone().oneshot(post(r#"{"project_id":"p","provider":"claude","cwd":"C:/Windows"}"#)).await.unwrap().status(),
            StatusCode::UNPROCESSABLE_ENTITY);
        // Binário escolhido pelo celular: só vale o que o desktop publicou.
        assert_eq!(app.clone().oneshot(post(r#"{"project_id":"p","provider":"bash"}"#)).await.unwrap().status(),
            StatusCode::CONFLICT);
        // Projeto que o servidor não conhece.
        assert_eq!(app.clone().oneshot(post(r#"{"project_id":"inventado","provider":"claude"}"#)).await.unwrap().status(),
            StatusCode::CONFLICT);
        // Conta que não existe para esse agente.
        assert_eq!(app.clone().oneshot(post(r#"{"project_id":"p","provider":"claude","profile_id":"nao-existe"}"#)).await.unwrap().status(),
            StatusCode::CONFLICT);

        assert!(state.sessions.lock().unwrap().is_empty(),"nenhuma recusa pode ter aberto PTY");
    }

    #[test] fn o_plano_de_spawn_tira_o_caminho_do_registro_do_servidor() {
        let (_dir,state) = fixture();
        publish(&state,
            vec![PublishedProject{id:"p".into(),name:"Teste".into(),path:".".into()}],
            vec![PublishedAgent{id:"claude".into(),label:"Claude".into(),command:"claude".into(),resume:None}],
        ).unwrap();
        let plan = resolve_spawn(&state,&SpawnBody{
            project_id:"p".into(),provider:"claude".into(),profile_id:None,titulo:None,
        }).expect("deveria resolver");
        assert_eq!(plan.cwd,".","o cwd sai do projeto publicado");
        assert!(plan.command.starts_with("claude --session-id "),
            "o comando sai da CLI publicada e ja fixa o id da sessao: {}",plan.command);
        assert!(plan.external_session_id.is_some(),"sem id fixo a timeline do celular nasceria vazia");
    }

    #[tokio::test] async fn concurrent_readers_and_no_privileged_http_surface() {
        let (_dir,state) = fixture();
        let app = router(state.clone());
        let (a,b) = tokio::join!(app.clone().oneshot(req("GET","/conversas","","")),app.clone().oneshot(req("GET","/atencao","","")));
        assert_eq!(a.unwrap().status(),StatusCode::OK); assert_eq!(b.unwrap().status(),StatusCode::OK);
        let response = app.clone().oneshot(req("GET","/conversas/c/timeline","","")).await.unwrap();
        let data:Value = serde_json::from_slice(&to_bytes(response.into_body(),1_000_000).await.unwrap()).unwrap();
        assert_eq!(data["timeline"]["messages"],json!([]));
        let response = app.clone().oneshot(req("POST","/conversas/c/prompt","http://127.0.0.1:47322",r#"{"texto":"oi"}"#)).await.unwrap();
        assert_eq!(response.status(),StatusCode::CONFLICT);
        assert!(state.sessions.lock().unwrap().is_empty(),"HTTP must not spawn a terminal");
        assert_ne!(app.oneshot(req("POST","/spawn_terminal","http://127.0.0.1:47322","{}")).await.unwrap().status(),StatusCode::OK);
    }
    #[tokio::test] async fn foreign_origin_unknown_conversation_and_invalid_prompt_are_rejected() {
        let (_dir,state) = fixture(); let app = router(state);
        assert_eq!(app.clone().oneshot(req("POST","/conversas/c/prompt","https://evil.example",r#"{"texto":"oi"}"#)).await.unwrap().status(),StatusCode::FORBIDDEN);
        assert_eq!(app.clone().oneshot(req("GET","/conversas/missing/timeline","","")).await.unwrap().status(),StatusCode::NOT_FOUND);
        assert_eq!(app.oneshot(req("POST","/conversas/c/prompt","http://127.0.0.1:47322",r#"{"texto":"/exit"}"#)).await.unwrap().status(),StatusCode::BAD_REQUEST);
    }
    #[test] fn idempotent_retry_does_not_need_a_live_session_or_enqueue_again() {
        let (_dir,state) = fixture();
        state.mobile.actions.lock().unwrap().push_back(Action { id:"a".into(),conversation_id:"c".into(),session_id:"gone".into(),state:"sent".into(),created_at_ms:now_ms(),error:None,key:"test-key".into(),revision:"old".into(),kind:ActionKind::Prompt("oi".into()) });
        let headers = req("POST","/conversas/c/prompt","http://127.0.0.1:47322","").headers().clone();
        assert_eq!(enqueue(&state,"c",&headers,ActionKind::Prompt("oi".into())).unwrap().0,StatusCode::ACCEPTED);
        assert_eq!(state.mobile.actions.lock().unwrap().len(),1);
        assert_eq!(enqueue(&state,"c",&headers,ActionKind::Prompt("outro".into())).unwrap_err().0,StatusCode::CONFLICT);
        let mut action = state.mobile.actions.lock().unwrap()[0].clone();
        action.created_at_ms = now_ms().saturating_sub(60_001);
        assert!(execute(&state,&action).unwrap_err().to_string().contains("expirada"));
    }
    /// O bundle tem de carregar antes de o celular ter token; a API, não. Se esta asserção inverter,
    /// ou o celular não consegue nem abrir a página, ou qualquer um na tailnet lê as conversas.
    #[tokio::test] async fn token_de_dispositivo_protege_a_api_e_libera_o_bundle() {
        let (_dir,state) = fixture();
        state.mobile.config.lock().unwrap().token = "segredo".into();
        let app = router(state);
        let com_token = |valor:&str| {
            Request::builder().method("GET").uri("/conversas").header("host","127.0.0.1:47322")
                .header("x-omni-token",valor).body(Body::empty()).unwrap()
        };
        assert_eq!(app.clone().oneshot(req("GET","/conversas","","")).await.unwrap().status(),StatusCode::UNAUTHORIZED);
        assert_eq!(app.clone().oneshot(com_token("segred")).await.unwrap().status(),StatusCode::UNAUTHORIZED);
        assert_eq!(app.clone().oneshot(com_token("segredx")).await.unwrap().status(),StatusCode::UNAUTHORIZED);
        assert_eq!(app.clone().oneshot(com_token("segredo")).await.unwrap().status(),StatusCode::OK);
        assert_ne!(app.oneshot(req("GET","/","","")).await.unwrap().status(),StatusCode::UNAUTHORIZED);
    }

    #[test] fn habilitar_gera_token_e_o_desktop_nao_escolhe_o_segredo() {
        let (_dir,state) = fixture();
        let forjado = MobileConfig{enabled:true,bind:"127.0.0.1:47322".into(),token:"escolhido-pelo-desktop".into(),serve:false,totp_secret:String::new(),totp_confirmed:false};
        settings(&state,Some(forjado),false).unwrap();
        let gerado = state.mobile.config.lock().unwrap().token.clone();
        assert_eq!(gerado.len(),64,"32 bytes em hex");
        assert_ne!(gerado,"escolhido-pelo-desktop");

        // Salvar de novo preserva o token: só `rotate` troca, senão todo "Aplicar" desparearia o celular.
        settings(&state,Some(MobileConfig{enabled:true,bind:"127.0.0.1:47322".into(),token:String::new(),serve:false,totp_secret:String::new(),totp_confirmed:false}),false).unwrap();
        assert_eq!(state.mobile.config.lock().unwrap().token,gerado);
        settings(&state,Some(MobileConfig{enabled:true,bind:"127.0.0.1:47322".into(),token:String::new(),serve:false,totp_secret:String::new(),totp_confirmed:false}),true).unwrap();
        assert_ne!(state.mobile.config.lock().unwrap().token,gerado);
    }

    /// A união com o `conversations.json` é o que mantém o celular útil quando o desktop nunca
    /// publicou ou está fechado há muito tempo. Sem ela, um app recém-instalado mostraria zero
    /// projetos até alguém abrir a janela no PC.
    #[tokio::test] async fn projetos_publicados_se_unem_aos_das_conversas() {
        let (_dir,state) = fixture();
        publish(&state,
            vec![PublishedProject{id:"publicado".into(),name:"Publicado".into(),path:"C:/pub".into()}],
            vec![PublishedAgent{id:"claude".into(),label:"Claude".into(),command:"claude".into(),resume:Some("--continue".into())}],
        ).unwrap();

        let response = router(state).oneshot(req("GET","/projetos","","")).await.unwrap();
        assert_eq!(response.status(),StatusCode::OK);
        let data:Value = serde_json::from_slice(&to_bytes(response.into_body(),1_000_000).await.unwrap()).unwrap();

        let ids:Vec<_> = data["projects"].as_array().unwrap().iter().map(|p|p["id"].as_str().unwrap()).collect();
        assert!(ids.contains(&"publicado"));
        assert!(ids.contains(&"p"),"o projeto da conversa do fixture tem de entrar: {ids:?}");
        assert!(data["published_at_ms"].as_u64().unwrap() > 0);
        assert_eq!(data["agents"][0]["resume"],"--continue");
    }

    #[test] fn publicacao_sobrevive_ao_reinicio_do_engine() {
        let (dir,state) = fixture();
        publish(&state,vec![PublishedProject{id:"p1".into(),name:"Um".into(),path:"C:/um".into()}],vec![]).unwrap();
        // Um `MobileRuntime` novo é o que o engine monta ao subir de novo.
        let renascido = MobileRuntime::new(dir.path());
        assert_eq!(renascido.workspace.lock().unwrap().projects[0].id,"p1");
    }

    /// Com o Serve ligado o `Host` que chega é o nome MagicDNS, não o bind. Aceitar esse nome não
    /// pode virar "aceitar qualquer Host": a checagem existe para barrar CSRF e DNS rebinding.
    #[tokio::test] async fn serve_aceita_o_nome_magicdns_e_mais_nenhum() {
        let (_dir,state) = fixture();
        *state.mobile.config.lock().unwrap() =
            MobileConfig{enabled:true,bind:"127.0.0.1:47322".into(),token:String::new(),serve:true,totp_secret:String::new(),totp_confirmed:false};
        *state.mobile.magic_dns.lock().unwrap() = Some("pc.tail0000.ts.net".into());
        let app = router(state);
        let get = |host:&str| Request::builder().method("GET").uri("/conversas")
            .header("host",host).body(Body::empty()).unwrap();

        assert_eq!(app.clone().oneshot(get("pc.tail0000.ts.net")).await.unwrap().status(),StatusCode::OK);
        assert_eq!(app.clone().oneshot(get("127.0.0.1:47322")).await.unwrap().status(),StatusCode::OK);
        assert_eq!(app.clone().oneshot(get("evil.example")).await.unwrap().status(),StatusCode::FORBIDDEN);
        // Sufixo parecido não basta: a comparação é igualdade, não "termina com".
        assert_eq!(app.oneshot(get("mal.pc.tail0000.ts.net")).await.unwrap().status(),StatusCode::FORBIDDEN);
    }

    #[test] fn serve_exige_loopback_no_bind() {
        // Escutar num IP roteável **e** publicar pelo Serve dobraria a superfície sem serventia.
        assert!(validate(&MobileConfig{enabled:true,bind:"100.64.0.1:47322".into(),token:String::new(),serve:true,totp_secret:String::new(),totp_confirmed:false}).is_err());
        assert!(validate(&MobileConfig{enabled:true,bind:"127.0.0.1:47322".into(),token:String::new(),serve:true,totp_secret:String::new(),totp_confirmed:false}).is_ok());
    }

    /// O QR com `127.0.0.1` abria no PC e falhava no 4G. Com Tailscale no ar, o modo direto troca o
    /// loopback pelo IP dele; nos outros casos não mexe em nada.
    #[test] fn modo_direto_troca_loopback_pelo_ip_do_tailscale() {
        let ts: IpAddr = "100.94.187.72".parse().unwrap();
        let config = |bind:&str,serve:bool| MobileConfig{enabled:true,bind:bind.into(),token:String::new(),serve,totp_secret:String::new(),totp_confirmed:false};

        let mut padrao = config("127.0.0.1:47322",false);
        assert!(preferir_ip(&mut padrao,Some(ts)));
        assert_eq!(padrao.bind,"100.94.187.72:47322","troca o IP e mantém a porta");

        // Sem Tailscale não há para onde trocar: fica em loopback e a tela explica.
        let mut sem_tailscale = config("127.0.0.1:47322",false);
        assert!(!preferir_ip(&mut sem_tailscale,None));
        assert_eq!(sem_tailscale.bind,"127.0.0.1:47322");

        // O Serve exige loopback de propósito.
        let mut serve = config("127.0.0.1:47322",true);
        assert!(!preferir_ip(&mut serve,Some(ts)));
        assert_eq!(serve.bind,"127.0.0.1:47322");

        // Endereço já roteável escolhido pela pessoa não é sobrescrito.
        let mut escolhido = config("100.64.0.9:47322",false);
        assert!(!preferir_ip(&mut escolhido,Some(ts)));
        assert_eq!(escolhido.bind,"100.64.0.9:47322");
    }

    /// Saída real do `tailscale serve --bg` com o Serve desabilitado, capturada depois de matar o
    /// processo — ele não sai sozinho. O link tem de sobreviver até a tela.
    #[test] fn link_de_liberacao_sai_da_saida_do_serve() {
        let saida = "Serve is not enabled on your tailnet.\nTo enable, visit:\n\n         https://login.tailscale.com/f/serve?node=nEXEMPLO0000CNTRL\n";
        assert_eq!(motivo_do_serve(saida),"https://login.tailscale.com/f/serve?node=nEXEMPLO0000CNTRL");
        assert_eq!(motivo_do_serve("   "),"O Tailscale não respondeu.");
        assert_eq!(motivo_do_serve("access denied"),"access denied");
    }

    /// O celular busca ícone e manifest sem o código de acesso. Se caírem no 401, o app fica sem ícone.
    #[tokio::test] async fn icone_e_manifest_carregam_sem_codigo_mas_a_api_nao() {
        let (_dir,state) = fixture();
        state.mobile.config.lock().unwrap().token = "segredo".into();
        let app = router(state);
        for publico in ["/manifest.webmanifest","/apple-touch-icon.png","/icon-192.png","/icon-512.png","/favicon.png"] {
            assert_ne!(app.clone().oneshot(req("GET",publico,"","")).await.unwrap().status(),StatusCode::UNAUTHORIZED,
                "{publico} precisa carregar sem código");
        }
        // Lista fechada: nome parecido não passa, e a API segue protegida.
        assert_eq!(app.clone().oneshot(req("GET","/icon-192.png/../conversas","","")).await.unwrap().status(),StatusCode::UNAUTHORIZED);
        assert_eq!(app.oneshot(req("GET","/conversas","","")).await.unwrap().status(),StatusCode::UNAUTHORIZED);
    }

    #[test] fn tipos_de_arquivo_que_o_celular_exige() {
        assert_eq!(tipo_do_arquivo("apple-touch-icon.png"),"image/png");
        assert_eq!(tipo_do_arquivo("manifest.webmanifest"),"application/manifest+json");
        assert_eq!(tipo_do_arquivo("assets/index-abc.js"),"text/javascript; charset=utf-8");
    }

    /// "12345678901234567890" em base32 — o segredo dos vetores oficiais do RFC 6238.
    const SEGREDO_RFC: &str = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";

    fn codigo_em(segundos: u64) -> String { totp_de(SEGREDO_RFC,None).unwrap().generate(segundos) }

    /// Vetor oficial do RFC 6238 (SHA-1, T=59 → 94287082; 6 dígitos → 287082). Se isto falhar, o
    /// Authy e o engine discordam de todo código.
    #[test] fn totp_bate_com_o_vetor_do_rfc_6238() {
        assert_eq!(codigo_em(59),"287082");
        assert_eq!(totp_confere(SEGREDO_RFC,"287082",59),Some(1));
    }

    #[test] fn totp_tolera_um_passo_de_relogio_e_nao_dois() {
        let codigo = codigo_em(59); // passo 1
        assert_eq!(totp_confere(SEGREDO_RFC,&codigo,60),Some(1),"relógio um passo à frente ainda vale");
        assert_eq!(totp_confere(SEGREDO_RFC,&codigo,90),None,"dois passos já não vale");
        assert_eq!(totp_confere(SEGREDO_RFC,"12345",59),None);
        assert_eq!(totp_confere(SEGREDO_RFC,"28708a",59),None);
    }

    fn com_authy_confirmado() -> (tempfile::TempDir, Arc<EngineState>) {
        let (dir,state) = fixture();
        {
            let mut config = state.mobile.config.lock().unwrap();
            config.token = "token-do-aparelho".into();
            config.totp_secret = SEGREDO_RFC.into();
            config.totp_confirmed = true;
        }
        (dir,state)
    }

    #[test] fn pareamento_entrega_o_token_uma_vez_por_codigo() {
        let (_dir,state) = com_authy_confirmado();
        let agora = 30 * 1_000_000;
        let codigo = codigo_em(agora);
        let resposta = parear_em(&state,&codigo,agora).expect("código atual deveria parear");
        assert_eq!(resposta.0["token"],"token-do-aparelho");
        // O mesmo código de novo é o cenário "vi por cima do ombro": recusado.
        assert_eq!(parear_em(&state,&codigo,agora).unwrap_err().0,StatusCode::UNAUTHORIZED);
    }

    #[test] fn pareamento_trava_depois_de_cinco_erros() {
        let (_dir,state) = com_authy_confirmado();
        let agora = 30 * 2_000_000;
        for _ in 0..MAX_FALHAS {
            assert_eq!(parear_em(&state,"000000",agora).unwrap_err().0,StatusCode::UNAUTHORIZED);
        }
        // Travado: nem o código certo passa até a janela acabar.
        assert_eq!(parear_em(&state,&codigo_em(agora),agora).unwrap_err().0,StatusCode::TOO_MANY_REQUESTS);
        let depois = agora + TRAVA_MS / 1000 + 30;
        assert!(parear_em(&state,&codigo_em(depois),depois).is_ok(),"a trava tem de acabar sozinha");
    }

    #[test] fn pareamento_recusa_sem_authy_confirmado() {
        let (_dir,state) = fixture();
        state.mobile.config.lock().unwrap().totp_secret = SEGREDO_RFC.into();
        assert_eq!(parear_em(&state,&codigo_em(59),59).unwrap_err().0,StatusCode::CONFLICT);
    }

    /// Rota pública (quem pareia ainda não tem token), mas sob a mesma checagem de Host e Origin.
    #[tokio::test] async fn parear_nao_exige_token_mas_exige_origem() {
        let (_dir,state) = com_authy_confirmado();
        let app = router(state);
        let corpo = r#"{"codigo":"000000"}"#;
        let status = app.clone().oneshot(req("POST","/parear","http://127.0.0.1:47322",corpo)).await.unwrap().status();
        assert_eq!(status,StatusCode::UNAUTHORIZED,"401 aqui é do código errado, não do token ausente");
        let sem_origem = app.oneshot(req("POST","/parear","https://evil.example",corpo)).await.unwrap().status();
        assert_eq!(sem_origem,StatusCode::FORBIDDEN);
    }

    #[test] fn desktop_nao_confirma_o_authy_nem_troca_o_segredo() {
        let (_dir,state) = fixture();
        totp(&state,TotpAction::Reset).unwrap();
        let segredo = state.mobile.config.lock().unwrap().totp_secret.clone();
        assert!(!segredo.is_empty());

        let forjado = MobileConfig{enabled:false,bind:"127.0.0.1:47322".into(),token:String::new(),serve:false,
            totp_secret:"FORJADO".into(),totp_confirmed:true};
        let EngineResponse::MobileSettings{totp_confirmed,totp_uri,..} = settings(&state,Some(forjado),false).unwrap() else { panic!() };
        assert!(!totp_confirmed,"confirmar só com código do Authy");
        assert!(totp_uri.is_some_and(|uri| uri.starts_with("otpauth://totp/")),"antes de confirmar o QR do Authy aparece");
        assert_eq!(state.mobile.config.lock().unwrap().totp_secret,segredo);
    }

    #[test] fn qr_do_authy_some_depois_de_confirmado() {
        let (_dir,state) = fixture();
        totp(&state,TotpAction::Reset).unwrap();
        let segredo = state.mobile.config.lock().unwrap().totp_secret.clone();
        let codigo = totp_de(&segredo,None).unwrap().generate(agora_segundos());
        let EngineResponse::MobileSettings{totp_confirmed,totp_uri,..} = totp(&state,TotpAction::Confirm{code:codigo}).unwrap() else { panic!() };
        assert!(totp_confirmed);
        assert!(totp_uri.is_none(),"depois de confirmado o segredo não sai mais do engine");
    }

    #[test] fn loopback_default_and_no_wildcard() {
        let config = MobileConfig::default(); assert!(!config.enabled); assert!(validate(&config).is_ok());
        assert!(validate(&MobileConfig{enabled:true,bind:"0.0.0.0:47322".into(),token:String::new(),serve:false,totp_secret:String::new(),totp_confirmed:false}).is_err());
        assert!(validate(&MobileConfig{enabled:true,bind:"127.0.0.1:47321".into(),token:String::new(),serve:false,totp_secret:String::new(),totp_confirmed:false}).is_err());
    }

    #[cfg(windows)]
    mod actions {
        use super::*;
        #[derive(Debug)] struct FakeChild;
        impl portable_pty::ChildKiller for FakeChild {
            fn kill(&mut self) -> std::io::Result<()> { Ok(()) }
            fn clone_killer(&self) -> Box<dyn portable_pty::ChildKiller + Send + Sync> { Box::new(FakeChild) }
        }
        impl Child for FakeChild {
            fn try_wait(&mut self) -> std::io::Result<Option<portable_pty::ExitStatus>> { Ok(None) }
            fn wait(&mut self) -> std::io::Result<portable_pty::ExitStatus> { Ok(portable_pty::ExitStatus::with_exit_code(0)) }
            fn process_id(&self) -> Option<u32> { Some(42) }
            fn as_raw_handle(&self) -> Option<std::os::windows::io::RawHandle> { None }
        }
        struct FakeMaster;
        impl MasterPty for FakeMaster {
            fn resize(&self,_:PtySize) -> Result<()> { Ok(()) }
            fn get_size(&self) -> Result<PtySize> { Ok(PtySize{rows:20,cols:100,pixel_width:0,pixel_height:0}) }
            fn try_clone_reader(&self) -> Result<Box<dyn Read + Send>> { Ok(Box::new(std::io::empty())) }
            fn take_writer(&self) -> Result<Box<dyn Write + Send>> { Ok(Box::new(std::io::sink())) }
        }
        struct RecordingWriter(Arc<Mutex<Vec<u8>>>);
        impl Write for RecordingWriter {
            fn write(&mut self,bytes:&[u8]) -> std::io::Result<usize> { self.0.lock().unwrap().extend_from_slice(bytes); Ok(bytes.len()) }
            fn flush(&mut self) -> std::io::Result<()> { Ok(()) }
        }
        fn fake_session(state:&Arc<EngineState>,text:&str) -> (Arc<LiveSession>,Arc<Mutex<Vec<u8>>>,Action) {
            let bytes = Arc::new(Mutex::new(Vec::new()));
            let meta:TerminalSession = serde_json::from_value(json!({"id":"s","project_id":"p","name":"Test","cwd":"C:/test","shell":"test",
                "state":"answered","pid":42,"created_at_ms":1,"last_activity_at_ms":1,"output_seq":0,"rows":20,"cols":100,
                "provider":"claude","profile_id":"profile","conversation_id":"c"})).unwrap();
            let mut context = interaction::Interaction::new(20,100); context.parser.process(b"\x1b[?2004h"); context.parser.process(text.as_bytes());
            let session = Arc::new(LiveSession{interaction:Mutex::new(context),reserved:std::sync::atomic::AtomicBool::new(false),headless:std::sync::atomic::AtomicBool::new(false),
                meta:Mutex::new(meta),writer:Mutex::new(Box::new(RecordingWriter(bytes.clone()))),master:Mutex::new(Box::new(FakeMaster)),
                child:Mutex::new(Box::new(FakeChild)),output:Mutex::new(OutputBuffer{chunks:VecDeque::new(),bytes:0,next_seq:0})});
            state.sessions.lock().unwrap().insert("s".into(),SessionEntry::Live(session.clone()));
            atomic_write_json(&state.state_file.with_file_name("conversations.json"),&json!({"version":1,"conversations":[{
                "id":"c","project_id":"p","cwd":"C:/test","title":"Test","created_at_ms":1,
                "segments":[{"provider":"claude","profile_id":"profile","terminal_session_id":"s","started_at_ms":1}]
            }]})).unwrap();
            let revision = session.interaction.lock().unwrap().revision(&session);
            let action = Action{id:"a".into(),conversation_id:"c".into(),session_id:"s".into(),state:"queued".into(),created_at_ms:now_ms(),error:None,key:"key".into(),revision,kind:ActionKind::Prompt("Olá\nmundo".into())};
            (session,bytes,action)
        }
        #[test] fn sends_one_atomic_bracketed_prompt_and_invalidates_revision() {
            let (_dir,state) = fixture(); let (_session,bytes,action) = fake_session(&state,"Claude Code\r\n❯ ");
            execute_checked(&state,&action,|_,_|true).unwrap();
            assert_eq!(&*bytes.lock().unwrap(),"\x1b[200~Olá\nmundo\x1b[201~\r".as_bytes());
            assert!(execute_checked(&state,&action,|_,_|true).is_err());
        }
        #[test] fn rejects_desktop_input_closed_cli_and_stale_dialog_without_writing() {
            let (_dir,state) = fixture(); let (session,bytes,mut action) = fake_session(&state,"Claude Code\r\nDo you want to proceed?\r\n❯ 1. Yes\r\n2. Yes, always\r\n3. No");
            action.kind = ActionKind::Approval(true);
            assert!(execute_checked(&state,&action,|_,_|false).is_err());
            session.interaction.lock().unwrap().input_revision += 1;
            assert!(execute_checked(&state,&action,|_,_|true).is_err());
            state.sessions.lock().unwrap().clear();
            assert!(execute_checked(&state,&action,|_,_|true).is_err());
            assert!(bytes.lock().unwrap().is_empty());
        }
        #[test] fn single_use_approval_and_denial_do_not_select_persistent_permission() {
            for (allow,expected) in [(true,"1\r"),(false,"3\r")] {
                let (_dir,state) = fixture(); let (_,bytes,mut action) = fake_session(&state,"Claude Code\r\nDo you want to proceed?\r\n❯ 1. Yes\r\n2. Yes, always\r\n3. No");
                action.kind = ActionKind::Approval(allow); execute_checked(&state,&action,|_,_|true).unwrap();
                assert_eq!(&*bytes.lock().unwrap(),expected.as_bytes());
            }
        }
    }
}
