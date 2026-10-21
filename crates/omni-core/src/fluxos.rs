//! Fluxos de agentes: o grafo (nós + conexões) que o editor visual monta e o engine executa.
//!
//! Salvos em JSON: globais em `~/.omni/fluxos/`, do projeto em `<projeto>/.omni/fluxos/`. Aqui mora
//! só o que é regra — formato, validação, prompt de cada nó, leitura do veredito e escolha do
//! próximo passo. Quem roda processo, worktree e PR é o engine.

use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum TipoDeNo {
    /// A tarefa digitada ao iniciar. Todo fluxo tem exatamente uma.
    Entrada,
    /// Um modelo de agente trabalhando sem tela.
    Agente,
    /// Desvio pelo veredito do nó anterior: saídas `sim` / `nao` / `esgotado` (passou do limite de voltas).
    Condicao,
    /// Espera você aprovar (PC, web ou celular): saídas `sim` / `nao`.
    Aprovacao,
    /// Time conversando: os participantes falam em rodadas até o consenso ou o limite.
    Sala,
    /// Commit, push e `gh pr create` no branch da execução.
    Pr,
    /// Roda `config.comando` na pasta da execução: saiu com 0 → `sim`; falhou → `nao`; falhou de novo
    /// depois de `max_voltas` → `esgotado`. É o que liga um fluxo a testes, builds e scripts.
    Comando,
    Fim,
}

