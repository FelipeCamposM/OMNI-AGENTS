//! Cursor Agent CLI (`agent`). Cada conversa mora em `<config>/chats/<hash da pasta>/<chatId>/`:
//! `meta.json` (pasta, título, horas, `hasConversation`) e `store.db`, um SQLite de blobs
//! endereçados por sha256. A chave `0` da tabela `meta` é um JSON (em hex) com `latestRootBlobId`;
//! o blob raiz é protobuf cujo campo 1 (repetido, 32 bytes) lista em ordem os ids das mensagens, e
//! cada mensagem é um JSON `{role, content}` no formato do AI SDK.
//! Formato conferido no agent 2026.10.19, sem schema publicado: o que não bate vira "sem item".

use crate::feed::{Entry, Item, Kind};
use rusqlite::{Connection, OpenFlags};
use serde_json::Value;
use std::path::{Path, PathBuf};

/// `meta.json` de cada chat da conta.
pub fn chats(config_dir: &Path) -> Vec<PathBuf> {
    let Ok(pastas) = std::fs::read_dir(config_dir.join("chats")) else { return Vec::new() };
    pastas.flatten().filter_map(|pasta| std::fs::read_dir(pasta.path()).ok())
        .flat_map(|chats| chats.flatten().map(|chat| chat.path().join("meta.json")))
        .filter(|meta| meta.is_file())
        .collect()
}

pub fn meta(meta_json: &Path) -> Option<Value> {
    serde_json::from_slice(&std::fs::read(meta_json).ok()?).ok()
}

/// Ids (hex) no campo 1 do blob raiz.
fn ids_da_raiz(raiz: &[u8]) -> Vec<String> {
    let mut ids = Vec::new();
    let mut i = 0;
    // Só o começo interessa: os ids vêm primeiro, como `0x0a 0x20 <32 bytes>`.
    while raiz.get(i) == Some(&0x0a) && raiz.get(i + 1) == Some(&0x20) && i + 34 <= raiz.len() {
        ids.push(raiz[i + 2..i + 34].iter().map(|b| format!("{b:02x}")).collect());
        i += 34;
    }
    ids
}

/// `<timestamp>Friday, Oct 30, 2026, 7:33 AM (UTC-3)</timestamp>` → RFC 3339.
fn hora(texto: &str) -> Option<String> {
    let dentro = texto.split_once("<timestamp>")?.1.split_once("</timestamp>")?.0;
    let (quando, fuso) = dentro.split_once(" (UTC")?;
    let fuso = fuso.trim_end_matches(')');
    let (horas, minutos) = fuso.split_once(':').unwrap_or((fuso, "0"));
    let horas: i32 = if horas.is_empty() { 0 } else { horas.parse().ok()? };
    let segundos = horas * 3600 + horas.signum() * minutos.parse::<i32>().ok()? * 60;
    let local = chrono::NaiveDateTime::parse_from_str(quando, "%A, %b %d, %Y, %I:%M %p").ok()?;
    Some(local.and_local_timezone(chrono::FixedOffset::east_opt(segundos)?).single()?.to_rfc3339())
}

/// O que você digitou: o `<user_query>` da mensagem. Mensagem sem ele é contexto injetado pela CLI.
fn pedido(texto: &str) -> Option<String> {
    let dentro = texto.split_once("<user_query>")?.1.rsplit_once("</user_query>")?.0;
    Some(dentro.trim().to_owned()).filter(|t| !t.is_empty())
}

fn detalhe(args: &Value) -> String {
    let valor = args.as_object().and_then(|campos| campos.values().find_map(Value::as_str)).unwrap_or_default();
    crate::feed::curto(valor)
}

