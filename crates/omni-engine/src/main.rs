mod fluxos;
mod interaction;
mod mobile;
mod voz;
use anyhow::{anyhow, Context, Result};
use omni_core::targets;
use omni_protocol::{
    atomic_write_json, EngineRequest, EngineResponse, SessionState, TerminalSession,
    DEFAULT_ENGINE_PORT, PROTOCOL_VERSION,
};
use portable_pty::{native_pty_system, Child, CommandBuilder, MasterPty, PtySize};
use rand::RngCore;
use serde::{Deserialize, Serialize};
use std::{
    collections::{HashMap, VecDeque},
    env,
    fs,
    io::{Read, Write},
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicU64, Ordering},
        Arc, Mutex,
    },
    time::{SystemTime, UNIX_EPOCH},
};
use tokio::{
    io::{AsyncBufReadExt, AsyncWriteExt, BufReader},
    net::{TcpListener, TcpStream},
};

const MAX_SCROLLBACK_BYTES: usize = 5 * 1024 * 1024;

struct OutputBuffer {
    chunks: VecDeque<(u64, String)>,
    bytes: usize,
    next_seq: u64,
}

struct LiveSession {
    interaction: Mutex<interaction::Interaction>,
    reserved: std::sync::atomic::AtomicBool,
    meta: Mutex<TerminalSession>,
    writer: Mutex<Box<dyn Write + Send>>,
    master: Mutex<Box<dyn MasterPty + Send>>,
    child: Mutex<Box<dyn Child + Send + Sync>>,
    output: Mutex<OutputBuffer>,
}

enum SessionEntry {
    Live(Arc<LiveSession>),
    Historical(TerminalSession),
}

/// How long a `Working` session can go without new output before it's reported as
/// `Answered` instead.
const ANSWERED_IDLE_MS: u64 = 1_500;

/// CLIs cujo estado vem da TELA, não só do silêncio. Silêncio sozinho mentia: digitar no shell,
/// um log de dev server ou uma pausa do agente viravam "terminou" e disparavam aviso. Outros CLIs
/// e shells puros continuam no palpite por tempo ocioso — e nunca contam `attention_seq`.
fn screen_tracked(provider: Option<&str>) -> bool {
    matches!(provider, Some("claude" | "codex" | "antigravity"))
}

/// Claude Code e Codex mostram "esc to interrupt" durante o turno inteiro (inclusive rodando
/// ferramenta) e tiram quando acabam. O Antigravity (1.4.2) troca o rodapé "? for shortcuts" por
/// "esc to cancel" enquanto trabalha — e também enquanto espera você responder uma pergunta dele.
fn in_turn(screen_text: &str, provider: &str) -> bool {
    let texto = screen_text.to_ascii_lowercase();
    match provider {
        "antigravity" => texto.contains("esc to cancel"),
        _ => texto.contains("esc to interrupt"),
    }
}

/// Novo estado depois de `idle_ms` sem saída, e se isso encerra um turno de verdade (= aviso).
fn settle_state(state: &SessionState, idle_ms: u64, tracked: bool, screen_in_turn: bool, turn_active: bool) -> (SessionState, bool) {
    if *state != SessionState::Working || idle_ms <= ANSWERED_IDLE_MS {
        return (state.clone(), false);
    }
    if !tracked {
        return (SessionState::Answered, false);
    }
    if screen_in_turn {
        return (SessionState::Working, false);
    }
    (SessionState::Answered, turn_active)
}

/// Aplica `settle_state` e grava no meta: o aviso de fim de turno só pode ser contado uma vez.
/// Ordem de lock interaction → meta, a mesma de `append_output` e `capabilities`.
fn settle(session: &LiveSession) -> TerminalSession {
    let mut interaction = session.interaction.lock().expect("screen poisoned");
    let mut meta = session.meta.lock().expect("session metadata poisoned");
    let tracked = screen_tracked(meta.provider.as_deref());
    let screen_in_turn = tracked && in_turn(&interaction.parser.screen().contents(), meta.provider.as_deref().unwrap_or(""));
    let idle_ms = now_ms().saturating_sub(meta.last_activity_at_ms);
    // Shell puro calado mas com filho vivo (dev server) continua rodando. Só consulta os processos
    // quando ia virar `Answered`: shell no prompt sai do `Working` e não paga mais nada.
    let shell_busy = meta.provider.is_none() && meta.state == SessionState::Working && idle_ms > ANSWERED_IDLE_MS
        && interaction::has_children(meta.pid);
    let (state, turn_finished) = if shell_busy {
        (SessionState::Working, false)
    } else {
        settle_state(&meta.state, idle_ms, tracked, screen_in_turn, interaction.turn_active)
    };
    if turn_finished {
        interaction.turn_active = false;
        interaction.aprovacao_contada = false;
        meta.attention_seq += 1;
    }
    meta.state = state;
    meta.clone()
}

impl SessionEntry {
    fn metadata(&self) -> TerminalSession {
        match self {
            Self::Live(session) => {
                let mut meta = settle(session);
                meta.input_locked = session.reserved.load(Ordering::SeqCst);
                meta
            }
            Self::Historical(session) => session.clone(),
        }
    }
}

struct EngineState {
    persist_lock: Mutex<()>,
    mobile: mobile::MobileRuntime,
    token: String,
    state_file: PathBuf,
    sessions: Mutex<HashMap<String, SessionEntry>>,
    id_sequence: AtomicU64,
}

impl EngineState {
    fn persist(&self) -> Result<()> {
        let _guard = self.persist_lock.lock().map_err(|_| anyhow!("persistence lock poisoned"))?;
        let sessions: Vec<_> = self
            .sessions
            .lock()
            .map_err(|_| anyhow!("sessions lock poisoned"))?
            .values()
            .map(SessionEntry::metadata)
            .collect();
        atomic_write_json(&self.state_file, &sessions)?;
        Ok(())
    }

    fn next_id(&self) -> String {
        let sequence = self.id_sequence.fetch_add(1, Ordering::Relaxed);
        format!("terminal-{}-{sequence}", now_ms())
    }
}

#[tokio::main]
async fn main() -> Result<()> {
    // O engine pode subir sozinho (o app instalado o deixa vivo): amplia o próprio PATH para os
    // shells das PTYs acharem as CLIs instaladas em pasta que o instalador não propagou.
    omni_core::cli_path::ampliar_path();
    let engine_dir = engine_dir()?;
    fs::create_dir_all(&engine_dir)?;
    executable_identity(); // captura antes que uma atualização troque o arquivo
    let token = load_or_create_token(&engine_dir.join("engine.token"))?;
    let state_file = engine_dir.join("sessions.json");
    let sessions = load_historical_sessions(&state_file);
    let state = Arc::new(EngineState {
        persist_lock: Mutex::new(()),
        mobile: mobile::MobileRuntime::new(&engine_dir),
        token,
        state_file,
        sessions: Mutex::new(sessions),
        id_sequence: AtomicU64::new(1),
    });

    // Mesma variável que o cliente lê (`engine_client::engine_port`): sem ela, app instalado e app
    // de dev disputam a porta fixa e o segundo acaba conversando com o engine do primeiro.
    let port: u16 = std::env::var("OMNI_ENGINE_PORT")
        .ok()
        .and_then(|value| value.parse().ok())
        .unwrap_or(DEFAULT_ENGINE_PORT);
    let listener = TcpListener::bind(("127.0.0.1", port))
        .await
        .with_context(|| format!("engine already running or port {port} unavailable"))?;

    mobile::start(state.clone());
    fluxos::carregar(&state);

    loop {
        let (stream, _) = listener.accept().await?;
        let state = state.clone();
        tokio::spawn(async move {
            if let Err(error) = serve_client(stream, state).await {
                eprintln!("engine client error: {error:#}");
            }
        });
    }
}

async fn serve_client(stream: TcpStream, state: Arc<EngineState>) -> Result<()> {
    let (reader, mut writer) = stream.into_split();
    let mut lines = BufReader::new(reader).lines();
    while let Some(line) = lines.next_line().await? {
        let response = match serde_json::from_str::<EngineRequest>(&line) {
            // Assíncrona (é o roteador do axum): não pode ir para o `spawn_blocking` das outras.
            Ok(EngineRequest::Api { token, method, path, body, body_base64, headers }) if token == state.token => {
                mobile::local(state.clone(), &method, &path, body, body_base64, headers).await
            }
            Ok(request) if request.token() == state.token => {
                let state = state.clone();
                tokio::task::spawn_blocking(move || handle_request(request, &state)).await?
            },
            Ok(_) => EngineResponse::Error {
                code: "UNAUTHORIZED".into(),
                message: "invalid engine token".into(),
            },
            Err(error) => EngineResponse::Error {
                code: "INVALID_REQUEST".into(),
                message: error.to_string(),
            },
        };
        writer.write_all(&serde_json::to_vec(&response)?).await?;
        writer.write_all(b"\n").await?;
    }
    Ok(())
}

fn handle_request(request: EngineRequest, state: &Arc<EngineState>) -> EngineResponse {
    let result = match request {
        EngineRequest::AccountUsage { profile_id, refresh, .. } => interaction::account_usage(state, &profile_id, refresh),
        EngineRequest::MobileSettings { config, rotate, .. } => mobile::settings(state, config, rotate),
        EngineRequest::PublishWorkspace { projects, agents, theme, .. } => mobile::publish(state, projects, agents, theme),
        EngineRequest::MobileCheck { .. } => mobile::check(state),
        EngineRequest::MobileTotp { action, .. } => mobile::totp(state, action),
        EngineRequest::Ping { .. } => {
            let (engine_exe, engine_exe_modified_ms) = executable_identity().clone();
            return EngineResponse::Pong {
                protocol_version: PROTOCOL_VERSION,
                engine_pid: std::process::id(),
                engine_exe,
                engine_exe_modified_ms,
            }
        }
        EngineRequest::ListSessions { .. } => list_sessions(state),
        EngineRequest::SpawnTerminal {
            project_id,
            name,
            cwd,
            shell,
            initial_command,
            rows,
            cols,
            env,
            provider,
            profile_id,
            conversation_id,
            external_session_id,
            ..
        } => spawn_terminal(
            state,
            project_id,
            name,
            cwd,
            shell,
            initial_command,
            rows,
            cols,
            SessionOrigin { env, provider, profile_id, conversation_id, external_session_id },
        ),
        EngineRequest::WriteTerminal { session_id, data, .. } => write_terminal(state, &session_id, &data),
        EngineRequest::ResizeTerminal { session_id, rows, cols, .. } => {
            resize_terminal(state, &session_id, rows, cols)
        }
        EngineRequest::StopSession { session_id, .. } => stop_session(state, &session_id),
        EngineRequest::CloseSession { session_id, .. } => close_session(state, &session_id),
        EngineRequest::DuplicateSession { session_id, .. } => duplicate_session(state, &session_id),
        EngineRequest::RestartSession { session_id, .. } => restart_session(state, &session_id),
        EngineRequest::Snapshot { session_id, since, .. } => snapshot(state, &session_id, since),
        EngineRequest::RenameConversation { conversation_id, title, .. } => engine_dir()
            .and_then(|dir| {
                omni_core::conversations::rename(&dir, &conversation_id, &title).map_err(|erro| anyhow!(erro))
            })
            .map(|_| EngineResponse::Ok),
        EngineRequest::RenameSession { session_id, name, .. } => rename_session(state, &session_id, &name),
        EngineRequest::Api { .. } => unreachable!("tratada em serve_client"),
        EngineRequest::Shutdown { .. } => {
            std::process::exit(0);
        }
    };
    result.unwrap_or_else(|error| EngineResponse::Error {
        code: "ENGINE_ERROR".into(),
        message: error.to_string(),
    })
}

