//! Antigravity CLI (`agy`, Google). Cada conversa é um SQLite em `<config>/conversations/<id>.db`
//! com os passos em protobuf; o índice (`conversation_summaries.db`) diz a pasta de cada uma.
//! Formato conferido no agy 1.4.2, sem schema publicado — por isso a leitura é por número de campo
//! e falha fechada: campo que não bate vira "sem item", nunca texto errado.
//!
//! Passos (`steps.step_type`): 14 = mensagem sua (`19.2`), 15 = resposta (`20.1`), os demais com
//! nome de ferramenta em `5.4.2` são ações. Hora em `5.1` (segundos, nanos).

use crate::feed::{Entry, Item, Kind};
use rusqlite::{Connection, OpenFlags};
use std::path::{Path, PathBuf};

const PASSO_USUARIO: i64 = 14;
const PASSO_RESPOSTA: i64 = 15;

/// Campo de protobuf: número e valor (varint ou bytes). Fixos de 32/64 bits são pulados.
enum Valor<'a> { Int(u64), Bytes(&'a [u8]) }

fn varint(b: &[u8], i: &mut usize) -> Option<u64> {
    let mut valor = 0u64;
    for deslocamento in (0..64).step_by(7) {
        let byte = *b.get(*i)?;
        *i += 1;
        valor |= u64::from(byte & 0x7f) << deslocamento;
        if byte < 0x80 { return Some(valor); }
    }
    None
}

/// Campos de primeiro nível; `None` se os bytes não forem uma mensagem protobuf inteira.
fn campos(b: &[u8]) -> Option<Vec<(u64, Valor<'_>)>> {
    let mut i = 0;
    let mut saida = Vec::new();
    while i < b.len() {
        let chave = varint(b, &mut i)?;
        let (campo, tipo) = (chave >> 3, chave & 7);
        if campo == 0 { return None; }
        match tipo {
            0 => saida.push((campo, Valor::Int(varint(b, &mut i)?))),
            1 => i += 8,
            5 => i += 4,
            2 => {
                let n = usize::try_from(varint(b, &mut i)?).ok()?;
                let fim = i.checked_add(n).filter(|fim| *fim <= b.len())?;
                saida.push((campo, Valor::Bytes(&b[i..fim])));
                i = fim;
            }
            _ => return None,
        }
    }
    (i == b.len()).then_some(saida)
}

/// Bytes no caminho de campos (o primeiro que existir em cada nível).
fn em<'a>(b: &'a [u8], caminho: &[u64]) -> Option<&'a [u8]> {
    let (primeiro, resto) = caminho.split_first()?;
    let achado = campos(b)?.into_iter().find_map(|(campo, valor)| match valor {
        Valor::Bytes(bytes) if campo == *primeiro => Some(bytes),
        _ => None,
    })?;
    if resto.is_empty() { Some(achado) } else { em(achado, resto) }
}

fn inteiro(b: &[u8], caminho: &[u64]) -> Option<u64> {
    let (ultimo, pais) = caminho.split_last()?;
    let mensagem = if pais.is_empty() { b } else { em(b, pais)? };
    campos(mensagem)?.into_iter().find_map(|(campo, valor)| match valor {
        Valor::Int(n) if campo == *ultimo => Some(n),
        _ => None,
    })
}

fn texto(b: &[u8], caminho: &[u64]) -> Option<String> {
    em(b, caminho).and_then(|bytes| std::str::from_utf8(bytes).ok()).map(str::to_owned)
}

fn hora(payload: &[u8]) -> Option<String> {
    let segundos = i64::try_from(inteiro(payload, &[5, 1, 1])?).ok()?;
    let nanos = inteiro(payload, &[5, 1, 2]).and_then(|n| u32::try_from(n).ok()).unwrap_or(0);
    chrono::DateTime::from_timestamp(segundos, nanos).map(|d| d.to_rfc3339())
}

