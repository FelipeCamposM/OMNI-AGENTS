use serde::Serialize;
use std::process::{Command, Stdio};

/// `CREATE_NO_WINDOW`. Sem isso, todo `git` disparado por um binário de subsistema `windows`
/// (que não tem console próprio) aloca um console novo e pisca na tela — mesma causa que fazia a
/// detecção de agentes piscar. `Stdio::null()` sozinho não resolve: ele redireciona os streams,
/// não impede a alocação.
pub(crate) fn hidden(command: &mut Command) -> &mut Command {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x0800_0000);
    }
    command
}

fn git_available() -> bool {
    hidden(&mut Command::new("git"))
        .arg("--version")
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .is_ok_and(|status| status.success())
}

/// A mensagem do `rev-parse` diz "aqui não tem repositório", e não "não consegui chegar na pasta".
///
/// Comparar texto de stderr é frágil (muda com idioma e versão), mas a alternativa — tratar toda
/// falha como "sem repositório" — é pior: esconde montagem caída e distro parada. Por isso a lista
/// é de casos conhecidos e **o resto vira erro visível**.
fn fora_de_repositorio(erro: &str) -> bool {
    let texto = erro.to_lowercase();
    ["not a git repository", "não é um repositório", "nao e um repositorio"]
        .iter()
        .any(|marca| texto.contains(marca))
}

/// Monta a invocação do `git` para o alvo do projeto.
///
/// Projeto dentro do WSL ou num servidor roda o **git de lá**. O git do Windows até abre a pasta
/// pela rede, mas é outro git: outro `core.autocrlf`, outro `filemode` e outro `safe.directory` —
/// commitar por ele suja um repositório Linux com finais de linha e bit de permissão trocados.
fn git_invocation(cwd: &str, args: &[&str]) -> (String, Vec<String>) {
    let conexoes = crate::ssh::connections();
    let alvo = omni_core::targets::resolve(cwd, &conexoes);
    let Some(remoto) = alvo.remote_path() else {
        return ("git".into(), args.iter().map(|arg| (*arg).to_owned()).collect());
    };
    let comando = std::iter::once("git".to_string())
        .chain(args.iter().map(|arg| omni_core::targets::quote_posix(arg)))
        .collect::<Vec<_>>()
        .join(" ");
    omni_core::targets::command_for(&alvo, remoto, &comando, &conexoes)
        .unwrap_or_else(|| ("git".into(), args.iter().map(|arg| (*arg).to_owned()).collect()))
}

fn run_git(cwd: &str, args: &[&str]) -> Result<String, String> {
    let (programa, argumentos) = git_invocation(cwd, args);
    let remoto = programa != "git";
    // Projeto remoto: quem entra na pasta é o `--cd`/`cd` do comando montado. Apontar o
    // `current_dir` do `wsl.exe` para um caminho UNC faz o processo nem nascer.
    let diretorio = if remoto {
        std::env::var("USERPROFILE").or_else(|_| std::env::var("HOME")).unwrap_or_else(|_| ".".into())
    } else {
        cwd.to_string()
    };
    let output = hidden(&mut Command::new(programa))
        .args(&argumentos)
        .current_dir(diretorio)
        // O app não tem console: se o git resolvesse pedir usuário/senha no terminal, ficaria
        // pendurado pra sempre e o botão travava em "ocupado". Com isto ele falha na hora com
        // uma mensagem. Não atrapalha o credential helper (GCM), que é GUI e não é "prompt de
        // terminal".
        .env("GIT_TERMINAL_PROMPT", "0")
        .output()
        .map_err(|error| format!("git não encontrado no PATH: {error}"))?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        if !stderr.is_empty() {
            return Err(stderr);
        }
        // Alguns comandos (push incluído) escrevem a explicação no stdout e só o código de saída
        // no status. Sem isto a falha chegava na UI como "git falhou sem mensagem de erro".
        let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
        return Err(if stdout.is_empty() {
            format!("`git {}` falhou sem dizer por quê ({})", args.join(" "), output.status)
        } else {
            stdout
        });
    }
    Ok(String::from_utf8_lossy(&output.stdout).into_owned())
}

