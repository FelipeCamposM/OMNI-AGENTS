//! IA dos estudos no app: acha a CLI e a conta e roda pelo núcleo em `omni_core::roadmaps_ia`
//! (o mesmo que o engine usa para o celular).

use omni_core::roadmaps_ia as nucleo;
use std::path::PathBuf;

pub use nucleo::PedidoDeIa;

fn executavel(cli: &str) -> Option<PathBuf> {
    match cli {
        "claude" => crate::agentes::executavel_do_claude(),
        "codex" => {
            omni_core::cli_path::ampliar_path();
            ["codex.exe", "codex.cmd", "codex"].into_iter().find_map(crate::engine_client::resolve_on_path)
        }
        _ => None,
    }
}

pub fn perguntar(pedido: &PedidoDeIa) -> Result<String, String> {
    if pedido.chave.trim().is_empty() || pedido.chave.len() > 120 { return Err("Pedido inválido".into()); }
    let (args, entrada) = nucleo::argumentos(&pedido.cli, pedido.modelo.as_deref(), pedido.web, &pedido.sistema, &pedido.texto)?;
    let nome = if pedido.cli == "claude" { "Claude Code" } else { "Codex" };
    let exe = executavel(&pedido.cli).ok_or_else(|| format!("O {nome} não foi encontrado neste PC"))?;
    let perfis = crate::profiles::list_profiles();
    let perfil = nucleo::perfil_do_pedido(&perfis, &pedido.cli, pedido.conta.as_deref())
        .ok_or_else(|| format!("Nenhuma conta do {nome} com login"))?;
    nucleo::rodar(&pedido.chave, &exe, &args, &entrada, &omni_core::env_for(perfil), &nucleo::pasta_temporaria()?, nucleo::LIMITE)
        .and_then(|saida| nucleo::resposta_da_saida(&pedido.cli, &saida))
}

#[tauri::command(async)]
pub fn roadmaps_ia(pedido: PedidoDeIa) -> Result<String, String> { perguntar(&pedido) }

#[tauri::command(async)]
pub fn roadmaps_ia_cancelar(chave: String) { nucleo::cancelar(&chave); }
