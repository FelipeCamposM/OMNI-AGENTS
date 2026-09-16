//! Typed actions over existing PTYs. Recognition deliberately fails closed.
use super::*;
use omni_core::usage::{AccountUsage, parse_claude_screen};
use std::{collections::hash_map::DefaultHasher, hash::{Hash, Hasher}, time::{Duration, Instant}};

/// `turn_active`: o agente mostrou sinal de turno (hint de interromper ou diálogo de aprovação) desde
/// o último fim de turno. É o que separa "terminou" de "está ocioso" em `settle`.
pub struct Interaction { pub parser: vt100::Parser, pub input_revision: u64, pub turn_active: bool, generation: u64 }
impl Interaction {
    pub fn new(rows: u16, cols: u16) -> Self { Self { parser: vt100::Parser::new(rows,cols,0), input_revision: 0, turn_active: false, generation: rand::random() } }
    pub fn revision(&self, session: &Arc<LiveSession>) -> String {
        let mut hash = DefaultHasher::new();
        self.parser.screen().contents().hash(&mut hash);
        self.input_revision.hash(&mut hash);
        self.generation.hash(&mut hash);
        (Arc::as_ptr(session) as usize).hash(&mut hash);
        format!("\"{:x}\"",hash.finish())
    }
}

#[derive(Clone, serde::Serialize)]
pub struct Capabilities { pub prompt: bool, pub approve: bool, pub revision: String, pub approval_text: Option<String>, pub reason: Option<String> }

/// Require provider chrome plus an empty composer at the actual terminal cursor.
pub fn ready(screen: &vt100::Screen, provider: &str) -> bool {
    let text = screen.contents();
    // "Claude Code" only shows in the startup banner; it scrolls out of the visible screen after
    // the first exchange, so requiring it here made this permanently false for any session with
    // history (confirmed against a real running session — the idle composer never re-shows it).
    // The structural checks below are strict enough on their own to recognize the composer.
    let brand = match provider { "claude" => true, "codex" => text.contains("OpenAI Codex"), _ => false };
    brand && screen.bracketed_paste() && composer_vazio(screen)
        && !text.contains("Esc to cancel") && !text.contains("esc to interrupt")
        && approval(&text,provider).is_none()
}

/// O campo de digitação está vazio no cursor real.
///
/// À esquerda do cursor, só o símbolo do prompt; à direita, só célula vazia ou texto `dim`. Texto
/// digitado de verdade não é `dim`, então um rascunho a meio continua bloqueando — colar um prompt no
/// meio do que a pessoa escreveu no PC seria pior que recusar.
///
/// A tolerância a `dim` cobre o exemplo em cinza que o Claude Code desenha no campo vazio
/// (`❯ Try "edit <filepath> to..."`). Na tela capturada ele já vinha apagado por um `ESC[K`
/// logo depois, então não era o que travava; a regra antiga (linha inteira igual a `❯`) quebraria
/// no dia em que o redesenho vier sem esse `ESC[K`.
fn composer_vazio(screen: &vt100::Screen) -> bool {
    let (row, col) = screen.cursor_position();
    let (_, cols) = screen.size();
    let antes = screen.contents_between(row,0,row,col);
    matches!(antes.trim(), "❯" | "›" | ">")
        && (col..cols).all(|c| screen.cell(row,c).is_none_or(|cell| !cell.has_contents() || cell.dim()))
}

/// Only single-use choices with exact labels. Persistent permission choices are never sent.
pub fn approval(text: &str, provider: &str) -> Option<(String, String, String)> {
    let lines: Vec<_> = text.lines().map(str::trim).collect();
    let (question,yes,no) = match provider {
        "claude" => ("Do you want to proceed?","1. Yes","3. No"),
        "codex" => ("Would you like to run the following command?","1. Yes, proceed (y)","3. No, and tell Codex what to do differently (esc)"),
        _ => return None,
    };
    let normalize = |line: &str| line.trim_start_matches(['❯','›',' ']).to_string();
    let selected = lines.iter().filter(|line| line.starts_with('❯') || line.starts_with('›')).count();
    if selected != 1 { return None; }
    if lines.iter().filter(|l| **l == question).count() != 1
        || lines.iter().filter(|l| normalize(l) == yes).count() != 1
        || lines.iter().filter(|l| normalize(l) == no).count() != 1 { return None; }
    let start = lines.iter().position(|l| *l == question)?;
    // The question and choices must be one contiguous dialog, not old scrollback.
    let dialog = &lines[start..];
    if dialog.len() > 24 || !dialog.iter().any(|l| normalize(l) == yes) || !dialog.iter().any(|l| normalize(l) == no) { return None; }
    Some((if provider == "codex" { "y" } else { "1\r" }.into(),
        if provider == "codex" { "\x1b" } else { "3\r" }.into(),text.trim().to_owned()))
}

