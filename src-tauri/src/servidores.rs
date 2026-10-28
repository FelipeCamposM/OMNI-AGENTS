//! Servidores locais de projeto (`npm run dev`, Vite, Next, Django…) rodando no PC, com o botão de
//! derrubar. Do netstat inteiro sobra só o que é processo de dev (node, python…) rodando um script
//! de dentro de uma pasta de projeto: sistema, apps instalados (Spotify, Docker, Discord) e
//! ferramentas globais (`AppData`, `Program Files`, extensões do VS Code) ficam de fora.
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::process::Command;

use crate::git_client::hidden;

/// Uma leitura: portas em escuta com o dono e a tabela de processos. Um PowerShell só (~1 s).
const LEITURA: &str = "[Console]::OutputEncoding=[Text.Encoding]::UTF8;\
$c=@(Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue | % { @{p=[int]$_.LocalPort;pid=[int]$_.OwningProcess} });\
$p=@(Get-CimInstance Win32_Process | % { @{pid=[int]$_.ProcessId;nome=$_.Name;cmd=$_.CommandLine} });\
@{c=$c;p=$p} | ConvertTo-Json -Compress -Depth 3";

const PROGRAMAS_DE_DEV: &[&str] = &["node", "bun", "deno", "python", "pythonw", "php", "ruby", "java", "dotnet", "go", "cargo", "uvicorn"];
/// Caminho de programa instalado ou ferramenta global, não de projeto. Vale por trecho do comando:
/// o `node.exe` mora em `Program Files`, mas o script que ele roda está na pasta do projeto.
const FORA_DE_PROJETO: &[&str] = &["\\program files", "\\appdata\\", "\\.vscode", "npm-cache", "\\_npx", "\\windows\\"];
const MARCAS_DE_PROJETO: &[&str] = &["package.json", "pyproject.toml", "requirements.txt", "manage.py", "Cargo.toml", "go.mod", "composer.json", "Gemfile", "deno.json"];

#[derive(Deserialize)]
struct Escuta { p: u16, pid: u32 }
#[derive(Deserialize)]
struct Processo { pid: u32, nome: Option<String>, cmd: Option<String> }
#[derive(Deserialize)]
struct Leitura { c: Vec<Escuta>, p: Vec<Processo> }

/// Um projeto com servidor de pé. Agrupado por pasta: o Next abre duas portas, o Vite às vezes também.
#[derive(Debug, Serialize, PartialEq)]
pub struct Servidor {
    pub pasta: String,
    pub nome: String,
    pub tipo: String,
    pub portas: Vec<u16>,
    pub pids: Vec<u32>,
    pub comando: String,
    /// É o próprio OMNI rodando em `npm run dev`: derrubar fecharia esta janela.
    pub proprio: bool,
}

/// Pasta do projeto a partir da linha de comando: o primeiro caminho absoluto fora de programa
/// instalado, cortado antes de `node_modules`, subindo até achar `package.json` (ou parecido).
fn projeto_do_comando(cmd: &str, existe: &impl Fn(&Path) -> bool) -> Option<PathBuf> {
    let mut trechos = Vec::new();
    for (i, parte) in cmd.split('"').enumerate() {
        if i % 2 == 1 { trechos.push(parte.to_owned()); } else { trechos.extend(parte.split_whitespace().map(str::to_owned)); }
    }
    trechos.iter().find_map(|trecho| {
        let caminho = trecho.rsplit('=').next()?.replace('/', "\\");
        let b = caminho.as_bytes();
        if b.len() < 4 || b[1] != b':' || b[2] != b'\\' { return None; }
        let minusculo = caminho.to_lowercase();
        if FORA_DE_PROJETO.iter().any(|marca| minusculo.contains(marca)) { return None; }
        let base = minusculo.find("\\node_modules\\").map_or(caminho.as_str(), |i| &caminho[..i]);
        Path::new(base).ancestors().take(6).find(|pasta| MARCAS_DE_PROJETO.iter().any(|m| existe(&pasta.join(m)))).map(Path::to_path_buf)
    })
}

fn tipo(cmd: &str, programa: &str) -> String {
    let cmd = cmd.to_lowercase().replace('/', "\\");
    let conhecidos = [("storybook", "Storybook"), ("\\vite\\", "Vite"), ("\\next\\", "Next"), ("next@", "Next"), ("\\nuxt", "Nuxt"),
        ("\\astro\\", "Astro"), ("webpack", "Webpack"), ("react-scripts", "Create React App"), ("manage.py", "Django"),
        ("uvicorn", "Uvicorn"), ("flask", "Flask")];
    conhecidos.iter().find(|(marca, _)| cmd.contains(marca)).map_or_else(|| programa.to_owned(), |(_, nome)| (*nome).to_owned())
}

fn classificar(leitura: Leitura, existe: impl Fn(&Path) -> bool, onde_estou: Option<&Path>) -> Vec<Servidor> {
    let processos: BTreeMap<u32, Processo> = leitura.p.into_iter().map(|p| (p.pid, p)).collect();
    let mut grupos: BTreeMap<PathBuf, Servidor> = BTreeMap::new();
    for escuta in leitura.c.iter().filter(|e| e.p > 1024) {
        let Some(processo) = processos.get(&escuta.pid) else { continue };
        let programa = processo.nome.as_deref().unwrap_or_default().to_lowercase();
        let programa = programa.trim_end_matches(".exe");
        let cmd = processo.cmd.as_deref().unwrap_or_default();
        if !PROGRAMAS_DE_DEV.contains(&programa) { continue; }
        let Some(pasta) = projeto_do_comando(cmd, &existe) else { continue };
        let servidor = grupos.entry(pasta.clone()).or_insert_with(|| Servidor {
            pasta: pasta.display().to_string(),
            nome: pasta.file_name().map_or_else(|| pasta.display().to_string(), |n| n.to_string_lossy().into_owned()),
            tipo: tipo(cmd, programa),
            portas: vec![],
            pids: vec![],
            comando: cmd.to_owned(),
            proprio: onde_estou.is_some_and(|eu| eu.starts_with(&pasta)),
        });
        if !servidor.portas.contains(&escuta.p) { servidor.portas.push(escuta.p); }
        if !servidor.pids.contains(&escuta.pid) { servidor.pids.push(escuta.pid); }
    }
    let mut lista: Vec<Servidor> = grupos.into_values().collect();
    for servidor in &mut lista { servidor.portas.sort_unstable(); }
    lista.sort_by_key(|s| s.portas[0]);
    lista
}