/// O resumo que a própria CLI mostra da ação (`toolSummary`, senão `toolAction`), dos pares em `140.1`.
fn resumo_da_acao(payload: &[u8]) -> Option<String> {
    let bloco = em(payload, &[140])?;
    let pares: Vec<(String, String)> = campos(bloco)?.into_iter().filter_map(|(campo, valor)| match valor {
        Valor::Bytes(par) if campo == 1 => Some((texto(par, &[1])?, texto(par, &[2])?)),
        _ => None,
    }).collect();
    ["toolSummary", "toolAction"].iter().find_map(|chave| pares.iter().find(|(k, _)| k == chave).map(|(_, v)| v.clone()))
}

fn abrir(caminho: &Path) -> rusqlite::Result<Connection> {
    // Só leitura: o agy continua gravando no mesmo arquivo enquanto a conversa está aberta.
    Connection::open_with_flags(caminho, OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX)
}

/// Itens da conversa na ordem dos passos, no formato do feed do Claude/Codex.
pub fn itens(db: &Path) -> std::io::Result<Vec<Entry>> {
    let erro = |e: rusqlite::Error| std::io::Error::other(e.to_string());
    let conexao = abrir(db).map_err(erro)?;
    let base = db.file_stem().map(|s| s.to_string_lossy().into_owned()).unwrap_or_default();
    let mut consulta = conexao.prepare("SELECT idx, step_type, step_payload FROM steps ORDER BY idx").map_err(erro)?;
    let linhas = consulta.query_map([], |linha| Ok((linha.get::<_, i64>(0)?, linha.get::<_, i64>(1)?, linha.get::<_, Option<Vec<u8>>>(2)?)))
        .map_err(erro)?;
    let mut saida = Vec::new();
    for linha in linhas {
        let (idx, tipo, payload) = linha.map_err(erro)?;
        let Some(payload) = payload else { continue };
        let item = |kind: Kind, role: &str, text: String, tool: Option<String>| Item {
            kind, role: role.into(), text, tool, timestamp: hora(&payload), imagens: 0, diff: None,
        };
        let novo = match tipo {
            PASSO_USUARIO => texto(&payload, &[19, 2]).filter(|t| !t.trim().is_empty())
                .map(|t| if t.starts_with('/') { item(Kind::Command, "user", t, None) } else { item(Kind::Text, "user", t, None) }),
            PASSO_RESPOSTA => texto(&payload, &[20, 1]).filter(|t| !t.trim().is_empty())
                .map(|t| item(Kind::Text, "assistant", t, None)),
            _ => texto(&payload, &[5, 4, 2]).map(|ferramenta| {
                let detalhe = resumo_da_acao(&payload).or_else(|| texto(&payload, &[5, 4, 3])).unwrap_or_default();
                item(Kind::Tool, "assistant", crate::feed::curto(&detalhe), Some(ferramenta))
            }),
        };
        if let Some(item) = novo { saida.push(Entry { identity: format!("antigravity:{base}#{idx}"), item }); }
    }
    Ok(saida)
}

/// Log próprio de cada sessão do OMNI: o agy abre com `--log-file` apontando para cá, e é por ele que
/// se sabe **qual** conversa aquela sessão está mostrando (a mesma pasta pode ter vários agy abertos).
pub fn log_da_sessao(config_dir: &Path, sessao: &str) -> PathBuf {
    config_dir.join("log").join(format!("omni-{sessao}.log"))
}

/// A conversa na tela do agy, pelo log dele: a última "Starting conversation update stream for <id>"
/// (ou "Created conversation <id>"). Cobre conversa nova, `/clear` e `/resume` na mesma sessão.
pub fn conversa_do_log(log: &Path) -> Option<String> {
    let texto = String::from_utf8_lossy(&std::fs::read(log).ok()?).into_owned();
    texto.lines().rev().find_map(|linha| {
        let resto = linha.split_once("Starting conversation update stream for ").or_else(|| linha.split_once("Created conversation "))?.1;
        let id: String = resto.chars().take_while(|c| c.is_ascii_hexdigit() || *c == '-').collect();
        (id.len() >= 32).then_some(id)
    })
}

