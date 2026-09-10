//! Conversa lógica: uma timeline que atravessa troca de conta e de IA.
//!
//! **Isto é um índice, não um transcript.** Claude e Codex já gravam a conversa inteira em disco
//! (um `.jsonl` deste projeto passa de 5 MB); duplicar isso seria desperdício puro. O OMNI grava
//! só ponteiros — quais conversas existem e, por conversa, a lista de trechos com provider,
//! profile, id da sessão nativa e caminho do arquivo. São dezenas de linhas, escritas quando a
//! conversa nasce e quando o usuário troca de conta.
//!
//! Consequência de projeto: **não existe tailer**. Sem mensagens para guardar, não há motivo para
//! seguir arquivo nenhum — o `.jsonl` só é lido sob demanda, no handoff forçado.

use omni_protocol::{atomic_write_json, read_json_or_default};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{
    fs,
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};

/// Teto do briefing gerado a partir do transcript. Passa longe do limite de linha de comando do
/// Windows porque o agente novo recebe só o **caminho** do arquivo, nunca o conteúdo.
const HANDOFF_BUDGET_CHARS: usize = 12_000;

pub use omni_core::conversations::{Conversation, Segment};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConversationStore {
    pub version: u16,
    pub conversations: Vec<Conversation>,
}

impl Default for ConversationStore {
    fn default() -> Self {
        Self { version: 1, conversations: Vec::new() }
    }
}

/// O que a UI precisa para abrir o próximo terminal desta conversa.
#[derive(Debug, Clone, Serialize)]
pub struct LaunchPlan {
    pub conversation_id: String,
    pub provider: String,
    pub profile_id: Option<String>,
    pub initial_command: String,
    pub external_session_id: Option<String>,
    /// `true` quando não houve continuação de verdade e o agente novo recebe só um briefing.
    pub handoff: bool,
    pub handoff_path: Option<String>,
    /// Explicação curta para a UI mostrar antes de trocar.
    pub notice: Option<String>,
}

fn store_path() -> Result<PathBuf, String> {
    crate::engine_client::engine_dir().map(|dir| dir.join("conversations.json"))
}

fn load() -> ConversationStore {
    store_path().map(|path| read_json_or_default(&path)).unwrap_or_default()
}

fn save(store: &ConversationStore) -> Result<(), String> {
    atomic_write_json(&store_path()?, store).map_err(|error| error.to_string())
}

fn now_ms() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_millis() as u64
}

/// Nome do diretório onde o Claude Code guarda os transcripts de um projeto: o caminho absoluto
/// com todo caractere não-alfanumérico virando `-`, caixa preservada.
/// `D:\PROGRAMACAO\...\OMNI-AGENTS` -> `D--PROGRAMACAO-...-OMNI-AGENTS`
fn claude_project_slug(cwd: &str) -> String {
    cwd.trim_end_matches(['\\', '/'])
        .chars()
        .map(|character| if character.is_ascii_alphanumeric() { character } else { '-' })
        .collect()
}

/// Onde o transcript de uma sessão do Claude vai parar, dado o config dir daquela conta.
/// Confirmado contra o `projectsDirectory` que `claude auth status` reporta.
fn claude_transcript_path(config_dir: &Path, cwd: &str, session_id: &str) -> PathBuf {
    config_dir.join("projects").join(claude_project_slug(cwd)).join(format!("{session_id}.jsonl"))
}

fn find_mut<'a>(
    store: &'a mut ConversationStore,
    conversation_id: &str,
) -> Result<&'a mut Conversation, String> {
    store
        .conversations
        .iter_mut()
        .find(|conversation| conversation.id == conversation_id)
        .ok_or_else(|| "Conversa não encontrada".to_string())
}

#[tauri::command]
pub fn list_conversations(project_id: String) -> Vec<Conversation> {
    let mut conversations: Vec<Conversation> = load()
        .conversations
        .into_iter()
        .filter(|conversation| conversation.project_id == project_id)
        .collect();
    conversations.sort_by_key(|conversation| std::cmp::Reverse(conversation.created_at_ms));
    conversations
}

