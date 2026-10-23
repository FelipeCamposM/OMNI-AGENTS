//! "Exportar para outro agente": a conversa vira um pacote de contexto em Markdown que qualquer CLI
//! lê com a própria ferramenta de arquivo. A conversa original não muda; nasce outra, no agente
//! escolhido, começando por esse arquivo.
//!
//! Sai do mesmo feed que a tela mostra (`feed::items`), então vale para Claude, Codex e Antigravity.

use crate::feed::{Item, Kind};
use std::{fs, path::{Path, PathBuf}};

/// Teto das últimas mensagens na íntegra. O resto do pacote (objetivo, arquivos, comandos) é curto.
const MENSAGENS_ORCAMENTO: usize = 12_000;
const MENSAGENS_MAX: usize = 16;
const MENSAGEM_MAX: usize = 3_000;
const OBJETIVO_MAX: usize = 2_000;
const COMANDOS_MAX: usize = 15;

pub fn nome_do_agente(provider: &str) -> &str {
    match provider { "claude" => "Claude", "codex" => "Codex", "antigravity" => "Antigravity", "cursor" => "Cursor", outro => outro }
}

fn cortado(texto: &str, max: usize) -> String {
    let texto = texto.trim();
    if texto.chars().count() <= max { return texto.to_owned(); }
    format!("{}…", texto.chars().take(max).collect::<String>())
}

/// Tira chaves e senhas que apareceram na conversa (saída de comando, `.env` colado). O pacote é um
/// arquivo solto no projeto: não pode carregar segredo junto.
// ponytail: prefixos conhecidos + `CHAVE=valor`; segredo sem formato reconhecível passa. Ampliar a lista se aparecer outro.
pub fn sem_segredos(texto: &str) -> String {
    const PREFIXOS: [&str; 9] = ["sk-ant-", "sk-proj-", "sk-", "ghp_", "gho_", "github_pat_", "xoxb-", "AKIA", "AIza"];
    const CHAVES: [&str; 6] = ["PASSWORD", "SENHA", "SECRET", "TOKEN", "API_KEY", "APIKEY"];
    let parte_de_token = |c: char| c.is_ascii_alphanumeric() || matches!(c, '_' | '-' | '.');
    texto.lines().map(|linha| {
        // `X_TOKEN=valor` / `password: valor`: some o valor inteiro.
        let maiuscula = linha.to_ascii_uppercase();
        if let Some(pos) = linha.find(['=', ':']) {
            let chave = maiuscula[..pos].trim();
            if CHAVES.iter().any(|k| chave.ends_with(k)) && !linha[pos + 1..].trim().is_empty() {
                return format!("{}[segredo removido]", &linha[..=pos]);
            }
        }
        let mut saida = String::with_capacity(linha.len());
        let mut resto = linha;
        while !resto.is_empty() {
            let achado = PREFIXOS.iter().filter_map(|p| resto.find(p).map(|i| (i, *p)))
                .filter(|(i, _)| *i == 0 || !parte_de_token(resto[..*i].chars().last().unwrap_or(' ')))
                .min_by_key(|(i, _)| *i);
            let Some((i, _)) = achado else { saida.push_str(resto); break };
            let fim = resto[i..].find(|c: char| !parte_de_token(c)).map_or(resto.len(), |f| i + f);
            saida.push_str(&resto[..i]);
            saida.push_str(if fim - i >= 20 { "[segredo removido]" } else { &resto[i..fim] });
            resto = &resto[fim..];
        }
        saida
    }).collect::<Vec<_>>().join("\n")
}

/// O pacote em Markdown. `itens` na ordem da conversa, como a timeline.
pub fn pacote(titulo: &str, cwd: &str, provider: &str, itens: &[(String, Item)]) -> String {
    let agente = nome_do_agente(provider);
    let mut md = format!(
        "# Contexto exportado: {titulo}\n\n\
         > Exportado pelo OMNI AGENTS de uma conversa com o {agente} em {}. É o contexto para você \
         continuar este trabalho: leia tudo antes de agir. Os arquivos podem ter mudado depois, então \
         confira no código antes de editar.\n\nProjeto: `{cwd}`\n",
        chrono::Local::now().format("%d/%m/%Y %H:%M"),
    );

    let falas = || itens.iter().filter(|(_, it)| it.kind == Kind::Text);
    if let Some((_, primeiro)) = falas().find(|(_, it)| it.role == "user") {
        md += &format!("\n## Objetivo (primeiro pedido)\n\n{}\n", cortado(&primeiro.text, OBJETIVO_MAX));
    }

    // Arquivos na ordem em que foram mexidos, somando as edições de cada um.
    let mut arquivos: Vec<(String, usize, usize)> = Vec::new();
    for (_, it) in itens.iter().filter(|(_, it)| it.kind == Kind::Tool && it.diff.is_some()) {
        let diff = it.diff.as_ref().unwrap();
        for caminho in it.text.trim_end_matches('…').split(", ").filter(|c| !c.is_empty()) {
            match arquivos.iter_mut().find(|(c, _, _)| c == caminho) {
                Some(a) => { a.1 += diff.mais; a.2 += diff.menos; }
                None => arquivos.push((caminho.to_owned(), diff.mais, diff.menos)),
            }
        }
    }
    if !arquivos.is_empty() {
        md += "\n## Arquivos alterados\n\n";
        for (caminho, mais, menos) in &arquivos { md += &format!("- `{caminho}` (+{mais} −{menos})\n"); }
    }

    let mut comandos: Vec<&str> = Vec::new();
    for (_, it) in itens.iter().rev().filter(|(_, it)| it.kind == Kind::Tool && matches!(it.tool.as_deref(), Some("Bash" | "PowerShell" | "Shell"))) {
        if comandos.len() >= COMANDOS_MAX { break; }
        if !it.text.is_empty() && !comandos.contains(&it.text.as_str()) { comandos.push(&it.text); }
    }
    if !comandos.is_empty() {
        md += "\n## Últimos comandos rodados\n\n";
        for comando in comandos.iter().rev() { md += &format!("- `{}`\n", comando.replace('`', "'")); }
    }

    // Últimas falas na íntegra, de trás para a frente até o orçamento.
    let mut ultimas = Vec::new();
    let mut gasto = 0;
    for (_, it) in falas().rev() {
        if ultimas.len() >= MENSAGENS_MAX || gasto >= MENSAGENS_ORCAMENTO { break; }
        let texto = cortado(&it.text, MENSAGEM_MAX.min(MENSAGENS_ORCAMENTO - gasto));
        if texto.is_empty() { continue; }
        gasto += texto.chars().count();
        ultimas.push((if it.role == "user" { "Usuário" } else { agente }, texto));
    }
    if !ultimas.is_empty() {
        md += "\n## Últimas mensagens\n";
        for (quem, texto) in ultimas.iter().rev() { md += &format!("\n### {quem}\n\n{texto}\n"); }
    }
    sem_segredos(&md)
}

