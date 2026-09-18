//! Conexões SSH cadastradas pelo usuário, e a montagem SSHFS que dá ao Claude local um caminho de
//! disco para o código remoto.
//!
//! Igual aos profiles: o app **não** guarda senha nem passphrase (spec §9.4). Autenticação é por
//! chave ou pelo agente de chaves do sistema; `BatchMode=yes` garante que um pedido de senha falhe
//! na hora em vez de pendurar um processo sem console.

use omni_protocol::{atomic_write_json, read_json_or_default};
use omni_core::targets::SshConnection;
use serde::{Deserialize, Serialize};
use std::{path::PathBuf, process::Command};

#[derive(Default, Serialize, Deserialize)]
struct Store {
    #[serde(default)]
    connections: Vec<SshConnection>,
}

fn store_path() -> Result<PathBuf, String> {
    crate::engine_client::engine_dir().map(|dir| dir.join("ssh.json"))
}

fn load() -> Store {
    store_path().map(|path| read_json_or_default(&path)).unwrap_or_default()
}

fn save(store: &Store) -> Result<(), String> {
    atomic_write_json(&store_path()?, store).map_err(|error| error.to_string())
}

/// Lista usada por todo mundo que precisa resolver um alvo (git, engine, shim).
pub fn connections() -> Vec<SshConnection> {
    load().connections
}

#[tauri::command]
pub fn ssh_connections() -> Vec<SshConnection> {
    connections()
}

/// Cadastra ou atualiza. `id` vazio nasce com um id novo — o front não precisa inventar um.
#[tauri::command]
pub fn save_ssh_connection(mut connection: SshConnection) -> Result<SshConnection, String> {
    if connection.host.trim().is_empty() || connection.user.trim().is_empty() {
        return Err("Host e usuário são obrigatórios.".into());
    }
    if connection.remote_path.trim().is_empty() {
        return Err("Informe a pasta do projeto na máquina remota.".into());
    }
    if connection.id.trim().is_empty() {
        connection.id = format!("ssh-{}", uuid::Uuid::new_v4());
    }
    if connection.name.trim().is_empty() {
        connection.name = connection.host.clone();
    }
    connection.drive = normalize_drive(&connection.drive);

    let mut store = load();
    // Duas conexões na mesma letra montariam uma por cima da outra e o alvo viraria loteria.
    if let Some(outra) = store
        .connections
        .iter()
        .find(|item| item.id != connection.id && item.drive.eq_ignore_ascii_case(&connection.drive))
    {
        return Err(format!("A unidade {} já é usada pela conexão “{}”.", connection.drive, outra.name));
    }
    match store.connections.iter_mut().find(|item| item.id == connection.id) {
        Some(existente) => *existente = connection.clone(),
        None => store.connections.push(connection.clone()),
    }
    save(&store)?;
    Ok(connection)
}

#[tauri::command]
pub fn remove_ssh_connection(id: String) -> Result<(), String> {
    let mut store = load();
    store.connections.retain(|item| item.id != id);
    save(&store)
}

pub fn find(id: &str) -> Option<SshConnection> {
    connections().into_iter().find(|item| item.id == id)
}

/// `x` / `X:\` / `X:` → `X:`. Guardar sempre na mesma forma é o que faz `resolve()` casar caminho.
fn normalize_drive(value: &str) -> String {
    let letra = value.chars().find(|c| c.is_ascii_alphabetic()).unwrap_or('X');
    format!("{}:", letra.to_ascii_uppercase())
}

/// Abre uma conexão de verdade e volta o que a máquina respondeu. É o botão "Testar conexão": sem
/// ele, o primeiro sinal de chave errada seria um terminal que não abre.
#[tauri::command]
pub fn test_ssh_connection(connection: SshConnection) -> Result<String, String> {
    let mut args = connection.ssh_args();
    args.push("echo omni-ok; uname -a".into());
    let output = crate::git_client::hidden(&mut Command::new("ssh"))
        .args(&args)
        .output()
        .map_err(|error| format!("ssh não encontrado no PATH: {error}"))?;
    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if output.status.success() && stdout.contains("omni-ok") {
        return Ok(stdout.replace("omni-ok", "").trim().to_string());
    }
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    Err(if stderr.is_empty() { format!("ssh falhou ({})", output.status) } else { stderr })
}

