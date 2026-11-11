//! Modelos de agentes: arquivos `.md` com cabeçalho, no espírito dos subagentes do Claude Code.
//!
//! Globais em `~/.omni/agents/` (valem em todo projeto) e do projeto em `<projeto>/.omni/agents/`
//! (vão no git do repositório). O nome do agente é o nome do arquivo — por isso ele só aceita
//! letras minúsculas, números e hífen: nunca vira caminho fora da pasta.

use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};

#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq)]
pub struct ModeloDeAgente {
    pub name: String,
    pub description: String,
    /// `claude`, `codex` ou `cursor`.
    pub cli: String,
    /// Vazio = o padrão da CLI.
    #[serde(default)]
    pub modelo: String,
    /// Esforço de raciocínio (`low`…`max` no Claude; os níveis do modelo no Codex). Vazio = padrão.
    #[serde(default)]
    pub esforco: String,
    /// Id da conta. Vazio = qualquer conta da CLI.
    #[serde(default)]
    pub conta: String,
    #[serde(default)]
    pub ferramentas: Vec<String>,
    /// `texto`, `plano`, `veredito` ou `relatorio`: o que o fluxo espera receber deste agente.
    #[serde(default)]
    pub saida: String,
    /// O corpo do arquivo: as instruções (system prompt) do agente.
    #[serde(default)]
    pub instrucoes: String,
}

#[derive(Serialize, Clone, Debug)]
pub struct AgenteSalvo {
    #[serde(flatten)]
    pub modelo: ModeloDeAgente,
    /// `global` ou `projeto`.
    pub escopo: String,
    pub caminho: String,
}

pub const CLIS: [&str; 3] = ["claude", "codex", "cursor"];
pub const SAIDAS: [&str; 4] = ["texto", "plano", "veredito", "relatorio"];

/// Kit que vem com o OMNI: semeado na pasta global na primeira vez que ela é lida.
pub const KIT: [(&str, &str); 7] = [
    ("orquestrador", include_str!("../agentes-kit/orquestrador.md")),
    ("arquiteto", include_str!("../agentes-kit/arquiteto.md")),
    ("dev", include_str!("../agentes-kit/dev.md")),
    ("qa", include_str!("../agentes-kit/qa.md")),
    ("revisor", include_str!("../agentes-kit/revisor.md")),
    ("seguranca", include_str!("../agentes-kit/seguranca.md")),
    ("documentacao", include_str!("../agentes-kit/documentacao.md")),
];

pub fn pasta_global() -> Option<PathBuf> {
    std::env::var_os("USERPROFILE").or_else(|| std::env::var_os("HOME"))
        .map(|home| PathBuf::from(home).join(".omni").join("agents"))
}

pub fn pasta_do_projeto(projeto: &Path) -> PathBuf {
    projeto.join(".omni").join("agents")
}

/// `qa`, `dev-front`, `revisor-2`: o que pode virar nome de arquivo sem surpresa.
pub fn nome_valido(nome: &str) -> bool {
    !nome.is_empty() && nome.len() <= 40 && !nome.starts_with('-') && !nome.ends_with('-')
        && nome.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
}

pub fn validar(m: &ModeloDeAgente) -> Result<(), String> {
    if !nome_valido(&m.name) { return Err("Nome: só letras minúsculas, números e hífen (até 40)".into()); }
    if m.description.trim().is_empty() { return Err("Descreva em uma frase o que o agente faz".into()); }
    if !CLIS.contains(&m.cli.as_str()) { return Err("CLI precisa ser claude, codex ou cursor".into()); }
    if !m.saida.is_empty() && !SAIDAS.contains(&m.saida.as_str()) { return Err("Saída precisa ser texto, plano, veredito ou relatorio".into()); }
    if m.instrucoes.trim().is_empty() { return Err("Escreva as instruções do agente".into()); }
    Ok(())
}

fn sem_aspas(valor: &str) -> String {
    let v = valor.trim();
    if v.len() >= 2 && ((v.starts_with('"') && v.ends_with('"')) || (v.starts_with('\'') && v.ends_with('\''))) {
        serde_json::from_str::<String>(v).unwrap_or_else(|_| v[1..v.len() - 1].to_owned())
    } else {
        v.to_owned()
    }
}

fn lista(valor: &str) -> Vec<String> {
    valor.trim().trim_start_matches('[').trim_end_matches(']').split(',')
        .map(sem_aspas).filter(|s| !s.is_empty()).collect()
}