/// Abre uma conversa nova. Para o Claude, gera o UUID e devolve `claude --session-id <uuid>`:
/// escolher o id na largada é o que torna o caminho do transcript conhecido desde já, sem precisar
/// vigiar diretório atrás do arquivo que acabou de nascer.
#[tauri::command]
pub fn begin_conversation(
    project_id: String,
    cwd: String,
    provider: String,
    profile_id: Option<String>,
    command: String,
    title: Option<String>,
) -> Result<LaunchPlan, String> {
    let profile = profile_id
        .as_deref()
        .and_then(crate::profiles::find)
        .or_else(|| crate::profiles::preferred(&provider));

    let (external_session_id, transcript_path, initial_command) = if provider == "claude" {
        let session_id = uuid::Uuid::new_v4().to_string();
        let transcript = profile
            .as_ref()
            .map(|profile| claude_transcript_path(Path::new(&profile.config_dir), &cwd, &session_id))
            .map(|path| path.to_string_lossy().into_owned());
        let command = format!("{command} --session-id {session_id}");
        (Some(session_id), transcript, command)
    } else {
        // Codex e Gemini não deixam escolher o id da sessão; o trecho nasce sem transcript e só
        // resolve depois, se alguém precisar.
        (None, None, command)
    };

    let conversation = Conversation {
        id: format!("conv-{}", uuid::Uuid::new_v4()),
        project_id,
        cwd,
        title: title.unwrap_or_else(|| "Conversa".into()),
        created_at_ms: now_ms(),
        segments: vec![Segment {
            provider: provider.clone(),
            profile_id: profile.as_ref().map(|profile| profile.id.clone()),
            external_session_id: external_session_id.clone(),
            transcript_path,
            terminal_session_id: None,
            started_at_ms: now_ms(),
            ended_at_ms: None,
        }],
    };

    let mut store = load();
    let plan = LaunchPlan {
        conversation_id: conversation.id.clone(),
        provider,
        profile_id: conversation.segments[0].profile_id.clone(),
        initial_command,
        external_session_id,
        handoff: false,
        handoff_path: None,
        notice: None,
    };
    store.conversations.push(conversation);
    save(&store)?;
    Ok(plan)
}

/// Liga o trecho corrente ao terminal que acabou de subir, para que a troca de conta saiba qual
/// sessão parar.
#[tauri::command]
pub fn attach_terminal(conversation_id: String, terminal_session_id: String) -> Result<(), String> {
    let mut store = load();
    let conversation = find_mut(&mut store, &conversation_id)?;
    if let Some(segment) = conversation.segments.last_mut() {
        segment.terminal_session_id = Some(terminal_session_id);
    }
    save(&store)
}

/// Prompt do handoff gracioso: pede ao agente que ainda responde para deixar o briefing em disco
/// antes de sair. Sempre preferível ao forçado — o agente sabe o que estava fazendo.
#[tauri::command]
pub fn handoff_prompt(conversation_id: String) -> String {
    format!(
        "Antes de encerrar: escreva o arquivo .omni/handoff/{conversation_id}.md com o contexto \
         desta conversa para outro agente continuar. Inclua, em português e de forma objetiva: \
         objetivo, o que já foi feito, arquivos tocados, decisões tomadas e próximo passo. \
         Não inclua saída de ferramenta nem transcrição literal."
    )
}

