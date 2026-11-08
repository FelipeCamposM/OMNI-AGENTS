//! `omni-rag mcp` é o que o Claude executa. Os outros comandos servem para testar pelo terminal.
use omni_rag::{caminho_padrao, ganchos, mcp, Base};
use serde_json::Value;
use std::{io::{self, Read}, path::Path, process::ExitCode};

/// Gancho nunca falha para a CLI: qualquer problema vira "nada a acrescentar".
fn gancho(evento: &str) {
    if std::env::var_os(ganchos::MARCA_DA_PASSADA).is_some() { return; }
    let Some(caminho) = caminho_padrao().filter(|caminho| ganchos::memoria_ligada(caminho)) else { return };
    let mut texto = String::new();
    if io::stdin().read_to_string(&mut texto).is_err() { return; }
    let Ok(entrada) = serde_json::from_str::<Value>(&texto) else { return };
    if evento == "fim" { return ganchos::disparar_passada(&entrada); }
    let Ok(base) = Base::abrir(&caminho) else { return };
    if let Some(saida) = ganchos::responder(&base, evento, &entrada) { println!("{saida}"); }
}

fn executar() -> Result<(), String> {
    let argumentos: Vec<String> = std::env::args().skip(1).collect();
    if argumentos.first().map(String::as_str) == Some("hook") {
        gancho(argumentos.get(1).map_or("", String::as_str));
        return Ok(());
    }
    let caminho = caminho_padrao().ok_or("não achei a pasta de dados")?;
    let mut base = Base::abrir(&caminho)?;
    match argumentos.first().map(String::as_str) {
        Some("mcp") => mcp::servir(&base, io::stdin().lock(), io::stdout().lock()).map_err(|erro| erro.to_string()),
        Some("passada") => {
            if let [_, transcript, cwd, sessao] = argumentos.as_slice() { ganchos::passada(&base, Path::new(transcript), cwd, sessao); }
            Ok(())
        }
        Some("importar-notas") => {
            let pasta = argumentos.get(1).ok_or("informe a pasta")?;
            println!("{} notas importadas (total {})", base.importar_notas(Path::new(pasta))?, base.total_de_notas());
            Ok(())
        }
        Some("add") => {
            for arquivo in &argumentos[1..] {
                let fonte = base.adicionar(Path::new(arquivo))?;
                println!("{}: {} ({} trechos) {}", fonte.nome, fonte.estado, fonte.trechos, fonte.erro.unwrap_or_default());
            }
            Ok(())
        }
        Some("search") => {
            for item in base.buscar(&argumentos[1..].join(" "), 5)? {
                println!("#{} [{} · {}] {}", item.id, item.fonte, item.titulo, item.resumo);
            }
            Ok(())
        }
        Some("list") => {
            for fonte in base.listar()? {
                println!("{} {} {} trechos={} {}", fonte.id, fonte.nome, fonte.estado, fonte.trechos, fonte.erro.unwrap_or_default());
            }
            Ok(())
        }
        _ => Err("uso: omni-rag mcp | add <arquivos> | search <palavras> | list | importar-notas <pasta>".into()),
    }
}

fn main() -> ExitCode {
    match executar() {
        Ok(()) => ExitCode::SUCCESS,
        Err(erro) => { eprintln!("{erro}"); ExitCode::FAILURE }
    }
}
