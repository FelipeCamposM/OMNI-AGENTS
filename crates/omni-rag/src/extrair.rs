//! Transforma qualquer arquivo solto na tela Conhecimento em pedaços de texto. O tipo vem do
//! conteúdo (assinatura), não só da extensão: um `.backup` pode ser SQLite, dump SQL ou pg_dump.
use regex::Regex;
use rusqlite::{types::ValueRef, Connection, OpenFlags};
use std::{
    fs::File,
    io::{BufRead, BufReader, Read},
    path::Path,
    process::Command,
    sync::OnceLock,
};

/// Tamanho-alvo de um trecho: cabe em poucas centenas de tokens quando o agente pede para ler.
pub const TAMANHO_DO_TRECHO: usize = 1200;
const PROFUNDIDADE_MAXIMA: usize = 3;
const MENOR_LINHA_DE_BANCO: usize = 40;

pub struct Pedaco {
    pub titulo: String,
    pub texto: String,
}

type Saida<'a> = &'a mut dyn FnMut(Pedaco);

/// Junta linhas até o tamanho do trecho, sem misturar títulos diferentes.
struct Agrupador<'a> {
    titulo: String,
    texto: String,
    saida: Saida<'a>,
}

impl<'a> Agrupador<'a> {
    fn novo(titulo: &str, saida: Saida<'a>) -> Self {
        Self { titulo: titulo.to_owned(), texto: String::new(), saida }
    }

    fn fechar(&mut self) {
        let texto = std::mem::take(&mut self.texto);
        if !texto.trim().is_empty() {
            (self.saida)(Pedaco { titulo: self.titulo.clone(), texto: texto.trim().to_owned() });
        }
    }

    fn trocar_titulo(&mut self, titulo: &str) {
        if self.titulo != titulo {
            self.fechar();
            self.titulo = titulo.to_owned();
        }
    }

    fn linha(&mut self, linha: &str) {
        let mut resto = linha.trim_end();
        while resto.chars().count() > TAMANHO_DO_TRECHO {
            let corte = resto.char_indices().nth(TAMANHO_DO_TRECHO).map_or(resto.len(), |(indice, _)| indice);
            self.empilhar(&resto[..corte]);
            self.fechar();
            resto = &resto[corte..];
        }
        self.empilhar(resto);
        if self.texto.len() >= TAMANHO_DO_TRECHO {
            self.fechar();
        }
    }

    fn empilhar(&mut self, linha: &str) {
        self.texto.push_str(linha);
        self.texto.push('\n');
    }
}

/// Coluna ou tabela que guarda segredo: fora do índice, para não ir parar no contexto de um agente.
fn nome_sensivel(nome: &str) -> bool {
    let nome = nome.to_lowercase();
    ["password", "passwd", "senha", "secret", "token", "credential", "apikey", "api_key", "salt", "hash", "session", "oauth", "subscription"]
        .iter()
        .any(|marca| nome.contains(marca))
}

fn coluna_de_ruido(nome: &str) -> bool {
    let nome = nome.to_lowercase();
    nome == "id" || nome == "meta" || nome.ends_with("id") || nome.ends_with("_id") || nome.ends_with("at")
}

pub fn extrair(caminho: &Path, saida: Saida) -> Result<String, String> {
    extrair_em(caminho, saida, 0)
}

