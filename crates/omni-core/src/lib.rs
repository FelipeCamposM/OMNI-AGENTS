//! Read-only provider data. Never reads authentication files or calls provider APIs.
pub mod cli_path;
pub mod modelos_claude;
pub mod usage;
pub mod conversations;
pub mod feed;
pub mod history;
pub mod runtime;
pub mod targets;
pub mod compartilhar;
pub mod extensoes;
pub mod relatorio;
pub mod agentes;
pub mod fluxos;
pub mod antigravity;
pub mod cursor;
pub mod comandos;
pub mod armazenamento;
pub mod mestra;
pub mod exportar;
pub mod subagentes;
pub mod roadmaps;
pub mod roadmaps_ia;

use serde::{Deserialize, Serialize};
use std::{fs, path::{Path, PathBuf}};

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Profile {
    pub id: String,
    pub provider: String,
    pub name: String,
    pub config_dir: String,
    #[serde(default)] pub builtin: bool,
    pub created_at_ms: u64,
    #[serde(default)] pub last_used_at_ms: Option<u64>,
    /// Calculado a cada leitura, nunca lido do `profiles.json`. Só `skip_deserializing` — com
    /// `skip` o campo também não chegava ao front, que via toda conta como "sem login" e deixava o
    /// failover sem nenhuma conta elegível. Falso não é serializado, então o arquivo segue limpo.
    #[serde(default, skip_deserializing, skip_serializing_if = "std::ops::Not::not")]
    pub authenticated: bool,
    /// E-mail da conta logada, para distinguir perfis. Mesma regra: calculado, nunca persistido.
    #[serde(default, skip_deserializing, skip_serializing_if = "Option::is_none")]
    pub email: Option<String>,
}

/// Env var que cada CLI lê para trocar de diretório de configuração. `None` = o provider não
/// suporta isolamento, então só existe o perfil padrão dele.
///
/// Mora aqui, e não só no lado Tauri, porque o engine também precisa montar o ambiente: uma sessão
/// aberta pelo celular nasce dentro do engine, com a janela do desktop possivelmente fechada.
pub fn config_dir_var(provider: &str) -> Option<&'static str> {
    match provider {
        "claude" => Some("CLAUDE_CONFIG_DIR"),
        "codex" => Some("CODEX_HOME"),
        _ => None,
    }
}

/// Variáveis que isolam a conta. Perfil `builtin` não sobrescreve nada: ele **é** o diretório
/// nativo do CLI, e apontar a env var para ele mudaria o comportamento padrão sem necessidade.
pub fn env_for(profile: &Profile) -> Vec<(String, String)> {
    let mut env = match config_dir_var(&profile.provider) {
        Some(variable) if !profile.builtin => vec![(variable.to_owned(), profile.config_dir.clone())],
        _ => Vec::new(),
    };
    // Login de 1 ano (`claude setup-token`): sem ele o login da conta expira e a CLI pede /login.
    if let Some(token) = token_longo(Path::new(&profile.config_dir)).filter(|_| profile.provider == "claude") {
        env.push(("CLAUDE_CODE_OAUTH_TOKEN".into(), token));
    }
    env
}

/// Arquivo, na pasta da conta Claude, com o token de longa duração que o `claude setup-token` gerou.
/// Fica junto do `.credentials.json` da própria CLI: mesma pasta, mesma proteção.
pub const TOKEN_LONGO: &str = ".omni-token-longo";

pub fn token_longo(config_dir: &Path) -> Option<String> {
    let token = fs::read_to_string(config_dir.join(TOKEN_LONGO)).ok()?;
    let token = token.trim();
    eh_token_longo(token).then(|| token.to_owned())
}

