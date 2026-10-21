use serde::Serialize;
use std::path::PathBuf;
use std::sync::Mutex;

/// Transcripts já lidos, por (caminho, mtime, tamanho) e até que byte: reabrir a página só lê o que
/// entrou desde a última vez. Fica também em disco (`relatorio-cache.json`), para abrir o app de
/// novo não reler meses de conversa.
static CACHE: Mutex<Option<omni_core::relatorio::Cache>> = Mutex::new(None);

#[derive(Serialize)]
pub struct CommitsDoProjeto {
    caminho: String,
    commits: Vec<crate::git_client::CommitResumo>,
}

#[derive(Serialize)]
pub struct RelatorioIa {
    uso: omni_core::relatorio::Relatorio,
    commits: Vec<CommitsDoProjeto>,
}

fn arquivo_do_cache() -> Result<PathBuf, String> {
    Ok(crate::engine_client::engine_dir()?.join("relatorio-cache.json"))
}

/// Cache ilegível (versão antiga, arquivo cortado) só custa reler tudo uma vez.
fn carregar_cache() -> omni_core::relatorio::Cache {
    arquivo_do_cache().ok()
        .and_then(|caminho| std::fs::read(caminho).ok())
        .and_then(|bytes| serde_json::from_slice(&bytes).ok())
        .unwrap_or_default()
}

fn salvar_cache(cache: &omni_core::relatorio::Cache) {
    let Ok(caminho) = arquivo_do_cache() else { return };
    let Ok(json) = serde_json::to_vec(cache) else { return };
    // Grava ao lado e troca: fechar o app no meio não deixa um JSON pela metade.
    let temporario = caminho.with_extension("json.tmp");
    if std::fs::write(&temporario, json).is_ok() {
        let _ = std::fs::rename(&temporario, &caminho);
    }
}

/// Página Relatórios: uso de IA por dia (dos transcripts das contas) e commits dos projetos abertos
/// no período. Tudo local; nenhum texto de mensagem ou commit sai daqui, só contagens.
#[tauri::command(async)]
pub fn relatorio_ia(dias: u32, fuso_min: i32, projetos: Vec<String>) -> Result<RelatorioIa, String> {
    let dias = dias.clamp(1, 90);
    let profiles = omni_core::profiles(&crate::engine_client::engine_dir()?);
    let agora = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis() as i64).unwrap_or(0);
    let mut vistos = std::collections::HashSet::new();
    let projetos: Vec<String> = projetos.into_iter().take(50)
        .filter(|caminho| vistos.insert(caminho.replace('\\', "/").to_lowercase()))
        .collect();
    // Git de cada projeto em paralelo com a leitura dos transcripts: era a outra metade da espera.
    std::thread::scope(|escopo| {
        let gits: Vec<_> = projetos.iter()
            .map(|caminho| escopo.spawn(move || CommitsDoProjeto { commits: crate::git_client::commits_recentes(caminho, dias), caminho: caminho.clone() }))
            .collect();
        let uso = {
            let mut cache = CACHE.lock().map_err(|_| "cache do relatório indisponível".to_string())?;
            let cache = cache.get_or_insert_with(carregar_cache);
            let uso = omni_core::relatorio::montar(&profiles, dias, fuso_min, agora, cache);
            salvar_cache(cache);
            uso
        };
        let commits = gits.into_iter().filter_map(|git| git.join().ok()).collect();
        Ok(RelatorioIa { uso, commits })
    })
}

/// Configurações → Armazenamento: quanto do disco as conversas ocupam, por conta.
#[tauri::command(async)]
pub fn armazenamento() -> Result<omni_core::armazenamento::Armazenamento, String> {
    Ok(omni_core::armazenamento::medir(&crate::engine_client::engine_dir()?))
}
