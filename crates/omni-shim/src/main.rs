//! Executa no alvo o comando que o agente pediu.
//!
//! O Claude Code roda **nesta máquina** (conta, histórico e `/usage` são os do Windows), mas o
//! código do projeto mora dentro do WSL ou num servidor. Este binário é o desvio: o CLI o recebe em
//! `CLAUDE_CODE_SHELL_PREFIX` e passa o comando inteiro como **um argumento só**, no formato
//! `"<programa>" "<comando>"`. Daqui ele sai como `wsl.exe -d <distro> --cd <dir> -- bash -lc <cmd>`
//! ou `ssh <host> -- cd <dir> && <cmd>`.
//!
//! Por isso o prefixo é só o caminho do executável, sem flag nenhuma: o parser do CLI corta a string
//! no último `" -"` e trata o começo como o nome do programa — qualquer espaço antes disso quebraria.
//! Toda a configuração chega por variável de ambiente, posta pelo engine ao abrir a sessão.

mod wrapper;

use omni_core::targets::{command_for, resolve, ssh_connections, to_remote, Target};
use std::{env, path::PathBuf, process::Command};
use wrapper::{analisar, msys_para_windows, Embrulho};

/// Variáveis que o engine grava no ambiente da sessão de agente.
const KIND: &str = "OMNI_TARGET_KIND";
const DISTRO: &str = "OMNI_TARGET_DISTRO";
const SSH_ID: &str = "OMNI_TARGET_SSH_ID";
const LOCAL_ROOT: &str = "OMNI_TARGET_LOCAL_ROOT";
const REMOTE_ROOT: &str = "OMNI_TARGET_REMOTE_ROOT";
const DATA_DIR: &str = "OMNI_TARGET_DATA_DIR";

fn main() {
    // Sem argumento não há o que rodar. Código 2 = erro de uso, como qualquer utilitário POSIX.
    let comando = env::args().skip(1).collect::<Vec<_>>().join(" ");
    if comando.trim().is_empty() {
        eprintln!("omni-shim: nenhum comando recebido");
        std::process::exit(2);
    }

    // Diagnóstico: grava o comando exatamente como o CLI o entregou. `OMNI_SHIM_DEBUG` é o arquivo
    // de log; a execução segue normal, para dar para inspecionar sem quebrar a sessão.
    if let Ok(log) = env::var("OMNI_SHIM_DEBUG") {
        use std::io::Write as _;
        if let Ok(mut arquivo) = std::fs::OpenOptions::new().create(true).append(true).open(&log) {
            let _ = writeln!(arquivo, "--- {comando}");
        }
    }

    // Hook do usuário e sonda interna do CLI chegam sem o embrulho do Bash: essas são ferramentas
    // **desta** máquina e rodam aqui — mandá-las para a distro dava `node: command not found`.
    let Embrulho::Ferramenta { comando, arquivo_cwd } = analisar(&comando) else {
        std::process::exit(rodar_local(&comando));
    };

    let conexoes = ssh_connections(&PathBuf::from(env::var(DATA_DIR).unwrap_or_default()));
    let alvo = match alvo_do_ambiente(&conexoes) {
        Some(alvo) => alvo,
        // Sem alvo configurado o certo é rodar local, e não falhar: é o que acontece se a variável
        // se perder (sessão reiniciada por fora, terminal aberto na mão).
        None => std::process::exit(rodar_local(&comando)),
    };

    let raiz_local = env::var(LOCAL_ROOT).unwrap_or_default();
    let cwd = env::current_dir().unwrap_or_else(|_| PathBuf::from(&raiz_local));
    let cwd_remoto = to_remote(&alvo, &raiz_local, &cwd.to_string_lossy())
        .or_else(|| alvo.remote_path().map(str::to_owned))
        .unwrap_or_else(|| "/".into());

    let Some((programa, args)) = command_for(&alvo, &cwd_remoto, &comando, &conexoes) else {
        std::process::exit(rodar_local(&comando));
    };

    // Herda stdin/stdout/stderr: o agente lê a saída como se o comando tivesse rodado aqui.
    let status = match Command::new(&programa).args(&args).status() {
        Ok(status) => status.code().unwrap_or(1),
        Err(erro) => {
            eprintln!("omni-shim: falha ao executar {programa}: {erro}");
            std::process::exit(127);
        }
    };

    // O CLI lê este arquivo para saber em que pasta ficou. Como cada comando é uma invocação nova no
    // alvo, o diretório de trabalho **daqui** não muda — e é ele que precisa estar no arquivo, senão
    // o CLI passaria a usar um caminho Linux como pasta do Windows no comando seguinte.
    if let Some(destino) = arquivo_cwd.as_deref().and_then(msys_para_windows) {
        let _ = std::fs::write(destino, format!("{}\n", cwd.to_string_lossy()));
    }
    std::process::exit(status);
}

