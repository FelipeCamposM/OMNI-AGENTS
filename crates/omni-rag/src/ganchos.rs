//! Ganchos da CLI do Claude. O OMNI liga isto só nas próprias sessões (`--settings`), então o Claude
//! usado fora dele não muda. Falhar aqui nunca pode atrapalhar a conversa: sem resposta, segue a vida.
use crate::{memoria::{self, Nota}, Base};
use serde_json::{json, Value};
use std::{
    io::Write,
    path::Path,
    process::{Command, Stdio},
};

/// Marca o processo da passada: o Claude que ela abre não pode disparar outra passada.
pub const MARCA_DA_PASSADA: &str = "OMNI_MEMORIA_PASSADA";
const INDICE_NA_PASSADA: usize = 60;
const ARQUIVO_DESLIGADA: &str = "memoria.desligada";

/// O MCP do OMNI nas sessões do Claude abertas pelo OMNI (`--mcp-config`). Ligado por padrão.
const ARQUIVO_MCP_DESLIGADO: &str = "mcp.desligado";

pub fn memoria_ligada(base_db: &Path) -> bool {
    !base_db.with_file_name(ARQUIVO_DESLIGADA).exists()
}

pub fn ligar_memoria(base_db: &Path, ligada: bool) -> Result<(), String> {
    marcar(base_db, ARQUIVO_DESLIGADA, ligada)
}

pub fn mcp_ligado(base_db: &Path) -> bool {
    !base_db.with_file_name(ARQUIVO_MCP_DESLIGADO).exists()
}

pub fn ligar_mcp(base_db: &Path, ligado: bool) -> Result<(), String> {
    marcar(base_db, ARQUIVO_MCP_DESLIGADO, ligado)
}

/// Desligado = arquivo-marca ao lado do banco; ligado = sem ele.
fn marcar(base_db: &Path, arquivo: &str, ligada: bool) -> Result<(), String> {
    let marca = base_db.with_file_name(arquivo);
    if ligada {
        if marca.exists() { std::fs::remove_file(marca).map_err(|erro| erro.to_string())?; }
        return Ok(());
    }
    if let Some(pasta) = marca.parent() { std::fs::create_dir_all(pasta).map_err(|erro| erro.to_string())?; }
    std::fs::write(marca, "").map_err(|erro| erro.to_string())
}

fn contexto(evento: &str, texto: String) -> Option<String> {
    (!texto.is_empty()).then(|| json!({"hookSpecificOutput": {"hookEventName": evento, "additionalContext": texto}}).to_string())
}

/// O que o gancho imprime para a CLI. `None` quando não há nada a acrescentar.
pub fn responder(base: &Base, evento: &str, entrada: &Value) -> Option<String> {
    let projeto = memoria::projeto_da_pasta(entrada["cwd"].as_str().unwrap_or_default());
    match evento {
        "prompt" => contexto("UserPromptSubmit", memoria::contexto_do_pedido(base, entrada["prompt"].as_str().unwrap_or_default(), &projeto)),
        "inicio" => contexto("SessionStart", memoria::contexto_de_inicio(base, &projeto)),
        "compactou" => {
            let resumo = entrada["compact_summary"].as_str().unwrap_or_default().trim();
            if resumo.is_empty() { return None; }
            let sessao = entrada["session_id"].as_str().unwrap_or_default();
            let slug = format!("resumo-{sessao}");
            if !base.acrescentar_nota(&slug, resumo).unwrap_or(false) {
                let nota = Nota { slug, titulo: format!("Resumo da conversa em {projeto}"), corpo: resumo.to_owned(), projeto, origem: "compact".into(), conversa: sessao.to_owned(), ..Nota::default() };
                let _ = base.gravar_nota(&nota);
            }
            None
        }
        _ => None,
    }
}

/// Fim do turno: sai na hora e deixa a passada rodando sozinha, sem segurar a CLI.
pub fn disparar_passada(entrada: &Value) {
    if entrada["stop_hook_active"] == true { return; }
    let (Some(transcript), Ok(executavel)) = (entrada["transcript_path"].as_str(), std::env::current_exe()) else { return };
    let _ = Command::new(executavel).arg("passada").arg(transcript)
        .arg(entrada["cwd"].as_str().unwrap_or_default()).arg(entrada["session_id"].as_str().unwrap_or_default())
        .env(MARCA_DA_PASSADA, "1")
        .stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null()).spawn();
}

/// Um modelo rápido, sem ferramentas e sem sessão gravada, lê o turno e devolve as notas em JSON.
fn perguntar_ao_modelo(prompt: &str) -> Option<String> {
    let mut processo = Command::new("claude")
        .args(["-p", "--model", "haiku", "--no-session-persistence", "--tools", "", "--setting-sources", "", "--strict-mcp-config", "--system-prompt", memoria::SISTEMA_DA_PASSADA])
        .env(MARCA_DA_PASSADA, "1").current_dir(std::env::temp_dir())
        .stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::null()).spawn().ok()?;
    processo.stdin.take()?.write_all(prompt.as_bytes()).ok()?;
    let saida = processo.wait_with_output().ok()?;
    saida.status.success().then(|| String::from_utf8_lossy(&saida.stdout).into_owned())
}

pub fn passada(base: &Base, transcript: &Path, cwd: &str, sessao: &str) -> usize {
    let Ok(bruto) = std::fs::read(transcript) else { return 0 };
    let Some(turno) = memoria::ultimo_turno(&String::from_utf8_lossy(&bruto)) else { return 0 };
    let projeto = memoria::projeto_da_pasta(cwd);
    let prompt = memoria::prompt_da_passada(&turno, &projeto, &base.indice_de_notas(&projeto, INDICE_NA_PASSADA));
    perguntar_ao_modelo(&prompt).map_or(0, |resposta| base.aplicar_passada(&resposta, &projeto, sessao))
}
