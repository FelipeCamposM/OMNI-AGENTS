//! Prompt por voz: o áudio gravado no app (PC ou celular) chega aqui e vira texto **no PC**, com o
//! whisper.cpp — nada sai da máquina. O modelo não vem no instalador: é baixado só se a pessoa pedir
//! em Configurações, e sem ele a funcionalidade nem aparece na tela.

use super::*;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::process::{Command, Stdio};
use std::sync::OnceLock;
use std::time::{Duration, Instant};
use whisper_rs::{FullParams, SamplingStrategy, WhisperContext, WhisperContextParameters};

/// Multilíngue, quantizado: bom em português e ainda leve (~190 MB, alguns segundos por frase na CPU).
const MODELO: &str = "ggml-small-q5_1.bin";
const MODELO_URL: &str = "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small-q5_1.bin";
const MODELO_BYTES: u64 = 190_085_487;
const MODELO_SHA256: &str = "ae85e4a935d7a567bd102fe55afc16bb595bdb618e11b2fc7591bc08120411bb";
/// Whisper trabalha em 16 kHz mono; o app já manda nesse formato (PCM 16 bits).
const TAXA: usize = 16_000;
/// Limite do áudio: 5 minutos de fala. O corpo da rota é limitado em bytes a partir daqui.
pub const AUDIO_MAX_BYTES: usize = 5 * 60 * TAXA * 2;

fn pasta(state: &EngineState) -> PathBuf { state.state_file.with_file_name("voz") }
fn caminho_do_modelo(state: &EngineState) -> PathBuf { pasta(state).join(MODELO) }

#[derive(Default, Serialize, Deserialize)]
#[serde(default)]
struct Config {
    /// Passar a transcrição crua pelo Claude (pontuação, hesitações, palavras trocadas).
    corrigir: bool,
}

fn ler_config(state: &EngineState) -> Config {
    fs::read(pasta(state).join("config.json")).ok().and_then(|b| serde_json::from_slice(&b).ok()).unwrap_or_default()
}

#[derive(Clone, Default, Serialize)]
pub struct Download { pub ativo: bool, pub erro: Option<String> }
fn download() -> &'static Mutex<Download> { static D: OnceLock<Mutex<Download>> = OnceLock::new(); D.get_or_init(Default::default) }

/// O whisper.cpp é compilado com AVX2/FMA/F16C/BMI2 em x86_64 (`scripts/build-engine.mjs`). Numa CPU sem
/// elas, rodar o modelo derrubaria o engine inteiro com "instrução ilegal" — então a voz nem é oferecida.
pub fn cpu_suporta() -> bool {
    #[cfg(target_arch = "x86_64")]
    { std::arch::is_x86_feature_detected!("avx2") && std::arch::is_x86_feature_detected!("fma") && std::arch::is_x86_feature_detected!("f16c")
        && std::arch::is_x86_feature_detected!("bmi2") }
    #[cfg(not(target_arch = "x86_64"))]
    { true }
}

#[derive(Serialize)]
pub struct Estado {
    /// Falso numa CPU antiga demais: Configurações explica em vez de oferecer o download.
    suportado: bool,
    instalado: bool,
    baixando: bool,
    /// Bytes já baixados (só durante o download) e o total, para a barra de progresso.
    baixado: u64,
    total: u64,
    erro: Option<String>,
    corrigir: bool,
}

pub fn estado(state: &EngineState) -> Estado {
    let d = download().lock().map(|d| d.clone()).unwrap_or_default();
    let parcial = caminho_do_modelo(state).with_extension("part");
    let suportado = cpu_suporta();
    Estado {
        suportado,
        instalado: suportado && caminho_do_modelo(state).is_file(),
        baixando: d.ativo,
        baixado: if d.ativo { fs::metadata(&parcial).map(|m| m.len()).unwrap_or(0) } else { 0 },
        total: MODELO_BYTES,
        erro: d.erro,
        corrigir: ler_config(state).corrigir,
    }
}

