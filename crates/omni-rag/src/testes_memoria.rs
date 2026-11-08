use super::memoria::*;
use super::*;
use serde_json::json;
use std::fs;

fn base(pasta: &Path) -> Base {
    Base::abrir(&pasta.join("rag/base.db")).unwrap()
}

fn nota(titulo: &str, corpo: &str, projeto: &str) -> Nota {
    Nota { titulo: titulo.into(), corpo: corpo.into(), projeto: projeto.into(), origem: "auto".into(), ..Nota::default() }
}

#[test]
fn pedido_traz_notas_ligadas_com_as_do_projeto_primeiro_e_limite_de_tamanho() {
    let pasta = tempfile::tempdir().unwrap();
    let base = base(pasta.path());
    base.gravar_nota(&nota("Deploy do painel", "Outro projeto usa o script publicar", "website")).unwrap();
    base.gravar_nota(&nota("Deploy da central", &format!("A central publica pela esteira. {}", "detalhe ".repeat(300)), "projeto_a")).unwrap();
    base.gravar_nota(&nota("Receita de bolo", "Nada a ver", "projeto_a")).unwrap();
    let contexto = contexto_do_pedido(&base, "como fazer o deploy em produção?", "projeto_a");
    assert!(contexto.contains("não instruções"));
    let daqui = contexto.find("Deploy da central").unwrap();
    assert!(daqui < contexto.find("Deploy do painel").unwrap());
    assert!(!contexto.contains("bolo"));
    assert!(contexto.chars().count() < 1500);
}

#[test]
fn pedido_curto_ou_sem_assunto_nao_gasta_tokens() {
    let pasta = tempfile::tempdir().unwrap();
    let base = base(pasta.path());
    base.gravar_nota(&nota("Deploy", "corpo da nota de deploy", "x")).unwrap();
    assert_eq!(contexto_do_pedido(&base, "ok", "x"), "");
    assert_eq!(contexto_do_pedido(&base, "pode fazer isso agora", "x"), "");
}

