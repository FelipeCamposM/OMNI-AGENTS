//! Roadmaps de estudo, Pomodoro e Mentor no celular/web: os mesmos arquivos que o app grava
//! (`omni_core::roadmaps`, pasta `<dados>/roadmaps/`). Mesmas regras: lista fechada de nomes, JSON
//! validado, gravação atômica. Erros respondem só mensagens fixas: o conteúdo nunca volta em erro.
//! (Vindo do fork do Enzo, `EnzoViniski/niski`; o Pomodoro é daqui.)
use super::*;
use omni_core::roadmaps;

/// `cards.json` de anos de estudo cabe com folga (o limite de cada arquivo é 16 MB).
const CORPO_MAXIMO: usize = roadmaps::TAMANHO_MAXIMO + 64 * 1024;

pub(super) fn rotas() -> Router<Arc<EngineState>> {
    Router::new()
        .route("/roadmaps", get(listar))
        .route("/roadmaps/geral", get(ler_geral).post(gravar_geral).layer(DefaultBodyLimit::max(CORPO_MAXIMO)))
        .route("/roadmaps/{id}/arquivo", get(ler).post(gravar).layer(DefaultBodyLimit::max(CORPO_MAXIMO)))
        .route("/roadmaps/{id}/conversa", post(anexar).layer(DefaultBodyLimit::max(512 * 1024)))
        // IA dos estudos (Mentor, e o que mais pedir) pelo celular: o mesmo núcleo do app.
        .route("/roadmaps/ia", post(perguntar_a_ia).layer(DefaultBodyLimit::max(512 * 1024)))
        .route("/roadmaps/ia/cancelar", post(cancelar_ia))
}

#[derive(Deserialize)]
struct Nome { nome: String }

#[derive(Deserialize)]
struct Gravacao { nome: String, conteudo: String }

#[derive(Deserialize)]
struct Linha { linha: String }

fn raiz(state: &EngineState) -> std::path::PathBuf {
    state.state_file.parent().unwrap_or(std::path::Path::new(".")).join(roadmaps::PASTA)
}

fn falha(erro: std::io::Error) -> ApiError {
    if erro.kind() == std::io::ErrorKind::InvalidInput { error(StatusCode::BAD_REQUEST, &erro.to_string()) }
    else { error(StatusCode::INTERNAL_SERVER_ERROR, "Não foi possível acessar o roadmap.") }
}

async fn fora_do_runtime<T: Send + 'static>(f: impl FnOnce() -> Result<T, ApiError> + Send + 'static) -> Result<T, ApiError> {
    tokio::task::spawn_blocking(f).await.map_err(|_| error(StatusCode::INTERNAL_SERVER_ERROR, "Roadmaps indisponíveis"))?
}

async fn listar(State(state): State<Arc<EngineState>>) -> Result<Json<Value>, ApiError> {
    let raiz = raiz(&state);
    fora_do_runtime(move || Ok(Json(json!(roadmaps::listar(&raiz))))).await
}

async fn ler(State(state): State<Arc<EngineState>>, RoutePath(id): RoutePath<String>, Query(q): Query<Nome>) -> Result<Json<Value>, ApiError> {
    let raiz = raiz(&state);
    fora_do_runtime(move || roadmaps::ler(&raiz, &id, &q.nome).map(|c| Json(json!({ "conteudo": c }))).map_err(falha)).await
}

async fn gravar(State(state): State<Arc<EngineState>>, RoutePath(id): RoutePath<String>, Json(corpo): Json<Gravacao>) -> Result<Json<Value>, ApiError> {
    let raiz = raiz(&state);
    fora_do_runtime(move || roadmaps::gravar(&raiz, &id, &corpo.nome, &corpo.conteudo).map(|_| Json(json!({ "ok": true }))).map_err(falha)).await
}

async fn anexar(State(state): State<Arc<EngineState>>, RoutePath(id): RoutePath<String>, Json(corpo): Json<Linha>) -> Result<Json<Value>, ApiError> {
    let raiz = raiz(&state);
    fora_do_runtime(move || roadmaps::anexar_na_conversa(&raiz, &id, &corpo.linha).map(|_| Json(json!({ "ok": true }))).map_err(falha)).await
}