fn slug(titulo: &str) -> String {
    let mut s = String::new();
    for c in titulo.chars().flat_map(char::to_lowercase) {
        let c = match c { 'á' | 'à' | 'â' | 'ã' => 'a', 'é' | 'ê' => 'e', 'í' => 'i', 'ó' | 'ô' | 'õ' => 'o', 'ú' => 'u', 'ç' => 'c', c => c };
        if c.is_ascii_alphanumeric() { s.push(c) } else if !s.ends_with('-') && !s.is_empty() { s.push('-') }
        if s.len() >= 40 { break; }
    }
    let s = s.trim_end_matches('-').to_owned();
    if s.is_empty() { "conversa".into() } else { s }
}

/// Grava em `<projeto>/.omni/exports/` e devolve o caminho relativo (barras normais, sem espaço nem
/// aspas: vai dentro do prompt do agente novo). A pasta ganha um `.gitignore` próprio — o pacote tem
/// conteúdo de conversa e não deve entrar no repositório de ninguém.
pub fn salvar(cwd: &Path, titulo: &str, markdown: &str) -> std::io::Result<(PathBuf, String)> {
    let pasta = cwd.join(".omni").join("exports");
    fs::create_dir_all(&pasta)?;
    let ignorar = pasta.join(".gitignore");
    if !ignorar.exists() { fs::write(&ignorar, "*\n")?; }
    let nome = format!("{}-{}.md", chrono::Local::now().format("%Y%m%d-%H%M%S"), slug(titulo));
    let caminho = pasta.join(&nome);
    fs::write(&caminho, markdown)?;
    Ok((caminho, format!(".omni/exports/{nome}")))
}

/// O que o agente novo recebe como primeira mensagem: só o caminho (a linha de comando do Windows
/// para em 32k). Sem aspas dentro, porque vai entre aspas no comando.
pub fn prompt_inicial(relativo: &str, provider_origem: &str) -> String {
    format!(
        "Leia {relativo}: é o contexto de uma conversa anterior com o {}, exportada pelo OMNI AGENTS. \
         Resuma em poucas linhas o que entendeu e o que falta, e espere minha confirmação antes de mudar arquivos.",
        nome_do_agente(provider_origem)
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::feed::Diff;

    fn it(kind: Kind, role: &str, text: &str, tool: Option<&str>, diff: Option<(usize, usize)>) -> (String, Item) {
        ("claude".into(), Item {
            kind, role: role.into(), text: text.into(), tool: tool.map(Into::into), timestamp: None, imagens: 0,
            diff: diff.map(|(mais, menos)| Diff { mais, menos, linhas: vec![], cortado: false }),
        })
    }

    #[test]
    fn pacote_tem_objetivo_arquivos_comandos_e_ultimas_falas_sem_segredo() {
        let itens = vec![
            it(Kind::Text, "user", "corrigir o login no Safari", None, None),
            it(Kind::Tool, "assistant", "src/login.ts", Some("Edit"), Some((3, 1))),
            it(Kind::Tool, "assistant", "npm test", Some("Bash"), None),
            it(Kind::Tool, "assistant", "src/login.ts", Some("Edit"), Some((2, 2))),
            it(Kind::Text, "assistant", "Pronto. A chave era sk-ant-api03-abcdefghijklmnopqrstuvwxyz", None, None),
        ];
        let md = pacote("Login Safari", "C:/app", "claude", &itens);
        assert!(md.contains("## Objetivo (primeiro pedido)\n\ncorrigir o login no Safari"), "{md}");
        assert!(md.contains("- `src/login.ts` (+5 −3)"), "{md}");
        assert!(md.contains("- `npm test`"), "{md}");
        assert!(md.contains("### Claude\n\nPronto. A chave era [segredo removido]"), "{md}");
        assert!(!md.contains("abcdefghij"));
    }

    #[test]
    fn segredos_em_variavel_somem_e_texto_comum_fica() {
        assert_eq!(sem_segredos("DB_PASSWORD=hunter2"), "DB_PASSWORD=[segredo removido]");
        assert_eq!(sem_segredos("task-runner e sk-ok"), "task-runner e sk-ok");
        assert_eq!(slug("Login Quebra no Safári!"), "login-quebra-no-safari");
    }
}