fn extrair_em(caminho: &Path, saida: Saida, profundidade: usize) -> Result<String, String> {
    if profundidade > PROFUNDIDADE_MAXIMA {
        return Err("arquivos compactados demais, um dentro do outro".into());
    }
    let mut inicio = [0u8; 8192];
    let lidos = File::open(caminho).and_then(|mut arquivo| arquivo.read(&mut inicio)).map_err(|erro| erro.to_string())?;
    let inicio = &inicio[..lidos];
    let extensao = caminho.extension().map(|valor| valor.to_string_lossy().to_lowercase()).unwrap_or_default();
    let nome = caminho.file_name().map(|valor| valor.to_string_lossy().into_owned()).unwrap_or_default();

    if inicio.starts_with(b"SQLite format 3\0") {
        sqlite(caminho, saida)?;
        return Ok("banco SQLite".into());
    }
    if inicio.starts_with(b"PGDMP") {
        return Err("backup do Postgres em formato binário: exporte em .sql (pg_dump -Fp) ou instale o pg_restore".into());
    }
    if inicio.starts_with(&[0x1f, 0x8b]) {
        return gzip(caminho, saida, profundidade);
    }
    if inicio.starts_with(b"%PDF") {
        pdf(caminho, &nome, saida)?;
        return Ok("PDF".into());
    }
    if inicio.starts_with(b"PK\x03\x04") {
        return if matches!(extensao.as_str(), "docx" | "pptx" | "xlsx") {
            office(caminho, &nome, saida)?;
            Ok(extensao)
        } else {
            arquivo_zip(caminho, saida, profundidade)
        };
    }
    if inicio.contains(&0) {
        return Err(format!("formato não reconhecido: {nome}"));
    }
    let leitor = BufReader::new(File::open(caminho).map_err(|erro| erro.to_string())?);
    if extensao == "sql" {
        sql(leitor, &nome, saida);
        return Ok("dump SQL".into());
    }
    if matches!(extensao.as_str(), "html" | "htm") {
        let mut bruto = Vec::new();
        File::open(caminho).and_then(|mut arquivo| arquivo.read_to_end(&mut bruto)).map_err(|erro| erro.to_string())?;
        let mut grupo = Agrupador::novo(&nome, saida);
        for linha in sem_html(&String::from_utf8_lossy(&bruto)).lines().filter(|linha| !linha.trim().is_empty()) {
            grupo.linha(linha);
        }
        grupo.fechar();
        return Ok("HTML".into());
    }
    let mut grupo = Agrupador::novo(&nome, saida);
    for linha in linhas(leitor) {
        grupo.linha(&linha);
    }
    grupo.fechar();
    Ok(if extensao.is_empty() { "texto".into() } else { extensao })
}

/// Linhas tolerantes: um byte inválido no meio de um dump não pode derrubar a importação.
fn linhas(mut leitor: impl BufRead) -> impl Iterator<Item = String> {
    std::iter::from_fn(move || {
        let mut bruto = Vec::new();
        match leitor.read_until(b'\n', &mut bruto) {
            Ok(0) | Err(_) => None,
            Ok(_) => Some(String::from_utf8_lossy(&bruto).trim_end_matches(['\n', '\r']).to_owned()),
        }
    })
}

fn sem_html(texto: &str) -> String {
    static BLOCOS: OnceLock<Regex> = OnceLock::new();
    let blocos = BLOCOS.get_or_init(|| Regex::new(r"(?is)<(script|style)\b.*?</(script|style)>").unwrap());
    sem_tags(&blocos.replace_all(texto, " "))
}

fn sem_tags(texto: &str) -> String {
    static TAGS: OnceLock<Regex> = OnceLock::new();
    let tags = TAGS.get_or_init(|| Regex::new(r"<[^>]+>").unwrap());
    tags.replace_all(texto, " ")
        .replace("&amp;", "&").replace("&lt;", "<").replace("&gt;", ">").replace("&quot;", "\"").replace("&apos;", "'").replace("&nbsp;", " ")
}

fn pdf(caminho: &Path, nome: &str, saida: Saida) -> Result<(), String> {
    let resultado = Command::new("pdftotext").arg(caminho).arg("-").output()
        .map_err(|_| "para ler PDF, instale o poppler (comando pdftotext)".to_string())?;
    if !resultado.status.success() {
        return Err(format!("não consegui ler o PDF: {}", String::from_utf8_lossy(&resultado.stderr).trim()));
    }
    let texto = String::from_utf8_lossy(&resultado.stdout);
    if texto.trim().is_empty() {
        return Err("PDF sem texto (provavelmente escaneado): precisa de OCR".into());
    }
    let mut grupo = Agrupador::novo(nome, saida);
    texto.lines().for_each(|linha| grupo.linha(linha));
    grupo.fechar();
    Ok(())
}