pub fn definir_correcao(state: &EngineState, corrigir: bool) -> Result<()> {
    fs::create_dir_all(pasta(state))?;
    Ok(atomic_write_json(&pasta(state).join("config.json"), &Config { corrigir })?)
}

fn sem_janela(c: &mut Command) {
    #[cfg(windows)] { use std::os::windows::process::CommandExt; c.creation_flags(0x0800_0000); }
    let _ = c;
}

/// Baixa o modelo em segundo plano. Usa o `curl` do sistema (vem no Windows 10+, macOS e Linux) para
/// não puxar um cliente HTTP inteiro por um download só; o arquivo só vira o modelo depois de bater
/// tamanho e SHA-256 — até lá fica como `.part` e nunca é carregado.
pub fn baixar(state: &Arc<EngineState>) {
    {
        let Ok(mut d) = download().lock() else { return };
        if d.ativo || caminho_do_modelo(state).is_file() || !cpu_suporta() { return; }
        *d = Download { ativo: true, erro: None };
    }
    let state = state.clone();
    std::thread::spawn(move || {
        let resultado = (|| -> Result<()> {
            let destino = caminho_do_modelo(&state);
            fs::create_dir_all(pasta(&state))?;
            let parcial = destino.with_extension("part");
            let mut c = Command::new("curl");
            c.args(["-L", "--fail", "-sS", "--retry", "3", "-o"]).arg(&parcial).arg(MODELO_URL)
                .stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::piped());
            sem_janela(&mut c);
            let saida = c.output().context("não consegui abrir o curl")?;
            if !saida.status.success() {
                let _ = fs::remove_file(&parcial);
                let detalhe = String::from_utf8_lossy(&saida.stderr).trim().lines().last().unwrap_or("").to_owned();
                return Err(anyhow!("O download falhou. Confira a internet e tente de novo. {detalhe}"));
            }
            if !arquivo_confere(&parcial)? {
                let _ = fs::remove_file(&parcial);
                return Err(anyhow!("O arquivo baixado veio corrompido; tente de novo"));
            }
            fs::rename(&parcial, &destino)?;
            Ok(())
        })();
        if let Ok(mut d) = download().lock() { *d = Download { ativo: false, erro: resultado.err().map(|e| e.to_string()) }; }
    });
}

fn arquivo_confere(caminho: &Path) -> Result<bool> {
    if fs::metadata(caminho)?.len() != MODELO_BYTES { return Ok(false); }
    let mut arquivo = fs::File::open(caminho)?;
    let mut hash = Sha256::new();
    std::io::copy(&mut arquivo, &mut hash)?;
    let hex: String = hash.finalize().iter().map(|b| format!("{b:02x}")).collect();
    Ok(hex == MODELO_SHA256)
}

pub fn remover(state: &EngineState) -> Result<()> {
    if download().lock().map(|d| d.ativo).unwrap_or(false) { return Err(anyhow!("Espere o download terminar")); }
    *contexto().lock().map_err(|_| anyhow!("voz"))? = None;
    match fs::remove_file(caminho_do_modelo(state)) {
        Err(e) if e.kind() != std::io::ErrorKind::NotFound => Err(e.into()),
        _ => Ok(()),
    }
}

/// O modelo fica carregado depois da primeira transcrição (~250 MB de RAM): recarregar a cada frase
/// custaria segundos. `remover` solta a memória.
fn contexto() -> &'static Mutex<Option<Arc<WhisperContext>>> { static C: OnceLock<Mutex<Option<Arc<WhisperContext>>>> = OnceLock::new(); C.get_or_init(Default::default) }