/// Itens da conversa, em ordem, no formato do feed do Claude/Codex.
pub fn itens(store: &Path) -> std::io::Result<Vec<Entry>> {
    let erro = |e: rusqlite::Error| std::io::Error::other(e.to_string());
    if !store.exists() { return Ok(Vec::new()); }
    // Só leitura: o agent continua gravando (WAL) enquanto a conversa está aberta.
    let conexao = Connection::open_with_flags(store, OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX).map_err(erro)?;
    // Chat aberto e ainda sem mensagem: o agent cria o banco só com as tabelas. É "vazia", não erro.
    let hex: String = match conexao.query_row("SELECT value FROM meta WHERE key = '0'", [], |l| l.get(0)) {
        Err(rusqlite::Error::QueryReturnedNoRows) => return Ok(Vec::new()),
        lido => lido.map_err(erro)?,
    };
    let bytes: Vec<u8> = (0..hex.len() / 2).filter_map(|i| u8::from_str_radix(hex.get(i * 2..i * 2 + 2)?, 16).ok()).collect();
    let indice: Value = serde_json::from_slice(&bytes).map_err(std::io::Error::other)?;
    let blob = |id: &str| conexao.query_row("SELECT data FROM blobs WHERE id = ?1", [id], |l| l.get::<_, Vec<u8>>(0)).ok();
    let raiz = indice["latestRootBlobId"].as_str().and_then(blob).unwrap_or_default();
    let base = store.parent().and_then(Path::file_name).map(|s| s.to_string_lossy().into_owned()).unwrap_or_default();

    let mut saida = Vec::new();
    let mut quando: Option<String> = None;
    for id in ids_da_raiz(&raiz) {
        let Some(mensagem) = blob(&id).and_then(|b| serde_json::from_slice::<Value>(&b).ok()) else { continue };
        let partes: Vec<&Value> = match &mensagem["content"] {
            Value::Array(partes) => partes.iter().collect(),
            _ => Vec::new(),
        };
        let entrada = |n: usize, kind: Kind, role: &str, text: String, tool: Option<String>, quando: &Option<String>| Entry {
            identity: format!("cursor:{base}#{id}#{n}"),
            item: Item { kind, role: role.into(), text, tool, timestamp: quando.clone(), imagens: 0, diff: None },
        };
        match mensagem["role"].as_str() {
            Some("user") => {
                let texto: String = partes.iter().filter_map(|p| p["text"].as_str()).collect::<Vec<_>>().join("\n");
                let Some(pedido) = pedido(&texto) else { continue };
                quando = hora(&texto).or(quando.take());
                let kind = if pedido.starts_with('/') { Kind::Command } else { Kind::Text };
                saida.push(entrada(0, kind, "user", pedido, None, &quando));
            }
            Some("assistant") => for (n, parte) in partes.iter().enumerate() {
                match parte["type"].as_str() {
                    Some("text") => if let Some(t) = parte["text"].as_str().filter(|t| !t.trim().is_empty()) {
                        saida.push(entrada(n, Kind::Text, "assistant", t.to_owned(), None, &quando));
                    },
                    Some("tool-call") => if let Some(nome) = parte["toolName"].as_str() {
                        saida.push(entrada(n, Kind::Tool, "assistant", detalhe(&parte["args"]), Some(nome.to_owned()), &quando));
                    },
                    _ => {}
                }
            },
            _ => {}
        }
    }
    Ok(saida)
}

/// Saída do `agent models`: `id - Nome` por linha. O esforço vem no id (`claude-opus-5-5-high`), então
/// cada linha é um modelo. Lixo invisível que a CLI põe no fim de alguns nomes sai.
pub fn modelos(saida: &str) -> Vec<(String, String)> {
    saida.lines().filter_map(|linha| {
        let (id, nome) = linha.trim().split_once(" - ")?;
        if id.is_empty() || id.contains(char::is_whitespace) { return None; }
        let nome: String = nome.chars().filter(|c| !matches!(c, '\u{200b}'..='\u{200f}' | '\u{feff}')).collect();
        let nome = nome.trim_end_matches("(current, default)").split_whitespace().collect::<Vec<_>>().join(" ");
        Some((id.to_owned(), nome))
    }).collect()
}

/// Modelo que o chat usou por último (`lastUsedModel` do índice do `store.db`). "default" = o padrão.
pub fn modelo(store: &Path) -> Option<String> {
    let conexao = Connection::open_with_flags(store, OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX).ok()?;
    let hex: String = conexao.query_row("SELECT value FROM meta WHERE key = '0'", [], |l| l.get(0)).ok()?;
    let bytes: Vec<u8> = (0..hex.len() / 2).filter_map(|i| u8::from_str_radix(hex.get(i * 2..i * 2 + 2)?, 16).ok()).collect();
    let indice: Value = serde_json::from_slice(&bytes).ok()?;
    indice["lastUsedModel"].as_str().filter(|m| *m != "default").map(str::to_owned)
}

fn pasta_normalizada(p: &str) -> String { p.replace('\\', "/").trim_end_matches('/').to_lowercase() }

