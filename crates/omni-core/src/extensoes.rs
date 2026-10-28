//! MCPs, plugins e conectores de cada IA, por conta — a aba Extensões das Configurações.
//!
//! Só leitura, direto dos arquivos que cada CLI grava (o OMNI não guarda cópia):
//!
//! | IA     | MCPs                                                        | Plugins                                   | Conectores                        |
//! |--------|-------------------------------------------------------------|-------------------------------------------|-----------------------------------|
//! | Claude | `.claude.json` (global e por pasta) + `.mcp.json` do projeto | `settings.json` + `plugins/installed_plugins.json` | `claudeAiMcpEverConnected` |
//! | Codex  | `config.toml` → `[mcp_servers.*]`                           | `config.toml` → `[plugins.*]`             | —                                 |
//! | Cursor | `mcp.json` + `.cursor/mcp.json` do projeto                  | `plugins/local/*`                         | —                                 |
//!
//! **Nada de segredo sai daqui.** Variáveis de ambiente e cabeçalhos vão só pelo nome; URL perde a
//! query e o usuário/senha; argumento de comando com cara de chave vira `•••`. É isso que deixa a
//! tela segura para abrir com alguém olhando — e para um print.

use serde::Serialize;
use serde_json::Value;
use std::path::{Path, PathBuf};

#[derive(Debug, Serialize, PartialEq)]
pub struct Mcp {
    nome: String,
    /// `global` (vale em todo projeto), `pasta` (só numa pasta, só para você — o "local" do Claude)
    /// ou `projeto` (arquivo dentro do projeto, vai junto no git).
    escopo: &'static str,
    /// `stdio`, `http` ou `sse`.
    tipo: String,
    /// Comando (com argumentos sensíveis mascarados) ou URL sem query.
    destino: String,
    /// Nomes das variáveis de ambiente e dos cabeçalhos — nunca os valores.
    variaveis: Vec<String>,
    ativo: bool,
    /// Pasta à qual o MCP se aplica, no escopo `pasta`.
    pasta: Option<String>,
    arquivo: String,
}