fn eh_token_longo(token: &str) -> bool {
    token.starts_with("sk-ant-oat") && token.len() >= 60 && token.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

/// Grava o token (temporário + rename). Devolve `false` quando já era esse.
pub fn guardar_token_longo(config_dir: &Path, token: &str) -> std::io::Result<bool> {
    if token_longo(config_dir).as_deref() == Some(token) { return Ok(false); }
    let temporario = config_dir.join(format!("{TOKEN_LONGO}.tmp"));
    fs::write(&temporario, token)?;
    fs::rename(&temporario, config_dir.join(TOKEN_LONGO))?;
    Ok(true)
}

/// Token na tela do `claude setup-token`. A TUI quebra a linha longa sozinha: os pedaços seguintes
/// entram enquanto a linha inteira for só caractere de token (a frase "Store this token…" não é).
pub fn token_na_tela(tela: &str) -> Option<String> {
    let parte_do_token = |c: char| c.is_ascii_alphanumeric() || c == '-' || c == '_';
    let mut linhas = tela.lines();
    let mut token = loop {
        let linha = linhas.next()?;
        if let Some(inicio) = linha.find("sk-ant-oat") {
            break linha[inicio..].chars().take_while(|&c| parte_do_token(c)).collect::<String>();
        }
    };
    for linha in linhas {
        let linha = linha.trim();
        if linha.is_empty() || !linha.chars().all(parte_do_token) { break; }
        token.push_str(linha);
    }
    eh_token_longo(&token).then_some(token)
}

#[cfg(test)]
mod token_longo_testes {
    #[test]
    fn acha_o_token_mesmo_quebrado_em_linhas() {
        let token = format!("sk-ant-oat01-{}", "aB3_-".repeat(20));
        let (a, b) = token.split_at(70);
        let tela = format!("✓ Long-lived authentication token created successfully!

Your OAuth token (valid for 1 year):

  {a}
  {b}

Store this token securely.
");
        assert_eq!(super::token_na_tela(&tela).as_deref(), Some(token.as_str()));
        assert_eq!(super::token_na_tela(&format!("  {token}
Store this token securely.")).as_deref(), Some(token.as_str()));
        assert_eq!(super::token_na_tela("Paste code here if prompted >"), None);
        assert_eq!(super::token_na_tela("sk-ant-oat01-curto"), None, "pedaço ainda chegando não vale");

        let dir = tempfile::tempdir().unwrap();
        assert!(super::guardar_token_longo(dir.path(), &token).unwrap());
        assert!(!super::guardar_token_longo(dir.path(), &token).unwrap());
        let perfil = crate::Profile { id:"c".into(),provider:"claude".into(),name:"C".into(),config_dir:dir.path().to_string_lossy().into_owned(),
            builtin:true,created_at_ms:0,last_used_at_ms:None,authenticated:false,email:None };
        assert_eq!(super::env_for(&perfil), vec![("CLAUDE_CODE_OAUTH_TOKEN".to_owned(), token.clone())]);
        let codex = crate::Profile { provider:"codex".into(), ..perfil };
        assert!(super::env_for(&codex).is_empty(), "token do Claude não vaza para outra CLI");
    }
}

pub fn profiles(dir: &Path) -> Vec<Profile> {
    #[derive(Deserialize)] struct Store { profiles: Vec<Profile> }
    fs::read(dir.join("profiles.json")).ok()
        .and_then(|bytes| serde_json::from_slice::<Store>(&bytes).ok())
        .map(|store| store.profiles).unwrap_or_default()
}

/// Only visit ordinary directories/files, never follow profile symlinks into other accounts.
pub fn rollouts(root: &Path) -> Vec<PathBuf> {
    fn visit(dir: &Path, depth: usize, found: &mut Vec<PathBuf>) {
        if depth > 4 { return; }
        let Ok(entries) = fs::read_dir(dir) else { return };
        for entry in entries.flatten() {
            let Ok(kind) = entry.file_type() else { continue };
            if kind.is_dir() { visit(&entry.path(), depth + 1, found); }
            else if kind.is_file() && entry.file_name().to_string_lossy().starts_with("rollout-") {
                let nome = entry.file_name().to_string_lossy().into_owned();
                // `.jsonl.zst` só quando o `.jsonl` sumiu: com os dois, seriam duas sessões iguais.
                if nome.ends_with(".jsonl") || (nome.ends_with(".jsonl.zst") && !entry.path().with_extension("").is_file()) {
                    found.push(entry.path());
                }
            }
        }
    }
    let mut found = Vec::new();
    visit(root, 0, &mut found);
    found
}

/// O `.jsonl.zst` que o Codex deixa no lugar do `.jsonl` antigo (`x.jsonl` → `x.jsonl.zst`).
pub fn compactado(path: &Path) -> PathBuf {
    let mut nome = path.as_os_str().to_owned();
    nome.push(".zst");
    PathBuf::from(nome)
}

/// O transcript existe, como `.jsonl` ou já compactado pelo Codex (`.jsonl.zst`). Checar só
/// `exists()` dava conversa Codex antiga por vazia: o caminho guardado é o `.jsonl` de antes.
pub fn transcript_existe(path: &Path) -> bool {
    path.exists() || compactado(path).exists()
}

/// Abre um transcript. `.jsonl.zst` (ou `.jsonl` que o Codex compactou) vira um `.jsonl` descompactado
/// numa pasta temporária: quem lê continua com `File` (seek, offset do feed) sem saber da compressão.
pub fn abrir(path: &Path) -> std::io::Result<fs::File> {
    let zst = if path.extension().is_some_and(|e| e == "zst") {
        path.to_path_buf()
    } else {
        match fs::File::open(path) {
            Err(erro) if erro.kind() == std::io::ErrorKind::NotFound && compactado(path).is_file() => compactado(path),
            outro => return outro,
        }
    };
    // O tamanho no nome: a mesma sessão copiada para outra conta não reaproveita um cache diferente.
    let tamanho = fs::metadata(&zst)?.len();
    let pasta = std::env::temp_dir().join("omni-agents-zst");
    let cache = pasta.join(format!("{tamanho}-{}", zst.file_stem().unwrap_or_default().to_string_lossy()));
    if !cache.is_file() {
        fs::create_dir_all(&pasta)?;
        let parcial = cache.with_extension("parcial");
        let mut entrada = std::io::BufReader::new(fs::File::open(&zst)?);
        let mut saida = fs::File::create(&parcial)?;
        // Um frame por vez: arquivo com vários frames emendados também abre inteiro.
        while !std::io::BufRead::fill_buf(&mut entrada)?.is_empty() {
            let mut frame = ruzstd::decoding::StreamingDecoder::new(&mut entrada).map_err(std::io::Error::other)?;
            std::io::copy(&mut frame, &mut saida)?;
        }
        drop(saida);
        fs::rename(&parcial, &cache)?;
    }
    fs::File::open(cache)
}

#[cfg(test)]
mod zst_testes {
    #[test]
    fn rollout_compactado_e_lido_e_listado_no_lugar_do_jsonl() {
        let dir = tempfile::tempdir().unwrap();
        let jsonl = dir.path().join("rollout-x.jsonl");
        let zst = super::compactado(&jsonl);
        std::fs::write(&zst, ruzstd::encoding::compress_to_vec(&b"{\"a\":1}
"[..], ruzstd::encoding::CompressionLevel::Fastest)).unwrap();
        let mut texto = String::new();
        std::io::Read::read_to_string(&mut super::abrir(&jsonl).unwrap(), &mut texto).unwrap();
        assert_eq!(texto, "{\"a\":1}
");
        assert_eq!(super::rollouts(dir.path()), vec![zst.clone()]);
        std::fs::write(&jsonl, "{}").unwrap();
        assert_eq!(super::rollouts(dir.path()), vec![jsonl], "com os dois, só o jsonl");
    }

    /// Rollout `.zst` de verdade do Codex desta máquina, se houver: abre e a primeira linha é o `session_meta`.
    #[test]
    #[ignore]
    fn sonda_rollout_zst_real() {
        let home = std::env::var("USERPROFILE").unwrap();
        let zst = super::rollouts(&std::path::Path::new(&home).join(".codex/sessions")).into_iter()
            .find(|p| p.extension().is_some_and(|e| e == "zst")).expect("nenhum .zst");
        let primeira = std::io::BufRead::lines(std::io::BufReader::new(super::abrir(&zst).unwrap())).next().unwrap().unwrap();
        assert!(primeira.contains("\"session_meta\""), "{zst:?}");
    }
}