fn office(caminho: &Path, nome: &str, saida: Saida) -> Result<(), String> {
    let mut pacote = zip::ZipArchive::new(File::open(caminho).map_err(|erro| erro.to_string())?).map_err(|erro| erro.to_string())?;
    let mut partes: Vec<String> = pacote.file_names()
        .filter(|parte| *parte == "word/document.xml" || *parte == "xl/sharedStrings.xml" || (parte.starts_with("ppt/slides/slide") && parte.ends_with(".xml")))
        .map(str::to_owned)
        .collect();
    partes.sort();
    let mut grupo = Agrupador::novo(nome, saida);
    for parte in partes {
        let mut xml = String::new();
        pacote.by_name(&parte).map_err(|erro| erro.to_string())?.read_to_string(&mut xml).map_err(|erro| erro.to_string())?;
        let xml = xml.replace("</w:p>", "\n").replace("</a:p>", "\n").replace("</si>", "\n");
        for linha in sem_tags(&xml).lines() {
            let linha = linha.split_whitespace().collect::<Vec<_>>().join(" ");
            if !linha.is_empty() { grupo.linha(&linha); }
        }
    }
    grupo.fechar();
    Ok(())
}

fn gzip(caminho: &Path, saida: Saida, profundidade: usize) -> Result<String, String> {
    let nome = caminho.file_stem().map(|valor| valor.to_string_lossy().into_owned()).unwrap_or_else(|| "arquivo".into());
    let pasta = tempdir()?;
    let destino = pasta.0.join(&nome);
    let mut origem = flate2::read::GzDecoder::new(File::open(caminho).map_err(|erro| erro.to_string())?);
    std::io::copy(&mut origem, &mut File::create(&destino).map_err(|erro| erro.to_string())?).map_err(|erro| erro.to_string())?;
    extrair_em(&destino, saida, profundidade + 1)
}

fn arquivo_zip(caminho: &Path, saida: Saida, profundidade: usize) -> Result<String, String> {
    let mut pacote = zip::ZipArchive::new(File::open(caminho).map_err(|erro| erro.to_string())?).map_err(|erro| erro.to_string())?;
    let pasta = tempdir()?;
    let mut lidos = 0;
    for indice in 0..pacote.len() {
        let mut entrada = pacote.by_index(indice).map_err(|erro| erro.to_string())?;
        let caminho_interno = entrada.name().to_owned();
        if entrada.is_dir() || caminho_interno.contains("__MACOSX") { continue; }
        // Só o nome final: um `../../x` dentro do zip não pode escapar da pasta temporária.
        let Some(nome) = Path::new(&caminho_interno).file_name() else { continue };
        let destino = pasta.0.join(nome);
        std::io::copy(&mut entrada, &mut File::create(&destino).map_err(|erro| erro.to_string())?).map_err(|erro| erro.to_string())?;
        drop(entrada);
        if extrair_em(&destino, saida, profundidade + 1).is_ok() { lidos += 1; }
        let _ = std::fs::remove_file(&destino);
    }
    if lidos == 0 { return Err("nenhum arquivo legível dentro do zip".into()); }
    Ok(format!("zip ({lidos} arquivos)"))
}

struct PastaTemporaria(std::path::PathBuf);

impl Drop for PastaTemporaria {
    fn drop(&mut self) { let _ = std::fs::remove_dir_all(&self.0); }
}

fn tempdir() -> Result<PastaTemporaria, String> {
    static CONTADOR: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
    let numero = CONTADOR.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    let pasta = std::env::temp_dir().join(format!("omni-rag-{}-{numero}", std::process::id()));
    std::fs::create_dir_all(&pasta).map_err(|erro| erro.to_string())?;
    Ok(PastaTemporaria(pasta))
}

