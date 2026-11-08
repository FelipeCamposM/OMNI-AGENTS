use super::*;
use rusqlite::Connection;
use serde_json::json;
use std::{fs, io::Write};

fn base(pasta: &Path) -> Base {
    Base::abrir(&pasta.join("rag/base.db")).unwrap()
}

#[test]
fn indexa_markdown_e_acha_sem_acento_com_resumo_curto() {
    let pasta = tempfile::tempdir().unwrap();
    let arquivo = pasta.path().join("notas.md");
    fs::write(&arquivo, format!("# Gestão\nA política de férias da empresa é de trinta dias.\n{}", "palavra ".repeat(2000))).unwrap();
    let mut base = base(pasta.path());
    let fonte = base.adicionar(&arquivo).unwrap();
    assert_eq!(fonte.estado, "pronto");
    assert!(fonte.trechos > 1);
    let achados = base.buscar("politica ferias", 5).unwrap();
    assert_eq!(achados.len(), 1);
    assert!(achados[0].resumo.contains("férias"));
    assert!(achados[0].resumo.len() < 500);
    assert!(base.ler(achados[0].id).unwrap().unwrap().contains("trinta dias"));
}

#[test]
fn sem_todas_as_palavras_aceita_qualquer_uma_e_consulta_esquisita_nao_quebra() {
    let pasta = tempfile::tempdir().unwrap();
    let arquivo = pasta.path().join("a.txt");
    fs::write(&arquivo, "contrato de aluguel").unwrap();
    let mut base = base(pasta.path());
    base.adicionar(&arquivo).unwrap();
    assert_eq!(base.buscar("contrato inexistente", 5).unwrap().len(), 1);
    assert!(base.buscar("\"* AND (", 5).unwrap().is_empty());
}

#[test]
fn recolocar_o_arquivo_substitui_e_remover_apaga_os_trechos() {
    let pasta = tempfile::tempdir().unwrap();
    let arquivo = pasta.path().join("a.txt");
    fs::write(&arquivo, "versão antiga").unwrap();
    let mut base = base(pasta.path());
    base.adicionar(&arquivo).unwrap();
    fs::write(&arquivo, "versão nova").unwrap();
    let fonte = base.adicionar(&arquivo).unwrap();
    assert_eq!(base.listar().unwrap().len(), 1);
    assert!(base.buscar("antiga", 5).unwrap().is_empty());
    base.remover(fonte.id).unwrap();
    assert!(base.buscar("nova", 5).unwrap().is_empty());
}

