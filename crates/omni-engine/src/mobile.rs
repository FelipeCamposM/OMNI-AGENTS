use super::*;
use axum::{Router, Json, extract::{State, Path as RoutePath, Query, DefaultBodyLimit, Request},
    http::{StatusCode, HeaderMap}, response::{IntoResponse, Response}, routing::{get,post}, middleware::{self, Next}};
use omni_protocol::MobileConfig;
use serde::{Serialize, Deserialize};
use serde_json::{Value, json};
use std::net::{SocketAddr, IpAddr};
use tokio::sync::Notify;

#[cfg(mobile_assets)]
static ASSETS: include_dir::Dir<'_> = include_dir::include_dir!("$CARGO_MANIFEST_DIR/../../dist-mobile");

pub struct MobileRuntime {
    config: Mutex<MobileConfig>,
    status: Mutex<(Option<String>,Option<String>)>,
    changed: Notify,
    actions: Mutex<VecDeque<Action>>,
    pending: Notify,
}
#[derive(Clone, Serialize)]
struct Action {
    id: String, conversation_id: String, session_id: String, state: String,
    created_at_ms: u64, error: Option<String>,
    #[serde(skip)] key: String,
    #[serde(skip)] revision: String,
    #[serde(skip)] kind: ActionKind,
}
#[derive(Clone, PartialEq)]
enum ActionKind { Prompt(String), Approval(bool) }

impl MobileRuntime {
    pub fn new(dir: &Path) -> Self {
        Self { config: Mutex::new(omni_protocol::read_json_or_default(&dir.join("mobile.json"))),
            status: Mutex::new((None,None)),changed: Notify::new(),actions: Mutex::new(VecDeque::new()),pending: Notify::new() }
    }
}

fn tailscale_ip() -> Option<IpAddr> {
    let path = if cfg!(windows) { PathBuf::from("C:/Program Files/Tailscale/tailscale.exe") } else { PathBuf::from("tailscale") };
    let mut command = std::process::Command::new(path);
    command.args(["ip","-4"]).stdin(std::process::Stdio::null()).stderr(std::process::Stdio::null());
    #[cfg(windows)] { use std::os::windows::process::CommandExt; command.creation_flags(0x08000000); }
    // The installed Tailscale client is the authority, not a guess based on a 100.x address.
    command.stdout(std::process::Stdio::piped());
    let mut child = command.spawn().ok()?;
    let started = std::time::Instant::now();
    loop {
        if child.try_wait().ok()?.is_some() { break; }
        if started.elapsed() > std::time::Duration::from_secs(2) { let _ = child.kill(); let _ = child.wait(); return None; }
        std::thread::sleep(std::time::Duration::from_millis(25));
    }
    let output = child.wait_with_output().ok()?;
    if !output.status.success() { return None; }
    String::from_utf8(output.stdout).ok()?.trim().parse().ok()
}

fn validate(config: &MobileConfig) -> Result<SocketAddr> {
    let address: SocketAddr = config.bind.parse().context("Use IP:porta, por exemplo 100.x.x.x:47322")?;
    if address.port() == 0 || address.port() == DEFAULT_ENGINE_PORT { return Err(anyhow!("Porta HTTP inválida")); }
    if address.ip() == IpAddr::V4(std::net::Ipv4Addr::LOCALHOST) { return Ok(address); }
    if address.ip().is_unspecified() || Some(address.ip()) != tailscale_ip() {
        return Err(anyhow!("Escolha 127.0.0.1 ou o IP da interface Tailscale instalada neste PC"));
    }
    Ok(address)
}

pub fn settings(state: &EngineState, config: Option<MobileConfig>) -> Result<EngineResponse> {
    if let Some(config) = config {
        if config.enabled { validate(&config)?; }
        atomic_write_json(&state.state_file.with_file_name("mobile.json"),&config)?;
        *state.mobile.config.lock().map_err(|_|anyhow!("config poisoned"))? = config;
        state.mobile.changed.notify_one();
    }
    let config = state.mobile.config.lock().map_err(|_|anyhow!("config poisoned"))?.clone();
    let (listening,error) = state.mobile.status.lock().map_err(|_|anyhow!("status poisoned"))?.clone();
    Ok(EngineResponse::MobileSettings { config,listening,error })
}

