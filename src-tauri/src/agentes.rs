//! Modelos de agentes (Configurações → Modelos de agentes). A regra mora em `omni_core::agentes`;
//! aqui só a ponte com o front e a criação com IA (o Claude sem tela, na conta escolhida).

use omni_core::agentes::{self, AgenteSalvo, ModeloDeAgente};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

/// Quanto esperar a IA escrever um modelo antes de desistir.
pub(crate) const CRIACAO_MAX: Duration = Duration::from_secs(300);

fn pasta(escopo: &str, projeto: Option<&str>) -> Result<PathBuf, String> {
    match (escopo, projeto) {
        ("global", _) => agentes::pasta_global().ok_or_else(|| "Pasta do usuário indisponível".into()),
        ("projeto", Some(p)) if !p.trim().is_empty() => Ok(agentes::pasta_do_projeto(Path::new(p))),
        ("projeto", _) => Err("Abra um projeto para salvar nele".into()),
        _ => Err("Escopo precisa ser global ou projeto".into()),
    }
}

#[tauri::command(async)]
pub fn agentes_listar(project_path: Option<String>) -> Vec<AgenteSalvo> {
    agentes::listar(agentes::pasta_global().as_deref(), project_path.as_deref().filter(|p| !p.is_empty()).map(Path::new))
}

/// Salva (criando ou atualizando). Renomear num mesmo escopo apaga o arquivo do nome antigo.
#[tauri::command(async)]
pub fn agentes_salvar(escopo: String, project_path: Option<String>, modelo: ModeloDeAgente, nome_anterior: Option<String>) -> Result<String, String> {
    let pasta = pasta(&escopo, project_path.as_deref())?;
    let caminho = agentes::salvar(&pasta, &modelo)?;
    if let Some(antigo) = nome_anterior.filter(|n| n != &modelo.name) { agentes::apagar(&pasta, &antigo)?; }
    Ok(caminho.to_string_lossy().into_owned())
}

#[tauri::command(async)]
pub fn agentes_apagar(escopo: String, project_path: Option<String>, nome: String) -> Result<(), String> {
    agentes::apagar(&pasta(&escopo, project_path.as_deref())?, &nome)
}

#[tauri::command(async)]
pub fn agentes_restaurar_kit() -> Result<(), String> {
    let pasta = agentes::pasta_global().ok_or("Pasta do usuário indisponível")?;
    agentes::restaurar_kit(&pasta).map_err(|e| e.to_string())
}

#[tauri::command(async)]
pub fn agentes_instalar_claude(project_path: String, modelo: ModeloDeAgente) -> Result<String, String> {
    if project_path.trim().is_empty() { return Err("Abra um projeto para instalar".into()); }
    agentes::instalar_no_claude_code(Path::new(&project_path), &modelo).map(|p| p.to_string_lossy().into_owned())
}

/// O executável do Claude que dá para chamar direto (no Windows o `claude` sem extensão é script).
pub(crate) fn executavel_do_claude() -> Option<PathBuf> {
    omni_core::cli_path::ampliar_path();
    ["claude.exe", "claude.cmd", "claude"].into_iter().find_map(crate::engine_client::resolve_on_path)
}

