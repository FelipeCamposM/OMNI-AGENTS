//! Contas por provider, isoladas por diretório de configuração (spec §9.3).
//!
//! O OMNI **nunca** guarda credencial: só nome, provider, caminho do config dir e datas (§9.4). A
//! autenticação continua sendo do CLI, que grava dentro do config dir apontado pela env var.

use omni_protocol::{atomic_write_json, read_json_or_default};
use serde::{Deserialize, Serialize};
use std::{
    env, fs,
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};

/// Env var que cada CLI lê para trocar de diretório de configuração. `None` = o provider não
/// suporta isolamento, então só existe o profile padrão dele.
pub fn config_dir_var(provider: &str) -> Option<&'static str> {
    match provider {
        "claude" => Some("CLAUDE_CONFIG_DIR"),
        "codex" => Some("CODEX_HOME"),
        _ => None,
    }
}

/// Arquivo que o CLI grava no config dir depois do login, e a env var de API key que dispensa
/// login interativo.
fn credential_rule(provider: &str) -> Option<(&'static str, &'static str)> {
    match provider {
        "claude" => Some((".credentials.json", "ANTHROPIC_API_KEY")),
        "codex" => Some(("auth.json", "OPENAI_API_KEY")),
        "gemini" => Some(("oauth_creds.json", "GEMINI_API_KEY")),
        "cursor" => Some(("cli-config.json", "")),
        _ => None,
    }
}

/// Diretório de configuração nativo do CLI, respeitando a env var de override quando ela já vier
/// setada no ambiente do usuário.
pub fn native_config_dir(provider: &str) -> Option<PathBuf> {
    let home = env::var_os("USERPROFILE").or_else(|| env::var_os("HOME")).map(PathBuf::from)?;
    let default = match provider {
        "claude" => home.join(".claude"),
        "codex" => home.join(".codex"),
        "gemini" => home.join(".gemini"),
        "cursor" => home.join(".cursor"),
        _ => return None,
    };
    Some(config_dir_var(provider).and_then(env::var_os).map_or(default, PathBuf::from))
}

