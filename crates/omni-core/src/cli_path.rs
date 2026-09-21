//! Onde os instaladores oficiais das CLIs de agente colocam o binário.
//!
//! O app herda o `PATH` de quem o abriu (Explorer, Dock, atalho). Instalador que acrescenta uma
//! pasta ao PATH do usuário **não** alcança um processo já rodando — nem o Explorer que vai abrir o
//! app depois, até a próxima sessão. Resultado: a CLI está instalada, funciona no terminal, e o
//! OMNI jura que não existe. Era preciso editar o PATH na mão.
//!
//! Acrescentar as pastas conhecidas resolve tanto a detecção quanto a execução: o shell da PTY
//! herda o `PATH` de quem o abriu, então quem amplia é o app **e** o engine, cada um na subida.

use std::{env, ffi::OsString, path::PathBuf};

fn home() -> Option<PathBuf> {
    let chave = if cfg!(windows) { "USERPROFILE" } else { "HOME" };
    env::var_os(chave).map(PathBuf::from).filter(|caminho| !caminho.as_os_str().is_empty())
}

/// Pastas candidatas, na ordem em que entram no PATH. Só isto muda quando um instalador novo
/// aparece — o resto do módulo é mecânica.
pub fn locais_conhecidos() -> Vec<PathBuf> {
    let mut locais = Vec::new();
    if let Some(home) = home() {
        // Instalador nativo do Claude Code (`claude.exe`), e convenção geral no Linux/macOS.
        locais.push(home.join(".local").join("bin"));
        locais.push(home.join(".bun").join("bin"));
        #[cfg(windows)]
        {
            // `npm i -g` no Windows (Codex, Gemini).
            if let Some(appdata) = env::var_os("APPDATA") { locais.push(PathBuf::from(appdata).join("npm")); }
            // Instalador do CLI do Cursor (`agent.cmd`).
            if let Some(local) = env::var_os("LOCALAPPDATA") { locais.push(PathBuf::from(local).join("cursor-agent")); }
        }
        #[cfg(not(windows))]
        {
            locais.push(home.join(".npm-global").join("bin"));
            locais.push(home.join(".volta").join("bin"));
        }
    }
    #[cfg(not(windows))]
    {
        locais.push(PathBuf::from("/usr/local/bin"));
        // Homebrew no Apple Silicon fica fora do PATH de app aberto pelo Finder.
        locais.push(PathBuf::from("/opt/homebrew/bin"));
    }
    locais
}

/// Quais candidatos existem em disco e ainda não estão no PATH. Separado do `env` para ser testável.
pub fn faltando(path_atual: &[PathBuf], candidatos: Vec<PathBuf>) -> Vec<PathBuf> {
    // Windows não diferencia maiúscula de minúscula em caminho; comparar cru perderia duplicata.
    let normalizar = |caminho: &PathBuf| {
        let texto = caminho.to_string_lossy().replace('/', "\\");
        let texto = texto.trim_end_matches('\\').to_owned();
        if cfg!(windows) { texto.to_lowercase() } else { texto }
    };
    let atuais: Vec<String> = path_atual.iter().map(normalizar).collect();
    let mut vistos = Vec::new();
    candidatos
        .into_iter()
        .filter(|candidato| {
            let chave = normalizar(candidato);
            if atuais.contains(&chave) || vistos.contains(&chave) { return false }
            vistos.push(chave);
            candidato.is_dir()
        })
        .collect()
}

/// Acrescenta ao `PATH` deste processo as pastas conhecidas que faltavam. Devolve o que entrou —
/// vazio quando não havia nada a fazer. Idempotente: rodar de novo não duplica.
pub fn ampliar_path() -> Vec<PathBuf> {
    let atual: Vec<PathBuf> = env::var_os("PATH").map(|path| env::split_paths(&path).collect()).unwrap_or_default();
    let novos = faltando(&atual, locais_conhecidos());
    if novos.is_empty() { return novos }
    let combinado: Vec<PathBuf> = atual.iter().cloned().chain(novos.iter().cloned()).collect();
    match env::join_paths(combinado) {
        Ok(valor) => { env::set_var("PATH", &valor as &OsString); novos }
        // PATH com aspas ou `;` no meio: melhor ficar como está do que gravar um valor quebrado.
        Err(_) => Vec::new(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn so_entra_o_que_existe_e_ainda_nao_esta_no_path() {
        let dir = tempfile::tempdir().unwrap();
        let existe = dir.path().join("bin");
        std::fs::create_dir_all(&existe).unwrap();
        let inexistente = dir.path().join("nao-existe");

        let novos = faltando(&[], vec![existe.clone(), inexistente.clone()]);
        assert_eq!(novos, vec![existe.clone()], "pasta que não existe não entra no PATH");

        // Já no PATH: nada a acrescentar (nem em outra caixa, no Windows).
        assert!(faltando(&[existe.clone()], vec![existe.clone()]).is_empty());
        #[cfg(windows)]
        {
            let outra_caixa = PathBuf::from(existe.to_string_lossy().to_uppercase());
            assert!(faltando(&[outra_caixa], vec![existe.clone()]).is_empty(), "Windows ignora caixa no caminho");
        }
        // Candidato repetido entra uma vez só.
        assert_eq!(faltando(&[], vec![existe.clone(), existe.clone()]), vec![existe]);
    }

    #[test]
    fn os_locais_conhecidos_cobrem_os_instaladores_das_clis() {
        let locais = locais_conhecidos();
        let tem = |trecho: &str| locais.iter().any(|caminho| caminho.to_string_lossy().replace('\\', "/").contains(trecho));
        assert!(tem(".local/bin"), "instalador nativo do Claude Code");
        #[cfg(windows)]
        {
            assert!(tem("npm"), "npm global (Codex)");
            assert!(tem("cursor-agent"), "CLI do Cursor");
        }
    }
}