#[test]
fn banco_sqlite_com_outra_extensao_vira_conversas_sem_ferramentas_nem_segredos() {
    let pasta = tempfile::tempdir().unwrap();
    let arquivo = pasta.path().join("studio.backup");
    let banco = Connection::open(&arquivo).unwrap();
    banco.execute_batch("
        create table Conversation (id text, title text);
        create table CodeMessage (id text, conversationId text, role text, content text, createdAt text);
        create table User (id text, email text, passwordHash text, name text);
        create table Session (id text, token text);
        insert into Conversation values ('c1', 'Deploy do painel');
        insert into CodeMessage values ('1','c1','user','Como fazer o deploy do painel?','1');
        insert into CodeMessage values ('2','c1','assistant','Use o script publicar.sh na raiz','2');
        insert into CodeMessage values ('3','c1','tool','saidadeferramenta enorme','3');
        insert into User values ('u1','pessoa@exemplo.com','hashsecreto123','Nome grande o bastante para virar uma linha');
        insert into Session values ('s1','tokensecreto456');
    ").unwrap();
    drop(banco);
    let mut base = base(pasta.path());
    let fonte = base.adicionar(&arquivo).unwrap();
    assert_eq!(fonte.tipo, "banco SQLite");
    let achados = base.buscar("publicar", 5).unwrap();
    assert_eq!(achados[0].titulo, "Conversa: Deploy do painel");
    assert!(base.buscar("saidadeferramenta", 5).unwrap().is_empty());
    assert!(base.buscar("hashsecreto123", 5).unwrap().is_empty());
    assert!(base.buscar("tokensecreto456", 5).unwrap().is_empty());
    assert!(!pasta.path().join("studio.backup-wal").exists());
}

#[test]
fn dump_sql_guarda_dados_e_pula_ddl_e_tabela_sensivel() {
    let pasta = tempfile::tempdir().unwrap();
    let arquivo = pasta.path().join("dump.sql");
    fs::write(&arquivo, "SET statement_timeout = 0;\nCREATE TABLE notas (\n  id int,\n  corpo text\n);\n\
        INSERT INTO notas VALUES (1, 'reunião de planejamento');\n\
        INSERT INTO sessions VALUES ('abc', 'tokenvazado999');\n\
        COPY public.clientes (id, nome) FROM stdin;\n1\tMaria Cliente\n\\.\n\
        COPY public.user_tokens (id, valor) FROM stdin;\n1\toutrotokenvazado\n\\.\n").unwrap();
    let mut base = base(pasta.path());
    assert_eq!(base.adicionar(&arquivo).unwrap().tipo, "dump SQL");
    assert_eq!(base.buscar("planejamento", 5).unwrap().len(), 1);
    assert_eq!(base.buscar("Maria", 5).unwrap().len(), 1);
    assert!(base.buscar("statement_timeout", 5).unwrap().is_empty());
    assert!(base.buscar("corpo", 5).unwrap().is_empty());
    assert!(base.buscar("tokenvazado999", 5).unwrap().is_empty());
    assert!(base.buscar("outrotokenvazado", 5).unwrap().is_empty());
}

fn zip_com(caminho: &Path, entradas: &[(&str, &[u8])]) {
    let mut pacote = zip::ZipWriter::new(fs::File::create(caminho).unwrap());
    for (nome, dados) in entradas {
        pacote.start_file(*nome, zip::write::SimpleFileOptions::default()).unwrap();
        pacote.write_all(dados).unwrap();
    }
    pacote.finish().unwrap();
}

#[test]
fn le_docx_zip_e_gzip() {
    let pasta = tempfile::tempdir().unwrap();
    let docx = pasta.path().join("relatorio.docx");
    zip_com(&docx, &[("word/document.xml", "<w:p><w:r><w:t>Balanço anual &amp; metas</w:t></w:r></w:p>".as_bytes())]);
    let compactado = pasta.path().join("pacote.zip");
    zip_com(&compactado, &[("../fora/leia.md", b"conteudo escondido no zip")]);
    let gz = pasta.path().join("texto.txt.gz");
    let mut escritor = flate2::write::GzEncoder::new(fs::File::create(&gz).unwrap(), flate2::Compression::default());
    escritor.write_all(b"mensagem dentro do gzip").unwrap();
    escritor.finish().unwrap();
    let mut base = base(pasta.path());
    for arquivo in [&docx, &compactado, &gz] {
        assert_eq!(base.adicionar(arquivo).unwrap().estado, "pronto", "{arquivo:?}");
    }
    assert_eq!(base.buscar("balanco", 5).unwrap().len(), 1);
    assert_eq!(base.buscar("escondido", 5).unwrap().len(), 1);
    assert_eq!(base.buscar("gzip", 5).unwrap().len(), 1);
    assert!(!pasta.path().parent().unwrap().join("fora").exists());
}

#[test]
fn formato_desconhecido_e_pgdump_viram_erro_claro_sem_derrubar() {
    let pasta = tempfile::tempdir().unwrap();
    let binario = pasta.path().join("x.bin");
    fs::write(&binario, [0u8, 1, 2, 3, 0, 9]).unwrap();
    let pg = pasta.path().join("banco.backup");
    fs::write(&pg, b"PGDMP\x01\x0e\x00rest").unwrap();
    let mut base = base(pasta.path());
    assert_eq!(base.adicionar(&binario).unwrap().estado, "erro");
    assert!(base.adicionar(&pg).unwrap().erro.unwrap().contains("pg_dump"));
}

#[test]
fn segredos_saem_do_texto_antes_de_indexar() {
    let limpo = sem_segredos("chave sk-ant-api03-abcdefghijklmnopqrstuvwx e postgres://user:senha123@host/db e ghp_abcdefghijklmnopqrstuvwxyz123456");
    assert!(!limpo.contains("sk-ant") && !limpo.contains("senha123") && !limpo.contains("ghp_"));
    assert_eq!(sem_segredos("texto normal sem nada"), "texto normal sem nada");
}

#[test]
fn mcp_lista_busca_le_e_ignora_notificacao() {
    let pasta = tempfile::tempdir().unwrap();
    let arquivo = pasta.path().join("a.md");
    fs::write(&arquivo, "o servidor de homologação fica no rack dois").unwrap();
    let mut base = base(pasta.path());
    base.adicionar(&arquivo).unwrap();
    assert!(mcp::responder(&base, &json!({"method": "notifications/initialized"})).is_none());
    let ferramentas = mcp::responder(&base, &json!({"id": 1, "method": "tools/list"})).unwrap();
    assert_eq!(ferramentas["result"]["tools"].as_array().unwrap().len(), 15, "sem as 2 de tarefas externas (não trazidas do fork)");
    let busca = mcp::responder(&base, &json!({"id": 2, "method": "tools/call", "params": {"name": "buscar_conhecimento", "arguments": {"consulta": "homologacao"}}})).unwrap();
    let texto = busca["result"]["content"][0]["text"].as_str().unwrap();
    assert!(texto.starts_with('#') && texto.contains("rack"));
    let id: i64 = texto[1..].split_whitespace().next().unwrap().parse().unwrap();
    let leitura = mcp::responder(&base, &json!({"id": 3, "method": "tools/call", "params": {"name": "ler_trecho", "arguments": {"id": id}}})).unwrap();
    assert!(leitura["result"]["content"][0]["text"].as_str().unwrap().contains("rack dois"));
}