fn list_sessions(state: &EngineState) -> Result<EngineResponse> {
    let mut sessions: Vec<_> = state
        .sessions
        .lock()
        .map_err(|_| anyhow!("sessions lock poisoned"))?
        .values()
        .map(SessionEntry::metadata)
        .collect();
    // O nome que vale é o da **conversa**: barra lateral, painel de atenção e notificação do sistema
    // leem `session.name`, e antes disso todos mostravam o genérico "Claude · agent".
    let conversas = state.state_file.parent().map(|dir| {
        let mut conversas = omni_core::conversations::read_index(dir);
        let profiles = omni_core::profiles(dir);
        if omni_core::conversations::discover_codex_transcripts(&mut conversas, &profiles) {
            // Descoberta é reparo de índice: se a persistência falhar, o nome ainda aparece nesta
            // leitura e a próxima tentativa pode gravar. Listar sessões não deve derrubar o app.
            let _ = omni_core::conversations::write_index(dir, &conversas);
        }
        conversas
    }).unwrap_or_default();
    for session in &mut sessions {
        let Some(id) = session.conversation_id.as_deref() else { continue };
        if let Some(conversa) = conversas.iter().find(|item| item.id == id) {
            session.name = omni_core::conversations::display_title(conversa);
        }
    }
    sessions.sort_by_key(|session| session.created_at_ms);
    Ok(EngineResponse::Sessions { sessions })
}

type PtySpawn = (Option<u32>, Box<dyn Write + Send>, Box<dyn MasterPty + Send>, Box<dyn Child + Send + Sync>, Box<dyn Read + Send>);

/// Variáveis que dizem **qual** engine é este (porta, pasta de dados, binário). Valem para o
/// processo do engine e para mais ninguém.
///
/// Sem esta limpeza elas vazavam para todo terminal aberto pelo engine: quem desenvolve o OMNI
/// dentro do próprio OMNI rodava `npm run dev` num shell que já trazia a porta 47321 e a pasta
/// `com.omni.agents` do app instalado — e as variáveis de ambiente vencem o padrão de dev. O app de
/// dev passava a usar o engine e o código de acesso do instalado, e comando novo esbarrava num
/// engine velho ("unknown variant `mobile_totp`").
const VARIAVEIS_DO_ENGINE: [&str; 3] = ["OMNI_ENGINE_PORT", "OMNI_DATA_DIR", "OMNI_ENGINE_PATH"];

/// Marcas que o Claude Code põe nos processos que ele mesmo abre. Se o engine nasce de dentro de
/// uma sessão do Claude (alguém pediu ao agente para rodar `npm run dev`), todo terminal herdava
/// essas marcas — e o Claude aberto ali se via como "sessão filha": **não grava transcript**
/// ("Transcript saving is off — inherited CLAUDE_CODE_CHILD_SESSION marker"). Sem transcript, o
/// histórico, o celular e a web ficam sem a conversa.
const MARCAS_DE_SESSAO_DO_CLAUDE: [&str; 11] = [
    "CLAUDECODE", "CLAUDE_CODE_CHILD_SESSION", "CLAUDE_CODE_SESSION_ID", "CLAUDE_CODE_SESSION_ATTENDED",
    "CLAUDE_CODE_ENTRYPOINT", "CLAUDE_CODE_EXECPATH", "CLAUDE_CODE_MESSAGING_SOCKET",
    "CLAUDE_CODE_MESSAGING_TOKEN", "CLAUDE_CODE_SSE_PORT", "CLAUDE_PID", "CLAUDE_EFFORT",
];

/// O engine está rodando dentro de uma sessão do Claude Code (herdou as marcas dela).
fn herdou_sessao_do_claude(ambiente: impl Fn(&str) -> bool) -> bool {
    ambiente("CLAUDECODE") || ambiente("CLAUDE_CODE_CHILD_SESSION")
}

fn ambiente_do_terminal(command: &mut CommandBuilder, env: &[(String, String)]) {
    ambiente_do_terminal_com(command, env, herdou_sessao_do_claude(|nome| env::var_os(nome).is_some()));
    // Autocompactação sempre ligada, no tamanho escolhido em Configurações. A janela vai por env
    // (vale só para quem o OMNI abre); o `autoCompactEnabled` fica no settings da conta.
    command.env_remove("DISABLE_AUTO_COMPACT");
    command.env_remove("DISABLE_COMPACT");
    let janela = engine_dir().map(|dir| Compactacao::ler(&dir).janela).unwrap_or(JANELA_PADRAO);
    command.env("CLAUDE_CODE_AUTO_COMPACT_WINDOW", janela.to_string());
}

const JANELA_PADRAO: u32 = 400_000;

/// Configurações → Compactação (`compactacao.json`). No engine porque é ele quem sobe a CLI.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(default)]
pub(crate) struct Compactacao {
    /// Tamanho do contexto em que o Claude compacta sozinho: 400 mil ou 1 milhão de tokens.
    pub janela: u32,
    /// Compacta na conta atual, com o agente parado, quando o uso das 5 h passa de `limiar` %:
    /// a conta seguinte recebe o resumo, não a conversa inteira.
    pub antes_do_limite: bool,
    pub limiar: u8,
    /// Depois da troca de conta, compacta antes de continuar (o cache não passa de uma conta
    /// para outra, então a conversa grande seria lida inteira de novo a cada passo).
    pub depois_da_troca: bool,
}

impl Default for Compactacao {
    fn default() -> Self { Self { janela: JANELA_PADRAO, antes_do_limite: true, limiar: 85, depois_da_troca: true } }
}

impl Compactacao {
    pub(crate) fn ler(dir: &Path) -> Self {
        fs::read(dir.join("compactacao.json")).ok()
            .and_then(|bytes| serde_json::from_slice::<Self>(&bytes).ok())
            .filter(Self::valida).unwrap_or_default()
    }
    pub(crate) fn valida(&self) -> bool {
        matches!(self.janela, 400_000 | 1_000_000) && (50..=99).contains(&self.limiar)
    }
}

/// `"autoCompactEnabled": true` no settings.json da conta. Edita o texto, não regrava o JSON: o
/// serde reordenaria as chaves do arquivo do usuário.
fn garantir_autocompact(config_dir: &Path) {
    let caminho = config_dir.join("settings.json");
    let texto = fs::read_to_string(&caminho).unwrap_or_default();
    let novo = match texto.find("\"autoCompactEnabled\"") {
        Some(inicio) => {
            let resto = &texto[inicio..];
            let Some(fim) = resto.find([',', '}', '\n']) else { return };
            if resto[..fim].contains("true") { return; }
            format!("{}\"autoCompactEnabled\": true{}", &texto[..inicio], &resto[fim..])
        }
        None => match texto.trim().strip_prefix('{') {
            Some(corpo) if corpo.trim() == "}" => "{\n  \"autoCompactEnabled\": true\n}\n".to_string(),
            Some(_) => texto.replacen('{', "{\n  \"autoCompactEnabled\": true,", 1),
            None if texto.trim().is_empty() => "{\n  \"autoCompactEnabled\": true\n}\n".to_string(),
            None => return, // arquivo estranho: não mexe
        },
    };
    let _ = fs::write(&caminho, novo);
}

fn ambiente_do_terminal_com(command: &mut CommandBuilder, env: &[(String, String)], dentro_do_claude: bool) {
    for nome in VARIAVEIS_DO_ENGINE {
        command.env_remove(nome);
    }
    if dentro_do_claude {
        for nome in MARCAS_DE_SESSAO_DO_CLAUDE {
            command.env_remove(nome);
        }
        // Dentro de uma sessão do Claude, `CLAUDE_CONFIG_DIR` é a conta **daquela** sessão, não uma
        // escolha do usuário: herdada, ela fazia o perfil Padrão rodar na conta de outro perfil. A
        // conta de cada terminal vem do perfil (`env`, logo abaixo), nunca do pai.
        command.env_remove("CLAUDE_CONFIG_DIR");
    }
    command.env("OMNI_AGENTS", "1");
    // Isolamento de conta: o CLI é digitado no shell, então herda o ambiente daqui.
    for (key, value) in env {
        command.env(key, value);
    }
}

fn open_pty_and_spawn(
    cwd: &str,
    shell: &str,
    rows: u16,
    cols: u16,
    env: &[(String, String)],
    agent: bool,
) -> Result<PtySpawn> {
    let cwd_path = Path::new(cwd);
    if !cwd_path.is_dir() {
        return Err(anyhow!("terminal cwd does not exist: {cwd}"));
    }

    // Sessão de agente **nunca** entra no alvo: quem roda é o CLI desta máquina, com a conta, o
    // histórico e o `/usage` daqui. O que vai para lá são os comandos dele, pelo shim
    // (`CLAUDE_CODE_SHELL_PREFIX`, montado em `ambiente_do_alvo`). Terminal comum é o contrário:
    // abrir direto dentro da distro/servidor é o que o usuário espera ao pedir um shell.
    let alvo = targets::resolve(cwd, &conexoes_ssh());
    let wsl = match (&alvo, agent) {
        (targets::Target::Wsl { distro, remote_path }, false) => Some((distro.clone(), remote_path.clone())),
        _ => None,
    };
    let ssh = match (&alvo, agent) {
        (targets::Target::Ssh { connection_id, remote_path }, false) => Some((connection_id.clone(), remote_path.clone())),
        _ => None,
    };
    let env_alvo = ambiente_do_alvo(&alvo, cwd, agent);
    let env: Vec<(String, String)> = env.iter().cloned().chain(env_alvo).collect();
    let env = env.as_slice();

    let pty_system = native_pty_system();
    let pair = pty_system.openpty(PtySize {
        rows: rows.max(1),
        cols: cols.max(1),
        pixel_width: 0,
        pixel_height: 0,
    }).context("failed to create ConPTY")?;
    // Projeto dentro do WSL: um shell do Windows abriria a pasta pela rede (UNC) e rodaria tudo do
    // lado de fora — o `claude` instalado no Linux nem estaria no PATH. `wsl.exe --cd` entra na
    // distro, na mesma pasta, e aí tudo que for digitado roda dentro dela.
    let mut command = match (&wsl, &ssh) {
        (Some((distro, dir)), _) => {
            let mut command = CommandBuilder::new("wsl.exe");
            command.args(["-d", distro, "--cd", dir]);
            command
        }
        // `-t` força PTY do outro lado (senão não há prompt), e o `exec $SHELL -l` deixa o shell de
        // login do usuário remoto no lugar do `ssh`.
        (_, Some((connection_id, dir))) => {
            let conexoes = conexoes_ssh();
            let conexao = conexoes
                .iter()
                .find(|item| &item.id == connection_id)
                .ok_or_else(|| anyhow!("conexão SSH {connection_id} não está mais cadastrada"))?;
            let mut command = CommandBuilder::new("ssh");
            command.arg("-t");
            for argumento in conexao.ssh_args() {
                command.arg(argumento);
            }
            command.arg(format!("cd {} && exec $SHELL -l", targets::quote_posix(dir)));
            command
        }
        _ => CommandBuilder::new(shell),
    };
    // O ConPTY não abre processo com cwd em UNC (é o `--cd` que entra na pasta), então nesse caso
    // o processo nasce numa pasta local qualquer.
    match (&wsl, &ssh) {
        (None, None) => command.cwd(cwd_path),
        _ => command.cwd(env::var_os("USERPROFILE").map(PathBuf::from).unwrap_or_else(|| PathBuf::from("."))),
    };
    ambiente_do_terminal(&mut command, env);
    // Shell de login: é o `.zprofile`/`.bash_profile` que põe Homebrew e `~/.local/bin` no PATH,
    // onde `claude` e `codex` costumam morar no macOS e no Linux.
    #[cfg(not(windows))]
    command.arg("-l");
    #[cfg(windows)]
    if wsl.is_none() && shell.to_ascii_lowercase().contains("powershell")
        || shell.to_ascii_lowercase().contains("pwsh")
    {
        command.arg("-NoLogo");
    }

    let child = pair.slave.spawn_command(command).context("failed to start terminal shell")?;
    drop(pair.slave);
    let pid = child.process_id();
    let writer = pair.master.take_writer().context("failed to open PTY writer")?;
    let reader = pair.master.try_clone_reader().context("failed to open PTY reader")?;
    Ok((pid, writer, pair.master, child, reader))
}