pub fn start(state: Arc<EngineState>) {
    let worker = state.clone();
    tokio::spawn(async move {
        loop {
            worker.mobile.pending.notified().await;
            loop {
                let next = { let mut actions = worker.mobile.actions.lock().expect("actions poisoned");
                    actions.iter_mut().find(|a| a.state == "queued").map(|a| { a.state = "executing".into(); a.clone() }) };
                let Some(action) = next else { break };
                let engine = worker.clone(); let input = action.clone();
                let outcome = tokio::task::spawn_blocking(move || execute(&engine,&input)).await;
                let error = match outcome { Ok(Ok(())) => None, Ok(Err(e)) => Some(e.to_string()), Err(e) => Some(e.to_string()) };
                if let Some(record) = worker.mobile.actions.lock().expect("actions poisoned").iter_mut().find(|a| a.id == action.id) {
                    record.state = if error.is_some() { "rejected" } else { "sent" }.into(); record.error = error;
                }
            }
        }
    });
    tokio::spawn(async move {
        loop {
            let config = state.mobile.config.lock().expect("config poisoned").clone();
            *state.mobile.status.lock().expect("status poisoned") = (None,None);
            if !config.enabled { state.mobile.changed.notified().await; continue; }
            let checked = config.clone();
            let address = tokio::task::spawn_blocking(move || validate(&checked)).await;
            let listener = match address {
                Ok(Ok(address)) => TcpListener::bind(address).await.map_err(|e|e.to_string()),
                Ok(Err(e)) => Err(e.to_string()), Err(e) => Err(e.to_string()),
            };
            match listener {
                Ok(listener) => {
                    *state.mobile.status.lock().expect("status poisoned") = (Some(format!("http://{}",config.bind)),None);
                    let shutdown = state.clone();
                    let _ = axum::serve(listener,router(state.clone())).with_graceful_shutdown(async move { shutdown.mobile.changed.notified().await; }).await;
                }
                Err(error) => { *state.mobile.status.lock().expect("status poisoned") = (None,Some(error)); state.mobile.changed.notified().await; }
            }
        }
    });
}

fn router(state: Arc<EngineState>) -> Router {
    Router::new().route("/conversas",get(conversations))
        .route("/conversas/{id}/timeline",get(timeline))
        .route("/conversas/{id}/prompt",post(prompt))
        .route("/conversas/{id}/aprovar",post(approve))
        .route("/atencao",get(attention))
        .fallback(get(asset)).layer(DefaultBodyLimit::max(32 * 1024))
        .layer(middleware::from_fn_with_state(state.clone(),same_origin)).with_state(state)
}

type ApiError = (StatusCode, Json<Value>);
fn error(status: StatusCode, message: &str) -> ApiError { (status,Json(json!({"error":message}))) }

async fn same_origin(State(state): State<Arc<EngineState>>, request: Request, next: Next) -> Response {
    let bind = state.mobile.config.lock().expect("config poisoned").bind.clone();
    if request.headers().get("host").and_then(|v|v.to_str().ok()) != Some(bind.as_str()) {
        return error(StatusCode::FORBIDDEN,"Host não permitido").into_response();
    }
    if request.method() != axum::http::Method::GET {
        let origin = format!("http://{bind}");
        if request.headers().get("origin").and_then(|v|v.to_str().ok()) != Some(origin.as_str()) {
            return error(StatusCode::FORBIDDEN,"Origem não permitida").into_response();
        }
    }
    let mut response = next.run(request).await;
    let headers = response.headers_mut();
    headers.insert("cache-control","no-store".parse().unwrap());
    headers.insert("x-content-type-options","nosniff".parse().unwrap());
    headers.insert("referrer-policy","no-referrer".parse().unwrap());
    headers.insert("content-security-policy","default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'".parse().unwrap());
    response
}

fn current(state: &EngineState, id: &str) -> Result<(omni_core::conversations::Conversation, Option<Arc<LiveSession>>), ApiError> {
    let dir = state.state_file.parent().unwrap();
    let conversation = omni_core::conversations::read_index(dir).into_iter().find(|c|c.id == id)
        .ok_or_else(||error(StatusCode::NOT_FOUND,"Conversa não encontrada"))?;
    let session = linked_session(state,&conversation);
    Ok((conversation,session))
}