/// O `.db` da conversa que a sessão `sessao` mostra agora, se o log dela já disser qual é.
pub fn conversa_da_sessao(config_dir: &Path, sessao: &str) -> Option<(String, PathBuf)> {
    let id = conversa_do_log(&log_da_sessao(config_dir, sessao))?;
    let caminho = config_dir.join("conversations").join(format!("{id}.db"));
    caminho.is_file().then_some((id, caminho))
}

/// Esforços na ordem em que aparecem no seletor. No agy o esforço é o fim do nome do modelo
/// (`gemini-4-argon-high`) e `--model <família> --effort <nível>` escolhe a variante — conferido na
/// 1.4.2, que recusa esforço inexistente dizendo quais existem.
pub const ESFORCOS: [&str; 5] = ["low", "medium", "high", "xhigh", "max"];

/// Uma família de modelos do `agy models` com os esforços que ela tem.
#[derive(Debug, Clone, PartialEq)]
pub struct Familia { pub id: String, pub label: String, pub esforcos: Vec<String> }

/// `gemini-4-argon-high` → (`gemini-4-argon`, `high`). Sem sufixo de esforço, o slug é a família.
pub fn familia_e_esforco(slug: &str) -> (String, Option<String>) {
    ESFORCOS.iter().find_map(|e| slug.strip_suffix(&format!("-{e}")).map(|familia| (familia.to_owned(), Some((*e).to_owned()))))
        .unwrap_or_else(|| (slug.to_owned(), None))
}

/// Linhas `slug<TAB>Nome (Esforço)` do `agy models`, como (slug, nome).
pub fn variantes(saida: &str) -> Vec<(String, String)> {
    saida.lines().filter_map(|linha| {
        let (slug, nome) = linha.split_once('\t')?;
        let slug = slug.trim();
        (!slug.is_empty() && slug.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '.' || c == '_'))
            .then(|| (slug.to_owned(), nome.trim().to_owned()))
    }).collect()
}

/// Famílias na ordem do `agy models`, cada uma com os esforços que existem para ela.
pub fn familias(saida: &str) -> Vec<Familia> {
    let mut lista: Vec<Familia> = Vec::new();
    for (slug, nome) in variantes(saida) {
        let (id, esforco) = familia_e_esforco(&slug);
        let label = nome.rsplit_once(" (").filter(|_| esforco.is_some()).map_or(nome.as_str(), |(base, _)| base).to_owned();
        let familia = match lista.iter_mut().find(|f| f.id == id) {
            Some(f) => f,
            None => { lista.push(Familia { id, label, esforcos: Vec::new() }); lista.last_mut().expect("acabou de entrar") }
        };
        if let Some(e) = esforco { familia.esforcos.push(e); }
    }
    for familia in &mut lista { familia.esforcos.sort_by_key(|e| ESFORCOS.iter().position(|x| x == e)); }
    lista
}

/// Modelo em uso na sessão, pelo log dela (`label="Gemini 4 Argon (Medium)"`), como (família, esforço).
pub fn modelo_da_sessao(config_dir: &Path, sessao: &str, saida_models: &str) -> Option<(String, Option<String>)> {
    let texto = String::from_utf8_lossy(&std::fs::read(log_da_sessao(config_dir, sessao)).ok()?).into_owned();
    let nome = texto.lines().rev().find_map(|linha| linha.split_once("label=\"")?.1.split_once('"').map(|(n, _)| n.to_owned()))?;
    variantes(saida_models).into_iter().find(|(_, n)| *n == nome).map(|(slug, _)| familia_e_esforco(&slug))
}

/// `file:///D:/a%20b` → `d:/a b` (minúsculo, `/`, sem barra no fim) para comparar com o `cwd`.
fn pasta_normalizada(caminho: &str) -> String {
    let sem_esquema = caminho.strip_prefix("file://").unwrap_or(caminho);
    let mut bytes = Vec::with_capacity(sem_esquema.len());
    let mut iter = sem_esquema.bytes();
    while let Some(b) = iter.next() {
        if b == b'%' {
            let par: Vec<u8> = iter.by_ref().take(2).collect();
            match std::str::from_utf8(&par).ok().and_then(|h| u8::from_str_radix(h, 16).ok()) {
                Some(decodificado) => bytes.push(decodificado),
                None => { bytes.push(b'%'); bytes.extend(par); }
            }
        } else { bytes.push(b); }
    }
    let texto = String::from_utf8_lossy(&bytes).replace('\\', "/");
    // `/D:/x` (URI no Windows) → `D:/x`.
    let texto = match texto.as_bytes() { [b'/', _, b':', ..] => texto[1..].to_owned(), _ => texto };
    texto.trim_end_matches('/').to_lowercase()
}