/// Pergunta à IA dos estudos pela CLI deste PC, na conta pedida (senão a padrão). Só ferramentas de web,
/// pasta temporária vazia, nada no histórico (`omni_core::roadmaps_ia`). A chave leva o prefixo
/// `celular:` para não disputar com um pedido igual aberto no app.
async fn perguntar_a_ia(State(state): State<Arc<EngineState>>, Json(mut pedido): Json<omni_core::roadmaps_ia::PedidoDeIa>) -> Result<Json<Value>, ApiError> {
    use omni_core::roadmaps_ia as ia;
    if pedido.chave.trim().is_empty() || pedido.chave.len() > 100 { return Err(error(StatusCode::BAD_REQUEST, "Pedido inválido")); }
    pedido.chave = format!("celular:{}", pedido.chave);
    let dir = state.state_file.parent().unwrap_or(std::path::Path::new(".")).to_path_buf();
    fora_do_runtime(move || {
        let (args, entrada) = ia::argumentos(&pedido.cli, pedido.modelo.as_deref(), pedido.web, &pedido.sistema, &pedido.texto)
            .map_err(|e| error(StatusCode::BAD_REQUEST, &e))?;
        let nome = if pedido.cli == "claude" { "Claude Code" } else { "Codex" };
        let exe = crate::fluxos::executavel(&pedido.cli).ok_or_else(|| error(StatusCode::SERVICE_UNAVAILABLE, &format!("O {nome} não foi encontrado no PC")))?;
        let perfis = omni_core::profiles(&dir);
        // O engine não calcula o login das contas: sem conta pedida, vai a padrão (como a correção de voz).
        let perfil = ia::perfil_do_pedido(&perfis, &pedido.cli, pedido.conta.as_deref())
            .or_else(|| perfis.iter().find(|p| p.provider == pedido.cli && p.builtin))
            .or_else(|| perfis.iter().find(|p| p.provider == pedido.cli));
        let env = perfil.map(omni_core::env_for).unwrap_or_default();
        let pasta = ia::pasta_temporaria().map_err(|_| error(StatusCode::INTERNAL_SERVER_ERROR, "Pasta temporária indisponível"))?;
        ia::rodar(&pedido.chave, &exe, &args, &entrada, &env, &pasta, ia::LIMITE)
            .and_then(|saida| ia::resposta_da_saida(&pedido.cli, &saida))
            .map(|texto| Json(json!({ "texto": texto })))
            // Mensagem de erro da CLI (sem login, sem crédito) é útil e não carrega conteúdo do pedido.
            .map_err(|e| error(StatusCode::BAD_GATEWAY, &e))
    }).await
}

#[derive(Deserialize)]
struct Chave { chave: String }

/// Mata a CLI do pedido do celular com essa chave (o pedido em andamento responde "Pedido cancelado.").
async fn cancelar_ia(Json(corpo): Json<Chave>) -> Json<Value> {
    omni_core::roadmaps_ia::cancelar(&format!("celular:{}", corpo.chave));
    Json(json!({ "ok": true }))
}

/// Pomodoro e Mentor: `?nome=pomodoros.json|mentor.json` (lista fechada no omni-core).
async fn ler_geral(State(state): State<Arc<EngineState>>, Query(q): Query<Nome>) -> Result<Json<Value>, ApiError> {
    let raiz = raiz(&state);
    fora_do_runtime(move || roadmaps::ler_geral(&raiz, &q.nome).map(|c| Json(json!({ "conteudo": c }))).map_err(falha)).await
}

async fn gravar_geral(State(state): State<Arc<EngineState>>, Json(corpo): Json<Gravacao>) -> Result<Json<Value>, ApiError> {
    let raiz = raiz(&state);
    fora_do_runtime(move || roadmaps::gravar_geral(&raiz, &corpo.nome, &corpo.conteudo).map(|_| Json(json!({ "ok": true }))).map_err(falha)).await
}

#[cfg(test)]
mod testes {
    use super::*;

    async fn api(state: &Arc<EngineState>, metodo: &str, caminho: &str, corpo: Option<Value>) -> (u16, Value) {
        let EngineResponse::Api { status, body, .. } = local(state.clone(), metodo, caminho, corpo.map(|c| c.to_string()), None, vec![]).await
            else { panic!("resposta inesperada") };
        (status, serde_json::from_str(&body).unwrap_or(Value::Null))
    }

