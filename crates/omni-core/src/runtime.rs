//! Qual modelo (e com qual esforço) a CLI está de fato usando agora.
//!
//! Ninguém pergunta isso ao agente: o OMNI não escolhe o modelo, quem escolhe é a CLI — e ela pode
//! trocar no meio da conversa (`/model`). A única fonte que não mente é o registro que a própria
//! CLI grava a cada turno.
//!
//! - **Claude**: `projects/<slug>/<session>.jsonl`, entrada `assistant` — `message.model` e o
//!   `effort` do envelope.
//! - **Codex**: `sessions/**/rollout-*.jsonl`, entrada `turn_context` — `payload.model`.
//!
//! Os dois arquivos crescem sem limite (o transcript deste projeto passou de 4 MB), então a leitura
//! é sempre pela CAUDA: o último turno é o que vale, e ler o arquivo inteiro a cada poll seria
//! desperdício proporcional ao tamanho da conversa.
use crate::conversations::claude_transcript_path;
use serde::Serialize;
use serde_json::Value;
use std::{
    fs::File,
    io::{Read, Seek, SeekFrom},
    path::Path,
};

/// Quanto se lê do fim do arquivo. Um turno do Claude com ferramentas passa fácil de 100 KB, e o
/// que interessa está sempre no fim; 1 MB cobre vários turnos com folga.
const CAUDA_BYTES: u64 = 1024 * 1024;

/// De onde saiu a informação. Muda o que a UI pode afirmar: `Sessao` é o que de fato respondeu;
/// `Config` é só o que está configurado — a sessão ainda não produziu turno nenhum.
#[derive(Debug, Clone, Copy, Default, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum RuntimeSource {
    #[default]
    Sessao,
    Config,
}

#[derive(Debug, Clone, Default, Serialize, PartialEq, Eq)]
pub struct AgentRuntime {
    /// Id cru do modelo, como a CLI gravou (`claude-opus-5`, `gpt-6-astra`). Quem embeleza é a UI.
    pub model: Option<String>,
    /// `high` / `medium` / `low`… como a CLI gravou. `None` quando ela não registra esforço.
    pub effort: Option<String>,
    /// Versão da CLI, quando disponível — útil no tooltip para explicar formato inesperado.
    pub cli_version: Option<String>,
    /// Modo de permissão vigente (`plan`, `auto`, `default`, `acceptEdits`…), como a CLI gravou.
    /// O Claude Code escreve uma linha `{"type":"permission-mode","permissionMode":…}` a cada
    /// troca — ler a última é mais confiável que interpretar o rodapé da tela.
    pub permission_mode: Option<String>,
    pub source: RuntimeSource,
}

impl AgentRuntime {
    fn vazio(&self) -> bool {
        self.model.is_none() && self.effort.is_none()
    }
}

/// Últimos bytes do arquivo como texto. A primeira linha pode vir cortada ao meio — quem consome
/// descarta o que não for JSON válido, então não há tratamento especial aqui.
fn cauda(path: &Path, limite: u64) -> Option<String> {
    let mut arquivo = File::open(path).ok()?;
    let tamanho = arquivo.metadata().ok()?.len();
    let inicio = tamanho.saturating_sub(limite);
    arquivo.seek(SeekFrom::Start(inicio)).ok()?;
    let mut bruto = Vec::with_capacity((tamanho - inicio) as usize);
    arquivo.read_to_end(&mut bruto).ok()?;
    Some(String::from_utf8_lossy(&bruto).into_owned())
}

fn texto(valor: &Value, chave: &str) -> Option<String> {
    valor.get(chave)?.as_str().map(str::to_owned)
}

/// Modelo configurado no `settings.json` da conta (`"model": "opus"`). É apelido, sem versão e sem
/// esforço — serve só como provisório enquanto a sessão não respondeu nada.
fn claude_config_model(config_dir: &Path) -> Option<AgentRuntime> {
    let bruto = std::fs::read_to_string(config_dir.join("settings.json")).ok()?;
    let valor: Value = serde_json::from_str(&bruto).ok()?;
    Some(AgentRuntime {
        model: texto(&valor, "model"),
        effort: None,
        cli_version: None,
        permission_mode: None,
        source: RuntimeSource::Config,
    })
    .filter(|runtime| runtime.model.is_some())
}

