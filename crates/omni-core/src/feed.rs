//! O que aconteceu numa conversa, na ordem: texto do usuário e do agente **e** as ações do agente
//! (ler arquivo, rodar comando, editar), lido do transcript que a própria CLI grava.
//!
//! Antes só o texto chegava ao celular e à web. Entre uma resposta e outra o agente podia passar
//! minutos lendo e editando arquivos sem nada aparecer — no terminal do PC você vê cada passo.
//!
//! A leitura é **incremental**: transcript de CLI só cresce, então o cache guarda até onde o arquivo
//! já foi lido e a próxima chamada parseia só o pedaço novo. A web consulta a conversa aberta a cada
//! 1,5 s; reler um `.jsonl` de vários MB a cada vez era o maior custo do servidor.

use serde::Serialize;
use serde_json::Value;
use std::{
    collections::HashMap,
    fs::File,
    io::{BufRead, BufReader, Read, Seek, SeekFrom},
    path::{Path, PathBuf},
};

/// Tipo do item. `text` é fala; `tool` é uma ação do agente; `command` é um `/comando` do usuário;
/// `notice` é um aviso da CLI (interrupção, compactação).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Kind {
    Text,
    Tool,
    Command,
    Notice,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Item {
    pub kind: Kind,
    /// `user` ou `assistant`. Ação e aviso são do agente; comando é do usuário.
    pub role: String,
    pub text: String,
    /// Nome da ferramenta (`Bash`, `Read`, `Shell`…), só em `kind: tool`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool: Option<String>,
    pub timestamp: Option<String>,
    /// Imagens coladas na mensagem do usuário. A CLI as guarda dentro do transcript (base64) e deixa
    /// só `[Image #N]` no texto; o conteúdo vem sob demanda por [`imagem`].
    #[serde(skip_serializing_if = "sem_imagens")]
    pub imagens: usize,
    /// O que uma edição mudou (`Edit`, `Write`, `apply_patch`…): contagem exata e as linhas.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub diff: Option<Diff>,
}

/// Linhas com `+`, `-` ou ` ` na frente, como um patch. `mais`/`menos` contam tudo; `linhas` para em
/// [`DIFF_LINHAS`] (`cortado` avisa).
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Diff {
    pub mais: usize,
    pub menos: usize,
    pub linhas: Vec<String>,
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    pub cortado: bool,
}

// ponytail: as linhas vão junto com a página da conversa; rota sob demanda (como as imagens) se pesar.
const DIFF_LINHAS: usize = 80;
const DIFF_LINHA_MAX: usize = 200;
/// Acima disso o LCS (n×m) fica caro: vira "tudo saiu, tudo entrou".
const DIFF_LCS_MAX: usize = 4_000_000;

impl Diff {
    fn de_linhas(linhas: impl IntoIterator<Item = String>) -> Option<Diff> {
        let mut diff = Diff { mais: 0, menos: 0, linhas: Vec::new(), cortado: false };
        for linha in linhas {
            match linha.as_bytes().first() { Some(b'+') => diff.mais += 1, Some(b'-') => diff.menos += 1, _ => {} }
            if diff.linhas.len() < DIFF_LINHAS { diff.linhas.push(linha.chars().take(DIFF_LINHA_MAX).collect()) } else { diff.cortado = true }
        }
        (diff.mais + diff.menos > 0).then_some(diff)
    }
}

/// Diff de linhas entre o trecho antigo e o novo (LCS), com o contexto em comum.
fn diff_de_trechos(pares: &[(&str, &str)]) -> Option<Diff> {
    let mut saida = Vec::new();
    for (antes, depois) in pares {
        let a: Vec<&str> = antes.lines().collect();
        let b: Vec<&str> = depois.lines().collect();
        if a.len() * b.len() > DIFF_LCS_MAX {
            saida.extend(a.iter().map(|l| format!("-{l}")));
            saida.extend(b.iter().map(|l| format!("+{l}")));
            continue;
        }
        // tabela[i][j] = LCS de a[i..] e b[j..]
        let mut tabela = vec![vec![0u32; b.len() + 1]; a.len() + 1];
        for i in (0..a.len()).rev() {
            for j in (0..b.len()).rev() {
                tabela[i][j] = if a[i] == b[j] { tabela[i + 1][j + 1] + 1 } else { tabela[i + 1][j].max(tabela[i][j + 1]) };
            }
        }
        let (mut i, mut j) = (0, 0);
        while i < a.len() || j < b.len() {
            if i < a.len() && j < b.len() && a[i] == b[j] { saida.push(format!(" {}", a[i])); i += 1; j += 1; }
            else if i < a.len() && (j == b.len() || tabela[i + 1][j] >= tabela[i][j + 1]) { saida.push(format!("-{}", a[i])); i += 1; }
            else { saida.push(format!("+{}", b[j])); j += 1; }
        }
    }
    Diff::de_linhas(saida)
}

fn diff_claude(nome: &str, input: &Value) -> Option<Diff> {
    let texto = |v: &Value, k: &str| v[k].as_str().unwrap_or("").to_owned();
    match nome {
        "Edit" => diff_de_trechos(&[(&texto(input, "old_string"), &texto(input, "new_string"))]),
        "MultiEdit" => {
            let pares: Vec<(String, String)> = input["edits"].as_array()?.iter()
                .map(|e| (texto(e, "old_string"), texto(e, "new_string"))).collect();
            diff_de_trechos(&pares.iter().map(|(a, b)| (a.as_str(), b.as_str())).collect::<Vec<_>>())
        }
        "Write" => Diff::de_linhas(input["content"].as_str()?.lines().map(|l| format!("+{l}"))),
        _ => None,
    }
}