/// Lê um modelo. Cabeçalho entre `---`; chave desconhecida é ignorada (o arquivo pode ter vindo do
/// Claude Code, com `tools`/`model`, e esses viram `ferramentas`/`modelo`).
pub fn ler(texto: &str) -> Option<ModeloDeAgente> {
    let texto = texto.trim_start_matches('\u{feff}').replace("\r\n", "\n");
    let resto = texto.strip_prefix("---\n")?;
    let (cabecalho, corpo) = resto.split_once("\n---")?;
    let corpo = corpo.strip_prefix('\n').unwrap_or(corpo);
    let mut m = ModeloDeAgente { cli: "claude".into(), saida: "texto".into(), instrucoes: corpo.trim().to_owned(), ..Default::default() };
    for linha in cabecalho.lines() {
        let Some((chave, valor)) = linha.split_once(':') else { continue };
        // Comentário no fim da linha (`cli: claude  # ...`) só fora de aspas.
        let valor = if valor.trim_start().starts_with(['"', '\'']) { valor } else { valor.split(" #").next().unwrap_or(valor) };
        match chave.trim() {
            "name" => m.name = sem_aspas(valor),
            "description" => m.description = sem_aspas(valor),
            "cli" => m.cli = sem_aspas(valor),
            "modelo" | "model" => m.modelo = sem_aspas(valor),
            "esforco" | "effort" => m.esforco = sem_aspas(valor),
            "conta" => m.conta = sem_aspas(valor),
            "ferramentas" | "tools" => m.ferramentas = lista(valor),
            "saida" => m.saida = sem_aspas(valor),
            _ => {}
        }
    }
    (!m.name.is_empty()).then_some(m)
}

/// Texto de cabeçalho seguro: uma linha só, entre aspas quando precisa.
fn valor(texto: &str) -> String {
    let linha = texto.replace(['\n', '\r'], " ");
    if linha.contains([':', '#', '"', '\'', '[', ']']) || linha.starts_with(' ') || linha.ends_with(' ') {
        serde_json::to_string(&linha).unwrap_or_default()
    } else {
        linha
    }
}

pub fn escrever(m: &ModeloDeAgente) -> String {
    let ferramentas = m.ferramentas.iter().map(|f| valor(f)).collect::<Vec<_>>().join(", ");
    format!("---\nname: {}\ndescription: {}\ncli: {}\nmodelo: {}\nesforco: {}\nconta: {}\nferramentas: [{}]\nsaida: {}\n---\n{}\n",
        valor(&m.name), valor(&m.description), valor(&m.cli), valor(&m.modelo), valor(&m.esforco), valor(&m.conta), ferramentas,
        valor(if m.saida.is_empty() { "texto" } else { &m.saida }), m.instrucoes.trim())
}

/// Formato nativo dos subagentes do Claude Code (`.claude/agents/<nome>.md`).
pub fn para_claude_code(m: &ModeloDeAgente) -> String {
    let mut cabecalho = format!("---\nname: {}\ndescription: {}\n", valor(&m.name), valor(&m.description));
    if !m.ferramentas.is_empty() { cabecalho.push_str(&format!("tools: {}\n", m.ferramentas.join(", "))); }
    if !m.modelo.is_empty() { cabecalho.push_str(&format!("model: {}\n", valor(&m.modelo))); }
    format!("{cabecalho}---\n{}\n", m.instrucoes.trim())
}

fn ler_pasta(pasta: &Path, escopo: &str) -> Vec<AgenteSalvo> {
    let Ok(entradas) = fs::read_dir(pasta) else { return Vec::new() };
    let mut lista: Vec<AgenteSalvo> = entradas.flatten()
        .map(|e| e.path())
        .filter(|p| p.extension().is_some_and(|e| e == "md"))
        .filter_map(|p| {
            let modelo = ler(&fs::read_to_string(&p).ok()?)?;
            Some(AgenteSalvo { modelo, escopo: escopo.to_owned(), caminho: p.to_string_lossy().into_owned() })
        })
        .collect();
    lista.sort_by(|a, b| a.modelo.name.cmp(&b.modelo.name));
    lista
}

/// Grava o kit na pasta global se ela ainda não existe. Pasta existente (mesmo vazia, porque você
/// apagou tudo) não é mexida.
pub fn semear_kit(pasta: &Path) -> std::io::Result<()> {
    if pasta.exists() { return Ok(()); }
    restaurar_kit(pasta)
}

/// Grava (ou regrava) os modelos do kit. Os que você criou com outro nome ficam como estão.
pub fn restaurar_kit(pasta: &Path) -> std::io::Result<()> {
    fs::create_dir_all(pasta)?;
    for (nome, texto) in KIT { fs::write(pasta.join(format!("{nome}.md")), texto)?; }
    Ok(())
}