/// Lê o transcript de trás para frente e para no primeiro turno de `assistant` completo.
///
/// Sessão recém-aberta ainda não tem turno nenhum (o arquivo existe, mas só com metadados) — aí cai
/// no modelo configurado, marcado como `Config`. Sem isso a etiqueta ficava invisível desde a
/// abertura da aba até a primeira resposta, que é quando o usuário mais quer saber com quem está
/// falando.
pub fn claude_runtime(config_dir: &Path, cwd: &str, session_id: &str) -> Option<AgentRuntime> {
    let caminho = claude_transcript_path(config_dir, cwd, session_id);
    let Some(conteudo) = cauda(&caminho, CAUDA_BYTES) else {
        return claude_config_model(config_dir);
    };
    let mut resultado = AgentRuntime::default();
    // O modo é independente do modelo: a última linha de `permission-mode` vale mesmo que o turno
    // corrente ainda não tenha resposta de assistente.
    resultado.permission_mode = conteudo.lines().rev().find_map(|linha| {
        let entrada = serde_json::from_str::<Value>(linha).ok()?;
        (entrada.get("type").and_then(Value::as_str) == Some("permission-mode"))
            .then(|| texto(&entrada, "permissionMode"))
            .flatten()
    });

    for linha in conteudo.lines().rev() {
        let Ok(entrada) = serde_json::from_str::<Value>(linha) else { continue };
        if entrada.get("type").and_then(Value::as_str) != Some("assistant") {
            continue;
        }
        let Some(modelo) = entrada.get("message").and_then(|m| texto(m, "model")) else { continue };
        // `<synthetic>`: mensagem que a própria CLI fabricou (interrupção do usuário, erro local),
        // não resposta de modelo. Num transcript deste projeto há 677 entradas reais e uma dessas —
        // e bastou ela ser a última para a etiqueta exibir "<SYNTHETIC>" no lugar do modelo.
        // Qualquer marcador entre `<>` é tratado assim: nome de modelo real nunca tem colchete.
        if modelo.starts_with('<') {
            continue;
        }
        resultado.model = Some(modelo);
        // `perTurnEffort` é o esforço pedido só naquele turno; `effort` é o ajuste vigente. O do
        // turno ganha quando existe — é o que de fato rodou.
        resultado.effort = texto(&entrada, "perTurnEffort").or_else(|| texto(&entrada, "effort"));
        resultado.cli_version = texto(&entrada, "version");
        return Some(resultado);
    }
    (!resultado.vazio()).then_some(resultado).or_else(|| claude_config_model(config_dir))
}

/// `model` e `model_reasoning_effort` do `config.toml`, para preencher o que o rollout não registra.
///
/// `plan_mode_reasoning_effort` fica **de fora**: vale só no modo plano, e exibi-lo como o esforço
/// da sessão seria afirmar algo que não é verdade fora daquele modo.
fn codex_config(config_dir: &Path) -> AgentRuntime {
    let mut runtime = AgentRuntime { source: RuntimeSource::Config, ..AgentRuntime::default() };
    let Ok(bruto) = std::fs::read_to_string(config_dir.join("config.toml")) else { return runtime };
    for linha in bruto.lines() {
        let linha = linha.trim();
        // Só o topo do arquivo: dentro de uma seção (`[tui]`, `[profiles.x]`) as mesmas chaves
        // pertencem a outro escopo e não descrevem a sessão padrão.
        if linha.starts_with('[') {
            break;
        }
        let Some((chave, valor)) = linha.split_once('=') else { continue };
        let valor = valor.trim().trim_matches('"').to_owned();
        if valor.is_empty() {
            continue;
        }
        match chave.trim() {
            "model" => runtime.model = Some(valor),
            "model_reasoning_effort" => runtime.effort = Some(valor),
            _ => {}
        }
    }
    runtime
}

/// O Codex não recebe `--session-id` do OMNI, então o rollout é localizado pelo `cwd`: o mais
/// recente cujo `session_meta` aponta para esta pasta.
///
/// ponytail: casar por cwd erra se houver DUAS sessões do Codex na mesma pasta ao mesmo tempo —
/// mostra o modelo da mais recente para ambas. Upgrade path: o Codex passar a aceitar um id de
/// sessão fixado por quem o inicia, como o Claude já aceita.
pub fn codex_runtime(config_dir: &Path, cwd: &str) -> Option<AgentRuntime> {
    let alvo = cwd.trim_end_matches(['\\', '/']).to_lowercase();
    let mut arquivos: Vec<_> = crate::rollouts(&config_dir.join("sessions"))
        .into_iter()
        .filter_map(|path| Some((path.metadata().ok()?.modified().ok()?, path)))
        .collect();
    arquivos.sort_by(|a, b| b.0.cmp(&a.0));

    for (_, path) in arquivos.into_iter().take(20) {
        let Some(conteudo) = cauda(&path, CAUDA_BYTES) else { continue };
        let mut resultado = AgentRuntime::default();
        let mut desta_pasta = false;

        for linha in conteudo.lines() {
            let Ok(entrada) = serde_json::from_str::<Value>(linha) else { continue };
            let Some(payload) = entrada.get("payload") else { continue };
            match entrada.get("type").and_then(Value::as_str) {
                Some("session_meta") => {
                    desta_pasta = texto(payload, "cwd")
                        .is_some_and(|c| c.trim_end_matches(['\\', '/']).to_lowercase() == alvo);
                    resultado.cli_version = texto(payload, "cli_version");
                }
                Some("turn_context") => {
                    // Último turno vence: o modelo pode mudar no meio da sessão.
                    resultado.model = texto(payload, "model").or(resultado.model);
                    resultado.effort = texto(payload, "effort")
                        .or_else(|| texto(payload, "reasoning_effort"))
                        .or_else(|| texto(payload, "model_reasoning_effort"))
                        .or(resultado.effort);
                }
                _ => {}
            }
        }

        // `session_meta` mora no início do arquivo; num rollout grande a cauda pode não alcançá-lo,
        // e aí não dá para afirmar que é desta pasta — pular é melhor que mostrar modelo alheio.
        if desta_pasta && !resultado.vazio() {
            // O rollout registra `reasoning_effort: null` quando o modelo não expõe esforço —
            // nesse caso o configurado é a única coisa verdadeira que dá pra dizer.
            if resultado.effort.is_none() {
                resultado.effort = codex_config(config_dir).effort;
            }
            return Some(resultado);
        }
    }
    let config = codex_config(config_dir);
    (!config.vazio()).then_some(config)
}