/// Patch do Codex (`*** Begin Patch`): as linhas `+`/`-`/` ` já vêm prontas.
fn diff_de_patch(patch: &str) -> Option<Diff> {
    Diff::de_linhas(patch.lines()
        .filter(|l| !l.starts_with("***") && !l.starts_with("@@") && matches!(l.as_bytes().first(), Some(b'+' | b'-' | b' ')))
        .map(str::to_owned))
}

fn sem_imagens(n: &usize) -> bool { *n == 0 }

/// Item com a identidade usada para não repetir a mesma mensagem quando a troca de conta copia o
/// transcript inteiro para a outra conta (o Claude preserva o `uuid`).
#[derive(Debug, Clone)]
pub struct Entry {
    pub identity: String,
    pub item: Item,
}

/// Teto do detalhe de uma ação. A tela corta com reticências; o texto inteiro fica no tooltip.
const DETALHE_MAX: usize = 400;

pub(crate) fn curto(texto: &str) -> String {
    let linha = texto.lines().map(str::trim).find(|linha| !linha.is_empty()).unwrap_or("");
    let mut saida: String = linha.chars().take(DETALHE_MAX).collect();
    if linha.chars().count() > DETALHE_MAX || texto.trim().lines().count() > 1 {
        saida.push('…');
    }
    saida
}

/// `cd "D:/projeto" && npm test` → `npm test`. O agente costuma prefixar o comando com a pasta, e
/// numa linha curta isso empurrava para fora justamente o que ele rodou.
fn sem_cd_inicial(comando: &str) -> &str {
    let mut resto = comando.trim_start();
    while let Some(depois) = resto.strip_prefix("cd ") {
        let Some(fim) = ["&&", ";"].iter().filter_map(|sep| depois.find(sep).map(|i| (i, sep.len()))).min() else { break };
        let seguinte = depois[fim.0 + fim.1..].trim_start();
        if seguinte.is_empty() { break; }
        resto = seguinte;
    }
    resto
}

fn comando_curto(comando: &str) -> String {
    curto(sem_cd_inicial(comando))
}

fn texto_de(valor: &Value, chave: &str) -> Option<String> {
    valor.get(chave)?.as_str().map(str::trim).filter(|s| !s.is_empty()).map(str::to_owned)
}

/// Uma ação do Claude (`tool_use`) em uma linha legível: o que foi feito, não o JSON da chamada.
fn ferramenta_claude(nome: &str, input: &Value) -> Option<(String, String)> {
    let detalhe = match nome {
        // O comando, como o terminal do PC mostra (`Bash(npm test)`); a descrição é o plano B.
        "Bash" | "PowerShell" => texto_de(input, "command").map(|c| sem_cd_inicial(&c).to_owned()).or_else(|| texto_de(input, "description")),
        "Read" | "Edit" | "MultiEdit" | "Write" | "NotebookEdit" => texto_de(input, "file_path").or_else(|| texto_de(input, "notebook_path")),
        "Grep" => texto_de(input, "pattern").map(|p| match texto_de(input, "path") { Some(onde) => format!("{p} em {onde}"), None => p }),
        "Glob" => texto_de(input, "pattern"),
        "WebFetch" => texto_de(input, "url"),
        "WebSearch" => texto_de(input, "query"),
        "Task" | "Agent" => texto_de(input, "description"),
        "TodoWrite" => Some("Atualizou a lista de tarefas".into()),
        "Skill" => texto_de(input, "skill"),
        // Ferramentas de controle da própria CLI: não são trabalho visível.
        "ToolSearch" | "ExitPlanMode" | "EnterPlanMode" => return None,
        _ => input.as_object().and_then(|campos| campos.values().find_map(|v| v.as_str().map(str::to_owned))),
    };
    Some((nome.to_owned(), curto(&detalhe.unwrap_or_default())))
}

/// Desfaz o escape de uma string JSON achada dentro de outro texto (o `input` do `exec` do Codex é
/// código JavaScript com um objeto JSON no meio).
fn string_json_em(texto: &str, chave: &str) -> Option<String> {
    let marcador = format!("\"{chave}\":\"");
    let inicio = texto.find(&marcador)? + marcador.len();
    let mut fim = inicio;
    let bytes = texto.as_bytes();
    while fim < bytes.len() {
        match bytes[fim] {
            b'\\' => fim += 2,
            b'"' => break,
            _ => fim += 1,
        }
    }
    serde_json::from_str::<String>(&format!("\"{}\"", texto.get(inicio..fim)?)).ok()
}