/// Conexões SSH cadastradas. Mora no mesmo `ssh.json` que o lado Tauri escreve — o engine também
/// precisa delas para abrir sessão pedida pelo celular, com a janela do desktop fechada.
fn conexoes_ssh() -> Vec<targets::SshConnection> {
    engine_dir().map(|dir| targets::ssh_connections(&dir)).unwrap_or_default()
}

/// Onde mora o `omni-shim`: ao lado do próprio engine. Em dev o engine roda de
/// `src-tauri/binaries/omni-engine-<triple>.exe`, e o shim é copiado para lá com o mesmo sufixo.
fn caminho_do_shim() -> Option<PathBuf> {
    let atual = env::current_exe().ok()?;
    let nome = atual.file_name()?.to_string_lossy().into_owned();
    let candidato = atual.with_file_name(nome.replacen("omni-engine", "omni-shim", 1));
    candidato.is_file().then_some(candidato)
}

/// Variáveis que transformam uma sessão de agente numa sessão "local com comandos lá".
///
/// `CLAUDE_CODE_SHELL_PREFIX` recebe **só o caminho do executável**: o Claude Code monta o comando
/// final como `"<programa>" "<comando>"` e corta a string no último `" -"`, então qualquer flag
/// aqui viraria parte do nome do programa. O resto da configuração vai por variável.
fn ambiente_do_alvo(alvo: &targets::Target, cwd: &str, agent: bool) -> Vec<(String, String)> {
    if !agent || alvo.is_local() {
        return Vec::new();
    }
    let Some(shim) = caminho_do_shim() else {
        // Sem shim os comandos rodariam no Windows contra um projeto Linux — silêncio aqui seria
        // pior que a falta do desvio, então fica registrado no log do engine.
        eprintln!("omni-shim não encontrado ao lado do engine; comandos do agente rodarão localmente");
        return Vec::new();
    };
    let dados = engine_dir().map(|dir| dir.to_string_lossy().into_owned()).unwrap_or_default();
    variaveis_do_alvo(alvo, cwd, &shim.to_string_lossy(), &dados)
}

/// Parte pura de `ambiente_do_alvo`, separada para poder ser testada sem um shim no disco.
fn variaveis_do_alvo(
    alvo: &targets::Target,
    cwd: &str,
    shim: &str,
    data_dir: &str,
) -> Vec<(String, String)> {
    let mut variaveis = vec![
        ("CLAUDE_CODE_SHELL_PREFIX".to_string(), shim.to_string()),
        // O Claude Code roda os comandos pelo Git Bash, e o MSYS converte variável que pareça
        // caminho POSIX ao chamar um programa nativo: `/home/ana/proj` chegava no shim como
        // `C:/Program Files/Git/home/ana/proj`. O shim já se defende derivando o alvo do caminho
        // do Windows, e esta lista evita a conversão na origem.
        (
            "MSYS2_ENV_CONV_EXCL".to_string(),
            "OMNI_TARGET_REMOTE_ROOT;OMNI_TARGET_LOCAL_ROOT;OMNI_TARGET_DATA_DIR".to_string(),
        ),
        ("OMNI_TARGET_LOCAL_ROOT".to_string(), cwd.to_string()),
        ("OMNI_TARGET_REMOTE_ROOT".to_string(), alvo.remote_path().unwrap_or("/").to_string()),
        ("OMNI_TARGET_DATA_DIR".to_string(), data_dir.to_string()),
    ];
    match alvo {
        targets::Target::Wsl { distro, .. } => {
            variaveis.push(("OMNI_TARGET_KIND".into(), "wsl".into()));
            variaveis.push(("OMNI_TARGET_DISTRO".into(), distro.clone()));
        }
        targets::Target::Ssh { connection_id, .. } => {
            variaveis.push(("OMNI_TARGET_KIND".into(), "ssh".into()));
            variaveis.push(("OMNI_TARGET_SSH_ID".into(), connection_id.clone()));
        }
        targets::Target::Local => {}
    }
    variaveis
}

fn spawn_initial_command_thread(session: Arc<LiveSession>, initial_command: Option<String>) {
    if let Some(initial_command) = initial_command.filter(|command| !command.trim().is_empty()) {
        std::thread::spawn(move || {
            // ConPTY/PowerShell performs a cursor-position handshake during startup.
            // Let xterm answer it before injecting the selected agent command.
            std::thread::sleep(std::time::Duration::from_millis(800));
            if let Ok(mut writer) = session.writer.lock() {
                let _ = writer.write_all(initial_command.as_bytes());
                let _ = writer.write_all(b"\r\n");
                let _ = writer.flush();
            }
        });
    }
}

fn spawn_reader_thread(state: Arc<EngineState>, session: Arc<LiveSession>, mut reader: Box<dyn Read + Send>, watched_pid: Option<u32>) {
    std::thread::spawn(move || {
        let mut bytes = [0_u8; 8192];
        loop {
            match reader.read(&mut bytes) {
                Ok(0) => break,
                Ok(length) => append_output(&session, &bytes[..length], watched_pid),
                Err(error) => {
                    eprintln!("terminal reader failed: {error}");
                    break;
                }
            }
        }
        let exit_status = session.child.lock().ok().and_then(|mut child| child.try_wait().ok().flatten());
        if let Ok(mut meta) = session.meta.lock() {
            // A restart may have replaced the process this thread was watching before
            // EOF arrived here — only the reader whose pid still matches gets to report
            // Stopped/Crashed, so a stale reader can't clobber a freshly restarted session.
            let still_looked_alive = matches!(
                meta.state,
                SessionState::Working | SessionState::Answered | SessionState::ApprovalRequired
            );
            if still_looked_alive && meta.pid == watched_pid {
                meta.state = match exit_status {
                    Some(status) if !status.success() => SessionState::Crashed,
                    _ => SessionState::Stopped,
                };
                meta.pid = None;
            }
        }
        let _ = state.persist();
    });
}

/// Quem a sessão é, do ponto de vista de conta e conversa. Agrupado num struct porque
/// `spawn_terminal_inner` já estava no limite de argumentos.
#[derive(Debug, Clone, Default)]
pub(crate) struct SessionOrigin {
    pub env: Vec<(String, String)>,
    pub provider: Option<String>,
    pub profile_id: Option<String>,
    pub conversation_id: Option<String>,
    pub external_session_id: Option<String>,
}

impl SessionOrigin {
    /// Reconstrói a origem a partir de uma sessão já existente — usado por duplicate/restart, que
    /// precisam manter a mesma conta.
    fn of(session: &TerminalSession) -> Self {
        Self {
            env: session.env.clone(),
            provider: session.provider.clone(),
            profile_id: session.profile_id.clone(),
            conversation_id: session.conversation_id.clone(),
            external_session_id: session.external_session_id.clone(),
        }
    }
}

#[allow(clippy::too_many_arguments)]
/// Conta extra (não a nativa) recebe os MCPs, plugins e skills da conta principal antes de a CLI
/// abrir — ver `omni_core::compartilhar`. Desligável na aba Extensões.
fn compartilhar_extensoes(state: &Arc<EngineState>, provider: Option<&str>, profile_id: Option<&str>) {
    let (Some(provider), Some(profile_id), Some(dir)) = (provider, profile_id, state.state_file.parent()) else { return };
    omni_core::compartilhar::antes_de_abrir(dir, provider, profile_id);
    // Mesmo momento (a conta vai abrir): autocompactação ligada nela.
    if provider == "claude" {
        if let Some(perfil) = omni_core::profiles(dir).into_iter().find(|perfil| perfil.id == profile_id) {
            garantir_autocompact(Path::new(&perfil.config_dir));
        }
    }
}

pub(crate) fn spawn_terminal_inner(
    state: &Arc<EngineState>,
    id: String,
    project_id: String,
    name: String,
    cwd: String,
    shell: Option<String>,
    initial_command: Option<String>,
    rows: u16,
    cols: u16,
    created_at_ms: u64,
    origin: SessionOrigin,
) -> Result<TerminalSession> {
    let shell = shell.unwrap_or_else(default_shell);
    let initial_command = if origin.provider.as_deref() == Some("antigravity") {
        initial_command.map(|comando| com_log_do_antigravity(&comando, &id))
    } else { initial_command };
    compartilhar_extensoes(state, origin.provider.as_deref(), origin.profile_id.as_deref());
    let (pid, writer, master, child, reader) =
        open_pty_and_spawn(&cwd, &shell, rows, cols, &origin.env, origin.provider.is_some())?;
    let metadata = TerminalSession {
        id: id.clone(),
        project_id,
        name,
        cwd,
        shell,
        state: SessionState::Working,
        pid,
        created_at_ms,
        last_activity_at_ms: now_ms(),
        output_seq: 0,
        rows: rows.max(1),
        cols: cols.max(1),
        initial_command: initial_command.clone(),
        input_locked: false,
        notice: None,
        attention_seq: 0,
        env: origin.env,
        provider: origin.provider,
        profile_id: origin.profile_id,
        conversation_id: origin.conversation_id,
        external_session_id: origin.external_session_id,
    };
    let session = Arc::new(LiveSession {
        interaction: Mutex::new(interaction::Interaction::new(rows.max(1), cols.max(1))),
        reserved: std::sync::atomic::AtomicBool::new(false),
        meta: Mutex::new(metadata.clone()),
        writer: Mutex::new(writer),
        master: Mutex::new(master),
        child: Mutex::new(child),
        output: Mutex::new(OutputBuffer { chunks: VecDeque::new(), bytes: 0, next_seq: 0 }),
    });
    state
        .sessions
        .lock()
        .map_err(|_| anyhow!("sessions lock poisoned"))?
        .insert(id, SessionEntry::Live(session.clone()));
    state.persist()?;

    spawn_initial_command_thread(session.clone(), initial_command);
    spawn_reader_thread(state.clone(), session, reader, pid);

    Ok(metadata)
}

#[allow(clippy::too_many_arguments)]
fn spawn_terminal(
    state: &Arc<EngineState>,
    project_id: String,
    name: String,
    cwd: String,
    shell: Option<String>,
    initial_command: Option<String>,
    rows: u16,
    cols: u16,
    origin: SessionOrigin,
) -> Result<EngineResponse> {
    let id = state.next_id();
    let metadata = spawn_terminal_inner(
        state, id, project_id, name, cwd, shell, initial_command, rows, cols, now_ms(), origin,
    )?;
    Ok(EngineResponse::Session { session: metadata })
}

fn duplicate_session(state: &Arc<EngineState>, session_id: &str) -> Result<EngineResponse> {
    let source = state
        .sessions
        .lock()
        .map_err(|_| anyhow!("sessions lock poisoned"))?
        .get(session_id)
        .ok_or_else(|| anyhow!("session not found"))?
        .metadata();
    // Sessão de agente: "duplicar" é **bifurcar** a conversa — uma conversa nova com todo o histórico
    // da original, que segue independente dela. Shell continua virando outro shell igual.
    if let Some(provider) = source.provider.clone().filter(|p| p == "claude" || p == "codex") {
        return bifurcar(state, source, &provider);
    }
    let id = state.next_id();
    // Duplicate is "a new terminal just like this one", not "clone the agent's work in
    // progress" — never replays initial_command, so it never re-triggers agent work.
    let metadata = spawn_terminal_inner(
        state,
        id,
        source.project_id,
        format!("{} (cópia)", source.name),
        source.cwd,
        Some(source.shell),
        None,
        source.rows,
        source.cols,
        now_ms(),
        // Mesma conta da sessão de origem: uma cópia que caísse no profile padrão seria uma
        // troca de conta silenciosa.
        SessionOrigin { env: source.env, ..SessionOrigin::default() },
    )?;
    Ok(EngineResponse::Session { session: metadata })
}