#[cfg(windows)]
pub fn provider_running(pid: Option<u32>, provider: &str) -> bool {
    use windows_sys::Win32::{Foundation::{CloseHandle, INVALID_HANDLE_VALUE}, System::Diagnostics::ToolHelp::*};
    let Some(pid) = pid else { return false };
    // A PTY shell survives when its CLI exits. Confirm the CLI is still its descendant.
    unsafe {
        let handle = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS,0);
        if handle == INVALID_HANDLE_VALUE { return false; }
        let mut entry: PROCESSENTRY32W = std::mem::zeroed(); entry.dwSize = std::mem::size_of::<PROCESSENTRY32W>() as u32;
        let mut processes = HashMap::new(); let mut candidates = Vec::new();
        let mut valid = Process32FirstW(handle,&mut entry) != 0;
        while valid {
            let end = entry.szExeFile.iter().position(|c| *c == 0).unwrap_or(entry.szExeFile.len());
            let name = String::from_utf16_lossy(&entry.szExeFile[..end]);
            processes.insert(entry.th32ProcessID,entry.th32ParentProcessID);
            if name.eq_ignore_ascii_case(&format!("{provider}.exe")) { candidates.push(entry.th32ProcessID); }
            valid = Process32NextW(handle,&mut entry) != 0;
        }
        CloseHandle(handle);
        candidates.into_iter().any(|mut child| { for _ in 0..32 {
            if child == pid { return true; }
            let Some(parent) = processes.get(&child) else { break }; if *parent == child { break; } child = *parent;
        } false })
    }
}
#[cfg(not(windows))]
pub fn provider_running(pid: Option<u32>, provider: &str) -> bool {
    let Some(pid) = pid else { return false };
    // `ps` existe igual no macOS e no Linux (não há /proc no macOS). `args`, não `comm`: instalado
    // pelo npm o CLI roda como `node .../claude`, e `comm` diria só `node`.
    let Ok(output) = std::process::Command::new("ps").args(["-A", "-o", "pid=", "-o", "ppid=", "-o", "args="]).output() else { return false };
    agent_descends_from(&String::from_utf8_lossy(&output.stdout), pid, provider)
}

/// Linhas `pid ppid args` do `ps`. O agente conta quando o executável ou o script que o node roda
/// se chama `provider` e o processo descende da PTY.
#[cfg(any(not(windows), test))]
fn agent_descends_from(ps: &str, pid: u32, provider: &str) -> bool {
    let mut parents = HashMap::new(); let mut candidates = Vec::new();
    for line in ps.lines() {
        let mut fields = line.split_whitespace();
        let (Some(Ok(child)), Some(Ok(parent))) = (fields.next().map(str::parse::<u32>), fields.next().map(str::parse::<u32>)) else { continue };
        parents.insert(child, parent);
        if fields.take(2).any(|arg| arg.rsplit('/').next() == Some(provider)) { candidates.push(child); }
    }
    candidates.into_iter().any(|mut child| { for _ in 0..32 {
        if child == pid { return true; }
        let Some(parent) = parents.get(&child) else { break }; if *parent == child { break; } child = *parent;
    } false })
}

pub fn capabilities(session: &Arc<LiveSession>) -> Capabilities {
    let context = session.interaction.lock().expect("screen poisoned");
    let meta = session.meta.lock().expect("metadata poisoned");
    let provider = meta.provider.as_deref().unwrap_or("");
    let available = !session.reserved.load(Ordering::SeqCst) && provider_running(meta.pid,provider);
    let dialog = approval(&context.parser.screen().contents(),provider);
    let approve = available && dialog.is_some();
    let prompt = available && ready(context.parser.screen(),provider);
    Capabilities { prompt, approve, revision: context.revision(session), approval_text: dialog.map(|d|d.2),
        reason: (!(approve || prompt)).then(|| "Entrada do CLI não reconhecida ou sessão ocupada".into()) }
}

