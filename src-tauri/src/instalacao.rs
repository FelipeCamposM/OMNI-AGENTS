//! Instalar as CLIs de agente (e achar o Tailscale) sem sair do OMNI.
//!
//! A tabela de comandos mora **aqui**, não no front: a tela manda só o id, então nada que venha da
//! interface vira linha de comando. Os comandos são os oficiais de cada projeto — trocar de fonte
//! é editar esta tabela.

use serde::Serialize;

/// O que a tela precisa mostrar sobre instalar uma ferramenta.
#[derive(Serialize)]
pub struct Instalacao {
    /// Linha que o usuário pode copiar e rodar no terminal. Vazia quando o instalador é gráfico.
    pub comando: String,
    /// Página oficial, para quem prefere ler antes ou instalar de outro jeito.
    pub docs: &'static str,
    /// O OMNI consegue abrir um terminal e rodar o comando.
    pub automatico: bool,
}

/// Comando oficial por ferramenta e sistema. `None` = instalador gráfico (Tailscale).
fn comando(id: &str) -> Option<&'static str> {
    let windows = cfg!(windows);
    Some(match (id, windows) {
        // https://code.claude.com/docs/en/setup
        ("claude", true) => "irm https://claude.ai/install.ps1 | iex",
        ("claude", false) => "curl -fsSL https://claude.ai/install.sh | bash",
        // https://learn.chatgpt.com/docs/codex/cli
        ("codex", true) => "irm https://chatgpt.com/codex/install.ps1 | iex",
        ("codex", false) => "curl -fsSL https://chatgpt.com/codex/install.sh | sh",
        // https://cursor.com/docs/cli/installation
        ("cursor", true) => "irm 'https://cursor.com/install?win32=true' | iex",
        ("cursor", false) => "curl https://cursor.com/install -fsS | bash",
        _ => return None,
    })
}

fn docs(id: &str) -> Option<&'static str> {
    Some(match id {
        "claude" => "https://code.claude.com/docs/en/setup",
        "codex" => "https://learn.chatgpt.com/docs/codex/cli",
        "cursor" => "https://cursor.com/docs/cli/installation",
        "tailscale" => "https://tailscale.com/download",
        _ => return None,
    })
}

/// Como instalar uma ferramenta neste sistema. `None` para id desconhecido.
#[tauri::command(async)]
pub fn install_hint(id: String) -> Option<Instalacao> {
    let comando = comando(&id);
    docs(&id).map(|docs| Instalacao {
        comando: comando.unwrap_or_default().to_owned(),
        docs,
        automatico: comando.is_some(),
    })
}

/// Abre um terminal **visível** rodando o instalador oficial.
///
/// Visível de propósito: instalar mexe na máquina do usuário, e ele acompanha a saída, responde ao
/// que o instalador perguntar e vê o erro se houver. Nada roda escondido.
#[tauri::command(async)]
pub fn install_agent_cli(id: String) -> Result<(), String> {
    let comando = comando(&id).ok_or("Esta ferramenta não tem instalador automático; abra a página oficial")?;
    abrir_console(comando)
}

#[cfg(windows)]
fn abrir_console(script: &str) -> Result<(), String> {
    // `-NoExit`: a janela fica aberta com o resultado, como no login dos providers.
    std::process::Command::new("powershell.exe")
        .args(["-NoLogo", "-NoExit", "-ExecutionPolicy", "Bypass", "-Command", script])
        .spawn().map(|_| ()).map_err(|erro| erro.to_string())
}

#[cfg(target_os = "macos")]
fn abrir_console(script: &str) -> Result<(), String> {
    let script = script.replace('\\', r"\\").replace('"', r#"\""#);
    std::process::Command::new("osascript")
        .args(["-e", &format!("tell application \"Terminal\" to do script \"{script}\""),
               "-e", "tell application \"Terminal\" to activate"])
        .spawn().map(|_| ()).map_err(|erro| erro.to_string())
}

#[cfg(all(unix, not(target_os = "macos")))]
fn abrir_console(script: &str) -> Result<(), String> {
    // Mesma lista do console de login: não existe terminal padrão no Linux.
    let terminais: [(&str, &[&str]); 5] = [
        ("x-terminal-emulator", &["-e"]), ("gnome-terminal", &["--"]), ("konsole", &["-e"]),
        ("xfce4-terminal", &["-x"]), ("xterm", &["-e"]),
    ];
    let (terminal, flags) = terminais.into_iter()
        .find(|(nome, _)| crate::engine_client::resolve_on_path(nome).is_some())
        .ok_or("Nenhum terminal encontrado para abrir o instalador")?;
    // `read` no fim: sem isso a janela fecha antes de dar para ler o resultado.
    let script = format!("{script}; echo; echo 'Pressione Enter para fechar'; read _");
    std::process::Command::new(terminal).args(flags).args(["sh", "-c", &script])
        .spawn().map(|_| ()).map_err(|erro| erro.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cada_cli_tem_comando_e_pagina_oficial() {
        for id in ["claude", "codex", "cursor"] {
            let hint = install_hint(id.into()).expect(id);
            assert!(hint.automatico, "{id} deveria ter instalador automático");
            assert!(hint.comando.starts_with(if cfg!(windows) { "irm" } else { "curl" }), "{id}: {}", hint.comando);
            assert!(hint.docs.starts_with("https://"), "{id}");
        }
    }

    #[test]
    fn tailscale_so_abre_a_pagina_e_id_desconhecido_nao_existe() {
        let tailscale = install_hint("tailscale".into()).expect("tailscale");
        assert!(!tailscale.automatico, "o Tailscale tem instalador gráfico");
        assert!(tailscale.comando.is_empty());
        assert!(install_hint("rm -rf /".into()).is_none(), "id desconhecido não vira comando");
        assert!(install_agent_cli("tailscale".into()).is_err());
    }
}
