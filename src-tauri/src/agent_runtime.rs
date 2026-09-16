//! Modelo e esforço em uso por uma sessão de agente, lidos do registro que a própria CLI grava.
//!
//! Fica no lado do app (e não no engine) porque é leitura de arquivo do usuário, sem estado e sem
//! PTY envolvida — passar pelo engine só adicionaria um salto de rede para ler um arquivo local.
use omni_core::runtime::{claude_runtime, codex_runtime, AgentRuntime};
use std::path::Path;

/// `Ok(None)` = provider sem registro legível (ou sessão que ainda não produziu turno nenhum).
/// Isso é estado normal, não erro: a UI simplesmente não mostra a etiqueta.
#[tauri::command]
pub async fn agent_runtime(
    provider: String,
    profile_id: Option<String>,
    cwd: String,
    external_session_id: Option<String>,
) -> Result<Option<AgentRuntime>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let config_dir = crate::profiles::find(profile_id.as_deref().unwrap_or(""))
            .or_else(|| crate::profiles::preferred(&provider))
            .map(|profile| profile.config_dir)
            .ok_or("Perfil não encontrado")?;
        let config_dir = Path::new(&config_dir);

        Ok(match provider.as_str() {
            // Sem `external_session_id` não há como saber QUAL transcript é desta aba — e chutar o
            // mais recente mostraria o modelo de outra sessão do mesmo projeto.
            "claude" => external_session_id
                .as_deref()
                .and_then(|session| claude_runtime(config_dir, &cwd, session)),
            "codex" => codex_runtime(config_dir, &cwd),
            _ => None,
        })
    })
    .await
    .map_err(|erro| erro.to_string())?
}