/// A conversa do agy aberta numa sessão do OMNI: a primeira criada na pasta `cwd` depois que a
/// sessão começou. O agy só cria o arquivo na primeira mensagem, então antes disso é `None`.
/// ponytail: duas sessões do agy na mesma pasta abertas no mesmo minuto podem trocar de conversa;
/// e um `/clear` (conversa nova na mesma sessão) segue mostrando a primeira.
pub fn descobrir(config_dir: &Path, cwd: &str, desde_ms: u64) -> Option<(String, PathBuf)> {
    let indice = abrir(&config_dir.join("conversation_summaries.db")).ok()?;
    let alvo = pasta_normalizada(cwd);
    let mut consulta = indice.prepare("SELECT conversation_id, workspace_uris FROM conversation_summaries").ok()?;
    let candidatos: Vec<(String, String)> = consulta.query_map([], |l| Ok((l.get(0)?, l.get(1)?))).ok()?
        .filter_map(Result::ok).collect();
    candidatos.into_iter()
        .filter(|(_, uris)| serde_json::from_str::<Vec<String>>(uris).unwrap_or_default().iter().any(|u| pasta_normalizada(u) == alvo))
        .filter_map(|(id, _)| {
            let caminho = config_dir.join("conversations").join(format!("{id}.db"));
            let meta = std::fs::metadata(&caminho).ok()?;
            let criado = meta.created().or_else(|_| meta.modified()).ok()?
                .duration_since(std::time::UNIX_EPOCH).ok()?.as_millis() as u64;
            // Folga para o relógio do arquivo e o do engine não baterem no milissegundo.
            (criado + 10_000 >= desde_ms).then_some((criado, id, caminho))
        })
        .min_by_key(|(criado, ..)| *criado)
        .map(|(_, id, caminho)| (id, caminho))
}