/// Prepara a troca de conta ou de IA desta conversa.
///
/// - Mesmo provider ⇒ continuação de verdade: copia o `.jsonl` para o config dir da conta de
///   destino e retoma pelo mesmo id.
/// - Provider diferente ⇒ **handoff**, não continuação: não existe formato comum entre CLIs. O
///   agente novo começa do zero, lendo um briefing em markdown.
#[tauri::command]
pub fn plan_switch(
    conversation_id: String,
    target_provider: String,
    target_profile_id: Option<String>,
    target_command: String,
) -> Result<LaunchPlan, String> {
    let mut store = load();
    let conversation = find_mut(&mut store, &conversation_id)?.clone();
    let current = conversation
        .segments
        .last()
        .cloned()
        .ok_or_else(|| "Conversa sem trechos".to_string())?;

    let target_profile = target_profile_id
        .as_deref()
        .and_then(crate::profiles::find)
        .or_else(|| crate::profiles::preferred(&target_provider));

    let same_provider = current.provider == target_provider;
    let mut plan = LaunchPlan {
        conversation_id: conversation_id.clone(),
        provider: target_provider.clone(),
        profile_id: target_profile.as_ref().map(|profile| profile.id.clone()),
        initial_command: target_command.clone(),
        external_session_id: None,
        handoff: false,
        handoff_path: None,
        notice: None,
    };

    // Caminho feliz: mesma IA, outra conta. O transcript é o estado da conversa, então levá-lo
    // junto e retomar pelo mesmo id é continuação literal.
    if same_provider && target_provider == "claude" {
        if let (Some(session_id), Some(source), Some(profile)) =
            (&current.external_session_id, &current.transcript_path, &target_profile)
        {
            let destination =
                claude_transcript_path(Path::new(&profile.config_dir), &conversation.cwd, session_id);
            if Path::new(source).is_file() {
                if let Some(parent) = destination.parent() {
                    fs::create_dir_all(parent).map_err(|error| error.to_string())?;
                }
                fs::copy(source, &destination).map_err(|error| error.to_string())?;
                // Pré-aprova a pasta no config dir de destino, senão a conta nova esbarra no
                // diálogo de trust logo ao abrir.
                let _ = crate::engine_client::ensure_agent_trust(
                    "claude".into(),
                    conversation.cwd.clone(),
                    Some(profile.id.clone()),
                );
                plan.initial_command = format!("{target_command} --resume {session_id}");
                plan.external_session_id = Some(session_id.clone());
                push_segment(&mut store, &conversation_id, &plan, Some(destination))?;
                return Ok(plan);
            }
        }
    }

    // Todo o resto é handoff: reinício com briefing.
    let briefing = build_handoff(&conversation, &current)?;
    let path = write_handoff(&conversation, &briefing)?;
    let relative = format!(".omni/handoff/{conversation_id}.md");
    // Só o **caminho** vai por argumento. Passar o transcript inteiro estoura o limite de linha de
    // comando do Windows (32k) muito antes de qualquer conversa interessante.
    plan.initial_command = format!(
        "{target_command} \"Leia {relative} — contexto desta conversa. Continue de onde parou.\""
    );
    plan.handoff = true;
    plan.handoff_path = Some(path.to_string_lossy().into_owned());
    plan.notice = Some(if same_provider {
        "Não foi possível localizar o transcript desta conversa, então o agente novo recebe um \
         briefing em vez da conversa. Cache de prompt e aprovações não transferem."
            .into()
    } else {
        "Trocar de IA é um recomeço com briefing, não continuação: não existe formato de conversa \
         comum entre os CLIs. Cache de prompt, estado interno e aprovações não transferem."
            .into()
    });
    push_segment(&mut store, &conversation_id, &plan, None)?;
    Ok(plan)
}

fn push_segment(
    store: &mut ConversationStore,
    conversation_id: &str,
    plan: &LaunchPlan,
    transcript_path: Option<PathBuf>,
) -> Result<(), String> {
    let conversation = find_mut(store, conversation_id)?;
    if let Some(previous) = conversation.segments.last_mut() {
        previous.ended_at_ms = Some(now_ms());
    }
    conversation.segments.push(Segment {
        provider: plan.provider.clone(),
        profile_id: plan.profile_id.clone(),
        external_session_id: plan.external_session_id.clone(),
        transcript_path: transcript_path.map(|path| path.to_string_lossy().into_owned()),
        terminal_session_id: None,
        started_at_ms: now_ms(),
        ended_at_ms: None,
    });
    save(store)
}

fn write_handoff(conversation: &Conversation, body: &str) -> Result<PathBuf, String> {
    let directory = Path::new(&conversation.cwd).join(".omni").join("handoff");
    fs::create_dir_all(&directory).map_err(|error| error.to_string())?;
    let path = directory.join(format!("{}.md", conversation.id));
    fs::write(&path, body).map_err(|error| error.to_string())?;
    Ok(path)
}

/// Briefing forçado: lê o transcript do provider e reduz a texto.
///
/// Sendo honesto sobre o que isto é — um resumo do fim da conversa, não um briefing estruturado. O
/// parser não sabe inventar "próximo passo"; por isso o cabeçalho do arquivo diz de onde veio.
/// O caminho gracioso (`handoff_prompt`) sempre produz algo melhor.
fn build_handoff(conversation: &Conversation, segment: &Segment) -> Result<String, String> {
    let header = format!(
        "# Handoff — {}\n\n> Gerado automaticamente pelo OMNI AGENTS a partir do transcript do \
         {}. É um resumo das últimas mensagens, não um briefing escrito pelo agente: saída de \
         ferramenta foi descartada e o começo da conversa pode ter sido cortado.\n\n\
         Projeto: `{}`\n\n",
        conversation.title, segment.provider, conversation.cwd
    );

    let Some(path) = segment.transcript_path.as_deref().filter(|path| Path::new(path).is_file())
    else {
        return Ok(format!(
            "{header}## Contexto\n\nO transcript desta conversa não foi encontrado em disco, então \
             não há histórico para repassar. Peça ao usuário o contexto antes de continuar.\n"
        ));
    };

    let transcript = fs::read_to_string(path).map_err(|error| error.to_string())?;
    let turns = parse_claude_transcript(&transcript);
    if turns.is_empty() {
        return Ok(format!(
            "{header}## Contexto\n\nO transcript foi encontrado mas não produziu nenhuma mensagem \
             legível. Peça ao usuário o contexto antes de continuar.\n"
        ));
    }
    Ok(format!("{header}## Conversa (final)\n\n{}", tail_within_budget(&turns)))
}

