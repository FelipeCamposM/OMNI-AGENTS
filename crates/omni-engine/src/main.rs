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
/// `Answered` instead. ponytail: a fixed idle timeout is a naive proxy for "the agent
/// stopped producing output" — a silent long-running build looks identical to an
/// answered prompt. Upgrade path: providers emitting a structured "done" signal.
const ANSWERED_IDLE_MS: u64 = 1_500;

fn apply_idle_timeout(state: SessionState, last_activity_at_ms: u64, now_ms: u64) -> SessionState {
    if state == SessionState::Working && now_ms.saturating_sub(last_activity_at_ms) > ANSWERED_IDLE_MS {
        SessionState::Answered
    } else {
        state
    }
}

impl SessionEntry {
    fn metadata(&self) -> TerminalSession {
        match self {
            Self::Live(session) => {
                let mut meta = session.meta.lock().expect("session metadata poisoned").clone();
                meta.state = apply_idle_timeout(meta.state, meta.last_activity_at_ms, now_ms());
                meta
            }
            Self::Historical(session) => session.clone(),
        }
    }
}

struct EngineState {
    token: String,
    state_file: PathBuf,
    sessions: Mutex<HashMap<String, SessionEntry>>,
    id_sequence: AtomicU64,
}

impl EngineState {
    fn persist(&self) -> Result<()> {
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
    let token = load_or_create_token(&engine_dir.join("engine.token"))?;
    let state_file = engine_dir.join("sessions.json");
    let sessions = load_historical_sessions(&state_file);
    let state = Arc::new(EngineState {
        token,
        state_file,
        sessions: Mutex::new(sessions),
        id_sequence: AtomicU64::new(1),
    });

    let listener = TcpListener::bind(("127.0.0.1", DEFAULT_ENGINE_PORT))
        .await
        .with_context(|| format!("engine already running or port {DEFAULT_ENGINE_PORT} unavailable"))?;

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
            Ok(request) if request.token() == state.token => handle_request(request, &state),
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
        EngineRequest::Ping { .. } => {
            return EngineResponse::Pong {
                protocol_version: PROTOCOL_VERSION,
                engine_pid: std::process::id(),
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
    command.env("OMNI_AGENTS", "1");
    // Isolamento de conta: o CLI é digitado no shell, então herda o ambiente daqui.
    for (key, value) in env {
        command.env(key, value);
    }
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
                Ok(length) => append_output(&session, String::from_utf8_lossy(&bytes[..length]).into_owned()),
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
struct SessionOrigin {
    env: Vec<(String, String)>,
    provider: Option<String>,
    profile_id: Option<String>,
    conversation_id: Option<String>,
    external_session_id: Option<String>,
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
fn spawn_terminal_inner(
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
        env: origin.env,
        provider: origin.provider,
        profile_id: origin.profile_id,
        conversation_id: origin.conversation_id,
        external_session_id: origin.external_session_id,
    };
    let session = Arc::new(LiveSession {
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
            if let Ok(mut child) = session.child.lock() {
                let _ = child.kill();
            }
            let meta = session.meta.lock().map_err(|_| anyhow!("session metadata poisoned"))?.clone();
            let (pid, writer, master, child, reader) =
                open_pty_and_spawn(&meta.cwd, &meta.shell, meta.rows, meta.cols, &meta.env)?;
            *session.writer.lock().map_err(|_| anyhow!("terminal writer poisoned"))? = writer;
            *session.master.lock().map_err(|_| anyhow!("terminal master poisoned"))? = master;
            *session.child.lock().map_err(|_| anyhow!("terminal child poisoned"))? = child;
            let updated = {
                let mut meta = session.meta.lock().map_err(|_| anyhow!("session metadata poisoned"))?;
                meta.pid = pid;
                meta.state = SessionState::Working;
                meta.last_activity_at_ms = now_ms();
                meta.clone()
            };
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
/// ponytail: hardcoded phrase list tuned against Claude Code/Codex/Cursor/Gemini — a
/// CLI outside this set, or one running in another language, gives a false negative.
/// Upgrade path: providers emitting a structured "needs approval" signal instead of text.
const APPROVAL_PROMPT_PATTERNS: [&str; 4] = ["(y/n)", "do you want to", "allow?", "permitir?"];

fn looks_like_approval_prompt(chunk: &str) -> bool {
    let lower = chunk.to_ascii_lowercase();
    APPROVAL_PROMPT_PATTERNS.iter().any(|pattern| lower.contains(pattern))
}

fn append_output(session: &LiveSession, data: String) {
    if data.is_empty() {
        return;
    }
    let length = data.len();
    let approval_requested = looks_like_approval_prompt(&data);
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
            meta.state = if approval_requested { SessionState::ApprovalRequired } else { SessionState::Working };
        }
    }
}

fn write_terminal(state: &EngineState, session_id: &str, data: &str) -> Result<EngineResponse> {
    let sessions = state.sessions.lock().map_err(|_| anyhow!("sessions lock poisoned"))?;
    let SessionEntry::Live(session) = sessions.get(session_id).ok_or_else(|| anyhow!("session not found"))? else {
        return Err(anyhow!("session is not running"));
    };
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

fn engine_dir() -> Result<PathBuf> {
    let base = env::var_os("LOCALAPPDATA").ok_or_else(|| anyhow!("LOCALAPPDATA is unavailable"))?;
    Ok(PathBuf::from(base).join("com.omni.agents").join("engine"))
}

fn load_or_create_token(path: &Path) -> Result<String> {
    if let Ok(token) = fs::read_to_string(path) {
        let token = token.trim();
        if token.len() >= 32 {
            return Ok(token.to_owned());
        }
    }
    let mut bytes = [0_u8; 32];
    rand::rng().fill_bytes(&mut bytes);
    let token: String = bytes.iter().map(|byte| format!("{byte:02x}")).collect();
    fs::write(path, &token)?;
    Ok(token)
}

fn load_historical_sessions(path: &Path) -> HashMap<String, SessionEntry> {
    let sessions = fs::read(path)
        .ok()
        .and_then(|data| serde_json::from_slice::<Vec<TerminalSession>>(&data).ok())
        .unwrap_or_default();
    sessions
        .into_iter()
        .map(|mut session| {
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
        let dir = env::temp_dir().join(format!("omni-engine-test-{}", now_ms()));
        fs::create_dir_all(&dir).expect("create temp state dir");
        Arc::new(EngineState {
            token: "test-token".into(),
            state_file: dir.join("sessions.json"),
            sessions: Mutex::new(HashMap::new()),
            id_sequence: AtomicU64::new(1),
        })
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

    #[test]
    fn approval_prompt_patterns_are_detected_case_insensitively() {
        assert!(looks_like_approval_prompt("Do You Want To continue? (y/n)"));
        assert!(looks_like_approval_prompt("Allow?"));
        assert!(!looks_like_approval_prompt("just some regular output"));
    }

    #[test]
    fn idle_timeout_only_demotes_working_sessions_to_answered() {
        assert_eq!(apply_idle_timeout(SessionState::Working, 0, ANSWERED_IDLE_MS + 1), SessionState::Answered);
        assert_eq!(apply_idle_timeout(SessionState::Working, 0, ANSWERED_IDLE_MS - 1), SessionState::Working);
        assert_eq!(apply_idle_timeout(SessionState::Crashed, 0, ANSWERED_IDLE_MS + 1), SessionState::Crashed);
    }
}