fn carregar(state: &EngineState) -> Result<Arc<WhisperContext>> {
    let mut atual = contexto().lock().map_err(|_| anyhow!("voz"))?;
    if let Some(ctx) = atual.as_ref() { return Ok(ctx.clone()); }
    let caminho = caminho_do_modelo(state);
    if !caminho.is_file() || !cpu_suporta() { return Err(anyhow!("O modelo de voz não está baixado")); }
    whisper_rs::install_logging_hooks(); // sem isso o whisper.cpp despeja o log no stderr do engine
    let ctx = Arc::new(WhisperContext::new_with_params(&caminho, WhisperContextParameters::default())
        .map_err(|e| anyhow!("Não consegui abrir o modelo de voz: {e}"))?);
    *atual = Some(ctx.clone());
    Ok(ctx)
}

/// PCM 16 bits little-endian → amostras em [-1, 1], como o whisper espera.
fn amostras(pcm: &[u8]) -> Vec<f32> {
    pcm.chunks_exact(2).map(|par| i16::from_le_bytes([par[0], par[1]]) as f32 / 32768.0).collect()
}

/// Palavra que a voz erra: o certo (`termo`) e como ela já foi ouvida errado (`ouvido`). O app troca o
/// ouvido pelo termo depois de ditar; o whisper e a correção recebem os termos como dica.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct Palavra { pub termo: String, pub ouvido: Vec<String>, pub origem: String }

#[derive(Default, Serialize, Deserialize)]
#[serde(default)]
struct Vocabulario { itens: Vec<Palavra> }

pub fn palavras(state: &EngineState) -> Vec<Palavra> {
    fs::read(pasta(state).join("vocabulario.json")).ok()
        .and_then(|b| serde_json::from_slice::<Vocabulario>(&b).ok()).map(|v| v.itens).unwrap_or_default()
}

/// Grava a lista inteira (tela de Configurações). Junta repetidos pelo termo, sem diferenciar caixa.
pub fn salvar_palavras(state: &EngineState, itens: Vec<Palavra>) -> Result<Vec<Palavra>> {
    let mut limpos: Vec<Palavra> = Vec::new();
    for item in itens {
        let termo = item.termo.trim().to_owned();
        if termo.is_empty() || termo.len() > 80 { continue; }
        let ouvido = item.ouvido.into_iter().map(|o| o.trim().to_owned())
            .filter(|o| !o.is_empty() && o.len() <= 120 && !o.eq_ignore_ascii_case(&termo)).collect::<Vec<_>>();
        match limpos.iter_mut().find(|p| p.termo.to_lowercase() == termo.to_lowercase()) {
            Some(existente) => for o in ouvido { if !existente.ouvido.iter().any(|x| x.to_lowercase() == o.to_lowercase()) { existente.ouvido.push(o); } },
            None => limpos.push(Palavra { termo, ouvido, origem: if item.origem.is_empty() { "manual".into() } else { item.origem } }),
        }
    }
    fs::create_dir_all(pasta(state))?;
    atomic_write_json(&pasta(state).join("vocabulario.json"), &Vocabulario { itens: limpos.clone() })?;
    Ok(limpos)
}

/// Correção feita no campo depois de ditar: soma à lista sem apagar nada.
pub fn aprender(state: &EngineState, novas: Vec<Palavra>) -> Result<Vec<Palavra>> {
    let mut itens = palavras(state);
    itens.extend(novas.into_iter().map(|p| Palavra { origem: "correcao".into(), ..p }));
    salvar_palavras(state, itens)
}