#[derive(Debug, Serialize, PartialEq)]
pub struct Plugin {
    nome: String,
    origem: Option<String>,
    ativo: bool,
    versao: Option<String>,
    escopo: Option<String>,
    arquivo: String,
    /// Logo do pacote em `data:` URI (o manifesto aponta um arquivo que já veio baixado). Vai embutido
    /// para valer igual no app e na web, sem liberar a pasta do plugin no asset protocol.
    #[serde(skip_serializing_if = "Option::is_none")]
    logo: Option<String>,
    /// Site do plugin no manifesto (homepage, repositório ou autor, sem query): a tela busca o ícone
    /// dele quando o pacote não traz logo.
    #[serde(skip_serializing_if = "Option::is_none")]
    site: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct ExtensoesDaConta {
    provider: String,
    conta_id: String,
    conta_nome: String,
    /// A conta nativa da CLI — é dela que as extras recebem as extensões.
    principal: bool,
    mcps: Vec<Mcp>,
    plugins: Vec<Plugin>,
    /// Conectores do claude.ai que já conectaram nesta conta (Gmail, Drive, Notion…).
    conectores: Vec<String>,
    /// Arquivos onde as extensões desta conta moram (para o "onde fica").
    arquivos: Vec<String>,
}

/// Extensões de todas as contas cadastradas em `dir` (a pasta do engine, onde mora o `profiles.json`).
pub fn listar(dir: &Path, projeto: Option<&Path>) -> Vec<ExtensoesDaConta> {
    let projeto = projeto.map(Path::to_path_buf).filter(|p| p.is_dir());
    let principais = crate::compartilhar::principais(dir);
    crate::profiles(dir)
        .into_iter()
        .filter_map(|perfil| {
            let dir = PathBuf::from(&perfil.config_dir);
            let mut conta = ExtensoesDaConta {
                provider: perfil.provider.clone(),
                conta_id: perfil.id.clone(),
                conta_nome: perfil.name.clone(),
                principal: principais.get(&perfil.provider).and_then(serde_json::Value::as_str) == Some(perfil.id.as_str()),
                mcps: Vec::new(),
                plugins: Vec::new(),
                conectores: Vec::new(),
                arquivos: Vec::new(),
            };
            match perfil.provider.as_str() {
                "claude" => {
                    let estado = crate::usage::claude_state_path(&perfil);
                    claude(&mut conta, &estado, &dir, projeto.as_deref());
                }
                "codex" => codex(&mut conta, &dir.join("config.toml")),
                "cursor" => cursor(&mut conta, &dir, projeto.as_deref()),
                _ => return None,
            }
            Some(conta)
        })
        .collect()
}

fn ler_json(caminho: &Path) -> Option<Value> {
    serde_json::from_str(&std::fs::read_to_string(caminho).ok()?).ok()
}

fn texto(caminho: &Path) -> String {
    caminho.to_string_lossy().into_owned()
}

/* ── Claude ───────────────────────────────────────────────────────────────────────────────── */

fn claude(conta: &mut ExtensoesDaConta, estado: &Path, dir: &Path, projeto: Option<&Path>) {
    conta.arquivos.push(texto(estado));
    if let Some(dados) = ler_json(estado) {
        mcps_do_json(&mut conta.mcps, dados.get("mcpServers"), "global", None, estado);
        if let Some(pastas) = dados.get("projects").and_then(Value::as_object) {
            for (pasta, config) in pastas {
                mcps_do_json(&mut conta.mcps, config.get("mcpServers"), "pasta", Some(pasta.clone()), estado);
            }
        }
        conta.conectores = dados.get("claudeAiMcpEverConnected").and_then(Value::as_array).into_iter().flatten()
            .filter_map(Value::as_str)
            .map(|nome| nome.trim_start_matches("claude.ai ").to_owned())
            .collect();
    }
    if let Some(projeto) = projeto {
        let arquivo = projeto.join(".mcp.json");
        if let Some(dados) = ler_json(&arquivo) {
            conta.arquivos.push(texto(&arquivo));
            mcps_do_json(&mut conta.mcps, dados.get("mcpServers"), "projeto", None, &arquivo);
        }
    }

    // Instalados (com versão e escopo) cruzados com os ligados no settings.json.
    let settings = dir.join("settings.json");
    let instalados = dir.join("plugins").join("installed_plugins.json");
    conta.arquivos.push(texto(&settings));
    let mut ligados = ler_json(&settings).and_then(|s| s.get("enabledPlugins").cloned()).unwrap_or(Value::Null);
    // Plugin de escopo projeto é ligado no `.claude/settings*.json` do próprio projeto — e esse vence.
    if let Some(projeto) = projeto {
        for nome in ["settings.json", "settings.local.json"] {
            let arquivo = projeto.join(".claude").join(nome);
            if let Some(Value::Object(doProjeto)) = ler_json(&arquivo).and_then(|s| s.get("enabledPlugins").cloned()) {
                conta.arquivos.push(texto(&arquivo));
                let base = ligados.as_object().cloned().unwrap_or_default();
                ligados = Value::Object(base.into_iter().chain(doProjeto).collect());
            }
        }
    }
    let mut vistos = std::collections::BTreeSet::new();
    if let Some(lista) = ler_json(&instalados).and_then(|d| d.get("plugins").cloned()).and_then(|p| p.as_object().cloned()) {
        conta.arquivos.push(texto(&instalados));
        for (id, instalacoes) in lista {
            let primeira = instalacoes.as_array().and_then(|l| l.first()).cloned().unwrap_or(Value::Null);
            let mut plugin = plugin_claude(&id, ligados.get(&id).and_then(Value::as_bool).unwrap_or(false),
                primeira.get("version").and_then(Value::as_str), primeira.get("scope").and_then(Value::as_str), &instalados);
            if let Some(pasta) = primeira.get("installPath").and_then(Value::as_str).map(Path::new) {
                plugin.logo = logo_do_pacote(pasta);
                plugin.site = site_do_pacote(pasta);
            }
            conta.plugins.push(plugin);
            vistos.insert(id);
        }
    }
    // Ligado no settings mas sem registro de instalação (instalado por outro caminho).
    if let Some(mapa) = ligados.as_object() {
        for (id, ligado) in mapa {
            if !vistos.contains(id) {
                conta.plugins.push(plugin_claude(id, ligado.as_bool().unwrap_or(false), None, None, &settings));
            }
        }
    }
    conta.plugins.sort_by(|a, b| b.ativo.cmp(&a.ativo).then(a.nome.cmp(&b.nome)));
}

fn plugin_claude(id: &str, ativo: bool, versao: Option<&str>, escopo: Option<&str>, arquivo: &Path) -> Plugin {
    let (nome, origem) = id.split_once('@').map_or((id, None), |(n, o)| (n, Some(o.to_owned())));
    Plugin { nome: nome.to_owned(), origem, ativo, versao: versao.map(str::to_owned), escopo: escopo.map(str::to_owned), arquivo: texto(arquivo), logo: None, site: None }
}

/* ── Codex ────────────────────────────────────────────────────────────────────────────────── */

fn codex(conta: &mut ExtensoesDaConta, arquivo: &Path) {
    conta.arquivos.push(texto(arquivo));
    let Some(config) = std::fs::read_to_string(arquivo).ok().and_then(|t| t.parse::<toml::Table>().ok()) else { return };
    if let Some(servidores) = config.get("mcp_servers").and_then(toml::Value::as_table) {
        for (nome, srv) in servidores {
            let Some(srv) = srv.as_table() else { continue };
            let url = srv.get("url").and_then(toml::Value::as_str);
            let mut variaveis: Vec<String> = srv.get("env").and_then(toml::Value::as_table).map(|e| e.keys().cloned().collect()).unwrap_or_default();
            variaveis.extend(srv.get("http_headers").and_then(toml::Value::as_table).map(|h| h.keys().cloned().collect::<Vec<_>>()).unwrap_or_default());
            if let Some(token) = srv.get("bearer_token_env_var").and_then(toml::Value::as_str) { variaveis.push(token.to_owned()); }
            let args: Vec<String> = srv.get("args").and_then(toml::Value::as_array).into_iter().flatten()
                .filter_map(|a| a.as_str().map(str::to_owned)).collect();
            conta.mcps.push(Mcp {
                nome: nome.clone(),
                escopo: "global",
                tipo: if url.is_some() { "http".into() } else { "stdio".into() },
                destino: match url {
                    Some(url) => url_segura(url),
                    None => comando_seguro(srv.get("command").and_then(toml::Value::as_str).unwrap_or(""), &args),
                },
                variaveis,
                ativo: srv.get("enabled").and_then(toml::Value::as_bool).unwrap_or(true),
                pasta: None,
                arquivo: texto(arquivo),
            });
        }
    }
    if let Some(plugins) = config.get("plugins").and_then(toml::Value::as_table) {
        for (id, cfg) in plugins {
            let (nome, origem) = id.split_once('@').map_or((id.as_str(), None), |(n, o)| (n, Some(o.to_owned())));
            // `plugins/cache/<marketplace>/<nome>/<versão>/`: a versão mais nova que estiver lá.
            let mut versoes: Vec<PathBuf> = origem.as_deref().and_then(|o| {
                let base = arquivo.parent()?.join("plugins").join("cache").join(o).join(nome);
                Some(std::fs::read_dir(&base).ok()?.flatten().map(|e| e.path()).filter(|p| p.is_dir()).collect())
            }).unwrap_or_default();
            versoes.sort();
            let logo = versoes.iter().rev().find_map(|v| logo_do_pacote(v));
            let site = versoes.iter().rev().find_map(|v| site_do_pacote(v));
            conta.plugins.push(Plugin {
                nome: nome.to_owned(),
                origem,
                ativo: cfg.get("enabled").and_then(toml::Value::as_bool).unwrap_or(true),
                versao: None,
                escopo: None,
                arquivo: texto(arquivo),
                logo,
                site,
            });
        }
        conta.plugins.sort_by(|a, b| b.ativo.cmp(&a.ativo).then(a.nome.cmp(&b.nome)));
    }
}

/* ── Cursor ───────────────────────────────────────────────────────────────────────────────── */

fn cursor(conta: &mut ExtensoesDaConta, dir: &Path, projeto: Option<&Path>) {
    let global = dir.join("mcp.json");
    conta.arquivos.push(texto(&global));
    if let Some(dados) = ler_json(&global) {
        mcps_do_json(&mut conta.mcps, dados.get("mcpServers"), "global", None, &global);
    }
    if let Some(projeto) = projeto {
        let arquivo = projeto.join(".cursor").join("mcp.json");
        if let Some(dados) = ler_json(&arquivo) {
            conta.arquivos.push(texto(&arquivo));
            mcps_do_json(&mut conta.mcps, dados.get("mcpServers"), "projeto", None, &arquivo);
        }
    }
    let locais = dir.join("plugins").join("local");
    if let Ok(entradas) = std::fs::read_dir(&locais) {
        for entrada in entradas.flatten().filter(|e| e.path().is_dir()) {
            conta.plugins.push(Plugin {
                nome: entrada.file_name().to_string_lossy().into_owned(),
                origem: Some("local".into()),
                ativo: true,
                versao: None,
                escopo: None,
                arquivo: texto(&entrada.path()),
                logo: logo_do_pacote(&entrada.path()),
                site: site_do_pacote(&entrada.path()),
            });
        }
    }
}

/* ── Comum ────────────────────────────────────────────────────────────────────────────────── */

const LOGO_MAX: u64 = 256 * 1024;

/// Logo de um pacote de plugin: o `logo`/`icon` de qualquer manifesto dele (o do Claude não tem o
/// campo, mas o mesmo pacote costuma trazer o de Cursor/Codex) ou, sem isso, um `logo*`/`icon*` na
/// raiz ou em `assets/`. Só imagem, só dentro da pasta do pacote e até `LOGO_MAX`: o manifesto é de
/// terceiro e não pode servir para ler arquivo de fora.
pub(crate) fn logo_do_pacote(pasta: &Path) -> Option<String> {
    let raiz = pasta.canonicalize().ok()?;
    let manifestos: Vec<Value> = [".claude-plugin", ".cursor-plugin", ".codex-plugin"].iter()
        .filter_map(|m| ler_json(&raiz.join(m).join("plugin.json"))).collect();
    let do_manifesto = manifestos.iter().find_map(campo_de_logo).map(|rel| raiz.join(rel.trim_start_matches("./")));
    // `assets/caveman-small.svg`: imagem com o nome do plugin também é o logo dele.
    let nome = manifestos.iter().find_map(|m| m.get("name").and_then(Value::as_str)).unwrap_or("").to_lowercase();
    let solto = || {
        let mut achados: Vec<PathBuf> = [raiz.clone(), raiz.join("assets")].iter()
            .filter_map(|d| std::fs::read_dir(d).ok()).flatten().flatten().map(|e| e.path())
            .filter(|p| {
                let arquivo = p.file_name().map(|n| n.to_string_lossy().to_lowercase()).unwrap_or_default();
                (arquivo.starts_with("logo") || arquivo.starts_with("icon") || arquivo.contains(" icon") || (nome.len() > 2 && arquivo.starts_with(&nome)))
                    && tipo_de_imagem(p).is_some()
            })
            .collect();
        // Versão colorida antes da escura/monocromática.
        achados.sort_by_key(|p| { let n = p.to_string_lossy().to_lowercase(); (["dark", "mono", "black"].iter().any(|x| n.contains(x)), n) });
        achados.into_iter().next()
    };
    let arquivo = do_manifesto.filter(|p| p.is_file()).or_else(solto)?.canonicalize().ok()?;
    if !arquivo.starts_with(&raiz) || std::fs::metadata(&arquivo).ok()?.len() > LOGO_MAX { return None; }
    let tipo = tipo_de_imagem(&arquivo)?;
    use base64::Engine as _;
    Some(format!("data:{tipo};base64,{}", base64::engine::general_purpose::STANDARD.encode(std::fs::read(&arquivo).ok()?)))
}

/// `logo`, `icon` ou `composerIcon`, no topo ou dentro de um objeto (o Codex aninha em `interface`).
fn campo_de_logo(v: &Value) -> Option<String> {
    let obj = v.as_object()?;
    ["logo", "icon", "composerIcon"].iter().find_map(|k| obj.get(*k).and_then(Value::as_str).map(str::to_owned))
        .or_else(|| obj.values().find_map(campo_de_logo))
}

fn tipo_de_imagem(p: &Path) -> Option<&'static str> {
    match p.extension()?.to_string_lossy().to_lowercase().as_str() {
        "svg" => Some("image/svg+xml"), "png" => Some("image/png"), "jpg" | "jpeg" => Some("image/jpeg"), "webp" => Some("image/webp"),
        _ => None,
    }
}

