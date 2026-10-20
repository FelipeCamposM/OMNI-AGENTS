//! Comandos `/` de cada agente — o menu que abre ao digitar `/` no chat.
//!
//! Só leitura, direto dos arquivos que cada CLI lê:
//!
//! | IA     | Embutidos        | Seus / do projeto                                   | Skills e plugins                                   |
//! |--------|------------------|-----------------------------------------------------|----------------------------------------------------|
//! | Claude | lista fixa       | `<conta>/commands/**.md`, `.claude/commands/**.md`  | `skills/*/SKILL.md` (conta e projeto), plugins ligados |
//! | Codex  | lista fixa       | `<conta>/prompts/*.md` → `/prompts:nome`            | —                                                  |
//!
//! Sai só nome e descrição — nunca caminho nem conteúdo do arquivo.

use serde::Serialize;
use serde_json::Value;
use std::collections::HashSet;
use std::path::Path;

#[derive(Debug, Serialize, PartialEq)]
pub struct Comando {
    /// Sem a barra: `compact`, `frontend:revisar`, `caveman:caveman-commit`.
    pub nome: String,
    pub descricao: String,
    /// `cli` (embutido), `seu`, `projeto`, `skill` ou `plugin`.
    pub origem: &'static str,
}

const CLAUDE: &[(&str, &str)] = &[
    ("clear", "Começa uma conversa nova, limpando o contexto"),
    ("compact", "Resume a conversa para liberar contexto"),
    ("context", "Mostra quanto do contexto está em uso"),
    ("model", "Troca o modelo"),
    ("effort", "Troca o esforço de raciocínio"),
    ("usage", "Uso do plano (5 horas e semana)"),
    ("cost", "Custo e duração da sessão"),
    ("init", "Cria o CLAUDE.md do projeto"),
    ("memory", "Edita os arquivos de memória (CLAUDE.md)"),
    ("review", "Revisa um pull request"),
    ("security-review", "Revisão de segurança das mudanças pendentes"),
    ("agents", "Gerencia os subagentes"),
    ("mcp", "Gerencia os servidores MCP"),
    ("hooks", "Gerencia os hooks"),
    ("permissions", "Regras de permissão das ferramentas"),
    ("add-dir", "Adiciona outra pasta de trabalho"),
    ("rewind", "Volta a conversa e o código para um ponto anterior"),
    ("export", "Exporta a conversa"),
    ("status", "Versão, conta e conexões"),
    ("doctor", "Diagnóstico da instalação"),
    ("help", "Ajuda e lista de comandos"),
    // Skills que vêm com a CLI (aparecem em "Built-in" no `/context`).
    ("code-review", "Revisa o diff atual atrás de bugs"),
    ("simplify", "Limpa e simplifica o código alterado"),
    ("loop", "Repete um comando num intervalo"),
    ("schedule", "Agenda um agente para rodar depois"),
    ("run", "Sobe o app para ver a mudança funcionando"),
];

const CODEX: &[(&str, &str)] = &[
    ("new", "Começa uma conversa nova"),
    ("compact", "Resume a conversa para liberar contexto"),
    ("model", "Troca o modelo e o esforço"),
    ("approvals", "O que o Codex pode fazer sem pedir"),
    ("review", "Revisa as mudanças pendentes"),
    ("diff", "Mostra o diff do git, com arquivos novos"),
    ("init", "Cria o AGENTS.md do projeto"),
    ("mention", "Menciona um arquivo"),
    ("status", "Configuração e uso de tokens da sessão"),
    ("mcp", "Lista as ferramentas MCP"),
];

/// Comandos de `provider` para a conta em `conta` (a pasta de configuração da CLI) e o projeto.
pub fn listar(provider: &str, conta: Option<&Path>, projeto: Option<&Path>) -> Vec<Comando> {
    let mut lista = Vec::new();
    match provider {
        "claude" => {
            embutidos(&mut lista, CLAUDE);
            if let Some(projeto) = projeto {
                markdowns(&mut lista, &projeto.join(".claude").join("commands"), "", "projeto");
                skills(&mut lista, &projeto.join(".claude").join("skills"), "", "skill");
            }
            if let Some(conta) = conta {
                markdowns(&mut lista, &conta.join("commands"), "", "seu");
                skills(&mut lista, &conta.join("skills"), "", "skill");
                plugins(&mut lista, conta, projeto);
            }
        }
        "codex" => {
            embutidos(&mut lista, CODEX);
            if let Some(conta) = conta {
                markdowns(&mut lista, &conta.join("prompts"), "prompts:", "seu");
            }
        }
        _ => {}
    }
    // O mesmo nome em dois lugares: vale o primeiro (projeto antes da conta, como na CLI).
    let mut vistos = HashSet::new();
    lista.retain(|c: &Comando| vistos.insert(c.nome.clone()));
    lista
}