/// Sem `config` (ou `null`) vira `{}`: a tela lê `config.prompt` etc. direto.
fn objeto_vazio() -> Value { Value::Object(Default::default()) }
fn objeto_ou_vazio<'de, D: serde::Deserializer<'de>>(d: D) -> Result<Value, D::Error> {
    let v = Value::deserialize(d)?;
    Ok(if v.is_null() { objeto_vazio() } else { v })
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct No {
    pub id: String,
    pub tipo: TipoDeNo,
    #[serde(default)]
    pub titulo: String,
    /// Nome do modelo de agente (tipo `agente`).
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub agente: String,
    /// Configuração do nó: `prompt`, `max_voltas`, `participantes`, `rodadas`, `objetivo`, `titulo_pr`…
    #[serde(default = "objeto_vazio", deserialize_with = "objeto_ou_vazio")]
    pub config: Value,
    /// Posição no canvas.
    #[serde(default)]
    pub x: f64,
    #[serde(default)]
    pub y: f64,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct Conexao {
    pub de: String,
    pub para: String,
    /// Qual saída do nó de origem (`sim`, `nao`, `esgotado`). Vazio = a saída normal.
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub saida: String,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct Fluxo {
    pub id: String,
    pub nome: String,
    #[serde(default)]
    pub descricao: String,
    pub nos: Vec<No>,
    pub conexoes: Vec<Conexao>,
    /// Roda direto na pasta do projeto, sem worktree. Para fluxos que precisam do que ainda não foi
    /// commitado (uma release, por exemplo) — e que por isso mexem nos seus arquivos de verdade.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub na_pasta_do_projeto: bool,
}

#[derive(Serialize, Clone, Debug)]
pub struct FluxoSalvo {
    #[serde(flatten)]
    pub fluxo: Fluxo,
    pub escopo: String,
    pub caminho: String,
}

pub const FLUXOS_PRONTOS: [(&str, &str); 2] = [
    ("tarefa-pr", include_str!("../fluxos-prontos/tarefa-pr.json")),
    ("time-de-agentes", include_str!("../fluxos-prontos/time-de-agentes.json")),
];

/// Últimos `max` bytes de um texto, sem cortar caractere no meio — a saída de um comando pode ter
/// megas de log, e só o fim (o erro) interessa para a tela e para o agente que vai corrigir.
pub fn cauda(texto: &str, max: usize) -> &str {
    if texto.len() <= max { return texto; }
    let mut i = texto.len() - max;
    while !texto.is_char_boundary(i) { i += 1; }
    &texto[i..]
}

pub fn pasta_global() -> Option<PathBuf> {
    std::env::var_os("USERPROFILE").or_else(|| std::env::var_os("HOME"))
        .map(|home| PathBuf::from(home).join(".omni").join("fluxos"))
}

pub fn pasta_do_projeto(projeto: &Path) -> PathBuf {
    projeto.join(".omni").join("fluxos")
}

/// Saídas que cada tipo de nó oferece no canvas.
pub fn saidas(tipo: &TipoDeNo) -> &'static [&'static str] {
    match tipo {
        TipoDeNo::Condicao | TipoDeNo::Comando => &["sim", "nao", "esgotado"],
        TipoDeNo::Aprovacao => &["sim", "nao"],
        TipoDeNo::Fim => &[],
        _ => &[""],
    }
}

pub fn validar(f: &Fluxo) -> Result<(), String> {
    if !crate::agentes::nome_valido(&f.id) { return Err("Id do fluxo: só letras minúsculas, números e hífen".into()); }
    if f.nome.trim().is_empty() { return Err("Dê um nome ao fluxo".into()); }
    let ids: HashSet<&str> = f.nos.iter().map(|n| n.id.as_str()).collect();
    if ids.len() != f.nos.len() { return Err("Dois nós com o mesmo id".into()); }
    if f.nos.iter().filter(|n| n.tipo == TipoDeNo::Entrada).count() != 1 { return Err("O fluxo precisa de exatamente uma Entrada".into()); }
    for n in &f.nos {
        if n.tipo == TipoDeNo::Agente && n.agente.trim().is_empty() { return Err(format!("O nó “{}” precisa de um modelo de agente", rotulo(n))); }
        if n.tipo == TipoDeNo::Sala && participantes(n).len() < 2 { return Err(format!("A sala “{}” precisa de pelo menos dois participantes", rotulo(n))); }
        if n.tipo == TipoDeNo::Comando && n.config["comando"].as_str().is_none_or(|c| c.trim().is_empty()) { return Err(format!("O comando “{}” está vazio", rotulo(n))); }
        if n.tipo == TipoDeNo::Pr && f.na_pasta_do_projeto { return Err("Pull request precisa de worktree: desligue “rodar na pasta do projeto” ou troque o PR por um comando".into()); }
    }
    for c in &f.conexoes {
        let (Some(de), true) = (f.nos.iter().find(|n| n.id == c.de), ids.contains(c.para.as_str())) else { return Err("Conexão aponta para um nó que não existe".into()) };
        if !saidas(&de.tipo).contains(&c.saida.as_str()) { return Err(format!("“{}” não tem a saída “{}”", rotulo(de), c.saida)); }
    }
    Ok(())
}

pub fn rotulo(n: &No) -> String {
    if !n.titulo.trim().is_empty() { n.titulo.clone() } else if !n.agente.is_empty() { n.agente.clone() } else { n.id.clone() }
}

pub fn participantes(n: &No) -> Vec<String> {
    n.config["participantes"].as_array().into_iter().flatten().filter_map(|v| v.as_str().map(str::to_owned)).collect()
}

/// Próximos nós a partir de `no` pela saída `saida`.
pub fn proximos<'a>(f: &'a Fluxo, no: &str, saida: &str) -> Vec<&'a No> {
    f.conexoes.iter().filter(|c| c.de == no && c.saida == saida)
        .filter_map(|c| f.nos.iter().find(|n| n.id == c.para)).collect()
}

pub fn entrada(f: &Fluxo) -> Option<&No> {
    f.nos.iter().find(|n| n.tipo == TipoDeNo::Entrada)
}