/// Dump SQL: guarda os dados e pula DDL, comandos de sessão e tabelas sensíveis.
fn sql(leitor: impl BufRead, nome: &str, saida: Saida) {
    static COPY: OnceLock<Regex> = OnceLock::new();
    static INSERT: OnceLock<Regex> = OnceLock::new();
    let copy = COPY.get_or_init(|| Regex::new(r#"(?i)^COPY\s+([^\s(]+)"#).unwrap());
    let insert = INSERT.get_or_init(|| Regex::new(r#"(?i)^INSERT\s+(?:OR\s+\w+\s+)?INTO\s+([^\s(]+)[^;]*?VALUES\s*"#).unwrap());
    const COMANDOS: [&str; 16] = ["--", "/*", "SET ", "SELECT ", "CREATE ", "ALTER ", "DROP ", "GRANT ", "REVOKE ", "COMMENT ", "BEGIN", "COMMIT", "PRAGMA", "LOCK ", "UNLOCK ", "\\"];
    let mut grupo = Agrupador::novo(nome, saida);
    let mut em_copy = false;
    let mut pulando = false;
    let mut em_ddl = false;
    for linha in linhas(leitor) {
        let limpa = linha.trim();
        if em_copy {
            if limpa == "\\." { em_copy = false; pulando = false; continue; }
            if !pulando { grupo.linha(&linha.replace('\t', " | ")); }
            continue;
        }
        if em_ddl || pulando {
            let fim = limpa.ends_with(';');
            if fim { em_ddl = false; pulando = false; }
            continue;
        }
        if let Some(achado) = copy.captures(limpa) {
            let tabela = achado[1].trim_matches('"').replace('"', "");
            em_copy = true;
            pulando = nome_sensivel(&tabela);
            if !pulando { grupo.trocar_titulo(&format!("{nome} · {tabela}")); }
            continue;
        }
        if let Some(achado) = insert.captures(limpa) {
            let tabela = achado[1].replace(['"', '`'], "");
            if nome_sensivel(&tabela) {
                pulando = !limpa.ends_with(';');
                continue;
            }
            grupo.trocar_titulo(&format!("{nome} · {tabela}"));
            grupo.linha(&limpa[achado.get(0).map_or(0, |inteiro| inteiro.end())..]);
            continue;
        }
        let maiuscula = limpa.to_uppercase();
        if let Some(comando) = COMANDOS.iter().find(|comando| maiuscula.starts_with(**comando)) {
            em_ddl = !limpa.ends_with(';') && !matches!(*comando, "--" | "/*" | "\\");
            continue;
        }
        if !limpa.is_empty() { grupo.linha(limpa); }
    }
    grupo.fechar();
}

fn citar(nome: &str) -> String {
    format!("\"{}\"", nome.replace('"', "\"\""))
}

fn texto_de(valor: ValueRef) -> Option<String> {
    match valor {
        ValueRef::Text(bytes) => Some(String::from_utf8_lossy(bytes).into_owned()),
        _ => None,
    }
}

/// Abre sem escrever nada ao lado do arquivo: o banco que o usuário soltou continua intacto.
fn sqlite(caminho: &Path, saida: Saida) -> Result<(), String> {
    let texto = caminho.to_string_lossy().replace('%', "%25").replace('?', "%3f").replace('#', "%23");
    let banco = Connection::open_with_flags(format!("file:{texto}?mode=ro&immutable=1"), OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_URI)
        .map_err(|erro| erro.to_string())?;
    let mut consulta = banco.prepare("select name from sqlite_master where type='table' and name not like 'sqlite_%' and sql not like 'CREATE VIRTUAL%'").map_err(|erro| erro.to_string())?;
    let tabelas: Vec<String> = consulta.query_map([], |linha| linha.get(0)).map_err(|erro| erro.to_string())?.flatten().collect();
    let mut grupo = Agrupador::novo("", saida);
    for tabela in tabelas.iter().filter(|tabela| !nome_sensivel(tabela)) {
        let mut info = banco.prepare(&format!("pragma table_info({})", citar(tabela))).map_err(|erro| erro.to_string())?;
        let colunas: Vec<(String, String)> = info.query_map([], |linha| Ok((linha.get(1)?, linha.get(2)?))).map_err(|erro| erro.to_string())?.flatten().collect();
        let tem = |nome: &str| colunas.iter().any(|(coluna, _)| coluna.eq_ignore_ascii_case(nome));
        if tem("role") && tem("content") {
            mensagens(&banco, tabela, &colunas, &mut grupo)?;
        } else {
            linhas_de_tabela(&banco, tabela, &colunas, &mut grupo)?;
        }
    }
    grupo.fechar();
    Ok(())
}

/// Tabela de conversa (papel + conteúdo): fica só o que foi dito. Saída de ferramenta e raciocínio
/// são a maior parte do volume e quase nunca respondem a uma busca.
fn mensagens(banco: &Connection, tabela: &str, colunas: &[(String, String)], grupo: &mut Agrupador) -> Result<(), String> {
    let achar = |nomes: &[&str]| colunas.iter().map(|(coluna, _)| coluna).find(|coluna| nomes.iter().any(|nome| coluna.eq_ignore_ascii_case(nome))).cloned();
    let dono = achar(&["conversationId", "conversation_id", "projectId", "project_id", "botId", "sessionId", "session_id"]);
    let ordem = achar(&["createdAt", "created_at", "timestamp", "id"]);
    let titulos: std::collections::HashMap<String, String> = banco.prepare("select id, title from Conversation").and_then(|mut pedido| {
        let lista = pedido.query_map([], |linha| Ok((linha.get::<_, String>(0)?, linha.get::<_, Option<String>>(1)?.unwrap_or_default())))?.flatten().collect();
        Ok(lista)
    }).unwrap_or_default();
    let dono_sql = dono.as_deref().map_or("''".to_owned(), citar);
    let ordem_sql = [dono.as_deref(), ordem.as_deref()].iter().flatten().map(|coluna| citar(coluna)).collect::<Vec<_>>().join(", ");
    let ordenacao = if ordem_sql.is_empty() { String::new() } else { format!(" order by {ordem_sql}") };
    let pedido = format!("select {dono_sql}, role, content from {} where lower(role) in ('user','assistant','human'){ordenacao}", citar(tabela));
    let mut consulta = banco.prepare(&pedido).map_err(|erro| erro.to_string())?;
    let mut resposta = consulta.query([]).map_err(|erro| erro.to_string())?;
    while let Some(linha) = resposta.next().map_err(|erro| erro.to_string())? {
        let id = linha.get_ref(0).ok().and_then(texto_de).unwrap_or_default();
        let Some(conteudo) = linha.get_ref(2).ok().and_then(texto_de) else { continue };
        let titulo = titulos.get(&id).filter(|titulo| !titulo.trim().is_empty()).cloned().unwrap_or_else(|| format!("{tabela} {}", id.chars().take(8).collect::<String>()));
        grupo.trocar_titulo(&format!("Conversa: {titulo}"));
        let papel = linha.get_ref(1).ok().and_then(texto_de).unwrap_or_default();
        let quem = if papel.eq_ignore_ascii_case("assistant") { "Claude" } else { "Usuário" };
        grupo.linha(&format!("{quem}: {}", conteudo.trim()));
    }
    Ok(())
}

fn linhas_de_tabela(banco: &Connection, tabela: &str, colunas: &[(String, String)], grupo: &mut Agrupador) -> Result<(), String> {
    let uteis: Vec<String> = colunas.iter()
        .filter(|(nome, tipo)| !nome_sensivel(nome) && !coluna_de_ruido(nome) && { let tipo = tipo.to_uppercase(); tipo.is_empty() || tipo.contains("CHAR") || tipo.contains("TEXT") || tipo.contains("CLOB") })
        .map(|(nome, _)| citar(nome)).collect();
    if uteis.is_empty() { return Ok(()); }
    grupo.trocar_titulo(&format!("Tabela {tabela}"));
    let mut consulta = banco.prepare(&format!("select {} from {}", uteis.join(", "), citar(tabela))).map_err(|erro| erro.to_string())?;
    let mut resposta = consulta.query([]).map_err(|erro| erro.to_string())?;
    while let Some(linha) = resposta.next().map_err(|erro| erro.to_string())? {
        let valores: Vec<String> = (0..uteis.len()).filter_map(|indice| linha.get_ref(indice).ok().and_then(texto_de)).filter(|valor| !valor.trim().is_empty()).collect();
        let junto = valores.join(" | ");
        if junto.len() >= MENOR_LINHA_DE_BANCO { grupo.linha(&junto); }
    }
    Ok(())
}