fn embutidos(lista: &mut Vec<Comando>, tabela: &[(&str, &str)]) {
    lista.extend(tabela.iter().map(|(nome, descricao)| Comando { nome: (*nome).into(), descricao: (*descricao).into(), origem: "cli" }));
}

/// `pasta/**/*.md`; subpasta vira namespace (`frontend/revisar.md` → `frontend:revisar`).
fn markdowns(lista: &mut Vec<Comando>, pasta: &Path, prefixo: &str, origem: &'static str) {
    let Ok(entradas) = std::fs::read_dir(pasta) else { return };
    let mut entradas: Vec<_> = entradas.flatten().collect();
    entradas.sort_by_key(|e| e.file_name());
    for entrada in entradas {
        let caminho = entrada.path();
        let nome = entrada.file_name().to_string_lossy().into_owned();
        if caminho.is_dir() {
            markdowns(lista, &caminho, &format!("{prefixo}{nome}:"), origem);
        } else if let Some(base) = nome.strip_suffix(".md").filter(|base| !base.starts_with('_')) {
            // `_algo.md` é apoio do plugin (`_conventions.md`), não comando.
            let texto = std::fs::read_to_string(&caminho).unwrap_or_default();
            lista.push(Comando { nome: format!("{prefixo}{base}"), descricao: descricao(&texto), origem });
        }
    }
}

/// `pasta/<nome>/SKILL.md`. O nome que se digita é o da pasta.
fn skills(lista: &mut Vec<Comando>, pasta: &Path, prefixo: &str, origem: &'static str) {
    let Ok(entradas) = std::fs::read_dir(pasta) else { return };
    let mut entradas: Vec<_> = entradas.flatten().collect();
    entradas.sort_by_key(|e| e.file_name());
    for entrada in entradas {
        let Ok(texto) = std::fs::read_to_string(entrada.path().join("SKILL.md")) else { continue };
        let nome = entrada.file_name().to_string_lossy().into_owned();
        lista.push(Comando { nome: format!("{prefixo}{nome}"), descricao: descricao(&texto), origem });
    }
}

/// Plugins instalados **e ligados** (no `settings.json` da conta ou do projeto). Plugin de escopo
/// projeto só vale na pasta dele.
fn plugins(lista: &mut Vec<Comando>, conta: &Path, projeto: Option<&Path>) {
    let ler = |caminho: &Path| -> Option<Value> { serde_json::from_str(&std::fs::read_to_string(caminho).ok()?).ok() };
    let mut ligados = ler(&conta.join("settings.json")).and_then(|s| s.get("enabledPlugins").cloned())
        .and_then(|v| v.as_object().cloned()).unwrap_or_default();
    if let Some(projeto) = projeto {
        for nome in ["settings.json", "settings.local.json"] {
            if let Some(Value::Object(proprios)) = ler(&projeto.join(".claude").join(nome)).and_then(|s| s.get("enabledPlugins").cloned()) {
                ligados.extend(proprios);
            }
        }
    }
    let Some(Value::Object(instalados)) = ler(&conta.join("plugins").join("installed_plugins.json")).and_then(|v| v.get("plugins").cloned()) else { return };
    for (chave, versoes) in instalados {
        if ligados.get(&chave).and_then(Value::as_bool) != Some(true) { continue }
        let nome = chave.split('@').next().unwrap_or(&chave);
        let valida = versoes.as_array().into_iter().flatten().find(|v| {
            v.get("scope").and_then(Value::as_str) != Some("project")
                || projeto.zip(v.get("projectPath").and_then(Value::as_str)).is_some_and(|(p, dele)| mesma_pasta(&p.to_string_lossy(), dele))
        });
        let Some(raiz) = valida.and_then(|v| v.get("installPath")).and_then(Value::as_str).map(Path::new) else { continue };
        markdowns(lista, &raiz.join("commands"), &format!("{nome}:"), "plugin");
        skills(lista, &raiz.join("skills"), &format!("{nome}:"), "plugin");
    }
}

/// Windows: `D:\a` e `d:/a/` são a mesma pasta.
fn mesma_pasta(a: &str, b: &str) -> bool {
    let normal = |p: &str| p.replace('\\', "/").trim_end_matches('/').to_lowercase();
    normal(a) == normal(b)
}