/// `mcpServers` no formato JSON que Claude e Cursor compartilham.
fn mcps_do_json(saida: &mut Vec<Mcp>, servidores: Option<&Value>, escopo: &'static str, pasta: Option<String>, arquivo: &Path) {
    let Some(servidores) = servidores.and_then(Value::as_object) else { return };
    for (nome, srv) in servidores {
        let url = srv.get("url").and_then(Value::as_str);
        let tipo = srv.get("type").and_then(Value::as_str).map(str::to_owned)
            .unwrap_or_else(|| if url.is_some() { "http".into() } else { "stdio".into() });
        let nomes = |campo: &str| srv.get(campo).and_then(Value::as_object).map(|m| m.keys().cloned().collect::<Vec<_>>()).unwrap_or_default();
        let mut variaveis = nomes("env");
        variaveis.extend(nomes("headers"));
        let args: Vec<String> = srv.get("args").and_then(Value::as_array).into_iter().flatten()
            .filter_map(|a| a.as_str().map(str::to_owned)).collect();
        saida.push(Mcp {
            nome: nome.clone(),
            escopo,
            tipo,
            destino: match url {
                Some(url) => url_segura(url),
                None => comando_seguro(srv.get("command").and_then(Value::as_str).unwrap_or(""), &args),
            },
            variaveis,
            ativo: !srv.get("disabled").and_then(Value::as_bool).unwrap_or(false),
            pasta: pasta.clone(),
            arquivo: texto(arquivo),
        });
    }
}

