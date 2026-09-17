use omni_protocol::{EngineRequest,EngineResponse,MobileConfig,PublishedAgent,PublishedProject,PublishedTheme,TotpAction};

/// `rotate` gera um token de dispositivo novo e invalida os celulares já pareados. O `token` que
/// vai dentro de `config` é ignorado pelo engine de propósito — o desktop não escolhe o segredo.
#[tauri::command]
pub async fn mobile_settings(config: Option<MobileConfig>, rotate: Option<bool>) -> Result<EngineResponse,String> {
    let rotate = rotate.unwrap_or(false);
    tauri::async_runtime::spawn_blocking(move || {
        match crate::engine_client::authenticated_request(|token| EngineRequest::MobileSettings{token,config,rotate})? {
            EngineResponse::Error{message,..} => Err(message),
            response @ EngineResponse::MobileSettings{..} => Ok(response),
            _ => Err("Engine incompatível; reinicie após atualizar".into()),
        }
    }).await.map_err(|e|e.to_string())?
}

/// Autoteste do servidor do celular. `listening` só prova que o bind deu certo; isto prova que
/// alguém consegue falar com ele e que o código de acesso está sendo exigido.
#[tauri::command]
pub async fn mobile_check() -> Result<EngineResponse,String> {
    tauri::async_runtime::spawn_blocking(|| {
        match crate::engine_client::authenticated_request(|token| EngineRequest::MobileCheck{token})? {
            EngineResponse::Error{message,..} => Err(message),
            response => Ok(response),
        }
    }).await.map_err(|e|e.to_string())?
}

/// Cadastro do Authy: `reset` gera o QR novo, `confirm` valida o primeiro código digitado no PC.
#[tauri::command]
pub async fn mobile_totp(action: String, code: Option<String>) -> Result<EngineResponse,String> {
    let action = match action.as_str() {
        "reset" => TotpAction::Reset,
        "confirm" => TotpAction::Confirm { code: code.unwrap_or_default() },
        outra => return Err(format!("Ação do Authy desconhecida: {outra}")),
    };
    tauri::async_runtime::spawn_blocking(move || {
        match crate::engine_client::authenticated_request(|token| EngineRequest::MobileTotp{token,action})? {
            EngineResponse::Error{message,..} => Err(message),
            response => Ok(response),
        }
    }).await.map_err(|e|e.to_string())?
}

/// O engine não conhece projetos: essa lista só existe no `localStorage` do webview. Sem publicar,
/// o celular só enxergaria projetos que já tiveram conversa registrada.
///
/// Repasse puro de propósito. Quem monta `agents` é o front, que já tem a lista de CLIs disponíveis
/// e a tabela de flags de retomada — duplicar isso no Rust só criaria duas versões para divergir.
#[tauri::command]
pub async fn publish_workspace(projects: Vec<PublishedProject>, agents: Vec<PublishedAgent>, theme: Option<PublishedTheme>) -> Result<EngineResponse,String> {
    tauri::async_runtime::spawn_blocking(move || {
        match crate::engine_client::authenticated_request(|token| EngineRequest::PublishWorkspace{token,projects,agents,theme})? {
            EngineResponse::Error{message,..} => Err(message),
            response => Ok(response),
        }
    }).await.map_err(|e|e.to_string())?
}
