use omni_protocol::{EngineRequest,EngineResponse,MobileConfig};

#[tauri::command]
pub async fn mobile_settings(config: Option<MobileConfig>) -> Result<EngineResponse,String> {
    tauri::async_runtime::spawn_blocking(move || {
        match crate::engine_client::authenticated_request(|token| EngineRequest::MobileSettings{token,config})? {
            EngineResponse::Error{message,..} => Err(message),
            response @ EngineResponse::MobileSettings{..} => Ok(response),
            _ => Err("Engine incompatível; reinicie após atualizar".into()),
        }
    }).await.map_err(|e|e.to_string())?
}