/// O último bloco JSON da resposta (os modelos do kit terminam com um).
pub fn json_da_resposta(texto: &str) -> Option<Value> {
    let mut fim = texto.len();
    while let Some(inicio) = texto[..fim].rfind("```") {
        let antes = &texto[..inicio];
        if let Some(abre) = antes.rfind("```") {
            let bloco = antes[abre + 3..].trim_start_matches(|c: char| c.is_alphanumeric()).trim();
            if let Ok(v) = serde_json::from_str::<Value>(bloco) { return Some(v); }
            fim = abre;
        } else {
            break;
        }
    }
    // Sem bloco: o último objeto `{...}` que fecha no fim do texto.
    let t = texto.trim_end();
    let inicio = t.rfind("\n{").map(|i| i + 1).or_else(|| t.starts_with('{').then_some(0))?;
    serde_json::from_str(&t[inicio..]).ok()
}

/// `aprovado` / `reprovado` do bloco JSON; sem bloco, procura a palavra no fim do texto.
pub fn veredito(texto: &str) -> Option<bool> {
    if let Some(v) = json_da_resposta(texto).and_then(|j| j["veredito"].as_str().map(str::to_lowercase)) {
        return Some(v.starts_with("aprov"));
    }
    let fim = texto.to_lowercase();
    let fim = &fim[fim.len().saturating_sub(400)..];
    match (fim.rfind("reprovado"), fim.rfind("aprovado")) {
        (Some(r), Some(a)) => Some(a > r + 2),
        (None, Some(_)) => Some(true),
        (Some(_), None) => Some(false),
        _ => None,
    }
}

/// O que cada nó já produziu, para montar o prompt do próximo.
#[derive(Default, Debug, Clone)]
pub struct Contexto {
    pub entrada: String,
    pub saidas: HashMap<String, String>,
    /// Saída do nó que levou até aqui.
    pub anterior: String,
}

/// O prompt de um nó de agente: o modelo de prompt do nó (`config.prompt`) com `{{entrada}}`,
/// `{{anterior}}` e `{{no:<id>}}` trocados. Sem modelo, manda a tarefa e o que veio antes.
pub fn montar_prompt(no: &No, ctx: &Contexto) -> String {
    let modelo = no.config["prompt"].as_str().filter(|p| !p.trim().is_empty()).map(str::to_owned).unwrap_or_else(|| {
        if ctx.anterior.trim().is_empty() || ctx.anterior == ctx.entrada { "## Tarefa\n{{entrada}}".into() }
        else { "## Tarefa\n{{entrada}}\n\n## O que veio da etapa anterior\n{{anterior}}".into() }
    });
    let mut texto = modelo.replace("{{entrada}}", &ctx.entrada).replace("{{anterior}}", &ctx.anterior);
    for (id, saida) in &ctx.saidas { texto = texto.replace(&format!("{{{{no:{id}}}}}"), saida); }
    texto
}

/// A fala de um participante da sala: o objetivo, a conversa até aqui e a vez dele.
pub fn prompt_da_sala(objetivo: &str, conversa: &[(String, String)], quem: &str, rodada: u32, rodadas: u32) -> String {
    let historico = if conversa.is_empty() { "(ninguém falou ainda — você abre a conversa)".to_owned() }
        else { conversa.iter().map(|(q, t)| format!("### {q}\n{t}")).collect::<Vec<_>>().join("\n\n") };
    format!("Você está numa reunião de um time de agentes, como **{quem}**. Rodada {rodada} de {rodadas}.\n\n## Objetivo da reunião\n{objetivo}\n\n## Conversa até aqui\n{historico}\n\n## Sua vez\nContribua do seu ponto de vista em poucos parágrafos: concorde, discorde com motivo ou proponha algo melhor. Não repita o que já foi dito. Se você concorda com a proposta atual e não tem nada a acrescentar, termine com a linha `CONSENSO`.")
}

pub fn concordou(fala: &str) -> bool {
    fala.trim_end().lines().last().is_some_and(|l| l.trim().trim_matches('`').eq_ignore_ascii_case("consenso"))
}

pub fn prompt_da_ata(objetivo: &str, conversa: &[(String, String)]) -> String {
    let historico = conversa.iter().map(|(q, t)| format!("### {q}\n{t}")).collect::<Vec<_>>().join("\n\n");
    format!("Escreva a ata desta reunião de agentes: a decisão final, os pontos de consenso, as divergências que ficaram e os próximos passos concretos. Seja direto.\n\n## Objetivo\n{objetivo}\n\n## Conversa\n{historico}")
}

