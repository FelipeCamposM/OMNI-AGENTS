//! Tela Conhecimento: a base mora no crate `omni-rag`; aqui só ficam a importação em segundo plano
//! e os interruptores da memória e do MCP.
use omni_rag::{caminho_padrao, ganchos, Base, Fonte, Resultado};
use serde::Serialize;
use std::{
    path::Path,
    sync::Once,
};

const RESULTADOS_NA_TELA: usize = 10;
static RECUPERAR: Once = Once::new();

fn abrir() -> Result<Base, String> {
    let base = Base::abrir(&caminho_padrao().ok_or("pasta de dados não encontrada")?)?;
    RECUPERAR.call_once(|| { let _ = base.marcar_interrompidas(); });
    Ok(base)
}

pub(crate) async fn bloqueante<T: Send + 'static>(tarefa: impl FnOnce() -> Result<T, String> + Send + 'static) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(tarefa).await.map_err(|erro| erro.to_string())?
}

#[tauri::command]
pub async fn rag_listar() -> Result<Vec<Fonte>, String> {
    bloqueante(|| abrir()?.listar()).await
}

/// Volta na hora: um banco grande leva minutos, e a tela acompanha pela lista de fontes.
#[tauri::command]
pub async fn rag_adicionar(caminhos: Vec<String>) -> Result<(), String> {
    let mut base = bloqueante(abrir).await?;
    std::thread::spawn(move || {
        for caminho in caminhos {
            if let Err(erro) = base.adicionar(Path::new(&caminho)) {
                eprintln!("omni-rag: {caminho}: {erro}");
            }
        }
    });
    Ok(())
}

#[tauri::command]
pub async fn rag_remover(id: i64) -> Result<(), String> {
    bloqueante(move || abrir()?.remover(id)).await
}

#[tauri::command]
pub async fn rag_buscar(consulta: String) -> Result<Vec<Resultado>, String> {
    bloqueante(move || abrir()?.buscar(&consulta, RESULTADOS_NA_TELA)).await
}

#[derive(Serialize)]
pub struct EstadoDaMemoria {
    ligada: bool,
    notas: i64,
}

#[tauri::command]
pub async fn rag_memoria_estado() -> Result<EstadoDaMemoria, String> {
    bloqueante(|| {
        let caminho = caminho_padrao().ok_or("pasta de dados não encontrada")?;
        Ok(EstadoDaMemoria { ligada: ganchos::memoria_ligada(&caminho), notas: abrir()?.total_de_notas() })
    }).await
}

#[tauri::command]
pub async fn rag_memoria_ligar(ligada: bool) -> Result<(), String> {
    bloqueante(move || ganchos::ligar_memoria(&caminho_padrao().ok_or("pasta de dados não encontrada")?, ligada)).await
}

/// O MCP do OMNI entra nas sessões do Claude que o OMNI abre (`--mcp-config`, no engine): sem
/// registrar nada no `.claude.json` de conta nenhuma. Aqui é só o interruptor.
#[tauri::command]
pub async fn rag_claude_ligado() -> Result<bool, String> {
    bloqueante(|| Ok(ganchos::mcp_ligado(&caminho_padrao().ok_or("pasta de dados não encontrada")?))).await
}

#[tauri::command]
pub async fn rag_claude_ligar(ligado: bool) -> Result<(), String> {
    bloqueante(move || ganchos::ligar_mcp(&caminho_padrao().ok_or("pasta de dados não encontrada")?, ligado)).await
}
