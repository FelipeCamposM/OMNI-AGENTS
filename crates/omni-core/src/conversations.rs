use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{collections::HashSet, fs::File, io::{BufRead, BufReader}, path::{Path, PathBuf}};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Segment {
    pub provider: String,
    pub profile_id: Option<String>,
    pub external_session_id: Option<String>,
    pub transcript_path: Option<String>,
    pub terminal_session_id: Option<String>,
    pub started_at_ms: u64,
    pub ended_at_ms: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Conversation {
    pub id: String,
    pub project_id: String,
    pub cwd: String,
    pub title: String,
    pub created_at_ms: u64,
    pub segments: Vec<Segment>,
}

pub fn read_index(dir: &Path) -> Vec<Conversation> {
    #[derive(Deserialize)] struct Store { conversations: Vec<Conversation> }
    std::fs::read(dir.join("conversations.json")).ok()
        .and_then(|b| serde_json::from_slice::<Store>(&b).ok()).map(|s| s.conversations).unwrap_or_default()
}

fn timestamp(value: &Value) -> Option<u64> {
    chrono::DateTime::parse_from_rfc3339(value.as_str()?).ok()
        .and_then(|d| u64::try_from(d.timestamp_millis()).ok())
}

fn resolve(segment: &Segment, conversation: &Conversation, profiles: &[crate::Profile]) -> Option<PathBuf> {
    let profile = profiles.iter().find(|p| Some(&p.id) == segment.profile_id.as_ref() && p.provider == segment.provider)?;
    let root = Path::new(&profile.config_dir).canonicalize().ok()?;
    if let Some(path) = &segment.transcript_path {
        let path = Path::new(path).canonicalize().ok()?;
        return (path.starts_with(&root) && path.extension().is_some_and(|e| e == "jsonl")).then_some(path);
    }
    if segment.provider != "codex" { return None; }
    let candidates: Vec<_> = crate::rollouts(&root.join("sessions")).into_iter().filter(|path| {
        let Ok(file) = File::open(path) else { return false };
        let Some(Ok(line)) = BufReader::new(file).lines().next() else { return false };
        let Ok(value) = serde_json::from_str::<Value>(&line) else { return false };
        if value["type"] != "session_meta" { return false; }
        let meta = &value["payload"];
        if let Some(id) = &segment.external_session_id { return meta["id"].as_str() == Some(id.as_str()); }
        let same_cwd = meta["cwd"].as_str().is_some_and(|cwd| cwd.replace('\\',"/").eq_ignore_ascii_case(&conversation.cwd.replace('\\',"/")));
        same_cwd && timestamp(&meta["timestamp"]).or_else(|| timestamp(&value["timestamp"]))
            .is_some_and(|t| t.abs_diff(segment.started_at_ms) <= 30_000)
    }).collect();
    (candidates.len() == 1).then(|| candidates[0].clone())
}

#[derive(Serialize)]
pub struct Message { pub id: String, pub role: String, pub text: String, pub provider: String, pub timestamp: Option<String> }
#[derive(Serialize)]
pub struct Timeline { pub messages: Vec<Message>, pub next_cursor: Option<usize>, pub unavailable_segments: Vec<usize> }

fn text_message(value: &Value, provider: &str) -> Option<(String, String)> {
    if value["isSidechain"] == true { return None; }
    let message = match provider {
        "claude" if value["type"] == "user" || value["type"] == "assistant" => &value["message"],
        "codex" if value["type"] == "response_item" && value["payload"]["type"] == "message" => &value["payload"],
        _ => return None,
    };
    let role = message["role"].as_str()?;
    if role != "user" && role != "assistant" { return None; }
    let text = if let Some(s) = message["content"].as_str() { s.to_owned() } else {
        message["content"].as_array()?.iter().filter(|b| matches!(b["type"].as_str(),Some("text" | "input_text" | "output_text")))
            .filter_map(|b| b["text"].as_str()).collect::<Vec<_>>().join("\n")
    };
    (!text.trim().is_empty()).then_some((role.into(), text))
}

pub fn timeline(conversation: &Conversation, profiles: &[crate::Profile], cursor: usize, limit: usize) -> Timeline {
    let mut result = Timeline { messages: Vec::new(), next_cursor: None, unavailable_segments: Vec::new() };
    let mut seen = HashSet::new();
    let mut count = 0;
    for (segment_index, segment) in conversation.segments.iter().enumerate() {
        let Some(path) = resolve(segment, conversation, profiles) else { result.unavailable_segments.push(segment_index); continue };
        let Ok(file) = File::open(path) else { result.unavailable_segments.push(segment_index); continue };
        for line in BufReader::new(file).lines().map_while(Result::ok) {
            let Ok(value) = serde_json::from_str::<Value>(&line) else { continue };
            let Some((role,text)) = text_message(&value,&segment.provider) else { continue };
            // Claude UUIDs survive profile copies. Codex records preserve timestamp/content.
            let identity = value["uuid"].as_str().map(str::to_owned).unwrap_or_else(|| line.clone());
            if !seen.insert(format!("{}:{identity}",segment.provider)) { continue; }
            if count >= cursor {
                if result.messages.len() >= limit.clamp(1,100) { result.next_cursor = Some(count); return result; }
                result.messages.push(Message { id: format!("{}:{count}",conversation.id),role,text,provider:segment.provider.clone(),timestamp:value["timestamp"].as_str().map(str::to_owned) });
            }
            count += 1;
        }
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    #[test] fn text_only_and_provider_formats() {
        assert_eq!(text_message(&json!({"type":"response_item","payload":{"type":"message","role":"assistant","content":[{"type":"output_text","text":"oi"}]}}),"codex"),Some(("assistant".into(),"oi".into())));
        assert!(text_message(&json!({"type":"user","message":{"role":"user","content":[{"type":"tool_result","content":"secret"}]}}),"claude").is_none());
    }

    #[test] fn pagination_deduplicates_copied_claude_messages_and_rejects_outside_profile() {
        let dir = tempfile::tempdir().unwrap();
        let transcript = dir.path().join("transcript.jsonl");
        std::fs::write(&transcript,(0..105).map(|i|json!({"uuid":format!("m{i}"),"type":"user","message":{"role":"user","content":format!("message {i}")}}).to_string()).collect::<Vec<_>>().join("\n")).unwrap();
        let profile = crate::Profile{id:"p".into(),provider:"claude".into(),name:"Test".into(),config_dir:dir.path().to_string_lossy().into_owned(),builtin:false,created_at_ms:0,last_used_at_ms:None,authenticated:false};
        let segment = Segment{provider:"claude".into(),profile_id:Some("p".into()),external_session_id:None,transcript_path:Some(transcript.to_string_lossy().into_owned()),terminal_session_id:None,started_at_ms:0,ended_at_ms:None};
        let conversation = Conversation{id:"c".into(),project_id:"project".into(),cwd:"C:/test".into(),title:"test".into(),created_at_ms:0,segments:vec![segment.clone(),segment]};
        let first = timeline(&conversation,std::slice::from_ref(&profile),0,100);
        assert_eq!(first.messages.len(),100); assert_eq!(first.next_cursor,Some(100));
        let second = timeline(&conversation,std::slice::from_ref(&profile),100,100);
        assert_eq!(second.messages.len(),5); assert!(second.next_cursor.is_none());
        let wrong = crate::Profile{config_dir:dir.path().join("other").to_string_lossy().into_owned(),..profile};
        assert_eq!(timeline(&conversation,&[wrong],0,100).unavailable_segments,vec![0,1]);
    }
}