/// Uma ação do Codex. O Codex grava `function_call`/`custom_tool_call` com argumentos em texto.
fn ferramenta_codex(payload: &Value) -> Option<(String, String)> {
    let nome = payload["name"].as_str().unwrap_or("");
    match payload["type"].as_str()? {
        "custom_tool_call" => {
            let input = payload["input"].as_str().unwrap_or("");
            if nome == "exec" {
                let comando = string_json_em(input, "cmd").or_else(|| string_json_em(input, "command"))?;
                return Some(("Shell".into(), comando_curto(&comando)));
            }
            if input.trim_start().starts_with("*** Begin Patch") || nome == "apply_patch" {
                let arquivos: Vec<_> = input.lines()
                    .filter_map(|linha| ["*** Update File: ", "*** Add File: ", "*** Delete File: "].iter()
                        .find_map(|prefixo| linha.strip_prefix(prefixo)))
                    .collect();
                return Some(("Edit".into(), curto(&arquivos.join(", "))));
            }
            Some((nome.to_owned(), curto(input)))
        }
        "function_call" => {
            // Espera por saída de um comando já mostrado: repetir a linha só polui.
            if matches!(nome, "wait" | "write_stdin" | "read_stdout") { return None; }
            let args: Value = serde_json::from_str(payload["arguments"].as_str().unwrap_or("{}")).unwrap_or(Value::Null);
            let detalhe = match nome {
                "shell" | "exec_command" | "container.exec" => args["command"].as_array()
                    .map(|partes| partes.iter().filter_map(Value::as_str).collect::<Vec<_>>().join(" "))
                    .or_else(|| texto_de(&args, "cmd"))
                    .or_else(|| texto_de(&args, "command")),
                "update_plan" => Some("Atualizou o plano".into()),
                _ => args.as_object().and_then(|campos| campos.values().find_map(|v| v.as_str().map(str::to_owned))),
            };
            let rotulo = if matches!(nome, "shell" | "exec_command" | "container.exec") { "Shell" } else { nome };
            Some((rotulo.to_owned(), comando_curto(&detalhe.unwrap_or_default())))
        }
        "local_shell_call" => {
            let comando = payload["action"]["command"].as_array()
                .map(|partes| partes.iter().filter_map(Value::as_str).collect::<Vec<_>>().join(" "))?;
            Some(("Shell".into(), comando_curto(&comando)))
        }
        _ => None,
    }
}

/// `<command-name>/usage</command-name><command-args>x</command-args>` → `/usage x`.
fn comando_digitado(texto: &str) -> Option<String> {
    let entre = |abre: &str, fecha: &str| -> Option<String> {
        let inicio = texto.find(abre)? + abre.len();
        let fim = texto[inicio..].find(fecha)? + inicio;
        Some(texto[inicio..fim].trim().to_owned())
    };
    let nome = entre("<command-name>", "</command-name>")?;
    let args = entre("<command-args>", "</command-args>").unwrap_or_default();
    Some(if args.is_empty() { nome } else { format!("{nome} {args}") })
}

/// A CLI grava o texto colado no terminal embrulhado em `<pasted_content id="…">…</pasted_content id="…">`.
/// É fala do usuário, não texto injetado: sem desembrulhar, uma mensagem que era só texto colado
/// começava com `<`, sumia da conversa e a web acusava "não consegui confirmar o envio".
pub fn sem_colado(texto: &str) -> String {
    if !texto.contains("pasted_content") { return texto.to_owned(); }
    let mut saida = String::with_capacity(texto.len());
    let mut resto = texto;
    while let Some(inicio) = resto.find("<pasted_content").into_iter().chain(resto.find("</pasted_content")).min() {
        let Some(fim) = resto[inicio..].find('>') else { break };
        saida.push_str(&resto[..inicio]);
        let depois = &resto[inicio + fim + 1..];
        // A quebra de linha que a CLI põe colada na marca sai junto com ela.
        let fechando = resto[inicio..].starts_with("</");
        if fechando && saida.ends_with('\n') { saida.pop(); }
        resto = if !fechando { depois.strip_prefix('\n').unwrap_or(depois) } else { depois };
    }
    saida.push_str(resto);
    saida
}

/// Sem os `[Image #N]` que a CLI deixa no lugar da imagem colada. Para títulos e histórico: o nome
/// da conversa era "[Image #1]bom dia…". O chat mostra a imagem de verdade (`Item::imagens`).
pub fn sem_marcas_de_imagem(texto: &str) -> String {
    let mut saida = String::with_capacity(texto.len());
    let mut resto = texto;
    while let Some(inicio) = resto.find("[Image #") {
        let depois = &resto[inicio + 8..];
        let digitos = depois.chars().take_while(char::is_ascii_digit).count();
        saida.push_str(&resto[..inicio]);
        if digitos > 0 && depois[digitos..].starts_with(']') {
            resto = &depois[digitos + 1..];
        } else {
            saida.push_str("[Image #");
            resto = depois;
        }
    }
    saida.push_str(resto);
    saida.trim().to_owned()
}

/// Texto que a CLI grava como se fosse do usuário: lembrete de sistema, saída de comando `/x`,
/// contexto de ambiente, AGENTS.md do Codex. No terminal ele não aparece; aqui também não.
pub fn injetado(texto: &str) -> bool {
    let texto = texto.trim_start();
    texto.starts_with('<') || texto.starts_with("# AGENTS.md") || texto.starts_with("Caveat:")
}

fn conteudo_texto(message: &Value) -> Option<String> {
    if let Some(texto) = message["content"].as_str() { return Some(texto.to_owned()); }
    let partes: Vec<_> = message["content"].as_array()?.iter()
        .filter(|bloco| matches!(bloco["type"].as_str(), Some("text" | "input_text" | "output_text")))
        .filter_map(|bloco| bloco["text"].as_str())
        .collect();
    (!partes.is_empty()).then(|| partes.join("\n"))
}

fn blocos_de_imagem(message: &Value) -> impl Iterator<Item = &Value> {
    message["content"].as_array().into_iter().flatten()
        .filter(|bloco| bloco["type"] == "image" && bloco["source"]["type"] == "base64")
}

/// A imagem `k` da mensagem `n` (a mesma numeração do timeline: `fontes` na ordem dos segmentos,
/// sem repetir identidade). Devolve `(tipo, base64)`. Lê só a linha da mensagem de novo.
/// Se o item é de até `limite` (ms). Sem limite ou sem hora no item, vale — ver
/// `Segment::historico_ate_ms`.
pub fn ate(item: &Item, limite: Option<u64>) -> bool {
    let Some(limite) = limite else { return true };
    item.timestamp.as_deref().and_then(|t| chrono::DateTime::parse_from_rfc3339(t).ok())
        .is_none_or(|hora| hora.timestamp_millis() <= limite as i64)
}