/// Uso da conta Claude. A fonte é o `cachedUsageUtilization` que o próprio Claude Code grava no
/// `.claude.json` a cada `/usage` — ler a tela falhava conforme a altura do painel e o momento do
/// redesenho (a lista "What's contributing" empurra os limites para fora de um painel baixo).
///
/// - `refresh: false` só lê o arquivo. Nunca digita nada.
/// - `refresh: true` precisa de um `/usage` novo, porque o arquivo só muda quando alguém consulta:
///   usa um agente Claude ocioso da conta; sem nenhum, abre um Claude **oculto e temporário** na
///   pasta do engine, consulta e encerra. Sucesso = `fetchedAtMs` do arquivo mudou.
/// - Falhou: devolve a última leitura do arquivo com o motivo, em vez de sumir com os números.
pub fn account_usage(state: &Arc<EngineState>, profile_id: &str, refresh: bool) -> Result<EngineResponse> {
    let dir = state.state_file.parent().ok_or_else(|| anyhow!("engine dir unavailable"))?.to_path_buf();
    let profile = omni_core::profiles(&dir).into_iter().find(|p| p.id == profile_id && p.provider == "claude");
    let state_path = profile.as_ref().map(omni_core::usage::claude_state_path);
    let read_cache = || state_path.as_deref().and_then(|path| omni_core::usage::read_claude_cache(profile_id, path, now_ms()));
    let with_reason = |usage: Option<AccountUsage>, reason: &str| {
        let mut usage = usage.unwrap_or_else(|| AccountUsage::unavailable(profile_id, "claude", reason));
        usage.reason = Some(reason.into());
        Ok(EngineResponse::AccountUsage { usage })
    };
    let before = read_cache();
    if !refresh {
        return match before {
            Some(usage) => Ok(EngineResponse::AccountUsage { usage }),
            None => with_reason(None, "Sem consulta de uso ainda. Clique em atualizar."),
        };
    }
    let Some(profile) = profile else { return with_reason(before, "Conta Claude não encontrada.") };
    // Leitura de menos de 1 min: o Claude devolveria a mesma (ele só busca de novo depois de alguns
    // minutos — medido: 4 min depois repetiu, 7 min depois buscou).
    if let Some(usage) = before.as_ref().filter(|u| u.observed_at_ms.is_some_and(|at| now_ms().saturating_sub(at) < 60_000)) {
        return Ok(EngineResponse::AccountUsage { usage: usage.clone() });
    }
    let previous_fetch = before.as_ref().and_then(|u| u.observed_at_ms);

    let idle_agent = state.sessions.lock().map_err(|_|anyhow!("sessions poisoned"))?.values().filter_map(|entry| {
        let SessionEntry::Live(session) = entry else { return None };
        let meta = session.meta.lock().ok()?;
        (meta.provider.as_deref() == Some("claude") && meta.profile_id.as_deref() == Some(profile_id)).then(|| session.clone())
    }).find(|session| capabilities(session).prompt);
    if let Some(session) = idle_agent {
        if let Some(usage) = run_usage_command(state, &session, profile_id, &read_cache, previous_fetch)? {
            return Ok(EngineResponse::AccountUsage { usage });
        }
    }

    // Nenhum agente ocioso (ou ele não trouxe): Claude oculto só para consultar. `/usage` não manda
    // mensagem ao modelo, e sem mensagem o Claude não grava conversa.
    let id = state.next_id();
    let hidden = spawn_terminal_inner(state, id.clone(), String::new(), "Claude · consulta de uso".into(),
        dir.to_string_lossy().into_owned(), None, Some("claude".into()), 40, 120, now_ms(),
        SessionOrigin { headless: true, env: omni_core::env_for(&profile), provider: Some("claude".into()),
            profile_id: Some(profile_id.into()), conversation_id: None, external_session_id: None });
    let result = hidden.and_then(|_| {
        let session = match state.sessions.lock().map_err(|_|anyhow!("sessions poisoned"))?.get(&id) {
            Some(SessionEntry::Live(session)) => session.clone(),
            _ => return Ok(None),
        };
        if !wait_claude_ready(&session, Duration::from_secs(25)) { return Ok(None); }
        run_usage_command(state, &session, profile_id, &read_cache, previous_fetch)
    });
    end_hidden_claude(state, &id);
    match result? {
        Some(usage) => Ok(EngineResponse::AccountUsage { usage }),
        None => with_reason(before, "O Claude não trouxe o uso a tempo; mostrando a última leitura."),
    }
}

