use omni_protocol::{EngineRequest, EngineResponse, DATA_DIR, DEFAULT_ENGINE_PORT, DEV_DATA_DIR, DEV_ENGINE_PORT};
use std::{
    env,
    fs,
    io::{BufRead, BufReader, Write},
    net::{TcpStream, ToSocketAddrs},
    path::PathBuf,
    process::{Command, Stdio},
    sync::Mutex,
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
        if !engine_binary_replaced(&response) {
            return response;
        }
        // Atualização trocou o binário com o engine vivo (macOS/Linux; no Windows o NSIS mata antes).
        // Mesmo efeito do hook do instalador: as sessões abertas caem e o engine novo sobe.
        let _ = authenticated_request(|token| EngineRequest::Shutdown { token });
        for _ in 0..30 {
            if authenticated_request(|token| EngineRequest::Ping { token }).is_err() { break; }
            thread::sleep(Duration::from_millis(100));
        }
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
const AGENT_CLIS: [(&str, &str, &[&str], &[&str]); 3] = [
    ("claude", "Claude", &["claude"], &[]),
    ("codex", "Codex", &["codex"], &["login"]),
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

    // Sem isto o login cairia sempre no config dir nativo, e todo profile novo nasceria vazio.
    let env = profile_id.as_deref().and_then(crate::profiles::find)
        .map(|profile| crate::profiles::env_for(&profile)).unwrap_or_default();
    // Janela visível de propósito: aqui o console *é* a UX de login do provider.
    open_login_console(command, arguments, &env)
}

#[cfg(windows)]
fn open_login_console(command: &str, arguments: &[&str], env: &[(String, String)]) -> Result<(), String> {
    let mut invocation = format!("& {}", quote_powershell(command));
    for argument in arguments {
        invocation.push(' ');
        invocation.push_str(&quote_powershell(argument));
    }
    let mut console = Command::new("powershell.exe");
    console.args(["-NoLogo", "-NoExit", "-Command", &invocation]).envs(env.iter().cloned());
    console.spawn().map(|_| ()).map_err(|error| error.to_string())
}

/// O terminal do sistema não herda o ambiente de quem o chama (o Terminal.app e o
/// gnome-terminal abrem a janela a partir de um processo servidor), então as variáveis vão
/// escritas dentro do script. `exec $SHELL` no fim deixa a janela aberta, como o `-NoExit`.
#[cfg(not(windows))]
fn login_script(command: &str, arguments: &[&str], env: &[(String, String)]) -> String {
    let quote = |value: &str| format!("'{}'", value.replace('\'', r"'\''"));
    let mut script: String = env.iter().map(|(key, value)| format!("export {key}={}; ", quote(value))).collect();
    script.push_str(&quote(command));
    for argument in arguments {
        script.push(' ');
        script.push_str(&quote(argument));
    }
    script.push_str("; exec \"${SHELL:-/bin/sh}\" -l");
    script
}

#[cfg(target_os = "macos")]
fn open_login_console(command: &str, arguments: &[&str], env: &[(String, String)]) -> Result<(), String> {
    // String AppleScript: `\` e `"` escapados.
    let script = login_script(command, arguments, env).replace('\\', r"\\").replace('"', r#"\""#);
    Command::new("osascript")
        .args(["-e", &format!("tell application \"Terminal\" to do script \"{script}\""), "-e", "tell application \"Terminal\" to activate"])
        .spawn().map(|_| ()).map_err(|error| error.to_string())
}

#[cfg(all(unix, not(target_os = "macos")))]
fn open_login_console(command: &str, arguments: &[&str], env: &[(String, String)]) -> Result<(), String> {
    let script = login_script(command, arguments, env);
    // Não há terminal padrão no Linux: tenta os mais comuns, na ordem em que costumam existir.
    let terminals: [(&str, &[&str]); 5] = [
        ("x-terminal-emulator", &["-e"]), ("gnome-terminal", &["--"]), ("konsole", &["-e"]),
        ("xfce4-terminal", &["-x"]), ("xterm", &["-e"]),
    ];
    let (terminal, flags) = terminals.into_iter().find(|(name, _)| resolve_on_path(name).is_some())
        .ok_or("Nenhum terminal encontrado (x-terminal-emulator, gnome-terminal, konsole, xfce4-terminal, xterm)")?;
    Command::new(terminal).args(flags).args(["sh", "-c", &script])
        .spawn().map(|_| ()).map_err(|error| error.to_string())
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

#[cfg(windows)]
fn quote_powershell(value: &str) -> String {
    format!("'{}'", value.replace('\'', "''"))
}

/// App aberto pelo Finder/Dock (macOS) ou pelo menu (Linux) herda um PATH mínimo, sem
/// `/opt/homebrew/bin`, `~/.local/bin` nem o que nvm/volta/asdf põem no `.zshrc`: `claude` e `codex`
/// "não estariam instalados". Pega o PATH do shell de login interativo do usuário — o mesmo que ele
/// vê no terminal — antes de qualquer detecção ou spawn do engine (que herda daqui).
/// ponytail: timeout fixo de 3 s; um `.zshrc` que pede input ou demora mais fica com o PATH mínimo.
#[cfg(unix)]
pub fn import_login_shell_path() {
    let shell = env::var("SHELL").unwrap_or_else(|_| "/bin/sh".into());
    let Ok(mut child) = Command::new(shell)
        .args(["-ilc", "printf '\n__OMNI_PATH__%s' \"$PATH\""])
        .stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::null())
        .spawn() else { return };
    let started = std::time::Instant::now();
    while started.elapsed() < Duration::from_secs(3) {
        match child.try_wait() {
            Ok(Some(_)) => {
                let mut output = String::new();
                let _ = std::io::Read::read_to_string(&mut child.stdout.take().expect("stdout piped"), &mut output);
                // Marcador: `.zshrc` que imprime banner não pode contaminar o valor.
                if let Some(path) = output.rsplit("__OMNI_PATH__").next().filter(|_| output.contains("__OMNI_PATH__")) {
                    if !path.trim().is_empty() { env::set_var("PATH", path.trim()); }
                }
                return;
            }
            Ok(None) => thread::sleep(Duration::from_millis(50)),
            Err(_) => return,
        }
    }
    let _ = child.kill();
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

pub(crate) fn authenticated_request(build: impl FnOnce(String) -> EngineRequest) -> Result<EngineResponse, String> {
    let token = fs::read_to_string(engine_dir()?.join("engine.token"))
        .map_err(|error| format!("engine token unavailable: {error}"))?;
    send_request(build(token.trim().to_owned()))
}

/// Porta do engine. `OMNI_ENGINE_PORT` existe para subir uma instância paralela — app instalado e
/// app de dev na mesma máquina brigam pela porta fixa, e o segundo a subir acaba falando com o
/// engine do primeiro (versão velha, sem os campos novos do protocolo).
pub(crate) fn engine_port() -> u16 {
    env::var("OMNI_ENGINE_PORT").ok().and_then(|value| value.parse().ok()).unwrap_or(if cfg!(debug_assertions) {
        // `npm run dev` nunca pode falar com o engine do app instalado. Com a porta compartilhada,
        // o dev usava o engine instalado (versão velha, sem os campos novos) e o `build-engine.mjs`
        // chegava a derrubar ele com todas as sessões abertas.
        DEV_ENGINE_PORT
    } else {
        DEFAULT_ENGINE_PORT
    })
}

/// Conexão ociosa guardada entre requisições.
///
/// **Sem isto o app esgota as portas efêmeras do Windows.** Cada pane pede um snapshot a cada
/// 100ms e a lista de sessões vai a cada 1s; abrindo um socket novo por requisição, três panes
/// geram ~30 conexões/s que ficam 120s em `TIME_WAIT`. Com 16384 portas dinâmicas, algumas horas
/// de app aberto — mesmo parado, sem ninguém mexer — esgotam a faixa e todo `connect` passa a
/// falhar com `WSAEADDRINUSE` (os error 10048), que chegava na tela como "erro no terminal" sem
/// nenhuma relação visível com a causa. O engine sempre soube atender várias requisições na mesma
/// conexão (`serve_client` lê linha a linha em laço); era o cliente que jogava o socket fora.
static IDLE_CONNECTION: Mutex<Option<BufReader<TcpStream>>> = Mutex::new(None);

struct ExchangeError {
    message: String,
    /// A requisição com certeza não chegou a ser executada (falha ao conectar ou ao escrever — o
    /// engine só age depois de receber a linha inteira). Só nesse caso reenviar é seguro.
    unsent: bool,
}

fn connect() -> Result<BufReader<TcpStream>, String> {
    let address = ("127.0.0.1", engine_port())
        .to_socket_addrs()
        .map_err(|error| error.to_string())?
        .next()
        .ok_or_else(|| "engine address unavailable".to_string())?;
    let stream = TcpStream::connect_timeout(&address, CONNECT_TIMEOUT).map_err(|error| error.to_string())?;
    // Requisições são pequenas e sequenciais: esperar o buffer de Nagle só adiciona latência.
    let _ = stream.set_nodelay(true);
    Ok(BufReader::new(stream))
}

fn exchange(
    connection: &mut BufReader<TcpStream>,
    request: &EngineRequest,
    timeout: Duration,
) -> Result<EngineResponse, ExchangeError> {
    let unsent = |error: String| ExchangeError { message: error, unsent: true };
    let sent = |error: String| ExchangeError { message: error, unsent: false };

    let stream = connection.get_mut();
    stream.set_read_timeout(Some(timeout)).map_err(|error| unsent(error.to_string()))?;
    serde_json::to_writer(&mut *stream, request).map_err(|error| unsent(error.to_string()))?;
    stream.write_all(b"\n").map_err(|error| unsent(error.to_string()))?;
    stream.flush().map_err(|error| unsent(error.to_string()))?;

    // Daqui pra baixo a requisição já saiu: um timeout pode ser só lentidão do engine, com a
    // operação já feita do outro lado. Reenviar às cegas duplicaria o efeito.
    let mut response = String::new();
    let bytes = connection.read_line(&mut response).map_err(|error| sent(error.to_string()))?;
    if bytes == 0 {
        return Err(sent("o engine fechou a conexão".into()));
    }
    serde_json::from_str(&response).map_err(|error| sent(error.to_string()))
}

fn send_request(request: EngineRequest) -> Result<EngineResponse, String> {
    // Consulta de uso pode abrir um Claude oculto e esperar o `/usage` (dezenas de segundos). Na
    // conexão compartilhada ela seguraria o lock e congelaria terminais, digitação e polls até acabar:
    // conexão própria, fora do cache.
    if matches!(&request, EngineRequest::AccountUsage { .. }) {
        let mut connection = connect()?;
        return exchange(&mut connection, &request, Duration::from_secs(60)).map(outdated_engine_hint).map_err(|error| error.message);
    }
    let timeout = Duration::from_secs(if matches!(&request, EngineRequest::MobileSettings { .. }) { 15 } else { 2 });
    let mut guard = IDLE_CONNECTION.lock().map_err(|_| "engine connection poisoned".to_string())?;

    // `take()`: a conexão só volta pro cache quando a troca termina bem. Depois de um erro ela pode
    // estar dessincronizada — uma resposta atrasada viraria a resposta da requisição seguinte.
    if let Some(mut connection) = guard.take() {
        match exchange(&mut connection, &request, timeout) {
            Ok(response) => {
                *guard = Some(connection);
                // A tradução tem de valer aqui também: quase toda requisição reaproveita a conexão, e
                // só a conexão nova traduzia — o "engine desatualizado" chegava cru na tela.
                return Ok(outdated_engine_hint(response));
            }
            // Conexão reaproveitada que morreu parada: reenvia só o que comprovadamente não chegou
            // a ser executado, ou o que é seguro repetir (ping, listagem, snapshot).
            Err(error) if !error.unsent && !request.read_only() => return Err(error.message),
            Err(_) => {}
        }
    }

    let mut connection = connect()?;
    let response = exchange(&mut connection, &request, timeout).map_err(|error| error.message)?;
    *guard = Some(connection);
    Ok(outdated_engine_hint(response))
}

/// Um engine mais antigo que o app responde `INVALID_REQUEST: unknown variant ...` para qualquer
/// comando que ele não conheça. A mensagem crua não diz nada a quem usa, e a tela de Celular
/// engolia isso calada — foi o que fez o acesso pelo celular parecer "não implementado" por uma
/// versão inteira, quando na verdade o instalador tinha deixado um `omni-engine.exe` velho para
/// trás (o engine roda destacado e sobrevive à instalação, então o NSIS não consegue substituir).
fn outdated_engine_hint(response: EngineResponse) -> EngineResponse {
    match response {
        EngineResponse::Error { code, message }
            if code == "INVALID_REQUEST" && message.contains("unknown variant") =>
        {
            EngineResponse::Error {
                code: "ENGINE_OUTDATED".into(),
                message: "O OMNI Engine em execução é mais antigo que o app e não conhece este \
comando. Feche o OMNI, encerre o processo omni-engine.exe no Gerenciador de Tarefas e abra o app \
de novo."
                    .into(),
            }
        }
        other => other,
    }
}

/// O arquivo que o engine carregou mudou desde que ele subiu. Engine antigo sem o campo: `false`.
fn engine_binary_replaced(response: &EngineResponse) -> bool {
    let EngineResponse::Pong { engine_exe: Some(exe), engine_exe_modified_ms: Some(loaded), .. } = response else { return false };
    omni_protocol::modified_ms(std::path::Path::new(exe)).is_some_and(|current| current != *loaded)
}

fn spawn_engine() -> Result<(), String> {
    let executable = engine_executable()?;
    if !executable.is_file() {
        return Err(format!("engine binary not found: {}", executable.display()));
    }
    let mut command = Command::new(executable);
    command.stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null());
    // O engine usa a identidade de quem o lançou, não a do perfil com que foi compilado: sem isto
    // um engine de release aberto pelo app de dev voltaria para a porta e a pasta do instalado.
    command.env("OMNI_ENGINE_PORT", engine_port().to_string()).env("OMNI_DATA_DIR", engine_dir()?);
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
        .join(format!("omni-engine-{}{extension}", env!("OMNI_TARGET_TRIPLE")));

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

/// Pasta de dados do engine. Em dev é `com.omni.agents.dev`: token próprio significa que, mesmo que
/// algo errado mire a porta do app instalado, o engine instalado recusa o pedido como não
/// autorizado. Porta separada e token separado são duas travas independentes.
pub(crate) fn engine_dir() -> Result<PathBuf, String> {
    if let Some(dir) = env::var_os("OMNI_DATA_DIR") {
        return Ok(PathBuf::from(dir));
    }
    let nome = if cfg!(debug_assertions) { DEV_DATA_DIR } else { DATA_DIR };
    omni_protocol::local_data_root()
        .map(|path| path.join(nome).join("engine"))
        .ok_or_else(|| "pasta de dados do usuário indisponível".into())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// O engine velho recusa comandos novos com `unknown variant`. Sem a tradução, a tela de
    /// Celular mostrava isso (ou nada) e o recurso parecia não existir.
    #[test]
    fn engine_velho_vira_mensagem_acionavel() {
        let bruto = EngineResponse::Error {
            code: "INVALID_REQUEST".into(),
            message: "unknown variant `mobile_settings`, expected one of `ping`".into(),
        };
        let EngineResponse::Error { code, message } = outdated_engine_hint(bruto) else {
            panic!("deveria continuar sendo erro");
        };
        assert_eq!(code, "ENGINE_OUTDATED");
        assert!(message.contains("omni-engine.exe"), "a mensagem tem de dizer o que fazer: {message}");

        // Erro comum de negócio não pode ser reescrito como "engine velho".
        let outro = EngineResponse::Error { code: "ENGINE_ERROR".into(), message: "session not found".into() };
        let EngineResponse::Error { code, .. } = outdated_engine_hint(outro) else { panic!() };
        assert_eq!(code, "ENGINE_ERROR");
    }

    /// Prova que o cliente reaproveita a conexão: um servidor de mentira conta quantas vezes
    /// aceitou. Sem o cache, cada requisição abriria um socket novo — que é o que esgotava as
    /// portas efêmeras do Windows e fazia o terminal mostrar "os error 10048" depois de horas.
    #[test]
    fn sequential_requests_share_one_connection() {
        use std::net::TcpListener;
        use std::sync::atomic::{AtomicUsize, Ordering};
        use std::sync::Arc;

        let listener = TcpListener::bind(("127.0.0.1", 0)).expect("porta livre");
        let port = listener.local_addr().expect("endereço").port();
        let aceitas = Arc::new(AtomicUsize::new(0));
        let contador = aceitas.clone();

        let servidor = thread::spawn(move || {
            for stream in listener.incoming().take(1) {
                let stream = stream.expect("conexão");
                contador.fetch_add(1, Ordering::SeqCst);
                let leitor = BufReader::new(stream.try_clone().expect("clone"));
                let mut escritor = stream;
                // Uma resposta por linha recebida — igual ao `serve_client` do engine. Responde como um
                // engine velho, para provar também que a tradução vale na conexão reaproveitada.
                for linha in leitor.lines() {
                    if linha.is_err() {
                        break;
                    }
                    let resposta = serde_json::to_vec(&EngineResponse::Error {
                        code: "INVALID_REQUEST".into(),
                        message: "unknown variant `mobile_totp`, expected one of `ping`".into(),
                    }).expect("json");
                    if escritor.write_all(&resposta).is_err() || escritor.write_all(b"\n").is_err() {
                        break;
                    }
                }
            }
        });

        // Isola o teste do engine de verdade que possa estar rodando na porta padrão.
        env::set_var("OMNI_ENGINE_PORT", port.to_string());
        *IDLE_CONNECTION.lock().expect("cache") = None;

        for tentativa in 1..=3 {
            let resposta = send_request(EngineRequest::Ping { token: "t".into() }).expect("requisição");
            // Da segunda em diante a conexão é reaproveitada: antes, só a primeira vinha traduzida.
            assert!(matches!(&resposta, EngineResponse::Error { code, .. } if code == "ENGINE_OUTDATED"),
                "requisição {tentativa} chegou sem tradução: {resposta:?}");
        }

        // Solta a conexão pro servidor de mentira encerrar e o teste não ficar preso.
        *IDLE_CONNECTION.lock().expect("cache") = None;
        env::remove_var("OMNI_ENGINE_PORT");
        servidor.join().expect("servidor encerra");

        assert_eq!(aceitas.load(Ordering::SeqCst), 1, "três requisições têm que caber numa conexão só");
    }

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