pub fn imagem(fontes: &[(PathBuf, String, Option<u64>)], n: usize, k: usize, cache: &mut FeedCache) -> Option<(String, String)> {
    let mut vistos = std::collections::HashSet::new();
    let mut indice = 0;
    for (caminho, provider, limite) in fontes {
        let Ok(entradas) = cache.read(caminho, provider) else { continue };
        let mut alvo = None;
        for entrada in entradas {
            if !ate(&entrada.item, *limite) { continue; }
            if !vistos.insert(entrada.identity.clone()) { continue; }
            if indice == n { alvo = Some(entrada.clone()); break; }
            indice += 1;
        }
        let Some(entrada) = alvo else { continue };
        if entrada.item.imagens <= k { return None; }
        if entrada.item.role == "assistant" {
            use base64::Engine as _;
            let caminho = caminhos_de_imagem(&entrada.item.text).into_iter().nth(k)?;
            let nome = caminho.to_string_lossy().to_ascii_lowercase();
            let tipo = EXTENSOES_DE_IMAGEM.iter().find(|(ext, _)| nome.ends_with(ext))?.1;
            return Some((tipo.to_owned(), base64::engine::general_purpose::STANDARD.encode(std::fs::read(&caminho).ok()?)));
        }
        let uuid = entrada.identity.split_once(':')?.1.rsplit_once('#')?.0.to_owned();
        let arquivo = std::io::BufReader::new(File::open(caminho).ok()?);
        let linha = std::io::BufRead::lines(arquivo).map_while(Result::ok)
            .find(|linha| linha.contains(&uuid) && serde_json::from_str::<Value>(linha).is_ok_and(|v| v["uuid"] == uuid.as_str()))?;
        let valor: Value = serde_json::from_str(&linha).ok()?;
        let bloco = blocos_de_imagem(&valor["message"]).nth(k)?;
        let tipo = bloco["source"]["media_type"].as_str().filter(|t| t.starts_with("image/"))?.to_owned();
        return Some((tipo, bloco["source"]["data"].as_str()?.to_owned()));
    }
    None
}

fn item(kind: Kind, role: &str, text: String, tool: Option<String>, value: &Value) -> Item {
    Item { kind, role: role.into(), text, tool, timestamp: value["timestamp"].as_str().map(str::to_owned), imagens: 0, diff: None }
}

/// Itens de uma linha do transcript, na ordem em que aparecem nela.
pub fn items(value: &Value, provider: &str) -> Vec<Item> {
    if value["isSidechain"] == true { return Vec::new(); }
    let mut saida = Vec::new();
    match provider {
        "claude" if value["type"] == "user" || value["type"] == "assistant" => {
            let message = &value["message"];
            let role = message["role"].as_str().unwrap_or("");
            // Resumo que a CLI injeta ao compactar: no terminal vira uma linha "compactado".
            if value["isCompactSummary"] == true {
                saida.push(item(Kind::Notice, "assistant", "Conversa compactada para caber no contexto".into(), None, value));
                return saida;
            }
            if value["isMeta"] == true { return saida; }
            if role == "user" {
                let imagens = blocos_de_imagem(message).count();
                let Some(texto) = conteudo_texto(message).map(|t| sem_colado(&t)).or_else(|| (imagens > 0).then(String::new)) else { return saida };
                if let Some(comando) = comando_digitado(&texto) {
                    saida.push(item(Kind::Command, "user", comando, None, value));
                } else if texto.trim_start().starts_with("[Request interrupted") {
                    saida.push(item(Kind::Notice, "assistant", "Interrompido por você".into(), None, value));
                } else if !injetado(&texto) && (!texto.trim().is_empty() || imagens > 0) {
                    saida.push(Item { imagens, ..item(Kind::Text, "user", texto, None, value) });
                }
            } else if role == "assistant" {
                if let Some(texto) = message["content"].as_str() {
                    if !texto.trim().is_empty() { saida.push(item(Kind::Text, "assistant", texto.to_owned(), None, value)); }
                    return saida;
                }
                for bloco in message["content"].as_array().into_iter().flatten() {
                    match bloco["type"].as_str() {
                        Some("text") => if let Some(texto) = bloco["text"].as_str().filter(|t| !t.trim().is_empty()) {
                            saida.push(item(Kind::Text, "assistant", texto.to_owned(), None, value));
                        },
                        // O que o agente diz entre uma ferramenta e outra pode vir como `thinking` com texto,
                        // e o terminal mostra isso como fala. O raciocínio que a CLI esconde chega vazio
                        // (só a assinatura) — esse continua de fora, como no terminal.
                        Some("thinking") =>
                            if let Some(texto) = bloco["thinking"].as_str().filter(|t| !t.trim().is_empty()) {
                                saida.push(item(Kind::Text, "assistant", texto.to_owned(), None, value));
                            },
                        Some("tool_use") => if let Some((nome, detalhe)) = ferramenta_claude(bloco["name"].as_str().unwrap_or(""), &bloco["input"]) {
                            let diff = diff_claude(&nome, &bloco["input"]);
                            saida.push(Item { diff, ..item(Kind::Tool, "assistant", detalhe, Some(nome), value) });
                        },
                        _ => {}
                    }
                }
            }
        }
        // Mensagem mandada no meio do turno: a CLI a entrega ao agente na próxima pausa entre
        // ferramentas e grava como anexo, não como fala do usuário. Sem isto ela sumia da conversa
        // e a bolha ficava "na fila" para sempre.
        "claude" if value["type"] == "attachment" && value["attachment"]["type"] == "queued_command" => {
            let anexo = &value["attachment"];
            if anexo["commandMode"].as_str().is_some_and(|modo| modo != "prompt") { return saida; }
            if let Some(texto) = anexo["prompt"].as_str().map(sem_colado).filter(|t| !t.trim().is_empty() && !injetado(t)) {
                saida.push(item(Kind::Text, "user", texto, None, value));
            }
        }
        "codex" if value["type"] == "response_item" => {
            let payload = &value["payload"];
            if payload["type"] == "message" {
                let role = payload["role"].as_str().unwrap_or("");
                if role != "user" && role != "assistant" { return saida; }
                let Some(texto) = conteudo_texto(payload).map(|t| if role == "user" { sem_colado(&t) } else { t }) else { return saida };
                if texto.trim().is_empty() || (role == "user" && injetado(&texto)) { return saida; }
                saida.push(item(Kind::Text, role, texto, None, value));
            } else if let Some((nome, detalhe)) = ferramenta_codex(payload) {
                let diff = (nome == "Edit").then(|| payload["input"].as_str().and_then(diff_de_patch)).flatten();
                saida.push(Item { diff, ..item(Kind::Tool, "assistant", detalhe, Some(nome), value) });
            }
        }
        "codex" if value["type"] == "event_msg" && value["payload"]["type"] == "turn_aborted" => {
            saida.push(item(Kind::Notice, "assistant", "Interrompido por você".into(), None, value));
        }
        _ => {}
    }
    // Print ou imagem que o agente cita pelo caminho ("salvei em C:\…\tela.png") vira imagem na
    // conversa, como as coladas pelo usuário.
    for it in saida.iter_mut().filter(|it| it.role == "assistant" && it.kind == Kind::Text) {
        it.imagens = caminhos_de_imagem(&it.text).len();
    }
    saida
}

