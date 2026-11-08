//! Subagentes do Claude Code. Cada um grava `<sessão>/subagents/agent-<id>.jsonl` ao lado do transcript
//! da conversa, com um `.meta.json` (tipo, descrição e o `toolUseId` da chamada que o abriu).
use serde::Serialize;
use serde_json::Value;
use std::{io::{BufRead, BufReader}, path::{Path, PathBuf}};

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Subagente {
    pub id: String,
    pub tipo: String,
    pub descricao: String,
    /// `rodando`, `concluido` ou `parado`.
    pub estado: &'static str,
    /// Última ação dele (ferramenta e alvo), para a lista mostrar o que está fazendo agora.
    pub ultima_acao: Option<String>,
    pub atualizado_ms: u64,
}

pub fn pasta(transcript: &Path) -> PathBuf {
    transcript.with_extension("").join("subagents")
}

/// Arquivo do subagente `id` desta conversa. `None` para id que não é de subagente (sem `..` nem barra).
pub fn arquivo(transcript: &Path, id: &str) -> Option<PathBuf> {
    let valido = !id.is_empty() && id.chars().all(|c| c.is_ascii_alphanumeric());
    valido.then(|| pasta(transcript).join(format!("agent-{id}.jsonl"))).filter(|p| p.is_file())
}

/// Subagentes da conversa, os mais recentes primeiro. `viva = false` (sessão fechada): quem não
/// terminou não está mais rodando.
pub fn listar(transcript: &Path, viva: bool) -> Vec<Subagente> {
    let Ok(entradas) = std::fs::read_dir(pasta(transcript)) else { return Vec::new() };
    let pai = std::fs::read_to_string(transcript).unwrap_or_default();
    let mut lista: Vec<_> = entradas.flatten().filter_map(|entrada| {
        let caminho = entrada.path();
        let id = caminho.file_name()?.to_str()?.strip_prefix("agent-")?.strip_suffix(".jsonl")?.to_owned();
        let meta: Value = std::fs::read(caminho.with_extension("meta.json")).ok()
            .and_then(|b| serde_json::from_slice(&b).ok()).unwrap_or(Value::Null);
        let (terminou, ultima_acao) = fim(&caminho);
        let estado = if terminou { "concluido" }
            else if !viva || parado_no_pai(&pai, meta["toolUseId"].as_str().unwrap_or("")) { "parado" }
            else { "rodando" };
        let atualizado_ms = entrada.metadata().ok()?.modified().ok()?
            .duration_since(std::time::UNIX_EPOCH).ok()?.as_millis() as u64;
        Some(Subagente {
            id,
            tipo: meta["agentType"].as_str().unwrap_or("Agente").to_owned(),
            descricao: meta["description"].as_str().unwrap_or_default().to_owned(),
            estado, ultima_acao, atualizado_ms,
        })
    }).collect();
    lista.sort_by_key(|s| std::cmp::Reverse(s.atualizado_ms));
    lista
}

/// Terminou (última fala com `end_turn`) e a última ação que fez.
fn fim(caminho: &Path) -> (bool, Option<String>) {
    let Ok(arquivo) = std::fs::File::open(caminho) else { return (false, None) };
    let (mut terminou, mut acao) = (false, None);
    for linha in BufReader::new(arquivo).lines().map_while(Result::ok) {
        let Ok(valor) = serde_json::from_str::<Value>(&linha) else { continue };
        if valor["type"] == "assistant" { terminou = valor["message"]["stop_reason"] == "end_turn"; }
        for item in crate::feed::items(&valor, "claude") {
            if item.kind == crate::feed::Kind::Tool {
                acao = Some(format!("{} {}", item.tool.unwrap_or_default(), item.text).trim().to_owned());
            }
        }
    }
    (terminou, acao)
}

/// Parado pela CLI ou pelo usuário: o aviso `<task-notification>` daquela chamada diz `killed`/`stopped`.
fn parado_no_pai(pai: &str, tool_use_id: &str) -> bool {
    if tool_use_id.is_empty() { return false; }
    let marca = format!("<tool-use-id>{tool_use_id}</tool-use-id>");
    pai.match_indices(&marca).any(|(i, _)| {
        let resto = &pai[i..pai.len().min(i + 600)];
        resto.contains("<status>killed</status>") || resto.contains("<status>stopped</status>")
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn grava(pasta: &Path, id: &str, meta: Value, linhas: &[Value]) {
        std::fs::write(pasta.join(format!("agent-{id}.meta.json")), meta.to_string()).unwrap();
        std::fs::write(pasta.join(format!("agent-{id}.jsonl")), linhas.iter().map(Value::to_string).collect::<Vec<_>>().join("\n")).unwrap();
    }

    #[test]
    fn le_estado_e_ultima_acao_de_cada_subagente() {
        let dir = tempfile::tempdir().unwrap();
        let transcript = dir.path().join("sessao.jsonl");
        let sub = pasta(&transcript);
        std::fs::create_dir_all(&sub).unwrap();
        let bash = json!({"type":"assistant","message":{"role":"assistant","stop_reason":"tool_use","content":[{"type":"tool_use","id":"t1","name":"Bash","input":{"command":"npm test"}}]}});
        let fim = json!({"type":"assistant","message":{"role":"assistant","stop_reason":"end_turn","content":[{"type":"text","text":"Pronto"}]}});
        grava(&sub, "a1", json!({"agentType":"Explore","description":"Mapear rotas","toolUseId":"tu1"}), &[bash.clone()]);
        grava(&sub, "a2", json!({"agentType":"general-purpose","description":"Rodar testes","toolUseId":"tu2"}), &[bash.clone(), fim]);
        grava(&sub, "a3", json!({"agentType":"Explore","description":"Parado","toolUseId":"tu3"}), &[bash]);
        std::fs::write(&transcript, "<task-notification>\\n<tool-use-id>tu3</tool-use-id>\\n<status>killed</status>").unwrap();

        let lista = listar(&transcript, true);
        let estado = |id: &str| lista.iter().find(|s| s.id == id).unwrap().estado;
        assert_eq!((estado("a1"), estado("a2"), estado("a3")), ("rodando", "concluido", "parado"));
        let a1 = lista.iter().find(|s| s.id == "a1").unwrap();
        assert_eq!((a1.tipo.as_str(), a1.descricao.as_str()), ("Explore", "Mapear rotas"));
        assert!(a1.ultima_acao.as_deref().is_some_and(|a| a.contains("npm test")), "{:?}", a1.ultima_acao);

        assert_eq!(listar(&transcript, false).iter().find(|s| s.id == "a1").unwrap().estado, "parado", "sessão fechada não roda nada");
        assert!(arquivo(&transcript, "a1").is_some());
        assert!(arquivo(&transcript, "../x").is_none());
    }
}
