use serde::{de::DeserializeOwned, Deserialize, Serialize};
use std::{fs, io, path::Path};

pub const PROTOCOL_VERSION: u16 = 1;
pub const DEFAULT_ENGINE_PORT: u16 = 47_321;
/// Porta do engine quando o app roda em desenvolvimento (`npm run dev`).
///
/// **Existe para o dev nunca encostar no app instalado.** Com a mesma porta, a mesma pasta e o
/// mesmo token, `npm run dev` conversava com o engine instalado — e o `build-engine.mjs`, ao achar
/// o binário travado, mandava `shutdown` para ele, derrubando o app e todas as sessões abertas.
pub const DEV_ENGINE_PORT: u16 = 47_341;

/// Pasta de dados do engine (token, sessões, conversas, perfis). Separada por modo pelo mesmo
/// motivo da porta: um token diferente faz o engine instalado recusar qualquer pedido do dev.
pub const DATA_DIR: &str = "com.omni.agents";
pub const DEV_DATA_DIR: &str = "com.omni.agents.dev";

/// Data de modificação em ms desde a época — compartilhada para engine e app medirem igual.
pub fn modified_ms(path: &Path) -> Option<u64> {
    let modified = fs::metadata(path).ok()?.modified().ok()?;
    modified.duration_since(std::time::UNIX_EPOCH).ok().map(|duration| duration.as_millis() as u64)
}

