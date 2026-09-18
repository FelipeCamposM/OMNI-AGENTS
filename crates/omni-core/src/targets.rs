//! Onde os comandos de um projeto realmente rodam.
//!
//! O caminho do projeto continua sendo um caminho do Windows — é isso que faz as ferramentas
//! nativas do Claude (Read/Edit/Glob/Grep) funcionarem com o CLI **local**. Mas `npm`, `git` e
//! companhia precisam rodar onde o código mora: dentro da distro do WSL ou na máquina remota.
//!
//! Este módulo é a fonte única dessa tradução. Engine, comandos Tauri e o `omni-shim` chamam daqui
//! — antes disso a regra do WSL estava copiada em dois lugares.

use serde::{Deserialize, Serialize};
use std::path::Path;

/// Onde um projeto executa.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum Target {
    /// Pasta comum do Windows: nada é desviado.
    Local,
    /// `\\wsl.localhost\<distro>\...` (ou o `\\wsl$\...` antigo).
    Wsl { distro: String, remote_path: String },
    /// Unidade montada por SSHFS apontando para uma máquina do registro (`ssh.json`).
    Ssh { connection_id: String, remote_path: String },
}

impl Target {
    pub fn is_local(&self) -> bool {
        matches!(self, Target::Local)
    }

    /// Pasta do lado de lá, em formato POSIX. `None` para projeto local.
    pub fn remote_path(&self) -> Option<&str> {
        match self {
            Target::Local => None,
            Target::Wsl { remote_path, .. } | Target::Ssh { remote_path, .. } => Some(remote_path),
        }
    }
}

/// Conexão SSH salva pelo usuário. **Nunca** guarda senha nem passphrase: autenticação é por chave
/// ou pelo agente de chaves do sistema.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct SshConnection {
    pub id: String,
    pub name: String,
    pub host: String,
    #[serde(default = "porta_padrao")]
    pub port: u16,
    pub user: String,
    /// Caminho da chave privada. Vazio = deixa o `ssh` decidir (`~/.ssh/config`, agente).
    #[serde(default)]
    pub key_path: String,
    /// Pasta do projeto na máquina remota.
    pub remote_path: String,
    /// Letra de unidade onde o SSHFS monta essa pasta (ex.: `X:`).
    pub drive: String,
}

fn porta_padrao() -> u16 {
    22
}

impl SshConnection {
    pub fn destination(&self) -> String {
        format!("{}@{}", self.user, self.host)
    }

    /// Argumentos comuns a qualquer invocação do `ssh` desta conexão.
    ///
    /// `BatchMode=yes` é o par do `GIT_TERMINAL_PROMPT=0` que o `git_client` já usa: o app não tem
    /// console, então um pedido de senha ficaria pendurado para sempre em vez de falhar na hora.
    pub fn ssh_args(&self) -> Vec<String> {
        let mut args = vec![
            "-o".into(),
            "BatchMode=yes".into(),
            "-o".into(),
            "StrictHostKeyChecking=accept-new".into(),
            "-p".into(),
            self.port.to_string(),
        ];
        if !self.key_path.trim().is_empty() {
            args.push("-i".into());
            args.push(self.key_path.clone());
        }
        args.push(self.destination());
        args
    }
}

/// `\\wsl.localhost\Ubuntu\home\ana\proj` → (`Ubuntu`, `/home/ana/proj`). Aceita as duas barras e o
/// host antigo `wsl$`.
fn wsl_parts(path: &str) -> Option<(String, String)> {
    let normalizado = path.replace('/', "\\");
    // Uma barra ou duas: o Git Bash colapsa `\\` ao repassar a variável para um programa nativo, e
    // foi assim que o caminho chegava no shim. Como só vale quando o host é do WSL, aceitar a forma
    // curta não confunde com caminho relativo.
    let resto = normalizado
        .strip_prefix("\\\\")
        .or_else(|| normalizado.strip_prefix('\\'))?;
    let mut partes = resto.splitn(3, '\\');
    let host = partes.next()?;
    if !host.eq_ignore_ascii_case("wsl.localhost") && !host.eq_ignore_ascii_case("wsl$") {
        return None;
    }
    let distro = partes.next().filter(|nome| !nome.is_empty())?;
    let dir = partes.next().unwrap_or("").trim_end_matches('\\');
    Some((distro.to_string(), format!("/{}", dir.replace('\\', "/"))))
}

/// Descobre o alvo de um caminho de projeto. `connections` vem do registro (`ssh.json`); uma lista
/// vazia só significa que nenhum projeto SSH foi cadastrado.
pub fn resolve(path: &str, connections: &[SshConnection]) -> Target {
    if let Some((distro, remote_path)) = wsl_parts(path) {
        return Target::Wsl { distro, remote_path };
    }
    let normalizado = path.replace('\\', "/");
    for connection in connections {
        let raiz = connection.drive.trim_end_matches(['\\', '/']).to_string();
        if raiz.is_empty() {
            continue;
        }
        let prefixo = format!("{}/", raiz.replace('\\', "/"));
        if normalizado.to_lowercase().starts_with(&prefixo.to_lowercase()) || normalizado.eq_ignore_ascii_case(&raiz) {
            let sufixo = normalizado[raiz.len()..].trim_start_matches('/');
            let remote_path = join_posix(&connection.remote_path, sufixo);
            return Target::Ssh { connection_id: connection.id.clone(), remote_path };
        }
    }
    Target::Local
}

