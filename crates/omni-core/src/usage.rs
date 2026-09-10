use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{fs::File, io::{Read, Seek, SeekFrom}, path::Path};

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct UsageWindow {
    pub used_percent: f64,
    pub window_minutes: u64,
    pub resets_at: Option<i64>,
    /// Verbatim TUI reset description when a timezone/date cannot be resolved unambiguously.
    pub reset_label: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct AccountUsage {
    pub profile_id: String,
    pub provider: String,
    pub source: String,
    pub status: String,
    pub observed_at_ms: Option<u64>,
    pub primary: Option<UsageWindow>,
    pub secondary: Option<UsageWindow>,
    pub reason: Option<String>,
}

impl AccountUsage {
    pub fn unavailable(profile_id: &str, provider: &str, reason: &str) -> Self {
        Self { profile_id: profile_id.into(), provider: provider.into(),
            source: if provider == "codex" { "codex_rollout" } else { "claude_screen" }.into(),
            status: "unavailable".into(), observed_at_ms: None, primary: None, secondary: None,
            reason: Some(reason.into()) }
    }
}

fn window(value: &Value, minutes: u64) -> Option<UsageWindow> {
    let used = value.get("used_percent")?.as_f64()?;
    let reset = value.get("resets_at")?.as_i64()?;
    if !used.is_finite() || !(0.0..=100.0).contains(&used) || reset <= 0 || chrono::DateTime::from_timestamp(reset,0).is_none()
        || value.get("window_minutes")?.as_u64()? != minutes { return None; }
    Some(UsageWindow { used_percent: used, window_minutes: minutes, resets_at: Some(reset), reset_label: None })
}

pub fn codex_event(event: &Value, profile_id: &str, now_ms: u64) -> AccountUsage {
    let mut result = AccountUsage::unavailable(profile_id, "codex", "Registro sem limites válidos");
    let Some(limits) = event.pointer("/payload/rate_limits") else { return result };
    result.primary = limits.get("primary").and_then(|v| window(v, 300));
    result.secondary = limits.get("secondary").and_then(|v| window(v, 10080));
    result.observed_at_ms = event.get("timestamp").and_then(Value::as_str)
        .and_then(|s| chrono::DateTime::parse_from_rfc3339(s).ok())
        .and_then(|d| u64::try_from(d.timestamp_millis()).ok());
    if result.primary.is_some() || result.secondary.is_some() {
        result.status = if [&result.primary, &result.secondary].into_iter().flatten()
            .any(|w| w.resets_at.is_some_and(|reset| reset as u64 <= now_ms / 1000)) { "stale" } else { "available" }.into();
        result.reason = None;
    }
    result
}

/// Reverse blocks: bounded memory even for large transcripts; ignore only an incomplete tail.
fn last_token_count(path: &Path) -> Option<Value> {
    let mut file = File::open(path).ok()?;
    let mut pos = file.metadata().ok()?.len();
    let mut incomplete_tail = if pos > 0 {
        file.seek(SeekFrom::End(-1)).ok()?;
        let mut last = [0]; file.read_exact(&mut last).ok()?; last[0] != b'\n'
    } else { false };
    let mut pending = Vec::new();
    while pos > 0 {
        let len = pos.min(64 * 1024) as usize;
        pos -= len as u64;
        file.seek(SeekFrom::Start(pos)).ok()?;
        let mut block = vec![0; len];
        file.read_exact(&mut block).ok()?;
        block.extend_from_slice(&pending);
        let first_newline = block.iter().position(|b| *b == b'\n');
        let start = if pos == 0 { 0 } else { first_newline.map(|i| i + 1).unwrap_or(block.len()) };
        for line in block[start..].split(|b| *b == b'\n').rev() {
            if line.is_empty() { continue; }
            let parsed = serde_json::from_slice::<Value>(line);
            let partial = incomplete_tail; incomplete_tail = false;
            let Ok(value) = parsed else {
                if !partial && line.windows(b"token_count".len()).any(|word| word == b"token_count") { return None; }
                continue;
            };
            if value.get("type").and_then(Value::as_str) == Some("event_msg")
                && value.pointer("/payload/type").and_then(Value::as_str) == Some("token_count") { return Some(value); }
        }
        pending = block[..if pos == 0 { 0 } else { first_newline.unwrap_or(block.len()) }].to_vec();
        if pending.len() > 4 * 1024 * 1024 { return None; }
    }
    None
}

pub fn read_codex(profile_id: &str, config_dir: &Path, now_ms: u64) -> AccountUsage {
    let path = crate::rollouts(&config_dir.join("sessions")).into_iter()
        .filter_map(|p| Some((p.metadata().ok()?.modified().ok()?, p)))
        .max_by(|a, b| a.0.cmp(&b.0).then(a.1.cmp(&b.1))).map(|(_, p)| p);
    path.and_then(|path| last_token_count(&path))
        .map(|event| codex_event(&event, profile_id, now_ms))
        .unwrap_or_else(|| AccountUsage::unavailable(profile_id, "codex", "Nenhum registro de uso neste perfil"))
}

/// Conservative screen grammar. Reset text is preserved, not interpreted in the PC timezone.
pub fn parse_claude_screen(screen: &str, profile_id: &str, now_ms: u64) -> AccountUsage {
    let mut result = AccountUsage::unavailable(profile_id, "claude", "Formato de /usage não reconhecido");
    let lines: Vec<_> = screen.lines().map(str::trim).filter(|l| !l.is_empty()).collect();
    fn section(lines: &[&str], title: &str, minutes: u64) -> Option<UsageWindow> {
        let positions: Vec<_> = lines.iter().enumerate().filter(|(_, l)| **l == title).map(|(i, _)| i).collect();
        if positions.len() != 1 { return None; }
        let body: Vec<_> = lines.iter().skip(positions[0] + 1).take_while(|l| !l.starts_with("Current ")).take(4).collect();
        let percentages: Vec<_> = body.iter().filter_map(|line| {
            let prefix = line.strip_suffix("% used")?;
            let number = prefix.split_whitespace().last()?;
            if !number.chars().all(|c| c.is_ascii_digit() || c == '.') { return None; }
            let bar = prefix.trim_end().strip_suffix(number)?;
            if !bar.chars().all(|c| c.is_whitespace() || matches!(c,'█'|'▏'|'▎'|'▍'|'▌'|'▋'|'▊'|'▉'|'░'|'▒'|'▓'|'━'|'─')) { return None; }
            number.parse::<f64>().ok().filter(|v| v.is_finite() && (0.0..=100.0).contains(v))
        }).collect();
        let resets: Vec<_> = body.iter().filter_map(|line| line.strip_prefix("Resets ")).collect();
        if percentages.len() != 1 || resets.len() != 1 || resets[0].is_empty() { return None; }
        Some(UsageWindow { used_percent: percentages[0], window_minutes: minutes,
            resets_at: None, reset_label: Some(format!("Resets {}", resets[0])) })
    }
    let primary = section(&lines, "Current session", 300);
    let secondary = section(&lines, "Current week (all models)", 10080);
    if primary.is_some() && secondary.is_some() {
        result.primary = primary; result.secondary = secondary;
        result.status = "available".into(); result.observed_at_ms = Some(now_ms); result.reason = None;
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    #[test] fn validates_windows_and_expiration() {
        let event = json!({"timestamp":"2026-09-10T04:21:00Z","payload":{"rate_limits":{
            "primary":{"used_percent":5,"window_minutes":300,"resets_at":2000000000},
            "secondary":{"used_percent":101,"window_minutes":10080,"resets_at":2000000000}}}});
        let usage = codex_event(&event,"p",1);
        assert_eq!(usage.primary.unwrap().used_percent,5.0);
        assert!(usage.secondary.is_none());
        assert_eq!(codex_event(&event,"p",2000000000000).status,"stale");
    }
    #[test] fn reads_last_event_not_last_valid_limits_and_ignores_partial_tail() {
        let temp = tempfile::tempdir().unwrap();
        let dir = temp.path().join("sessions/2026/09/10"); std::fs::create_dir_all(&dir).unwrap();
        let event = json!({"type":"event_msg","payload":{"type":"token_count","rate_limits":{"primary":{
            "used_percent":7,"window_minutes":300,"resets_at":2000000000}}}});
        let path = dir.join("rollout-test.jsonl");
        std::fs::write(&path,format!("{}\n{{\"type\":",event)).unwrap();
        assert_eq!(read_codex("one",temp.path(),1).primary.unwrap().used_percent,7.0);
        std::fs::write(&path,format!("{}\n{}\n",event,json!({"type":"event_msg","payload":{"type":"token_count","rate_limits":null}}))).unwrap();
        assert!(read_codex("one",temp.path(),1).primary.is_none());
        std::fs::write(&path,format!("{}\n{{\"token_count\":corrupted}}\n",event)).unwrap();
        assert!(read_codex("one",temp.path(),1).primary.is_none());
        assert!(read_codex("other",&temp.path().join("other"),1).primary.is_none());
    }
    #[test] fn screen_grammar_rejects_ambiguous_and_remaining_percentages() {
        let screen = "Current session\n██ 12% used\nResets 3pm (America/Sao_Paulo)\nCurrent week (all models)\n8% used\nResets Sep 15 at 3pm (America/Sao_Paulo)\nCurrent week (Sonnet only)\n99% used";
        assert_eq!(parse_claude_screen(screen,"p",10).secondary.unwrap().used_percent,8.0);
        assert!(parse_claude_screen(&screen.replace("% used","% remaining"),"p",10).primary.is_none());
        assert!(parse_claude_screen(&screen.replace("██ 12% used","10% 12% used"),"p",10).primary.is_none());
        assert!(parse_claude_screen(&format!("{screen}\nCurrent session"),"p",10).primary.is_none());
    }
}
