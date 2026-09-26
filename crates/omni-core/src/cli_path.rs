//! Onde os instaladores oficiais das CLIs de agente colocam o binário.
//!
//! O app herda o `PATH` de quem o abriu (Explorer, Dock, atalho). Instalador que acrescenta uma
//! pasta ao PATH do usuário **não** alcança um processo já rodando — nem o Explorer que vai abrir o
//! app depois, até a próxima sessão. Resultado: a CLI está instalada, funciona no terminal, e o
//! OMNI jura que não existe. Era preciso editar o PATH na mão.
//!
//! Acrescentar as pastas conhecidas resolve tanto a detecção quanto a execução: app e engine
//! ampliam na subida, e o app repassa seu PATH atualizado a cada terminal que abre.

use std::{
    cmp::Reverse,
    env,
    ffi::OsString,
    fs,
    path::{Path, PathBuf},
};

fn home() -> Option<PathBuf> {
    let chave = if cfg!(windows) { "USERPROFILE" } else { "HOME" };
    env::var_os(chave).map(PathBuf::from).filter(|caminho| !caminho.as_os_str().is_empty())
}

fn env_path(chave: &str, sufixo: &str) -> Option<PathBuf> {
    env::var_os(chave)
        .map(PathBuf::from)
        .filter(|caminho| !caminho.as_os_str().is_empty())
        .map(|caminho| if sufixo.is_empty() { caminho } else { caminho.join(sufixo) })
}

/// `nvm` e `fnm` põem os pacotes globais dentro da versão do Node. Apps abertos pelo Finder,
/// Dock ou Explorer não recebem o shell hook que seleciona essa versão, então procuramos os bins
/// instalados e preferimos a versão numericamente mais nova como fallback.
fn bins_versionados(root: &Path, sufixo: &Path) -> Vec<PathBuf> {
    let Ok(entries) = fs::read_dir(root) else { return Vec::new() };
    let mut versions: Vec<_> = entries
        .flatten()
        .filter(|entry| entry.file_type().is_ok_and(|kind| kind.is_dir()))
        .map(|entry| entry.path())
        .collect();
    let version = |path: &PathBuf| {
        path.file_name()
            .and_then(|name| name.to_str())
            .unwrap_or_default()
            .trim_start_matches('v')
            .split('.')
            .map(|part| part.parse::<u64>().unwrap_or_default())
            .collect::<Vec<_>>()
    };
    versions.sort_by_key(|path| Reverse(version(path)));
    versions.into_iter().map(|path| path.join(sufixo)).collect()
}