/// Raiz de dados local do usuário, onde `DATA_DIR` fica. Mesmas pastas que o Tauri usa em
/// `app_local_data_dir`: `%LOCALAPPDATA%` no Windows, `~/Library/Application Support` no macOS e
/// `$XDG_DATA_HOME` (ou `~/.local/share`) no Linux.
pub fn local_data_root() -> Option<std::path::PathBuf> {
    use std::{env::var_os, path::PathBuf};
    if cfg!(windows) {
        return var_os("LOCALAPPDATA").map(PathBuf::from);
    }
    let home = var_os("HOME").map(PathBuf::from);
    if cfg!(target_os = "macos") {
        return home.map(|home| home.join("Library").join("Application Support"));
    }
    var_os("XDG_DATA_HOME").map(PathBuf::from).filter(|path| path.is_absolute())
        .or_else(|| home.map(|home| home.join(".local").join("share")))
}

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
    /// Sobe 1 a cada evento que merece aviso: Claude/Codex terminou um turno de verdade ou abriu
    /// diálogo de aprovação. O desktop notifica quando ele muda — nunca por silêncio ou estado.
    #[serde(default)]
    pub attention_seq: u64,
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
    MobileSettings { token: String, config: Option<MobileConfig>, #[serde(default)] rotate: bool },
    PublishWorkspace {
        token: String,
        projects: Vec<PublishedProject>,
        agents: Vec<PublishedAgent>,
        /// Aparência do desktop, para o celular sair igual. `default`: desktop antigo não manda.
        #[serde(default)]
        theme: Option<PublishedTheme>,
    },
    /// Testa se o próprio servidor do celular atende. `listening` só prova que o bind deu certo.
    MobileCheck { token: String },
    /// Cadastro do Authy (TOTP) que libera o pareamento de aparelhos sem o QR.
    MobileTotp { token: String, action: TotpAction },
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
    /// Renomear a conversa. Mora aqui (e não num comando do Tauri escrevendo o arquivo) para o
    /// índice de conversas ter um escritor só — desktop e celular passam pelo mesmo caminho.
    RenameConversation { token: String, conversation_id: String, title: String },
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
            Self::AccountUsage { token, .. }
            | Self::MobileSettings { token, .. }
            | Self::PublishWorkspace { token, .. }
            | Self::MobileCheck { token }
            | Self::MobileTotp { token, .. } => token,
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
            | Self::RenameConversation { token, .. }
            | Self::Shutdown { token } => token,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum EngineResponse {
    AccountUsage { usage: omni_core::usage::AccountUsage },
    MobileSettings {
        config: MobileConfig,
        listening: Option<String>,
        error: Option<String>,
        #[serde(default)] qr: Option<String>,
        /// Endereço que o celular usa de fato: o do `tailscale serve` quando ligado, senão o bind.
        #[serde(default)] public_url: Option<String>,
        /// Nome MagicDNS deste PC, quando o Tailscale está no ar.
        #[serde(default)] magic_dns: Option<String>,
        /// Link para habilitar o Serve na conta, quando ele ainda não está habilitado.
        #[serde(default)] serve_hint: Option<String>,
        #[serde(default)] totp_confirmed: bool,
        /// `otpauth://` para o QR do Authy. **Só enquanto o cadastro não foi confirmado**: depois disso
        /// o segredo não sai mais do engine, nem para o desktop. Refazer = `TotpAction::Reset`.
        #[serde(default)] totp_uri: Option<String>,
    },
    /// Resultado do autoteste: `ok` diz se passou, `message` é texto para a tela.
    MobileCheck { ok: bool, message: String },
    /// `engine_exe`/`engine_exe_modified_ms`: o binário que este engine carregou e a data dele ao
    /// iniciar. Se o arquivo em disco mudou desde então, uma atualização trocou o binário por baixo
    /// de um engine vivo — no Windows o hook do NSIS mata o engine antes, no macOS/Linux ninguém mata.
    Pong {
        protocol_version: u16,
        engine_pid: u32,
        #[serde(default)] engine_exe: Option<String>,
        #[serde(default)] engine_exe_modified_ms: Option<u64>,
    },
    Sessions { sessions: Vec<TerminalSession> },
    Session { session: TerminalSession },
    Snapshot { session: TerminalSession, from_seq: u64, next_seq: u64, data: String },
    Ok,
    Error { code: String, message: String },
}

/// Projeção do workspace do desktop que o celular precisa. **Não** leva a árvore de layout, abas nem
/// git: o celular só precisa saber "qual projeto", e o engine só precisa do `path` para abrir uma
/// sessão lá dentro. Menos campo publicado é menos coisa exposta no HTTP.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Default)]
pub struct PublishedProject { pub id: String, pub name: String, pub path: String }

/// CLI de agente que o desktop confirmou existir no PATH. O celular escolhe **desta lista** —
/// nunca digita um binário.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Default)]
pub struct PublishedAgent { pub id: String, pub label: String, pub command: String, pub resume: Option<String> }

/// Aparência escolhida no desktop. Só identificadores (paleta, tema, fundo, relevo) — nunca
/// caminho de imagem: o fundo "Imagem" do PC vive no disco dele e não tem como chegar ao celular.
/// Strings livres de propósito: quem valida é o front, que já tem as tabelas e cai no padrão
/// quando não reconhece o valor.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Default)]
pub struct PublishedTheme {
    #[serde(default)] pub accent: String,
    #[serde(default)] pub theme: String,
    #[serde(default)] pub background: String,
    #[serde(default)] pub glass: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct PublishedWorkspace {
    #[serde(default)] pub projects: Vec<PublishedProject>,
    #[serde(default)] pub agents: Vec<PublishedAgent>,
    #[serde(default)] pub theme: Option<PublishedTheme>,
    /// Quando o desktop publicou pela última vez. O celular mostra a idade e quem decide se a
    /// lista ainda vale é quem está lendo — sem expiração automática no Rust.
    #[serde(default)] pub published_at_ms: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct MobileConfig {
    pub enabled: bool,
    pub bind: String,
    /// Segredo que o celular manda em `X-Omni-Token`. Quem gera é só o engine — o desktop nunca
    /// escolhe. `default` para o `mobile.json` gravado antes desta versão continuar carregando.
    #[serde(default)] pub token: String,
    /// Publicar pelo `tailscale serve` em vez de escutar no IP do Tailscale. Com isso o servidor
    /// fica **só em 127.0.0.1** e quem atende na rede é o tailscaled, com certificado TLS de
    /// verdade e nome MagicDNS fixo.
    #[serde(default)] pub serve: bool,
    /// Segredo TOTP em base32, compartilhado com o Authy. Como o `token`, só o engine escreve.
    #[serde(default)] pub totp_secret: String,
    /// O Authy provou ter o segredo (alguém digitou um código válido no PC). Antes disso o
    /// pareamento recusa qualquer código.
    #[serde(default)] pub totp_confirmed: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum TotpAction {
    /// Gera segredo novo e invalida o cadastro atual do Authy.
    Reset,
    /// Confirma o cadastro com um código atual do Authy.
    Confirm { code: String },
}
impl Default for MobileConfig {
    fn default() -> Self {
        Self { enabled: false, bind: "127.0.0.1:47322".into(), token: String::new(), serve: false, totp_secret: String::new(), totp_confirmed: false }
    }
}