#[derive(Serialize)]
pub struct GitStatusEntry {
    path: String,
    x: char,
    y: char,
}

#[derive(Serialize)]
pub struct GitStatus {
    branch: String,
    entries: Vec<GitStatusEntry>,
}

/// Porcelain v1 com `-z`: cada entrada é "XY caminho", separadas por NUL. Uma entrada de
/// rename/copy (X ou Y = R/C) é seguida por outra entrada só com o caminho antigo — descartada
/// aqui (não precisamos do caminho de origem pra status/stage).
///
/// **O espaço vira ponto de propósito.** No v1, "nada nesta coluna" é ESPAÇO; no v2 é PONTO — e o
/// front (`isStaged`/`isUnstaged` em `gitService.ts`) fala v2. Repassando o espaço cru, `" " != "."`
/// fazia todo arquivo modificado contar como preparado E como não preparado ao mesmo tempo: o
/// painel oferecia "Commit" sem nada no índice e o git respondia com o `status` longo inteiro
/// ("no changes added to commit"), que chegava na tela como um muro de texto vermelho.
fn parse_status_v1(output: &str) -> Vec<GitStatusEntry> {
    let mut entries = Vec::new();
    let mut chunks = output.split('\0').filter(|chunk| !chunk.is_empty());
    while let Some(chunk) = chunks.next() {
        let mut chars = chunk.chars();
        let (Some(x), Some(y)) = (chars.next(), chars.next()) else { continue };
        let path = chunk.get(3..).unwrap_or("").to_string();
        if x == 'R' || x == 'C' || y == 'R' || y == 'C' {
            chunks.next();
        }
        let ponto = |coluna: char| if coluna == ' ' { '.' } else { coluna };
        entries.push(GitStatusEntry { path, x: ponto(x), y: ponto(y) });
    }
    entries
}

/// `None` = projeto não é (nem está dentro de) um repositório git — não é erro, é um estado
/// normal (a maioria dos projetos abertos aqui não tem git). Só vira `Err` se o próprio `git`
/// falhar por outro motivo (não encontrado no PATH, etc).
#[tauri::command]
pub fn git_status(project_path: String) -> Result<Option<GitStatus>, String> {
    if !git_available() {
        return Err("git não encontrado no PATH.".into());
    }
    // "Não é repositório" é estado normal e vira `None`. Já uma falha de **acesso** — montagem SSHFS
    // que caiu, distro parada, `dubious ownership` — precisa aparecer: colapsar tudo em `None` fazia
    // o painel dizer "nenhum repositório Git" e esconder o problema real.
    match run_git(&project_path, &["rev-parse", "--is-inside-work-tree"]) {
        Ok(output) if output.trim() == "true" => {}
        Ok(_) => return Ok(None),
        Err(erro) if fora_de_repositorio(&erro) => return Ok(None),
        Err(erro) => return Err(erro),
    }
    let branch = run_git(&project_path, &["rev-parse", "--abbrev-ref", "HEAD"])?
        .trim()
        .to_string();
    let raw = run_git(&project_path, &["status", "--porcelain=v1", "-z"])?;
    Ok(Some(GitStatus { branch, entries: parse_status_v1(&raw) }))
}

#[tauri::command]
pub fn git_diff(project_path: String, file: String, staged: bool) -> Result<String, String> {
    let mut args = vec!["diff"];
    if staged {
        args.push("--staged");
    }
    args.push("--");
    args.push(&file);
    run_git(&project_path, &args)
}

#[tauri::command]
pub fn git_stage(project_path: String, files: Vec<String>) -> Result<(), String> {
    if files.is_empty() {
        return Ok(());
    }
    let mut args = vec!["add", "--"];
    args.extend(files.iter().map(String::as_str));
    run_git(&project_path, &args).map(|_| ())
}