/// Bifurca a conversa da sessão: a CLI copia o histórico para uma sessão nova, e o OMNI registra uma
/// conversa nova ("<nome> (fork)") apontando para ela. A original não muda.
///
/// Claude: `--resume <id> --fork-session --session-id <novo>` — o id novo é escolhido aqui (conferido
/// na 2.1.296: o arquivo nasce com ele), então a timeline sabe onde ler desde o primeiro instante.
/// Codex: `codex fork <id>` escolhe o id sozinho; a descoberta de rollouts acha o arquivo depois.
/// Sem mensagem ainda (nada a bifurcar), abre uma conversa nova do mesmo agente e conta.
fn bifurcar(state: &Arc<EngineState>, source: TerminalSession, provider: &str) -> Result<EngineResponse> {
    let dir = state.state_file.parent().ok_or_else(|| anyhow!("engine dir unavailable"))?.to_path_buf();
    let mut indice = omni_core::conversations::read_index(&dir);
    let original = source.conversation_id.as_deref().and_then(|id| indice.iter().find(|c| c.id == id)).cloned();
    let sessao_externa = source.external_session_id.clone()
        .or_else(|| original.as_ref().and_then(|c| c.segments.last()).and_then(|s| s.external_session_id.clone()));
    let base = mobile::comando_do_agente(state, provider);
    let novo = uuid::Uuid::new_v4().to_string();
    let pasta_do_claude = source.env.iter().find(|(chave, _)| chave == "CLAUDE_CONFIG_DIR").map(|(_, valor)| PathBuf::from(valor))
        .or_else(|| env::var_os("USERPROFILE").or_else(|| env::var_os("HOME")).map(|home| PathBuf::from(home).join(".claude")));
    let transcript_do_novo = || pasta_do_claude.as_ref()
        .map(|pasta| omni_core::conversations::claude_transcript_path(pasta, &source.cwd, &novo).to_string_lossy().into_owned());
    let (comando, externo, transcript) = match (provider, &sessao_externa) {
        ("claude", Some(sid)) => (format!("{base} --resume {sid} --fork-session --session-id {novo}"), Some(novo.clone()), transcript_do_novo()),
        ("claude", None) => (format!("{base} --session-id {novo}"), Some(novo.clone()), transcript_do_novo()),
        ("codex", Some(sid)) => (format!("{base} fork {sid}"), None, None),
        _ => (base.clone(), None, None),
    };
    let titulo = format!("{} (fork)", original.as_ref().map(omni_core::conversations::display_title).unwrap_or_else(|| source.name.clone()));
    let conversation_id = format!("conv-{}", uuid::Uuid::new_v4());
    let agora = now_ms();
    let metadata = spawn_terminal_inner(
        state,
        state.next_id(),
        source.project_id.clone(),
        titulo.clone(),
        source.cwd.clone(),
        Some(source.shell.clone()),
        Some(comando),
        source.rows,
        source.cols,
        agora,
        SessionOrigin {
            env: source.env.clone(),
            provider: Some(provider.to_string()),
            profile_id: source.profile_id.clone(),
            conversation_id: Some(conversation_id.clone()),
            external_session_id: externo.clone(),
        },
    )?;
    // O histórico da original aparece no fork desde já: o Claude só grava o arquivo da cópia na
    // primeira mensagem, e até lá a Conversa ficava vazia. Depois, as mensagens copiadas têm o mesmo
    // uuid das originais e não duplicam; o que a original ganhar depois do fork fica de fora.
    let mut segments: Vec<_> = original.iter().flat_map(|c| c.segments.iter())
        .filter(|segmento| segmento.transcript_path.is_some())
        .map(|segmento| omni_core::conversations::Segment {
            terminal_session_id: None,
            ended_at_ms: Some(segmento.ended_at_ms.unwrap_or(agora)),
            historico_ate_ms: Some(agora),
            ..segmento.clone()
        })
        .collect();
    segments.push(omni_core::conversations::Segment {
            provider: provider.to_string(),
            profile_id: source.profile_id,
            external_session_id: externo,
            transcript_path: transcript,
            terminal_session_id: Some(metadata.id.clone()),
            started_at_ms: agora,
            ended_at_ms: None, historico_ate_ms: None,
    });
    indice.push(omni_core::conversations::Conversation {
        id: conversation_id,
        project_id: source.project_id,
        cwd: source.cwd,
        title: titulo,
        // O "(fork)" é o que separa as duas na lista: o nome automático não pode apagá-lo.
        title_source: omni_core::conversations::TitleSource::Manual,
        created_at_ms: agora,
        segments,
    });
    omni_core::conversations::write_index(&dir, &indice)?;
    Ok(EngineResponse::Session { session: metadata })
}

/// Comando para reabrir a sessão no **Reiniciar**.
///
/// Uma conversa Claude nasce com `claude --session-id <uuid>`, que serve para *criar* a conversa com
/// aquele id. Repetir isso no reinício não volta para ela — era preciso sair e digitar `claude -r`
/// à mão. Se o transcript já existe, o reinício troca por `--resume <uuid>`, que retoma a mesma
/// conversa com o mesmo id (o celular continua lendo o mesmo arquivo). Sem transcript — nenhuma
/// mensagem foi mandada ainda — o `--resume` falharia, então fica o comando original.
fn comando_ao_reiniciar(meta: &TerminalSession) -> Option<String> {
    let original = meta.initial_command.clone()?;
    // Antigravity reaberto sem `--conversation` começa uma conversa nova — era o que fazia a Conversa
    // mostrar a anterior depois de reiniciar o app. O log da sessão diz qual retomar.
    if meta.provider.as_deref() == Some("antigravity") {
        let comando = com_log_do_antigravity(&original, &meta.id);
        let base = comando.split(" --conversation ").next().unwrap_or(&comando).to_owned();
        // Sem conversa no log ainda, vale a que já estava na linha (a de "trocar modelo", por exemplo).
        return Some(match config_do_antigravity().and_then(|dir| omni_core::antigravity::conversa_da_sessao(&dir, &meta.id)) {
            Some((conversa, _)) => format!("{base} --conversation {conversa}"),
            None => comando,
        });
    }
    if meta.provider.as_deref() != Some("claude") {
        return Some(original);
    }
    let Some(id) = meta.external_session_id.as_deref() else { return Some(original) };
    // Fork: reiniciar retoma **a cópia** — repetir o `--fork-session` bifurcaria de novo.
    if original.contains("--fork-session") && transcript_claude_existe(meta, id) {
        let base = original.split(" --resume ").next().unwrap_or("claude");
        return Some(format!("{base} --resume {id}"));
    }
    let criar = format!("--session-id {id}");
    if !original.contains(&criar) || !transcript_claude_existe(meta, id) {
        return Some(original);
    }
    Some(original.replacen(&criar, &format!("--resume {id}"), 1))
}

/// Config do Antigravity. Só existe a conta nativa (o agy não aceita trocar o diretório).
fn config_do_antigravity() -> Option<PathBuf> {
    env::var_os("USERPROFILE").or_else(|| env::var_os("HOME")).map(|home| PathBuf::from(home).join(".gemini").join("antigravity-cli"))
}

/// `agy` com `--log-file` próprio da sessão (ver `omni_core::antigravity::log_da_sessao`). Barras
/// normais e aspas duplas: o caminho tem espaço e o mesmo texto roda em bash, PowerShell ou cmd.
fn com_log_do_antigravity(comando: &str, sessao: &str) -> String {
    let Some(dir) = config_do_antigravity() else { return comando.to_owned() };
    if comando.contains("--log-file") { return comando.to_owned(); }
    let log = omni_core::antigravity::log_da_sessao(&dir, sessao);
    if let Some(pasta) = log.parent() { let _ = fs::create_dir_all(pasta); }
    // A opção vai logo depois do binário: o resto da linha pode ter um prompt entre aspas.
    let (binario, resto) = comando.split_once(' ').map_or((comando, ""), |(b, r)| (b, r));
    let caminho = log.to_string_lossy().replace('\\', "/");
    format!("{binario} --log-file \"{caminho}\"{}{resto}", if resto.is_empty() { "" } else { " " })
}

/// O transcript mora no config dir da conta da sessão: `CLAUDE_CONFIG_DIR` do perfil quando há, senão
/// o `~/.claude` padrão.
fn transcript_claude_existe(meta: &TerminalSession, id: &str) -> bool {
    let config_dir = meta
        .env
        .iter()
        .find(|(chave, _)| chave == "CLAUDE_CONFIG_DIR")
        .map(|(_, valor)| PathBuf::from(valor))
        .or_else(|| env::var_os("USERPROFILE").or_else(|| env::var_os("HOME")).map(|home| PathBuf::from(home).join(".claude")));
    config_dir.is_some_and(|dir| omni_core::conversations::claude_transcript_path(&dir, &meta.cwd, id).is_file())
}

enum RestartTarget {
    Live(Arc<LiveSession>),
    Historical(TerminalSession),
}

/// Nome de um terminal sem agente. Sessão de agente renomeia pela conversa (`RenameConversation`):
/// o nome dela vem do índice e sobrescreveria este a cada listagem.
fn rename_session(state: &EngineState, session_id: &str, name: &str) -> Result<EngineResponse> {
    let name = name.trim();
    if name.is_empty() || name.chars().count() > 120 { return Err(anyhow!("nome vazio ou longo demais")); }
    {
        let mut sessions = state.sessions.lock().map_err(|_| anyhow!("sessions lock poisoned"))?;
        match sessions.get_mut(session_id).ok_or_else(|| anyhow!("session not found"))? {
            SessionEntry::Live(session) => session.meta.lock().map_err(|_| anyhow!("metadata poisoned"))?.name = name.to_owned(),
            SessionEntry::Historical(meta) => meta.name = name.to_owned(),
        }
    }
    state.persist()?;
    Ok(EngineResponse::Ok)
}

fn restart_session(state: &Arc<EngineState>, session_id: &str) -> Result<EngineResponse> {
    let target = {
        let sessions = state.sessions.lock().map_err(|_| anyhow!("sessions lock poisoned"))?;
        match sessions.get(session_id).ok_or_else(|| anyhow!("session not found"))? {
            SessionEntry::Live(session) => RestartTarget::Live(session.clone()),
            SessionEntry::Historical(meta) => RestartTarget::Historical(meta.clone()),
        }
    };

    match target {
        // The Arc stays the same object in the map — only its interior fields are
        // swapped, so no removal/reinsertion window where lookups would fail.
        RestartTarget::Live(session) => {
            let mut context = session.interaction.lock().map_err(|_| anyhow!("screen poisoned"))?;
            if session.reserved.load(Ordering::SeqCst) { return Err(anyhow!("Consulta de uso em andamento")); }
            if let Ok(mut child) = session.child.lock() {
                matar_arvore(child.process_id());
                let _ = child.kill();
            }
            let meta = session.meta.lock().map_err(|_| anyhow!("session metadata poisoned"))?.clone();
            context.parser = vt100::Parser::new(meta.rows, meta.cols, 0);
            context.input_revision += 1;
            context.turn_active = false;
            // Solta a tela antes de subir o processo: o spawn (wsl.exe, CLI com hooks) leva segundos,
            // e `list_sessions` passa por esta trava em toda sessão — a lista inteira ficava parada,
            // e o app desistia por tempo esgotado. A saída do processo velho já não conta (pid).
            drop(context);
            // Reinício e troca de conta do failover também passam aqui: a conta nova recebe as
            // extensões da principal antes de a CLI subir.
            compartilhar_extensoes(state, meta.provider.as_deref(), meta.profile_id.as_deref());
            let (pid, writer, master, child, reader) =
                open_pty_and_spawn(&meta.cwd, &meta.shell, meta.rows, meta.cols, &meta.env, meta.provider.is_some())?;
            *session.writer.lock().map_err(|_| anyhow!("terminal writer poisoned"))? = writer;
            *session.master.lock().map_err(|_| anyhow!("terminal master poisoned"))? = master;
            *session.child.lock().map_err(|_| anyhow!("terminal child poisoned"))? = child;
            let updated = {
                let mut meta = session.meta.lock().map_err(|_| anyhow!("session metadata poisoned"))?;
                meta.pid = pid;
                meta.state = SessionState::Working;
            // O parser é zerado no restart, mas um restart sem nenhuma saída nova nunca
            // chamaria `append_output` — sem isto o aviso velho ficaria colado na sessão.
            meta.notice = None;
                meta.last_activity_at_ms = now_ms();
                meta.clone()
            };
            state.persist()?;
            // Reabre o mesmo agente; conversa Claude com histórico volta com `--resume`.
            spawn_initial_command_thread(session.clone(), comando_ao_reiniciar(&meta));
            spawn_reader_thread(state.clone(), session, reader, pid);
            Ok(EngineResponse::Session { session: updated })
        }
        // No in-memory scrollback survives a session that was already stopped/orphaned
        // before this engine process started — nothing to preserve, so a fresh
        // LiveSession (same id) via spawn_terminal_inner is the whole job.
        RestartTarget::Historical(meta) => {
            let origin = SessionOrigin::of(&meta);
            let comando = comando_ao_reiniciar(&meta);
            let metadata = spawn_terminal_inner(
                state,
                meta.id,
                meta.project_id,
                meta.name,
                meta.cwd,
                Some(meta.shell),
                comando,
                meta.rows,
                meta.cols,
                meta.created_at_ms,
                origin,
            )?;
            Ok(EngineResponse::Session { session: metadata })
        }
    }
}