    #[tokio::test]
    async fn celular_le_e_grava_o_roadmap_e_o_pomodoro_do_app() {
        let (dir, state) = super::super::tests::fixture();
        let (status, vazio) = api(&state, "GET", "/roadmaps", None).await;
        assert_eq!(status, 200);
        assert_eq!(vazio, json!([]));

        // O app criou um roadmap (mesma pasta de dados).
        let raiz = dir.path().join(roadmaps::PASTA);
        let id = roadmaps::criar(&raiz, &json!({"versao":1,"nome":"Vendas"}), 1, 2).unwrap();
        let (_, lista) = api(&state, "GET", "/roadmaps", None).await;
        assert_eq!(lista[0]["id"], id.as_str());
        assert_eq!(lista[0]["meta"]["nome"], "Vendas");

        // Cards grandes passam do limite global de 32 KB: a rota tem o dela.
        let cards = json!({"versao":1,"cards":[],"revisoes":[],"folga":"ç".repeat(40_000)}).to_string();
        let (status, _) = api(&state, "POST", &format!("/roadmaps/{id}/arquivo"), Some(json!({"nome":"cards.json","conteudo":cards}))).await;
        assert_eq!(status, 200);
        let (_, lido) = api(&state, "GET", &format!("/roadmaps/{id}/arquivo?nome=cards.json"), None).await;
        assert_eq!(lido["conteudo"].as_str().unwrap(), cards);
        let (_, nada) = api(&state, "GET", &format!("/roadmaps/{id}/arquivo?nome=caderno.md"), None).await;
        assert_eq!(nada["conteudo"], Value::Null);

        let (status, _) = api(&state, "POST", &format!("/roadmaps/{id}/conversa"), Some(json!({"linha": "{\"de\":\"eu\",\"texto\":\"oi\"}"}))).await;
        assert_eq!(status, 200);
        assert!(std::fs::read_to_string(raiz.join(&id).join("conversa.jsonl")).unwrap().contains("\"oi\""));

        // Pomodoro: mesmo arquivo do app; JSON quebrado é recusado.
        let (_, sem) = api(&state, "GET", "/roadmaps/geral?nome=pomodoros.json", None).await;
        assert_eq!(sem["conteudo"], Value::Null);
        let historico = json!({"versao":1,"sessoes":[{"materia":"Cálculo"}]}).to_string();
        let (status, _) = api(&state, "POST", "/roadmaps/geral", Some(json!({"nome": "pomodoros.json", "conteudo": historico}))).await;
        assert_eq!(status, 200);
        assert_eq!(roadmaps::ler_geral(&raiz, "pomodoros.json").unwrap().as_deref(), Some(historico.as_str()));
        let (status, _) = api(&state, "POST", "/roadmaps/geral", Some(json!({"nome": "pomodoros.json", "conteudo": "{ quebrado"}))).await;
        assert_eq!(status, 400);
        let (status, _) = api(&state, "POST", "/roadmaps/geral", Some(json!({"nome": "../sessions.json", "conteudo": "{}"}))).await;
        assert_eq!(status, 400);
        let (status, _) = api(&state, "POST", "/roadmaps/geral", Some(json!({"nome": "mentor.json", "conteudo": "{}"}))).await;
        assert_eq!(status, 200);

        // Mesmas recusas do app.
        for (nome, conteudo) in [("../sessions.json", "{}"), ("engine.token", "x"), ("plano.json", "{ quebrado")] {
            let (status, _) = api(&state, "POST", &format!("/roadmaps/{id}/arquivo"), Some(json!({"nome":nome,"conteudo":conteudo}))).await;
            assert_eq!(status, 400, "{nome}");
        }
        let (status, _) = api(&state, "GET", "/roadmaps/..%2F..%2Fx/arquivo?nome=meta.json", None).await;
        assert_eq!(status, 400);

        // IA: CLI ou modelo estranho é recusado antes de rodar qualquer coisa.
        let pedido = |cli: &str, modelo: &str| json!({"chave":"mentor","cli":cli,"modelo":modelo,"sistema":"s","texto":"t","web":false});
        let (status, _) = api(&state, "POST", "/roadmaps/ia", Some(pedido("gemini", ""))).await;
        assert_eq!(status, 400);
        let (status, _) = api(&state, "POST", "/roadmaps/ia", Some(pedido("claude", "--dangerously-skip-permissions"))).await;
        assert_eq!(status, 400);
        let (status, _) = api(&state, "POST", "/roadmaps/ia/cancelar", Some(json!({"chave": "mentor"}))).await;
        assert_eq!(status, 200, "cancelar sem pedido em andamento não é erro");
    }
}