fn linked_session(state: &EngineState, conversation: &omni_core::conversations::Conversation) -> Option<Arc<LiveSession>> {
    conversation.segments.last().and_then(|segment| {
        let sessions = state.sessions.lock().ok()?;
        let SessionEntry::Live(session) = sessions.get(segment.terminal_session_id.as_deref()?)? else { return None };
        let meta = session.meta.lock().ok()?;
        (meta.conversation_id.as_deref() == Some(conversation.id.as_str()) && meta.profile_id == segment.profile_id && meta.provider.as_deref() == Some(segment.provider.as_str()))
            .then(||session.clone())
    })
}

fn summaries(state: &EngineState) -> Vec<Value> {
    let dir = state.state_file.parent().unwrap();
    let mut index = omni_core::conversations::read_index(dir);
    index.sort_by_key(|c|std::cmp::Reverse(c.created_at_ms));
    index.iter().map(|c| {
        let live = linked_session(state,c);
        let capabilities = live.as_ref().map(interaction::capabilities);
        let status = live.as_ref().map(|s| {
            let meta = s.meta.lock().expect("metadata poisoned"); apply_idle_timeout(meta.state.clone(),meta.last_activity_at_ms,now_ms())
        });
        json!({"id":c.id,"title":c.title,"project_id":c.project_id,"provider":c.segments.last().map(|s|&s.provider),
            "profile_id":c.segments.last().and_then(|s|s.profile_id.as_ref()),"state":status,"capabilities":capabilities})
    }).collect()
}

async fn conversations(State(state): State<Arc<EngineState>>) -> Json<Value> {
    Json(tokio::task::spawn_blocking(move || json!(summaries(&state))).await.unwrap_or(json!([])))
}
async fn attention(State(state): State<Arc<EngineState>>) -> Json<Value> {
    Json(tokio::task::spawn_blocking(move || json!(summaries(&state).into_iter().filter(|c|
        c["capabilities"]["approve"] == true || c["capabilities"]["prompt"] == true || c["state"] == "approval_required").collect::<Vec<_>>())).await.unwrap_or(json!([])))
}
#[derive(Deserialize)] struct Page { #[serde(default)] cursor: usize }
async fn timeline(State(state): State<Arc<EngineState>>, RoutePath(id): RoutePath<String>, Query(page): Query<Page>) -> Result<Json<Value>, ApiError> {
    tokio::task::spawn_blocking(move || {
        let (conversation,_) = current(&state,&id)?;
        let dir = state.state_file.parent().unwrap();
        let timeline = omni_core::conversations::timeline(&conversation,&omni_core::profiles(dir),page.cursor,100);
        let actions: Vec<_> = state.mobile.actions.lock().expect("actions poisoned").iter().filter(|a|a.conversation_id == id).cloned().collect();
        Ok(Json(json!({"timeline":timeline,"actions":actions})))
    }).await.map_err(|_|error(StatusCode::INTERNAL_SERVER_ERROR,"Falha ao ler timeline"))?
}
#[derive(Deserialize)] #[serde(deny_unknown_fields)] struct PromptBody { texto: String }
#[derive(Deserialize)] #[serde(deny_unknown_fields)] struct ApprovalBody { permitir: bool }
async fn prompt(State(state): State<Arc<EngineState>>, RoutePath(id): RoutePath<String>, headers: HeaderMap, Json(body): Json<PromptBody>) -> Result<(StatusCode,Json<Value>),ApiError> {
    if body.texto.trim().is_empty() || body.texto.len() > 16_000 || body.texto.chars().any(|c|c.is_control() && c != '\n' && c != '\t') || body.texto.trim_start().starts_with('/') {
        return Err(error(StatusCode::BAD_REQUEST,"Envie texto de até 16000 bytes, sem comandos slash ou caracteres de controle"));
    }
    enqueue_async(state,id,headers,ActionKind::Prompt(body.texto)).await
}
async fn approve(State(state): State<Arc<EngineState>>, RoutePath(id): RoutePath<String>, headers: HeaderMap, Json(body): Json<ApprovalBody>) -> Result<(StatusCode,Json<Value>),ApiError> {
    enqueue_async(state,id,headers,ActionKind::Approval(body.permitir)).await
}
async fn enqueue_async(state: Arc<EngineState>,id:String,headers:HeaderMap,kind:ActionKind) -> Result<(StatusCode,Json<Value>),ApiError> {
    tokio::task::spawn_blocking(move || enqueue(&state,&id,&headers,kind)).await.map_err(|_|error(StatusCode::INTERNAL_SERVER_ERROR,"Falha na fila"))?
}
fn enqueue(state:&Arc<EngineState>,id:&str,headers:&HeaderMap,kind:ActionKind) -> Result<(StatusCode,Json<Value>),ApiError> {
    let key = headers.get("idempotency-key").and_then(|h|h.to_str().ok()).filter(|s|!s.is_empty() && s.len() <= 128)
        .ok_or_else(||error(StatusCode::BAD_REQUEST,"Idempotency-Key obrigatório"))?;
    let mut actions = state.mobile.actions.lock().expect("actions poisoned");
    if let Some(action) = actions.iter().find(|a| a.key == key) {
        if action.conversation_id != id || action.kind != kind { return Err(error(StatusCode::CONFLICT,"Chave já usada para outra ação")); }
        return Ok((StatusCode::ACCEPTED,Json(json!(action))));
    }
    actions.retain(|a| now_ms().saturating_sub(a.created_at_ms) < 600_000 || a.state == "queued" || a.state == "executing");
    if actions.len() >= 1024 || actions.iter().filter(|a|a.state == "queued").count() >= 128 {
        return Err(error(StatusCode::TOO_MANY_REQUESTS,"Fila cheia; aguarde"));
    }
    let (_,session) = current(state,id)?;
    let session = session.ok_or_else(||error(StatusCode::CONFLICT,"Nenhuma sessão existente para esta conversa"))?;
    let capability = interaction::capabilities(&session);
    let supported = match kind { ActionKind::Prompt(_) => capability.prompt, ActionKind::Approval(_) => capability.approve };
    if !supported { return Err(error(StatusCode::CONFLICT,"Sessão ocupada ou tela não reconhecida; atualize o status")); }
    if headers.get("if-match").and_then(|h|h.to_str().ok()) != Some(capability.revision.as_str()) {
        return Err(error(StatusCode::PRECONDITION_FAILED,"O contexto mudou; atualize antes de responder"));
    }
    let session_id = session.meta.lock().expect("metadata poisoned").id.clone();
    let action = Action { id: state.next_id(),conversation_id:id.into(),session_id,state:"queued".into(),created_at_ms:now_ms(),error:None,key:key.into(),revision:capability.revision,kind };
    let response = json!(action); actions.push_back(action); drop(actions);
    state.mobile.pending.notify_one();
    Ok((StatusCode::ACCEPTED,Json(response)))
}

