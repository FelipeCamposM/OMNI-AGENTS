//! Histórico nativo do Claude Code e do Codex: tudo que o CLI gravou em disco, com a conversa aberta
//! pelo OMNI ou não. Diferente de `conversations`, que só conhece o que nasceu aqui dentro.
//! Só lê transcripts dentro da pasta de uma conta cadastrada; nunca toca em credencial.
use crate::{conversations::{text_message, timestamp}, Profile};
use serde::Serialize;
use serde_json::Value;
use std::{
    collections::{HashMap, VecDeque},
    fs::{self, File},
    io::{BufRead, BufReader},
    path::{Path, PathBuf},
    time::UNIX_EPOCH,
};

const PROMPT_PREVIEW_CHARS: usize = 400;
/// Teto da prévia: transcript longo passa de milhares de mensagens, e retomar no terminal mostra o resto.
const MAX_MESSAGES: usize = 400;

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct HistoryEntry {
    pub provider: String,
    pub profile_id: String,
    pub profile_name: String,
    /// Id nativo: o que `claude --resume` e `codex resume` recebem.
    pub session_id: String,
    pub title: Option<String>,
    pub first_prompt: Option<String>,
    pub cwd: Option<String>,
    pub started_at_ms: Option<u64>,
    pub updated_at_ms: u64,
    pub path: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct HistoryMessage {
    pub role: String,
    pub text: String,
    pub timestamp: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct HistoryTranscript {
    pub messages: Vec<HistoryMessage>,
    /// Mensagens de texto no arquivo inteiro; maior que `messages.len()` quando a prévia cortou o início.
    pub total: usize,
}

/// Caminho → (mtime, tamanho, resultado). Transcript que não mudou não é relido.
pub type ScanCache = HashMap<PathBuf, (u64, u64, Option<HistoryEntry>)>;

/// Texto que o CLI grava como se fosse do usuário: lembrete de sistema, saída de comando `/x`,
/// contexto de ambiente e AGENTS.md do Codex.
fn is_injected(text: &str) -> bool {
    let text = text.trim_start();
    text.starts_with('<') || text.starts_with("# AGENTS.md") || text.starts_with("Caveat:")
}

fn message(value: &Value, provider: &str) -> Option<HistoryMessage> {
    if value["isMeta"] == true { return None; }
    let (role, text) = text_message(value, provider)?;
    if role == "user" && is_injected(&text) { return None; }
    Some(HistoryMessage { role, text, timestamp: value["timestamp"].as_str().map(str::to_owned) })
}

fn preview(text: &str) -> String {
    text.split_whitespace().collect::<Vec<_>>().join(" ").chars().take(PROMPT_PREVIEW_CHARS).collect()
}

fn file_stamp(path: &Path) -> (u64, u64) {
    let Ok(metadata) = fs::metadata(path) else { return (0, 0) };
    let modified = metadata.modified().ok().and_then(|time| time.duration_since(UNIX_EPOCH).ok());
    (modified.map_or(0, |duration| duration.as_millis() as u64), metadata.len())
}

fn blank(provider: &str, profile: &Profile, session_id: String, path: &Path) -> HistoryEntry {
    HistoryEntry {
        provider: provider.into(),
        profile_id: profile.id.clone(),
        profile_name: profile.name.clone(),
        session_id,
        title: None,
        first_prompt: None,
        cwd: None,
        started_at_ms: None,
        updated_at_ms: file_stamp(path).0,
        path: path.to_string_lossy().into_owned(),
    }
}

/// `<config>/projects/<slug>/<uuid>.jsonl`. Título = último `ai-title` (o Claude reescreve conforme a
/// conversa anda). Sessão sem nenhum prompt digitado (só hook de inicialização) fica de fora.
pub fn claude_entry(path: &Path, profile: &Profile) -> Option<HistoryEntry> {
    let file = File::open(path).ok()?;
    let mut entry = blank("claude", profile, path.file_stem()?.to_string_lossy().into_owned(), path);
    let mut summary = None;
    for line in BufReader::new(file).lines().map_while(Result::ok) {
        // Só desserializa linha que interessa: transcript passa de 5 MB.
        if line.contains("\"type\":\"ai-title\"") {
            let title = serde_json::from_str::<Value>(&line).ok().and_then(|value| value["aiTitle"].as_str().map(str::to_owned));
            if title.is_some() { entry.title = title; }
        } else if line.contains("\"type\":\"summary\"") {
            summary = serde_json::from_str::<Value>(&line).ok().and_then(|value| value["summary"].as_str().map(str::to_owned));
        } else if entry.first_prompt.is_none() && line.contains("\"type\":\"user\"") {
            let Ok(value) = serde_json::from_str::<Value>(&line) else { continue };
            let Some(prompt) = message(&value, "claude").filter(|message| message.role == "user") else { continue };
            entry.first_prompt = Some(preview(&prompt.text));
            entry.cwd = value["cwd"].as_str().map(str::to_owned);
            entry.started_at_ms = timestamp(&value["timestamp"]);
        }
    }
    entry.first_prompt.as_ref()?;
    if entry.title.is_none() { entry.title = summary; }
    Some(entry)
}

/// `<config>/sessions/AAAA/MM/DD/rollout-*.jsonl`. A primeira linha é o `session_meta`; o título vem
/// do `session_index.jsonl` da conta.
pub fn codex_entry(path: &Path, profile: &Profile, titles: &HashMap<String, String>) -> Option<HistoryEntry> {
    let mut lines = BufReader::new(File::open(path).ok()?).lines().map_while(Result::ok);
    let first: Value = serde_json::from_str(&lines.next()?).ok()?;
    if first["type"] != "session_meta" { return None; }
    let meta = &first["payload"];
    let session_id = meta["id"].as_str()?.to_owned();
    let mut entry = blank("codex", profile, session_id, path);
    entry.title = titles.get(&entry.session_id).cloned();
    entry.cwd = meta["cwd"].as_str().map(str::to_owned);
    entry.started_at_ms = timestamp(&meta["timestamp"]).or_else(|| timestamp(&first["timestamp"]));
    for line in lines.filter(|line| line.contains("\"role\":\"user\"")) {
        let Ok(value) = serde_json::from_str::<Value>(&line) else { continue };
        if let Some(prompt) = message(&value, "codex").filter(|message| message.role == "user") {
            entry.first_prompt = Some(preview(&prompt.text));
            break;
        }
    }
    entry.first_prompt.as_ref()?;
    Some(entry)
}

fn codex_titles(config_dir: &Path) -> HashMap<String, String> {
    let Ok(file) = File::open(config_dir.join("session_index.jsonl")) else { return HashMap::new() };
    BufReader::new(file)
        .lines()
        .map_while(Result::ok)
        .filter_map(|line| serde_json::from_str::<Value>(&line).ok())
        .filter_map(|value| Some((value["id"].as_str()?.to_owned(), value["thread_name"].as_str()?.to_owned())))
        .collect()
}

/// Só `projects/<slug>/<arquivo>.jsonl` — as subpastas por sessão são de subagente e anexos.
fn claude_transcripts(config_dir: &Path) -> Vec<PathBuf> {
    let Ok(projects) = fs::read_dir(config_dir.join("projects")) else { return Vec::new() };
    projects
        .flatten()
        .filter(|project| project.file_type().is_ok_and(|kind| kind.is_dir()))
        .filter_map(|project| fs::read_dir(project.path()).ok())
        .flat_map(|files| files.flatten())
        .filter(|file| file.file_type().is_ok_and(|kind| kind.is_file()))
        .map(|file| file.path())
        .filter(|path| path.extension().is_some_and(|extension| extension == "jsonl"))
        .collect()
}

/// Todas as conversas do provider em todas as contas dele, da mais recente pra mais antiga.
/// Mesma sessão em duas contas (a troca de conta copia o `.jsonl`) aparece uma vez só: a mais nova.
pub fn scan(provider: &str, profiles: &[Profile], cache: &mut ScanCache) -> Vec<HistoryEntry> {
    let mut by_session: HashMap<String, HistoryEntry> = HashMap::new();
    for profile in profiles.iter().filter(|profile| profile.provider == provider) {
        let root = Path::new(&profile.config_dir);
        let (paths, titles) = match provider {
            "claude" => (claude_transcripts(root), HashMap::new()),
            "codex" => (crate::rollouts(&root.join("sessions")), codex_titles(root)),
            _ => continue,
        };
        for path in paths {
            let (modified, size) = file_stamp(&path);
            let cached = cache.get(&path).filter(|(m, s, _)| *m == modified && *s == size).map(|(_, _, entry)| entry.clone());
            let entry = match cached {
                Some(entry) => entry,
                None => {
                    let entry = if provider == "claude" { claude_entry(&path, profile) } else { codex_entry(&path, profile, &titles) };
                    cache.insert(path.clone(), (modified, size, entry.clone()));
                    entry
                }
            };
            // O título do Codex mora fora do rollout: pode ter mudado sem o arquivo mudar.
            let Some(mut entry) = entry else { continue };
            if provider == "codex" { entry.title = titles.get(&entry.session_id).cloned().or(entry.title); }
            let keep = by_session.get(&entry.session_id).is_none_or(|current| current.updated_at_ms < entry.updated_at_ms);
            if keep { by_session.insert(entry.session_id.clone(), entry); }
        }
    }
    let mut entries: Vec<_> = by_session.into_values().collect();
    entries.sort_by_key(|entry| std::cmp::Reverse(entry.updated_at_ms));
    entries
}

/// Mensagens de texto de um transcript — só se o arquivo mora dentro da pasta de uma conta do
/// provider. O caminho vem da UI, então é validado aqui e não lá.
pub fn transcript(path: &Path, provider: &str, profiles: &[Profile]) -> Option<HistoryTranscript> {
    let path = path.canonicalize().ok()?;
    if path.extension().is_none_or(|extension| extension != "jsonl") { return None; }
    let inside = profiles
        .iter()
        .filter(|profile| profile.provider == provider)
        .filter_map(|profile| Path::new(&profile.config_dir).canonicalize().ok())
        .any(|root| path.starts_with(root));
    if !inside { return None; }
    let mut messages = VecDeque::new();
    let mut total = 0;
    for line in BufReader::new(File::open(&path).ok()?).lines().map_while(Result::ok) {
        if !line.contains("\"role\":") { continue; }
        let Ok(value) = serde_json::from_str::<Value>(&line) else { continue };
        let Some(message) = message(&value, provider) else { continue };
        total += 1;
        messages.push_back(message);
        if messages.len() > MAX_MESSAGES { messages.pop_front(); }
    }
    Some(HistoryTranscript { messages: messages.into(), total })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn profile(provider: &str, dir: &Path) -> Profile {
        Profile { id: format!("{provider}-p"), provider: provider.into(), name: "Padrão".into(), config_dir: dir.to_string_lossy().into_owned(), builtin: true, created_at_ms: 0, last_used_at_ms: None, authenticated: false }
    }

    fn lines(values: &[Value]) -> String {
        values.iter().map(Value::to_string).collect::<Vec<_>>().join("\n")
    }

    #[test]
    fn lista_claude_e_codex_com_titulo_prompt_e_pasta_e_ignora_lixo() {
        let claude_dir = tempfile::tempdir().unwrap();
        let project = claude_dir.path().join("projects").join("C--dev-api");
        fs::create_dir_all(project.join("abc").join("subagents")).unwrap();
        fs::write(project.join("abc.jsonl"), lines(&[
            json!({"type":"user","isMeta":true,"message":{"role":"user","content":"meta"}}),
            json!({"type":"user","message":{"role":"user","content":"<command-name>/clear</command-name>"}}),
            json!({"type":"user","cwd":"C:\\dev\\api","timestamp":"2026-09-01T10:00:00Z","message":{"role":"user","content":"corrige   o login"}}),
            json!({"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"feito"}]}}),
            json!({"type":"ai-title","aiTitle":"Velho"}),
            json!({"type":"ai-title","aiTitle":"Corrigir login"}),
        ])).unwrap();
        // Só hook de inicialização, nenhum prompt: não é conversa.
        fs::write(project.join("vazia.jsonl"), lines(&[json!({"type":"mode","mode":"normal"})])).unwrap();
        fs::write(project.join("abc").join("subagents").join("x.jsonl"), "{}").unwrap();

        let mut cache = ScanCache::new();
        let claude = scan("claude", &[profile("claude", claude_dir.path())], &mut cache);
        assert_eq!(claude.len(), 1);
        assert_eq!(claude[0].session_id, "abc");
        assert_eq!(claude[0].title.as_deref(), Some("Corrigir login"));
        assert_eq!(claude[0].first_prompt.as_deref(), Some("corrige o login"));
        assert_eq!(claude[0].cwd.as_deref(), Some("C:\\dev\\api"));

        let codex_dir = tempfile::tempdir().unwrap();
        let day = codex_dir.path().join("sessions").join("2026").join("09").join("01");
        fs::create_dir_all(&day).unwrap();
        fs::write(day.join("rollout-2026-09-01-id1.jsonl"), lines(&[
            json!({"type":"session_meta","payload":{"id":"id1","cwd":"C:\\dev\\web","timestamp":"2026-09-01T10:00:00Z"}}),
            json!({"type":"response_item","payload":{"type":"message","role":"user","content":[{"type":"input_text","text":"<environment_context>x</environment_context>"}]}}),
            json!({"type":"response_item","payload":{"type":"message","role":"user","content":[{"type":"input_text","text":"cria a home"}]}}),
        ])).unwrap();
        fs::write(codex_dir.path().join("session_index.jsonl"), json!({"id":"id1","thread_name":"Criar home"}).to_string()).unwrap();

        let codex = scan("codex", &[profile("codex", codex_dir.path())], &mut cache);
        assert_eq!(codex.len(), 1);
        assert_eq!((codex[0].title.as_deref(), codex[0].first_prompt.as_deref()), (Some("Criar home"), Some("cria a home")));

        let full = transcript(Path::new(&claude[0].path), "claude", &[profile("claude", claude_dir.path())]).unwrap();
        assert_eq!(full.messages.iter().map(|m| m.text.as_str()).collect::<Vec<_>>(), ["corrige   o login", "feito"]);
        // Caminho de outra conta/provider não é lido.
        assert!(transcript(Path::new(&claude[0].path), "codex", &[profile("codex", codex_dir.path())]).is_none());
    }
}
