//! Base de conhecimento local do OMNI: arquivos viram trechos num índice FTS5. A busca devolve só
//! trechos curtos, e o agente pede o trecho inteiro quando precisa — é isso que economiza tokens.
pub mod engine;
pub mod extrair;
pub mod ganchos;
pub mod mcp;
pub mod mcp_fluxos;
pub mod mcp_historico;
pub mod memoria;

use regex::Regex;
use rusqlite::{params, Connection};
use serde::Serialize;
use std::{
    path::{Path, PathBuf},
    sync::OnceLock,
    time::{SystemTime, UNIX_EPOCH},
};

const LOTE: usize = 2000;
const PALAVRAS_NO_RESUMO: i32 = 40;

#[derive(Debug, Clone, Serialize)]
pub struct Fonte {
    pub id: i64,
    pub nome: String,
    pub caminho: String,
    pub tipo: String,
    pub tamanho: i64,
    pub trechos: i64,
    pub estado: String,
    pub erro: Option<String>,
    pub criado_em_ms: i64,
}

#[derive(Debug, Clone, Serialize)]
pub struct Resultado {
    pub id: i64,
    pub fonte: String,
    pub titulo: String,
    pub resumo: String,
}

pub struct Base {
    banco: Connection,
}

/// Onde a base mora: junto dos dados do OMNI, fora de qualquer projeto.
pub fn caminho_padrao() -> Option<PathBuf> {
    let var = |nome| std::env::var_os(nome).map(PathBuf::from);
    let dados = if cfg!(windows) {
        var("LOCALAPPDATA")
    } else if cfg!(target_os = "macos") {
        var("HOME").map(|home| home.join("Library/Application Support"))
    } else {
        var("XDG_DATA_HOME").or_else(|| var("HOME").map(|home| home.join(".local/share")))
    };
    Some(dados?.join("com.omni.agents").join("rag").join("base.db"))
}

pub fn agora_ms() -> i64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map_or(0, |tempo| tempo.as_millis() as i64)
}