const EXTENSOES_DE_IMAGEM: [(&str, &str); 5] =
    [(".png", "image/png"), (".jpg", "image/jpeg"), (".jpeg", "image/jpeg"), (".gif", "image/gif"), (".webp", "image/webp")];
/// Maior imagem citada que a conversa mostra (o JSON leva o arquivo inteiro em base64).
const IMAGEM_MAX_BYTES: u64 = 15 * 1024 * 1024;

/// Caminhos absolutos de imagens que existem, citados num texto, na ordem e sem repetir. Aceita
/// `C:\…`, `C:/…` e `/…`, com espaços (`C:\Users\Fulano de Tal\…`; no Mac o print padrão é
/// "Screenshot 2026-10-19 at 01.09.png"): o arquivo precisa existir, então texto solto não passa.
/// O caminho vem do texto do agente, nunca de quem pede pela rede, e só imagens comuns passam.
pub fn caminhos_de_imagem(texto: &str) -> Vec<PathBuf> {
    let mut achados: Vec<PathBuf> = Vec::new();
    for linha in texto.lines() {
        let minusculo = linha.to_ascii_lowercase();
        let bytes = linha.as_bytes();
        let mut i = 0;
        while i < bytes.len() {
            let antes = if i == 0 { b' ' } else { bytes[i - 1] };
            let drive = i + 2 < bytes.len() && bytes[i].is_ascii_alphabetic() && bytes[i + 1] == b':'
                && matches!(bytes[i + 2], b'\\' | b'/') && !antes.is_ascii_alphanumeric();
            let raiz = bytes[i] == b'/' && matches!(antes, b' ' | b'`' | b'(' | b'"' | b'\'' | b'<' | b'[' | b'*');
            if !(drive || raiz) { i += 1; continue; }
            // O fim é a primeira extensão de imagem seguida de algo que não continua o nome.
            let fim = EXTENSOES_DE_IMAGEM.iter().filter_map(|(ext, _)| {
                let mut de = i;
                while let Some(pos) = minusculo[de..].find(ext) {
                    let f = de + pos + ext.len();
                    if f == bytes.len() || !(bytes[f].is_ascii_alphanumeric() || bytes[f] == b'_' || bytes[f] == b'-') { return Some(f); }
                    de = f;
                }
                None
            }).min();
            let Some(fim) = fim else { break };
            let candidato = &linha[i..fim];
            if !candidato.contains(['`', '"', '<', '>', '|', '*', '?']) {
                let caminho = PathBuf::from(candidato);
                let cabe = std::fs::metadata(&caminho).is_ok_and(|m| m.is_file() && m.len() <= IMAGEM_MAX_BYTES);
                if cabe && !achados.contains(&caminho) { achados.push(caminho); }
                i = fim;
            } else { i += 1; }
        }
    }
    achados
}

/// FNV-1a: identidade estável de uma linha sem guardar a linha inteira na memória.
fn hash(bytes: &[u8]) -> u64 {
    bytes.iter().fold(0xcbf29ce484222325_u64, |h, b| (h ^ u64::from(*b)).wrapping_mul(0x100000001b3))
}