/// Globais e, com projeto, os do projeto. Mesmo nome nos dois: aparecem os dois, cada um com o seu escopo.
pub fn listar(pasta_global: Option<&Path>, projeto: Option<&Path>) -> Vec<AgenteSalvo> {
    let mut lista = Vec::new();
    if let Some(pasta) = pasta_global {
        let _ = semear_kit(pasta);
        lista.extend(ler_pasta(pasta, "global"));
    }
    if let Some(projeto) = projeto { lista.extend(ler_pasta(&pasta_do_projeto(projeto), "projeto")); }
    lista
}

pub fn salvar(pasta: &Path, m: &ModeloDeAgente) -> Result<PathBuf, String> {
    validar(m)?;
    fs::create_dir_all(pasta).map_err(|e| e.to_string())?;
    let caminho = pasta.join(format!("{}.md", m.name));
    let temporario = pasta.join(format!(".{}.md.tmp", m.name));
    fs::write(&temporario, escrever(m)).map_err(|e| e.to_string())?;
    fs::rename(&temporario, &caminho).map_err(|e| e.to_string())?;
    Ok(caminho)
}

pub fn apagar(pasta: &Path, nome: &str) -> Result<(), String> {
    if !nome_valido(nome) { return Err("Nome inválido".into()); }
    let caminho = pasta.join(format!("{nome}.md"));
    if caminho.exists() { fs::remove_file(caminho).map_err(|e| e.to_string())?; }
    Ok(())
}

/// Copia para `<projeto>/.claude/agents/<nome>.md`, onde o Claude Code o usa como subagente.
pub fn instalar_no_claude_code(projeto: &Path, m: &ModeloDeAgente) -> Result<PathBuf, String> {
    validar(m)?;
    let pasta = projeto.join(".claude").join("agents");
    fs::create_dir_all(&pasta).map_err(|e| e.to_string())?;
    let caminho = pasta.join(format!("{}.md", m.name));
    fs::write(&caminho, para_claude_code(m)).map_err(|e| e.to_string())?;
    Ok(caminho)
}

/// Prompt de sistema de quem escreve modelos de agentes: as práticas de mercado (subagentes do Claude
/// Code, CrewAI, "Building effective agents") viradas em regras e num formato fixo. Fica num arquivo
/// à parte para ser fácil de ler e ajustar.
pub const SISTEMA_CRIAR_AGENTE: &str = include_str!("../prompts/criar-agente.md");

/// Modelo de uma CLI que dá para escolher no agente, com os esforços que ele aceita.
#[derive(Serialize, Clone, Debug)]
pub struct ModeloDaCli { pub id: String, pub label: String, pub esforcos: Vec<String> }

const MODELOS_CLAUDE: [(&str, &str); 4] = [("fable", "Fable"), ("opus", "Opus"), ("sonnet", "Sonnet"), ("haiku", "Haiku")];
const ESFORCOS_CLAUDE: [&str; 5] = ["low", "medium", "high", "xhigh", "max"];

/// Modelos por CLI: os do Claude são os apelidos e cada versão que o Claude Code instalado conhece
/// (`modelos_claude`); os do Codex vêm do `models_cache.json` da primeira conta
/// que tiver um (é a lista que a própria CLI baixou).
pub fn modelos_disponiveis(perfis: &[crate::Profile]) -> std::collections::BTreeMap<String, Vec<ModeloDaCli>> {
    let mut mapa = std::collections::BTreeMap::new();
    let esforcos = || ESFORCOS_CLAUDE.iter().map(|e| (*e).into()).collect();
    mapa.insert("claude".to_owned(), MODELOS_CLAUDE.iter().map(|(id, label)| ModeloDaCli { id: (*id).into(), label: (*label).into(), esforcos: esforcos() })
        .chain(crate::modelos_claude::disponiveis().into_iter().map(|m| ModeloDaCli { id: m.id, label: m.nome, esforcos: esforcos() }))
        .collect());
    let codex = perfis.iter().filter(|p| p.provider == "codex").find_map(|p| {
        let cache: serde_json::Value = serde_json::from_slice(&fs::read(Path::new(&p.config_dir).join("models_cache.json")).ok()?).ok()?;
        let lista: Vec<ModeloDaCli> = cache["models"].as_array()?.iter()
            .filter(|m| m["visibility"].as_str() != Some("hide"))
            .filter_map(|m| Some(ModeloDaCli {
                id: m["slug"].as_str()?.into(),
                label: m["display_name"].as_str().or(m["slug"].as_str())?.into(),
                esforcos: m["supported_reasoning_levels"].as_array().into_iter().flatten()
                    .filter_map(|n| n["effort"].as_str().or_else(|| n.as_str()).map(str::to_owned)).collect(),
            })).collect();
        (!lista.is_empty()).then_some(lista)
    });
    mapa.insert("codex".to_owned(), codex.unwrap_or_default());
    mapa.insert("cursor".to_owned(), Vec::new());
    mapa
}