/// Encerra o Claude oculto. Só matar a sessão não basta no Windows: o shell morre e o `claude.exe`
/// neto fica órfão (visto no teste). `/exit` primeiro; se ele ainda estiver vivo, derruba a árvore.
fn end_hidden_claude(state: &Arc<EngineState>, id: &str) {
    let session = match state.sessions.lock().ok().as_ref().and_then(|sessions| sessions.get(id)) {
        Some(SessionEntry::Live(session)) => Some(session.clone()),
        _ => None,
    };
    if let Some(session) = session {
        let write = |bytes: &[u8]| if let Ok(mut writer) = session.writer.lock() { let _ = writer.write_all(bytes); let _ = writer.flush(); };
        let pid = session.meta.lock().ok().and_then(|meta| meta.pid);
        write(b"\x1b");
        std::thread::sleep(Duration::from_millis(300));
        write(b"/exit");
        std::thread::sleep(Duration::from_millis(250));
        write(b"\r");
        let started = Instant::now();
        while provider_running(pid, "claude") && started.elapsed() < Duration::from_secs(3) {
            std::thread::sleep(Duration::from_millis(200));
        }
        #[cfg(windows)]
        if let Some(pid) = pid.filter(|pid| provider_running(Some(*pid), "claude")) {
            use std::os::windows::process::CommandExt;
            let _ = std::process::Command::new("taskkill").args(["/T", "/F", "/PID", &pid.to_string()])
                .stdin(std::process::Stdio::null()).stdout(std::process::Stdio::null()).stderr(std::process::Stdio::null())
                .creation_flags(0x0800_0000).status();
        }
    }
    let _ = close_session(state, id);
}

/// Espera o Claude recém-aberto chegar no composer vazio, passando pelo "confiar nesta pasta" (a
/// pasta é a do próprio engine; o Claude grava a confiança, então só acontece na primeira vez).
fn wait_claude_ready(session: &Arc<LiveSession>, limit: Duration) -> bool {
    let started = Instant::now();
    while started.elapsed() < limit {
        std::thread::sleep(Duration::from_millis(300));
        if session.meta.lock().map(|meta| meta.pid.is_none()).unwrap_or(true) { return false; }
        let text = session.interaction.lock().map(|c| c.parser.screen().contents()).unwrap_or_default();
        if let Some(keys) = trust_dialog_keys(&text) {
            if let Ok(mut writer) = session.writer.lock() { let _ = writer.write_all(keys.as_bytes()); let _ = writer.flush(); }
            continue;
        }
        if capabilities(session).prompt { return true; }
    }
    false
}

/// Teclas para o diálogo de confiança de pasta, ou `None` se ele não está na tela. Na 2.1.272 o
/// padrão selecionado é "No, exit" — um Enter às cegas **fecharia** o Claude. Então: seta até a opção
/// "Yes", e Enter só quando a tela já mostra o `❯` nela (a próxima volta do loop confere).
fn trust_dialog_keys(text: &str) -> Option<&'static str> {
    // Rótulo sem o `❯` e sem numeração ("1. Yes, proceed" nas versões antigas).
    let label = |line: &str| line.trim_start_matches('❯').trim_start().trim_start_matches(|c: char| c.is_ascii_digit() || c == '.').trim_start().to_owned();
    let options: Vec<&str> = text.lines().map(str::trim)
        .filter(|line| label(line).starts_with("Yes, ") || label(line).starts_with("No, exit"))
        .collect();
    let yes = options.iter().position(|line| label(line).starts_with("Yes, "))?;
    let selected = options.iter().position(|line| line.starts_with('❯'))?;
    if !options.iter().any(|line| label(line).starts_with("No, exit")) { return None; }
    Some(match selected.cmp(&yes) {
        std::cmp::Ordering::Equal => "\r",
        std::cmp::Ordering::Less => "\x1b[B",
        std::cmp::Ordering::Greater => "\x1b[A",
    })
}

