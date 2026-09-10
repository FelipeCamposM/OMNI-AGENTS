//! Typed actions over existing PTYs. Recognition deliberately fails closed.
use super::*;
use omni_core::usage::{AccountUsage, parse_claude_screen};
use std::{collections::hash_map::DefaultHasher, hash::{Hash, Hasher}, time::{Duration, Instant}};

pub struct Interaction { pub parser: vt100::Parser, pub input_revision: u64, generation: u64 }
impl Interaction {
    pub fn new(rows: u16, cols: u16) -> Self { Self { parser: vt100::Parser::new(rows,cols,0), input_revision: 0, generation: rand::random() } }
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
    let (row, _) = screen.cursor_position();
    let line = screen.rows(0,screen.size().1).nth(row as usize).unwrap_or_default();
    brand && screen.bracketed_paste() && matches!(line.trim(), "❯" | "›" | ">")
        && !text.contains("Esc to cancel") && !text.contains("esc to interrupt")
        && approval(&text,provider).is_none()
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
pub fn provider_running(_: Option<u32>, _: &str) -> bool { false }

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

pub fn account_usage(state: &Arc<EngineState>, profile_id: &str, refresh: bool) -> Result<EngineResponse> {
    let mut result = AccountUsage::unavailable(profile_id,"claude","Nenhuma sessão Claude disponível neste perfil");
    result.status = "unknown".into();
    if let Some((at, cached)) = state.usage_cache.lock().map_err(|_|anyhow!("cache poisoned"))?.get(profile_id) {
        let ttl = if cached.status == "available" || cached.status == "stale" { 300_000 } else { 15_000 };
        if now_ms().saturating_sub(*at) < ttl || !refresh {
            let mut cached = cached.clone();
            if now_ms().saturating_sub(*at) >= 300_000 { cached.status = "stale".into(); }
            return Ok(EngineResponse::AccountUsage { usage: cached });
        }
    }
    if !refresh { return Ok(EngineResponse::AccountUsage { usage: result }); }
    let sessions: Vec<_> = state.sessions.lock().map_err(|_|anyhow!("sessions poisoned"))?.values().filter_map(|entry| {
        let SessionEntry::Live(session) = entry else { return None };
        let meta = session.meta.lock().ok()?;
        (meta.provider.as_deref() == Some("claude") && meta.profile_id.as_deref() == Some(profile_id)).then(|| session.clone())
    }).collect();
    // A user may have opened /usage manually in an existing session. Reading it never types
    // or closes their dialog, and preserves the screen's actual last-observed timestamp.
    // `parse_claude_screen` is strict enough on its own (exact section titles, one percentage and
    // one reset line each) — the real /usage screen never shows an "Esc to cancel/close" hint, so
    // gating on that text kept this branch permanently unreachable.
    for session in &sessions {
        let context = session.interaction.lock().map_err(|_|anyhow!("screen poisoned"))?;
        let meta = session.meta.lock().map_err(|_|anyhow!("metadata poisoned"))?;
        if meta.pid.is_none() { continue; }
        let usage = parse_claude_screen(&context.parser.screen().contents(),profile_id,meta.last_activity_at_ms);
        if usage.status == "available" {
            state.usage_cache.lock().map_err(|_|anyhow!("cache poisoned"))?.insert(profile_id.into(),(now_ms(),usage.clone()));
            return Ok(EngineResponse::AccountUsage { usage });
        }
    }
    let has_session = !sessions.is_empty();
    let Some(session) = sessions.into_iter().find(|s| capabilities(s).prompt) else {
        if has_session { result.status = "unavailable".into(); result.reason = Some("Entrada ocupada ou não reconhecida. Abra /usage no agente e consulte novamente.".into()); }
        return Ok(EngineResponse::AccountUsage { usage: result });
    };
    {
        let sessions = state.sessions.lock().map_err(|_|anyhow!("sessions poisoned"))?;
        if !sessions.values().any(|entry| matches!(entry,SessionEntry::Live(s) if Arc::ptr_eq(s,&session))) { return Ok(EngineResponse::AccountUsage { usage: result }); }
        let mut context = session.interaction.lock().map_err(|_|anyhow!("screen poisoned"))?;
        if !ready(context.parser.screen(),"claude") || session.reserved.swap(true,Ordering::SeqCst) { return Ok(EngineResponse::AccountUsage { usage: result }); }
        context.input_revision += 1;
        let written = (|| -> Result<()> {
            let mut writer = session.writer.lock().map_err(|_|anyhow!("writer poisoned"))?;
            writer.write_all(b"/usage\r")?; writer.flush()?; Ok(())
        })();
        if let Err(error) = written { session.reserved.store(false,Ordering::SeqCst); return Err(error); }
    }
    struct Release<'a>(&'a LiveSession);
    impl Drop for Release<'_> { fn drop(&mut self) { self.0.reserved.store(false,Ordering::SeqCst); } }
    let _release = Release(&session);
    let started = Instant::now();
    result = AccountUsage::unavailable(profile_id,"claude","Consulta /usage sem tela reconhecida; verifique o agente e tente novamente");
    while started.elapsed() < Duration::from_secs(10) {
        std::thread::sleep(Duration::from_millis(150));
        let sessions = state.sessions.lock().map_err(|_|anyhow!("sessions poisoned"))?;
        if !sessions.values().any(|entry| matches!(entry,SessionEntry::Live(s) if Arc::ptr_eq(s,&session))) { break; }
        let context = session.interaction.lock().map_err(|_|anyhow!("screen poisoned"))?;
        let text = context.parser.screen().contents();
        if session.meta.lock().map_err(|_|anyhow!("metadata poisoned"))?.pid.is_none() { break; }
        // Still the idle composer: /usage hasn't rendered yet (or was already closed). The real
        // screen never shows an "Esc to close" hint here, so `parse_claude_screen`'s own strict
        // grammar — not a hint string that doesn't exist — is what decides this is done.
        if ready(context.parser.screen(),"claude") { continue; }
        result = parse_claude_screen(&text,profile_id,now_ms());
        if result.status == "available" {
            let mut writer = session.writer.lock().map_err(|_|anyhow!("writer poisoned"))?;
            writer.write_all(b"\x1b")?; writer.flush()?;
            break;
        }
    }
    state.usage_cache.lock().map_err(|_|anyhow!("cache poisoned"))?.insert(profile_id.into(),(now_ms(),result.clone()));
    Ok(EngineResponse::AccountUsage { usage: result })
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
    #[test] fn never_approves_generic_output_or_persistent_choice() {
        assert!(approval("Allow? (y/n)","claude").is_none());
        assert!(approval("Do you want to proceed?\n1. Always allow\n3. No","claude").is_none());
        assert_eq!(approval("Do you want to proceed?\n❯ 1. Yes\n2. Yes, always\n3. No","claude").unwrap().0,"1\r");
    }
}