/// O chat do agent aberto numa sessão do OMNI: o primeiro criado na pasta `cwd` depois que a sessão
/// começou. O `meta.json` nasce ao abrir; antes da primeira mensagem `hasConversation` é falso.
/// ponytail: dois agent na mesma pasta abertos no mesmo instante podem trocar de conversa.
pub fn descobrir(config_dir: &Path, cwd: &str, desde_ms: u64) -> Option<(String, PathBuf)> {
    let alvo = pasta_normalizada(cwd);
    chats(config_dir).into_iter()
        .filter_map(|caminho| {
            let meta = meta(&caminho)?;
            let criado = meta["createdAtMs"].as_u64()?;
            let mesma_pasta = meta["cwd"].as_str().is_some_and(|p| pasta_normalizada(p) == alvo);
            // Folga para o relógio do agent e o do engine não baterem no milissegundo.
            if !mesma_pasta || criado + 10_000 < desde_ms { return None; }
            Some((criado, caminho.parent()?.to_path_buf()))
        })
        .min_by_key(|(criado, _)| *criado)
        .and_then(|(_, pasta)| Some((pasta.file_name()?.to_string_lossy().into_owned(), pasta.join("store.db"))))
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    use serde_json::json;

    /// Um `store.db` no formato do agent: blobs por id, raiz com os ids no campo 1.
    pub(crate) fn gravar_chat(pasta: &Path, cwd: &str, criado_ms: u64, mensagens: &[Value]) {
        std::fs::create_dir_all(pasta).unwrap();
        let conexao = Connection::open(pasta.join("store.db")).unwrap();
        conexao.execute_batch("CREATE TABLE blobs (id TEXT PRIMARY KEY, data BLOB); CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT);").unwrap();
        let mut raiz = Vec::new();
        for (n, m) in mensagens.iter().enumerate() {
            let id = [n as u8 + 1; 32];
            let hex: String = id.iter().map(|b| format!("{b:02x}")).collect();
            conexao.execute("INSERT INTO blobs VALUES (?1, ?2)", rusqlite::params![hex, m.to_string().into_bytes()]).unwrap();
            raiz.extend([0x0a, 0x20]); raiz.extend(id);
        }
        raiz.extend([0x2a, 0x00]);
        conexao.execute("INSERT INTO blobs VALUES ('raiz', ?1)", [raiz]).unwrap();
        let indice = json!({"latestRootBlobId": "raiz", "name": "Chat"}).to_string();
        conexao.execute("INSERT INTO meta VALUES ('0', ?1)", [indice.bytes().map(|b| format!("{b:02x}")).collect::<String>()]).unwrap();
        std::fs::write(pasta.join("meta.json"), json!({"schemaVersion":1,"createdAtMs":criado_ms,"hasConversation":true,"title":"Bom dia","updatedAtMs":criado_ms + 5,"cwd":cwd}).to_string()).unwrap();
    }

    pub(crate) fn conversa_de_exemplo() -> Vec<Value> {
        vec![
            json!({"role":"system","content":"You are an AI coding assistant"}),
            json!({"role":"user","content":"<user_info>\nOS Version: win32\n</user_info>"}),
            json!({"role":"user","content":[{"type":"text","text":"<timestamp>Friday, Oct 30, 2026, 7:33 AM (UTC-3)</timestamp>\n<user_query>\nbom dia\n</user_query>"}]}),
            json!({"role":"assistant","content":[{"type":"reasoning","text":""},{"type":"text","text":"Bom dia. Vou conferir."},{"type":"tool-call","toolName":"Read","args":{"path":"C:\\x\\SKILL.md"}}]}),
            json!({"role":"tool","content":[{"type":"tool-result","toolName":"Read","result":"erro"}]}),
            json!({"role":"assistant","content":[{"type":"text","text":"Em que posso ajudar?"}]}),
        ]
    }

    #[test]
    fn modelos_da_saida_do_agent() {
        let saida = "Available models\n\nauto - Auto (current, default)\ngrok-4.7-low-fast - Grok 4.7  Low Fast\u{200b}\u{200b}\n\nTip: use --model <id> (or /model <id>) to switch.";
        assert_eq!(modelos(saida), vec![("auto".into(), "Auto".into()), ("grok-4.7-low-fast".into(), "Grok 4.7 Low Fast".into())]);
    }

    #[test]
    fn le_a_conversa_na_ordem_da_raiz_sem_o_contexto_injetado() {
        let raiz = tempfile::tempdir().unwrap();
        let chat = raiz.path().join("chats").join("hash").join("chat-1");
        gravar_chat(&chat, "D:\\proj", 1_000, &conversa_de_exemplo());
        let itens = itens(&chat.join("store.db")).unwrap();
        let resumo: Vec<_> = itens.iter().map(|e| (e.item.role.as_str(), e.item.text.as_str(), e.item.tool.as_deref())).collect();
        assert_eq!(resumo, [("user", "bom dia", None), ("assistant", "Bom dia. Vou conferir.", None),
            ("assistant", "C:\\x\\SKILL.md", Some("Read")), ("assistant", "Em que posso ajudar?", None)]);
        assert_eq!(itens[0].item.timestamp.as_deref(), Some("2026-10-30T07:33:00-03:00"));
        assert_eq!(itens[3].item.timestamp, itens[0].item.timestamp);

        assert_eq!(descobrir(raiz.path(), "d:/proj/", 500).map(|(id, _)| id).as_deref(), Some("chat-1"));
        assert!(descobrir(raiz.path(), "D:\\proj", 20_000).is_none(), "chat de antes da sessão não é dela");
        assert!(descobrir(raiz.path(), "D:\\outro", 0).is_none());
    }
}