/// Caminho do alvo para uma pasta **dentro** do projeto: pega a raiz local do projeto, mede o que
/// sobra e cola no caminho remoto. É o que o shim usa para traduzir o cwd herdado.
pub fn to_remote(target: &Target, project_root: &str, path: &str) -> Option<String> {
    let remote_root = target.remote_path()?;
    let raiz = project_root.replace('\\', "/");
    let caminho = path.replace('\\', "/");
    let raiz_corte = raiz.trim_end_matches('/');
    if !caminho.to_lowercase().starts_with(&raiz_corte.to_lowercase()) {
        // Fora do projeto: no WSL o disco do Windows aparece em /mnt/<letra>, e fora disso não há
        // tradução honesta — melhor devolver `None` e deixar quem chamou decidir.
        return match target {
            Target::Wsl { .. } => windows_para_mnt(&caminho),
            _ => None,
        };
    }
    let sufixo = caminho[raiz_corte.len()..].trim_start_matches('/');
    Some(join_posix(remote_root, sufixo))
}

/// `D:\dev\x` → `/mnt/d/dev/x`. Só faz sentido no WSL, que monta os discos do Windows assim.
fn windows_para_mnt(caminho: &str) -> Option<String> {
    let (letra, resto) = caminho.split_once(":/").or_else(|| caminho.split_once(':'))?;
    let letra = letra.chars().next()?.to_ascii_lowercase();
    if !letra.is_ascii_alphabetic() {
        return None;
    }
    Some(format!("/mnt/{letra}/{}", resto.trim_start_matches('/')))
}

fn join_posix(base: &str, sufixo: &str) -> String {
    let base = base.trim_end_matches('/');
    if sufixo.is_empty() {
        return if base.is_empty() { "/".into() } else { base.to_string() };
    }
    format!("{base}/{sufixo}")
}

/// Programa e argumentos que rodam `command` no alvo, a partir de `remote_cwd`.
///
/// O comando vai inteiro como **um** argumento para `bash -lc`: shell de login porque é o
/// `.bashrc`/`.profile` que põe `nvm`, `pyenv` e afins no PATH — sem isso o `npm` do projeto não
/// existe do lado de lá.
pub fn command_for(
    target: &Target,
    remote_cwd: &str,
    command: &str,
    connections: &[SshConnection],
) -> Option<(String, Vec<String>)> {
    match target {
        Target::Local => None,
        Target::Wsl { distro, .. } => Some((
            "wsl.exe".into(),
            vec![
                "-d".into(),
                distro.clone(),
                "--cd".into(),
                remote_cwd.to_string(),
                "--".into(),
                "bash".into(),
                "-lc".into(),
                command.to_string(),
            ],
        )),
        Target::Ssh { connection_id, .. } => {
            let connection = connections.iter().find(|item| &item.id == connection_id)?;
            let mut args = connection.ssh_args();
            args.push(format!("cd {} && {}", quote_posix(remote_cwd), command));
            Some(("ssh".into(), args))
        }
    }
}

/// Aspas simples no estilo POSIX, para o caminho não se quebrar em espaço nem virar glob.
pub fn quote_posix(value: &str) -> String {
    format!("'{}'", value.replace('\'', r"'\''"))
}