/// Pastas candidatas, na ordem em que entram no PATH. Só isto muda quando um instalador novo
/// aparece — o resto do módulo é mecânica.
pub fn locais_conhecidos() -> Vec<PathBuf> {
    let mut locais = Vec::new();

    // Configuração explícita ganha dos defaults. São diretórios, nunca comandos vindos da UI.
    for (variavel, sufixo) in [
        ("BUN_INSTALL", "bin"),
        ("VOLTA_HOME", "bin"),
        ("PNPM_HOME", ""),
        ("DENO_INSTALL", "bin"),
        ("CARGO_HOME", "bin"),
        ("ASDF_DATA_DIR", "shims"),
        ("MISE_DATA_DIR", "shims"),
        ("FNM_MULTISHELL_PATH", ""),
        ("NVM_SYMLINK", ""),
        ("XDG_BIN_HOME", ""),
        ("ChocolateyInstall", "bin"),
    ] {
        if let Some(path) = env_path(variavel, sufixo) { locais.push(path); }
    }
    for variavel in ["NPM_CONFIG_PREFIX", "npm_config_prefix"] {
        if let Some(prefixo) = env_path(variavel, "") {
            locais.push(if cfg!(windows) { prefixo } else { prefixo.join("bin") });
        }
    }

    if let Some(home) = home() {
        // Instaladores nativos de Claude/Codex e convenções de gerenciadores de pacotes.
        locais.push(home.join(".local").join("bin"));
        locais.push(home.join(".bun").join("bin"));
        locais.push(home.join(".volta").join("bin"));
        locais.push(home.join(".cargo").join("bin"));
        locais.push(home.join(".asdf").join("shims"));
        locais.push(home.join(".nodenv").join("shims"));
        locais.push(home.join(".local").join("share").join("mise").join("shims"));
        locais.push(home.join(".local").join("share").join("pnpm"));
        locais.push(home.join(".yarn").join("bin"));
        locais.push(home.join(".cursor").join("bin"));

        let nvm = env_path("NVM_DIR", "").unwrap_or_else(|| home.join(".nvm"));
        locais.extend(bins_versionados(&nvm.join("versions").join("node"), Path::new("bin")));

        #[cfg(windows)]
        {
            // `npm i -g` no Windows (Codex, Gemini).
            if let Some(appdata) = env::var_os("APPDATA").map(PathBuf::from) {
                locais.push(appdata.join("npm"));
                // nvm-windows guarda um npm global em cada versão quando o symlink corrente não
                // chegou ao ambiente do Explorer.
                locais.extend(bins_versionados(&appdata.join("nvm"), Path::new("")));
                locais.extend(bins_versionados(&appdata.join("fnm").join("node-versions"), Path::new("installation")));
            }
            if let Some(nvm_home) = env_path("NVM_HOME", "") {
                locais.extend(bins_versionados(&nvm_home, Path::new("")));
            }
            if let Some(fnm_dir) = env_path("FNM_DIR", "") {
                locais.extend(bins_versionados(&fnm_dir.join("node-versions"), Path::new("installation")));
            }
            // Instalador do CLI do Cursor (`agent.cmd`).
            if let Some(local) = env::var_os("LOCALAPPDATA").map(PathBuf::from) {
                locais.push(local.join("cursor-agent"));
                locais.push(local.join("pnpm"));
                locais.push(local.join("Microsoft").join("WinGet").join("Links"));
                locais.push(local.join("nvs").join("default"));
            }
            locais.push(home.join("scoop").join("shims"));
            if let Some(program_files) = env::var_os("ProgramFiles") {
                locais.push(PathBuf::from(program_files).join("nodejs"));
            }
        }
        #[cfg(not(windows))]
        {
            locais.push(home.join(".npm-global").join("bin"));
            locais.push(home.join(".nix-profile").join("bin"));
            let xdg_data = env_path("XDG_DATA_HOME", "").unwrap_or_else(|| home.join(".local").join("share"));
            locais.extend(bins_versionados(&xdg_data.join("fnm").join("node-versions"), Path::new("installation/bin")));
            if let Some(fnm_dir) = env_path("FNM_DIR", "") {
                locais.extend(bins_versionados(&fnm_dir.join("node-versions"), Path::new("installation/bin")));
            }
            #[cfg(target_os = "macos")]
            {
                locais.push(home.join("Library").join("pnpm"));
                locais.extend(bins_versionados(
                    &home.join("Library").join("Application Support").join("fnm").join("node-versions"),
                    Path::new("installation/bin"),
                ));
            }
        }
    }
    #[cfg(not(windows))]
    {
        locais.push(PathBuf::from("/usr/local/bin"));
        // Homebrew no Apple Silicon fica fora do PATH de app aberto pelo Finder.
        locais.push(PathBuf::from("/opt/homebrew/bin"));
        locais.push(PathBuf::from("/opt/local/bin"));
        locais.push(PathBuf::from("/home/linuxbrew/.linuxbrew/bin"));
        locais.push(PathBuf::from("/snap/bin"));
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
        assert!(tem(".volta/bin"), "Volta");
        assert!(tem(".asdf/shims"), "asdf");
        #[cfg(windows)]
        {
            assert!(tem("npm"), "npm global (Codex)");
            assert!(tem("pnpm"), "pnpm global");
            assert!(tem("cursor-agent"), "CLI do Cursor");
        }
    }

    #[test]
    fn versoes_do_node_entram_da_mais_nova_para_a_mais_antiga() {
        let dir = tempfile::tempdir().unwrap();
        for version in ["v9.1.0", "v20.12.2", "v18.20.0"] {
            std::fs::create_dir_all(dir.path().join(version).join("bin")).unwrap();
        }
        let bins = bins_versionados(dir.path(), Path::new("bin"));
        let nomes: Vec<_> = bins.iter()
            .map(|path| path.parent().unwrap().file_name().unwrap().to_string_lossy().into_owned())
            .collect();
        assert_eq!(nomes, ["v20.12.2", "v18.20.0", "v9.1.0"]);
    }
}