/// Extrai só o texto de `user` e `assistant` de um `.jsonl` do Claude Code, descartando `tool_use`
/// e `tool_result`.
///
/// ponytail: formato não documentado, best-effort por contrato — linha que não casar é ignorada em
/// vez de derrubar o handoff. Cobre só o formato do Claude; sair de um Codex mudo cai no
/// `handoff_prompt` gracioso.
fn parse_claude_transcript(transcript: &str) -> Vec<(String, String)> {
    transcript
        .lines()
        .filter_map(|line| serde_json::from_str::<Value>(line).ok())
        .filter(|entry| entry.get("isSidechain").and_then(Value::as_bool) != Some(true))
        .filter_map(|entry| {
            let role = match entry.get("type").and_then(Value::as_str)? {
                "user" => "Usuário",
                "assistant" => "Agente",
                _ => return None,
            };
            let text = message_text(entry.get("message")?)?;
            Some((role.to_owned(), text))
        })
        .collect()
}

/// O `content` de uma mensagem é uma string ou uma lista de blocos; só os blocos `text` importam.
fn message_text(message: &Value) -> Option<String> {
    let content = message.get("content")?;
    if let Some(text) = content.as_str() {
        let text = text.trim();
        return (!text.is_empty()).then(|| text.to_owned());
    }
    let joined = content
        .as_array()?
        .iter()
        .filter(|block| block.get("type").and_then(Value::as_str) == Some("text"))
        .filter_map(|block| block.get("text").and_then(Value::as_str))
        .collect::<Vec<_>>()
        .join("\n")
        .trim()
        .to_owned();
    (!joined.is_empty()).then_some(joined)
}

/// Mantém o **fim** da conversa: o começo é o que menos importa para quem vai continuar.
fn tail_within_budget(turns: &[(String, String)]) -> String {
    let mut kept: Vec<String> = Vec::new();
    let mut budget = HANDOFF_BUDGET_CHARS;
    for (role, text) in turns.iter().rev() {
        let block = format!("**{role}:** {text}\n");
        if block.chars().count() > budget {
            break;
        }
        budget -= block.chars().count();
        kept.push(block);
    }
    kept.reverse();
    if kept.len() < turns.len() {
        kept.insert(0, "_(mensagens anteriores omitidas)_\n".to_owned());
    }
    kept.join("\n")
}

#[cfg(test)]
mod tests {
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

    #[test]
    fn transcript_parser_keeps_text_and_drops_tool_traffic() {
        let transcript = [
            r#"{"type":"summary","summary":"ignorar"}"#,
            r#"{"type":"user","message":{"role":"user","content":"Conserte o login"}}"#,
            r#"{"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"Vou olhar o middleware"},{"type":"tool_use","name":"Read","input":{"file":"a.ts"}}]}}"#,
            r#"{"type":"user","message":{"role":"user","content":[{"type":"tool_result","content":"1000 linhas de saída"}]}}"#,
            r#"{"type":"assistant","isSidechain":true,"message":{"role":"assistant","content":[{"type":"text","text":"subagente"}]}}"#,
            "linha corrompida que não é json",
        ]
        .join("\n");

        let turns = parse_claude_transcript(&transcript);

        assert_eq!(
            turns,
            vec![
                ("Usuário".to_owned(), "Conserte o login".to_owned()),
                ("Agente".to_owned(), "Vou olhar o middleware".to_owned()),
            ]
        );
        // O que não pode aparecer no briefing, de jeito nenhum.
        let rendered = tail_within_budget(&turns);
        assert!(!rendered.contains("linhas de saída"), "saída de tool vazou pro handoff");
        assert!(!rendered.contains("subagente"), "sidechain vazou pro handoff");
    }

    #[test]
    fn budget_keeps_the_end_of_the_conversation() {
        let turns: Vec<(String, String)> = (0..500)
            .map(|index| ("Agente".to_owned(), format!("mensagem {index} ").repeat(20)))
            .collect();

        let rendered = tail_within_budget(&turns);

        assert!(rendered.chars().count() <= HANDOFF_BUDGET_CHARS + 64);
        assert!(rendered.contains("mensagem 499"), "a última mensagem tem que sobreviver");
        assert!(rendered.contains("mensagens anteriores omitidas"));
        assert!(!rendered.contains("mensagem 0 "), "o começo devia ter sido cortado");
    }
}
