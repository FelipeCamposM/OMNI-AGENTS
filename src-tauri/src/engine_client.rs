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

#[allow(clippy::too_many_arguments)]
#[tauri::command]
pub fn spawn_terminal(
    project_id: String,
    name: String,
    cwd: String,
    shell: Option<String>,
    initial_command: Option<String>,
    rows: u16,
    cols: u16,
    provider: Option<String>,
    profile_id: Option<String>,
    conversation_id: Option<String>,
    external_session_id: Option<String>,
) -> EngineResponse {
    // O profile decide o config dir, e o config dir decide a conta. Resolver aqui (e não na UI)
    // mantém o mapeamento provider -> env var num lugar só.
    let profile = profile_id
        .as_deref()
        .and_then(crate::profiles::find)
        .or_else(|| provider.as_deref().and_then(crate::profiles::preferred));
    let env = profile.as_ref().map(crate::profiles::env_for).unwrap_or_default();
    if let Some(profile) = profile.as_ref() {
        crate::profiles::touch(&profile.id);
    }
    let profile_id = profile.map(|profile| profile.id);

    request_or_error(|token| EngineRequest::SpawnTerminal {
        token,
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
    })
}

/// Providers suportados: id, rótulo, candidatos de binário no PATH, args do comando de login.
/// Fonte única — `agent_cli_statuses` e `connect_agent_cli` leem daqui.
const AGENT_CLIS: [(&str, &str, &[&str], &[&str]); 4] = [
    ("claude", "Claude", &["claude"], &[]),
    ("codex", "Codex", &["codex"], &["login"]),
    ("gemini", "Gemini", &["gemini"], &[]),
    ("cursor", "Cursor", &["cursor-agent", "agent"], &["login"]),
];

#[derive(Serialize)]
pub struct AgentCliStatus {
    id: &'static str,
    label: &'static str,
    command: String,
    /// Caminho absoluto resolvido, ou `None` quando a CLI não está no PATH. Vai pro payload para
    /// que uma falha de detecção apareça na UI em vez de virar um `available: false` mudo.
    path: Option<String>,
    available: bool,
    /// O provider tem credencial gravada no config dir dele.
    authenticated: bool,
}

#[tauri::command]
pub fn agent_cli_statuses() -> Vec<AgentCliStatus> {
    AGENT_CLIS
        .into_iter()
        .map(|(id, label, candidates, _)| {
            let resolved = candidates
                .iter()
                .find_map(|candidate| resolve_on_path(candidate).map(|path| (*candidate, path)));
            AgentCliStatus {
                id,
                label,
                command: resolved
                    .as_ref()
                    .map_or_else(|| candidates[0].to_owned(), |(name, _)| (*name).to_owned()),
                path: resolved.as_ref().map(|(_, path)| path.display().to_string()),
                available: resolved.is_some(),
                // "Conectado" = existe ao menos uma conta logada neste provider. O detalhe por
                // conta sai em `list_profiles`.
                authenticated: crate::profiles::list_profiles()
                    .iter()
                    .any(|profile| profile.provider == id && profile.authenticated),
            }
        })
        .collect()
}

#[tauri::command]
pub fn connect_agent_cli(id: String, profile_id: Option<String>) -> Result<(), String> {
    let (_, _, candidates, arguments) = AGENT_CLIS
        .into_iter()
        .find(|(cli_id, ..)| *cli_id == id)
        .ok_or("Provider de agente desconhecido")?;
    let command = candidates
        .iter()
        .find(|candidate| resolve_on_path(candidate).is_some())
        .ok_or_else(|| format!("CLI do {id} não encontrada no PATH"))?;

    let mut invocation = format!("& {}", quote_powershell(command));
    for argument in arguments {
        invocation.push(' ');
        invocation.push_str(&quote_powershell(argument));
    }
    // Janela visível de propósito: aqui o console *é* a UX de login do provider.
    let mut console = Command::new("powershell.exe");
    console.args(["-NoLogo", "-NoExit", "-Command", &invocation]);
    // Sem isto o login cairia sempre no config dir nativo, e todo profile novo nasceria vazio.
    if let Some(profile) = profile_id.as_deref().and_then(crate::profiles::find) {
        for (key, value) in crate::profiles::env_for(&profile) {
            console.env(key, value);
        }
    }
    console.spawn().map(|_| ()).map_err(|error| error.to_string())
}