/// Prompt de sistema de quem monta fluxos inteiros a partir de uma frase (tipos de nó, marcadores,
/// regras de um bom fluxo e o formato JSON).
pub const SISTEMA_CRIAR_FLUXO: &str = include_str!("../prompts/criar-fluxo.md");

/// O que a IA devolve ao montar um fluxo: o grafo e, se faltou algum papel, os agentes novos.
#[derive(Deserialize, Serialize, Debug, Clone)]
pub struct FluxoGerado {
    pub fluxo: Fluxo,
    #[serde(default)]
    pub agentes_novos: Vec<crate::agentes::ModeloDeAgente>,
}

/// A mensagem do pedido de fluxo: a descrição e os modelos de agente que já existem (com o que cada
/// um entrega), para a IA reaproveitar em vez de inventar.
pub fn pedido_de_fluxo(descricao: &str, agentes: &[crate::agentes::ModeloDeAgente], modelos: &str) -> String {
    let lista = agentes.iter().map(|a| format!("- `{}` ({}, saída: {}) — {}", a.name, a.cli, if a.saida.is_empty() { "texto" } else { &a.saida }, a.description))
        .collect::<Vec<_>>().join("\n");
    format!("## Pedido\n{descricao}\n\n## Modelos de agente que já existem (prefira estes)\n{}\n\n## Modelos e esforços do Claude (para agentes novos)\n{modelos}\n\nMonte o fluxo agora, no formato JSON pedido.",
        if lista.is_empty() { "(nenhum)".into() } else { lista })
}

/// Lê e confere o fluxo gerado: JSON válido, agentes novos válidos e sem colidir com os existentes, e
/// todo nó de agente apontando para um modelo que existe (ou que vai ser criado junto).
pub fn fluxo_da_resposta(texto: &str, existentes: &[String]) -> Result<FluxoGerado, String> {
    let valor = json_da_resposta(texto)
        .or_else(|| { let t = texto.trim(); let (i, f) = (t.find('{')?, t.rfind('}')?); serde_json::from_str(&t[i..=f]).ok() })
        .ok_or("A resposta não trouxe um JSON")?;
    let mut gerado: FluxoGerado = serde_json::from_value(valor).map_err(|e| format!("JSON fora do formato de fluxo: {e}"))?;
    let mut nomes: HashSet<String> = existentes.iter().cloned().collect();
    for a in &mut gerado.agentes_novos {
        if a.saida.is_empty() { a.saida = "texto".into(); }
        crate::agentes::validar(a).map_err(|e| format!("Agente novo “{}”: {e}", a.name))?;
        if !nomes.insert(a.name.clone()) { return Err(format!("O agente novo “{}” já existe", a.name)); }
    }
    for n in gerado.fluxo.nos.iter().filter(|n| n.tipo == TipoDeNo::Agente) {
        if !nomes.contains(&n.agente) { return Err(format!("O nó “{}” usa o agente “{}”, que não existe", rotulo(n), n.agente)); }
    }
    for n in gerado.fluxo.nos.iter().filter(|n| n.tipo == TipoDeNo::Sala) {
        if let Some(falta) = participantes(n).into_iter().find(|p| !nomes.contains(p)) { return Err(format!("A sala “{}” chama “{falta}”, que não existe", rotulo(n))); }
    }
    validar(&gerado.fluxo)?;
    Ok(gerado)
}

fn ler_pasta(pasta: &Path, escopo: &str) -> Vec<FluxoSalvo> {
    let Ok(entradas) = fs::read_dir(pasta) else { return Vec::new() };
    let mut lista: Vec<FluxoSalvo> = entradas.flatten().map(|e| e.path())
        .filter(|p| p.extension().is_some_and(|e| e == "json"))
        .filter_map(|p| Some(FluxoSalvo { fluxo: serde_json::from_slice(&fs::read(&p).ok()?).ok()?, escopo: escopo.into(), caminho: p.to_string_lossy().into_owned() }))
        .collect();
    lista.sort_by(|a, b| a.fluxo.nome.cmp(&b.fluxo.nome));
    lista
}