/// Tira do texto o que parece credencial antes de indexar: dump e conversa colam chave sem querer.
pub fn sem_segredos(texto: &str) -> String {
    static PADROES: OnceLock<Regex> = OnceLock::new();
    let padroes = PADROES.get_or_init(|| {
        Regex::new(r"(?x)
            sk-[A-Za-z0-9_-]{20,} | [sr]k_(?:live|test)_[A-Za-z0-9]{16,} | gh[pousr]_[A-Za-z0-9]{20,} | github_pat_[A-Za-z0-9_]{20,} | AKIA[0-9A-Z]{16}
            | xox[baprs]-[A-Za-z0-9-]{10,} | eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}
            | (?i:bearer\s+[A-Za-z0-9._~+/-]{20,})
            | (?s:-----BEGIN[A-Z\ ]*PRIVATE\ KEY-----.*?-----END[A-Z\ ]*PRIVATE\ KEY-----)
            | (?i:(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis)://[^\s:@/]+:[^\s@/]+@)").unwrap()
    });
    padroes.replace_all(texto, "[segredo removido]").into_owned()
}

impl Base {
    pub fn abrir(caminho: &Path) -> Result<Self, String> {
        if let Some(pasta) = caminho.parent() {
            std::fs::create_dir_all(pasta).map_err(|erro| erro.to_string())?;
        }
        let banco = Connection::open(caminho).map_err(|erro| erro.to_string())?;
        banco.busy_timeout(std::time::Duration::from_secs(10)).map_err(|erro| erro.to_string())?;
        banco.execute_batch("
            pragma journal_mode = wal;
            create table if not exists fontes (
                id integer primary key, nome text not null, caminho text not null, tipo text not null default '',
                tamanho integer not null default 0, trechos integer not null default 0,
                estado text not null, erro text, criado_em_ms integer not null);
            create virtual table if not exists trechos using fts5(
                texto, titulo, fonte_id unindexed, tokenize = 'unicode61 remove_diacritics 2');
        ").map_err(|erro| erro.to_string())?;
        banco.execute_batch(memoria::ESQUEMA).map_err(|erro| erro.to_string())?;
        Ok(Self { banco })
    }

    fn atualizar(&self, id: i64, trechos: i64, estado: &str, tipo: &str, erro: Option<&str>) -> Result<(), String> {
        self.banco.execute("update fontes set trechos = ?2, estado = ?3, tipo = ?4, erro = ?5 where id = ?1", params![id, trechos, estado, tipo, erro])
            .map(|_| ()).map_err(|erro| erro.to_string())
    }

    /// Importa um arquivo. Recolocar o mesmo arquivo substitui a versão anterior.
    pub fn adicionar(&mut self, caminho: &Path) -> Result<Fonte, String> {
        let tamanho = std::fs::metadata(caminho).map_err(|erro| erro.to_string())?.len() as i64;
        let nome = caminho.file_name().map_or_else(|| caminho.to_string_lossy().into_owned(), |valor| valor.to_string_lossy().into_owned());
        let texto_do_caminho = caminho.to_string_lossy().into_owned();
        let antigas: Vec<i64> = self.banco.prepare("select id from fontes where caminho = ?1").and_then(|mut pedido| {
            let lista = pedido.query_map([&texto_do_caminho], |linha| linha.get(0))?.flatten().collect();
            Ok(lista)
        }).map_err(|erro| erro.to_string())?;
        for antiga in antigas { self.remover(antiga)?; }
        self.banco.execute("insert into fontes (nome, caminho, tamanho, estado, criado_em_ms) values (?1, ?2, ?3, 'importando', ?4)",
            params![nome, texto_do_caminho, tamanho, agora_ms()]).map_err(|erro| erro.to_string())?;
        let id = self.banco.last_insert_rowid();

        let mut pendentes: Vec<extrair::Pedaco> = Vec::with_capacity(LOTE);
        let mut total = 0i64;
        let mut falha: Option<String> = None;
        let banco = &self.banco;
        let gravar = |pendentes: &mut Vec<extrair::Pedaco>, total: &mut i64| -> Result<(), String> {
            let transacao = banco.unchecked_transaction().map_err(|erro| erro.to_string())?;
            {
                let mut inserir = transacao.prepare_cached("insert into trechos (texto, titulo, fonte_id) values (?1, ?2, ?3)").map_err(|erro| erro.to_string())?;
                for pedaco in pendentes.drain(..) {
                    inserir.execute(params![sem_segredos(&pedaco.texto), sem_segredos(&pedaco.titulo), id]).map_err(|erro| erro.to_string())?;
                    *total += 1;
                }
            }
            transacao.execute("update fontes set trechos = ?2 where id = ?1", params![id, *total]).map_err(|erro| erro.to_string())?;
            transacao.commit().map_err(|erro| erro.to_string())
        };
        let resultado = extrair::extrair(caminho, &mut |pedaco| {
            pendentes.push(pedaco);
            if pendentes.len() >= LOTE && falha.is_none() {
                if let Err(erro) = gravar(&mut pendentes, &mut total) { falha = Some(erro); }
            }
        });
        if falha.is_none() {
            if let Err(erro) = gravar(&mut pendentes, &mut total) { falha = Some(erro); }
        }
        match resultado.map_err(|erro| falha.clone().unwrap_or(erro)) {
            Ok(_) if falha.is_some() => self.falhou(id, falha.as_deref().unwrap_or_default())?,
            Ok(_) if total == 0 => self.falhou(id, "nenhum texto encontrado neste arquivo")?,
            Ok(tipo) => self.atualizar(id, total, "pronto", &tipo, None)?,
            Err(erro) => self.falhou(id, &erro)?,
        }
        self.fonte(id)
    }

    /// Importação que morreu com o app: sem isto ficaria "importando" para sempre.
    pub fn marcar_interrompidas(&self) -> Result<(), String> {
        let presas: Vec<i64> = self.listar()?.iter().filter(|fonte| fonte.estado == "importando").map(|fonte| fonte.id).collect();
        presas.into_iter().try_for_each(|id| self.falhou(id, "importação interrompida: adicione o arquivo de novo"))
    }

    fn falhou(&self, id: i64, motivo: &str) -> Result<(), String> {
        self.banco.execute("delete from trechos where fonte_id = ?1", [id]).map_err(|erro| erro.to_string())?;
        self.atualizar(id, 0, "erro", "", Some(motivo))
    }

    fn fonte(&self, id: i64) -> Result<Fonte, String> {
        self.listar()?.into_iter().find(|fonte| fonte.id == id).ok_or_else(|| "fonte não encontrada".to_string())
    }

    pub fn listar(&self) -> Result<Vec<Fonte>, String> {
        let mut pedido = self.banco.prepare("select id, nome, caminho, tipo, tamanho, trechos, estado, erro, criado_em_ms from fontes order by criado_em_ms desc, id desc").map_err(|erro| erro.to_string())?;
        let fontes = pedido.query_map([], |linha| Ok(Fonte {
            id: linha.get(0)?, nome: linha.get(1)?, caminho: linha.get(2)?, tipo: linha.get(3)?, tamanho: linha.get(4)?,
            trechos: linha.get(5)?, estado: linha.get(6)?, erro: linha.get(7)?, criado_em_ms: linha.get(8)?,
        })).map_err(|erro| erro.to_string())?.flatten().collect();
        Ok(fontes)
    }

    pub fn remover(&self, id: i64) -> Result<(), String> {
        self.banco.execute("delete from trechos where fonte_id = ?1", [id]).map_err(|erro| erro.to_string())?;
        self.banco.execute("delete from fontes where id = ?1", [id]).map(|_| ()).map_err(|erro| erro.to_string())
    }

    /// Exige todas as palavras; sem resultado, aceita qualquer uma. Volta só resumos curtos.
    pub fn buscar(&self, consulta: &str, limite: usize) -> Result<Vec<Resultado>, String> {
        let termos: Vec<String> = consulta.split(|letra: char| !letra.is_alphanumeric()).filter(|termo| termo.chars().count() >= 2)
            .map(|termo| format!("\"{termo}\"")).collect();
        if termos.is_empty() { return Ok(Vec::new()); }
        let todas = self.consultar(&termos.join(" "), limite)?;
        if !todas.is_empty() || termos.len() == 1 { return Ok(todas); }
        self.consultar(&termos.join(" OR "), limite)
    }

    fn consultar(&self, expressao: &str, limite: usize) -> Result<Vec<Resultado>, String> {
        let pedido = format!("select rowid, (select nome from fontes where id = fonte_id), titulo, snippet(trechos, 0, '', '', '…', {PALAVRAS_NO_RESUMO})
            from trechos where trechos match ?1 order by bm25(trechos, 1.0, 2.0) limit ?2");
        let mut consulta = self.banco.prepare_cached(&pedido).map_err(|erro| erro.to_string())?;
        let linhas = consulta.query_map(params![expressao, limite as i64], |linha| Ok(Resultado {
            id: linha.get(0)?, fonte: linha.get(1)?, titulo: linha.get(2)?, resumo: linha.get(3)?,
        })).map_err(|erro| erro.to_string())?;
        Ok(linhas.flatten().collect())
    }

    pub fn ler(&self, id: i64) -> Result<Option<String>, String> {
        match self.banco.query_row("select texto from trechos where rowid = ?1", [id], |linha| linha.get(0)) {
            Ok(texto) => Ok(Some(texto)),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(erro) => Err(erro.to_string()),
        }
    }
}

#[cfg(test)]
mod testes;
#[cfg(test)]
mod testes_memoria;
#[cfg(test)]
mod testes_mcp;