/// Substrings that commonly precede a CLI agent waiting on a yes/no approval.
/// ponytail: hardcoded phrase list tuned against Claude Code/Codex/Cursor — a
/// CLI outside this set, or one running in another language, gives a false negative.
/// Upgrade path: providers emitting a structured "needs approval" signal instead of text.
const APPROVAL_PROMPT_PATTERNS: [&str; 4] = ["(y/n)", "do you want to", "allow?", "permitir?"];

fn looks_like_approval_prompt(chunk: &str) -> bool {
    let lower = chunk.to_ascii_lowercase();
    APPROVAL_PROMPT_PATTERNS.iter().any(|pattern| lower.contains(pattern))
}

/// Motivos de parada que `state` não distingue: o agente fica ocioso (logo, `Answered`) tanto
/// quando terminou a tarefa quanto quando bateu no limite da conta ou levou erro da API.
/// Começo das linhas que a CLI escreve quando para — e só o começo. Procurar a frase em qualquer
/// ponto da tela casava com texto que o agente mostra: um `grep` no código do engine, um teste, uma
/// resposta falando de limite. O engine dizia "limite de uso", o failover trocava de conta e
/// reabria a sessão no meio do trabalho — a "sessão que cai".
/// ponytail: frases em inglês contra as mensagens do Claude Code/Codex; texto novo do provider vira
/// falso negativo (perde o rótulo, não o aviso). Upgrade path: sinal estruturado do provider.
const USAGE_LIMIT_LINES: [&str; 5] = [
    "you've hit your",      // Claude: "You've hit your session/weekly limit · resets…"; Codex: "…usage limit."
    "usage limit reached",     // Claude: "Usage limit reached · continuing automatically at…"
    "claude usage limit reached", // Claude Code antigo
    "5-hour limit reached",
    "rate limit exceeded",
];
const API_ERROR_LINES: [&str; 3] = [
    "api error", // "API Error: 529 {…overloaded…}"
    "credit balance is too low",
    "invalid api key",
];
/// Marcadores que a TUI põe antes da mensagem (`⎿`, `●`, `■`…); o resto da linha tem de começar
/// com a frase.
const MARCADORES: &str = "⎿●■⏺•✻└│∙";

#[cfg(test)]
fn detect_notice(screen_text: &str) -> Option<String> {
    notice_since(notice_counts(screen_text), (0, 0))
}

/// Quantas linhas de aviso da CLI há na tela **depois da última fala do agente**: (limite de uso,
/// erro de API). Aviso seguido de resposta (`●`) não interrompeu nada — o agente seguiu. E linha com
/// "retrying" é a CLI tentando de novo sozinha, não o fim do turno. Sem isso um turno que terminou
/// normal aparecia "interrompido" por um erro passageiro que ficou na tela.
fn notice_counts(screen_text: &str) -> (usize, usize) {
    let mut counts = (0, 0);
    for line in screen_text.lines() {
        let fala = line.trim_start().starts_with(['●', '⏺']);
        let line = line
            .trim_start_matches(|c: char| c.is_whitespace() || MARCADORES.contains(c))
            .replace('’', "'")
            .to_ascii_lowercase();
        if line.contains("retrying") { continue; }
        if USAGE_LIMIT_LINES.iter().any(|p| line.starts_with(p)) && line.contains("limit") {
            counts.0 += 1;
        } else if API_ERROR_LINES.iter().any(|p| line.starts_with(p)) {
            counts.1 += 1;
        } else if fala {
            counts = (0, 0);
        }
    }
    counts
}

/// O aviso **deste turno**: só conta o que apareceu na tela depois que ele começou. A mensagem de
/// limite do turno anterior continua visível depois que o agente volta (failover, reset do limite)
/// e termina normalmente — sem a base, a conversa que acabou de terminar aparecia "interrompida".
fn notice_since(counts: (usize, usize), base: (usize, usize)) -> Option<String> {
    // Limite antes de erro: "rate limit exceeded" casa nos dois, e "estourou o limite" é a
    // informação acionável (esperar o reset); "erro de API" só mandaria tentar de novo.
    if counts.0 > base.0 {
        return Some("usage_limit".into());
    }
    if counts.1 > base.1 {
        return Some("api_error".into());
    }
    None
}

fn append_output(session: &LiveSession, bytes: &[u8], watched_pid: Option<u32>) {
    let data = String::from_utf8_lossy(bytes).into_owned();
    if data.is_empty() {
        return;
    }
    let length = data.len();
    let mut interaction = session.interaction.lock().expect("screen poisoned");
    let tracked_provider = {
        let meta = session.meta.lock().expect("metadata poisoned");
        if meta.pid != watched_pid { return; }
        meta.provider.clone().filter(|provider| screen_tracked(Some(provider)))
    };
    interaction.parser.process(&interaction::sem_substituto(bytes));
    answer_terminal_queries(session, &data, interaction.parser.screen());
    let screen_text = interaction.parser.screen().contents();
    let approval_requested = match &tracked_provider {
        // O diálogo real, reconhecido estrito — não "do you want to" solto numa resposta do agente.
        Some(provider) => {
            let dialog = interaction::approval(&screen_text, provider).is_some();
            let trabalhando = in_turn(&screen_text, provider);
            // Turno novo começando: o que já estava na tela é passado.
            if trabalhando && !interaction.turn_active {
                interaction.avisos_antes_do_turno = notice_counts(&screen_text);
                interaction.turnos_iniciados += 1;
            }
            if dialog || trabalhando { interaction.turn_active = true; }
            // O agente voltou a trabalhar (o rodapé "esc to interrupt" só existe sem diálogo
            // aberto): o próximo pedido de aprovação é um pedido novo.
            if trabalhando && !dialog { interaction.aprovacao_contada = false; }
            dialog
        }
        None => looks_like_approval_prompt(&data),
    };
    let counts = notice_counts(&screen_text);
    let sem_turno = interaction.turnos_iniciados == 0;
    let base = &mut interaction.avisos_antes_do_turno;
    *base = if sem_turno {
        // Nenhum turno nesta sessão ainda: o que está na tela é histórico (o `--resume` do failover
        // reexibe o aviso que fez a conta trocar). A CLI só avisa de novo depois de um turno.
        counts
    } else {
        // Aviso que rolou para fora da tela sai da base também; senão o próximo igual não contaria.
        (base.0.min(counts.0), base.1.min(counts.1))
    };
    // No meio do turno ("esc to interrupt" na tela) o agente está trabalhando: o que aparecer é
    // saída dele, não a CLI avisando que parou.
    let em_turno = tracked_provider.as_deref().is_some_and(|provider| in_turn(&screen_text, provider));
    let notice = if em_turno { None } else { notice_since(counts, *base) };
    if let Ok(mut output) = session.output.lock() {
        let sequence = output.next_seq;
        output.next_seq += 1;
        output.bytes += length;
        output.chunks.push_back((sequence, data));
        while output.bytes > MAX_SCROLLBACK_BYTES {
            if let Some((_, removed)) = output.chunks.pop_front() {
                output.bytes = output.bytes.saturating_sub(removed.len());
            } else {
                break;
            }
        }
        if let Ok(mut meta) = session.meta.lock() {
            meta.output_seq = output.next_seq;
            meta.last_activity_at_ms = now_ms();
            let next = if approval_requested {
                SessionState::ApprovalRequired
            } else if em_turno || tracked_provider.is_none() || meta.state != SessionState::Answered {
                SessionState::Working
            } else {
                // Claude/Codex parado e a tela mudou sem "esc to interrupt": é redesenho (aba
                // reaberta, janela redimensionada, relógio do rodapé), não trabalho. Antes isso
                // virava "trabalhando" por 1,5 s — o agente parecia começar a pensar sozinho toda
                // vez que alguém abria a conversa.
                SessionState::Answered
            };
            if tracked_provider.is_some() && next == SessionState::ApprovalRequired && meta.state != next && !interaction.aprovacao_contada {
                interaction.aprovacao_contada = true;
                meta.attention_seq += 1;
            }
            meta.state = next;
            meta.notice = notice;
        }
    }
}

/// Responde as perguntas que um terminal de verdade responderia. **Sempre o engine**, nunca o xterm.
///
/// O ConPTY do Windows manda `ESC[6n` ("onde está o cursor?") ao criar a PTY e **para** até receber
/// `ESC[linha;colunaR`: sem resposta, o bash não termina de subir e o agente injetado nunca roda.
/// Antes só o xterm do desktop respondia, e o engine só quando ninguém exibia a PTY (celular). Uma
/// aba que abria na visão Conversa — o fork — não tinha xterm nenhum; ao trocar para Terminal, o
/// xterm reproduzia o `ESC[6n` como histórico, sem responder: o fork ficava vazio para sempre.
/// O engine vê o pedido primeiro e sabe a posição (`vt100`, já com o chunk aplicado); a resposta
/// do xterm, em dobro, é descartada em `write_terminal` — senão vazaria como texto digitado.
fn answer_terminal_queries(session: &LiveSession, data: &str, screen: &vt100::Screen) {
    if let Some(resposta) = cursor_report(data, screen.cursor_position()) {
        if let Ok(mut writer) = session.writer.lock() {
            let _ = writer.write_all(resposta.as_bytes());
            let _ = writer.flush();
        }
    }
}

/// `ESC[linha;colunaR` (1-based) para cada `ESC[6n` no chunk. Separado para testar sem PTY.
fn cursor_report(data: &str, (row, col): (u16, u16)) -> Option<String> {
    let pedidos = data.matches("[6n").count();
    (pedidos > 0).then(|| format!("[{};{}R", row + 1, col + 1).repeat(pedidos))
}

/// Tira da entrada as respostas de posição do cursor (`ESC[linha;colunaR`): quem responde o `ESC[6n`
/// é o engine (`answer_terminal_queries`), a do xterm chegaria em dobro.
// ponytail: Shift+F3 no xterm gera a mesma sequência (`ESC[1;2R`) e também some; contar os pedidos
// respondidos se algum agente precisar dessa tecla.
fn sem_respostas_de_cursor(data: &str) -> std::borrow::Cow<'_, str> {
    if !data.contains("\x1b[") { return data.into(); }
    let mut saida = String::with_capacity(data.len());
    let mut resto = data;
    while let Some(i) = resto.find("\x1b[") {
        saida.push_str(&resto[..i]);
        let depois = &resto[i + 2..];
        let fim = depois.find(|c: char| !(c.is_ascii_digit() || c == ';')).unwrap_or(depois.len());
        if depois[fim..].starts_with('R') && depois[..fim].contains(';') {
            resto = &depois[fim + 1..];
        } else {
            saida.push_str("\x1b[");
            resto = depois;
        }
    }
    saida.push_str(resto);
    saida.into()
}

fn write_terminal(state: &EngineState, session_id: &str, data: &str) -> Result<EngineResponse> {
    let data = sem_respostas_de_cursor(data);
    if data.is_empty() { return Ok(EngineResponse::Ok); }
    let sessions = state.sessions.lock().map_err(|_| anyhow!("sessions lock poisoned"))?;
    let SessionEntry::Live(session) = sessions.get(session_id).ok_or_else(|| anyhow!("session not found"))? else {
        return Err(anyhow!("session is not running"));
    };
    let mut interaction = session.interaction.lock().map_err(|_| anyhow!("screen poisoned"))?;
    if session.reserved.load(Ordering::SeqCst) { return Err(anyhow!("Consulta de uso em andamento; aguarde")); }
    interaction.input_revision += 1;
    let mut writer = session.writer.lock().map_err(|_| anyhow!("terminal writer poisoned"))?;
    writer.write_all(data.as_bytes())?;
    writer.flush()?;
    Ok(EngineResponse::Ok)
}

