use omni_protocol::{EngineRequest, EngineResponse, DEFAULT_ENGINE_PORT};
use std::{
    env,
    fs,
    io::{BufRead, BufReader, Write},
    net::{TcpStream, ToSocketAddrs},
    path::PathBuf,
    process::{Command, Stdio},
    thread,
    time::Duration,
};
use serde::Serialize;
use serde_json::{json, Value};

const CONNECT_TIMEOUT: Duration = Duration::from_millis(400);

#[tauri::command]
pub fn engine_status() -> EngineResponse {
    match authenticated_request(|token| EngineRequest::Ping { token }) {
        Ok(response) => response,
        Err(error) => EngineResponse::Error {
            code: "ENGINE_OFFLINE".into(),
            message: error,
        },
    }
}

#[tauri::command]
pub fn ensure_engine() -> EngineResponse {
    if let Ok(response) = authenticated_request(|token| EngineRequest::Ping { token }) {
        return response;
    }
    if let Err(error) = spawn_engine() {
        return EngineResponse::Error { code: "ENGINE_START_FAILED".into(), message: error };
    }
    for _ in 0..30 {
        thread::sleep(Duration::from_millis(100));
        if let Ok(response) = authenticated_request(|token| EngineRequest::Ping { token }) {
            return response;
        }
    }
    EngineResponse::Error {
        code: "ENGINE_START_TIMEOUT".into(),
        message: "O OMNI Engine não respondeu após 3 segundos.".into(),
    }
}

#[tauri::command]
pub fn terminal_sessions() -> EngineResponse {
    request_or_error(|token| EngineRequest::ListSessions { token })
}

#[tauri::command]
pub fn spawn_terminal(
    project_id: String,
    name: String,
    cwd: String,
    shell: Option<String>,
    initial_command: Option<String>,
    rows: u16,
    cols: u16,
) -> EngineResponse {
    request_or_error(|token| EngineRequest::SpawnTerminal {
        token,
        project_id,
        name,
        cwd,
        shell,
        initial_command,
        rows,
        cols,
    })
}

#[derive(Serialize)]
pub struct AgentCliStatus {
    id: &'static str,
    label: &'static str,
    command: String,
    available: bool,
}

#[tauri::command]
pub fn agent_cli_statuses() -> Vec<AgentCliStatus> {
    [
        ("claude", "Claude", &["claude"][..]),
        ("codex", "Codex", &["codex"][..]),
        ("gemini", "Gemini", &["gemini"][..]),
        ("cursor", "Cursor", &["cursor-agent", "agent"][..]),
    ]
    .into_iter()
    .map(|(id, label, candidates)| {
        let command = candidates
            .iter()
            .find(|candidate| command_exists(candidate))
            .copied()
            .unwrap_or(candidates[0]);
        AgentCliStatus { id, label, command: command.to_owned(), available: command_exists(command) }
    })
    .collect()
}

#[tauri::command]
pub fn connect_agent_cli(id: String) -> Result<(), String> {
    let (command, arguments): (&str, &[&str]) = match id.as_str() {
        "cursor" => (first_available(&["cursor-agent", "agent"]).ok_or("Cursor CLI não encontrada")?, &["login"]),
        "gemini" => (first_available(&["gemini"]).ok_or("Gemini CLI não encontrada")?, &[]),
        "claude" => (first_available(&["claude"]).ok_or("Claude CLI não encontrada")?, &[]),
        "codex" => (first_available(&["codex"]).ok_or("Codex CLI não encontrada")?, &["login"]),
        _ => return Err("Provider de agente desconhecido".into()),
    };

    let mut invocation = format!("& {}", quote_powershell(command));
    for argument in arguments {
        invocation.push(' ');
        invocation.push_str(&quote_powershell(argument));
    }
    Command::new("powershell.exe")
        .args(["-NoLogo", "-NoExit", "-Command", &invocation])
        .spawn()
        .map(|_| ())
        .map_err(|error| error.to_string())
}

/// Pré-aprova o diálogo de "trust this folder" do CLI de agente antes de abrir a PTY, no mesmo
/// espírito do `ensureTrusted` do Maestrus (electron/claude-pty.js): grava a confirmação de
/// confiança diretamente no arquivo de config do CLI. Tabela por agente — hoje só o Claude Code
/// tem esse diálogo confirmado; adicionar outro é só uma entrada nova aqui.
#[tauri::command]
pub fn ensure_agent_trust(agent_id: String, cwd: String) -> Result<(), String> {
    match agent_id.as_str() {
        "claude" => trust_claude(&cwd),
        _ => Ok(()),
    }
}

fn trust_claude(cwd: &str) -> Result<(), String> {
    let home = env::var_os("USERPROFILE")
        .or_else(|| env::var_os("HOME"))
        .ok_or("diretório do usuário não encontrado")?;
    let config_path = PathBuf::from(home).join(".claude.json");

    let mut data: Value = fs::read_to_string(&config_path)
        .ok()
        .and_then(|text| serde_json::from_str(&text).ok())
        .filter(Value::is_object)
        .unwrap_or_else(|| json!({}));

    let projects = data
        .as_object_mut()
        .expect("data é sempre um objeto (garantido acima)")
        .entry("projects")
        .or_insert_with(|| json!({}));
    if !projects.is_object() {
        *projects = json!({});
    }

    // O Claude Code CLI grava a chave de projeto com "/" mesmo no Windows (conferido lendo um
    // ~/.claude.json real: "D:/PROGRAMACAO/.../OMNI-AGENTS") — `cwd` chega com "\" (path nativo do
    // Windows), então gravar sem normalizar cria uma entrada que o CLI nunca lê de volta.
    let key = cwd.trim_end_matches(['\\', '/']).replace('\\', "/");

    let entry = projects
        .as_object_mut()
        .expect("acabou de ser garantido como objeto")
        .entry(key)
        .or_insert_with(|| json!({}));
    if !entry.is_object() {
        *entry = json!({});
    }
    entry
        .as_object_mut()
        .expect("acabou de ser garantido como objeto")
        .insert("hasTrustDialogAccepted".into(), json!(true));

    let serialized = serde_json::to_string_pretty(&data).map_err(|error| error.to_string())?;
    fs::write(&config_path, serialized).map_err(|error| error.to_string())
}

