//! Fork (Roadmaps de estudo): os arquivos de cada roadmap na pasta de dados.
//!
//! ```text
//! <dados>/roadmaps/
//!   indice.json               ordem da lista
//!   <id>/meta.json            nome, cor, ícone, arquivado, fase, resumo para a lista
//!   <id>/entrevista.json      perguntas e respostas da criação
//!   <id>/plano.json           módulos → etapas (o caminho aceito)
//!   <id>/progresso.json       estado de cada etapa e dias estudados
//!   <id>/cards.json           cards de revisão (estado FSRS) e o registro das revisões
//!   <id>/conversa.jsonl       painel de IA, uma mensagem por linha (só cresce)
//!   <id>/caderno.md           o que a pessoa escreve enquanto aprende (a IA revisa quando pedido)
//!   <id>/etapas/<etapa>.md    resumo de cada etapa, legível fora do app
//! ```
//!
//! Usado pelo app (`src-tauri/src/roadmaps/`) (o engine ainda não tem rotas do celular para isto). O conteúdo é do front
//! (`src/features/roadmaps/`); aqui só a garantia de nunca perder nada:
//! nomes por lista fechada, JSON válido, grava inteiro ou nada (`.tmp` exclusivo + `fsync` +
//! rename), uma gravação por vez e cópia em `~/omni-backups/` antes de uma migração de formato.

use std::fs;
use std::io::{self, Write};
use std::path::{Path, PathBuf};
use std::sync::Mutex;

pub const PASTA: &str = "roadmaps";
const INDICE: &str = "indice.json";
/// Arquivos fixos de cada roadmap. Fora disso só `etapas/<id>.md`.
pub const ARQUIVOS: &[&str] = &["meta.json", "entrevista.json", "plano.json", "progresso.json", "cards.json", "conversa.jsonl", "caderno.md"];
const CONVERSA: &str = "conversa.jsonl";
/// Um arquivo só não passa disso (cards de anos de estudo cabem com folga).
pub const TAMANHO_MAXIMO: usize = 16 * 1024 * 1024;
const LINHA_MAXIMA: usize = 256 * 1024;

/// Uma gravação por vez no processo (o app desktop é o único que grava aqui).
static TRAVA: Mutex<()> = Mutex::new(());

fn invalido(mensagem: &str) -> io::Error { io::Error::new(io::ErrorKind::InvalidInput, mensagem.to_owned()) }

/// Id de roadmap ou de etapa: `[a-z0-9-]`, 1 a 64, sem começar com `-` (vira nome de pasta).
pub fn id_valido(id: &str) -> bool {
    !id.is_empty() && id.len() <= 64 && !id.starts_with('-')
        && id.bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-')
}

/// Caminho relativo permitido dentro da pasta de um roadmap.
fn arquivo_valido(arquivo: &str) -> bool {
    if ARQUIVOS.contains(&arquivo) { return true; }
    arquivo.strip_prefix("etapas/").and_then(|resto| resto.strip_suffix(".md")).is_some_and(id_valido)
}

fn pasta_do_roadmap(raiz: &Path, id: &str) -> io::Result<PathBuf> {
    if !id_valido(id) { return Err(invalido("Roadmap inválido.")); }
    Ok(raiz.join(id))
}

fn caminho(raiz: &Path, id: &str, arquivo: &str) -> io::Result<PathBuf> {
    if !arquivo_valido(arquivo) { return Err(invalido("Arquivo de roadmap inválido.")); }
    Ok(pasta_do_roadmap(raiz, id)?.join(arquivo))
}

fn criar_pasta(pasta: &Path) -> io::Result<()> {
    if pasta.is_dir() { return Ok(()); }
    fs::create_dir_all(pasta)?;
    #[cfg(unix)] {
        use std::os::unix::fs::PermissionsExt;
        let _ = fs::set_permissions(pasta, fs::Permissions::from_mode(0o700));
    }
    Ok(())
}