fn execute(state:&Arc<EngineState>, action:&Action) -> Result<()> {
    execute_checked(state,action,interaction::provider_running)
}

fn execute_checked(state:&Arc<EngineState>, action:&Action, is_running: impl Fn(Option<u32>, &str) -> bool) -> Result<()> {
    if now_ms().saturating_sub(action.created_at_ms) >= 60_000 { return Err(anyhow!("Ação expirada")); }
    let (_,current_session) = current(state,&action.conversation_id).map_err(|_|anyhow!("Conversa removida"))?;
    let session = current_session.ok_or_else(||anyhow!("Sessão encerrada"))?;
    // Hold the sessions registry through validation/write so close cannot replace this session.
    let sessions = state.sessions.lock().map_err(|_|anyhow!("sessions poisoned"))?;
    if !matches!(sessions.get(&action.session_id),Some(SessionEntry::Live(s)) if Arc::ptr_eq(s,&session)) { return Err(anyhow!("Sessão trocada")); }
    let mut context = session.interaction.lock().map_err(|_|anyhow!("screen poisoned"))?;
    if session.reserved.load(Ordering::SeqCst) || context.revision(&session) != action.revision { return Err(anyhow!("Contexto mudou antes da execução")); }
    let meta = session.meta.lock().map_err(|_|anyhow!("metadata poisoned"))?.clone();
    let provider = meta.provider.as_deref().unwrap_or("");
    if !is_running(meta.pid,provider) { return Err(anyhow!("CLI não está mais ativo")); }
    let data = match &action.kind {
        ActionKind::Prompt(text) if interaction::ready(context.parser.screen(),provider) => format!("\x1b[200~{text}\x1b[201~\r"),
        ActionKind::Approval(allow) => { let dialog = interaction::approval(&context.parser.screen().contents(),provider).ok_or_else(||anyhow!("Aprovação não reconhecida"))?; if *allow { dialog.0 } else { dialog.1 } },
        _ => return Err(anyhow!("Entrada não está disponível")),
    };
    context.input_revision += 1;
    let mut writer = session.writer.lock().map_err(|_|anyhow!("writer poisoned"))?;
    writer.write_all(data.as_bytes())?; writer.flush()?;
    Ok(())
}