/// Globais (com os prontos semeados na primeira vez) e os do projeto.
pub fn listar(pasta_global: Option<&Path>, projeto: Option<&Path>) -> Vec<FluxoSalvo> {
    let mut lista = Vec::new();
    if let Some(pasta) = pasta_global {
        if !pasta.exists() && fs::create_dir_all(pasta).is_ok() {
            for (id, texto) in FLUXOS_PRONTOS { let _ = fs::write(pasta.join(format!("{id}.json")), texto); }
        }
        lista.extend(ler_pasta(pasta, "global"));
    }
    if let Some(projeto) = projeto { lista.extend(ler_pasta(&pasta_do_projeto(projeto), "projeto")); }
    lista
}

pub fn salvar(pasta: &Path, f: &Fluxo) -> Result<PathBuf, String> {
    validar(f)?;
    fs::create_dir_all(pasta).map_err(|e| e.to_string())?;
    let caminho = pasta.join(format!("{}.json", f.id));
    let temporario = pasta.join(format!(".{}.json.tmp", f.id));
    fs::write(&temporario, serde_json::to_vec_pretty(f).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
    fs::rename(&temporario, &caminho).map_err(|e| e.to_string())?;
    Ok(caminho)
}

pub fn apagar(pasta: &Path, id: &str) -> Result<(), String> {
    if !crate::agentes::nome_valido(id) { return Err("Id inválido".into()); }
    let caminho = pasta.join(format!("{id}.json"));
    if caminho.exists() { fs::remove_file(caminho).map_err(|e| e.to_string())?; }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fluxos_prontos_validam() {
        for (id, texto) in FLUXOS_PRONTOS {
            let f: Fluxo = serde_json::from_str(texto).unwrap_or_else(|e| panic!("{id}: {e}"));
            assert_eq!(f.id, id);
            validar(&f).unwrap_or_else(|e| panic!("{id}: {e}"));
            assert!(f.nos.iter().all(|n| n.config.is_object()), "{id}: config tem que vir objeto");
        }
        let n: No = serde_json::from_str(r#"{"id":"a","tipo":"fim","config":null}"#).unwrap();
        assert!(n.config.is_object());
    }

    #[test]
    fn comando_valida_e_nao_combina_com_pr_na_pasta_do_projeto() {
        let mut f: Fluxo = serde_json::from_value(serde_json::json!({"id": "r", "nome": "R", "nos": [
            {"id": "e", "tipo": "entrada"}, {"id": "c", "tipo": "comando", "config": {"comando": "npm test"}}, {"id": "f", "tipo": "fim"}],
            "conexoes": [{"de": "e", "para": "c"}, {"de": "c", "para": "f", "saida": "sim"}, {"de": "c", "para": "f", "saida": "esgotado"}]})).unwrap();
        assert!(!f.na_pasta_do_projeto, "fluxo antigo, sem o campo, continua com worktree");
        validar(&f).unwrap();
        f.nos[1].config = serde_json::json!({"comando": "  "});
        assert!(validar(&f).unwrap_err().contains("vazio"));
        f.nos[1].tipo = TipoDeNo::Pr;
        f.na_pasta_do_projeto = true;
        f.conexoes.retain(|c| c.saida.is_empty());
        assert!(validar(&f).unwrap_err().contains("worktree"));
        assert_eq!(cauda("aé", 1), "", "não corta no meio do é");
        assert_eq!(cauda("abcdef", 3), "def");
    }

    /// O fluxo de release do próprio OMNI (`.omni/fluxos/release.json`) tem que continuar válido.
    #[test]
    fn fluxo_de_release_do_omni_valida() {
        let f: Fluxo = serde_json::from_str(include_str!("../../../.omni/fluxos/release.json")).unwrap();
        validar(&f).unwrap();
        assert!(f.na_pasta_do_projeto, "a release leva o que não foi commitado");
        assert!(f.nos.iter().filter(|n| n.tipo == TipoDeNo::Aprovacao).count() >= 2, "publicar e liberar pedem aprovação");
    }

    #[test]
    fn veredito_pelo_json_ou_pela_palavra() {
        assert_eq!(veredito("Rodei tudo.\n```json\n{\"veredito\": \"reprovado\", \"problemas\": []}\n```"), Some(false));
        assert_eq!(veredito("ok\n```json\n{\"veredito\":\"aprovado\"}\n```\nfim"), Some(true));
        assert_eq!(veredito("Tudo certo, aprovado."), Some(true));
        assert_eq!(veredito("Falhou: reprovado."), Some(false));
        assert_eq!(veredito("sem opinião"), None);
    }

    #[test]
    fn prompt_troca_os_marcadores_e_sala_reconhece_consenso() {
        let no = No { id: "d".into(), tipo: TipoDeNo::Agente, titulo: "".into(), agente: "dev".into(),
            config: serde_json::json!({"prompt": "Faça {{entrada}}. QA disse: {{anterior}}. Plano: {{no:p}}"}), x: 0.0, y: 0.0 };
        let ctx = Contexto { entrada: "login".into(), anterior: "falta teste".into(), saidas: [("p".to_owned(), "3 passos".to_owned())].into() };
        assert_eq!(montar_prompt(&no, &ctx), "Faça login. QA disse: falta teste. Plano: 3 passos");
        assert!(concordou("Concordo com a proposta.\n\n`CONSENSO`"));
        assert!(!concordou("Ainda não há consenso sobre isso."));
    }

    #[test]
    fn fluxo_gerado_pela_ia_e_conferido() {
        let existentes = vec!["dev".to_owned(), "qa".to_owned()];
        let resposta = r#"Aqui está:
```json
{"fluxo": {"id": "corrigir-bug", "nome": "Corrigir bug", "descricao": "d",
  "nos": [{"id": "e", "tipo": "entrada", "x": 0, "y": 0}, {"id": "a", "tipo": "agente", "agente": "a11y", "x": 280, "y": 0},
          {"id": "f", "tipo": "fim", "x": 560, "y": 0}],
  "conexoes": [{"de": "e", "para": "a"}, {"de": "a", "para": "f"}]},
 "agentes_novos": [{"name": "a11y", "description": "Revisa acessibilidade", "cli": "claude", "modelo": "opus", "esforco": "high",
   "conta": "", "ferramentas": ["Read"], "saida": "veredito", "instrucoes": "Você é..."}]}
```"#;
        let g = fluxo_da_resposta(resposta, &existentes).unwrap();
        assert_eq!((g.fluxo.nos.len(), g.agentes_novos[0].name.as_str()), (3, "a11y"));
        // Agente que não existe nem vem junto: recusado com o motivo.
        let sem = resposta.replace(r#""agentes_novos": [{"#, r#""agentes_x": [{"#);
        assert!(fluxo_da_resposta(&sem, &existentes).unwrap_err().contains("a11y"));
        // Agente novo com nome repetido: recusado.
        assert!(fluxo_da_resposta(&resposta.replace("\"name\": \"a11y\"", "\"name\": \"qa\"").replace("\"agente\": \"a11y\"", "\"agente\": \"qa\""), &existentes).is_err());
    }

    #[test]
    fn validacao_pega_conexao_errada_e_semeia_os_prontos() {
        let mut f: Fluxo = serde_json::from_str(FLUXOS_PRONTOS[0].1).unwrap();
        f.conexoes.push(Conexao { de: f.nos[0].id.clone(), para: "nao-existe".into(), saida: String::new() });
        assert!(validar(&f).is_err());
        let dir = tempfile::tempdir().unwrap();
        let pasta = dir.path().join("fluxos");
        assert_eq!(listar(Some(&pasta), None).len(), 2);
    }
}
