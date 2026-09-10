use omni_core::usage::AccountUsage;
use omni_protocol::{EngineRequest, EngineResponse};
use std::{collections::HashMap, path::Path, sync::{Mutex, OnceLock}, time::{SystemTime, UNIX_EPOCH}};

static CACHE: OnceLock<Mutex<HashMap<String, (u64, AccountUsage)>>> = OnceLock::new();

#[tauri::command]
pub async fn account_usage(profile_id: String, refresh: bool) -> Result<AccountUsage, String> {
    tauri::async_runtime::spawn_blocking(move || read_usage(profile_id, refresh)).await.map_err(|e|e.to_string())?
}

fn read_usage(profile_id: String, refresh: bool) -> Result<AccountUsage, String> {
    let profile = omni_core::profiles(&crate::engine_client::engine_dir()?).into_iter()
        .find(|profile|profile.id == profile_id).ok_or("Perfil não encontrado")?;
    let now = SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_millis() as u64;
    if profile.provider == "claude" {
        return match crate::engine_client::authenticated_request(|token| EngineRequest::AccountUsage { token, profile_id: profile_id.clone(), refresh })? {
            EngineResponse::AccountUsage { usage } => Ok(usage),
            EngineResponse::Error { message, .. } => Err(message),
            _ => Err("Resposta de uso incompatível; atualize o engine".into()),
        };
    }
    if profile.provider != "codex" { return Ok(AccountUsage::unavailable(&profile_id,&profile.provider,"Provider sem consulta de uso")); }
    let cache = CACHE.get_or_init(Default::default);
    let key = format!("{}:{}",profile_id,profile.config_dir);
    if let Some((at,usage)) = cache.lock().map_err(|_| "Cache indisponível")?.get(&key) {
        if now.saturating_sub(*at) < 60_000 { return Ok(usage.clone()); }
    }
    let usage = omni_core::usage::read_codex(&profile_id,Path::new(&profile.config_dir),now);
    cache.lock().map_err(|_| "Cache indisponível")?.insert(key,(now,usage.clone()));
    Ok(usage)
}