/// Digita `/usage` numa sessão ociosa e espera o resultado; fecha o diálogo aberto com Esc — com
/// sucesso ou não. Pronto quando:
/// - o `fetchedAtMs` do arquivo mudou (o Claude buscou de novo), ou
/// - o diálogo terminou de carregar (limites na tela, sem "Refreshing…") por duas leituras seguidas:
///   o Claude não busca de novo se consultou há pouco, e aí o valor do arquivo **é** o atual.
/// CLI que não grava o cache: os números da própria tela.
fn run_usage_command(state: &Arc<EngineState>, session: &Arc<LiveSession>, profile_id: &str,
    read_cache: &dyn Fn() -> Option<AccountUsage>, previous_fetch: Option<u64>) -> Result<Option<AccountUsage>> {
    {
        let sessions = state.sessions.lock().map_err(|_|anyhow!("sessions poisoned"))?;
        if !sessions.values().any(|entry| matches!(entry,SessionEntry::Live(s) if Arc::ptr_eq(s,session))) { return Ok(None); }
        let mut context = session.interaction.lock().map_err(|_|anyhow!("screen poisoned"))?;
        if !ready(context.parser.screen(),"claude") || session.reserved.swap(true,Ordering::SeqCst) { return Ok(None); }
        context.input_revision += 1;
        let written = (|| -> Result<()> {
            let mut writer = session.writer.lock().map_err(|_|anyhow!("writer poisoned"))?;
            writer.write_all(b"/usage")?; writer.flush()?; Ok(())
        })();
        if let Err(error) = written { session.reserved.store(false,Ordering::SeqCst); return Err(error); }
    }
    struct Release<'a>(&'a LiveSession);
    impl Drop for Release<'_> { fn drop(&mut self) { self.0.reserved.store(false,Ordering::SeqCst); } }
    let _release = Release(session);
    let write = |bytes: &[u8]| -> Result<()> {
        let mut writer = session.writer.lock().map_err(|_|anyhow!("writer poisoned"))?;
        writer.write_all(bytes)?; writer.flush()?; Ok(())
    };
    // Texto e Enter no mesmo write chegam como uma rajada só, que o Claude trata como colagem: o
    // `\r` não submete. Enter separado, fora dos locks (o leitor da PTY precisa da tela no intervalo).
    std::thread::sleep(Duration::from_millis(250));
    write(b"\r")?;
    let started = Instant::now();
    let mut result = None;
    // Momento em que o diálogo terminou de carregar: o "Refreshing…" apareceu e sumiu, ou (CLI sem
    // esse aviso) os limites ficaram na tela por 2 s.
    let (mut saw_refreshing, mut loaded_at, mut limits_since) = (false, None::<Instant>, None::<Instant>);
    while started.elapsed() < Duration::from_secs(15) && result.is_none() {
        std::thread::sleep(Duration::from_millis(250));
        if !state.sessions.lock().map_err(|_|anyhow!("sessions poisoned"))?.values().any(|entry| matches!(entry,SessionEntry::Live(s) if Arc::ptr_eq(s,session))) { break; }
        if session.meta.lock().map_err(|_|anyhow!("metadata poisoned"))?.pid.is_none() { break; }
        let cached = read_cache();
        if cached.as_ref().is_some_and(|u| u.observed_at_ms.is_some() && u.observed_at_ms != previous_fetch) {
            result = cached;
            break;
        }
        let text = session.interaction.lock().map_err(|_|anyhow!("screen poisoned"))?.parser.screen().contents();
        let refreshing = text.contains("Refreshing");
        saw_refreshing |= refreshing;
        if text.contains("Current session") { limits_since.get_or_insert_with(Instant::now); }
        if loaded_at.is_none() && ((saw_refreshing && !refreshing) || limits_since.is_some_and(|at| !saw_refreshing && at.elapsed() >= Duration::from_secs(2))) {
            loaded_at = Some(Instant::now());
        }
        // Carregou e o arquivo não mudou: ou o Claude ainda vai gravar (1,5 s de folga), ou ele não
        // buscou de novo porque consultou há poucos minutos — nesse caso o arquivo é o valor atual,
        // o mesmo que o `/usage` mostraria no terminal.
        if loaded_at.is_some_and(|at| at.elapsed() >= Duration::from_millis(1500)) {
            result = cached.or_else(|| Some(parse_claude_screen(&text, profile_id, now_ms())).filter(|u| u.status == "available"));
            break;
        }
    }
    // Fecha o diálogo que NÓS abrimos: a sessão estava ociosa e com a entrada reservada, então uma
    // tela que não é o composer vazio só pode ser o `/usage` (ou o autocomplete dele).
    if session.interaction.lock().is_ok_and(|context| !ready(context.parser.screen(), "claude")) { let _ = write(b"\x1b"); }
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test] fn reconstructs_split_ansi_and_checks_cursor_not_old_prompts() {
        let mut context = Interaction::new(10,80);
        context.parser.process(b"\x1b[?2004hClaude Code\r\n> ");
        assert!(ready(context.parser.screen(),"claude"));
        context.parser.process(b"draft"); assert!(!ready(context.parser.screen(),"claude"));
        context.parser.process(b"\x1b[2"); context.parser.process(b"J\x1b[Hshell> ");
        assert!(!ready(context.parser.screen(),"claude"));
    }
    /// Tela **real** do Claude Code ocioso, capturada de uma sessão aberta pelo celular (30×120).
    /// Os fixtures anteriores eram todos sintéticos; este é o que o engine realmente recebe.
    #[test] fn claude_ocioso_de_verdade_aceita_prompt() {
        let fixture = include_bytes!("../tests-fixtures/claude-composer-vazio.ansi");
        // O stream real da PTY usa CRLF. Em checkouts com `core.autocrlf=false` (Linux/macOS), o Git
        // normaliza este fixture textual para LF; o VT então mantém a coluna anterior a cada quebra
        // e o cursor termina no lugar errado. Normalize primeiro para LF para exercitar o mesmo
        // caminho em todos os sistemas, depois reponha o CR que a PTY entregou na captura real.
        let tela: Vec<_> = fixture.iter().copied().enumerate()
            .filter_map(|(index, byte)| (!(byte == b'\r' && fixture.get(index + 1) == Some(&b'\n'))).then_some(byte))
            .collect();
        let mut stream = Vec::with_capacity(tela.len() + 32);
        for byte in tela {
            if byte == b'\n' { stream.push(b'\r'); }
            stream.push(byte);
        }
        let mut context = Interaction::new(30,120);
        context.parser.process(&stream);
        assert!(ready(context.parser.screen(),"claude"));

        // Digitar de verdade na frente do cursor volta a bloquear.
        context.parser.process(b"abc");
        assert!(!ready(context.parser.screen(),"claude"));
    }

    /// Exemplo em cinza depois do cursor não é rascunho; o mesmo texto sem `dim` é.
    #[test] fn exemplo_em_cinza_nao_bloqueia_mas_texto_normal_bloqueia() {
        let mut cinza = Interaction::new(5,40);
        // Prompt, exemplo em `dim` (SGR 2), e o cursor volta para logo depois do símbolo.
        cinza.parser.process("[?2004h❯ [2mTry this[22m[1;3H".as_bytes());
        assert!(ready(cinza.parser.screen(),"claude"));

        let mut digitado = Interaction::new(5,40);
        digitado.parser.process("[?2004h❯ Try this[1;3H".as_bytes());
        assert!(!ready(digitado.parser.screen(),"claude"));
    }

    #[test] fn trust_dialog_moves_to_yes_before_confirming() {
        // Tela real da 2.1.272: "No, exit" vem selecionado.
        let screen = " Quick safety check: Is this a project you created or one you trust?\n ❯ No, exit\n   Yes, I trust this folder\n Enter to confirm · Esc to cancel";
        assert_eq!(trust_dialog_keys(screen), Some("\x1b[B"));
        assert_eq!(trust_dialog_keys(&screen.replace("❯ No, exit\n   Yes", "  No, exit\n ❯ Yes")), Some("\r"));
        assert_eq!(trust_dialog_keys(" ❯ 1. Yes, proceed\n   2. No, exit"), Some("\r"));
        assert_eq!(trust_dialog_keys("❯ "), None);
        assert_eq!(trust_dialog_keys("Do you want to proceed?\n❯ 1. Yes\n3. No"), None);
    }
    #[test] fn unix_agent_process_must_descend_from_pty() {
        let ps = "  10     1 -zsh\n  20    10 node /Users/a/.npm/bin/claude --session-id x\n  30     1 /opt/homebrew/bin/codex";
        assert!(agent_descends_from(ps, 10, "claude"));
        assert!(!agent_descends_from(ps, 10, "codex")); // codex existe, mas fora desta PTY
        assert!(!agent_descends_from("  40    10 vim notes/claude.md", 10, "claude"));
    }
    #[test] fn never_approves_generic_output_or_persistent_choice() {
        assert!(approval("Allow? (y/n)","claude").is_none());
        assert!(approval("Do you want to proceed?\n1. Always allow\n3. No","claude").is_none());
        assert_eq!(approval("Do you want to proceed?\n❯ 1. Yes\n2. Yes, always\n3. No","claude").unwrap().0,"1\r");
    }
}