/// Monta o alvo a partir do **caminho local** do projeto, e não do caminho remoto que veio no
/// ambiente.
///
/// O motivo é concreto: no Windows o Claude Code roda os comandos pelo Git Bash, e o MSYS converte
/// variável de ambiente que pareça caminho POSIX ao chamar um programa nativo — medido aqui,
/// `/home/ana/proj` chegava como `C:/Program Files/Git/home/ana/proj`, e o `wsl --cd` respondia
/// `ERROR_PATH_NOT_FOUND`. Caminho do Windows não sofre essa conversão, então ele é a fonte
/// confiável; o `OMNI_TARGET_REMOTE_ROOT` fica só como reserva.
fn alvo_do_ambiente(conexoes: &[omni_core::targets::SshConnection]) -> Option<Target> {
    let raiz = env::var(LOCAL_ROOT).ok().filter(|valor| !valor.is_empty())?;
    let alvo = resolve(&raiz, conexoes);
    if !alvo.is_local() {
        return Some(alvo);
    }
    // Reserva: o projeto não se identifica pelo caminho (unidade SSH ainda não cadastrada aqui).
    let remote_root = env::var(REMOTE_ROOT).ok().filter(|valor| valor.starts_with('/'))?;
    match env::var(KIND).ok()?.as_str() {
        "wsl" => Some(Target::Wsl { distro: env::var(DISTRO).ok()?, remote_path: remote_root }),
        "ssh" => Some(Target::Ssh { connection_id: env::var(SSH_ID).ok()?, remote_path: remote_root }),
        _ => None,
    }
}

/// Shells desta máquina, em ordem de preferência.
///
/// **Nunca por nome solto.** No Windows, `bash.exe` no PATH é o `C:\Windows\System32\bash.exe`, que
/// é o lançador do WSL: o hook ia parar dentro da distro e falhava com `node: command not found`.
/// Aqui vale o mesmo bash que o Claude Code usa — o do Git.
fn shells_locais() -> Vec<String> {
    let mut candidatos = Vec::new();
    for variavel in ["CLAUDE_CODE_GIT_BASH_PATH", "SHELL"] {
        if let Ok(valor) = env::var(variavel) {
            if valor.contains("bash") && PathBuf::from(&valor).is_file() {
                candidatos.push(valor);
            }
        }
    }
    #[cfg(windows)]
    for variavel in ["ProgramFiles", "ProgramFiles(x86)"] {
        if let Some(raiz) = env::var_os(variavel) {
            let caminho = PathBuf::from(&raiz).join("Git").join("bin").join("bash.exe");
            if caminho.is_file() {
                candidatos.push(caminho.to_string_lossy().into_owned());
            }
        }
    }
    #[cfg(not(windows))]
    candidatos.extend(["/bin/bash".to_string(), "/bin/sh".to_string()]);
    candidatos
}

/// Roda aqui mesmo — é o caminho dos hooks e de qualquer comando sem o embrulho do Bash.
///
/// Pelo `bash`, e não pelo `cmd.exe`: quem chamou o shim foi o Git Bash, o comando vem em sintaxe
/// POSIX, e o `cmd` ainda por cima recusa pasta atual em UNC (`\\wsl.localhost\...`), que é
/// justamente a pasta de um projeto no WSL.
fn rodar_local(comando: &str) -> i32 {
    for programa in shells_locais() {
        match Command::new(&programa).arg("-c").arg(comando).status() {
            Ok(status) => return status.code().unwrap_or(1),
            Err(_) => continue,
        }
    }
    #[cfg(windows)]
    {
        return Command::new("cmd.exe")
            .args(["/C", comando])
            .status()
            .map(|status| status.code().unwrap_or(1))
            .unwrap_or(127);
    }
    #[cfg(not(windows))]
    127
}