/// Nomes próprios do projeto que a voz não conhece: a pasta, o nome do pacote (npm, Tauri, Cargo) e o
/// título do README. É o que aparece como "automático" na lista e entra na dica do whisper.
pub fn termos_do_projeto(pasta_do_projeto: &Path) -> Vec<String> {
    let mut termos: Vec<String> = Vec::new();
    let mut por = |t: &str| {
        let t = t.trim().trim_matches(['"', '\'', '`']).trim();
        if !t.is_empty() && t.len() <= 60 && !termos.iter().any(|x| x.eq_ignore_ascii_case(t)) { termos.push(t.to_owned()); }
    };
    if let Some(nome) = pasta_do_projeto.file_name() { por(&nome.to_string_lossy()); }
    let json = |arquivo: &str, chave: &str| fs::read(pasta_do_projeto.join(arquivo)).ok()
        .and_then(|b| serde_json::from_slice::<serde_json::Value>(&b).ok()).and_then(|v| v[chave].as_str().map(str::to_owned));
    for (arquivo, chave) in [("package.json", "name"), ("package.json", "productName"), ("src-tauri/tauri.conf.json", "productName")] {
        if let Some(t) = json(arquivo, chave) { por(t.rsplit('/').next().unwrap_or(&t)); }
    }
    if let Ok(cargo) = fs::read_to_string(pasta_do_projeto.join("Cargo.toml")) {
        if let Some(nome) = cargo.lines().skip_while(|l| l.trim() != "[package]").find_map(|l| l.trim().strip_prefix("name").and_then(|r| r.trim().strip_prefix('='))) { por(nome); }
    }
    if let Ok(readme) = fs::read_to_string(pasta_do_projeto.join("README.md")) {
        if let Some(titulo) = readme.lines().find_map(|l| l.strip_prefix("# ")) { por(titulo); }
    }
    termos
}

/// Dica de vocabulário: as palavras da lista, os nomes do projeto e o que está na raiz dele. O whisper
/// usa o `initial_prompt` como contexto e passa a acertar termo que ele trocaria por palavra comum.
pub fn vocabulario(state: &EngineState, pasta_do_projeto: &Path) -> String {
    let mut termos: Vec<String> = palavras(state).into_iter().map(|p| p.termo).collect();
    termos.extend(termos_do_projeto(pasta_do_projeto));
    termos.extend(["Claude", "Codex", "Gemini", "commit", "deploy"].map(str::to_owned));
    dica(termos, pasta_do_projeto)
}

fn dica(mut termos: Vec<String>, pasta_do_projeto: &Path) -> String {
    if let Ok(entradas) = fs::read_dir(pasta_do_projeto) {
        let mut nomes: Vec<String> = entradas.flatten().map(|e| e.file_name().to_string_lossy().into_owned())
            .filter(|n| !n.starts_with('.') && n != "node_modules" && n != "target").collect();
        nomes.sort();
        termos.extend(nomes.into_iter().take(40));
    }
    // O prompt inicial do whisper tem teto de ~224 tokens; o resto seria descartado de qualquer jeito.
    let mut dica = String::from("Pedido para um agente de programação. Termos: ");
    for termo in termos {
        if dica.len() + termo.len() > 600 { break; }
        dica.push_str(&termo);
        dica.push_str(", ");
    }
    dica.trim_end_matches([',', ' ']).to_owned() + "."
}

pub fn transcrever(state: &EngineState, pcm: &[u8], dica: &str) -> Result<String> {
    let audio = amostras(pcm);
    // Menos de meio segundo é clique sem querer, não fala.
    if audio.len() < TAXA / 2 { return Ok(String::new()); }
    let ctx = carregar(state)?;
    let mut sessao = ctx.create_state().map_err(|e| anyhow!("voz: {e}"))?;
    let mut p = FullParams::new(SamplingStrategy::Greedy { best_of: 1 });
    // Metade dos lógicos ≈ núcleos físicos: thread a mais disputando hyperthreading deixa o whisper lento.
    let nucleos = (std::thread::available_parallelism().map(|n| n.get()).unwrap_or(8) / 2).clamp(1, 8);
    p.set_n_threads(nucleos as i32);
    p.set_language(Some("pt"));
    p.set_translate(false);
    p.set_no_context(true);
    p.set_initial_prompt(dica);
    // O whisper sempre codifica uma janela de 30 s: um trecho de 4 s custava o mesmo que 30. A janela do
    // tamanho do trecho (1500 quadros = 30 s) corta o tempo em vários x; a folga evita repetição no fim.
    p.set_audio_ctx((audio.len() * 1500 / (30 * TAXA) + 128).clamp(768, 1500) as i32);
    p.set_no_timestamps(true);
    p.set_print_special(false);
    p.set_print_progress(false);
    p.set_print_realtime(false);
    p.set_print_timestamps(false);
    sessao.full(p, &audio).map_err(|e| anyhow!("Falha ao transcrever: {e}"))?;
    let texto: Vec<String> = (0..sessao.full_n_segments())
        .filter_map(|i| sessao.get_segment(i))
        .filter_map(|s| s.to_str_lossy().ok().map(|t| t.trim().to_owned()))
        .filter(|t| !t.is_empty() && !eh_ruido(t))
        .collect();
    Ok(texto.join(" "))
}

