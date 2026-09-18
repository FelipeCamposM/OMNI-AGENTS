//! Lista de arquivos de um projeto remoto, indexada **na máquina onde o código está**.
//!
//! Varrer `\\wsl.localhost` pelo Windows custa caro: medido nesta máquina, enumerar 3000 arquivos
//! leva 3,7s pela rede contra 0,16s dentro da distro. Rodando `rg --files` do lado de lá, só a
//! lista de nomes atravessa — é a mesma ideia de mandar a busca para o alvo em vez de arrastar o
//! repositório inteiro para cá.

use omni_core::targets::{command_for, resolve};
use std::process::Command;

/// Caminhos absolutos **do lado do Windows** (é isso que a UI e o editor usam), ou `None` quando o
/// projeto é local — aí quem lista é o caminho normal do front, que já funciona bem.
#[tauri::command]
pub fn target_project_files(project_path: String, limit: usize) -> Result<Option<Vec<String>>, String> {
    let conexoes = crate::ssh::connections();
    let alvo = resolve(&project_path, &conexoes);
    let Some(remoto) = alvo.remote_path() else {
        return Ok(None);
    };
    // `rg` respeita .gitignore e é o que o agente usa; `find` cobre a máquina que não tem rg.
    let comando = String::from(
        "command -v rg >/dev/null 2>&1 && rg --files --hidden --glob '!.git' || \
         find . -type f -not -path '*/.git/*' | sed 's|^\\./||'"
    );
    let (programa, args) =
        command_for(&alvo, remoto, &comando, &conexoes).ok_or("alvo sem forma de executar comando")?;
    let saida = crate::git_client::hidden(&mut Command::new(programa))
        .args(&args)
        .output()
        .map_err(|erro| format!("falha ao indexar no alvo: {erro}"))?;
    if !saida.status.success() {
        let stderr = String::from_utf8_lossy(&saida.stderr).trim().to_string();
        return Err(if stderr.is_empty() { "indexação falhou no alvo".into() } else { stderr });
    }
    let raiz = project_path.trim_end_matches(['\\', '/']).to_string();
    // O caminho local é sempre Windows (UNC no WSL, letra de unidade no SSH).
    let separador = "\\";
    Ok(Some(
        String::from_utf8_lossy(&saida.stdout)
            .lines()
            .map(str::trim)
            .filter(|linha| !linha.is_empty())
            .take(limit)
            .map(|relativo| format!("{raiz}{separador}{}", relativo.replace('/', separador)))
            .collect(),
    ))
}