/// Lê o registro de conexões (`ssh.json` na pasta de dados do engine). Arquivo ausente ou corrompido
/// devolve lista vazia: "nenhuma conexão" é estado normal, não erro.
pub fn ssh_connections(dir: &Path) -> Vec<SshConnection> {
    #[derive(Deserialize)]
    struct Store {
        connections: Vec<SshConnection>,
    }
    std::fs::read(dir.join("ssh.json"))
        .ok()
        // Tira o BOM: o app grava sem ele, mas um arquivo editado à mão no Bloco de Notas (ou por
        // um script de PowerShell) vem com BOM, e aí o `serde_json` recusa o arquivo inteiro — o
        // sintoma seria o projeto remoto virar local sem avisar.
        .map(|bytes| match bytes.strip_prefix(&[0xEF, 0xBB, 0xBF]) {
            Some(resto) => resto.to_vec(),
            None => bytes,
        })
        .and_then(|bytes| serde_json::from_slice::<Store>(&bytes).ok())
        .map(|store| store.connections)
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn conexao() -> SshConnection {
        SshConnection {
            id: "srv1".into(),
            name: "Servidor".into(),
            host: "10.0.0.5".into(),
            port: 22,
            user: "ana".into(),
            key_path: String::new(),
            remote_path: "/srv/app".into(),
            drive: "X:".into(),
        }
    }

    #[test]
    fn reconhece_caminho_do_wsl_nas_duas_formas() {
        assert_eq!(
            resolve(r"\\wsl.localhost\Ubuntu\home\ana\proj", &[]),
            Target::Wsl { distro: "Ubuntu".into(), remote_path: "/home/ana/proj".into() }
        );
        assert_eq!(
            resolve("//wsl$/Debian/srv/app", &[]),
            Target::Wsl { distro: "Debian".into(), remote_path: "/srv/app".into() }
        );
        assert_eq!(
            resolve(r"\\wsl.localhost\Ubuntu", &[]),
            Target::Wsl { distro: "Ubuntu".into(), remote_path: "/".into() }
        );
    }

    /// O Git Bash colapsa `\\` ao passar a variável para um programa nativo: medido aqui,
    /// `\\wsl.localhost\Ubuntu\p` chega no shim como `\wsl.localhost\Ubuntu\p`. Sem aceitar a forma
    /// curta, o alvo virava "local" e o comando do agente rodava no Windows.
    #[test]
    fn aceita_unc_com_uma_barra_so() {
        assert_eq!(
            resolve(r"\wsl.localhost\Ubuntu\home\ana\proj", &[]),
            Target::Wsl { distro: "Ubuntu".into(), remote_path: "/home/ana/proj".into() }
        );
    }

    #[test]
    fn caminho_local_e_compartilhamento_comum_sao_locais() {
        assert_eq!(resolve(r"D:\dev\projeto", &[]), Target::Local);
        assert_eq!(resolve(r"\\servidor\compartilhado\proj", &[]), Target::Local);
    }

    #[test]
    fn unidade_montada_vira_alvo_ssh_com_o_caminho_remoto() {
        let conexoes = [conexao()];
        assert_eq!(
            resolve(r"X:\api", &conexoes),
            Target::Ssh { connection_id: "srv1".into(), remote_path: "/srv/app/api".into() }
        );
        // Outra unidade não é dessa conexão.
        assert_eq!(resolve(r"Y:\api", &conexoes), Target::Local);
    }

    #[test]
    fn traduz_pasta_dentro_do_projeto() {
        let alvo = Target::Wsl { distro: "Ubuntu".into(), remote_path: "/home/ana/proj".into() };
        let raiz = r"\\wsl.localhost\Ubuntu\home\ana\proj";
        assert_eq!(to_remote(&alvo, raiz, raiz).as_deref(), Some("/home/ana/proj"));
        assert_eq!(
            to_remote(&alvo, raiz, r"\\wsl.localhost\Ubuntu\home\ana\proj\src\lib").as_deref(),
            Some("/home/ana/proj/src/lib")
        );
        // Fora do projeto, o WSL ainda enxerga o disco do Windows em /mnt.
        assert_eq!(to_remote(&alvo, raiz, r"D:\dev\outro").as_deref(), Some("/mnt/d/dev/outro"));
    }

    #[test]
    fn monta_o_comando_de_cada_alvo() {
        let (programa, args) = command_for(
            &Target::Wsl { distro: "Ubuntu".into(), remote_path: "/home/ana/proj".into() },
            "/home/ana/proj/src",
            "npm test",
            &[],
        )
        .expect("wsl tem comando");
        assert_eq!(programa, "wsl.exe");
        assert_eq!(args, ["-d", "Ubuntu", "--cd", "/home/ana/proj/src", "--", "bash", "-lc", "npm test"]);

        let conexoes = [conexao()];
        let (programa, args) = command_for(
            &Target::Ssh { connection_id: "srv1".into(), remote_path: "/srv/app".into() },
            "/srv/app",
            "npm test",
            &conexoes,
        )
        .expect("ssh tem comando");
        assert_eq!(programa, "ssh");
        assert_eq!(args.last().unwrap(), "cd '/srv/app' && npm test");
        assert!(args.contains(&"BatchMode=yes".to_string()));
        assert!(args.contains(&"ana@10.0.0.5".to_string()));

        assert_eq!(command_for(&Target::Local, "/x", "ls", &[]), None);
    }

    #[test]
    fn projeto_local_nao_desvia_nada() {
        assert!(Target::Local.is_local());
        assert_eq!(to_remote(&Target::Local, r"D:\p", r"D:\p\src"), None);
    }

    #[test]
    fn registro_ssh_sobrevive_a_arquivo_com_bom() {
        let dir = std::env::temp_dir().join(format!("omni-ssh-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let json = serde_json::json!({ "connections": [ {
            "id": "srv1", "name": "S", "host": "h", "port": 22, "user": "u",
            "key_path": "", "remote_path": "/srv", "drive": "X:"
        } ] });
        let mut bytes = vec![0xEF, 0xBB, 0xBF];
        bytes.extend(serde_json::to_vec(&json).unwrap());
        std::fs::write(dir.join("ssh.json"), bytes).unwrap();
        assert_eq!(ssh_connections(&dir).len(), 1, "BOM nao pode zerar o registro");
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn aspas_protegem_caminho_com_espaco_e_apostrofo() {
        assert_eq!(quote_posix("/home/ana/meu projeto"), "'/home/ana/meu projeto'");
        assert_eq!(quote_posix("/home/d'ana"), r"'/home/d'\''ana'");
    }
}
