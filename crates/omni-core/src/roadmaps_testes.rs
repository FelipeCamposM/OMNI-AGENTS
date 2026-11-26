use super::*;
use serde_json::json;

fn novo(raiz: &Path, nome: &str) -> String {
    criar(raiz, &json!({ "versao": 1, "nome": nome }), 1_760_000_000_000, 0xabcd).unwrap()
}

#[test]
fn criar_listar_e_reler_depois_de_reabrir() {
    let dir = tempfile::tempdir().unwrap();
    let raiz = dir.path().join(PASTA);
    let a = novo(&raiz, "Vendas");
    let b = novo(&raiz, "Inglês");
    assert_ne!(a, b);
    gravar(&raiz, &a, "plano.json", r#"{"versao":1,"modulos":[]}"#).unwrap();
    gravar(&raiz, &a, "etapas/e-1.md", "# Rapport\n\nTexto.").unwrap();
    gravar(&raiz, &a, "caderno.md", "## O que aprendi\n\nRapport vem antes.").unwrap();
    anexar_na_conversa(&raiz, &a, r#"{"de":"eu","texto":"oi"}"#).unwrap();
    anexar_na_conversa(&raiz, &a, r#"{"de":"ia","texto":"olá"}"#).unwrap();

    // "Reabrir": só a pasta sobra entre uma leitura e outra.
    let lista = listar(&raiz);
    assert_eq!(lista.iter().map(|i| i.id.as_str()).collect::<Vec<_>>(), [b.as_str(), a.as_str()], "o novo entra no começo");
    assert_eq!(lista[1].meta["nome"], "Vendas");
    assert_eq!(lista[1].meta["id"], a.as_str());
    assert_eq!(ler(&raiz, &a, "etapas/e-1.md").unwrap().unwrap(), "# Rapport\n\nTexto.");
    assert_eq!(ler(&raiz, &a, "conversa.jsonl").unwrap().unwrap().lines().count(), 2);
    assert_eq!(ler(&raiz, &a, "cards.json").unwrap(), None, "arquivo que ainda não existe");
    assert!(ler(&raiz, &a, "caderno.md").unwrap().unwrap().contains("Rapport vem antes"));
}

#[test]
fn ordem_salva_e_pasta_fora_do_indice_nao_some() {
    let dir = tempfile::tempdir().unwrap();
    let raiz = dir.path().join(PASTA);
    let a = novo(&raiz, "A");
    let b = novo(&raiz, "B");
    ordenar(&raiz, &[a.clone(), b.clone()]).unwrap();
    assert_eq!(listar(&raiz)[0].id, a);
    fs::remove_file(raiz.join(INDICE)).unwrap();
    let ids: Vec<String> = listar(&raiz).into_iter().map(|i| i.id).collect();
    assert_eq!(ids.len(), 2, "sem índice, as pastas continuam na lista");
    fs::write(raiz.join(INDICE), "{ quebrado").unwrap();
    assert_eq!(listar(&raiz).len(), 2, "índice corrompido também não esconde nada");
}

#[test]
fn recusa_nome_fora_da_lista_json_invalido_e_caminho_para_fora() {
    let dir = tempfile::tempdir().unwrap();
    let raiz = dir.path().join(PASTA);
    let a = novo(&raiz, "A");
    for arquivo in ["../fora.json", "engine.token", "etapas/../meta.json", "etapas/A.md", "etapas/x.txt", "meta.json/"] {
        assert!(gravar(&raiz, &a, arquivo, "{}").is_err(), "{arquivo}");
    }
    for id in ["..", "../x", "A", "-x", "", "a/b"] {
        assert!(gravar(&raiz, id, "meta.json", "{}").is_err(), "{id}");
    }
    assert!(gravar(&raiz, &a, "plano.json", "{ não é json").is_err());
    assert!(gravar(&raiz, "r-nao-existe", "plano.json", "{}").is_err(), "não cria roadmap pela porta dos fundos");
    assert!(anexar_na_conversa(&raiz, &a, "texto solto").is_err());
    assert!(anexar_na_conversa(&raiz, &a, "{\"a\":1}\n{\"b\":2}").is_err(), "uma linha por vez");
    // O que já estava gravado continua inteiro.
    assert_eq!(serde_json::from_str::<serde_json::Value>(&ler(&raiz, &a, "meta.json").unwrap().unwrap()).unwrap()["nome"], "A");
}

#[test]
fn gravacao_substitui_inteira_e_nao_deixa_temporario() {
    let dir = tempfile::tempdir().unwrap();
    let raiz = dir.path().join(PASTA);
    let a = novo(&raiz, "A");
    gravar(&raiz, &a, "progresso.json", r#"{"versao":1,"etapas":{"e-1":{"estado":"concluida"}}}"#).unwrap();
    gravar(&raiz, &a, "progresso.json", r#"{"versao":1,"etapas":{}}"#).unwrap();
    assert_eq!(ler(&raiz, &a, "progresso.json").unwrap().unwrap(), r#"{"versao":1,"etapas":{}}"#);
    let sobras: Vec<_> = fs::read_dir(raiz.join(&a)).unwrap().flatten().filter(|i| i.file_name().to_string_lossy().ends_with(".tmp")).collect();
    assert!(sobras.is_empty());
}

#[cfg(unix)]
#[test]
fn link_nao_e_lido_nem_copiado() {
    let dir = tempfile::tempdir().unwrap();
    let raiz = dir.path().join(PASTA);
    let a = novo(&raiz, "A");
    fs::write(dir.path().join("segredo.json"), "{\"x\":1}").unwrap();
    std::os::unix::fs::symlink(dir.path().join("segredo.json"), raiz.join(&a).join("cards.json")).unwrap();
    assert!(ler(&raiz, &a, "cards.json").is_err());
    let destino = dir.path().join("copia");
    copiar_tudo(&raiz, &destino).unwrap();
    assert!(!destino.join(&a).join("cards.json").exists());
    assert!(destino.join(&a).join("meta.json").exists());
}

#[test]
fn copia_de_tudo_e_antes_de_migrar() {
    let dir = tempfile::tempdir().unwrap();
    let raiz = dir.path().join(PASTA);
    let a = novo(&raiz, "A");
    gravar(&raiz, &a, "cards.json", r#"{"versao":1,"cards":[]}"#).unwrap();
    gravar(&raiz, &a, "etapas/e-1.md", "resumo").unwrap();
    fs::write(raiz.join(&a).join("estranho.bin"), "x").unwrap();
    let destino = dir.path().join("backup").join(PASTA);
    assert_eq!(copiar_tudo(&raiz, &destino).unwrap(), 4, "índice + meta + cards + etapa");
    assert!(!destino.join(&a).join("estranho.bin").exists(), "só o que está na lista");
    assert_eq!(fs::read_to_string(destino.join(&a).join("etapas/e-1.md")).unwrap(), "resumo");

    let backups = dir.path().join("omni-backups");
    let um = copiar_antes_de_migrar(&raiz, &a, 1, &backups, "20261021-120000").unwrap();
    let dois = copiar_antes_de_migrar(&raiz, &a, 1, &backups, "20261021-120000").unwrap();
    assert_ne!(um, dois, "duas cópias no mesmo segundo não se misturam");
    assert!(um.join("cards.json").is_file() && um.join("etapas/e-1.md").is_file());
    assert!(copiar_antes_de_migrar(&raiz, "r-nao-existe", 1, &backups, "x").is_err());
}

#[test]
fn sem_pasta_ainda_a_lista_e_vazia() {
    let dir = tempfile::tempdir().unwrap();
    assert!(listar(&dir.path().join(PASTA)).is_empty());
    assert_eq!(copiar_tudo(&dir.path().join(PASTA), &dir.path().join("x")).unwrap(), 0);
}

#[test]
fn arquivos_gerais_gravam_inteiros_so_da_lista_e_recusam_json_quebrado() {
    let dir = tempfile::tempdir().unwrap();
    let raiz = dir.path().join(PASTA);
    assert_eq!(ler_geral(&raiz, "pomodoros.json").unwrap(), None);
    gravar_geral(&raiz, "pomodoros.json", "{\"versao\":1,\"sessoes\":[]}").unwrap();
    assert_eq!(ler_geral(&raiz, "pomodoros.json").unwrap().as_deref(), Some("{\"versao\":1,\"sessoes\":[]}"));
    gravar_geral(&raiz, "mentor.json", "{}").unwrap();
    assert!(gravar_geral(&raiz, "pomodoros.json", "{quebrado").is_err());
    for nome in ["../sessions.json", "indice.json", "engine.token", "outro.json"] {
        assert!(gravar_geral(&raiz, nome, "{}").is_err(), "{nome}");
        assert!(ler_geral(&raiz, nome).is_err(), "{nome}");
    }
    assert!(listar(&raiz).is_empty(), "arquivo geral não vira roadmap na lista");
}