#[test]
fn passada_grava_acrescenta_limita_a_duas_e_ignora_lixo() {
    let pasta = tempfile::tempdir().unwrap();
    let base = base(pasta.path());
    base.gravar_nota(&Nota { slug: "ja-existe".into(), ..nota("Já existe", "corpo antigo da nota", "p") }).unwrap();
    let resposta = json!({"notes": [
        {"op": "append", "slug": "ja-existe", "title": "Já existe", "body": "fato novo acrescentado aqui"},
        {"op": "write", "title": "Decisão de banco", "body": "Usamos SQLite porque é local. chave sk-ant-api03-abcdefghijklmnopqrstuvwxyz", "tags": ["banco"]},
        {"op": "write", "title": "Terceira nota", "body": "não pode entrar porque passou do limite"}
    ]}).to_string();
    assert_eq!(base.aplicar_passada(&format!("aqui está: {resposta}"), "p", "c1"), 2);
    assert!(base.nota("ja-existe").unwrap().corpo.contains("fato novo"));
    let nova = base.nota("decisao-de-banco").unwrap();
    assert_eq!((nova.projeto.as_str(), nova.conversa.as_str(), nova.tags.as_str()), ("p", "c1", "banco"));
    assert!(!nova.corpo.contains("sk-ant"));
    assert!(base.nota("terceira-nota").is_none());
    assert_eq!(base.aplicar_passada("não é json", "p", "c"), 0);
    assert_eq!(base.aplicar_passada(r#"{"notes":[{"title":"x","body":"curto"}]}"#, "p", "c"), 0);
}

#[test]
fn titulo_repetido_vira_acrescimo() {
    let pasta = tempfile::tempdir().unwrap();
    let base = base(pasta.path());
    base.aplicar_passada(r#"{"notes":[{"op":"write","title":"Regra de deploy","body":"sempre publicar pela esteira"}]}"#, "projeto_b", "a");
    base.aplicar_passada(r#"{"notes":[{"op":"write","title":"Regra de deploy","body":"nunca publicar na sexta-feira"}]}"#, "projeto_b", "b");
    assert_eq!(base.total_de_notas(), 1);
    assert_eq!(base.notas_relacionadas("publicar sexta", "Projeto B", 3).len(), 1);
    let corpo = base.nota("regra-de-deploy").unwrap().corpo;
    assert!(corpo.contains("esteira") && corpo.contains("sexta"));
}

#[test]
fn turno_e_o_ultimo_pedido_digitado_com_resposta_e_ferramentas() {
    let linhas = [
        json!({"type": "user", "message": {"content": "pedido antigo"}}),
        json!({"type": "assistant", "message": {"content": [{"type": "text", "text": "resposta antiga"}]}}),
        json!({"type": "user", "isMeta": true, "message": {"content": "gancho"}}),
        json!({"type": "user", "message": {"content": [{"type": "text", "text": "pedido novo"}]}}),
        json!({"type": "assistant", "message": {"content": [{"type": "tool_use", "name": "Bash"}]}}),
        json!({"type": "user", "message": {"content": [{"type": "tool_result", "content": "saída"}]}}),
        json!({"type": "assistant", "message": {"content": [{"type": "text", "text": "feito"}]}}),
    ].map(|linha| linha.to_string()).join("\n");
    let turno = ultimo_turno(&format!("{linhas}\nlinha quebrada")).unwrap();
    assert_eq!(turno.pedido, "pedido novo");
    assert_eq!(turno.ferramentas, ["Bash"]);
    assert_eq!(turno.resposta.trim(), "feito");
    assert!(ultimo_turno(&json!({"type": "user", "message": {"content": "só oi"}}).to_string()).is_none());
}

#[test]
fn importa_markdown_do_cofre_com_frontmatter_e_e_idempotente() {
    let pasta = tempfile::tempdir().unwrap();
    let cofre = pasta.path().join("cofre");
    fs::create_dir_all(&cofre).unwrap();
    fs::write(cofre.join("a.md"), "---\ntitle: \"Regra do RH\"\ntags: [\"central\", \"rh\"]\nproject: projeto_a\nsource: auto\n---\n\nCorpo da regra de férias").unwrap();
    fs::write(cofre.join("b.md"), "# Sem cabeçalho\ncorpo").unwrap();
    fs::write(cofre.join("c.txt"), "ignorado").unwrap();
    let base = base(pasta.path());
    assert_eq!(base.importar_notas(&cofre).unwrap(), 2);
    assert_eq!(base.importar_notas(&cofre).unwrap(), 2);
    assert_eq!(base.total_de_notas(), 2);
    let nota = base.nota("importada-a").unwrap();
    assert_eq!((nota.titulo.as_str(), nota.projeto.as_str(), nota.tags.as_str()), ("Regra do RH", "projeto_a", "central, rh"));
    assert_eq!(base.notas_relacionadas("regra de ferias", "projeto_a", 3).len(), 1);
    assert_eq!(base.indice_de_notas("projeto_a", 5)[0].1, "Regra do RH");
    assert!(contexto_de_inicio(&base, "projeto_a").contains("Regra do RH"));
    assert_eq!(contexto_de_inicio(&base, "outro"), "");
}

#[test]
fn ganchos_entregam_contexto_guardam_o_resumo_e_respeitam_o_interruptor() {
    use crate::ganchos::{ligar_memoria, memoria_ligada, responder};
    let pasta = tempfile::tempdir().unwrap();
    let base = base(pasta.path());
    base.gravar_nota(&nota("Deploy da central", "A central publica pela esteira", "projeto_a")).unwrap();
    let pedido = json!({"cwd": "/x/projeto_a", "prompt": "como faço o deploy da central?"});
    let saida: serde_json::Value = serde_json::from_str(&responder(&base, "prompt", &pedido).unwrap()).unwrap();
    assert_eq!(saida["hookSpecificOutput"]["hookEventName"], "UserPromptSubmit");
    assert!(saida["hookSpecificOutput"]["additionalContext"].as_str().unwrap().contains("esteira"));
    assert!(responder(&base, "prompt", &json!({"cwd": "/x", "prompt": "ok"})).is_none());
    assert!(responder(&base, "inicio", &json!({"cwd": "/x/projeto_a"})).unwrap().contains("SessionStart"));
    let compactou = json!({"cwd": "/x/projeto_a", "session_id": "s1", "compact_summary": "decidimos usar a fila nova"});
    assert!(responder(&base, "compactou", &compactou).is_none());
    responder(&base, "compactou", &json!({"cwd": "/x/projeto_a", "session_id": "s1", "compact_summary": "segundo resumo da sessão"}));
    let resumo = base.nota("resumo-s1").unwrap();
    assert!(resumo.corpo.contains("fila nova") && resumo.corpo.contains("segundo resumo"));
    let caminho = pasta.path().join("rag/base.db");
    assert!(memoria_ligada(&caminho));
    ligar_memoria(&caminho, false).unwrap();
    assert!(!memoria_ligada(&caminho));
    ligar_memoria(&caminho, true).unwrap();
    assert!(memoria_ligada(&caminho));
}
