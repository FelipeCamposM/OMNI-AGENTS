//! Cliente do engine do OMNI, pelo mesmo protocolo local que a tela usa. O token mora num arquivo da
//! pasta do engine e nunca sai daqui: nem em resposta de ferramenta, nem em mensagem de erro.
use crate::caminho_padrao;
use serde_json::{json, Value};
use std::{
    fs,
    io::{BufRead, BufReader, Write},
    net::{SocketAddr, TcpStream},
    path::{Path, PathBuf},
    time::Duration,
};

const PORTA_PADRAO: u16 = 47321;
const CONEXAO: Duration = Duration::from_secs(3);
/// Iniciar um fluxo cria worktree, e exportar uma conversa longa lê o transcript inteiro.
const RESPOSTA: Duration = Duration::from_secs(60);
const SEM_ENGINE: &str = "O OMNI não respondeu. Abra o app e tente de novo.";

/// Onde as ferramentas leem e gravam. Os testes trocam tudo por pastas temporárias.
pub struct Contexto {
    pub pasta_do_engine: PathBuf,
    pub porta: u16,
    pub fluxos_globais: Option<PathBuf>,
    pub agentes_globais: Option<PathBuf>,
    /// Pasta em que a CLI abriu este MCP: a do projeto da conversa.
    pub pasta_atual: Option<PathBuf>,
}

impl Contexto {
    pub fn padrao() -> Self {
        let pasta_do_engine = std::env::var_os("OMNI_DATA_DIR").map(PathBuf::from)
            .or_else(|| Some(caminho_padrao()?.parent()?.parent()?.join("engine")))
            .unwrap_or_default();
        Self {
            pasta_do_engine,
            porta: std::env::var("OMNI_ENGINE_PORT").ok().and_then(|porta| porta.parse().ok()).unwrap_or(PORTA_PADRAO),
            fluxos_globais: omni_core::fluxos::pasta_global(),
            agentes_globais: omni_core::agentes::pasta_global(),
            pasta_atual: std::env::current_dir().ok(),
        }
    }

    pub fn perfis(&self) -> Vec<omni_core::Profile> {
        omni_core::profiles(&self.pasta_do_engine)
    }
}

fn ler_token(pasta: &Path) -> Result<String, String> {
    let token = fs::read_to_string(pasta.join("engine.token")).map_err(|_| SEM_ENGINE.to_string())?;
    Ok(token.trim().to_owned())
}

fn trocar(porta: u16, pedido: &Value) -> Option<Value> {
    let endereco = SocketAddr::from(([127, 0, 0, 1], porta));
    let mut conexao = TcpStream::connect_timeout(&endereco, CONEXAO).ok()?;
    conexao.set_read_timeout(Some(RESPOSTA)).ok()?;
    conexao.set_write_timeout(Some(RESPOSTA)).ok()?;
    writeln!(conexao, "{pedido}").ok()?;
    let mut linha = String::new();
    BufReader::new(conexao).read_line(&mut linha).ok()?;
    serde_json::from_str(&linha).ok()
}

/// Uma rota da API. Status de erro vira `Err` com a mensagem que a própria rota mandou.
pub fn api(contexto: &Contexto, metodo: &str, caminho: &str, corpo: Option<&Value>) -> Result<Value, String> {
    let pedido = json!({
        "type": "api", "token": ler_token(&contexto.pasta_do_engine)?, "method": metodo, "path": caminho,
        "body": corpo.map(Value::to_string), "headers": [["Content-Type", "application/json"]],
    });
    let resposta = trocar(contexto.porta, &pedido).ok_or(SEM_ENGINE)?;
    if resposta["type"] != "api" {
        return Err(resposta["message"].as_str().unwrap_or("O OMNI recusou o pedido.").to_owned());
    }
    let dados: Value = serde_json::from_str(resposta["body"].as_str().unwrap_or_default()).unwrap_or(Value::Null);
    let status = resposta["status"].as_u64().unwrap_or(500);
    if status >= 400 {
        return Err(dados["error"].as_str().map_or_else(|| format!("Falha HTTP {status}"), str::to_owned));
    }
    Ok(dados)
}

/// Id que vai no caminho da rota: só o que uma rota aceita, sem barra nem `..`.
pub fn segmento(valor: &str) -> Result<&str, String> {
    let valido = !valor.is_empty() && valor.chars().all(|letra| letra.is_ascii_alphanumeric() || matches!(letra, '-' | '_' | '.')) && !valor.contains("..");
    if valido { Ok(valor) } else { Err(format!("Id inválido: {valor}")) }
}
