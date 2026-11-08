//! Ferramentas de fluxos e histórico contra um engine falso, numa porta local, e pastas temporárias.
use crate::{engine::{api, segmento, Contexto}, mcp_fluxos, mcp_historico, Base};
use serde_json::{json, Value};
use std::{
    fs,
    io::{BufRead, BufReader, Write},
    net::TcpListener,
    path::Path,
    sync::{Arc, Mutex},
    thread,
};
use tempfile::{tempdir, TempDir};

type Pedidos = Arc<Mutex<Vec<Value>>>;

/// Responde cada rota com o corpo pedido e guarda o que recebeu. Rota desconhecida devolve 404.
fn engine_falso(rotas: Vec<(&'static str, u16, Value)>) -> (u16, Pedidos) {
    let ouvinte = TcpListener::bind("127.0.0.1:0").expect("porta");
    let porta = ouvinte.local_addr().expect("endereço").port();
    let pedidos: Pedidos = Arc::default();
    let guardados = pedidos.clone();
    thread::spawn(move || {
        for conexao in ouvinte.incoming().flatten() {
            let mut linha = String::new();
            if BufReader::new(&conexao).read_line(&mut linha).is_err() { continue; }
            let pedido: Value = serde_json::from_str(&linha).expect("json");
            let chave = format!("{} {}", pedido["method"].as_str().unwrap_or(""), pedido["path"].as_str().unwrap_or(""));
            guardados.lock().expect("pedidos").push(pedido);
            let (status, corpo) = rotas.iter().find(|(rota, _, _)| *rota == chave)
                .map_or((404, json!({"error": "rota inexistente"})), |(_, status, corpo)| (*status, corpo.clone()));
            let mut saida = &conexao;
            let _ = writeln!(saida, "{}", json!({"type": "api", "status": status, "body": corpo.to_string()}));
        }
    });
    (porta, pedidos)
}

struct Ambiente { _pasta: TempDir, contexto: Contexto }

fn ambiente(porta: u16) -> Ambiente {
    let pasta = tempdir().expect("pasta");
    let raiz = pasta.path().to_path_buf();
    fs::create_dir_all(raiz.join("engine")).expect("engine");
    fs::write(raiz.join("engine/engine.token"), "segredo-do-teste\n").expect("token");
    fs::create_dir_all(raiz.join("projeto")).expect("projeto");
    let contexto = Contexto {
        pasta_do_engine: raiz.join("engine"), porta,
        fluxos_globais: Some(raiz.join("fluxos")), agentes_globais: Some(raiz.join("agentes")),
        pasta_atual: Some(raiz.join("projeto")),
    };
    Ambiente { _pasta: pasta, contexto }
}

/// Comando atrás de uma Aprovação: o formato que o agente pode criar e rodar.
fn fluxo_de_comando() -> Value {
    json!({"id": "teste-mcp", "nome": "Teste", "descricao": "d", "nos": [
        {"id": "e", "tipo": "entrada", "titulo": "Entrada", "x": 0, "y": 0},
        {"id": "ok", "tipo": "aprovacao", "titulo": "Pode?", "x": 1, "y": 0},
        {"id": "c", "tipo": "comando", "titulo": "Eco", "config": {"comando": "echo ok"}, "x": 2, "y": 0},
        {"id": "f", "tipo": "fim", "titulo": "Fim", "x": 3, "y": 0}
    ], "conexoes": [{"de": "e", "para": "ok"}, {"de": "ok", "para": "c", "saida": "sim"}, {"de": "ok", "para": "f", "saida": "nao"},
        {"de": "c", "para": "f", "saida": "sim"}, {"de": "c", "para": "f", "saida": "nao"}, {"de": "c", "para": "f", "saida": "esgotado"}]})
}

fn sem_aprovacao() -> Value {
    json!({"id": "perigoso", "nome": "Perigoso", "descricao": "d", "nos": [
        {"id": "e", "tipo": "entrada", "titulo": "Entrada", "x": 0, "y": 0},
        {"id": "c", "tipo": "comando", "titulo": "Eco", "config": {"comando": "echo ok"}, "x": 1, "y": 0},
        {"id": "f", "tipo": "fim", "titulo": "Fim", "x": 2, "y": 0}
    ], "conexoes": [{"de": "e", "para": "c"}, {"de": "c", "para": "f", "saida": "sim"}, {"de": "c", "para": "f", "saida": "nao"}, {"de": "c", "para": "f", "saida": "esgotado"}]})
}

fn com_agente(nome: &str) -> Value {
    json!({"id": "com-agente", "nome": "Agente", "descricao": "d", "nos": [
        {"id": "e", "tipo": "entrada", "titulo": "Entrada", "x": 0, "y": 0},
        {"id": "a", "tipo": "agente", "titulo": "A", "agente": nome, "x": 1, "y": 0},
        {"id": "f", "tipo": "fim", "titulo": "Fim", "x": 2, "y": 0}
    ], "conexoes": [{"de": "e", "para": "a"}, {"de": "a", "para": "f"}]})
}

fn agente(nome: &str, ferramentas: Value) -> Value {
    json!({"name": nome, "description": "Pesquisa", "cli": "claude", "instrucoes": "Pesquise.", "ferramentas": ferramentas})
}

fn fluxo(contexto: &Contexto, nome: &str, argumentos: Value) -> Result<String, String> {
    mcp_fluxos::chamar(contexto, nome, &argumentos).expect("ferramenta de fluxos")
}

#[test]
fn nenhuma_ferramenta_aprova_etapa() {
    let nomes: Vec<String> = mcp_fluxos::ferramentas().iter().map(|item| item["name"].as_str().unwrap_or("").to_owned()).collect();
    assert!(!nomes.iter().any(|nome| nome.contains("aprov")), "{nomes:?}");
}

#[test]
fn controlar_execucao_recusa_acao_de_aprovar() {
    let (porta, pedidos) = engine_falso(vec![]);
    let local = ambiente(porta);
    let erro = fluxo(&local.contexto, "controlar_execucao", json!({"id": "x", "acao": "aprovar"})).expect_err("recusa");
    assert!(erro.contains("pausar"));
    assert!(pedidos.lock().expect("pedidos").is_empty());
}

#[test]
fn criar_fluxo_salva_o_que_valida_e_aparece_na_lista() {
    let local = ambiente(1);
    let resposta = fluxo(&local.contexto, "criar_fluxo", json!({"fluxo": fluxo_de_comando()})).expect("salvou");
    assert!(resposta.contains("agente-teste-mcp"));
    let lista = fluxo(&local.contexto, "listar_fluxos", json!({})).expect("lista");
    assert!(lista.contains("agente-teste-mcp · Teste · global"));
}

#[test]
fn criar_fluxo_aceita_o_objeto_mandado_como_texto() {
    let local = ambiente(1);
    fluxo(&local.contexto, "criar_fluxo", json!({"fluxo": fluxo_de_comando().to_string()})).expect("salvou");
}

#[test]
fn criar_fluxo_nao_sobrescreve_sem_pedir() {
    let local = ambiente(1);
    let argumentos = json!({"fluxo": fluxo_de_comando()});
    fluxo(&local.contexto, "criar_fluxo", argumentos.clone()).expect("primeiro");
    assert!(fluxo(&local.contexto, "criar_fluxo", argumentos).expect_err("segundo").contains("Já existe"));
    fluxo(&local.contexto, "criar_fluxo", json!({"fluxo": fluxo_de_comando(), "substituir": true})).expect("substituiu");
}

#[test]
fn criar_fluxo_recusa_agente_que_nao_existe_sem_gravar_nada() {
    let local = ambiente(1);
    let erro = fluxo(&local.contexto, "criar_fluxo", json!({"fluxo": com_agente("fantasma")})).expect_err("recusa");
    assert!(erro.contains("fantasma"));
    assert!(!fluxo(&local.contexto, "listar_fluxos", json!({})).expect("lista").contains("com-agente"));
}

#[test]
fn criar_fluxo_grava_agentes_novos_junto() {
    let local = ambiente(1);
    let novo = agente("pesquisador-teste", json!(["Read"]));
    fluxo(&local.contexto, "criar_fluxo", json!({"fluxo": com_agente("pesquisador-teste"), "agentes_novos": [novo]})).expect("salvou");
    assert!(fluxo(&local.contexto, "formato_de_fluxo", json!({})).expect("formato").contains("pesquisador-teste"));
}

#[test]
fn comando_sem_aprovacao_antes_nao_e_salvo() {
    let local = ambiente(1);
    let erro = fluxo(&local.contexto, "criar_fluxo", json!({"fluxo": sem_aprovacao()})).expect_err("recusa");
    assert!(erro.contains("aprovação"), "{erro}");
    assert!(!fluxo(&local.contexto, "listar_fluxos", json!({})).expect("lista").contains("perigoso"));
}

#[test]
fn agente_com_bash_sem_aprovacao_antes_nao_e_salvo() {
    let local = ambiente(1);
    let novo = agente("shell-teste", json!(["Read", "Bash(curl:*)"]));
    let erro = fluxo(&local.contexto, "criar_fluxo", json!({"fluxo": com_agente("shell-teste"), "agentes_novos": [novo]})).expect_err("recusa");
    assert!(erro.contains("aprovação"), "{erro}");
}

#[test]
fn agente_em_outra_cli_sem_aprovacao_antes_nao_e_salvo() {
    let local = ambiente(1);
    let novo = json!({"name": "codex-teste", "description": "x", "cli": "codex", "instrucoes": "y"});
    assert!(fluxo(&local.contexto, "criar_fluxo", json!({"fluxo": com_agente("codex-teste"), "agentes_novos": [novo]})).is_err());
}

#[test]
fn na_pasta_do_projeto_exige_aprovacao_antes_do_agente() {
    let local = ambiente(1);
    let mut direto = com_agente("leitor-teste");
    direto["na_pasta_do_projeto"] = json!(true);
    let novo = agente("leitor-teste", json!(["Read"]));
    assert!(fluxo(&local.contexto, "criar_fluxo", json!({"fluxo": direto, "agentes_novos": [novo]})).is_err());
}

#[test]
fn saida_nao_da_aprovacao_nao_libera_comando() {
    let local = ambiente(1);
    let mut torto = fluxo_de_comando();
    torto["conexoes"][1] = json!({"de": "ok", "para": "f", "saida": "sim"});
    torto["conexoes"][2] = json!({"de": "ok", "para": "c", "saida": "nao"});
    assert!(fluxo(&local.contexto, "criar_fluxo", json!({"fluxo": torto})).is_err());
}

#[test]
fn substituir_nao_alcanca_fluxo_do_usuario() {
    let local = ambiente(1);
    fluxo(&local.contexto, "listar_fluxos", json!({})).expect("semeia os prontos");
    let pasta = local.contexto.fluxos_globais.clone().expect("pasta");
    let original = fs::read(pasta.join("tarefa-pr.json")).expect("pronto");
    let mut copia = fluxo_de_comando();
    copia["id"] = json!("tarefa-pr");
    let resposta = fluxo(&local.contexto, "criar_fluxo", json!({"fluxo": copia, "substituir": true})).expect("salva com prefixo");
    assert!(resposta.contains("agente-tarefa-pr"));
    assert_eq!(fs::read(pasta.join("tarefa-pr.json")).expect("pronto"), original);
}

fn rotas_para_rodar(caminho: &Path, ativas: usize) -> Vec<(&'static str, u16, Value)> {
    vec![
        ("GET /fluxos/execucoes", 200, Value::Array(vec![json!({"status": "rodando"}); ativas])),
        ("GET /projetos", 200, json!({"projects": [
            {"id": "raiz", "name": "Raiz", "path": caminho.parent().expect("pai").to_string_lossy()},
            {"id": "proj", "name": "Projeto", "path": caminho.to_string_lossy()}
        ]})),
        ("POST /fluxos/execucoes", 201, json!({"id": "run-1"})),
    ]
}

#[test]
fn rodar_fluxo_usa_o_projeto_mais_especifico_da_pasta_atual() {
    let semente = ambiente(1);
    let pasta = semente.contexto.pasta_atual.clone().expect("pasta");
    let (porta, pedidos) = engine_falso(rotas_para_rodar(&pasta, 0));
    let contexto = Contexto { porta, ..semente.contexto };
    fluxo(&contexto, "criar_fluxo", json!({"fluxo": fluxo_de_comando()})).expect("salvou");
    let resposta = fluxo(&contexto, "rodar_fluxo", json!({"id": "agente-teste-mcp", "entrada": "faça"})).expect("rodou");
    assert!(resposta.contains("run-1") && resposta.contains("Projeto"));
    let pedidos = pedidos.lock().expect("pedidos");
    let corpo: Value = serde_json::from_str(pedidos.last().expect("pedido")["body"].as_str().expect("corpo")).expect("json");
    assert_eq!(corpo["projeto_id"], "proj");
    assert_eq!(corpo["entrada"], "faça");
    assert_eq!(corpo["fluxo"]["id"], "agente-teste-mcp");
}

#[test]
fn rodar_fluxo_para_no_teto_de_execucoes_ativas() {
    let semente = ambiente(1);
    let pasta = semente.contexto.pasta_atual.clone().expect("pasta");
    let (porta, pedidos) = engine_falso(rotas_para_rodar(&pasta, mcp_fluxos::EXECUCOES_SIMULTANEAS));
    let contexto = Contexto { porta, ..semente.contexto };
    let erro = fluxo(&contexto, "rodar_fluxo", json!({"id": "teste-mcp", "entrada": "faça"})).expect_err("teto");
    assert!(erro.contains("execuções ativas"));
    assert!(!pedidos.lock().expect("pedidos").iter().any(|pedido| pedido["method"] == "POST"));
}

#[test]
fn rodar_fluxo_conta_pausada_no_teto_e_falha_fechado() {
    let semente = ambiente(1);
    let pasta = semente.contexto.pasta_atual.clone().expect("pasta");
    let mut rotas = rotas_para_rodar(&pasta, 0);
    rotas[0].2 = Value::Array(vec![json!({"status": "pausado"}); mcp_fluxos::EXECUCOES_SIMULTANEAS]);
    let (porta, _) = engine_falso(rotas);
    let contexto = Contexto { porta, ..semente.contexto };
    assert!(fluxo(&contexto, "rodar_fluxo", json!({"id": "x", "entrada": "faça"})).expect_err("teto").contains("ativas"));
    let (porta, _) = engine_falso(vec![("GET /fluxos/execucoes", 200, json!({"inesperado": true}))]);
    let contexto = Contexto { porta, ..contexto };
    assert!(fluxo(&contexto, "rodar_fluxo", json!({"id": "x", "entrada": "faça"})).is_err());
}

#[test]
fn rodar_fluxo_barra_fluxo_do_projeto_sem_aprovacao() {
    let semente = ambiente(1);
    let pasta = semente.contexto.pasta_atual.clone().expect("pasta");
    let (porta, pedidos) = engine_falso(rotas_para_rodar(&pasta, 0));
    let contexto = Contexto { porta, ..semente.contexto };
    let destino = omni_core::fluxos::pasta_do_projeto(&pasta);
    fs::create_dir_all(&destino).expect("pasta");
    fs::write(destino.join("perigoso.json"), sem_aprovacao().to_string()).expect("clonado");
    let erro = fluxo(&contexto, "rodar_fluxo", json!({"id": "perigoso", "entrada": "faça"})).expect_err("recusa");
    assert!(erro.contains("aprovação"), "{erro}");
    assert!(!pedidos.lock().expect("pedidos").iter().any(|pedido| pedido["method"] == "POST"));
}

#[test]
fn rodar_fluxo_aceita_fluxo_global_feito_pelo_usuario() {
    let semente = ambiente(1);
    let pasta = semente.contexto.pasta_atual.clone().expect("pasta");
    let (porta, _) = engine_falso(rotas_para_rodar(&pasta, 0));
    let contexto = Contexto { porta, ..semente.contexto };
    let destino = contexto.fluxos_globais.clone().expect("global");
    fs::create_dir_all(&destino).expect("pasta");
    fs::write(destino.join("perigoso.json"), sem_aprovacao().to_string()).expect("do usuário");
    assert!(fluxo(&contexto, "rodar_fluxo", json!({"id": "perigoso", "entrada": "faça"})).expect("rodou").contains("run-1"));
}

#[test]
fn rodar_fluxo_recusa_entrada_vazia() {
    let local = ambiente(1);
    assert!(fluxo(&local.contexto, "rodar_fluxo", json!({"id": "x", "entrada": "  "})).is_err());
}

fn execucao() -> Value {
    json!({"id": "run-1", "status": "aguardando", "custo_usd": 0.5, "erro": null, "pr_url": null,
        "fluxo": {"nos": [{"id": "dev", "titulo": "Dev"}, {"id": "ok", "titulo": "Aprovar"}]},
        "nos": {"dev": {"status": "concluido", "saida": "pronto com sk-ant-api03-abcdefghijklmnopqrstuvwxyz"}, "ok": {"status": "aguardando"}}})
}

#[test]
fn ver_execucao_avisa_que_a_aprovacao_e_do_usuario() {
    let (porta, _) = engine_falso(vec![("GET /fluxos/execucoes/run-1", 200, execucao())]);
    let local = ambiente(porta);
    let texto = fluxo(&local.contexto, "ver_execucao", json!({"id": "run-1"})).expect("resumo");
    assert!(texto.contains("- dev (Dev): concluido"));
    assert!(texto.contains("Você não pode aprovar"));
}

#[test]
fn ver_execucao_entrega_a_saida_da_etapa_sem_segredos() {
    let (porta, _) = engine_falso(vec![("GET /fluxos/execucoes/run-1", 200, execucao())]);
    let local = ambiente(porta);
    let texto = fluxo(&local.contexto, "ver_execucao", json!({"id": "run-1", "etapa": "dev"})).expect("saída");
    assert!(texto.contains("pronto"));
    assert!(!texto.contains("sk-ant-api03"), "{texto}");
}

#[test]
fn erro_da_rota_chega_sem_o_token() {
    let (porta, _) = engine_falso(vec![("GET /fluxos/execucoes/x", 404, json!({"error": "Execução não encontrada"}))]);
    let local = ambiente(porta);
    let erro = fluxo(&local.contexto, "ver_execucao", json!({"id": "x"})).expect_err("404");
    assert_eq!(erro, "Execução não encontrada");
}

#[test]
fn engine_fechado_vira_mensagem_clara() {
    let ouvinte = TcpListener::bind("127.0.0.1:0").expect("porta");
    let porta = ouvinte.local_addr().expect("endereço").port();
    drop(ouvinte);
    let local = ambiente(porta);
    assert!(api(&local.contexto, "GET", "/projetos", None).expect_err("fechado").contains("Abra o app"));
}

#[test]
fn id_com_caminho_nao_chega_na_rota() {
    assert!(segmento("../token").is_err());
    assert!(segmento("a/b").is_err());
    assert!(segmento("").is_err());
    assert_eq!(segmento("conv-1_a.b"), Ok("conv-1_a.b"));
}

fn base(pasta: &Path) -> Base {
    Base::abrir(&pasta.join("rag/base.db")).expect("base")
}

fn historico(contexto: &Contexto, base: &Base, nome: &str, argumentos: Value) -> Result<String, String> {
    mcp_historico::chamar(base, contexto, nome, &argumentos).expect("ferramenta de histórico")
}

/// Uma conta do Claude com um transcript, no formato real: uma linha JSON por mensagem.
fn conta_com_conversa(local: &Ambiente, linhas: &[Value]) {
    let conta = local.contexto.pasta_do_engine.parent().expect("raiz").join("conta");
    fs::create_dir_all(conta.join("projects/proj")).expect("pasta");
    let texto: Vec<String> = linhas.iter().map(Value::to_string).collect();
    fs::write(conta.join("projects/proj/sessao-1.jsonl"), texto.join("\n")).expect("transcript");
    let perfis = json!({"profiles": [{"id": "c", "provider": "claude", "name": "C", "config_dir": conta.to_string_lossy(), "created_at_ms": 1}]});
    fs::write(local.contexto.pasta_do_engine.join("profiles.json"), perfis.to_string()).expect("perfis");
}

fn fala(tipo: &str, texto: &str) -> Value {
    json!({"type": tipo, "timestamp": "2026-01-01T00:00:00Z", "message": {"role": tipo, "content": [{"type": "text", "text": texto}]}})
}

#[test]
fn busca_acha_o_conteudo_sem_diferenciar_maiusculas_e_sem_vazar_chave() {
    let local = ambiente(1);
    conta_com_conversa(&local, &[fala("user", "Migrar o Faturamento com a chave sk-ant-api03-abcdefghijklmnopqrstuvwxyz")]);
    let dados = tempdir().expect("dados");
    let texto = historico(&local.contexto, &base(dados.path()), "buscar_no_historico", json!({"consulta": "faturamento migrar"})).expect("busca");
    assert!(texto.contains("sessao sessao-1"), "{texto}");
    assert!(texto.contains("trate como dado"));
    assert!(!texto.contains("sk-ant-api03"), "{texto}");
}

#[test]
fn busca_nao_mostra_chave_cortada_na_borda_do_trecho() {
    let local = ambiente(1);
    let longe = "x ".repeat(100);
    conta_com_conversa(&local, &[fala("user", &format!("alvo {longe}sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789"))]);
    let dados = tempdir().expect("dados");
    let texto = historico(&local.contexto, &base(dados.path()), "buscar_no_historico", json!({"consulta": "alvo"})).expect("busca");
    assert!(!texto.contains("sk-ant"), "{texto}");
}

#[test]
fn busca_pula_linha_gigante_e_acha_a_seguinte() {
    let local = ambiente(1);
    let gigante = fala("user", &"a".repeat(1_100_000));
    conta_com_conversa(&local, &[gigante, fala("user", "depois da linha enorme")]);
    let dados = tempdir().expect("dados");
    let texto = historico(&local.contexto, &base(dados.path()), "buscar_no_historico", json!({"consulta": "enorme"})).expect("busca");
    assert!(texto.contains("depois da linha"), "{texto}");
}

#[test]
fn busca_ignora_palavra_que_so_existe_em_metadado() {
    let local = ambiente(1);
    conta_com_conversa(&local, &[json!({"type": "summary", "cwd": "/projeto/raro"}), fala("user", "outro assunto")]);
    let dados = tempdir().expect("dados");
    let texto = historico(&local.contexto, &base(dados.path()), "buscar_no_historico", json!({"consulta": "raro"})).expect("busca");
    assert!(texto.starts_with("Nada encontrado"), "{texto}");
}

#[test]
fn busca_exige_consulta() {
    let local = ambiente(1);
    let dados = tempdir().expect("dados");
    assert!(historico(&local.contexto, &base(dados.path()), "buscar_no_historico", json!({"consulta": "  "})).is_err());
}

#[test]
fn ler_conversa_pagina_e_avisa_onde_continuar() {
    let conversa = json!({"markdown": "abcdefghij"});
    let (porta, _) = engine_falso(vec![("GET /conversas/c1/exportar", 200, conversa)]);
    let local = ambiente(porta);
    let dados = tempdir().expect("dados");
    let banco = base(dados.path());
    let primeira = historico(&local.contexto, &banco, "ler_conversa", json!({"id": "c1", "max_caracteres": 4})).expect("parte");
    assert!(primeira.contains("abcd") && primeira.contains("deslocamento 4"), "{primeira}");
    let ultima = historico(&local.contexto, &banco, "ler_conversa", json!({"id": "c1", "deslocamento": 8})).expect("fim");
    assert!(ultima.contains("ij") && !ultima.contains("Continue"), "{ultima}");
}

#[test]
fn ler_conversa_por_sessao_le_o_transcript() {
    let local = ambiente(1);
    conta_com_conversa(&local, &[fala("user", "pergunta antiga"), fala("assistant", "resposta antiga")]);
    let dados = tempdir().expect("dados");
    let texto = historico(&local.contexto, &base(dados.path()), "ler_conversa", json!({"sessao": "sessao-1"})).expect("sessão");
    assert!(texto.contains("pergunta antiga") && texto.contains("resposta antiga"), "{texto}");
}

#[test]
fn ler_conversa_recusa_sessao_com_caminho() {
    let local = ambiente(1);
    let dados = tempdir().expect("dados");
    assert!(historico(&local.contexto, &base(dados.path()), "ler_conversa", json!({"sessao": "../../token"})).is_err());
}

#[test]
fn listar_conversas_filtra_pelo_titulo_e_mostra_o_projeto() {
    let (porta, _) = engine_falso(vec![
        ("GET /projetos", 200, json!({"projects": [{"id": "p", "name": "Central"}]})),
        ("GET /conversas", 200, json!([
            {"id": "a", "title": "Boleto", "project_id": "p", "provider": "claude", "updated_at_ms": 0},
            {"id": "b", "title": "Outra", "project_id": "p", "provider": "claude", "updated_at_ms": 0}
        ])),
    ]);
    let local = ambiente(porta);
    let dados = tempdir().expect("dados");
    let texto = historico(&local.contexto, &base(dados.path()), "listar_conversas", json!({"busca": "bol"})).expect("lista");
    assert!(texto.contains("a · Boleto · Central"), "{texto}");
    assert!(!texto.contains("Outra"));
}