/// Grava inteiro ou nada (`.tmp` exclusivo + `fsync` + rename), só para o dono (0600). Mesmo
/// método de `omni_core::sobre_mim`.
fn gravar_atomico(destino: &Path, conteudo: &[u8]) -> io::Result<()> {
    let pasta = destino.parent().ok_or_else(|| invalido("caminho sem pasta"))?;
    criar_pasta(pasta)?;
    use std::sync::atomic::{AtomicU64, Ordering};
    static SEQUENCIA: AtomicU64 = AtomicU64::new(0);
    let nome = destino.file_name().and_then(|n| n.to_str()).unwrap_or("arquivo");
    let temporario = pasta.join(format!(".{nome}.{}.{}.tmp", std::process::id(), SEQUENCIA.fetch_add(1, Ordering::Relaxed)));
    let mut opcoes = fs::OpenOptions::new();
    opcoes.write(true).create_new(true);
    #[cfg(unix)] { use std::os::unix::fs::OpenOptionsExt; opcoes.mode(0o600); }
    let resultado = (|| {
        let mut arquivo = opcoes.open(&temporario)?;
        arquivo.write_all(conteudo)?;
        arquivo.sync_all()?;
        fs::rename(&temporario, destino)?;
        // O rename só fica durável com a pasta sincronizada.
        if let Ok(p) = fs::File::open(pasta) { let _ = p.sync_all(); }
        Ok(())
    })();
    if resultado.is_err() { let _ = fs::remove_file(&temporario); }
    resultado
}

fn conferir_conteudo(arquivo: &str, conteudo: &str) -> io::Result<()> {
    if conteudo.len() > TAMANHO_MAXIMO { return Err(invalido("Arquivo grande demais.")); }
    if arquivo.ends_with(".json") && serde_json::from_str::<serde_json::Value>(conteudo).is_err() {
        return Err(invalido("Conteúdo não é JSON válido."));
    }
    if arquivo == CONVERSA {
        for linha in conteudo.lines().filter(|l| !l.trim().is_empty()) {
            if serde_json::from_str::<serde_json::Value>(linha).is_err() { return Err(invalido("Linha da conversa não é JSON válido.")); }
        }
    }
    Ok(())
}

/// Texto do arquivo, ou `None` se ainda não existe.
pub fn ler(raiz: &Path, id: &str, arquivo: &str) -> io::Result<Option<String>> {
    let caminho = caminho(raiz, id, arquivo)?;
    match fs::symlink_metadata(&caminho) {
        Ok(meta) if !meta.file_type().is_file() => return Err(invalido("Arquivo de roadmap inválido.")),
        Ok(meta) if meta.len() as usize > TAMANHO_MAXIMO => return Err(invalido("Arquivo grande demais.")),
        Err(erro) if erro.kind() == io::ErrorKind::NotFound => return Ok(None),
        Err(erro) => return Err(erro),
        Ok(_) => {}
    }
    fs::read_to_string(caminho).map(Some)
}

pub fn gravar(raiz: &Path, id: &str, arquivo: &str, conteudo: &str) -> io::Result<()> {
    let destino = caminho(raiz, id, arquivo)?;
    conferir_conteudo(arquivo, conteudo)?;
    if !raiz.join(id).join("meta.json").is_file() && arquivo != "meta.json" {
        return Err(invalido("Esse roadmap não existe."));
    }
    let _trava = TRAVA.lock().unwrap_or_else(|e| e.into_inner());
    gravar_atomico(&destino, conteudo.as_bytes())
}