/// Estado da montagem de uma conexão.
#[derive(Serialize)]
pub struct MountStatus {
    /// SSHFS-Win encontrado no PC.
    pub sshfs_installed: bool,
    /// A unidade responde agora.
    pub mounted: bool,
    pub drive: String,
    /// Caminho local do projeto (raiz da unidade + subpasta), quando montado.
    pub path: String,
}

#[cfg(windows)]
fn sshfs_binary() -> Option<PathBuf> {
    let mut candidatos: Vec<PathBuf> = Vec::new();
    for variavel in ["ProgramFiles", "ProgramFiles(x86)"] {
        if let Some(raiz) = std::env::var_os(variavel) {
            candidatos.push(PathBuf::from(&raiz).join("SSHFS-Win").join("bin").join("sshfs.exe"));
        }
    }
    candidatos.into_iter().find(|caminho| caminho.is_file())
}

#[cfg(not(windows))]
fn sshfs_binary() -> Option<PathBuf> {
    None
}

fn drive_mounted(drive: &str) -> bool {
    std::path::Path::new(&format!("{drive}\\")).is_dir()
}

#[tauri::command]
pub fn ssh_mount_status(id: String) -> Result<MountStatus, String> {
    let connection = find(&id).ok_or("Conexão SSH não encontrada.")?;
    Ok(MountStatus {
        sshfs_installed: sshfs_binary().is_some(),
        mounted: drive_mounted(&connection.drive),
        drive: connection.drive.clone(),
        path: connection.drive.clone(),
    })
}

/// Monta (se preciso) e devolve o caminho local do projeto. Idempotente: já montado só confirma.
///
/// O SSHFS-Win aceita o mesmo formato de destino do `sshfs` de Linux, com a porta depois de `!`.
#[tauri::command]
pub fn ssh_mount(id: String) -> Result<String, String> {
    let connection = find(&id).ok_or("Conexão SSH não encontrada.")?;
    if drive_mounted(&connection.drive) {
        return Ok(connection.drive.clone());
    }
    let binario = sshfs_binary().ok_or(
        "SSHFS-Win não está instalado. Instale com: winget install -e --id WinFsp.WinFsp; \
         winget install -e --id SSHFS-Win.SSHFS-Win",
    )?;
    let destino = format!(
        "{}@{}!{}:{}",
        connection.user, connection.host, connection.port, connection.remote_path
    );
    let mut comando = Command::new(binario);
    comando.arg(&destino).arg(&connection.drive);
    comando.args(["-o", "idmap=user", "-o", "StrictHostKeyChecking=accept-new"]);
    if !connection.key_path.trim().is_empty() {
        comando.arg("-o").arg(format!("IdentityFile={}", connection.key_path));
    }
    let saida = crate::git_client::hidden(&mut comando)
        .output()
        .map_err(|error| format!("falha ao chamar o sshfs: {error}"))?;
    // O sshfs desacopla e sai na hora; a unidade aparece um instante depois.
    for _ in 0..20 {
        if drive_mounted(&connection.drive) {
            return Ok(connection.drive.clone());
        }
        std::thread::sleep(std::time::Duration::from_millis(150));
    }
    let stderr = String::from_utf8_lossy(&saida.stderr).trim().to_string();
    Err(if stderr.is_empty() {
        format!("A unidade {} não apareceu depois do sshfs.", connection.drive)
    } else {
        stderr
    })
}

#[tauri::command]
pub fn ssh_unmount(id: String) -> Result<(), String> {
    let connection = find(&id).ok_or("Conexão SSH não encontrada.")?;
    if !drive_mounted(&connection.drive) {
        return Ok(());
    }
    let saida = crate::git_client::hidden(&mut Command::new("net"))
        .args(["use", &connection.drive, "/delete", "/y"])
        .output()
        .map_err(|error| error.to_string())?;
    if drive_mounted(&connection.drive) {
        let stderr = String::from_utf8_lossy(&saida.stderr).trim().to_string();
        return Err(if stderr.is_empty() { "A unidade continua montada.".into() } else { stderr });
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normaliza_letra_da_unidade() {
        assert_eq!(normalize_drive("x"), "X:");
        assert_eq!(normalize_drive("Z:\\"), "Z:");
        assert_eq!(normalize_drive(""), "X:");
    }
}