fn resize_terminal(state: &EngineState, session_id: &str, rows: u16, cols: u16) -> Result<EngineResponse> {
    let sessions = state.sessions.lock().map_err(|_| anyhow!("sessions lock poisoned"))?;
    let SessionEntry::Live(session) = sessions.get(session_id).ok_or_else(|| anyhow!("session not found"))? else {
        return Err(anyhow!("session is not running"));
    };
    let mut interaction = session.interaction.lock().map_err(|_| anyhow!("screen poisoned"))?;
    interaction.parser.screen_mut().set_size(rows.max(1), cols.max(1));
    interaction.input_revision += 1;
    session.master.lock().map_err(|_| anyhow!("terminal master poisoned"))?.resize(PtySize {
        rows: rows.max(1),
        cols: cols.max(1),
        pixel_width: 0,
        pixel_height: 0,
    })?;
    let mut meta = session.meta.lock().map_err(|_| anyhow!("session metadata poisoned"))?;
    meta.rows = rows.max(1);
    meta.cols = cols.max(1);
    Ok(EngineResponse::Ok)
}

fn stop_session(state: &EngineState, session_id: &str) -> Result<EngineResponse> {
    let sessions = state.sessions.lock().map_err(|_| anyhow!("sessions lock poisoned"))?;
    let SessionEntry::Live(session) = sessions.get(session_id).ok_or_else(|| anyhow!("session not found"))? else {
        return Ok(EngineResponse::Ok);
    };
    {
        let mut child = session.child.lock().map_err(|_| anyhow!("terminal child poisoned"))?;
        matar_arvore(child.process_id());
        child.kill()?;
    }
    let mut meta = session.meta.lock().map_err(|_| anyhow!("session metadata poisoned"))?;
    meta.state = SessionState::Stopped;
    meta.pid = None;
    drop(meta);
    drop(sessions);
    state.persist()?;
    Ok(EngineResponse::Ok)
}

fn close_session(state: &EngineState, session_id: &str) -> Result<EngineResponse> {
    let entry = state
        .sessions
        .lock()
        .map_err(|_| anyhow!("sessions lock poisoned"))?
        .remove(session_id);
    if let Some(SessionEntry::Live(session)) = entry {
        let mut child = session.child.lock().map_err(|_| anyhow!("terminal child poisoned"))?;
        matar_arvore(child.process_id());
        let _ = child.kill();
    }
    state.persist()?;
    Ok(EngineResponse::Ok)
}

/// No Windows o `kill` da PTY só derruba o shell: a CLI aberta nele (agy, claude, node) ficava viva,
/// órfã, a cada aba fechada ou reiniciada. `taskkill /T` leva a árvore inteira.
/// ponytail: no macOS/Linux o fim da PTY manda SIGHUP e a CLI sai; matar o grupo se aparecer órfão lá.
fn matar_arvore(pid: Option<u32>) {
    #[cfg(windows)]
    if let Some(pid) = pid {
        use std::os::windows::process::CommandExt;
        let _ = std::process::Command::new("taskkill").args(["/T", "/F", "/PID", &pid.to_string()])
            .stdin(std::process::Stdio::null()).stdout(std::process::Stdio::null()).stderr(std::process::Stdio::null())
            .creation_flags(0x0800_0000).status();
    }
    #[cfg(not(windows))]
    let _ = pid;
}

fn snapshot(state: &EngineState, session_id: &str, since: u64) -> Result<EngineResponse> {
    let sessions = state.sessions.lock().map_err(|_| anyhow!("sessions lock poisoned"))?;
    let entry = sessions.get(session_id).ok_or_else(|| anyhow!("session not found"))?;
    let session_meta = entry.metadata();
    let SessionEntry::Live(session) = entry else {
        return Ok(EngineResponse::Snapshot { session: session_meta, from_seq: since, next_seq: since, data: String::new() });
    };
    let output = session.output.lock().map_err(|_| anyhow!("terminal output poisoned"))?;
    let from_seq = output.chunks.front().map(|(seq, _)| (*seq).max(since)).unwrap_or(since);
    let data = output
        .chunks
        .iter()
        .filter(|(sequence, _)| *sequence >= since)
        .map(|(_, chunk)| chunk.as_str())
        .collect();
    Ok(EngineResponse::Snapshot { session: session_meta, from_seq, next_seq: output.next_seq, data })
}

/// Quem decide a pasta é **quem lança** o engine (`engine_client::spawn_engine` passa
/// `OMNI_DATA_DIR`), não o perfil com que este binário foi compilado. Assim um engine de release
/// aberto pelo app de dev continua isolado do app instalado, e vice-versa.
fn engine_dir() -> Result<PathBuf> {
    if let Some(dir) = env::var_os("OMNI_DATA_DIR") {
        return Ok(PathBuf::from(dir));
    }
    let base = omni_protocol::local_data_root().ok_or_else(|| anyhow!("user data directory is unavailable"))?;
    Ok(base.join(omni_protocol::DATA_DIR).join("engine"))
}

/// Binário e data de modificação dele **no momento em que o engine subiu** (ver `Pong`).
fn executable_identity() -> &'static (Option<String>, Option<u64>) {
    static IDENTITY: std::sync::OnceLock<(Option<String>, Option<u64>)> = std::sync::OnceLock::new();
    IDENTITY.get_or_init(|| {
        let exe = env::current_exe().ok();
        let modified = exe.as_ref().and_then(|exe| omni_protocol::modified_ms(exe));
        (exe.map(|exe| exe.to_string_lossy().into_owned()), modified)
    })
}

fn load_or_create_token(path: &Path) -> Result<String> {
    if let Ok(token) = fs::read_to_string(path) {
        let token = token.trim();
        if token.len() >= 32 {
            return Ok(token.to_owned());
        }
    }
    let token = random_token();
    fs::write(path, &token)?;
    Ok(token)
}

/// 32 bytes aleatórios em hex. Usado pelo token do engine e pelo token de dispositivo do celular.
pub(crate) fn random_token() -> String {
    let mut bytes = [0_u8; 32];
    rand::rng().fill_bytes(&mut bytes);
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

fn load_historical_sessions(path: &Path) -> HashMap<String, SessionEntry> {
    let sessions = fs::read(path)
        .ok()
        .and_then(|data| serde_json::from_slice::<Vec<TerminalSession>>(&data).ok())
        .unwrap_or_default();
    // Um engine antigo que ficou vivo durante uma atualização ignorava provider/profile_id no
    // SpawnTerminal e gravou a sessão sem origem — e o restart preserva isso para sempre. Sem
    // origem, `/usage` e o celular não acham a sessão. O índice de conversas guarda a origem.
    let conversations = path.parent().map(omni_core::conversations::read_index).unwrap_or_default();
    sessions
        .into_iter()
        .map(|mut session| {
            if session.provider.is_none() {
                let origin = conversations.iter().rev().find_map(|conversation| {
                    let segment = conversation.segments.iter().rev()
                        .find(|segment| segment.terminal_session_id.as_deref() == Some(session.id.as_str()))?;
                    Some((conversation.id.clone(), segment.clone()))
                });
                if let Some((conversation_id, segment)) = origin {
                    session.provider = Some(segment.provider);
                    session.profile_id = session.profile_id.take().or(segment.profile_id);
                    session.conversation_id = session.conversation_id.take().or(Some(conversation_id));
                    session.external_session_id = session.external_session_id.take().or(segment.external_session_id);
                }
            }
            session.state = if Path::new(&session.cwd).is_dir() { SessionState::Stopped } else { SessionState::Orphan };
            session.pid = None;
            (session.id.clone(), SessionEntry::Historical(session))
        })
        .collect()
}

fn default_shell() -> String {
    #[cfg(windows)]
    {
        let program_files = env::var("ProgramFiles").unwrap_or_else(|_| r"C:\Program Files".into());
        let git_root = Path::new(&program_files).join("Git");
        for candidate in [git_root.join("bin").join("bash.exe"), git_root.join("usr").join("bin").join("bash.exe")] {
            if candidate.is_file() {
                return candidate.to_string_lossy().into_owned();
            }
        }
        "powershell.exe".into()
    }
    #[cfg(not(windows))]
    {
        env::var("SHELL").unwrap_or_else(|_| "/bin/sh".into())
    }
}

fn now_ms() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_millis() as u64
}

#[cfg(test)]
mod tests {
    use super::*;

    pub(crate) fn test_state() -> Arc<EngineState> {
        let dir = env::temp_dir().join(format!("omni-engine-test-{}-{:x}", now_ms(), rand::random::<u64>()));
        fs::create_dir_all(&dir).expect("create temp state dir");
        Arc::new(EngineState {
            persist_lock: Mutex::new(()),
            mobile: mobile::MobileRuntime::new(&dir),
            token: "test-token".into(),
            state_file: dir.join("sessions.json"),
            sessions: Mutex::new(HashMap::new()),
            id_sequence: AtomicU64::new(1),
        })
    }

    /// Engine aberto de dentro de uma sessão do Claude: o terminal não pode herdar as marcas dela
    /// (o Claude ali pararia de gravar transcript) nem a pasta de conta dela (rodaria na conta errada).
    #[test]
    fn terminal_nao_herda_a_sessao_do_claude_que_abriu_o_engine() {
        assert!(herdou_sessao_do_claude(|nome| nome == "CLAUDECODE"));
        assert!(!herdou_sessao_do_claude(|_| false));

        let mut comando = CommandBuilder::new("cmd");
        comando.env("CLAUDE_CODE_CHILD_SESSION", "1");
        comando.env("CLAUDE_CONFIG_DIR", "C:/perfil-do-pai");
        ambiente_do_terminal_com(&mut comando, &[], true);
        assert!(comando.get_env("CLAUDE_CODE_CHILD_SESSION").is_none());
        assert!(comando.get_env("CLAUDE_CONFIG_DIR").is_none());

        // A conta do perfil entra depois da limpeza e vale.
        let mut comando = CommandBuilder::new("cmd");
        comando.env("CLAUDE_CONFIG_DIR", "C:/perfil-do-pai");
        ambiente_do_terminal_com(&mut comando, &[("CLAUDE_CONFIG_DIR".into(), "C:/perfil-certo".into())], true);
        assert_eq!(comando.get_env("CLAUDE_CONFIG_DIR").and_then(|v| v.to_str()), Some("C:/perfil-certo"));

        // Fora de uma sessão do Claude, a pasta configurada pelo usuário é respeitada.
        let mut comando = CommandBuilder::new("cmd");
        comando.env("CLAUDE_CONFIG_DIR", "C:/escolha-do-usuario");
        ambiente_do_terminal_com(&mut comando, &[], false);
        assert_eq!(comando.get_env("CLAUDE_CONFIG_DIR").and_then(|v| v.to_str()), Some("C:/escolha-do-usuario"));
    }

    #[test]
    fn historical_session_without_origin_is_filled_from_conversation_index() {
        let dir = tempfile::tempdir().unwrap();
        let session = serde_json::json!({"id":"s","project_id":"p","name":"Claude · agent","cwd":".","shell":"sh",
            "state":"working","pid":1,"created_at_ms":0,"last_activity_at_ms":0,"output_seq":0,"rows":10,"cols":10});
        fs::write(dir.path().join("sessions.json"), serde_json::json!([session]).to_string()).unwrap();
        fs::write(dir.path().join("conversations.json"), serde_json::json!({"conversations":[{"id":"conv","project_id":"p","cwd":".",
            "title":"t","created_at_ms":0,"segments":[{"provider":"claude","profile_id":"claude-padrao",
            "external_session_id":"ext","terminal_session_id":"s","started_at_ms":0}]}]}).to_string()).unwrap();
        let sessions = load_historical_sessions(&dir.path().join("sessions.json"));
        let meta = sessions["s"].metadata();
        assert_eq!(meta.provider.as_deref(), Some("claude"));
        assert_eq!(meta.profile_id.as_deref(), Some("claude-padrao"));
        assert_eq!(meta.conversation_id.as_deref(), Some("conv"));
        assert_eq!(meta.external_session_id.as_deref(), Some("ext"));
    }