/// ponytail: presença de arquivo, não validade do token — não checa expiração nem qual conta é, e
/// não cobre credencial guardada no keychain do SO. Caminho de upgrade: rodar `claude auth status`
/// / `codex doctor` em background se a presença de arquivo se mostrar imprecisa na prática.
pub fn credential_present(provider: &str, config_dir: &Path) -> bool {
    let Some((credential_file, api_key_var)) = credential_rule(provider) else { return false };
    config_dir.join(credential_file).is_file()
        || (!api_key_var.is_empty()
            && env::var_os(api_key_var).is_some_and(|value| !value.is_empty()))
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Profile {
    pub id: String,
    pub provider: String,
    pub name: String,
    pub config_dir: String,
    /// Aponta para o diretório nativo do CLI. Nasce sozinho e não pode ser removido — é o que faz
    /// os logins que já existiam continuarem funcionando.
    #[serde(default)]
    pub builtin: bool,
    pub created_at_ms: u64,
    #[serde(default)]
    pub last_used_at_ms: Option<u64>,
    /// Derivado do disco a cada consulta, nunca persistido.
    #[serde(skip)]
    pub authenticated: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProfileStore {
    pub version: u16,
    pub profiles: Vec<Profile>,
}

impl Default for ProfileStore {
    fn default() -> Self {
        Self { version: 1, profiles: Vec::new() }
    }
}

fn store_path() -> Result<PathBuf, String> {
    crate::engine_client::engine_dir().map(|dir| dir.join("profiles.json"))
}

/// Raiz dos config dirs criados pelo OMNI, conforme spec §9.3.
fn profiles_root() -> Result<PathBuf, String> {
    env::var_os("APPDATA")
        .map(PathBuf::from)
        .ok_or_else(|| "APPDATA indisponível".to_string())
        .map(|base| base.join("OMNI-AGENTS").join("profiles"))
}

fn now_ms() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_millis() as u64
}

/// Id estável a partir do nome, com sufixo numérico em caso de colisão.
fn slugify(name: &str, taken: &[String]) -> String {
    let collapsed: String = name
        .trim()
        .to_lowercase()
        .chars()
        .map(|character| if character.is_ascii_alphanumeric() { character } else { '-' })
        .collect();
    let base = collapsed.split('-').filter(|part| !part.is_empty()).collect::<Vec<_>>().join("-");
    let base = if base.is_empty() { "perfil".to_owned() } else { base };
    if !taken.contains(&base) {
        return base;
    }
    (2..)
        .map(|suffix| format!("{base}-{suffix}"))
        .find(|id| !taken.contains(id))
        .unwrap_or(base)
}

fn load() -> ProfileStore {
    store_path().map(|path| read_json_or_default(&path)).unwrap_or_default()
}

fn save(store: &ProfileStore) -> Result<(), String> {
    atomic_write_json(&store_path()?, store).map_err(|error| error.to_string())
}

/// Garante um profile `default` por provider suportado, apontando para o diretório nativo do CLI.
fn with_defaults(mut store: ProfileStore) -> ProfileStore {
    for provider in ["claude", "codex", "gemini", "cursor"] {
        if store.profiles.iter().any(|profile| profile.provider == provider && profile.builtin) {
            continue;
        }
        let Some(config_dir) = native_config_dir(provider) else { continue };
        store.profiles.push(Profile {
            id: format!("{provider}-padrao"),
            provider: provider.to_owned(),
            name: "Padrão".into(),
            config_dir: config_dir.to_string_lossy().into_owned(),
            builtin: true,
            created_at_ms: now_ms(),
            last_used_at_ms: None,
            authenticated: false,
        });
    }
    store
}

fn hydrate(mut store: ProfileStore) -> ProfileStore {
    for profile in &mut store.profiles {
        profile.authenticated =
            credential_present(&profile.provider, Path::new(&profile.config_dir));
    }
    store
}

#[tauri::command]
pub fn list_profiles() -> Vec<Profile> {
    let store = with_defaults(load());
    // Os builtin recém-criados precisam sobreviver ao próximo boot, senão o `last_used_at`
    // gravado depois cairia num arquivo sem eles.
    let _ = save(&store);
    hydrate(store).profiles
}

pub fn find(profile_id: &str) -> Option<Profile> {
    list_profiles().into_iter().find(|profile| profile.id == profile_id)
}

/// Profile a usar quando a UI não escolheu nenhum: o primeiro autenticado do provider, senão o
/// padrão. Evita abrir um agente numa conta sem login só porque ela veio primeiro na lista.
pub fn preferred(provider: &str) -> Option<Profile> {
    let candidates: Vec<Profile> =
        list_profiles().into_iter().filter(|profile| profile.provider == provider).collect();
    candidates
        .iter()
        .find(|profile| profile.authenticated)
        .or_else(|| candidates.iter().find(|profile| profile.builtin))
        .or_else(|| candidates.first())
        .cloned()
}

/// Env vars que isolam a conta. Vazio quando o provider não suporta isolamento ou o profile é o
/// padrão — nesse caso o CLI já usa o diretório nativo sozinho.
pub fn env_for(profile: &Profile) -> Vec<(String, String)> {
    match config_dir_var(&profile.provider) {
        Some(variable) if !profile.builtin => {
            vec![(variable.to_owned(), profile.config_dir.clone())]
        }
        _ => Vec::new(),
    }
}

#[tauri::command]
pub fn create_profile(provider: String, name: String) -> Result<Profile, String> {
    if config_dir_var(&provider).is_none() {
        return Err(format!(
            "O CLI do {provider} não suporta diretório de configuração alternativo — só o perfil padrão."
        ));
    }
    let mut store = with_defaults(load());
    let taken: Vec<String> = store.profiles.iter().map(|profile| profile.id.clone()).collect();
    let id = slugify(&name, &taken);
    let config_dir = profiles_root()?.join(&provider).join(&id);
    fs::create_dir_all(&config_dir).map_err(|error| error.to_string())?;

    let profile = Profile {
        id,
        provider,
        name: name.trim().to_owned(),
        config_dir: config_dir.to_string_lossy().into_owned(),
        builtin: false,
        created_at_ms: now_ms(),
        last_used_at_ms: None,
        authenticated: false,
    };
    store.profiles.push(profile.clone());
    save(&store)?;
    Ok(profile)
}

#[tauri::command]
pub fn rename_profile(profile_id: String, name: String) -> Result<(), String> {
    let mut store = with_defaults(load());
    let profile = store
        .profiles
        .iter_mut()
        .find(|profile| profile.id == profile_id)
        .ok_or("Perfil não encontrado")?;
    profile.name = name.trim().to_owned();
    save(&store)
}

/// Remove o registro **e** o config dir — é lá que mora a credencial daquela conta, e deixá-la
/// para trás num diretório órfão seria pior do que apagar.
#[tauri::command]
pub fn delete_profile(profile_id: String) -> Result<(), String> {
    let mut store = with_defaults(load());
    let profile = store
        .profiles
        .iter()
        .find(|profile| profile.id == profile_id)
        .ok_or("Perfil não encontrado")?
        .clone();
    if profile.builtin {
        return Err("O perfil padrão não pode ser removido".into());
    }
    // Só apaga o que o próprio OMNI criou; um config_dir apontado para fora fica intacto.
    if profiles_root().is_ok_and(|root| Path::new(&profile.config_dir).starts_with(root)) {
        let _ = fs::remove_dir_all(&profile.config_dir);
    }
    store.profiles.retain(|item| item.id != profile_id);
    save(&store)
}

pub fn touch(profile_id: &str) {
    let mut store = with_defaults(load());
    if let Some(profile) = store.profiles.iter_mut().find(|profile| profile.id == profile_id) {
        profile.last_used_at_ms = Some(now_ms());
        let _ = save(&store);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn slugify_is_stable_and_avoids_collisions() {
        assert_eq!(slugify("Trabalho", &[]), "trabalho");
        assert_eq!(slugify("Cliente X", &[]), "cliente-x");
        assert_eq!(slugify("  ", &[]), "perfil");
        assert_eq!(slugify("Trabalho", &["trabalho".into()]), "trabalho-2");
        assert_eq!(slugify("Trabalho", &["trabalho".into(), "trabalho-2".into()]), "trabalho-3");
    }

    #[test]
    fn builtin_profiles_carry_no_env_override() {
        // O profile padrão tem que deixar o CLI usar o diretório nativo dele: setar
        // CLAUDE_CONFIG_DIR para o mesmo caminho é redundante e mascara um override do usuário.
        let builtin = Profile {
            id: "claude-padrao".into(),
            provider: "claude".into(),
            name: "Padrão".into(),
            config_dir: "C:/Users/dev/.claude".into(),
            builtin: true,
            created_at_ms: 0,
            last_used_at_ms: None,
            authenticated: false,
        };
        assert!(env_for(&builtin).is_empty());

        let named = Profile { id: "trabalho".into(), builtin: false, ..builtin };
        assert_eq!(
            env_for(&named),
            vec![("CLAUDE_CONFIG_DIR".to_owned(), "C:/Users/dev/.claude".to_owned())]
        );
    }

    #[test]
    fn providers_without_isolation_reject_extra_profiles() {
        assert!(config_dir_var("gemini").is_none());
        assert!(create_profile("gemini".into(), "Trabalho".into()).is_err());
    }
}
