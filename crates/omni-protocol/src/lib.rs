use serde::{Deserialize, Serialize};

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
    pub initial_command: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum EngineRequest {
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
    pub fn token(&self) -> &str {
        match self {
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
    Pong { protocol_version: u16, engine_pid: u32 },
    Sessions { sessions: Vec<TerminalSession> },
    Session { session: TerminalSession },
    Snapshot { session: TerminalSession, from_seq: u64, next_seq: u64, data: String },
    Ok,
    Error { code: String, message: String },
}