/// Claude Code 2.1.3xx grava cada chamada à API inteira no transcript (`api-request`, `-blob`,
/// `-shape`): mais da metade de um `.jsonl` de 300 MB, e nada disso vai para a conversa. A CLI põe o
/// `type` primeiro, então dá para pular a linha sem parsear o JSON.
fn chamada_da_api(linha: &[u8]) -> bool {
    linha.starts_with(br#"{"type":"api-request"#)
}

fn entradas(linha: &[u8], provider: &str) -> Vec<Entry> {
    if linha.iter().all(u8::is_ascii_whitespace) || chamada_da_api(linha) { return Vec::new(); }
    let Ok(value) = serde_json::from_slice::<Value>(linha) else { return Vec::new() };
    let base = value["uuid"].as_str().map(str::to_owned).unwrap_or_else(|| format!("{:016x}", hash(linha)));
    items(&value, provider).into_iter().enumerate()
        .map(|(i, item)| Entry { identity: format!("{provider}:{base}#{i}"), item })
        .collect()
}

/// O que já se sabe de um transcript: até onde foi lido e os itens extraídos até ali.
#[derive(Debug, Default)]
pub struct Feed {
    /// Byte logo depois da última linha completa lida. Linha pela metade fica para a próxima.
    offset: u64,
    pub entries: Vec<Entry>,
    /// Quantos dos últimos `entries` vieram de uma linha sem `\n` no fim. Valem para mostrar, mas a
    /// linha é relida (e eles refeitos) na próxima leitura.
    provisorios: usize,
    usado_em: u64,
}

/// Transcripts abertos recentemente. Limitado: só a conversa aberta e poucas outras são lidas.
#[derive(Debug, Default)]
pub struct FeedCache {
    feeds: HashMap<PathBuf, Feed>,
    relogio: u64,
}

const CACHE_MAX: usize = 24;

impl FeedCache {
    /// Itens do transcript em `path`, lendo só o que foi acrescentado desde a última chamada.
    pub fn read(&mut self, path: &Path, provider: &str) -> std::io::Result<&[Entry]> {
        self.relogio += 1;
        let agora = self.relogio;
        let mut file = File::open(path)?;
        let tamanho = file.metadata()?.len();
        if !self.feeds.contains_key(path) && self.feeds.len() >= CACHE_MAX {
            if let Some(velho) = self.feeds.iter().min_by_key(|(_, feed)| feed.usado_em).map(|(p, _)| p.clone()) {
                self.feeds.remove(&velho);
            }
        }
        let feed = self.feeds.entry(path.to_path_buf()).or_default();
        feed.usado_em = agora;
        // Arquivo menor que o já lido: foi trocado ou truncado. Recomeça do zero.
        if tamanho < feed.offset { *feed = Feed { usado_em: agora, ..Feed::default() }; }
        if tamanho > feed.offset {
            let provisorios = std::mem::take(&mut feed.provisorios);
            feed.entries.truncate(feed.entries.len() - provisorios);
            file.seek(SeekFrom::Start(feed.offset))?;
            // Linha a linha: a primeira leitura de um transcript de centenas de MB não vai inteira
            // para a memória.
            let mut leitor = BufReader::new(file.take(tamanho - feed.offset));
            let mut linha = Vec::new();
            loop {
                linha.clear();
                if leitor.read_until(b'\n', &mut linha)? == 0 { break; }
                if linha.last() != Some(&b'\n') {
                    // Sem `\n` no fim a última linha pode estar no meio da escrita — ou o arquivo
                    // simplesmente terminou assim. Se já é um JSON inteiro ela aparece, mas fica
                    // provisória: a próxima leitura recomeça dela, então nada duplica quando a CLI
                    // completar a linha.
                    let resto = entradas(&linha, provider);
                    feed.provisorios = resto.len();
                    feed.entries.extend(resto);
                    break;
                }
                feed.entries.extend(entradas(&linha[..linha.len() - 1], provider));
                feed.offset += linha.len() as u64;
            }
        }
        Ok(&self.feeds[path].entries)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn imagem_citada_pelo_agente_vira_imagem_da_mensagem() {
        let dir = tempfile::tempdir().unwrap();
        let pasta = dir.path().join("Fulano de Tal");
        std::fs::create_dir_all(&pasta).unwrap();
        let tela = pasta.join("tela.png");
        let foto = pasta.join("foto.JPG");
        std::fs::write(&tela, b"png").unwrap();
        std::fs::write(&foto, b"jpg").unwrap();
        std::fs::write(pasta.join("notas.txt"), b"txt").unwrap();
        let texto = format!("Print em `{}`, de novo {}.\nE {} (foto). Sumiu: {}. Texto: {}",
            tela.display(), tela.display(), foto.display(), pasta.join("nao.png").display(), pasta.join("notas.txt").display());
        assert_eq!(caminhos_de_imagem(&texto), vec![tela.clone(), foto.clone()]);
        let linha = json!({"type": "assistant", "uuid": "u1", "message": {"role": "assistant", "content": [{"type": "text", "text": texto}]}});
        let itens = items(&linha, "claude");
        assert_eq!(itens[0].imagens, 2);
        assert_eq!(caminhos_de_imagem("versao 1.2.png ou http://x.com/a.png ou abc/def.png"), Vec::<PathBuf>::new());
    }

    #[test]
    fn edicao_traz_linhas_adicionadas_e_removidas() {
        let edit = items(&claude("assistant", json!([{"type": "tool_use", "name": "Edit", "input": {
            "file_path": "C:/a.ts", "old_string": "a\nb\nc", "new_string": "a\nB\nc\nd"}}])), "claude");
        let diff = edit[0].diff.as_ref().unwrap();
        assert_eq!((diff.mais, diff.menos), (2, 1));
        assert_eq!(diff.linhas, [" a", "-b", "+B", " c", "+d"]);
        let write = items(&claude("assistant", json!([{"type": "tool_use", "name": "Write", "input": {"file_path": "C:/b.ts", "content": "x\ny"}}])), "claude");
        assert_eq!(write[0].diff.as_ref().map(|d| (d.mais, d.menos)), Some((2, 0)));
        let read = items(&claude("assistant", json!([{"type": "tool_use", "name": "Read", "input": {"file_path": "C:/b.ts"}}])), "claude");
        assert!(read[0].diff.is_none());
        let patch = diff_de_patch("*** Begin Patch\n*** Update File: a.rs\n@@\n-velho\n+novo\n contexto\n*** End Patch").unwrap();
        assert_eq!((patch.mais, patch.menos), (1, 1));
    }

    fn claude(role: &str, content: Value) -> Value {
        json!({"type": role, "uuid": "u", "timestamp": "2026-10-12T10:00:00Z", "message": {"role": role, "content": content}})
    }

    #[test]
    fn claude_mostra_texto_e_acoes_e_esconde_o_que_e_interno() {
        let resposta = items(&claude("assistant", json!([
            {"type": "thinking", "thinking": "", "signature": "EqQBCkgIBx"},
            {"type": "text", "text": "Vou rodar os testes."},
            {"type": "thinking", "thinking": "Testes passaram; agora o lint.", "signature": "EqQBCkgIBy"},
            {"type": "tool_use", "name": "Bash", "input": {"command": "npm test", "description": "Roda os testes"}},
            {"type": "tool_use", "name": "Read", "input": {"file_path": "C:/app/src/main.ts"}},
            {"type": "tool_use", "name": "ToolSearch", "input": {"query": "x"}},
        ])), "claude");
        assert_eq!(resposta.iter().map(|i| (i.kind, i.tool.as_deref(), i.text.as_str())).collect::<Vec<_>>(), vec![
            (Kind::Text, None, "Vou rodar os testes."),
            // Narração gravada como `thinking` com texto: o terminal mostra, a conversa também.
            (Kind::Text, None, "Testes passaram; agora o lint."),
            (Kind::Tool, Some("Bash"), "npm test"),
            (Kind::Tool, Some("Read"), "C:/app/src/main.ts"),
        ]);

        assert!(items(&claude("user", json!("<system-reminder>x</system-reminder>")), "claude").is_empty());
        assert!(items(&claude("user", json!([{"type": "tool_result", "content": "ok"}])), "claude").is_empty());
        let mut meta = claude("user", json!("Caveat: nada"));
        meta["isMeta"] = json!(true);
        assert!(items(&meta, "claude").is_empty());

        let comando = items(&claude("user", json!("<command-name>/model</command-name>\n<command-args>opus</command-args>")), "claude");
        assert_eq!((comando[0].kind, comando[0].text.as_str()), (Kind::Command, "/model opus"));
        let colado = items(&claude("user", json!("<pasted_content id=\"8b5b\">\nlinha um\nlinha dois\n</pasted_content id=\"8b5b\">")), "claude");
        assert_eq!((colado[0].kind, colado[0].text.as_str()), (Kind::Text, "linha um\nlinha dois"));
        let com_imagem = items(&claude("user", json!([{"type": "text", "text": "[Image #2]\n\n<pasted_content id=\"a\">\noi\n</pasted_content id=\"a\">"}])), "claude");
        assert_eq!(com_imagem[0].text, "[Image #2]\n\noi");
        let interrompido = items(&claude("user", json!([{"type": "text", "text": "[Request interrupted by user]"}])), "claude");
        assert_eq!(interrompido[0].kind, Kind::Notice);
        // Mandada no meio do turno: a CLI grava como anexo `queued_command`.
        let no_turno = json!({"type": "attachment", "attachment": {"type": "queued_command", "prompt": "faça um modal", "commandMode": "prompt"}});
        assert_eq!(items(&no_turno, "claude")[0].text, "faça um modal");
        let aviso = json!({"type": "attachment", "attachment": {"type": "queued_command", "prompt": "x", "commandMode": "task-notification"}});
        assert!(items(&aviso, "claude").is_empty());
    }

    /// A CLI troca a imagem colada por `[Image #1]` no texto e guarda o conteúdo num bloco à parte.
    #[test]
    fn imagem_colada_conta_na_mensagem_e_volta_sob_demanda() {
        let dir = tempfile::tempdir().unwrap();
        let caminho = dir.path().join("t.jsonl");
        let linhas = [
            json!({"type": "assistant", "uuid": "a1", "message": {"role": "assistant", "content": [{"type": "text", "text": "oi"}]}}),
            json!({"type": "user", "uuid": "u1", "message": {"role": "user", "content": [
                {"type": "text", "text": "[Image #1] olha isso"},
                {"type": "image", "source": {"type": "base64", "media_type": "image/png", "data": "iVBORw0K"}}]}}),
        ];
        std::fs::write(&caminho, linhas.iter().map(|l| format!("{l}\n")).collect::<String>()).unwrap();
        let mut cache = FeedCache::default();
        let itens = cache.read(&caminho, "claude").unwrap().to_vec();
        assert_eq!((itens[1].item.imagens, itens[1].item.text.as_str()), (1, "[Image #1] olha isso"));
        let fontes = [(caminho, "claude".to_owned(), None)];
        assert_eq!(imagem(&fontes, 1, 0, &mut cache), Some(("image/png".into(), "iVBORw0K".into())));
        assert_eq!(imagem(&fontes, 1, 1, &mut cache), None);
        assert_eq!(imagem(&fontes, 0, 0, &mut cache), None);
        assert_eq!(sem_marcas_de_imagem("[Image #1]bom dia [Image #12] veja"), "bom dia  veja");
        assert_eq!(sem_marcas_de_imagem("[Image #x] fica"), "[Image #x] fica");
    }

    #[test]
    fn comando_perde_o_cd_inicial_para_caber_o_que_foi_rodado() {
        assert_eq!(sem_cd_inicial("cd \"D:/projeto\" && npm test"), "npm test");
        assert_eq!(sem_cd_inicial("cd app; cd web && cargo check"), "cargo check");
        assert_eq!(sem_cd_inicial("cd app"), "cd app");
        assert_eq!(sem_cd_inicial("npm run cd && x"), "npm run cd && x");
        let bash = items(&claude("assistant", json!([{"type": "tool_use", "name": "Bash", "input": {"command": "cd \"C:/x\" && git status"}}])), "claude");
        assert_eq!(bash[0].text, "git status");
    }

    #[test]
    fn codex_mostra_comando_do_exec_e_arquivos_do_patch() {
        let exec = json!({"type": "response_item", "payload": {"type": "custom_tool_call", "name": "exec",
            "input": "const r = await tools.exec_command({\"cmd\":\"rg -n \\\"foo\\\" src\",\"yield_time_ms\":1000});"}});
        let saida = items(&exec, "codex");
        assert_eq!((saida[0].tool.as_deref(), saida[0].text.as_str()), (Some("Shell"), "rg -n \"foo\" src"));

        let patch = json!({"type": "response_item", "payload": {"type": "custom_tool_call", "name": "apply_patch",
            "input": "*** Begin Patch\n*** Update File: src/a.ts\n@@\n-x\n+y\n*** Add File: src/b.ts\n*** End Patch"}});
        assert_eq!(items(&patch, "codex")[0].text, "src/a.ts, src/b.ts");

        let espera = json!({"type": "response_item", "payload": {"type": "function_call", "name": "wait", "arguments": "{}"}});
        assert!(items(&espera, "codex").is_empty());
        let ambiente = json!({"type": "response_item", "payload": {"type": "message", "role": "user",
            "content": [{"type": "input_text", "text": "<environment_context>x</environment_context>"}]}});
        assert!(items(&ambiente, "codex").is_empty());
    }

    /// Linhas reais do Claude Code 2.1.3xx: a chamada à API (até 1 MB cada) fica fora da conversa.
    #[test]
    fn chamada_da_api_no_transcript_nao_vira_mensagem() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("t.jsonl");
        let linhas = [
            json!({"type": "user", "uuid": "a", "message": {"role": "user", "content": "ola"}}).to_string(),
            r#"{"type":"api-request","sessionId":"s","id":"x","body":{"messages":[{"role":"user","content":"ola"}]}}"#.into(),
            r#"{"type":"api-request-blob","sessionId":"s","hash":"h","content":[{"type":"text","text":"x"}]}"#.into(),
        ];
        std::fs::write(&path, linhas.join("\n") + "\n").unwrap();
        let itens = FeedCache::default().read(&path, "claude").unwrap().iter().map(|e| e.item.text.clone()).collect::<Vec<_>>();
        assert_eq!(itens, ["ola"]);
    }

    #[test]
    fn leitura_incremental_so_parseia_o_que_foi_acrescentado() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("t.jsonl");
        let linha = |i: usize| format!("{}\n", json!({"type": "user", "uuid": format!("m{i}"), "message": {"role": "user", "content": format!("oi {i}")}}));
        std::fs::write(&path, linha(0) + &linha(1)).unwrap();
        let mut cache = FeedCache::default();
        assert_eq!(cache.read(&path, "claude").unwrap().len(), 2);

        // Linha pela metade (a CLI ainda escrevendo) não entra; completa, entra uma vez só.
        let parcial = linha(2);
        let (inicio, resto) = parcial.split_at(10);
        std::fs::OpenOptions::new().append(true).open(&path).unwrap().write_all(inicio.as_bytes()).unwrap();
        assert_eq!(cache.read(&path, "claude").unwrap().len(), 2);
        std::fs::OpenOptions::new().append(true).open(&path).unwrap().write_all(resto.as_bytes()).unwrap();
        let itens = cache.read(&path, "claude").unwrap();
        assert_eq!(itens.len(), 3);
        assert_eq!(itens[2].item.text, "oi 2");

        // Arquivo trocado por um menor: relê do zero em vez de misturar.
        std::fs::write(&path, linha(9)).unwrap();
        let itens = cache.read(&path, "claude").unwrap();
        assert_eq!(itens.len(), 1);
        assert_eq!(itens[0].item.text, "oi 9");
    }

    /// Arquivo que termina sem `\n`: a última mensagem aparece já, e não duplica quando a CLI
    /// completa a linha e escreve a seguinte.
    #[test]
    fn ultima_linha_sem_quebra_aparece_e_nao_duplica() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("t.jsonl");
        let linha = |i: usize| json!({"type": "user", "uuid": format!("m{i}"), "message": {"role": "user", "content": format!("oi {i}")}}).to_string();
        std::fs::write(&path, linha(0)).unwrap();
        let mut cache = FeedCache::default();
        assert_eq!(cache.read(&path, "claude").unwrap().len(), 1);
        std::fs::OpenOptions::new().append(true).open(&path).unwrap().write_all(format!("\n{}\n", linha(1)).as_bytes()).unwrap();
        let textos: Vec<_> = cache.read(&path, "claude").unwrap().iter().map(|e| e.item.text.clone()).collect();
        assert_eq!(textos, vec!["oi 0", "oi 1"]);
    }

    use std::io::Write;
}