/* ── Ícones salvos ─────────────────────────────────────────────────────────────────────────── */

// O app do PC busca o ícone de cada extensão na rede (`src-tauri/src/icones_remotos.rs`) e salva a
// imagem em `<engine>/icones/`; `nomes.json` liga a chave por nome (`mcp:stitch`, `plugin:vercel`,
// `conector:gmail`) ao arquivo. É por essa chave que a conversa acha o ícone de uma ferramenta
// (`mcp__stitch__…`), no PC, na web e no celular.

const ICONES_TIPOS: &[(&str, &str)] = &[
    ("png", "image/png"), ("svg", "image/svg+xml"), ("ico", "image/x-icon"), ("jpg", "image/jpeg"),
    ("gif", "image/gif"), ("webp", "image/webp"),
];

/// Chave por nome de uma extensão da aba Extensões: `destino` `conector:<nome>` é conector, `pacote:…`
/// é plugin, o resto é MCP. Minúsculas e sem o "claude.ai " que alguns conectores trazem.
pub fn chave_do_icone(destino: &str, nome: &str) -> String {
    let limpo = |n: &str| n.trim().trim_start_matches("claude.ai").trim().to_lowercase();
    if let Some(conector) = destino.strip_prefix("conector:") { return format!("conector:{}", limpo(conector)); }
    if destino.starts_with("pacote:") { return format!("plugin:{}", limpo(nome)); }
    format!("mcp:{}", limpo(nome))
}