/// Os modelos de uma CLI em texto, para os prompts de criação.
pub fn modelos_em_texto(modelos: &std::collections::BTreeMap<String, Vec<ModeloDaCli>>, cli: &str) -> String {
    let lista = modelos.get(cli).map(Vec::as_slice).unwrap_or_default();
    if lista.is_empty() { return "(sem lista: deixe `modelo` e `esforco` vazios)".into(); }
    lista.iter().map(|m| format!("- {} — esforços: {}", m.id, if m.esforcos.is_empty() { "(padrão)".into() } else { m.esforcos.join(", ") }))
        .collect::<Vec<_>>().join("\n")
}

/// A mensagem do pedido: a descrição de quem pediu, a CLI, os modelos disponíveis e os nomes que já
/// existem (para não criar um agente repetido).
pub fn pedido_de_criacao(descricao: &str, cli: &str, modelos: &str, existentes: &[String]) -> String {
    let existentes = if existentes.is_empty() { "(nenhum)".to_owned() } else { existentes.join(", ") };
    format!("## Pedido\n{descricao}\n\n## CLI do agente\n{cli}\n\n## Modelos e esforços disponíveis nessa CLI\n{modelos}\n\n## Nomes que já existem (escolha outro)\n{existentes}\n\nEscreva o modelo de agente agora, no formato pedido.")
}

/// Tira o modelo da resposta da IA: aceita o arquivo puro ou dentro de um bloco ```.
pub fn modelo_da_resposta(resposta: &str) -> Option<ModeloDeAgente> {
    let texto = resposta.trim();
    let inicio = texto.find("---")?;
    let mut trecho = &texto[inicio..];
    if let Some(fim) = trecho.rfind("\n```") { trecho = &trecho[..fim]; }
    ler(trecho)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn kit_inteiro_le_e_valida() {
        for (nome, texto) in KIT {
            let m = ler(texto).unwrap_or_else(|| panic!("{nome} não leu"));
            assert_eq!(m.name, nome);
            validar(&m).unwrap_or_else(|e| panic!("{nome}: {e}"));
        }
    }

    #[test]
    fn ida_e_volta_preserva_tudo_mesmo_com_dois_pontos_e_aspas() {
        let m = ModeloDeAgente { name: "front-a11y".into(), description: "Revisa acessibilidade: \"contraste\" e foco".into(),
            cli: "claude".into(), modelo: "opus".into(), esforco: "high".into(), conta: "".into(), ferramentas: vec!["Read".into(), "Grep".into()],
            saida: "veredito".into(), instrucoes: "Você é...\n\n## Objetivo\nX".into() };
        assert_eq!(ler(&escrever(&m)).unwrap(), m);
    }

    #[test]
    fn le_arquivo_do_claude_code_e_nome_nao_vira_caminho() {
        let m = ler("---\nname: revisor\ndescription: Revisa\ntools: Read, Grep\nmodel: sonnet\n---\nCorpo").unwrap();
        assert_eq!((m.ferramentas.len(), m.modelo.as_str(), m.cli.as_str()), (2, "sonnet", "claude"));
        for ruim in ["../x", "a/b", "Qa", "", "-a", "a b"] { assert!(!nome_valido(ruim), "{ruim}"); }
    }

    #[test]
    fn semeia_uma_vez_salva_lista_e_apaga() {
        let dir = tempfile::tempdir().unwrap();
        let global = dir.path().join("agents");
        let projeto = dir.path().join("proj");
        assert_eq!(listar(Some(&global), None).len(), 7);
        apagar(&global, "qa").unwrap();
        // Pasta já existe: apagar um do kit não faz ele voltar.
        assert_eq!(listar(Some(&global), None).len(), 6);
        let novo = ler(KIT[3].1).unwrap();
        salvar(&pasta_do_projeto(&projeto), &novo).unwrap();
        let lista = listar(Some(&global), Some(&projeto));
        assert!(lista.iter().any(|a| a.escopo == "projeto" && a.modelo.name == "qa"));
        let instalado = instalar_no_claude_code(&projeto, &novo).unwrap();
        assert!(fs::read_to_string(instalado).unwrap().contains("tools: Read, Bash, Grep, Glob"));
    }

    #[test]
    fn resposta_da_ia_com_ou_sem_bloco_de_codigo() {
        let arquivo = "---\nname: x\ndescription: d\ncli: claude\nferramentas: [Read]\nsaida: texto\n---\nVocê é X.";
        assert_eq!(modelo_da_resposta(&format!("```markdown\n{arquivo}\n```")).unwrap().name, "x");
        assert_eq!(modelo_da_resposta(arquivo).unwrap().instrucoes, "Você é X.");
    }
}