/// Correção pelo Claude, se ligada nas Configurações. Roda uma vez sobre a fala inteira (não por
/// trecho): é um bônus — se o Claude falhar, a pessoa fica com a transcrição crua.
pub fn corrigir(state: &EngineState, bruto: &str, dica: &str) -> String {
    if bruto.trim().is_empty() || !ler_config(state).corrigir { return bruto.to_owned(); }
    corrigir_com_ia(state, bruto, dica).unwrap_or_else(|| bruto.to_owned())
}

/// Silêncio e ruído o whisper "transcreve" como marcação (`[Música]`, `(risos)`) — não é fala.
fn eh_ruido(trecho: &str) -> bool {
    let t = trecho.trim();
    (t.starts_with('[') && t.ends_with(']')) || (t.starts_with('(') && t.ends_with(')'))
}

const INSTRUCOES_DA_CORRECAO: &str = "Você corrige transcrições automáticas de fala em português. A pessoa ditou um pedido para um agente de programação. Corrija só o que a transcrição errou: pontuação, acentos, palavras trocadas por outras de som parecido e nomes técnicos ou de arquivo (prefira os do vocabulário dado). Tire hesitações (\"é…\", \"ãh\", \"tipo\") e repetições sem querer. Mantenha as palavras, a conjugação e o tom da pessoa — não troque \"abre\" por \"abra\", não formalize. Não responda o pedido, não comente, não explique o que mudou. Devolva só o texto corrigido.";

fn corrigir_com_ia(state: &EngineState, bruto: &str, dica: &str) -> Option<String> {
    claude_rapido(state.state_file.parent()?, INSTRUCOES_DA_CORRECAO, &format!("{dica}\n\nTranscrição:\n{bruto}"))
}