#[tauri::command]
pub fn git_unstage(project_path: String, files: Vec<String>) -> Result<(), String> {
    if files.is_empty() {
        return Ok(());
    }
    let mut args = vec!["restore", "--staged", "--"];
    args.extend(files.iter().map(String::as_str));
    run_git(&project_path, &args).map(|_| ())
}

#[tauri::command]
pub fn git_commit(project_path: String, message: String) -> Result<(), String> {
    // `diff --cached --quiet` sai 0 quando NÃO há nada preparado. Sem esta checagem, o git recusa o
    // commit imprimindo o `status` longo inteiro no stdout, e aquilo chega na UI como um parágrafo
    // vermelho de sete linhas em inglês. O painel já esconde o botão sem nada preparado — isto
    // cobre a corrida (algo desfez o stage entre o último refresh e o clique).
    if run_git(&project_path, &["diff", "--cached", "--quiet"]).is_ok() {
        return Err("Nada preparado para commit. Marque arquivos com + antes.".into());
    }
    run_git(&project_path, &["commit", "-m", &message]).map(|_| ())
}

/// Branch nova nunca tem upstream, e aí `git push` puro falha mandando configurar. Em vez de
/// checar o texto do stderr (frágil, muda com idioma/versão — mesma razão do comentário em
/// `git_status`), pergunta direto se existe `@{u}`: sem upstream, publica a branch com `-u`.
#[tauri::command]
pub fn git_push(project_path: String) -> Result<(), String> {
    if run_git(&project_path, &["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"]).is_ok() {
        return run_git(&project_path, &["push"]).map(|_| ());
    }
    let branch = run_git(&project_path, &["rev-parse", "--abbrev-ref", "HEAD"])?.trim().to_string();
    if branch.is_empty() || branch == "HEAD" {
        return Err("HEAD destacado: faça checkout de uma branch antes de dar push.".into());
    }
    run_git(&project_path, &["push", "--set-upstream", "origin", &branch]).map(|_| ())
}

/// `--ff-only`: sem upstream novo por cima do trabalho local, o pull vira merge (ou rebase) e um
/// conflito nasceria sem ninguém olhando. Falhando, a mensagem do git diz o que fazer.
#[tauri::command]
pub fn git_pull(project_path: String) -> Result<String, String> {
    run_git(&project_path, &["pull", "--ff-only"])
}

#[derive(Serialize)]
pub struct GitBranch {
    name: String,
    current: bool,
}

#[tauri::command]
pub fn git_branches(project_path: String) -> Result<Vec<GitBranch>, String> {
    let raw = run_git(&project_path, &["branch", "--format=%(HEAD)%(refname:short)"])?;
    Ok(raw
        .lines()
        .filter_map(|line| {
            let current = line.starts_with('*');
            let name = line.trim_start_matches('*').trim().to_string();
            if name.is_empty() { None } else { Some(GitBranch { name, current }) }
        })
        .collect())
}

/// `create` = `checkout -b`: nasce a partir do HEAD atual, que é o que o rodapé oferece.
#[tauri::command]
pub fn git_checkout_branch(project_path: String, branch: String, create: bool) -> Result<(), String> {
    let args = if create { vec!["checkout", "-b", &branch] } else { vec!["checkout", &branch] };
    run_git(&project_path, &args).map(|_| ())
}

#[derive(Serialize)]
pub struct GitCommit {
    hash: String,
    parents: Vec<String>,
    author: String,
    date: String,
    message: String,
    refs: Vec<String>,
}

const LOG_SEP: &str = "\u{1}";
const LOG_FORMAT: &str = "%H\u{1}%P\u{1}%an\u{1}%aI\u{1}%s\u{1}%D";