    #[test]
    fn list_sessions_troca_novo_agente_pelo_primeiro_prompt_do_codex() {
        let state = test_state();
        let dir = state.state_file.parent().unwrap();
        let config_dir = dir.join("codex");
        let sessions_dir = config_dir.join("sessions").join("1970").join("01").join("01");
        fs::create_dir_all(&sessions_dir).unwrap();
        fs::write(sessions_dir.join("rollout-codex.jsonl"), [
            serde_json::json!({"type":"session_meta","payload":{"id":"codex-1","cwd":"C:/projeto","timestamp":"1970-01-01T00:00:10Z"}}),
            serde_json::json!({"type":"response_item","payload":{"type":"message","role":"user","content":[{"type":"input_text","text":"Criar relatório financeiro"}]}}),
        ].iter().map(serde_json::Value::to_string).collect::<Vec<_>>().join("\n")).unwrap();
        atomic_write_json(&dir.join("profiles.json"), &serde_json::json!({"profiles":[{
            "id":"codex-p","provider":"codex","name":"Codex","config_dir":config_dir,
            "builtin":true,"created_at_ms":0
        }]})).unwrap();
        atomic_write_json(&dir.join("conversations.json"), &serde_json::json!({"version":1,"conversations":[{
            "id":"conv","project_id":"p","cwd":"C:/projeto","title":"Projeto · novo agente",
            "created_at_ms":9_000,"segments":[{"provider":"codex","profile_id":"codex-p",
            "external_session_id":null,"transcript_path":null,"terminal_session_id":"s",
            "started_at_ms":9_000,"ended_at_ms":null}]
        }]})).unwrap();
        let session: TerminalSession = serde_json::from_value(serde_json::json!({
            "id":"s","project_id":"p","name":"Projeto · novo agente","cwd":"C:/projeto","shell":"sh",
            "state":"answered","pid":null,"created_at_ms":9_000,"last_activity_at_ms":9_000,
            "output_seq":0,"rows":10,"cols":10,"provider":"codex","profile_id":"codex-p",
            "conversation_id":"conv"
        })).unwrap();
        state.sessions.lock().unwrap().insert("s".into(), SessionEntry::Historical(session));

        let EngineResponse::Sessions { sessions } = list_sessions(&state).unwrap() else { panic!("sessions expected") };
        assert_eq!(sessions[0].name, "Criar relatório financeiro");
        let conversations = omni_core::conversations::read_index(dir);
        assert_eq!(conversations[0].segments[0].external_session_id.as_deref(), Some("codex-1"));
        assert!(conversations[0].segments[0].transcript_path.is_some());
    }

    #[tokio::test]
    async fn two_tcp_clients_can_read_independently() {
        let state = test_state();
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let server = tokio::spawn(async move {
            let mut clients = Vec::new();
            for _ in 0..2 {
                let (stream, _) = listener.accept().await.unwrap();
                clients.push(tokio::spawn(serve_client(stream, state.clone())));
            }
            for client in clients { client.await.unwrap().unwrap(); }
        });
        async fn client(address: std::net::SocketAddr) {
            let stream = TcpStream::connect(address).await.unwrap();
            let mut stream = BufReader::new(stream);
            for (kind, expected) in [("ping", "pong"), ("list_sessions", "sessions")] {
                let request = serde_json::json!({"type":kind,"token":"test-token"});
                stream.get_mut().write_all(format!("{request}\n").as_bytes()).await.unwrap();
                let mut line = String::new(); stream.read_line(&mut line).await.unwrap();
                let response: serde_json::Value = serde_json::from_str(&line).unwrap();
                assert_eq!(response["type"], expected);
            }
        }
        tokio::time::timeout(std::time::Duration::from_secs(5), async {
            tokio::join!(client(address), client(address)); server.await.unwrap();
        }).await.unwrap();
    }

    #[test]
    fn usage_without_existing_claude_session_never_spawns() {
        let state = test_state();
        let EngineResponse::AccountUsage { usage } = interaction::account_usage(&state, "missing", true).unwrap() else { panic!("usage response expected") };
        assert_eq!(usage.status, "unavailable");
        assert!(usage.primary.is_none());
        assert!(usage.reason.is_some_and(|reason| reason.contains("não encontrada")));
        assert!(state.sessions.lock().unwrap().is_empty());
    }

    #[test]
    fn restart_session_keeps_id_but_gets_a_new_pid() {
        let state = test_state();
        let cwd = env::temp_dir().to_string_lossy().into_owned();
        let id = state.next_id();
        let spawned = spawn_terminal_inner(
            &state,
            id.clone(),
            "project".into(),
            "test".into(),
            cwd,
            Some(default_shell()),
            None,
            24,
            80,
            now_ms(),
            SessionOrigin::default(),
        )
        .expect("spawn should succeed");
        assert_eq!(spawned.id, id);

        let response = restart_session(&state, &id).expect("restart should succeed");
        let EngineResponse::Session { session } = response else {
            panic!("expected a session response");
        };
        assert_eq!(session.id, id);
        assert_eq!(session.state, SessionState::Working);
        assert_ne!(session.pid, spawned.pid, "restart should replace the running process");
    }

    /// A identidade do engine não pode chegar aos terminais. Foi o que fez `npm run dev`, rodado dentro
    /// do OMNI instalado, conversar com o engine instalado em vez de abrir o próprio.
    #[test]
    fn terminal_nao_herda_a_identidade_do_engine() {
        env::set_var("OMNI_ENGINE_PORT", "47321");
        env::set_var("OMNI_DATA_DIR", r"C:\dados\com.omni.agents\engine");
        let mut command = CommandBuilder::new("shell");
        ambiente_do_terminal(&mut command, &[("CLAUDE_CONFIG_DIR".into(), r"C:\conta".into())]);

        for nome in VARIAVEIS_DO_ENGINE {
            assert!(command.get_env(nome).is_none(), "{nome} vazou para o terminal");
        }
        assert_eq!(command.get_env("OMNI_AGENTS").and_then(|v| v.to_str()), Some("1"));
        assert_eq!(command.get_env("CLAUDE_CONFIG_DIR").and_then(|v| v.to_str()), Some(r"C:\conta"),
            "o isolamento de conta continua passando");
    }

    fn sessao_claude(config_dir: &Path, comando: &str) -> TerminalSession {
        serde_json::from_value(serde_json::json!({
            "id": "t", "project_id": "p", "name": "Claude · agent", "cwd": "C:/projeto", "shell": "bash",
            "state": "stopped", "pid": null, "created_at_ms": 0, "last_activity_at_ms": 0, "output_seq": 0,
            "rows": 24, "cols": 80,
            "provider": "claude", "external_session_id": "abc-123",
            "initial_command": comando,
            "env": [["CLAUDE_CONFIG_DIR", config_dir.to_string_lossy()]],
        })).expect("sessão de teste")
    }

    /// "Reiniciar" numa conversa Claude com histórico tem de voltar para ela, não abrir outra: antes
    /// repetia `--session-id` e era preciso digitar `claude -r` à mão.
    #[test]
    fn reiniciar_conversa_claude_com_historico_retoma_a_mesma() {
        let dir = tempfile::tempdir().unwrap();
        let sessao = sessao_claude(dir.path(), "claude --session-id abc-123");

        // Sem transcript (nenhuma mensagem ainda), `--resume` falharia: mantém o comando original.
        assert_eq!(comando_ao_reiniciar(&sessao).as_deref(), Some("claude --session-id abc-123"));

        let transcript = omni_core::conversations::claude_transcript_path(dir.path(), "C:/projeto", "abc-123");
        fs::create_dir_all(transcript.parent().unwrap()).unwrap();
        fs::write(&transcript, "{}\n").unwrap();
        assert_eq!(comando_ao_reiniciar(&sessao).as_deref(), Some("claude --resume abc-123"));
    }

    #[test]
    fn reiniciar_nao_mexe_no_que_nao_e_conversa_claude_nova() {
        let dir = tempfile::tempdir().unwrap();
        let transcript = omni_core::conversations::claude_transcript_path(dir.path(), "C:/projeto", "abc-123");
        fs::create_dir_all(transcript.parent().unwrap()).unwrap();
        fs::write(&transcript, "{}\n").unwrap();

        // Já é retomada (veio de uma troca de conta): fica como está.
        let retomada = sessao_claude(dir.path(), "claude --resume abc-123");
        assert_eq!(comando_ao_reiniciar(&retomada).as_deref(), Some("claude --resume abc-123"));

        // Outro provider não usa `--session-id`.
        let mut codex = sessao_claude(dir.path(), "codex");
        codex.provider = Some("codex".into());
        assert_eq!(comando_ao_reiniciar(&codex).as_deref(), Some("codex"));
        let agy = com_log_do_antigravity("agy", "terminal-9");
        assert!(agy.starts_with("agy --log-file \"") && agy.ends_with("/log/omni-terminal-9.log\""), "{agy}");
        assert!(!agy.contains('\\'), "barras normais: {agy}");
        assert_eq!(com_log_do_antigravity(&agy, "terminal-9"), agy, "não repete o --log-file");
        // Trocar modelo: o reinício mantém modelo, esforço e conversa (sem log da sessão ainda).
        let mut trocar = codex.clone();
        trocar.id = "terminal-sem-log-xyz".into();
        trocar.provider = Some("antigravity".into());
        trocar.initial_command = Some("agy --model gemini-4-argon --effort high --conversation c1".into());
        let reaberto = comando_ao_reiniciar(&trocar).unwrap();
        assert!(reaberto.starts_with("agy --log-file \"") && reaberto.ends_with(" --model gemini-4-argon --effort high --conversation c1"), "{reaberto}");

        // Terminal puro: sem comando inicial, nada é injetado.
        let mut shell = sessao_claude(dir.path(), "x");
        shell.initial_command = None;
        assert_eq!(comando_ao_reiniciar(&shell), None);
    }

    /// Contrato **não documentado** do Claude Code, lido do binário instalado: o comando final vira
    /// `"<programa>" <flags> "<comando>"`, e o parser corta o prefixo no último `" -"`. Ou seja: o
    /// prefixo tem de ser só o caminho do executável. Se alguém acrescentar uma flag aqui, o CLI
    /// passa a tratar metade do caminho como nome de programa e todo comando do agente falha em
    /// silêncio — este teste é o alarme.
    #[test]
    fn prefixo_do_claude_e_so_o_caminho_do_shim() {
        let alvo = targets::Target::Wsl { distro: "Ubuntu".into(), remote_path: "/home/ana/p".into() };
        let variaveis = variaveis_do_alvo(&alvo, r"\\wsl.localhost\Ubuntu\home\ana\p", r"C:\omni\omni-shim.exe", r"C:\dados");
        let prefixo = variaveis
            .iter()
            .find(|(chave, _)| chave == "CLAUDE_CODE_SHELL_PREFIX")
            .expect("prefixo")
            .1
            .clone();
        assert_eq!(prefixo, r"C:\omni\omni-shim.exe");
        assert!(!prefixo.contains(" -"), "flag no prefixo quebra o parser do Claude Code");
    }