/// Põe `cwd` em `trustedWorkspaces` do `settings.json`: sem isso o agy abre perguntando se confia na
/// pasta, e na visão Conversa (ou numa sessão oculta) ninguém vê a pergunta.
pub fn confiar(config_dir: &Path, cwd: &str) -> std::io::Result<()> {
    let caminho = config_dir.join("settings.json");
    let mut dados: serde_json::Value = std::fs::read_to_string(&caminho).ok()
        .and_then(|texto| serde_json::from_str(&texto).ok())
        .filter(serde_json::Value::is_object)
        .unwrap_or_else(|| serde_json::json!({}));
    let pasta = cwd.trim_end_matches(['\\', '/']).to_owned();
    let lista = dados.as_object_mut().expect("objeto garantido acima")
        .entry("trustedWorkspaces").or_insert_with(|| serde_json::json!([]));
    if !lista.is_array() { *lista = serde_json::json!([]); }
    let lista = lista.as_array_mut().expect("lista garantida acima");
    if lista.iter().any(|item| item.as_str().is_some_and(|p| pasta_normalizada(p) == pasta_normalizada(&pasta))) { return Ok(()); }
    lista.push(serde_json::json!(pasta));
    std::fs::create_dir_all(config_dir)?;
    std::fs::write(&caminho, serde_json::to_string_pretty(&dados).map_err(std::io::Error::other)?)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn chave(campo: u64, tipo: u64) -> Vec<u8> { varint_bytes((campo << 3) | tipo) }
    fn varint_bytes(mut n: u64) -> Vec<u8> {
        let mut saida = Vec::new();
        loop { let b = (n & 0x7f) as u8; n >>= 7; if n == 0 { saida.push(b); return saida; } saida.push(b | 0x80); }
    }
    fn bytes(campo: u64, conteudo: &[u8]) -> Vec<u8> {
        let mut saida = chave(campo, 2); saida.extend(varint_bytes(conteudo.len() as u64)); saida.extend(conteudo); saida
    }
    fn int(campo: u64, n: u64) -> Vec<u8> { let mut saida = chave(campo, 0); saida.extend(varint_bytes(n)); saida }
    fn quando(segundos: u64) -> Vec<u8> { bytes(5, &bytes(1, &int(1, segundos))) }

    /// Passos como o agy 1.4.2 grava (campos conferidos num `.db` real): mensagem, resposta e uma
    /// ação com o resumo que a tela mostra.
    #[test]
    fn le_mensagens_respostas_e_acoes_do_sqlite() {
        let dir = tempfile::tempdir().unwrap();
        let db = dir.path().join("abc.db");
        let conexao = Connection::open(&db).unwrap();
        conexao.execute_batch("CREATE TABLE steps (idx integer, step_type integer, status integer, step_payload blob)").unwrap();
        let usuario = [int(1, 14), quando(1_792_376_704), bytes(19, &[bytes(2, "boa noite".as_bytes()), bytes(3, &bytes(1, b"boa noite"))].concat())].concat();
        let resposta = [int(1, 15), quando(1_792_376_715), bytes(20, &bytes(1, "Boa noite! Como posso ajudar?".as_bytes()))].concat();
        let acao = [int(1, 132), [bytes(5, &[bytes(1, &int(1, 1_792_376_800)), bytes(4, &[bytes(1, b"call_1"), bytes(2, b"ask_question"), bytes(3, b"{}")].concat())].concat())].concat(),
            bytes(140, &[bytes(1, &[bytes(1, b"toolAction"), bytes(2, b"Asking a question")].concat()), bytes(1, &[bytes(1, b"toolSummary"), bytes(2, b"User preference question")].concat())].concat())].concat();
        for (idx, (tipo, payload)) in [(14, usuario), (15, resposta), (132, acao)].into_iter().enumerate() {
            conexao.execute("INSERT INTO steps VALUES (?1, ?2, 3, ?3)", rusqlite::params![idx as i64, tipo, payload]).unwrap();
        }
        let itens = itens(&db).unwrap();
        let resumo: Vec<_> = itens.iter().map(|e| (e.item.role.as_str(), e.item.kind.clone(), e.item.text.as_str(), e.item.tool.as_deref())).collect();
        assert_eq!(resumo, vec![
            ("user", Kind::Text, "boa noite", None),
            ("assistant", Kind::Text, "Boa noite! Como posso ajudar?", None),
            ("assistant", Kind::Tool, "User preference question", Some("ask_question")),
        ]);
        assert_eq!(itens[0].item.timestamp.as_deref(), Some("2026-10-19T02:25:04+00:00"));
        assert_eq!(itens[2].identity, "antigravity:abc#2");
    }

    /// Linhas reais do log do agy 1.4.2: conversa nova e, depois, outra (como um `/clear`).
    #[test]
    fn conversa_da_sessao_vem_do_log_dela() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(dir.path().join("log")).unwrap();
        std::fs::create_dir_all(dir.path().join("conversations")).unwrap();
        let log = log_da_sessao(dir.path(), "terminal-1");
        std::fs::write(&log, "I1018 23:11:59.462382     724 server.go:1199] Created conversation cb263780-1ee6-4121-9ebd-c820dcb9460b (backend=X)\n\
            I1018 23:11:59.462382     724 server.go:1217] Starting conversation update stream for cb263780-1ee6-4121-9ebd-c820dcb9460b\n\
            I1018 23:52:55.497085     769 server.go:1199] Created conversation b3ae26c1-84a6-45bd-be3e-0ba4395809c5 (backend=X)\n").unwrap();
        assert_eq!(conversa_do_log(&log).as_deref(), Some("b3ae26c1-84a6-45bd-be3e-0ba4395809c5"));
        assert!(conversa_da_sessao(dir.path(), "terminal-1").is_none(), "sem o .db ainda");
        std::fs::write(dir.path().join("conversations").join("b3ae26c1-84a6-45bd-be3e-0ba4395809c5.db"), b"").unwrap();
        assert!(conversa_da_sessao(dir.path(), "terminal-1").unwrap().1.ends_with("b3ae26c1-84a6-45bd-be3e-0ba4395809c5.db"));
        assert!(conversa_da_sessao(dir.path(), "terminal-2").is_none());
    }

    /// Saída real do `agy models` (1.4.2), recortada.
    const MODELS: &str = "Fetching available models...\ngemini-4-argon-medium\tGemini 4 Argon (Medium)\ngemini-4-argon-high\tGemini 4 Argon (High)\ngemini-4-argon-low\tGemini 4 Argon (Low)\nclaude-opus-5-5-low\tClaude Opus 5.5 (Low)\nclaude-opus-5-5-high\tClaude Opus 5.5 (High)\ngpt-oss-120b-medium\tGPT-OSS 120B (Medium)\n";

    #[test]
    fn familias_e_modelo_atual_do_agy() {
        assert_eq!(familias(MODELS), vec![
            Familia { id: "gemini-4-argon".into(), label: "Gemini 4 Argon".into(), esforcos: vec!["low".into(), "medium".into(), "high".into()] },
            Familia { id: "claude-opus-5-5".into(), label: "Claude Opus 5.5".into(), esforcos: vec!["low".into(), "high".into()] },
            Familia { id: "gpt-oss-120b".into(), label: "GPT-OSS 120B".into(), esforcos: vec!["medium".into()] },
        ]);
        let dir = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(dir.path().join("log")).unwrap();
        std::fs::write(log_da_sessao(dir.path(), "t1"), "I1018 23:12:08 model_config_manager.go:340] Propagating selected model override to backend: label=\"Gemini 4 Argon (Medium)\"\n\
            I1019 00:10:00 model_config_manager.go:340] Propagating selected model override to backend: label=\"Claude Opus 5.5 (High)\"\n").unwrap();
        assert_eq!(modelo_da_sessao(dir.path(), "t1", MODELS), Some(("claude-opus-5-5".into(), Some("high".into()))));
        assert_eq!(modelo_da_sessao(dir.path(), "t2", MODELS), None);
    }

    #[test]
    fn acha_a_conversa_pela_pasta_e_confia_na_pasta() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(dir.path().join("conversations")).unwrap();
        let indice = Connection::open(dir.path().join("conversation_summaries.db")).unwrap();
        indice.execute_batch("CREATE TABLE conversation_summaries (conversation_id text, workspace_uris text)").unwrap();
        for (id, uri) in [("outra", "file:///C:/Users/Felipe%20Campos"), ("certa", "file:///D:/Projetos/OMNI")] {
            indice.execute("INSERT INTO conversation_summaries VALUES (?1, ?2)", [id, &format!("[\"{uri}\"]")]).unwrap();
            std::fs::write(dir.path().join("conversations").join(format!("{id}.db")), b"").unwrap();
        }
        let (id, caminho) = descobrir(dir.path(), "D:\\Projetos\\OMNI\\", 0).unwrap();
        assert_eq!(id, "certa");
        assert!(caminho.ends_with("certa.db"));
        assert!(descobrir(dir.path(), "D:\\Projetos\\OMNI", u64::MAX / 2).is_none(), "conversa de antes da sessão não é dela");

        std::fs::write(dir.path().join("settings.json"), r#"{"trustedWorkspaces":["C:\\Users\\Felipe Campos"],"x":1}"#).unwrap();
        confiar(dir.path(), "D:\\Projetos\\OMNI\\").unwrap();
        confiar(dir.path(), "d:/projetos/omni").unwrap();
        let salvo: serde_json::Value = serde_json::from_str(&std::fs::read_to_string(dir.path().join("settings.json")).unwrap()).unwrap();
        assert_eq!(salvo["trustedWorkspaces"], serde_json::json!(["C:\\Users\\Felipe Campos", "D:\\Projetos\\OMNI"]));
        assert_eq!(salvo["x"], 1);
    }
}
