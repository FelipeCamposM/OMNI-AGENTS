//! Entende o embrulho que o Claude Code põe em volta de cada comando do Bash.
//!
//! O que chega no shim não é o comando que o agente escreveu, e sim algo como:
//!
//! ```text
//! source '/c/Users/.../shell-snapshots/snapshot-bash-….sh' 2>/dev/null || true && export TEMP=… \
//!   && { shopt -u extglob … } && eval '<comando do agente>' < /dev/null \
//!   && pwd -P >| '/c/Users/.../AppData/Local/Temp/claude-17e9-cwd'
//! ```
//!
//! Duas coisas dependem disso:
//!
//! 1. **O arquivo de diretório no fim.** É como o CLI sabe em que pasta ficou depois do comando. O
//!    caminho é do Windows em forma MSYS (`/c/...`), que não existe na distro nem no servidor: o
//!    comando inteiro falhava com `No such file or directory` antes de rodar qualquer coisa. Ele sai
//!    do comando remoto e quem grava é o shim, aqui, com o caminho local.
//! 2. **Hook não é comando de ferramenta.** Hooks do usuário chegam crus (`node "${CLAUDE_PLUGIN_ROOT}/…"`)
//!    e são ferramenta **desta** máquina — mandá-los para dentro da distro dava `node: command not
//!    found`. Sem o embrulho, o shim executa local.

/// O que o shim deve fazer com a linha que recebeu.
#[derive(Debug, PartialEq, Eq)]
pub enum Embrulho {
    /// Comando do Bash do agente: roda no alvo, e depois grava o diretório neste arquivo local.
    Ferramenta { comando: String, arquivo_cwd: Option<String> },
    /// Qualquer outra coisa (hook, sonda interna): roda nesta máquina, como sempre.
    Local,
}

/// `/c/Users/ana/x` → `C:\Users\ana\x`. É a forma que o Git Bash usa para caminho do Windows.
pub fn msys_para_windows(caminho: &str) -> Option<String> {
    let resto = caminho.strip_prefix('/')?;
    let mut partes = resto.splitn(2, '/');
    let letra = partes.next()?;
    let mut chars = letra.chars();
    let inicial = chars.next()?;
    if !inicial.is_ascii_alphabetic() || chars.next().is_some() {
        return None;
    }
    let cauda = partes.next().unwrap_or("");
    Some(format!("{}:\\{}", inicial.to_ascii_uppercase(), cauda.replace('/', "\\")))
}

/// Separa o comando do agente do embrulho. Só o que tem a marca do embrulho vai para o alvo.
pub fn analisar(linha: &str) -> Embrulho {
    let tem_embrulho = linha.contains("shell-snapshots") || linha.contains(" && eval '");
    if !tem_embrulho {
        return Embrulho::Local;
    }
    // `pwd -P >| '<arquivo>'` no fim: tira daqui e grava depois, do lado de cá.
    let (comando, arquivo_cwd) = match linha.rfind("&& pwd -P >") {
        Some(posicao) => {
            let cauda = &linha[posicao..];
            let arquivo = cauda
                .split('\'')
                .nth(1)
                .map(str::to_owned);
            (linha[..posicao].trim_end().to_string(), arquivo)
        }
        None => (linha.to_string(), None),
    };
    Embrulho::Ferramenta { comando, arquivo_cwd }
}

#[cfg(test)]
mod tests {
    use super::*;

    const LINHA: &str = "source '/c/Users/Ana Silva/.claude/shell-snapshots/snapshot-bash-1.sh' 2>/dev/null || true \
&& export TEMP='C:\\Temp' && eval 'uname -s' < /dev/null \
&& pwd -P >| '/c/Users/Ana Silva/AppData/Local/Temp/claude-17e9-cwd'";

    #[test]
    fn comando_de_ferramenta_perde_a_gravacao_do_diretorio() {
        let Embrulho::Ferramenta { comando, arquivo_cwd } = analisar(LINHA) else {
            panic!("deveria ser comando de ferramenta");
        };
        assert!(comando.contains("eval 'uname -s'"));
        // O `pwd -P >| '/c/...'` não pode ir para o alvo: lá esse caminho não existe e o comando
        // inteiro falhava antes de rodar.
        assert!(!comando.contains("pwd -P"));
        assert_eq!(
            arquivo_cwd.as_deref(),
            Some("/c/Users/Ana Silva/AppData/Local/Temp/claude-17e9-cwd")
        );
    }

    #[test]
    fn hook_do_usuario_roda_local() {
        assert_eq!(analisar("node \"${CLAUDE_PLUGIN_ROOT}/hooks/x.mjs\""), Embrulho::Local);
        assert_eq!(analisar("echo oi"), Embrulho::Local);
    }

    #[test]
    fn caminho_msys_vira_caminho_do_windows() {
        assert_eq!(
            msys_para_windows("/c/Users/Ana Silva/AppData/Local/Temp/claude-1-cwd").as_deref(),
            Some(r"C:\Users\Ana Silva\AppData\Local\Temp\claude-1-cwd")
        );
        // Caminho do Linux não vira nada: `/home` não é letra de unidade.
        assert_eq!(msys_para_windows("/home/ana/p"), None);
    }
}
