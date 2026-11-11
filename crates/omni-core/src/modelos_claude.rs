//! Modelos do Claude que dá para escolher, lidos do próprio Claude Code instalado. A CLI traz o
//! registro de modelos embutido (`{id:"claude-fable-5-2",family:"fable",display_name:"Fable 5.2",
//! knowledge_cutoff:"June 2026",…}`); ler dali faz um modelo novo aparecer assim que a CLI atualiza,
//! sem release do OMNI. Sem a CLI (ou formato mudou), vale a lista fixa de reserva.

use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::SystemTime;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ModeloClaude {
    pub id: String,
    pub familia: String,
    pub nome: String,
}

/// Reserva para quando a CLI não for achada: a lista do Claude Code 2.1.322.
const RESERVA: [(&str, &str, &str); 8] = [
    ("claude-fable-5-2", "fable", "Fable 5.2"), ("claude-fable-5-1", "fable", "Fable 5.1"),
    ("claude-opus-5-5", "opus", "Opus 5.5"), ("claude-opus-5", "opus", "Opus 5"),
    ("claude-sonnet-5-5", "sonnet", "Sonnet 5.5"), ("claude-sonnet-5", "sonnet", "Sonnet 5"),
    ("claude-haiku-5-5", "haiku", "Haiku 5.5"), ("claude-haiku-4-5", "haiku", "Haiku 4.5"),
];

const FAMILIAS: [&str; 4] = ["fable", "opus", "sonnet", "haiku"];
const MESES: [&str; 12] = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/// Dica de cada família, como o `/model` da CLI descreve.
pub fn dica(familia: &str) -> &'static str {
    match familia {
        "fable" => "Para os desafios mais difíceis",
        "opus" => "Trabalho complexo e do dia a dia",
        "sonnet" => "Tarefas de rotina",
        "haiku" => "O mais rápido, respostas curtas",
        _ => "",
    }
}

fn campo<'a>(resto: &'a [u8], nome: &str) -> Option<(&'a str, &'a [u8])> {
    let resto = resto.strip_prefix(format!("{nome}:\"").as_bytes())?;
    let fim = resto.iter().take(80).position(|b| *b == b'"')?;
    Some((std::str::from_utf8(&resto[..fim]).ok()?, &resto[fim + 1..]))
}

/// `"June 2026"` → `(2026, 6)`.
fn data(texto: &str) -> Option<(u32, u32)> {
    let (mes, ano) = texto.split_once(' ')?;
    Some((ano.parse().ok()?, MESES.iter().position(|m| *m == mes)? as u32 + 1))
}

/// Versão a partir do id (`claude-opus-4-6` → `[4, 6]`), para ordenar do mais novo ao mais velho.
fn versao(id: &str) -> Vec<u32> {
    id.split('-').filter_map(|p| p.parse().ok()).filter(|n: &u32| *n < 100).collect()
}

/// Lê o registro de modelos de dentro do executável da CLI. Fica só o que a conta comum usa: sem a
/// família Mythos (só para organizações aprovadas) e sem os aposentados (corte de conhecimento
/// antes de fevereiro de 2025: Sonnet 3.x, Opus 4/4.1, Sonnet 4/4.5).
pub fn do_executavel(bytes: &[u8]) -> Vec<ModeloClaude> {
    const MARCA: &[u8] = b"{id:\"claude-";
    let mut achados: Vec<(ModeloClaude, (u32, u32))> = Vec::new();
    let mut i = 0;
    while let Some(pos) = bytes[i..].windows(MARCA.len()).position(|janela| janela == MARCA) {
        let inicio = i + pos + 1;
        i = inicio;
        let Some((id, resto)) = campo(&bytes[inicio..], "id") else { continue };
        let Some((familia, resto)) = resto.strip_prefix(b",").and_then(|r| campo(r, "family")) else { continue };
        let Some((nome, resto)) = resto.strip_prefix(b",").and_then(|r| campo(r, "display_name")) else { continue };
        let Some(corte) = resto.strip_prefix(b",").and_then(|r| campo(r, "knowledge_cutoff")).and_then(|(t, _)| data(t)) else { continue };
        if !FAMILIAS.contains(&familia) || corte < (2025, 2) || achados.iter().any(|(m, _)| m.id == id) { continue; }
        achados.push((ModeloClaude { id: id.into(), familia: familia.into(), nome: nome.into() }, corte));
    }
    let mut modelos: Vec<ModeloClaude> = achados.into_iter().map(|(m, _)| m).collect();
    modelos.sort_by(|a, b| {
        let ordem = |m: &ModeloClaude| FAMILIAS.iter().position(|f| *f == m.familia).unwrap_or(9);
        ordem(a).cmp(&ordem(b)).then_with(|| versao(&b.id).cmp(&versao(&a.id)))
    });
    modelos
}