/// Pré-aprova o diálogo de "trust this folder" do CLI de agente antes de abrir a PTY, no mesmo
/// espírito do `ensureTrusted` do Maestrus (electron/claude-pty.js): grava a confirmação de
/// confiança diretamente no arquivo de config do CLI. Tabela por agente — hoje só o Claude Code
/// tem esse diálogo confirmado; adicionar outro é só uma entrada nova aqui.
#[tauri::command]
pub fn ensure_agent_trust(agent_id: String, cwd: String, profile_id: Option<String>) -> Result<(), String> {
    match agent_id.as_str() {
        "claude" => trust_claude(&cwd, profile_id.as_deref()),
        _ => Ok(()),
    }
}

/// Onde o Claude Code guarda o `.claude.json`. Com `CLAUDE_CONFIG_DIR` setado ele vai para dentro
/// do config dir; sem ele, fica na raiz do perfil do usuário.
fn claude_state_file(profile_id: Option<&str>) -> Result<PathBuf, String> {
    if let Some(profile) = profile_id.and_then(crate::profiles::find) {
        if !profile.builtin && crate::profiles::config_dir_var(&profile.provider).is_some() {
            return Ok(PathBuf::from(profile.config_dir).join(".claude.json"));
        }
    }
    let home = env::var_os("USERPROFILE")
        .or_else(|| env::var_os("HOME"))
        .ok_or("diretório do usuário não encontrado")?;
    Ok(PathBuf::from(home).join(".claude.json"))
}

fn trust_claude(cwd: &str, profile_id: Option<&str>) -> Result<(), String> {
    let config_path = claude_state_file(profile_id)?;

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
    if let Some(parent) = config_path.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    fs::write(&config_path, serialized).map_err(|error| error.to_string())
}

fn quote_powershell(value: &str) -> String {
    format!("'{}'", value.replace('\'', "''"))
}

/// Resolve um comando no PATH **sem criar processo**. A versão anterior rodava `where.exe` por
/// candidato; num binário de subsistema `windows` (sem console) cada `where.exe` aloca um console
/// novo — `Stdio::null()` redireciona os streams mas não impede a alocação. Era isso que piscava.
fn resolve_on_path(name: &str) -> Option<PathBuf> {
    let path = env::var_os("PATH")?;
    // Nome sem sufixo primeiro: o comando é digitado num shell (bash/powershell), que executa
    // script sem extensão — não estamos limitados ao que o CreateProcess aceita sozinho.
    let mut suffixes = vec![String::new()];
    #[cfg(windows)]
    suffixes.extend(
        env::var("PATHEXT")
            .unwrap_or_else(|_| ".EXE;.CMD;.BAT;.COM".into())
            .split(';')
            .filter(|extension| !extension.is_empty())
            .map(str::to_owned),
    );
    env::split_paths(&path).find_map(|directory| {
        suffixes.iter().find_map(|suffix| {
            // `join(format!(...))` e não `with_extension`: este último trunca no primeiro ponto do
            // nome, então um comando como `foo.bar` viraria `foo.EXE`.
            let candidate = directory.join(format!("{name}{suffix}"));
            candidate.is_file().then_some(candidate)
        })
    })
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

pub(crate) fn engine_dir() -> Result<PathBuf, String> {
    env::var_os("LOCALAPPDATA")
        .map(PathBuf::from)
        .map(|path| path.join("com.omni.agents").join("engine"))
        .ok_or_else(|| "LOCALAPPDATA unavailable".into())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resolve_on_path_finds_a_binary_that_exists_and_rejects_one_that_does_not() {
        let known = if cfg!(windows) { "cmd" } else { "sh" };
        let resolved = resolve_on_path(known).expect("o shell do sistema tem que resolver");
        assert!(resolved.is_file(), "o caminho devolvido tem que ser um arquivo real");
        assert_eq!(resolve_on_path("omni-nao-existe-xyz"), None);
    }

    #[test]
    fn every_declared_cli_has_a_config_dir() {
        // Garante que nenhum provider da tabela caiu no `_ =>` de `native_config_dir` por engano
        // ao ser adicionado aqui — isso o deixaria eternamente "sem login".
        for (id, ..) in AGENT_CLIS {
            assert!(
                crate::profiles::native_config_dir(id).is_some(),
                "{id} não tem config dir mapeado"
            );
        }
    }
}
