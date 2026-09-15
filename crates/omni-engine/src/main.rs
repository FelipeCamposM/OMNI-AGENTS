mod interaction;
mod mobile;
use anyhow::{anyhow, Context, Result};
use omni_protocol::{
    atomic_write_json, EngineRequest, EngineResponse, SessionState, TerminalSession,
    DEFAULT_ENGINE_PORT, PROTOCOL_VERSION,
};
use portable_pty::{native_pty_system, Child, CommandBuilder, MasterPty, PtySize};
use rand::RngCore;
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
    /// Ninguém está exibindo esta PTY num terminal de verdade — foi aberta pelo celular. Enquanto for
    /// `true` o engine responde sozinho as perguntas que um terminal responderia (ver
    /// `answer_terminal_queries`). Vira `false` no primeiro `snapshot`, quando o xterm do desktop
    /// passa a exibir a sessão e assume essas respostas — os dois respondendo em dobro vazaria
    /// `ESC[1;1R` como texto digitado dentro do CLI.
    headless: std::sync::atomic::AtomicBool,
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
    matches!(provider, Some("claude" | "codex"))
}

/// Claude Code e Codex mostram "esc to interrupt" durante o turno inteiro (inclusive rodando
/// ferramenta) e tiram quando acabam.
fn in_turn(screen_text: &str) -> bool {
    screen_text.to_ascii_lowercase().contains("esc to interrupt")
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
    let screen_in_turn = tracked && in_turn(&interaction.parser.screen().contents());
    let idle_ms = now_ms().saturating_sub(meta.last_activity_at_ms);
    let (state, turn_finished) = settle_state(&meta.state, idle_ms, tracked, screen_in_turn, interaction.turn_active);
    if turn_finished {
        interaction.turn_active = false;
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
    usage_cache: Mutex<HashMap<String, (u64, omni_core::usage::AccountUsage)>>,
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
    let engine_dir = engine_dir()?;
    fs::create_dir_all(&engine_dir)?;
    executable_identity(); // captura antes que uma atualização troque o arquivo
    let token = load_or_create_token(&engine_dir.join("engine.token"))?;
    let state_file = engine_dir.join("sessions.json");
    let sessions = load_historical_sessions(&state_file);
    let state = Arc::new(EngineState {
        persist_lock: Mutex::new(()),
        usage_cache: Mutex::new(HashMap::new()),
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
        EngineRequest::PublishWorkspace { projects, agents, .. } => mobile::publish(state, projects, agents),
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
            SessionOrigin { headless: false, env, provider, profile_id, conversation_id, external_session_id },
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

fn ambiente_do_terminal(command: &mut CommandBuilder, env: &[(String, String)]) {
    for nome in VARIAVEIS_DO_ENGINE {
        command.env_remove(nome);
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
) -> Result<PtySpawn> {
    let cwd_path = Path::new(cwd);
    if !cwd_path.is_dir() {
        return Err(anyhow!("terminal cwd does not exist: {cwd}"));
    }

    let pty_system = native_pty_system();
    let pair = pty_system.openpty(PtySize {
        rows: rows.max(1),
        cols: cols.max(1),
        pixel_width: 0,
        pixel_height: 0,
    }).context("failed to create ConPTY")?;
    let mut command = CommandBuilder::new(shell);
    command.cwd(cwd_path);
    ambiente_do_terminal(&mut command, env);
    // Shell de login: é o `.zprofile`/`.bash_profile` que põe Homebrew e `~/.local/bin` no PATH,
    // onde `claude` e `codex` costumam morar no macOS e no Linux.
    #[cfg(not(windows))]
    command.arg("-l");
    #[cfg(windows)]
    if shell.to_ascii_lowercase().contains("powershell")
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
    pub headless: bool,
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
            headless: false,
            env: session.env.clone(),
            provider: session.provider.clone(),
            profile_id: session.profile_id.clone(),
            conversation_id: session.conversation_id.clone(),
            external_session_id: session.external_session_id.clone(),
        }
    }
}

#[allow(clippy::too_many_arguments)]
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
    let headless = origin.headless;
    let (pid, writer, master, child, reader) = open_pty_and_spawn(&cwd, &shell, rows, cols, &origin.env)?;
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
        headless: std::sync::atomic::AtomicBool::new(headless),
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

enum RestartTarget {
    Live(Arc<LiveSession>),
    Historical(TerminalSession),
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
                let _ = child.kill();
            }
            let meta = session.meta.lock().map_err(|_| anyhow!("session metadata poisoned"))?.clone();
            context.parser = vt100::Parser::new(meta.rows, meta.cols, 0);
            context.input_revision += 1;
            context.turn_active = false;
            let (pid, writer, master, child, reader) =
                open_pty_and_spawn(&meta.cwd, &meta.shell, meta.rows, meta.cols, &meta.env)?;
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
            drop(context);
            state.persist()?;
            // Reinvoke the same agent/CLI the session was originally launched with.
            spawn_initial_command_thread(session.clone(), meta.initial_command.clone());
            spawn_reader_thread(state.clone(), session, reader, pid);
            Ok(EngineResponse::Session { session: updated })
        }
        // No in-memory scrollback survives a session that was already stopped/orphaned
        // before this engine process started — nothing to preserve, so a fresh
        // LiveSession (same id) via spawn_terminal_inner is the whole job.
        RestartTarget::Historical(meta) => {
            let origin = SessionOrigin::of(&meta);
            let metadata = spawn_terminal_inner(
                state,
                meta.id,
                meta.project_id,
                meta.name,
                meta.cwd,
                Some(meta.shell),
                meta.initial_command,
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
/// ponytail: lista de frases em inglês colada contra as mensagens do Claude Code/Codex — outro
/// CLI, outro idioma, ou uma troca de texto pelo provider vira falso negativo (o item ainda
/// aparece como "terminou", só perde o rótulo). Upgrade path: sinal estruturado do provider.
const USAGE_LIMIT_PATTERNS: [&str; 4] = [
    "usage limit reached",  // Claude Code: "Claude usage limit reached. Your limit will reset at ..."
    "hit your usage limit", // Codex: "You've hit your usage limit."
    "5-hour limit reached",
    "rate limit exceeded",
];
const API_ERROR_PATTERNS: [&str; 5] = [
    "api error:", // "API Error: 529 {\"type\":\"overloaded_error\"}"
    "overloaded_error",
    "authentication_error",
    "invalid_api_key",
    "credit balance is too low",
];

/// Lê a TELA (vt100), não o chunk: a mensagem some sozinha quando sai de vista, então não existe
/// código de limpeza espalhado por write/stop/restart, e uma frase partida entre duas leituras de
/// 8 KB continua sendo reconhecida — bug que a varredura por chunk tem de graça.
fn detect_notice(screen_text: &str) -> Option<String> {
    let lower = screen_text.to_ascii_lowercase();
    // Limite antes de erro: "rate limit exceeded" casa nos dois, e "estourou o limite" é a
    // informação acionável (esperar o reset); "erro de API" só mandaria tentar de novo.
    if USAGE_LIMIT_PATTERNS.iter().any(|pattern| lower.contains(pattern)) {
        return Some("usage_limit".into());
    }
    if API_ERROR_PATTERNS.iter().any(|pattern| lower.contains(pattern)) {
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
    interaction.parser.process(bytes);
    if session.headless.load(Ordering::SeqCst) {
        answer_terminal_queries(session, &data, interaction.parser.screen());
    }
    let screen_text = interaction.parser.screen().contents();
    let approval_requested = match &tracked_provider {
        // O diálogo real, reconhecido estrito — não "do you want to" solto numa resposta do agente.
        Some(provider) => {
            let dialog = interaction::approval(&screen_text, provider).is_some();
            if dialog || in_turn(&screen_text) { interaction.turn_active = true; }
            dialog
        }
        None => looks_like_approval_prompt(&data),
    };
    let notice = detect_notice(&screen_text);
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
            let next = if approval_requested { SessionState::ApprovalRequired } else { SessionState::Working };
            if tracked_provider.is_some() && next == SessionState::ApprovalRequired && meta.state != next {
                meta.attention_seq += 1;
            }
            meta.state = next;
            meta.notice = notice;
        }
    }
}

/// Responde as perguntas que um terminal de verdade responderia, para PTYs que ninguém está exibindo.
///
/// **Sem isto, sessão aberta pelo celular nunca iniciava.** O ConPTY do Windows manda `ESC[6n`
/// ("onde está o cursor?") ao criar a PTY e **para** até receber `ESC[linha;colunaR`. No desktop
/// quem responde é o xterm.js; headless, ninguém respondia: a saída ficava só no `ESC[6n`, o bash
/// não terminava de subir, o `claude` injetado nunca rodava, e o celular dizia "entrada do CLI não
/// reconhecida". Confirmado respondendo `ESC[1;1R` à mão numa sessão travada: ela destravou na hora.
///
/// A posição vem do `vt100` que o engine já mantém, já com o chunk aplicado.
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

fn write_terminal(state: &EngineState, session_id: &str, data: &str) -> Result<EngineResponse> {
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
    session.child.lock().map_err(|_| anyhow!("terminal child poisoned"))?.kill()?;
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
        let _ = session
            .child
            .lock()
            .map_err(|_| anyhow!("terminal child poisoned"))?
            .kill();
    }
    state.persist()?;
    Ok(EngineResponse::Ok)
}

fn snapshot(state: &EngineState, session_id: &str, since: u64) -> Result<EngineResponse> {
    let sessions = state.sessions.lock().map_err(|_| anyhow!("sessions lock poisoned"))?;
    let entry = sessions.get(session_id).ok_or_else(|| anyhow!("session not found"))?;
    let session_meta = entry.metadata();
    let SessionEntry::Live(session) = entry else {
        return Ok(EngineResponse::Snapshot { session: session_meta, from_seq: since, next_seq: since, data: String::new() });
    };
    // Snapshot só vem de quem renderiza a PTY num terminal (o xterm do desktop). A partir daqui é ele
    // quem responde as perguntas do terminal.
    session.headless.store(false, Ordering::SeqCst);
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

    fn test_state() -> Arc<EngineState> {
        let dir = env::temp_dir().join(format!("omni-engine-test-{}-{:x}", now_ms(), rand::random::<u64>()));
        fs::create_dir_all(&dir).expect("create temp state dir");
        Arc::new(EngineState {
            persist_lock: Mutex::new(()),
            usage_cache: Mutex::new(HashMap::new()),
            mobile: mobile::MobileRuntime::new(&dir),
            token: "test-token".into(),
            state_file: dir.join("sessions.json"),
            sessions: Mutex::new(HashMap::new()),
            id_sequence: AtomicU64::new(1),
        })
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
        assert_eq!(usage.status, "unknown");
        assert!(usage.primary.is_none());
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

    #[test]
    fn cursor_report_responde_cada_pergunta_em_1_based() {
        assert_eq!(cursor_report("\x1b[6n", (0, 0)).as_deref(), Some("\x1b[1;1R"));
        assert_eq!(cursor_report("abc\x1b[6nxyz\x1b[6n", (9, 2)).as_deref(), Some("\x1b[10;3R\x1b[10;3R"));
        assert_eq!(cursor_report("sem pergunta", (0, 0)), None);
    }

    /// Reproduz o travamento real: PTY aberta sem terminal exibindo. O ConPTY manda `ESC[6n` e para
    /// até ter resposta; antes, o comando injetado nunca rodava. Com `headless`, o engine responde e
    /// o shell segue.
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
            SessionOrigin { headless: true, ..SessionOrigin::default() },
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

    #[test]
    fn approval_prompt_patterns_are_detected_case_insensitively() {
        assert!(looks_like_approval_prompt("Do You Want To continue? (y/n)"));
        assert!(looks_like_approval_prompt("Allow?"));
        assert!(!looks_like_approval_prompt("just some regular output"));
    }

    #[test]
    fn notice_distinguishes_usage_limit_from_api_error() {
        assert_eq!(detect_notice("Claude usage limit reached. Resets at 3pm").as_deref(), Some("usage_limit"));
        assert_eq!(detect_notice("API Error: 529 {\"type\":\"overloaded_error\"}").as_deref(), Some("api_error"));
        // "rate limit exceeded" casa nas duas listas; o limite vence porque é o acionável.
        assert_eq!(detect_notice("Rate limit exceeded").as_deref(), Some("usage_limit"));
        assert_eq!(detect_notice("compiling api error handling module"), None);
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
        assert!(in_turn("✻ Thinking… (esc to interrupt)") && in_turn("Working (5s • Esc to interrupt)"));
    }
}
