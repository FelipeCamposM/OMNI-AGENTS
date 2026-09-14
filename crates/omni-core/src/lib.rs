//! Read-only provider data. Never reads authentication files or calls provider APIs.
pub mod usage;
pub mod conversations;

use serde::{Deserialize, Serialize};
use std::{fs, path::{Path, PathBuf}};

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Profile {
    pub id: String,
    pub provider: String,
    pub name: String,
    pub config_dir: String,
    #[serde(default)] pub builtin: bool,
    pub created_at_ms: u64,
    #[serde(default)] pub last_used_at_ms: Option<u64>,
    #[serde(skip)] pub authenticated: bool,
}

/// Env var que cada CLI lê para trocar de diretório de configuração. `None` = o provider não
/// suporta isolamento, então só existe o perfil padrão dele.
///
/// Mora aqui, e não só no lado Tauri, porque o engine também precisa montar o ambiente: uma sessão
/// aberta pelo celular nasce dentro do engine, com a janela do desktop possivelmente fechada.
pub fn config_dir_var(provider: &str) -> Option<&'static str> {
    match provider {
        "claude" => Some("CLAUDE_CONFIG_DIR"),
        "codex" => Some("CODEX_HOME"),
        _ => None,
    }
}

/// Variáveis que isolam a conta. Perfil `builtin` não sobrescreve nada: ele **é** o diretório
/// nativo do CLI, e apontar a env var para ele mudaria o comportamento padrão sem necessidade.
pub fn env_for(profile: &Profile) -> Vec<(String, String)> {
    match config_dir_var(&profile.provider) {
        Some(variable) if !profile.builtin => vec![(variable.to_owned(), profile.config_dir.clone())],
        _ => Vec::new(),
    }
}

pub fn profiles(dir: &Path) -> Vec<Profile> {
    #[derive(Deserialize)] struct Store { profiles: Vec<Profile> }
    fs::read(dir.join("profiles.json")).ok()
        .and_then(|bytes| serde_json::from_slice::<Store>(&bytes).ok())
        .map(|store| store.profiles).unwrap_or_default()
}

/// Only visit ordinary directories/files, never follow profile symlinks into other accounts.
pub fn rollouts(root: &Path) -> Vec<PathBuf> {
    fn visit(dir: &Path, depth: usize, found: &mut Vec<PathBuf>) {
        if depth > 4 { return; }
        let Ok(entries) = fs::read_dir(dir) else { return };
        for entry in entries.flatten() {
            let Ok(kind) = entry.file_type() else { continue };
            if kind.is_dir() { visit(&entry.path(), depth + 1, found); }
            else if kind.is_file() && entry.file_name().to_string_lossy().starts_with("rollout-")
                && entry.path().extension().is_some_and(|ext| ext == "jsonl") { found.push(entry.path()); }
        }
    }
    let mut found = Vec::new();
    visit(root, 0, &mut found);
    found
}