#[tauri::command]
pub fn git_log_graph(project_path: String) -> Result<Vec<GitCommit>, String> {
    // --topo-order: garante pai sempre antes de todos os filhos na lista (a ordem por data padrão
    // não garante isso — rebase/cherry-pick/clock skew podem listar um pai depois do filho, o que
    // quebra a reconstrução de lanes em GitGraphPane.tsx).
    let raw = run_git(
        &project_path,
        &["log", "--all", "--topo-order", &format!("--pretty=format:{LOG_FORMAT}")],
    )?;
    Ok(raw
        .lines()
        .filter_map(|line| {
            let mut parts = line.split(LOG_SEP);
            let hash = parts.next()?.to_string();
            let parents = parts.next().unwrap_or("").split_whitespace().map(String::from).collect();
            let author = parts.next().unwrap_or("").to_string();
            let date = parts.next().unwrap_or("").to_string();
            let message = parts.next().unwrap_or("").to_string();
            let refs = parts
                .next()
                .unwrap_or("")
                .split(',')
                .map(|item| item.trim().to_string())
                .filter(|item| !item.is_empty())
                .collect();
            Some(GitCommit { hash, parents, author, date, message, refs })
        })
        .collect())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// O bug que isto trava: com as colunas cruas do v1, um arquivo modificado e NÃO preparado
    /// tinha `x == ' '`, e o front (que fala v2, onde vazio é '.') o classificava como preparado.
    /// Resultado: botão de commit aparecia com o índice vazio e o git recusava com o status longo.
    #[test]
    fn porcelain_v1_usa_espaco_onde_o_front_espera_ponto() {
        let entries = parse_status_v1(" M src/app/api/contact/route.ts\0M  src/components/HeroV3.tsx\0?? novo.txt\0");
        assert_eq!(entries.len(), 3);

        // Modificado só na árvore: nada no índice.
        assert_eq!((entries[0].x, entries[0].y), ('.', 'M'));
        assert_eq!(entries[0].path, "src/app/api/contact/route.ts");

        // Modificado e já preparado: nada sobrando na árvore.
        assert_eq!((entries[1].x, entries[1].y), ('M', '.'));

        // Não rastreado continua "??" — o front depende disso pra mostrar o rótulo.
        assert_eq!((entries[2].x, entries[2].y), ('?', '?'));
    }

    #[test]
    fn entrada_de_rename_descarta_o_caminho_antigo() {
        let entries = parse_status_v1("R  novo.txt\0antigo.txt\0 M outro.txt\0");
        assert_eq!(entries.len(), 2);
        assert_eq!(entries[0].path, "novo.txt");
        assert_eq!(entries[1].path, "outro.txt");
    }

    #[test]
    fn projeto_no_wsl_usa_o_git_da_distro() {
        let (programa, args) = git_invocation(r"\\wsl.localhost\Ubuntu\home\ana\proj", &["status", "--porcelain=v1"]);
        assert_eq!(programa, "wsl.exe");
        assert_eq!(args[..5], ["-d", "Ubuntu", "--cd", "/home/ana/proj", "--"]);
        assert_eq!(args.last().unwrap(), "git 'status' '--porcelain=v1'");
    }

    #[test]
    fn projeto_local_continua_chamando_o_git_direto() {
        let (programa, args) = git_invocation(r"D:\dev\proj", &["status"]);
        assert_eq!(programa, "git");
        assert_eq!(args, ["status"]);
    }

    #[test]
    fn so_a_mensagem_de_fora_de_repositorio_vira_projeto_sem_git() {
        assert!(fora_de_repositorio("fatal: not a git repository (or any of the parent directories)"));
        // Montagem caída e dono suspeito são erro de verdade, e precisam chegar na tela.
        assert!(!fora_de_repositorio("fatal: detected dubious ownership in repository at '/srv/app'"));
        assert!(!fora_de_repositorio("O sistema nao pode encontrar o caminho especificado."));
    }
}