/// `description` do frontmatter (aceita `>`/`|` em várias linhas); sem ele, a primeira linha de texto.
fn descricao(texto: &str) -> String {
    let texto = texto.trim_start_matches('\u{feff}');
    let mut linhas = texto.lines();
    let mut achada = None;
    if linhas.clone().next().map(str::trim) == Some("---") {
        linhas.next();
        let mut em_bloco = false;
        let mut partes: Vec<&str> = Vec::new();
        for linha in linhas.by_ref() {
            if linha.trim() == "---" { break }
            if em_bloco {
                if linha.starts_with(' ') || linha.starts_with('\t') { partes.push(linha.trim()); continue }
                em_bloco = false;
            }
            if let Some(valor) = linha.strip_prefix("description:") {
                let valor = valor.trim();
                if valor == ">" || valor == "|" || valor == ">-" || valor == "|-" { em_bloco = true } else { partes.push(valor.trim_matches(['"', '\''])) }
            }
        }
        if !partes.is_empty() { achada = Some(partes.join(" ")) }
    }
    let texto = achada.unwrap_or_else(|| linhas.map(str::trim).find(|l| !l.is_empty()).unwrap_or("").trim_start_matches('#').trim().to_owned());
    let mut curto: String = texto.chars().take(140).collect();
    if texto.chars().count() > 140 { curto.push('…') }
    curto
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn claude_junta_embutidos_comandos_skills_e_plugins_ligados() {
        let raiz = tempfile::tempdir().unwrap();
        let (conta, projeto) = (raiz.path().join("conta"), raiz.path().join("projeto"));
        fs::create_dir_all(conta.join("commands").join("frontend")).unwrap();
        fs::write(conta.join("commands").join("frontend").join("revisar.md"), "---\ndescription: \"Revisa a tela\"\n---\ncorpo").unwrap();
        fs::create_dir_all(conta.join("skills").join("resumir")).unwrap();
        fs::write(conta.join("skills").join("resumir").join("SKILL.md"), "---\nname: resumir\ndescription: >\n  Resume o texto\n  em tópicos.\n---\n").unwrap();
        fs::create_dir_all(projeto.join(".claude").join("commands")).unwrap();
        fs::write(projeto.join(".claude").join("commands").join("deploy.md"), "# Faz o deploy\n\npassos").unwrap();
        let plugin = raiz.path().join("cache").join("pz");
        fs::create_dir_all(plugin.join("skills").join("limpar")).unwrap();
        fs::write(plugin.join("skills").join("limpar").join("SKILL.md"), "---\ndescription: Limpa\n---\n").unwrap();
        let desligado = raiz.path().join("cache").join("off");
        fs::create_dir_all(desligado.join("commands")).unwrap();
        fs::write(desligado.join("commands").join("x.md"), "x").unwrap();
        fs::create_dir_all(conta.join("plugins")).unwrap();
        fs::write(conta.join("plugins").join("installed_plugins.json"), serde_json::json!({"version":2,"plugins":{
            "pz@loja":[{"scope":"user","installPath":plugin}],
            "off@loja":[{"scope":"user","installPath":desligado}],
        }}).to_string()).unwrap();
        fs::write(conta.join("settings.json"), r#"{"enabledPlugins":{"pz@loja":true,"off@loja":false}}"#).unwrap();

        let lista = listar("claude", Some(&conta), Some(&projeto));
        let achar = |nome: &str| lista.iter().find(|c| c.nome == nome);
        assert_eq!(achar("compact").map(|c| c.origem), Some("cli"));
        assert_eq!(achar("frontend:revisar").map(|c| c.descricao.as_str()), Some("Revisa a tela"));
        assert_eq!(achar("resumir").map(|c| c.descricao.as_str()), Some("Resume o texto em tópicos."));
        assert_eq!(achar("deploy").map(|c| (c.origem, c.descricao.as_str())), Some(("projeto", "Faz o deploy")));
        assert_eq!(achar("pz:limpar").map(|c| c.origem), Some("plugin"));
        assert!(achar("off:x").is_none(), "plugin desligado não entra");
    }

    #[test]
    fn codex_le_os_prompts_e_outro_agente_nao_tem_lista() {
        let conta = tempfile::tempdir().unwrap();
        fs::create_dir_all(conta.path().join("prompts")).unwrap();
        fs::write(conta.path().join("prompts").join("pr.md"), "Abre o PR").unwrap();
        let lista = listar("codex", Some(conta.path()), None);
        assert!(lista.iter().any(|c| c.nome == "prompts:pr" && c.descricao == "Abre o PR"));
        assert!(lista.iter().any(|c| c.nome == "approvals"));
        assert!(listar("cursor", Some(conta.path()), None).is_empty());
    }
}