fn indice_de_icones(dir: &Path) -> PathBuf {
    dir.join("icones").join("nomes.json")
}

/// Registra que a extensão `chave` tem o ícone `arquivo` (nome dentro de `icones/`).
pub fn guardar_nome_do_icone(dir: &Path, chave: &str, arquivo: &str) {
    let caminho = indice_de_icones(dir);
    let mut indice = ler_json(&caminho).and_then(|v| v.as_object().cloned()).unwrap_or_default();
    if indice.get(chave).and_then(Value::as_str) == Some(arquivo) { return; }
    indice.insert(chave.to_owned(), Value::String(arquivo.to_owned()));
    if let Ok(json) = serde_json::to_vec_pretty(&indice) {
        let _ = std::fs::write(caminho, json);
    }
}

/// Ícone já conhecido de uma extensão pela chave: o salvo em `icones/` ou, de plugin, o logo do
/// pacote. Não vai à rede (quem busca é o app do PC).
pub fn icone_conhecido(dir: &Path, chave: &str) -> Option<String> {
    let salvo = ler_json(&indice_de_icones(dir)).and_then(|v| v.get(chave)?.as_str().map(str::to_owned)).and_then(|arquivo| {
        // O índice é nosso, mas o nome vira caminho: nada de subir de pasta.
        if arquivo.contains(['/', '\\']) || arquivo.contains("..") { return None; }
        let ext = arquivo.rsplit_once('.')?.1.to_owned();
        let tipo = ICONES_TIPOS.iter().find(|(e, _)| *e == ext)?.1;
        let bytes = std::fs::read(dir.join("icones").join(&arquivo)).ok()?;
        use base64::Engine as _;
        Some(format!("data:{tipo};base64,{}", base64::engine::general_purpose::STANDARD.encode(bytes)))
    });
    salvo.or_else(|| {
        let nome = chave.strip_prefix("plugin:")?;
        listar(dir, None).into_iter().flat_map(|c| c.plugins).find(|p| p.nome.to_lowercase() == nome).and_then(|p| p.logo)
    })
}