async fn asset(request: Request) -> Response {
    let path = request.uri().path().trim_start_matches('/');
    let path = if path.is_empty() { "index.html" } else { path };
    #[cfg(mobile_assets)]
    if let Some(file) = ASSETS.get_file(path) {
        let content_type = if path.ends_with(".html") { "text/html; charset=utf-8" } else if path.ends_with(".js") { "text/javascript; charset=utf-8" } else if path.ends_with(".css") { "text/css; charset=utf-8" } else { "application/octet-stream" };
        return ([("content-type",content_type)],file.contents()).into_response();
    }
    let _ = path;
    (StatusCode::NOT_FOUND,"Página não encontrada; em desenvolvimento, execute npm run build:mobile antes de compilar o engine").into_response()
}

#[cfg(test)]
mod tests {
    use super::*;
    use tower::ServiceExt;
    use axum::body::{Body,to_bytes};

    fn fixture() -> (tempfile::TempDir, Arc<EngineState>) {
        let dir = tempfile::tempdir().unwrap();
        let state = Arc::new(EngineState { persist_lock:Mutex::new(()),usage_cache:Mutex::new(HashMap::new()),mobile:MobileRuntime::new(dir.path()),
            token:"test-only".into(),state_file:dir.path().join("sessions.json"),sessions:Mutex::new(HashMap::new()),id_sequence:AtomicU64::new(1) });
        atomic_write_json(&dir.path().join("conversations.json"),&json!({"version":1,"conversations":[{
            "id":"c","project_id":"p","cwd":"C:/test","title":"Teste","created_at_ms":1,"segments":[]
        }]})).unwrap();
        (dir,state)
    }

    /// Local visual harness: no real profiles, credentials, sessions or user data.
    #[tokio::test]
    #[ignore = "Run explicitly while checking the mobile UI in a browser (3 minutes)"]
    async fn browser_fixture() {
        let (_dir,state) = fixture();
        *state.mobile.config.lock().unwrap() = MobileConfig{enabled:true,bind:"127.0.0.1:47329".into()};
        let listener = TcpListener::bind("127.0.0.1:47329").await.unwrap();
        let stop = Arc::new(Notify::new());
        let notify = stop.clone();
        let app = router(state).route("/__test_stop",post(move || { let notify = notify.clone(); async move { notify.notify_one(); StatusCode::OK } }));
        axum::serve(listener,app).with_graceful_shutdown(async move {
            tokio::select! { _ = stop.notified() => {}, _ = tokio::time::sleep(std::time::Duration::from_secs(180)) => {} }
        }).await.unwrap();
    }
    fn req(method:&str, uri:&str, origin:&str, body:&str) -> Request {
        Request::builder().method(method).uri(uri).header("host","127.0.0.1:47322").header("origin",origin)
            .header("content-type","application/json").header("idempotency-key","test-key").body(Body::from(body.to_owned())).unwrap()
    }