/// Acrescenta uma mensagem no fim da conversa, sem reescrever as anteriores.
pub fn anexar_na_conversa(raiz: &Path, id: &str, linha: &str) -> io::Result<()> {
    let linha = linha.trim();
    if linha.is_empty() || linha.len() > LINHA_MAXIMA || linha.contains('\n') { return Err(invalido("Mensagem inválida.")); }
    if serde_json::from_str::<serde_json::Value>(linha).is_err() { return Err(invalido("Mensagem não é JSON válido.")); }
    let destino = caminho(raiz, id, CONVERSA)?;
    if !raiz.join(id).join("meta.json").is_file() { return Err(invalido("Esse roadmap não existe.")); }
    let _trava = TRAVA.lock().unwrap_or_else(|e| e.into_inner());
    let tamanho = fs::metadata(&destino).map(|m| m.len() as usize).unwrap_or(0);
    if tamanho + linha.len() > TAMANHO_MAXIMO { return Err(invalido("A conversa deste roadmap chegou no limite.")); }
    let mut opcoes = fs::OpenOptions::new();
    opcoes.create(true).append(true);
    #[cfg(unix)] { use std::os::unix::fs::OpenOptionsExt; opcoes.mode(0o600); }
    let mut arquivo = opcoes.open(&destino)?;
    // Uma escrita só com a quebra de linha: um fim cortado (queda de luz) estraga no máximo a última.
    arquivo.write_all(format!("{linha}\n").as_bytes())?;
    arquivo.sync_all()
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct ItemDaLista {
    pub id: String,
    pub meta: serde_json::Value,
}

fn ler_indice(raiz: &Path) -> Vec<String> {
    let Ok(texto) = fs::read_to_string(raiz.join(INDICE)) else { return Vec::new() };
    serde_json::from_str::<serde_json::Value>(&texto).ok()
        .and_then(|v| v["ordem"].as_array().cloned())
        .map(|ordem| ordem.into_iter().filter_map(|i| i.as_str().map(str::to_owned)).filter(|i| id_valido(i)).collect())
        .unwrap_or_default()
}

/// Roadmaps na ordem do índice. Pasta fora do índice (índice perdido ou de outra versão) entra no
/// fim, por nome: nada some da lista por causa do índice.
pub fn listar(raiz: &Path) -> Vec<ItemDaLista> {
    let mut ordem = ler_indice(raiz);
    let mut soltos: Vec<String> = fs::read_dir(raiz).map(|itens| itens.flatten()
        .filter(|i| i.file_type().map(|t| t.is_dir()).unwrap_or(false))
        .filter_map(|i| i.file_name().to_str().map(str::to_owned))
        .filter(|nome| id_valido(nome) && !ordem.contains(nome))
        .collect()).unwrap_or_default();
    soltos.sort();
    ordem.extend(soltos);
    ordem.dedup();
    ordem.into_iter().filter_map(|id| {
        let texto = ler(raiz, &id, "meta.json").ok().flatten()?;
        let meta = serde_json::from_str::<serde_json::Value>(&texto).ok().filter(|v| v.is_object())?;
        Some(ItemDaLista { id, meta })
    }).collect()
}

pub fn ordenar(raiz: &Path, ordem: &[String]) -> io::Result<()> {
    if ordem.iter().any(|id| !id_valido(id)) { return Err(invalido("Roadmap inválido.")); }
    let texto = serde_json::to_string_pretty(&serde_json::json!({ "versao": 1, "ordem": ordem })).map_err(io::Error::other)?;
    let _trava = TRAVA.lock().unwrap_or_else(|e| e.into_inner());
    gravar_atomico(&raiz.join(INDICE), texto.as_bytes())
}

/// Cria a pasta com o `meta.json` e põe o roadmap no começo da lista. Devolve o id.
pub fn criar(raiz: &Path, meta: &serde_json::Value, agora_ms: u128, aleatorio: u32) -> io::Result<String> {
    if !meta.is_object() { return Err(invalido("Roadmap inválido.")); }
    let mut id = format!("r-{}-{:x}", base36(agora_ms), aleatorio & 0xffff);
    let mut n = 1;
    while raiz.join(&id).exists() { n += 1; id = format!("r-{}-{:x}-{n}", base36(agora_ms), aleatorio & 0xffff); }
    let mut meta = meta.clone();
    meta["id"] = serde_json::Value::String(id.clone());
    let texto = serde_json::to_string_pretty(&meta).map_err(io::Error::other)?;
    {
        let _trava = TRAVA.lock().unwrap_or_else(|e| e.into_inner());
        criar_pasta(&raiz.join(&id))?;
        gravar_atomico(&raiz.join(&id).join("meta.json"), texto.as_bytes())?;
    }
    let mut ordem = ler_indice(raiz);
    ordem.retain(|i| i != &id);
    ordem.insert(0, id.clone());
    ordenar(raiz, &ordem)?;
    Ok(id)
}

fn base36(mut n: u128) -> String {
    const D: &[u8] = b"0123456789abcdefghijklmnopqrstuvwxyz";
    if n == 0 { return "0".into(); }
    let mut s = Vec::new();
    while n > 0 { s.push(D[(n % 36) as usize]); n /= 36; }
    s.reverse();
    String::from_utf8(s).unwrap_or_default()
}

/// Arquivos de um roadmap que entram numa cópia: os fixos e `etapas/*.md`, só arquivo comum (link
/// não é seguido), cada um até [`TAMANHO_MAXIMO`].
fn arquivos_para_copiar(pasta: &Path) -> Vec<String> {
    let comum = |p: &Path| fs::symlink_metadata(p).map(|m| m.file_type().is_file() && m.len() as usize <= TAMANHO_MAXIMO).unwrap_or(false);
    let mut lista: Vec<String> = ARQUIVOS.iter().filter(|a| comum(&pasta.join(a))).map(|a| a.to_string()).collect();
    let etapas = pasta.join("etapas");
    if fs::symlink_metadata(&etapas).map(|m| m.is_dir()).unwrap_or(false) {
        let mut mds: Vec<String> = fs::read_dir(&etapas).map(|itens| itens.flatten()
            .filter_map(|i| i.file_name().to_str().map(|n| format!("etapas/{n}")))
            .filter(|rel| arquivo_valido(rel) && comum(&pasta.join(rel)))
            .collect()).unwrap_or_default();
        mds.sort();
        lista.extend(mds);
    }
    lista
}

/// Copia todos os roadmaps de `raiz` para `destino` (backup da atualização). Devolve quantos
/// arquivos copiou. A pasta `raiz` também não pode ser link.
pub fn copiar_tudo(raiz: &Path, destino: &Path) -> io::Result<usize> {
    if !fs::symlink_metadata(raiz).map(|m| m.is_dir()).unwrap_or(false) { return Ok(0); }
    let mut copiados = 0;
    if fs::symlink_metadata(raiz.join(INDICE)).map(|m| m.file_type().is_file()).unwrap_or(false) {
        fs::create_dir_all(destino)?;
        fs::copy(raiz.join(INDICE), destino.join(INDICE))?;
        copiados += 1;
    }
    for item in fs::read_dir(raiz)?.flatten() {
        let Some(id) = item.file_name().to_str().map(str::to_owned) else { continue };
        if !id_valido(&id) || !item.file_type().map(|t| t.is_dir()).unwrap_or(false) { continue; }
        copiados += copiar_um(&item.path(), &destino.join(&id))?;
    }
    Ok(copiados)
}

fn copiar_um(pasta: &Path, destino: &Path) -> io::Result<usize> {
    let arquivos = arquivos_para_copiar(pasta);
    for rel in &arquivos {
        let alvo = destino.join(rel);
        if let Some(p) = alvo.parent() { fs::create_dir_all(p)?; }
        fs::copy(pasta.join(rel), alvo)?;
    }
    Ok(arquivos.len())
}

/// Antes de migrar o formato de um roadmap: cópia inteira em `<backups>/roadmaps/<id>-v<versão>-<carimbo>/`.
pub fn copiar_antes_de_migrar(raiz: &Path, id: &str, versao_antiga: u32, backups: &Path, carimbo: &str) -> io::Result<PathBuf> {
    let pasta = pasta_do_roadmap(raiz, id)?;
    if !fs::symlink_metadata(&pasta).map(|m| m.is_dir()).unwrap_or(false) { return Err(invalido("Esse roadmap não existe.")); }
    let mut destino = backups.join(PASTA).join(format!("{id}-v{versao_antiga}-{carimbo}"));
    let mut n = 1;
    while destino.exists() { n += 1; destino = backups.join(PASTA).join(format!("{id}-v{versao_antiga}-{carimbo}-{n}")); }
    let _trava = TRAVA.lock().unwrap_or_else(|e| e.into_inner());
    copiar_um(&pasta, &destino)?;
    Ok(destino)
}

/// Arquivos de todos os estudos (fora de qualquer roadmap), na raiz `<dados>/roadmaps/`. O formato é do
/// front (`src/features/roadmaps/`); aqui só lista fechada, JSON válido, tamanho e gravação inteira.
/// - `pomodoros.json`: histórico do Pomodoro;
/// - `mentor.json`: contexto do Mentor de estudo, atividades registradas e a conversa.
pub const ARQUIVOS_GERAIS: &[&str] = &["pomodoros.json", "mentor.json"];

fn caminho_geral(raiz: &Path, nome: &str) -> io::Result<PathBuf> {
    if !ARQUIVOS_GERAIS.contains(&nome) { return Err(invalido("Arquivo de estudos inválido.")); }
    Ok(raiz.join(nome))
}

pub fn ler_geral(raiz: &Path, nome: &str) -> io::Result<Option<String>> {
    let caminho = caminho_geral(raiz, nome)?;
    match fs::symlink_metadata(&caminho) {
        Ok(meta) if !meta.file_type().is_file() => return Err(invalido("Arquivo de estudos inválido.")),
        Ok(meta) if meta.len() as usize > TAMANHO_MAXIMO => return Err(invalido("Arquivo grande demais.")),
        Err(erro) if erro.kind() == io::ErrorKind::NotFound => return Ok(None),
        Err(erro) => return Err(erro),
        Ok(_) => {}
    }
    fs::read_to_string(caminho).map(Some)
}

pub fn gravar_geral(raiz: &Path, nome: &str, conteudo: &str) -> io::Result<()> {
    let destino = caminho_geral(raiz, nome)?;
    conferir_conteudo(nome, conteudo)?;
    let _trava = TRAVA.lock().unwrap_or_else(|e| e.into_inner());
    gravar_atomico(&destino, conteudo.as_bytes())
}

#[cfg(test)]
#[path = "roadmaps_testes.rs"]
mod testes;
