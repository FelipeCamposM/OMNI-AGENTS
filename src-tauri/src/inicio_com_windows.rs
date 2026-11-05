//! "Iniciar com o Windows": sobe só o engine no login, para o celular e os fluxos funcionarem sem abrir
//! o app. Desligado por padrão. O valor no `Run` chama o próprio app com `--so-engine`: o engine é
//! binário de console, e direto no `Run` abriria uma janela preta.

use std::process::Command;

const CHAVE: &str = r"HKCU\Software\Microsoft\Windows\CurrentVersion\Run";
const NOME: &str = "OMNI AGENTS Engine";
pub const FLAG: &str = "--so-engine";

fn reg(args: &[&str]) -> std::io::Result<std::process::Output> {
    crate::git_client::hidden(&mut Command::new("reg")).args(args).output()
}

/// `None` fora do Windows: a tela esconde a opção.
#[tauri::command(async)]
pub fn inicio_com_windows() -> Option<bool> {
    if !cfg!(windows) { return None; }
    Some(reg(&["query", CHAVE, "/v", NOME]).is_ok_and(|saida| saida.status.success()))
}

#[tauri::command(async)]
pub fn definir_inicio_com_windows(ligar: bool) -> Result<(), String> {
    if !cfg!(windows) { return Err("Só no Windows".into()); }
    let saida = if ligar {
        let app = std::env::current_exe().map_err(|erro| erro.to_string())?;
        reg(&["add", CHAVE, "/v", NOME, "/t", "REG_SZ", "/d", &format!("\"{}\" {FLAG}", app.display()), "/f"])
    } else {
        reg(&["delete", CHAVE, "/v", NOME, "/f"])
    }.map_err(|erro| erro.to_string())?;
    if saida.status.success() || !ligar { Ok(()) } else { Err(String::from_utf8_lossy(&saida.stderr).trim().to_owned()) }
}