/// Roda o Claude sem tela (`claude -p`) com um prompt de sistema e devolve o texto da resposta. Conta:
/// a pedida, ou a primeira do Claude com login. O pedido vai pela entrada padrão (nada de escapar
/// aspas na linha de comando), roda numa pasta temporária, longe de qualquer projeto, e a saída é
/// lida enquanto o processo roda — uma resposta grande não trava no buffer do pipe.
pub(crate) fn claude_sem_tela(sistema: &str, pedido: &str, modelo: &str, esforco: &str, conta: Option<&str>, limite: Duration) -> Result<String, String> {
    let executavel = executavel_do_claude().ok_or("A criação com IA usa o Claude Code, que não foi encontrado neste PC")?;
    let perfis = crate::profiles::list_profiles();
    let perfil = perfis.iter().filter(|p| p.provider == "claude").find(|p| conta.is_some_and(|c| c == p.id))
        .or_else(|| perfis.iter().find(|p| p.provider == "claude" && p.authenticated))
        .ok_or("Nenhuma conta do Claude com login")?;
    let eh_script = executavel.extension().is_some_and(|e| e.eq_ignore_ascii_case("cmd") || e.eq_ignore_ascii_case("bat"));
    let mut comando = if eh_script { let mut c = Command::new("cmd"); c.arg("/C").arg(&executavel); c } else { Command::new(&executavel) };
    crate::git_client::hidden(&mut comando)
        .args(["-p", "--output-format", "json", "--model", modelo, "--effort", esforco])
        .arg("--append-system-prompt").arg(sistema)
        .envs(omni_core::env_for(perfil))
        .current_dir(std::env::temp_dir())
        .stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::piped());
    let mut filho = comando.spawn().map_err(|e| format!("Não consegui abrir o Claude: {e}"))?;
    filho.stdin.take().ok_or("sem stdin")?.write_all(pedido.as_bytes()).map_err(|e| e.to_string())?;
    let mut stdout = filho.stdout.take().ok_or("sem stdout")?;
    let leitor = std::thread::spawn(move || { let mut s = String::new(); let _ = stdout.read_to_string(&mut s); s });

    let inicio = Instant::now();
    let status = loop {
        if let Some(status) = filho.try_wait().map_err(|e| e.to_string())? { break status; }
        if inicio.elapsed() > limite { let _ = filho.kill(); return Err("A IA demorou demais para responder; tente de novo".into()); }
        std::thread::sleep(Duration::from_millis(200));
    };
    let saida = leitor.join().unwrap_or_default();
    let resultado = serde_json::from_str::<serde_json::Value>(&saida).ok().and_then(|v| v["result"].as_str().map(str::to_owned));
    if !status.success() {
        let mut erro = String::new();
        filho.stderr.take().map(|mut s| s.read_to_string(&mut erro));
        return Err(format!("O Claude não conseguiu responder: {}", resultado.unwrap_or_else(|| erro.lines().last().unwrap_or("sem detalhe").to_owned())));
    }
    Ok(resultado.unwrap_or(saida))
}

#[tauri::command(async)]
pub fn agentes_modelos() -> std::collections::BTreeMap<String, Vec<agentes::ModeloDaCli>> {
    agentes::modelos_disponiveis(&crate::profiles::list_profiles())
}

/// Escreve um modelo de agente a partir de uma frase: opus com esforço alto, guiado pelo prompt de
/// sistema com as práticas de mercado (`omni-core/prompts/criar-agente.md`).
#[tauri::command(async)]
pub fn agentes_criar_com_ia(descricao: String, cli: String, conta: Option<String>, project_path: Option<String>) -> Result<ModeloDeAgente, String> {
    let descricao = descricao.trim();
    if descricao.len() < 8 { return Err("Descreva o agente com um pouco mais de detalhe".into()); }
    if !agentes::CLIS.contains(&cli.as_str()) { return Err("CLI inválida".into()); }
    let modelos = agentes::modelos_disponiveis(&crate::profiles::list_profiles());
    let existentes: Vec<String> = agentes_listar(project_path).into_iter().map(|a| a.modelo.name).collect();
    let pedido = agentes::pedido_de_criacao(descricao, &cli, &agentes::modelos_em_texto(&modelos, &cli), &existentes);
    let resposta = claude_sem_tela(agentes::SISTEMA_CRIAR_AGENTE, &pedido, "opus", "high", conta.as_deref(), CRIACAO_MAX)?;
    let mut modelo = agentes::modelo_da_resposta(&resposta).ok_or("A resposta da IA não veio no formato de agente; tente de novo")?;
    modelo.cli = cli;
    if existentes.contains(&modelo.name) { modelo.name = format!("{}-2", modelo.name).chars().take(40).collect(); }
    Ok(modelo)
}
