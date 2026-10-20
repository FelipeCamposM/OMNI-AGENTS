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

/// Dica de vocabulário: o nome do projeto e o que está na raiz dele. O whisper usa o `initial_prompt`
/// como contexto e passa a acertar nome de arquivo e termo técnico que ele trocaria por palavra comum.
pub fn vocabulario(pasta_do_projeto: &Path) -> String {
    let mut termos = vec!["Claude".to_owned(), "Codex".to_owned(), "Gemini".to_owned(), "commit".to_owned(), "deploy".to_owned()];
    if let Some(nome) = pasta_do_projeto.file_name() { termos.insert(0, nome.to_string_lossy().into_owned()); }
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
    let exe = fluxos::executavel("claude")?;
    let dir = state.state_file.parent()?;
    let perfis = omni_core::profiles(dir);
    let perfil = perfis.iter().find(|p| p.provider == "claude" && p.builtin).or_else(|| perfis.iter().find(|p| p.provider == "claude"));
    let mut c = fluxos::comando_da_cli(&exe);
    // Sem ferramentas, sem MCP e sem gravar sessão: abre em segundos em vez de ~20 s, e a correção não
    // aparece no histórico de conversas do Claude.
    c.args(["-p", "--output-format", "json", "--model", "haiku", "--no-session-persistence", "--strict-mcp-config", "--tools", ""])
        .arg("--system-prompt").arg(INSTRUCOES_DA_CORRECAO);
    if let Some(p) = perfil { c.envs(omni_core::env_for(p)); }
    // Pasta temporária: longe de qualquer projeto, nada de CLAUDE.md alheio mexendo na correção.
    c.current_dir(env::temp_dir()).stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::null());
    sem_janela(&mut c);
    let mut filho = c.spawn().ok()?;
    filho.stdin.take()?.write_all(format!("{dica}\n\nTranscrição:\n{bruto}").as_bytes()).ok()?;
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
        let dica = vocabulario(&projeto);
        assert!(dica.contains("omni-agents") && dica.contains("src-tauri") && dica.contains("roadmap.md"), "{dica}");
        assert!(!dica.contains(".git") && !dica.contains("node_modules"), "{dica}");
        assert!(dica.ends_with('.'));
    }

    #[test]
    fn audio_curto_demais_nem_carrega_o_modelo() {
        let state = crate::tests::test_state();
        assert_eq!(transcrever(&state, &[0u8; 1000], "").unwrap(), "");
    }
}

