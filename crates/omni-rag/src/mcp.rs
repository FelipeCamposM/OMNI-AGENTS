//! Servidor MCP (stdio): o que o usuário faz nas telas do OMNI, o agente também faz quando ele pede.
//! A base mora aqui; fluxos e histórico têm módulos próprios. As descrições ficam curtas e
//! pedem uso só quando o usuário mandar, para não gastar tokens em toda conversa.
use crate::{engine::Contexto, mcp_fluxos, mcp_historico, Base};
use serde_json::{json, Value};
use std::io::{BufRead, Write};

const RESULTADOS_PADRAO: u64 = 5;
const RESULTADOS_MAXIMOS: u64 = 20;

fn ferramentas() -> Value {
    let mut lista = ferramentas_da_base();
    lista.extend(mcp_historico::ferramentas());
    lista.extend(mcp_fluxos::ferramentas());
    Value::Array(lista)
}

fn ferramentas_da_base() -> Vec<Value> {
    let lista = json!([
        {
            "name": "buscar_conhecimento",
            "description": "Busca por palavras-chave na base de conhecimento do usuário (arquivos e conversas importados). Use SOMENTE quando o usuário pedir para consultar a base. Retorna resumos curtos com id.",
            "inputSchema": {"type": "object", "properties": {
                "consulta": {"type": "string", "description": "Palavras-chave"},
                "limite": {"type": "integer", "description": "Máximo de resultados (padrão 5)"}
            }, "required": ["consulta"]}
        },
        {
            "name": "ler_trecho",
            "description": "Lê o trecho completo de um resultado de buscar_conhecimento.",
            "inputSchema": {"type": "object", "properties": {"id": {"type": "integer"}}, "required": ["id"]}
        }
    ]);
    lista.as_array().cloned().unwrap_or_default()
}

fn chamar(base: &Base, nome: &str, argumentos: &Value) -> Result<String, String> {
    match nome {
        "buscar_conhecimento" => {
            let consulta = argumentos["consulta"].as_str().ok_or("informe a consulta")?;
            let limite = argumentos["limite"].as_u64().unwrap_or(RESULTADOS_PADRAO).clamp(1, RESULTADOS_MAXIMOS) as usize;
            let resultados = base.buscar(consulta, limite)?;
            if resultados.is_empty() { return Ok("Nada encontrado na base.".into()); }
            Ok(resultados.iter().map(|item| format!("#{} [{} · {}] {}", item.id, item.fonte, item.titulo, item.resumo.replace('\n', " "))).collect::<Vec<_>>().join("\n"))
        }
        "ler_trecho" => {
            let id = argumentos["id"].as_i64().ok_or("informe o id")?;
            Ok(base.ler(id)?.unwrap_or_else(|| "Trecho não encontrado.".into()))
        }
        _ => {
            let contexto = Contexto::padrao();
            mcp_historico::chamar(base, &contexto, nome, argumentos)
                .or_else(|| mcp_fluxos::chamar(&contexto, nome, argumentos))
                .unwrap_or_else(|| Err(format!("ferramenta desconhecida: {nome}")))
        }
    }
}

/// Uma mensagem JSON-RPC → a resposta. Notificação (sem `id`) não tem resposta.
pub fn responder(base: &Base, mensagem: &Value) -> Option<Value> {
    let id = mensagem.get("id")?.clone();
    let resultado = match mensagem["method"].as_str().unwrap_or_default() {
        "initialize" => json!({
            "protocolVersion": mensagem["params"]["protocolVersion"].as_str().unwrap_or("2024-11-05"),
            "capabilities": {"tools": {}},
            "serverInfo": {"name": "omni-rag", "version": env!("CARGO_PKG_VERSION")}
        }),
        "ping" => json!({}),
        "tools/list" => json!({"tools": ferramentas()}),
        "tools/call" => {
            let parametros = &mensagem["params"];
            match chamar(base, parametros["name"].as_str().unwrap_or_default(), &parametros["arguments"]) {
                Ok(texto) => json!({"content": [{"type": "text", "text": texto}]}),
                Err(erro) => json!({"content": [{"type": "text", "text": erro}], "isError": true}),
            }
        }
        metodo => return Some(json!({"jsonrpc": "2.0", "id": id, "error": {"code": -32601, "message": format!("método desconhecido: {metodo}")}})),
    };
    Some(json!({"jsonrpc": "2.0", "id": id, "result": resultado}))
}

pub fn servir(base: &Base, entrada: impl BufRead, mut saida: impl Write) -> std::io::Result<()> {
    for linha in entrada.lines() {
        let linha = linha?;
        let Ok(mensagem) = serde_json::from_str::<Value>(&linha) else { continue };
        if let Some(resposta) = responder(base, &mensagem) {
            writeln!(saida, "{resposta}")?;
            saida.flush()?;
        }
    }
    Ok(())
}