/// Uma pergunta curta ao Haiku pela CLI do Claude da pessoa (conta padrão), sem ferramentas e sem
/// gravar sessão. `None` se a CLI faltar, falhar ou passar de 30 s: quem chama tem um plano B.
pub fn claude_rapido(dir: &Path, sistema: &str, entrada: &str) -> Option<String> {
    let exe = fluxos::executavel("claude")?;
    let perfis = omni_core::profiles(dir);
    let perfil = perfis.iter().find(|p| p.provider == "claude" && p.builtin).or_else(|| perfis.iter().find(|p| p.provider == "claude"));
    let mut c = fluxos::comando_da_cli(&exe);
    // Sem ferramentas, sem MCP e sem gravar sessão: abre em segundos em vez de ~20 s, e a pergunta não
    // aparece no histórico de conversas do Claude.
    c.args(["-p", "--output-format", "json", "--model", "haiku", "--no-session-persistence", "--strict-mcp-config", "--tools", ""])
        .arg("--system-prompt").arg(sistema);
    if let Some(p) = perfil { c.envs(omni_core::env_for(p)); }
    // Pasta temporária: longe de qualquer projeto, nada de CLAUDE.md alheio mexendo na correção.
    c.current_dir(env::temp_dir()).stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::null());
    sem_janela(&mut c);
    let mut filho = c.spawn().ok()?;
    filho.stdin.take()?.write_all(entrada.as_bytes()).ok()?;
    let mut stdout = filho.stdout.take()?;
    let leitor = std::thread::spawn(move || { let mut s = String::new(); let _ = stdout.read_to_string(&mut s); s });
    let inicio = Instant::now();
    loop {
        if filho.try_wait().ok()?.is_some() { break; }
        if inicio.elapsed() > Duration::from_secs(30) { let _ = filho.kill(); return None; }
        std::thread::sleep(Duration::from_millis(100));
    }
    let saida = leitor.join().ok()?;
    let v: serde_json::Value = serde_json::from_str(&saida).ok()?;
    if v["is_error"].as_bool() == Some(true) { return None; }
    let texto = v["result"].as_str()?.trim().to_owned();
    (!texto.is_empty()).then_some(texto)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pcm_vira_amostras_entre_menos_um_e_um() {
        let pcm = [0x00, 0x80, 0xff, 0x7f, 0x00, 0x00, 0x01];
        let a = amostras(&pcm);
        assert_eq!(a.len(), 3, "byte solto no fim é ignorado");
        assert_eq!(a[0], -1.0);
        assert!((a[1] - 1.0).abs() < 0.001);
        assert_eq!(a[2], 0.0);
    }

    #[test]
    fn marcacao_de_ruido_nao_e_fala() {
        assert!(eh_ruido("[Música]"));
        assert!(eh_ruido(" (risos) "));
        assert!(!eh_ruido("abre o arquivo (o de config)  agora"));
    }

    #[test]
    fn vocabulario_leva_o_projeto_e_a_raiz_sem_ocultos() {
        let dir = tempfile::tempdir().unwrap();
        let projeto = dir.path().join("omni-agents");
        fs::create_dir_all(projeto.join("src-tauri")).unwrap();
        fs::create_dir_all(projeto.join(".git")).unwrap();
        fs::create_dir_all(projeto.join("node_modules")).unwrap();
        fs::write(projeto.join("roadmap.md"), "").unwrap();
        let dica = dica(termos_do_projeto(&projeto), &projeto);
        assert!(dica.contains("omni-agents") && dica.contains("src-tauri") && dica.contains("roadmap.md"), "{dica}");
        assert!(!dica.contains(".git") && !dica.contains("node_modules"), "{dica}");
        assert!(dica.ends_with('.'));
    }

    #[test]
    fn correcao_aprendida_junta_com_o_termo_existente_e_entra_na_dica() {
        let state = crate::tests::test_state();
        let p = |termo: &str, ouvido: &[&str]| Palavra { termo: termo.into(), ouvido: ouvido.iter().map(|s| s.to_string()).collect(), origem: String::new() };
        salvar_palavras(&state, vec![p("SIAPLUS", &[]), p(" ", &["lixo"])]).unwrap();
        let itens = aprender(&state, vec![p("siaplus", &["abra-se e a plus"]), p("Domus AdPilot", &["domus a de pilot", "Domus AdPilot"])]).unwrap();
        assert_eq!(itens.len(), 2, "{itens:?}");
        assert_eq!(itens[0].ouvido, ["abra-se e a plus"]);
        assert_eq!(itens[1].ouvido, ["domus a de pilot"], "o próprio termo não vira ouvido");
        assert_eq!(itens[1].origem, "correcao");
        let dir = tempfile::tempdir().unwrap();
        fs::write(dir.path().join("package.json"), r#"{"name":"@camps/siaplus-web"}"#).unwrap();
        assert!(termos_do_projeto(dir.path()).contains(&"siaplus-web".to_owned()));
        assert!(vocabulario(&state, dir.path()).contains("Domus AdPilot"));
    }

    #[test]
    fn audio_curto_demais_nem_carrega_o_modelo() {
        let state = crate::tests::test_state();
        assert_eq!(transcrever(&state, &[0u8; 1000], "").unwrap(), "");
    }
}

