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

/// Grava o índice inteiro. Escrita atômica via `.tmp` + rename, igual ao resto dos stores.
///
/// **Dois escritores agora**: desktop e engine (uma sessão aberta pelo celular nasce no engine).
/// Não há lock entre processos, então um spawn pelo telefone exatamente durante uma troca de conta
/// no PC pode perder um segmento. Aceitável: as duas escritas são raras e o índice é reconstruível a
/// partir dos transcripts.
/// ponytail: sem lock; se isso passar a doer, centralizar toda escrita no engine.
pub fn write_index(dir: &Path, conversations: &[Conversation]) -> std::io::Result<()> {
    let path = dir.join("conversations.json");
    let encoded = serde_json::to_vec_pretty(&serde_json::json!({"version":1,"conversations":conversations}))?;
    let temporary = path.with_extension("json.tmp");
    std::fs::write(&temporary, encoded)?;
    std::fs::rename(temporary, path)
}

/// Nome do diretório onde o Claude Code guarda os transcripts de um projeto: o caminho absoluto
/// com todo caractere não-alfanumérico virando `-`, caixa preservada.
/// `D:\PROGRAMACAO\...\OMNI-AGENTS` -> `D--PROGRAMACAO-...-OMNI-AGENTS`
pub fn claude_project_slug(cwd: &str) -> String {
    cwd.trim_end_matches(['\\', '/'])
        .chars()
        .map(|character| if character.is_ascii_alphanumeric() { character } else { '-' })
        .collect()
}

/// Onde o transcript de uma sessão do Claude vai parar, dado o config dir daquela conta.
pub fn claude_transcript_path(config_dir: &Path, cwd: &str, session_id: &str) -> PathBuf {
    config_dir.join("projects").join(claude_project_slug(cwd)).join(format!("{session_id}.jsonl"))
}