fn first_available<'a>(commands: &'a [&str]) -> Option<&'a str> {
    commands.iter().find(|command| command_exists(command)).copied()
}

fn quote_powershell(value: &str) -> String {
    format!("'{}'", value.replace('\'', "''"))
}

fn command_exists(command: &str) -> bool {
    #[cfg(windows)]
    return Command::new("where.exe")
        .arg(command)
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .is_ok_and(|status| status.success());

    #[cfg(not(windows))]
    return Command::new("sh")
        .args(["-lc", &format!("command -v -- {command}")])
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .is_ok_and(|status| status.success());
}

#[tauri::command]
pub fn write_terminal(session_id: String, data: String) -> EngineResponse {
    request_or_error(|token| EngineRequest::WriteTerminal { token, session_id, data })
}

#[tauri::command]
pub fn resize_terminal(session_id: String, rows: u16, cols: u16) -> EngineResponse {
    request_or_error(|token| EngineRequest::ResizeTerminal { token, session_id, rows, cols })
}

#[tauri::command]
pub fn stop_terminal(session_id: String) -> EngineResponse {
    request_or_error(|token| EngineRequest::StopSession { token, session_id })
}

#[tauri::command]
pub fn close_terminal(session_id: String) -> EngineResponse {
    request_or_error(|token| EngineRequest::CloseSession { token, session_id })
}

#[tauri::command]
pub fn duplicate_terminal(session_id: String) -> EngineResponse {
    request_or_error(|token| EngineRequest::DuplicateSession { token, session_id })
}

#[tauri::command]
pub fn restart_terminal(session_id: String) -> EngineResponse {
    request_or_error(|token| EngineRequest::RestartSession { token, session_id })
}

#[tauri::command]
pub fn terminal_snapshot(session_id: String, since: u64) -> EngineResponse {
    request_or_error(|token| EngineRequest::Snapshot { token, session_id, since })
}

fn request_or_error(build: impl FnOnce(String) -> EngineRequest) -> EngineResponse {
    authenticated_request(build).unwrap_or_else(|message| EngineResponse::Error {
        code: "ENGINE_UNAVAILABLE".into(),
        message,
    })
}

fn authenticated_request(build: impl FnOnce(String) -> EngineRequest) -> Result<EngineResponse, String> {
    let token = fs::read_to_string(engine_dir()?.join("engine.token"))
        .map_err(|error| format!("engine token unavailable: {error}"))?;
    send_request(build(token.trim().to_owned()))
}

fn send_request(request: EngineRequest) -> Result<EngineResponse, String> {
    let address = ("127.0.0.1", DEFAULT_ENGINE_PORT)
        .to_socket_addrs()
        .map_err(|error| error.to_string())?
        .next()
        .ok_or_else(|| "engine address unavailable".to_string())?;
    let mut stream = TcpStream::connect_timeout(&address, CONNECT_TIMEOUT).map_err(|error| error.to_string())?;
    stream.set_read_timeout(Some(Duration::from_secs(2))).map_err(|error| error.to_string())?;
    serde_json::to_writer(&mut stream, &request).map_err(|error| error.to_string())?;
    stream.write_all(b"\n").map_err(|error| error.to_string())?;
    let mut response = String::new();
    BufReader::new(stream).read_line(&mut response).map_err(|error| error.to_string())?;
    serde_json::from_str(&response).map_err(|error| error.to_string())
}

fn spawn_engine() -> Result<(), String> {
    let executable = engine_executable()?;
    if !executable.is_file() {
        return Err(format!("engine binary not found: {}", executable.display()));
    }
    let mut command = Command::new(executable);
    command.stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x0800_0000 | 0x0000_0008);
    }
    command.spawn().map(|_| ()).map_err(|error| error.to_string())
}

fn engine_executable() -> Result<PathBuf, String> {
    if let Some(path) = env::var_os("OMNI_ENGINE_PATH") {
        return Ok(PathBuf::from(path));
    }

    let extension = if cfg!(windows) { ".exe" } else { "" };
    let development = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("binaries")
        .join(format!("omni-engine-x86_64-pc-windows-msvc{extension}"));

    // In a dev build, `target/debug/` is a shared dumping ground for every binary in the
    // workspace — a stray `omni-engine.exe` left there by a plain `cargo build`/`cargo test`
    // (bypassing `scripts/build-engine.mjs`) would otherwise shadow the one that script
    // actually produces below, silently serving stale code after a rebuild.
    if cfg!(debug_assertions) && development.is_file() {
        return Ok(development);
    }

    let current = env::current_exe().map_err(|error| error.to_string())?;
    let name = if cfg!(windows) { "omni-engine.exe" } else { "omni-engine" };
    let sibling = current.with_file_name(name);
    if sibling.is_file() {
        return Ok(sibling);
    }

    Ok(development)
}

fn engine_dir() -> Result<PathBuf, String> {
    env::var_os("LOCALAPPDATA")
        .map(PathBuf::from)
        .map(|path| path.join("com.omni.agents").join("engine"))
        .ok_or_else(|| "LOCALAPPDATA unavailable".into())
}
