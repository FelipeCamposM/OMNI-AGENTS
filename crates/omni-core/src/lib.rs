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