    #[test]
    fn sessao_de_agente_em_projeto_remoto_recebe_o_alvo_no_ambiente() {
        let wsl = targets::Target::Wsl { distro: "Ubuntu".into(), remote_path: "/home/ana/p".into() };
        let variaveis = variaveis_do_alvo(&wsl, "raiz", "shim.exe", "dados");
        let ler = |chave: &str| variaveis.iter().find(|(k, _)| k == chave).map(|(_, v)| v.clone());
        assert_eq!(ler("OMNI_TARGET_KIND").as_deref(), Some("wsl"));
        assert_eq!(ler("OMNI_TARGET_DISTRO").as_deref(), Some("Ubuntu"));
        assert_eq!(ler("OMNI_TARGET_REMOTE_ROOT").as_deref(), Some("/home/ana/p"));
        assert_eq!(ler("OMNI_TARGET_LOCAL_ROOT").as_deref(), Some("raiz"));

        let ssh = targets::Target::Ssh { connection_id: "srv1".into(), remote_path: "/srv/app".into() };
        let variaveis = variaveis_do_alvo(&ssh, "X:", "shim.exe", "dados");
        assert!(variaveis.contains(&("OMNI_TARGET_KIND".into(), "ssh".into())));
        assert!(variaveis.contains(&("OMNI_TARGET_SSH_ID".into(), "srv1".into())));
    }

    /// Projeto local não ganha desvio nenhum, e terminal comum também não: lá o shell já abre
    /// dentro do alvo, e um prefixo por cima desviaria o comando duas vezes.
    #[test]
    fn projeto_local_e_terminal_comum_nao_recebem_desvio() {
        assert!(ambiente_do_alvo(&targets::Target::Local, r"D:\p", true).is_empty());
        let wsl = targets::Target::Wsl { distro: "Ubuntu".into(), remote_path: "/home/ana/p".into() };
        assert!(ambiente_do_alvo(&wsl, "raiz", false).is_empty());
    }

    #[test]
    fn cursor_report_responde_cada_pergunta_em_1_based() {
        assert_eq!(cursor_report("\x1b[6n", (0, 0)).as_deref(), Some("\x1b[1;1R"));
        assert_eq!(cursor_report("abc\x1b[6nxyz\x1b[6n", (9, 2)).as_deref(), Some("\x1b[10;3R\x1b[10;3R"));
        // A resposta do xterm some; tecla de verdade (setas, texto, ESC solto, colagem) passa.
        assert_eq!(sem_respostas_de_cursor("\x1b[12;40R"), "");
        assert_eq!(sem_respostas_de_cursor("ls\x1b[1;1R\r"), "ls\r");
        assert_eq!(sem_respostas_de_cursor("\x1b[A\x1b[B\x1b"), "\x1b[A\x1b[B\x1b");
        assert_eq!(sem_respostas_de_cursor("\x1b[200~colado\x1b[201~"), "\x1b[200~colado\x1b[201~");
        assert_eq!(cursor_report("sem pergunta", (0, 0)), None);
    }

    /// Reproduz o travamento real: PTY aberta sem terminal exibindo (celular, ou aba na visão Conversa).
    /// O ConPTY manda `ESC[6n` e para até ter resposta; antes, o comando injetado nunca rodava. O
    /// engine responde e o shell segue.
    #[cfg(windows)]
    #[test]
    fn sessao_sem_terminal_exibindo_nao_trava_no_pedido_de_cursor() {
        let state = test_state();
        let cwd = env::temp_dir().to_string_lossy().into_owned();
        let id = state.next_id();
        spawn_terminal_inner(
            &state,
            id.clone(),
            "project".into(),
            "headless".into(),
            cwd,
            Some(default_shell()),
            Some("echo OMNI_HEADLESS_OK".into()),
            24,
            80,
            now_ms(),
            SessionOrigin { ..SessionOrigin::default() },
        )
        .expect("spawn should succeed");

        let mut saida = String::new();
        let limite = std::time::Instant::now() + std::time::Duration::from_secs(15);
        while std::time::Instant::now() < limite {
            let sessions = state.sessions.lock().unwrap();
            if let Some(SessionEntry::Live(session)) = sessions.get(&id) {
                saida = session.output.lock().unwrap().chunks.iter().map(|(_, c)| c.as_str()).collect();
            }
            drop(sessions);
            // O comando aparece duas vezes quando roda: o eco da digitação e a saída do `echo`.
            if saida.matches("OMNI_HEADLESS_OK").count() >= 2 { break; }
            std::thread::sleep(std::time::Duration::from_millis(100));
        }
        let _ = close_session(&state, &id);
        assert!(saida.matches("OMNI_HEADLESS_OK").count() >= 2, "o shell não chegou a rodar o comando: {saida:?}");
    }

    /// Reiniciar a aba de um fork retoma a cópia; repetir o `--fork-session` bifurcaria outra vez.
    #[test]
    fn reiniciar_um_fork_retoma_a_copia() {
        let pasta = tempfile::tempdir().unwrap();
        let cwd = "C:/projeto";
        let novo = "11111111-2222-3333-4444-555555555555";
        let transcript = omni_core::conversations::claude_transcript_path(pasta.path(), cwd, novo);
        fs::create_dir_all(transcript.parent().unwrap()).unwrap();
        fs::write(&transcript, "{}\n").unwrap();
        let meta: TerminalSession = serde_json::from_value(serde_json::json!({
            "id":"s","project_id":"p","name":"x","cwd":cwd,"shell":"bash","state":"answered","pid":null,
            "created_at_ms":1,"last_activity_at_ms":1,"output_seq":0,"rows":24,"cols":80,"provider":"claude",
            "external_session_id":novo,"env":[["CLAUDE_CONFIG_DIR",pasta.path().to_string_lossy()]],
            "initial_command":format!("claude --resume original --fork-session --session-id {novo}")
        })).unwrap();
        assert_eq!(comando_ao_reiniciar(&meta).unwrap(), format!("claude --resume {novo}"));
    }

    #[test]
    fn approval_prompt_patterns_are_detected_case_insensitively() {
        assert!(looks_like_approval_prompt("Do You Want To continue? (y/n)"));
        assert!(looks_like_approval_prompt("Allow?"));
        assert!(!looks_like_approval_prompt("just some regular output"));
    }

    /// Liga sem reescrever o resto do arquivo do usuário; desligado vira ligado; ausente é criado.
    #[test]
    fn autocompact_fica_ligado_no_settings_da_conta() {
        let dir = tempfile::tempdir().unwrap();
        let arquivo = dir.path().join("settings.json");
        let ler = || fs::read_to_string(&arquivo).unwrap();
        garantir_autocompact(dir.path());
        assert!(serde_json::from_str::<serde_json::Value>(&ler()).unwrap()["autoCompactEnabled"] == true);

        fs::write(&arquivo, "{\n  \"model\": \"opus\",\n  \"autoCompactEnabled\": false,\n  \"z\": 1\n}").unwrap();
        garantir_autocompact(dir.path());
        assert_eq!(ler(), "{\n  \"model\": \"opus\",\n  \"autoCompactEnabled\": true,\n  \"z\": 1\n}");

        fs::write(&arquivo, "{\"model\":\"opus\"}").unwrap();
        garantir_autocompact(dir.path());
        let valor: serde_json::Value = serde_json::from_str(&ler()).unwrap();
        assert!(valor["autoCompactEnabled"] == true && valor["model"] == "opus");
        assert!(Compactacao::default().valida() && !Compactacao { janela: 500_000, ..Default::default() }.valida());
    }

    #[test]
    fn notice_distinguishes_usage_limit_from_api_error() {
        assert_eq!(detect_notice("Claude usage limit reached. Resets at 3pm").as_deref(), Some("usage_limit"));
        assert_eq!(detect_notice("API Error: 529 {\"type\":\"overloaded_error\"}").as_deref(), Some("api_error"));
        assert_eq!(detect_notice("Rate limit exceeded").as_deref(), Some("usage_limit"));
        assert_eq!(detect_notice("compiling api error handling module"), None);
        // As mensagens de verdade, com o marcador da TUI na frente.
        assert_eq!(detect_notice("  ⎿  You've hit your session limit · resets 8:10pm (America/Sao_Paulo)").as_deref(), Some("usage_limit"));
        assert_eq!(detect_notice("● Usage limit reached · continuing automatically at 8:10pm · esc or type to cancel").as_deref(), Some("usage_limit"));
    }

    /// A "sessão que cai": o agente mostrou na tela o código do próprio engine com as frases de
    /// limite, e o failover trocou de conta no meio do trabalho. Frase no meio da linha não é aviso.
    #[test]
    fn frase_de_limite_no_meio_de_codigo_nao_e_aviso() {
        let grep = "831:const PATTERNS = [
    \"usage limit reached\",  // padrões do engine
  ⎿  assert_eq!(detect_notice(\"Claude usage limit reached. Resets at 3pm\"))
";
        assert_eq!(detect_notice(grep), None);
    }

    /// O relato: "um que apenas acabou está como interrompido". A mensagem de limite do turno
    /// anterior continuava na tela depois que o agente voltou e terminou normalmente.
    #[test]
    fn aviso_de_limite_de_um_turno_anterior_nao_vale_para_o_novo() {
        let limite = "> opa
  ⎿  Claude usage limit reached. Resets at 8pm
";
        assert_eq!(notice_since(notice_counts(limite), (0, 0)).as_deref(), Some("usage_limit"));
        // O turno novo começou com o aviso velho na tela: ele vira base.
        let base = notice_counts(limite);
        let terminou = format!("{limite}> continua
  Pronto, terminei.
");
        assert_eq!(notice_since(notice_counts(&terminou), base), None);
        // Bater no limite de novo neste turno é aviso.
        let de_novo = format!("{terminou}  ⎿  Claude usage limit reached. Resets at 9pm
");
        assert_eq!(notice_since(notice_counts(&de_novo), base).as_deref(), Some("usage_limit"));
    }

    /// Erro passageiro que a CLI tentou de novo, ou aviso seguido de resposta do agente: o turno
    /// seguiu e terminou normal — não é "interrompido".
    #[test]
    fn aviso_superado_no_mesmo_turno_nao_interrompe() {
        let tentou_de_novo = "❯ arruma o teste\n  ⎿  API Error (Request timed out.) · Retrying in 1 seconds… (attempt 1/10)\n● Pronto, corrigi.\n";
        assert_eq!(detect_notice(tentou_de_novo), None);
        let respondeu_depois = "  ⎿  API Error: 529 overloaded\n● Voltei, segue o resultado.\n";
        assert_eq!(detect_notice(respondeu_depois), None);
        let parou_no_erro = "● Vou rodar os testes.\n  ⎿  API Error: 529 overloaded\n";
        assert_eq!(detect_notice(parou_no_erro).as_deref(), Some("api_error"));
    }

    #[test]
    fn idle_timeout_only_demotes_working_sessions_to_answered() {
        let idle = ANSWERED_IDLE_MS + 1;
        assert_eq!(settle_state(&SessionState::Working, idle, false, false, false), (SessionState::Answered, false));
        assert_eq!(settle_state(&SessionState::Working, ANSWERED_IDLE_MS - 1, false, false, false), (SessionState::Working, false));
        assert_eq!(settle_state(&SessionState::Crashed, idle, false, false, false), (SessionState::Crashed, false));
    }

    #[test]
    fn only_a_real_agent_turn_ending_counts_as_attention() {
        let idle = ANSWERED_IDLE_MS + 1;
        // Shell puro ocioso: "answered" pra exibir, mas nunca aviso.
        assert_eq!(settle_state(&SessionState::Working, idle, false, false, true), (SessionState::Answered, false));
        // Agente parado com "esc to interrupt" na tela ainda está no turno.
        assert_eq!(settle_state(&SessionState::Working, idle, true, true, true), (SessionState::Working, false));
        // Turno acabou: aviso.
        assert_eq!(settle_state(&SessionState::Working, idle, true, false, true), (SessionState::Answered, true));
        // Ocioso sem turno (acabou de abrir, pessoa digitando no composer): sem aviso.
        assert_eq!(settle_state(&SessionState::Working, idle, true, false, false), (SessionState::Answered, false));
        assert!(in_turn("✻ Thinking… (esc to interrupt)", "claude") && in_turn("Working (5s • Esc to interrupt)", "codex"));
        assert!(in_turn("⣿  Working...
>
esc to cancel      Gemini 4 Argon · medium", "antigravity"));
        assert!(!in_turn(">
? for shortcuts      Gemini 4 Argon · medium", "antigravity"));
        assert!(!in_turn("Enter to confirm · Esc to cancel", "claude"), "menu do Claude não é turno");
    }
}