    #[tokio::test] async fn concurrent_readers_and_no_privileged_http_surface() {
        let (_dir,state) = fixture();
        let app = router(state.clone());
        let (a,b) = tokio::join!(app.clone().oneshot(req("GET","/conversas","","")),app.clone().oneshot(req("GET","/atencao","","")));
        assert_eq!(a.unwrap().status(),StatusCode::OK); assert_eq!(b.unwrap().status(),StatusCode::OK);
        let response = app.clone().oneshot(req("GET","/conversas/c/timeline","","")).await.unwrap();
        let data:Value = serde_json::from_slice(&to_bytes(response.into_body(),1_000_000).await.unwrap()).unwrap();
        assert_eq!(data["timeline"]["messages"],json!([]));
        let response = app.clone().oneshot(req("POST","/conversas/c/prompt","http://127.0.0.1:47322",r#"{"texto":"oi"}"#)).await.unwrap();
        assert_eq!(response.status(),StatusCode::CONFLICT);
        assert!(state.sessions.lock().unwrap().is_empty(),"HTTP must not spawn a terminal");
        assert_ne!(app.oneshot(req("POST","/spawn_terminal","http://127.0.0.1:47322","{}")).await.unwrap().status(),StatusCode::OK);
    }
    #[tokio::test] async fn foreign_origin_unknown_conversation_and_invalid_prompt_are_rejected() {
        let (_dir,state) = fixture(); let app = router(state);
        assert_eq!(app.clone().oneshot(req("POST","/conversas/c/prompt","https://evil.example",r#"{"texto":"oi"}"#)).await.unwrap().status(),StatusCode::FORBIDDEN);
        assert_eq!(app.clone().oneshot(req("GET","/conversas/missing/timeline","","")).await.unwrap().status(),StatusCode::NOT_FOUND);
        assert_eq!(app.oneshot(req("POST","/conversas/c/prompt","http://127.0.0.1:47322",r#"{"texto":"/exit"}"#)).await.unwrap().status(),StatusCode::BAD_REQUEST);
    }
    #[test] fn idempotent_retry_does_not_need_a_live_session_or_enqueue_again() {
        let (_dir,state) = fixture();
        state.mobile.actions.lock().unwrap().push_back(Action { id:"a".into(),conversation_id:"c".into(),session_id:"gone".into(),state:"sent".into(),created_at_ms:now_ms(),error:None,key:"test-key".into(),revision:"old".into(),kind:ActionKind::Prompt("oi".into()) });
        let headers = req("POST","/conversas/c/prompt","http://127.0.0.1:47322","").headers().clone();
        assert_eq!(enqueue(&state,"c",&headers,ActionKind::Prompt("oi".into())).unwrap().0,StatusCode::ACCEPTED);
        assert_eq!(state.mobile.actions.lock().unwrap().len(),1);
        assert_eq!(enqueue(&state,"c",&headers,ActionKind::Prompt("outro".into())).unwrap_err().0,StatusCode::CONFLICT);
        let mut action = state.mobile.actions.lock().unwrap()[0].clone();
        action.created_at_ms = now_ms().saturating_sub(60_001);
        assert!(execute(&state,&action).unwrap_err().to_string().contains("expirada"));
    }
    #[test] fn loopback_default_and_no_wildcard() {
        let config = MobileConfig::default(); assert!(!config.enabled); assert!(validate(&config).is_ok());
        assert!(validate(&MobileConfig{enabled:true,bind:"0.0.0.0:47322".into()}).is_err());
        assert!(validate(&MobileConfig{enabled:true,bind:"127.0.0.1:47321".into()}).is_err());
    }

    #[cfg(windows)]
    mod actions {
        use super::*;
        #[derive(Debug)] struct FakeChild;
        impl portable_pty::ChildKiller for FakeChild {
            fn kill(&mut self) -> std::io::Result<()> { Ok(()) }
            fn clone_killer(&self) -> Box<dyn portable_pty::ChildKiller + Send + Sync> { Box::new(FakeChild) }
        }
        impl Child for FakeChild {
            fn try_wait(&mut self) -> std::io::Result<Option<portable_pty::ExitStatus>> { Ok(None) }
            fn wait(&mut self) -> std::io::Result<portable_pty::ExitStatus> { Ok(portable_pty::ExitStatus::with_exit_code(0)) }
            fn process_id(&self) -> Option<u32> { Some(42) }
            fn as_raw_handle(&self) -> Option<std::os::windows::io::RawHandle> { None }
        }
        struct FakeMaster;
        impl MasterPty for FakeMaster {
            fn resize(&self,_:PtySize) -> Result<()> { Ok(()) }
            fn get_size(&self) -> Result<PtySize> { Ok(PtySize{rows:20,cols:100,pixel_width:0,pixel_height:0}) }
            fn try_clone_reader(&self) -> Result<Box<dyn Read + Send>> { Ok(Box::new(std::io::empty())) }
            fn take_writer(&self) -> Result<Box<dyn Write + Send>> { Ok(Box::new(std::io::sink())) }
        }
        struct RecordingWriter(Arc<Mutex<Vec<u8>>>);
        impl Write for RecordingWriter {
            fn write(&mut self,bytes:&[u8]) -> std::io::Result<usize> { self.0.lock().unwrap().extend_from_slice(bytes); Ok(bytes.len()) }
            fn flush(&mut self) -> std::io::Result<()> { Ok(()) }
        }
        fn fake_session(state:&Arc<EngineState>,text:&str) -> (Arc<LiveSession>,Arc<Mutex<Vec<u8>>>,Action) {
            let bytes = Arc::new(Mutex::new(Vec::new()));
            let meta:TerminalSession = serde_json::from_value(json!({"id":"s","project_id":"p","name":"Test","cwd":"C:/test","shell":"test",
                "state":"answered","pid":42,"created_at_ms":1,"last_activity_at_ms":1,"output_seq":0,"rows":20,"cols":100,
                "provider":"claude","profile_id":"profile","conversation_id":"c"})).unwrap();
            let mut context = interaction::Interaction::new(20,100); context.parser.process(b"\x1b[?2004h"); context.parser.process(text.as_bytes());
            let session = Arc::new(LiveSession{interaction:Mutex::new(context),reserved:std::sync::atomic::AtomicBool::new(false),
                meta:Mutex::new(meta),writer:Mutex::new(Box::new(RecordingWriter(bytes.clone()))),master:Mutex::new(Box::new(FakeMaster)),
                child:Mutex::new(Box::new(FakeChild)),output:Mutex::new(OutputBuffer{chunks:VecDeque::new(),bytes:0,next_seq:0})});
            state.sessions.lock().unwrap().insert("s".into(),SessionEntry::Live(session.clone()));
            atomic_write_json(&state.state_file.with_file_name("conversations.json"),&json!({"version":1,"conversations":[{
                "id":"c","project_id":"p","cwd":"C:/test","title":"Test","created_at_ms":1,
                "segments":[{"provider":"claude","profile_id":"profile","terminal_session_id":"s","started_at_ms":1}]
            }]})).unwrap();
            let revision = session.interaction.lock().unwrap().revision(&session);
            let action = Action{id:"a".into(),conversation_id:"c".into(),session_id:"s".into(),state:"queued".into(),created_at_ms:now_ms(),error:None,key:"key".into(),revision,kind:ActionKind::Prompt("Olá\nmundo".into())};
            (session,bytes,action)
        }
        #[test] fn sends_one_atomic_bracketed_prompt_and_invalidates_revision() {
            let (_dir,state) = fixture(); let (_session,bytes,action) = fake_session(&state,"Claude Code\r\n❯ ");
            execute_checked(&state,&action,|_,_|true).unwrap();
            assert_eq!(&*bytes.lock().unwrap(),"\x1b[200~Olá\nmundo\x1b[201~\r".as_bytes());
            assert!(execute_checked(&state,&action,|_,_|true).is_err());
        }
        #[test] fn rejects_desktop_input_closed_cli_and_stale_dialog_without_writing() {
            let (_dir,state) = fixture(); let (session,bytes,mut action) = fake_session(&state,"Claude Code\r\nDo you want to proceed?\r\n❯ 1. Yes\r\n2. Yes, always\r\n3. No");
            action.kind = ActionKind::Approval(true);
            assert!(execute_checked(&state,&action,|_,_|false).is_err());
            session.interaction.lock().unwrap().input_revision += 1;
            assert!(execute_checked(&state,&action,|_,_|true).is_err());
            state.sessions.lock().unwrap().clear();
            assert!(execute_checked(&state,&action,|_,_|true).is_err());
            assert!(bytes.lock().unwrap().is_empty());
        }
        #[test] fn single_use_approval_and_denial_do_not_select_persistent_permission() {
            for (allow,expected) in [(true,"1\r"),(false,"3\r")] {
                let (_dir,state) = fixture(); let (_,bytes,mut action) = fake_session(&state,"Claude Code\r\nDo you want to proceed?\r\n❯ 1. Yes\r\n2. Yes, always\r\n3. No");
                action.kind = ActionKind::Approval(allow); execute_checked(&state,&action,|_,_|true).unwrap();
                assert_eq!(&*bytes.lock().unwrap(),expected.as_bytes());
            }
        }
    }
}