#[cfg(test)]
mod tests {
    /// O Claude grava uma linha por troca de modo; a **última** é o modo vigente. Ler isso é o que
    /// deixa a etiqueta do desktop e o botão do celular mostrarem plano/automático sem ler a tela.
    #[test]
    fn modo_de_permissao_sai_da_ultima_linha_do_transcript() {
        let dir = tempfile::tempdir().unwrap();
        let projetos = dir.path().join("projects").join("C--t");
        std::fs::create_dir_all(&projetos).unwrap();
        let linhas = [
            r#"{"type":"permission-mode","permissionMode":"auto","sessionId":"s"}"#,
            r#"{"type":"assistant","message":{"role":"assistant","model":"claude-opus-5"},"version":"2.1.0"}"#,
            r#"{"type":"permission-mode","permissionMode":"plan","sessionId":"s"}"#,
        ];
        std::fs::write(projetos.join("s.jsonl"), linhas.join("
")).unwrap();

        let runtime = claude_runtime(dir.path(), "C:/t", "s").expect("runtime");
        assert_eq!(runtime.permission_mode.as_deref(), Some("plan"));
        assert_eq!(runtime.model.as_deref(), Some("claude-opus-5"));
    }

    use super::*;
    use std::fs;

    #[test]
    fn claude_pega_o_ultimo_turno_e_ignora_lixo_e_linha_cortada() {
        let dir = tempfile::tempdir().expect("tempdir");
        let cwd = "D:/dev/projeto";
        let caminho = claude_transcript_path(dir.path(), cwd, "sessao-1");
        fs::create_dir_all(caminho.parent().expect("pai")).expect("mkdir");
        fs::write(
            &caminho,
            concat!(
                r#"{"type":"assistant","message":{"model":"claude-sonnet-4-5"},"effort":"low","version":"2.0.0"}"#, "\n",
                "linha que não é json\n",
                r#"{"type":"user","message":{"content":"oi"}}"#, "\n",
                r#"{"type":"assistant","message":{"model":"claude-opus-5"},"effort":"high","version":"2.1.273"}"#, "\n",
            ),
        )
        .expect("escrever");

        let runtime = claude_runtime(dir.path(), cwd, "sessao-1").expect("runtime");
        assert_eq!(runtime.model.as_deref(), Some("claude-opus-5"));
        assert_eq!(runtime.effort.as_deref(), Some("high"));
        assert_eq!(runtime.cli_version.as_deref(), Some("2.1.273"));
    }

    #[test]
    fn mensagem_sintetica_nao_vira_nome_de_modelo() {
        // Caso real: a CLI fabrica uma entrada `assistant` com `model: "<synthetic>"` quando o
        // usuário interrompe. Se ela for a última, a etiqueta mostrava "<SYNTHETIC>" na tela.
        let dir = tempfile::tempdir().expect("tempdir");
        let caminho = claude_transcript_path(dir.path(), "C:/x", "s");
        fs::create_dir_all(caminho.parent().expect("pai")).expect("mkdir");
        fs::write(
            &caminho,
            concat!(
                r#"{"type":"assistant","message":{"model":"claude-opus-5"},"effort":"high","version":"2.1.273"}"#, "
",
                r#"{"type":"assistant","message":{"model":"<synthetic>"},"effort":null}"#, "
",
            ),
        )
        .expect("escrever");

        let runtime = claude_runtime(dir.path(), "C:/x", "s").expect("runtime");
        assert_eq!(runtime.model.as_deref(), Some("claude-opus-5"));
        assert_eq!(runtime.effort.as_deref(), Some("high"), "o esforço vem do turno de verdade");
        assert_eq!(runtime.source, RuntimeSource::Sessao);
    }

    #[test]
    fn effort_do_turno_ganha_do_ajuste_vigente() {
        let dir = tempfile::tempdir().expect("tempdir");
        let caminho = claude_transcript_path(dir.path(), "C:/x", "s");
        fs::create_dir_all(caminho.parent().expect("pai")).expect("mkdir");
        fs::write(
            &caminho,
            r#"{"type":"assistant","message":{"model":"claude-opus-5"},"effort":"high","perTurnEffort":"low"}"#,
        )
        .expect("escrever");

        assert_eq!(claude_runtime(dir.path(), "C:/x", "s").expect("runtime").effort.as_deref(), Some("low"));
    }

    #[test]
    fn sessao_sem_turno_cai_no_modelo_configurado() {
        // O caso real que deixou a etiqueta invisível: a aba abriu, o transcript existe, mas só com
        // metadados — o usuário ainda não mandou nada, então não há turno de assistant.
        let dir = tempfile::tempdir().expect("tempdir");
        fs::write(dir.path().join("settings.json"), r#"{"model":"opus"}"#).expect("settings");
        let caminho = claude_transcript_path(dir.path(), "C:/x", "s");
        fs::create_dir_all(caminho.parent().expect("pai")).expect("mkdir");
        fs::write(&caminho, "{\"type\":\"mode\",\"mode\":\"normal\"}
").expect("transcript");

        let runtime = claude_runtime(dir.path(), "C:/x", "s").expect("runtime");
        assert_eq!(runtime.model.as_deref(), Some("opus"));
        assert_eq!(runtime.source, RuntimeSource::Config);
        assert_eq!(runtime.effort, None, "config não sabe o esforço; inventar seria mentir");
    }

    #[test]
    fn codex_completa_o_esforco_pelo_config_quando_o_rollout_traz_nulo() {
        // Rollout real desta máquina traz `reasoning_effort: null` — o modelo não expõe esforço.
        let dir = tempfile::tempdir().expect("tempdir");
        fs::write(
            dir.path().join("config.toml"),
            "model_reasoning_effort = \"medium\"
plan_mode_reasoning_effort = \"high\"
[tui]
model = \"ignorado\"
",
        )
        .expect("config");
        let sessoes = dir.path().join("sessions").join("2026");
        fs::create_dir_all(&sessoes).expect("mkdir");
        fs::write(
            sessoes.join("rollout-x.jsonl"),
            format!(
                "{}
{}
",
                serde_json::json!({"type":"session_meta","payload":{"cwd":r"C:\dev\p"}}),
                serde_json::json!({"type":"turn_context","payload":{"model":"gpt-6-astra","reasoning_effort":null}}),
            ),
        )
        .expect("rollout");

        let runtime = codex_runtime(dir.path(), r"C:\dev\p").expect("runtime");
        assert_eq!(runtime.model.as_deref(), Some("gpt-6-astra"));
        assert_eq!(runtime.effort.as_deref(), Some("medium"), "veio do config.toml");
    }

    #[test]
    fn plan_mode_effort_nao_vira_o_esforco_da_sessao() {
        let dir = tempfile::tempdir().expect("tempdir");
        fs::write(dir.path().join("config.toml"), "plan_mode_reasoning_effort = \"high\"
").expect("config");
        assert_eq!(codex_config(dir.path()).effort, None);
    }

    #[test]
    fn sessao_sem_transcript_nao_e_erro() {
        let dir = tempfile::tempdir().expect("tempdir");
        assert_eq!(claude_runtime(dir.path(), "C:/x", "nao-existe"), None);
    }

    #[test]
    fn codex_ignora_rollout_de_outra_pasta() {
        let dir = tempfile::tempdir().expect("tempdir");
        let sessoes = dir.path().join("sessions").join("2026").join("09").join("15");
        fs::create_dir_all(&sessoes).expect("mkdir");
        let escrever = |nome: &str, cwd: &str, modelo: &str| {
            fs::write(
                sessoes.join(nome),
                format!(
                    "{}\n{}\n",
                    serde_json::json!({"type":"session_meta","payload":{"cwd":cwd,"cli_version":"1.2.3"}}),
                    serde_json::json!({"type":"turn_context","payload":{"model":modelo,"effort":"medium"}}),
                ),
            )
            .expect("escrever");
        };
        escrever("rollout-a.jsonl", "D:\\dev\\outro", "gpt-errado");
        escrever("rollout-b.jsonl", "D:\\dev\\certo", "gpt-6-astra");

        let runtime = codex_runtime(dir.path(), "D:\\dev\\certo\\").expect("runtime");
        assert_eq!(runtime.model.as_deref(), Some("gpt-6-astra"));
        assert_eq!(runtime.effort.as_deref(), Some("medium"));
    }
}