/// Onde buscar o ícone de uma extensão pela chave: o `destino` que a aba Extensões usaria
/// (URL/comando do MCP, `pacote:<site>`, `conector:<nome>`). Extensão que não está instalada
/// (ou é de projeto) volta só o prefixo: a busca ainda tenta a marca pelo nome.
pub fn destino_do_icone(dir: &Path, chave: &str) -> Option<String> {
    let (tipo, nome) = chave.split_once(':')?;
    let contas = listar(dir, None);
    match tipo {
        "conector" => Some(chave.to_owned()),
        "plugin" => Some(format!("pacote:{}", contas.iter().flat_map(|c| &c.plugins)
            .find(|p| p.nome.to_lowercase() == nome).and_then(|p| p.site.clone()).unwrap_or_default())),
        "mcp" => Some(contas.iter().flat_map(|c| &c.mcps).find(|m| m.nome.to_lowercase() == nome).map(|m| m.destino.clone()).unwrap_or_default()),
        _ => None,
    }
}

/// Site do plugin pelos manifestos: `homepage` que não seja GitHub primeiro (é o site da marca), depois
/// repositório, homepage e autor (`github.com/<dono>` dá o avatar da organização). Só http(s).
pub(crate) fn site_do_pacote(pasta: &Path) -> Option<String> {
    let manifestos: Vec<Value> = [".claude-plugin", ".cursor-plugin", ".codex-plugin"].iter()
        .filter_map(|m| ler_json(&pasta.join(m).join("plugin.json"))).collect();
    let url = |v: Option<&Value>| -> Option<String> {
        let v = v?;
        v.as_str().or_else(|| v.get("url").and_then(Value::as_str)).map(str::to_owned)
    };
    let mut candidatos = Vec::new();
    for m in &manifestos {
        candidatos.extend(url(m.get("homepage")).filter(|u| !u.contains("github.com")));
    }
    for m in &manifestos {
        candidatos.extend(url(m.get("repository")));
        candidatos.extend(url(m.get("homepage")));
        candidatos.extend(url(m.get("author")));
    }
    candidatos.into_iter().find(|u| u.starts_with("https://") || u.starts_with("http://")).map(|u| url_segura(&u))
}

/// URL sem query, fragmento nem `usuario:senha@` — é onde chaves costumam ir parar.
fn url_segura(url: &str) -> String {
    let sem_query = url.split(['?', '#']).next().unwrap_or(url);
    match sem_query.split_once("://") {
        Some((esquema, resto)) => {
            let (host, caminho) = resto.split_once('/').map_or((resto, ""), |(h, c)| (h, c));
            let host = host.rsplit('@').next().unwrap_or(host);
            if caminho.is_empty() { format!("{esquema}://{host}") } else { format!("{esquema}://{host}/{caminho}") }
        }
        None => sem_query.to_owned(),
    }
}

/// Parece segredo: nome de flag sensível, ou um valor longo e opaco (token).
fn parece_segredo(texto: &str) -> bool {
    let minusculo = texto.to_lowercase();
    ["key", "token", "secret", "senha", "password", "passwd", "auth", "bearer", "credential"].iter().any(|p| minusculo.contains(p))
}
fn valor_opaco(texto: &str) -> bool {
    texto.len() >= 24 && texto.chars().all(|c| c.is_ascii_alphanumeric() || "-_=+".contains(c))
        && texto.chars().any(|c| c.is_ascii_digit()) && texto.chars().any(|c| c.is_ascii_alphabetic())
}

