use serde::{de::DeserializeOwned, Deserialize, Serialize};
use std::{fs, io, path::Path};

pub const PROTOCOL_VERSION: u16 = 1;
pub const DEFAULT_ENGINE_PORT: u16 = 47_321;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum SessionState {
    Working,
    Answered,
    ApprovalRequired,
    Crashed,
    Stopped,
    Orphan,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct TerminalSession {
    pub id: String,
    pub project_id: String,
    pub name: String,
    pub cwd: String,
    pub shell: String,
    pub state: SessionState,
    pub pid: Option<u32>,
    pub created_at_ms: u64,
    pub last_activity_at_ms: u64,
    pub output_seq: u64,
    pub rows: u16,
    pub cols: u16,
    #[serde(default)]
    pub input_locked: bool,
    /// Por que a sessão parou, quando o motivo não cabe no `state`: `"usage_limit"` ou
    /// `"api_error"`. Campo à parte e não variante de `SessionState` de propósito — `state` é
    /// reescrito a cada chunk em `append_output`, então um estado novo seria apagado pelo byte
    /// seguinte de saída.
    #[serde(default)]
    pub notice: Option<String>,
    #[serde(default)]
    pub initial_command: Option<String>,
    /// Variáveis de ambiente injetadas no shell da PTY. É por aqui que o isolamento de conta
    /// acontece (`CLAUDE_CONFIG_DIR`, `CODEX_HOME`) — o CLI é digitado no shell, então herda daqui.
    /// Guardado na sessão para que `restart` não perca a conta.
    #[serde(default)]
    pub env: Vec<(String, String)>,
    /// Metadata de conversa. `#[serde(default)]` em todos: o `sessions.json` gravado por versões
    /// anteriores precisa continuar carregando.
    #[serde(default)]
    pub provider: Option<String>,
    #[serde(default)]
    pub profile_id: Option<String>,
    #[serde(default)]
    pub conversation_id: Option<String>,
    /// Id da sessão do lado do provider (o `--session-id` do Claude), que dá o caminho do
    /// transcript em disco.
    #[serde(default)]
    pub external_session_id: Option<String>,
}

/// Escrita atômica de JSON: grava em `.tmp` ao lado e renomeia por cima. Um crash no meio deixa o
/// arquivo anterior intacto em vez de um JSON truncado.
pub fn atomic_write_json<T: Serialize>(path: &Path, value: &T) -> io::Result<()> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let encoded = serde_json::to_vec_pretty(value)?;
    let temporary = path.with_extension("json.tmp");
    fs::write(&temporary, encoded)?;
    fs::rename(temporary, path)
}

/// Lê um JSON, devolvendo o default quando o arquivo não existe ou está corrompido — todo store
/// deste app é cache reconstruível, nunca fonte única.
pub fn read_json_or_default<T: DeserializeOwned + Default>(path: &Path) -> T {
    fs::read(path)
        .ok()
        .and_then(|data| serde_json::from_slice(&data).ok())
        .unwrap_or_default()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum EngineRequest {
    AccountUsage { token: String, profile_id: String, refresh: bool },
    MobileSettings { token: String, config: Option<MobileConfig> },
    Ping { token: String },
    ListSessions { token: String },
    SpawnTerminal {
        token: String,
        project_id: String,
        name: String,
        cwd: String,
        shell: Option<String>,
        initial_command: Option<String>,
        rows: u16,
        cols: u16,
        #[serde(default)]
        env: Vec<(String, String)>,
        #[serde(default)]
        provider: Option<String>,
        #[serde(default)]
        profile_id: Option<String>,
        #[serde(default)]
        conversation_id: Option<String>,
        #[serde(default)]
        external_session_id: Option<String>,
    },
    WriteTerminal { token: String, session_id: String, data: String },
    ResizeTerminal { token: String, session_id: String, rows: u16, cols: u16 },
    StopSession { token: String, session_id: String },
    CloseSession { token: String, session_id: String },
    DuplicateSession { token: String, session_id: String },
    RestartSession { token: String, session_id: String },
    Snapshot { token: String, session_id: String, since: u64 },
    Shutdown { token: String },
}

impl EngineRequest {
    /// Requisição que só lê estado — repetir é inofensivo. Usado pelo cliente para decidir se pode
    /// reenviar depois de perder uma conexão reaproveitada; repetir um `SpawnTerminal` abriria uma
    /// segunda sessão, e um `WriteTerminal` digitaria duas vezes dentro do agente.
    ///
    /// `AccountUsage` fica **de fora** de propósito: com `refresh` ele digita `/usage` na PTY do
    /// agente, então é escrita disfarçada de leitura.
    pub fn read_only(&self) -> bool {
        matches!(self, Self::Ping { .. } | Self::ListSessions { .. } | Self::Snapshot { .. })
    }

    pub fn token(&self) -> &str {
        match self {
            Self::AccountUsage { token, .. } | Self::MobileSettings { token, .. } => token,
            Self::Ping { token }
            | Self::ListSessions { token }
            | Self::SpawnTerminal { token, .. }
            | Self::WriteTerminal { token, .. }
            | Self::ResizeTerminal { token, .. }
            | Self::StopSession { token, .. }
            | Self::CloseSession { token, .. }
            | Self::DuplicateSession { token, .. }
            | Self::RestartSession { token, .. }
            | Self::Snapshot { token, .. }
            | Self::Shutdown { token } => token,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum EngineResponse {
    AccountUsage { usage: omni_core::usage::AccountUsage },
    MobileSettings { config: MobileConfig, listening: Option<String>, error: Option<String> },
    Pong { protocol_version: u16, engine_pid: u32 },
    Sessions { sessions: Vec<TerminalSession> },
    Session { session: TerminalSession },
    Snapshot { session: TerminalSession, from_seq: u64, next_seq: u64, data: String },
    Ok,
    Error { code: String, message: String },
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct MobileConfig { pub enabled: bool, pub bind: String }
impl Default for MobileConfig {
    fn default() -> Self { Self { enabled: false, bind: "127.0.0.1:47322".into() } }
}