pub(crate) fn timestamp(value: &Value) -> Option<u64> {
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
pub struct Timeline {
    pub messages: Vec<Message>,
    pub next_cursor: Option<usize>,
    /// Onde começa a página anterior a esta. `None` = esta já começa na primeira mensagem.
    pub prev_cursor: Option<usize>,
    pub unavailable_segments: Vec<usize>,
}

pub(crate) fn text_message(value: &Value, provider: &str) -> Option<(String, String)> {
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

/// Uma página da conversa. `cursor: None` devolve as **últimas** `limit` mensagens — é o que um chat
/// abre mostrando. Antes só existia a leitura a partir do início, e numa conversa com mais de 100
/// mensagens a resposta nova nunca aparecia na tela sem paginar até o fim.
pub fn timeline(conversation: &Conversation, profiles: &[crate::Profile], cursor: Option<usize>, limit: usize) -> Timeline {
    let limit = limit.clamp(1,100);
    let mut result = Timeline { messages: Vec::new(), next_cursor: None, prev_cursor: None, unavailable_segments: Vec::new() };
    let mut fim: std::collections::VecDeque<Message> = std::collections::VecDeque::with_capacity(limit + 1);
    let mut seen = HashSet::new();
    let mut count = 0;
    'segmentos: for (segment_index, segment) in conversation.segments.iter().enumerate() {
        // O Claude só grava o `.jsonl` depois da primeira mensagem. Conversa recém-aberta tem o
        // caminho já fixado (`--session-id`) mas nenhum arquivo: isso é "vazia", não "indisponível".
        // Antes caía no aviso de histórico perdido logo na primeira abertura. Nada é lido aqui, então
        // pular não abre brecha na checagem de caminho feita em `resolve`.
        if segment.transcript_path.as_deref().is_some_and(|path| !Path::new(path).exists()) { continue }
        let Some(path) = resolve(segment, conversation, profiles) else { result.unavailable_segments.push(segment_index); continue };
        let Ok(file) = File::open(path) else { result.unavailable_segments.push(segment_index); continue };
        for line in BufReader::new(file).lines().map_while(Result::ok) {
            let Ok(value) = serde_json::from_str::<Value>(&line) else { continue };
            let Some((role,text)) = text_message(&value,&segment.provider) else { continue };
            // Claude UUIDs survive profile copies. Codex records preserve timestamp/content.
            let identity = value["uuid"].as_str().map(str::to_owned).unwrap_or_else(|| line.clone());
            if !seen.insert(format!("{}:{identity}",segment.provider)) { continue; }
            let mensagem = |role,text| Message { id: format!("{}:{count}",conversation.id),role,text,
                provider:segment.provider.clone(),timestamp:value["timestamp"].as_str().map(str::to_owned) };
            match cursor {
                Some(inicio) if count >= inicio => {
                    if result.messages.len() >= limit { result.next_cursor = Some(count); break 'segmentos; }
                    result.messages.push(mensagem(role,text));
                }
                Some(_) => {}
                None => {
                    fim.push_back(mensagem(role,text));
                    if fim.len() > limit { fim.pop_front(); }
                }
            }
            count += 1;
        }
    }
    let inicio = match cursor {
        Some(inicio) => inicio,
        None => { result.messages = fim.into(); count - result.messages.len() }
    };
    result.prev_cursor = (inicio > 0).then(|| inicio.saturating_sub(limit));
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
        let first = timeline(&conversation,std::slice::from_ref(&profile),Some(0),100);
        assert_eq!(first.messages.len(),100); assert_eq!(first.next_cursor,Some(100)); assert!(first.prev_cursor.is_none());
        let second = timeline(&conversation,std::slice::from_ref(&profile),Some(100),100);
        assert_eq!(second.messages.len(),5); assert!(second.next_cursor.is_none()); assert_eq!(second.prev_cursor,Some(0));
        let wrong = crate::Profile{config_dir:dir.path().join("other").to_string_lossy().into_owned(),..profile};
        assert_eq!(timeline(&conversation,&[wrong],Some(0),100).unavailable_segments,vec![0,1]);
    }

    /// O chat abre no fim: sem cursor vêm as últimas mensagens, com a mais nova por último, e o
    /// cursor para buscar as anteriores. Os ids batem com os da leitura paginada.
    #[test] fn sem_cursor_devolve_o_fim_da_conversa() {
        let dir = tempfile::tempdir().unwrap();
        let transcript = dir.path().join("transcript.jsonl");
        std::fs::write(&transcript,(0..250).map(|i|json!({"uuid":format!("m{i}"),"type":"user","message":{"role":"user","content":format!("message {i}")}}).to_string()).collect::<Vec<_>>().join("\n")).unwrap();
        let profile = crate::Profile{id:"p".into(),provider:"claude".into(),name:"Test".into(),config_dir:dir.path().to_string_lossy().into_owned(),builtin:false,created_at_ms:0,last_used_at_ms:None,authenticated:false};
        let segment = Segment{provider:"claude".into(),profile_id:Some("p".into()),external_session_id:None,transcript_path:Some(transcript.to_string_lossy().into_owned()),terminal_session_id:None,started_at_ms:0,ended_at_ms:None};
        let conversation = Conversation{id:"c".into(),project_id:"project".into(),cwd:"C:/test".into(),title:"test".into(),created_at_ms:0,segments:vec![segment]};

        let fim = timeline(&conversation,std::slice::from_ref(&profile),None,100);
        assert_eq!(fim.messages.len(),100);
        assert_eq!(fim.messages.first().unwrap().text,"message 150");
        assert_eq!(fim.messages.last().unwrap().text,"message 249");
        assert!(fim.next_cursor.is_none());
        assert_eq!(fim.prev_cursor,Some(50));

        let antes = timeline(&conversation,std::slice::from_ref(&profile),fim.prev_cursor,100);
        assert_eq!(antes.messages.first().unwrap().text,"message 50");
        assert_eq!(antes.next_cursor,Some(150));
        assert_eq!(antes.prev_cursor,Some(0));
        assert_eq!(antes.messages[0].id,"c:50");
        assert_eq!(fim.messages[0].id,"c:150");

        // Conversa curta: tudo numa página, sem nada antes.
        let curta = timeline(&conversation,std::slice::from_ref(&profile),None,500);
        assert_eq!(curta.messages.len(),100, "limite continua travado em 100");
    }

    /// Conversa recém-aberta: caminho do transcript já fixado, arquivo ainda não gravado. Isso é
    /// "sem mensagens ainda", não "histórico indisponível" — que era o aviso que o celular mostrava.
    #[test] fn transcript_ainda_nao_gravado_e_vazio_e_nao_indisponivel() {
        let dir = tempfile::tempdir().unwrap();
        let profile = crate::Profile{id:"p".into(),provider:"claude".into(),name:"Test".into(),config_dir:dir.path().to_string_lossy().into_owned(),builtin:true,created_at_ms:0,last_used_at_ms:None,authenticated:false};
        let futuro = dir.path().join("projects").join("x").join("ainda-nao-existe.jsonl");
        let segment = Segment{provider:"claude".into(),profile_id:Some("p".into()),external_session_id:Some("s".into()),transcript_path:Some(futuro.to_string_lossy().into_owned()),terminal_session_id:None,started_at_ms:0,ended_at_ms:None};
        let conversation = Conversation{id:"c".into(),project_id:"project".into(),cwd:"C:/test".into(),title:"test".into(),created_at_ms:0,segments:vec![segment]};
        let vazia = timeline(&conversation,std::slice::from_ref(&profile),None,100);
        assert!(vazia.messages.is_empty());
        assert!(vazia.unavailable_segments.is_empty(),"arquivo ainda não gravado não é histórico perdido");
    }
}

#[cfg(test)]
mod slug_tests {
    use super::*;

    #[test]
    fn slug_matches_the_layout_claude_uses_on_disk() {
        // Conferido contra ~/.claude/projects nesta máquina.
        assert_eq!(
            claude_project_slug(r"D:\PROGRAMACAO\PROJETOS\PROJETOS_REACT\OMNI-AGENTS"),
            "D--PROGRAMACAO-PROJETOS-PROJETOS-REACT-OMNI-AGENTS"
        );
        assert_eq!(claude_project_slug(r"C:\Users\Felipe Campos"), "C--Users-Felipe-Campos");
        // Barra final não pode gerar um sufixo a mais.
        assert_eq!(claude_project_slug(r"C:\Users\dev\"), "C--Users-dev");
    }
}