/// Comando com os argumentos, mascarando valores sensíveis: `--api-key=x` vira `--api-key=•••`, o
/// valor depois de `--token` vira `•••`, e um token solto (longo e opaco) também.
fn comando_seguro(comando: &str, args: &[String]) -> String {
    let mut partes = vec![comando.to_owned()];
    let mut mascarar_proximo = false;
    for arg in args {
        if mascarar_proximo {
            partes.push("•••".into());
            mascarar_proximo = false;
            continue;
        }
        if let Some((chave, _)) = arg.split_once('=') {
            if parece_segredo(chave) { partes.push(format!("{chave}=•••")); continue; }
        }
        if arg.starts_with('-') && parece_segredo(arg) && !arg.contains('=') {
            partes.push(arg.clone());
            mascarar_proximo = true;
            continue;
        }
        partes.push(if valor_opaco(arg) { "•••".into() } else { arg.clone() });
    }
    partes.join(" ").trim().to_owned()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn logo_vem_do_manifesto_e_nao_sai_da_pasta() {
        let tmp = std::env::temp_dir().join(format!("omni-logo-{}", std::process::id()));
        let pacote = tmp.join("pacote");
        std::fs::create_dir_all(pacote.join(".codex-plugin")).unwrap();
        std::fs::create_dir_all(pacote.join("assets")).unwrap();
        std::fs::write(pacote.join("assets").join("logo.svg"), "<svg/>").unwrap();
        std::fs::write(pacote.join(".codex-plugin").join("plugin.json"), r#"{"interface":{"logo":"./assets/logo.svg"}}"#).unwrap();
        assert_eq!(logo_do_pacote(&pacote).as_deref(), Some("data:image/svg+xml;base64,PHN2Zy8+"));

        // Manifesto apontando para fora do pacote: recusa, mesmo sendo imagem.
        std::fs::write(tmp.join("fora.svg"), "<svg/>").unwrap();
        std::fs::remove_file(pacote.join("assets").join("logo.svg")).unwrap();
        std::fs::write(pacote.join(".codex-plugin").join("plugin.json"), r#"{"logo":"../fora.svg"}"#).unwrap();
        assert_eq!(logo_do_pacote(&pacote), None);
        let _ = std::fs::remove_dir_all(&tmp);
    }

    #[test]
    fn icone_salvo_pela_chave_do_nome() {
        assert_eq!(chave_do_icone("https://stitch.googleapis.com/mcp", "Stitch"), "mcp:stitch");
        assert_eq!(chave_do_icone("pacote:https://github.com/vercel", "vercel"), "plugin:vercel");
        assert_eq!(chave_do_icone("conector:claude.ai Google Drive", "claude.ai Google Drive"), "conector:google drive");
        let dir = std::env::temp_dir().join(format!("omni-icones-core-{}", std::process::id()));
        std::fs::create_dir_all(dir.join("icones")).unwrap();
        std::fs::write(dir.join("icones").join("stitch-1.png"), b"\x89PNG").unwrap();
        guardar_nome_do_icone(&dir, "mcp:stitch", "stitch-1.png");
        guardar_nome_do_icone(&dir, "mcp:mau", "../fora.png");
        assert_eq!(icone_conhecido(&dir, "mcp:stitch").as_deref(), Some("data:image/png;base64,iVBORw=="));
        assert_eq!(icone_conhecido(&dir, "mcp:mau"), None);
        assert_eq!(icone_conhecido(&dir, "mcp:nenhum"), None);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn site_prefere_homepage_da_marca_e_cai_no_github() {
        let pacote = std::env::temp_dir().join(format!("omni-site-{}", std::process::id()));
        std::fs::create_dir_all(pacote.join(".claude-plugin")).unwrap();
        let manifesto = pacote.join(".claude-plugin").join("plugin.json");
        std::fs::write(&manifesto, r#"{"homepage":"https://docs.stripe.com?ref=x","repository":"https://github.com/stripe/ai"}"#).unwrap();
        assert_eq!(site_do_pacote(&pacote).as_deref(), Some("https://docs.stripe.com"));
        std::fs::write(&manifesto, r#"{"repository":{"url":"https://github.com/vercel/vercel-plugin"},"author":{"url":"https://github.com/vercel"}}"#).unwrap();
        assert_eq!(site_do_pacote(&pacote).as_deref(), Some("https://github.com/vercel/vercel-plugin"));
        std::fs::write(&manifesto, r#"{"name":"x","author":"Fulano"}"#).unwrap();
        assert_eq!(site_do_pacote(&pacote), None);
        let _ = std::fs::remove_dir_all(&pacote);
    }

    #[test]
    fn url_perde_query_e_credencial() {
        assert_eq!(url_segura("https://user:senha@api.x.com/mcp?key=abc#f"), "https://api.x.com/mcp");
        assert_eq!(url_segura("http://localhost:3000"), "http://localhost:3000");
    }

    #[test]
    fn comando_mascara_o_que_parece_segredo() {
        let args = |l: &[&str]| l.iter().map(|s| s.to_string()).collect::<Vec<_>>();
        assert_eq!(comando_seguro("npx", &args(&["-y", "@modelcontextprotocol/server-github"])), "npx -y @modelcontextprotocol/server-github");
        assert_eq!(comando_seguro("node", &args(&["srv.js", "--api-key=sk-123", "--token", "abc"])), "node srv.js --api-key=••• --token •••");
        assert_eq!(comando_seguro("x", &args(&["fc-3f9a8b7c6d5e4f3a2b1c0d9e8f7a6b5c"])), "x •••");
        assert_eq!(comando_seguro("node", &args(&["C:\\mcp\\server\\index.js"])), "node C:\\mcp\\server\\index.js");
    }

    #[test]
    fn json_le_mcps_sem_expor_valores() {
        let dir = tempfile::tempdir().unwrap();
        let arquivo = dir.path().join("mcp.json");
        let dados = serde_json::json!({"mcpServers":{
            "remoto":{"type":"http","url":"https://mcp.x.com/v1?token=SEGREDO","headers":{"Authorization":"Bearer SEGREDO"}},
            "local":{"command":"npx","args":["-y","pacote"],"env":{"API_KEY":"SEGREDO"},"disabled":true}
        }});
        let mut saida = Vec::new();
        mcps_do_json(&mut saida, dados.get("mcpServers"), "global", None, &arquivo);
        let tudo = serde_json::to_string(&saida).unwrap();
        assert!(!tudo.contains("SEGREDO"), "valor sensível vazou: {tudo}");
        let remoto = saida.iter().find(|m| m.nome == "remoto").unwrap();
        assert_eq!((remoto.tipo.as_str(), remoto.destino.as_str()), ("http", "https://mcp.x.com/v1"));
        assert_eq!(remoto.variaveis, ["Authorization"]);
        let local = saida.iter().find(|m| m.nome == "local").unwrap();
        assert_eq!((local.tipo.as_str(), local.destino.as_str(), local.ativo), ("stdio", "npx -y pacote", false));
        assert_eq!(local.variaveis, ["API_KEY"]);
    }

    #[test]
    fn codex_le_mcps_e_plugins_do_toml() {
        let dir = tempfile::tempdir().unwrap();
        let arquivo = dir.path().join("config.toml");
        std::fs::write(&arquivo, r#"
model = "gpt-5"
[mcp_servers.repl]
command = "node"
args = ["repl.js"]
[mcp_servers.repl.env]
CHAVE = "SEGREDO"
[mcp_servers.web]
url = "https://x.com/mcp?k=SEGREDO"
enabled = false
[plugins."notion@openai-curated"]
enabled = true
[plugins."canva@openai-curated"]
enabled = false
"#).unwrap();
        let mut conta = ExtensoesDaConta { provider: "codex".into(), conta_id: "c".into(), conta_nome: "C".into(), principal: true,
            mcps: Vec::new(), plugins: Vec::new(), conectores: Vec::new(), arquivos: Vec::new() };
        codex(&mut conta, &arquivo);
        assert!(!serde_json::to_string(&conta).unwrap().contains("SEGREDO"));
        assert_eq!(conta.mcps.len(), 2);
        assert!(conta.mcps.iter().any(|m| m.nome == "web" && !m.ativo && m.destino == "https://x.com/mcp"));
        assert_eq!(conta.plugins.iter().map(|p| (p.nome.as_str(), p.ativo)).collect::<Vec<_>>(), [("notion", true), ("canva", false)]);
    }
}