/// O executável `claude` no PATH (depois de `ampliar_path`, que põe `~/.local/bin` e afins).
fn executavel() -> Option<PathBuf> {
    let nomes: &[&str] = if cfg!(windows) { &["claude.exe", "claude"] } else { &["claude"] };
    std::env::split_paths(&std::env::var_os("PATH")?)
        .flat_map(|dir| nomes.iter().map(move |n| dir.join(n)))
        .find(|p| p.is_file() && std::fs::metadata(p).is_ok_and(|m| m.len() > 10_000_000))
}

static CACHE: Mutex<Option<(PathBuf, SystemTime, Vec<ModeloClaude>)>> = Mutex::new(None);

fn lidos_de(caminho: &Path) -> Option<Vec<ModeloClaude>> {
    let quando = std::fs::metadata(caminho).and_then(|m| m.modified()).ok()?;
    let mut cache = CACHE.lock().ok()?;
    if let Some((c, q, lista)) = cache.as_ref() {
        if c == caminho && *q == quando { return Some(lista.clone()); }
    }
    let lista = do_executavel(&std::fs::read(caminho).ok()?);
    if lista.is_empty() { return None; }
    *cache = Some((caminho.to_owned(), quando, lista.clone()));
    Some(lista)
}

/// Os modelos do Claude, do mais capaz ao mais rápido, cada família do mais novo ao mais velho.
/// Lê a CLI uma vez por versão instalada (o arquivo tem ~300 MB; a varredura leva ~1 s).
pub fn disponiveis() -> Vec<ModeloClaude> {
    crate::cli_path::ampliar_path();
    executavel().and_then(|c| lidos_de(&c)).unwrap_or_else(|| RESERVA.iter()
        .map(|(id, familia, nome)| ModeloClaude { id: (*id).into(), familia: (*familia).into(), nome: (*nome).into() }).collect())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn le_o_registro_da_cli_sem_mythos_nem_aposentados() {
        let binario = br#"xx{id:"claude-opus-5-5",family:"opus",display_name:"Opus 5.5",knowledge_cutoff:"June 2026",provider_ids:{}}
            {id:"claude-3-5-sonnet",family:"sonnet",display_name:"Sonnet 3.5",provider_ids:{}}
            {id:"claude-opus-4-1",family:"opus",display_name:"Opus 4.1",knowledge_cutoff:"January 2025",provider_ids:{}}
            {id:"claude-mythos-5-2",family:"mythos",display_name:"Mythos 5.2",knowledge_cutoff:"June 2026"}
            {id:"claude-haiku-4-5",family:"haiku",display_name:"Haiku 4.5",knowledge_cutoff:"February 2025"}
            {id:"claude-opus-4-6",family:"opus",display_name:"Opus 4.6",knowledge_cutoff:"May 2025"}
            {id:"claude-fable-5-2",family:"fable",display_name:"Fable 5.2",knowledge_cutoff:"June 2026"}
            {id:"claude-fable-5-2",family:"fable",display_name:"Fable 5.2",knowledge_cutoff:"June 2026"}"#;
        let ids: Vec<String> = do_executavel(binario).into_iter().map(|m| m.id).collect();
        assert_eq!(ids, ["claude-fable-5-2", "claude-opus-5-5", "claude-opus-4-6", "claude-haiku-4-5"]);
    }
}