fn ler() -> Result<Vec<Servidor>, String> {
    let saida = hidden(&mut Command::new("powershell"))
        .args(["-NoProfile", "-NonInteractive", "-Command", LEITURA])
        .output()
        .map_err(|erro| format!("PowerShell indisponível: {erro}"))?;
    if !saida.status.success() { return Err(String::from_utf8_lossy(&saida.stderr).trim().to_owned()); }
    let texto = String::from_utf8_lossy(&saida.stdout);
    let leitura: Leitura = serde_json::from_str(texto.trim_start_matches('\u{feff}').trim())
        .map_err(|erro| format!("Leitura das portas falhou: {erro}"))?;
    let eu = std::env::current_exe().ok();
    Ok(classificar(leitura, |p| p.exists(), eu.as_deref()))
}

#[tauri::command]
pub async fn servidores_locais() -> Result<Vec<Servidor>, String> {
    tauri::async_runtime::spawn_blocking(ler).await.map_err(|erro| erro.to_string())?
}

/// Derruba o servidor da pasta. Recebe a pasta, não PIDs: a lista é lida de novo aqui, então só
/// morre o que de fato é servidor de projeto agora — nunca um PID qualquer vindo da tela.
/// `/T` leva a árvore junto (`npm` → `cmd` → `node`); sem ele a porta ficava presa.
#[tauri::command]
pub async fn servidor_matar(pasta: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let servidor = ler()?.into_iter().find(|s| s.pasta == pasta).ok_or("O servidor já não está rodando.")?;
        if servidor.proprio { return Err("Este é o próprio OMNI AGENTS em desenvolvimento.".into()); }
        for pid in servidor.pids {
            let saida = hidden(&mut Command::new("taskkill")).args(["/PID", &pid.to_string(), "/T", "/F"]).output()
                .map_err(|erro| erro.to_string())?;
            if !saida.status.success() { return Err(String::from_utf8_lossy(&saida.stderr).trim().to_owned()); }
        }
        Ok(())
    })
    .await
    .map_err(|erro| erro.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Diagnóstico: `cargo test servidores_deste_pc -- --ignored --nocapture` lista o que o painel mostraria.
    #[test]
    #[ignore]
    fn servidores_deste_pc() {
        for s in ler().unwrap() { println!("{:?}", (s.nome, s.tipo, s.portas, s.proprio, s.pasta)); }
    }

    /// Leitura de verdade (portas e comandos copiados de um PC real), encurtada.
    #[test]
    fn sobra_so_servidor_de_projeto_agrupado_por_pasta() {
        let json = r#"{"c":[
            {"p":1520,"pid":10},{"p":3300,"pid":11},{"p":60785,"pid":11},{"p":135,"pid":12},
            {"p":57621,"pid":13},{"p":6333,"pid":14},{"p":9229,"pid":15},{"p":1420,"pid":16}],
          "p":[
            {"pid":10,"nome":"node.exe","cmd":"\"node\"   \"D:\\P\\SIAPLUS\\node_modules\\.bin\\\\..\\vite\\bin\\vite.js\""},
            {"pid":11,"nome":"node.exe","cmd":"\"C:\\Program Files\\nodejs\\node.exe\" D:\\P\\STUDYRATS\\node_modules\\.pnpm\\next@16\\node_modules\\next\\dist\\server\\lib\\start-server.js"},
            {"pid":12,"nome":"svchost.exe","cmd":null},
            {"pid":13,"nome":"Spotify.exe","cmd":"Spotify.exe --autostart"},
            {"pid":14,"nome":"node.exe","cmd":"\"C:\\Users\\F\\AppData\\Roaming\\npm\\node_modules\\x\\cli.js\""},
            {"pid":15,"nome":"node.exe","cmd":"node --inspect"},
            {"pid":16,"nome":"node.exe","cmd":"node D:\\P\\OMNI\\node_modules\\vite\\bin\\vite.js"}]}"#;
        let leitura: Leitura = serde_json::from_str(json).unwrap();
        let projetos = ["D:\\P\\SIAPLUS", "D:\\P\\STUDYRATS", "D:\\P\\OMNI", "C:\\Users\\F\\AppData\\Roaming\\npm\\node_modules\\x"];
        let existe = |p: &Path| projetos.iter().any(|d| Path::new(d).join("package.json") == p);
        let lista = classificar(leitura, existe, Some(Path::new("D:\\P\\OMNI\\src-tauri\\target\\debug\\omni.exe")));
        let resumo: Vec<_> = lista.iter().map(|s| (s.nome.as_str(), s.tipo.as_str(), s.portas.clone(), s.proprio)).collect();
        assert_eq!(resumo, vec![
            ("OMNI", "Vite", vec![1420], true),
            ("SIAPLUS", "Vite", vec![1520], false),
            ("STUDYRATS", "Next", vec![3300, 60785], false),
        ]);
    }
}
