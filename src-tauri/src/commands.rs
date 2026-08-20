use tauri::{AppHandle, Emitter, Manager};
use tauri::path::BaseDirectory;
#[cfg(not(debug_assertions))]
use tauri_plugin_shell::ShellExt;
#[cfg(not(debug_assertions))]
use tauri_plugin_shell::process::CommandEvent;
use tauri_plugin_opener::OpenerExt;
use std::path::{Path, PathBuf};

fn emit_progress_lines(app: &AppHandle, tool: &str, text: &str) {
    for line in text.lines() {
        let trimmed = line.trim();
        if let Some(rest) = trimmed.strip_prefix("PROGRESS:") {
            if let Ok(pct) = rest.trim().parse::<u32>() {
                let _ = app.emit("tool-progress", pct);
            }
        } else if let Some(rest) = trimmed.strip_prefix("STEP:") {
            // Fase corrente em texto. Sem isto, operação com preparo longo
            // (carregar/baixar modelo) fica com a barra parada em 0% e o
            // usuário conclui que travou.
            let _ = app.emit("tool-step", rest.trim());
        } else if let Some(rest) = trimmed.strip_prefix("EVENT:") {
            if let Ok(val) = serde_json::from_str::<serde_json::Value>(rest.trim()) {
                let _ = app.emit("youtube-event", val);
            }
        } else if let Some(rest) = trimmed.strip_prefix("PAGEEVENT:") {
            if let Ok(val) = serde_json::from_str::<serde_json::Value>(rest.trim()) {
                let _ = app.emit("capture-page-event", val);
            }
        }
    }
    eprint!("[converter/{tool}] {text}");
}

/// Runs the Python tool and returns its stdout (one JSON line by contract).
/// In debug builds runs the source via the venv Python (instant iteration);
/// in release builds runs the bundled light sidecar — except `pdf2md`, que roda
/// o sidecar Docling baixado sob demanda.
async fn run_python_tool(app: &AppHandle, tool: &str, input_json: &str) -> Result<String, String> {
    #[cfg(debug_assertions)]
    {
        run_dev_python(app, tool, input_json).await
    }
    #[cfg(not(debug_assertions))]
    {
        // Ferramentas que moram num módulo baixado, não no sidecar light.
        match tool {
            "pdf2md" => run_module_sidecar(app, docling_exe_path(app), "DOCLING_MISSING", tool, input_json).await,
            "transcribe" => run_module_sidecar(app, whisper_exe_path(app), "WHISPER_MISSING", tool, input_json).await,
            // Só a inferência mora no módulo. `depth_adjust` (inverter/contraste)
            // fica no light de propósito: ajustar um slider não pode depender de
            // 45 MB baixados nem recarregar modelo nenhum.
            "depth_map" => run_module_sidecar(app, depth_exe_path(app), "DEPTH_MISSING", tool, input_json).await,
            "remove_bg" => run_module_sidecar(app, rembg_exe_path(app), "REMBG_MISSING", tool, input_json).await,
            "capture_site" => run_module_sidecar(app, webcapture_exe_path(app), "WEBCAPTURE_MISSING", tool, input_json).await,
            _ => run_sidecar_python(app, tool, input_json).await,
        }
    }
}

/// Constrói um Command que NÃO abre janela de console no Windows.
///
/// Todo processo filho aqui é headless (sidecar Python, ffmpeg, ffprobe) e a
/// comunicação é por pipe — sem esta flag o Windows abre um console preto por
/// spawn, que pisca por cima do app. `CREATE_NO_WINDOW` = 0x0800_0000.
///
/// **Use esta função para qualquer processo novo.** `Command::new` cru volta a
/// piscar o console e ninguém percebe até rodar o build release.
fn headless_command(program: &Path) -> tokio::process::Command {
    let mut cmd = tokio::process::Command::new(program);
    #[cfg(windows)]
    cmd.creation_flags(0x0800_0000);
    cmd
}

/// Spawna um executável (python dev ou sidecar docling), coleta stdout e
/// encaminha progresso/eventos do stderr. Retorna o stdout completo.
async fn spawn_and_collect(app: &AppHandle, program: &Path, args: &[String]) -> Result<String, String> {
    use std::process::Stdio;
    use tokio::io::{AsyncBufReadExt, AsyncReadExt, BufReader};

    let mut child = headless_command(program)
        .args(args)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("Falha ao iniciar processo: {e}"))?;

    if let Some(stderr) = child.stderr.take() {
        let app2 = app.clone();
        tokio::spawn(async move {
            let mut lines = BufReader::new(stderr).lines();
            while let Ok(Some(line)) = lines.next_line().await {
                emit_progress_lines(&app2, "tool", &format!("{line}\n"));
            }
        });
    }

    let mut stdout = String::new();
    if let Some(mut out) = child.stdout.take() {
        out.read_to_string(&mut stdout).await.map_err(|e| e.to_string())?;
    }
    let _ = child.wait().await;

    if stdout.trim().is_empty() {
        return Err("{\"success\":false,\"errorCode\":\"CONVERSION_FAILED\",\"message\":\"Conversor não retornou resposta.\"}".to_string());
    }
    Ok(stdout)
}

/// Dev: executa `python/converter.py` direto pela venv, sem PyInstaller.
#[cfg(debug_assertions)]
async fn run_dev_python(app: &AppHandle, tool: &str, input_json: &str) -> Result<String, String> {
    let root = Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .ok_or("raiz do projeto não encontrada")?;
    let python = root.join(".venv").join("Scripts").join("python.exe");
    let script = root.join("python").join("converter.py");
    let python = if python.exists() { python } else { PathBuf::from("python") };

    let args = vec![
        script.to_string_lossy().to_string(),
        "--tool".into(),
        tool.to_string(),
        "--input".into(),
        input_json.to_string(),
    ];
    spawn_and_collect(app, &python, &args).await
}

/// Release: executa um sidecar que veio de módulo baixado (Docling, Whisper).
///
/// O erro sai no mesmo formato JSON das outras falhas — o front trata como
/// resultado, não como exceção, e mostra a mensagem em pt-BR.
#[cfg(not(debug_assertions))]
async fn run_module_sidecar(
    app: &AppHandle,
    exe: Option<PathBuf>,
    codigo: &str,
    tool: &str,
    input_json: &str,
) -> Result<String, String> {
    let Some(exe) = exe.filter(|p| p.exists()) else {
        return Err(format!(
            "{{\"success\":false,\"errorCode\":\"{codigo}\",\"message\":\"Módulo necessário ainda não instalado. Baixe em Configurações → Armazenamento.\"}}"
        ));
    };
    let args = vec![
        "--tool".into(),
        tool.to_string(),
        "--input".into(),
        input_json.to_string(),
    ];
    spawn_and_collect(app, &exe, &args).await
}

/// Release: executa o sidecar PyInstaller empacotado.
#[cfg(not(debug_assertions))]
async fn run_sidecar_python(app: &AppHandle, tool: &str, input_json: &str) -> Result<String, String> {
    let sidecar = app
        .shell()
        .sidecar("converter")
        .map_err(|e| format!("Sidecar não encontrado: {e}"))?;

    let (mut rx, _child) = sidecar
        .args(["--tool", tool, "--input", input_json])
        .spawn()
        .map_err(|e| format!("Falha ao iniciar o conversor: {e}"))?;

    let mut stdout = String::new();

    while let Some(event) = rx.recv().await {
        match event {
            CommandEvent::Stdout(bytes) => {
                stdout.push_str(&String::from_utf8_lossy(&bytes));
            }
            CommandEvent::Stderr(bytes) => {
                emit_progress_lines(app, tool, &String::from_utf8_lossy(&bytes));
            }
            CommandEvent::Terminated(payload) => {
                if stdout.is_empty() {
                    let code = payload.code.unwrap_or(-1);
                    return Err(format!(
                        "{{\"success\":false,\"errorCode\":\"CONVERSION_FAILED\",\"message\":\"Conversor encerrou com código {code}.\"}}"
                    ));
                }
                break;
            }
            CommandEvent::Error(msg) => {
                return Err(format!(
                    "{{\"success\":false,\"errorCode\":\"CONVERSION_FAILED\",\"message\":\"Erro interno: {msg}\"}}"
                ));
            }
            _ => {}
        }
    }

    Ok(stdout)
}

/// PDF → Markdown (Docling). Kept for compatibility; thin wrapper over the sidecar dispatcher.
#[tauri::command]
pub async fn convert_pdf(app: AppHandle, input_json: String) -> Result<String, String> {
    run_python_tool(&app, "pdf2md", &input_json).await
}

/// Generic sidecar tool runner (md2pdf, pdf_merge, youtube, …).
#[tauri::command]
pub async fn run_tool(app: AppHandle, tool: String, input_json: String) -> Result<String, String> {
    run_python_tool(&app, &tool, &input_json).await
}

// ─── Módulos baixados sob demanda ────────────────────────────────────────────
// Tudo que é grande demais para o instalador vem de um Release do GitHub, é
// verificado por SHA256 e extraído em `appLocalData/runtime/`. Ver `RemoteModule`.
const TARGET_TRIPLE: &str = "x86_64-pc-windows-msvc";

/// Um pacote .zip hospedado num Release, baixado no primeiro uso.
struct RemoteModule {
    /// HTTPS fixo. Nunca montar a URL a partir de entrada do usuário.
    url: &'static str,
    /// SHA256 do zip. Vazio = **sem verificação de integridade** (só p/ bring-up).
    sha256: &'static str,
    /// Nome do arquivo temporário durante o download.
    zip_name: &'static str,
    /// Evento de progresso 0–100 emitido para o front.
    event: &'static str,
    /// Arquivo que prova que o módulo já está extraído.
    marker: &'static str,
    /// Rótulo em pt-BR usado nas mensagens de erro.
    label: &'static str,
}

const DOCLING: RemoteModule = RemoteModule {
    url: "https://github.com/FelipeCamposM/CAMPS-UTILS/releases/download/docling-v1/camps-docling.zip",
    sha256: "6620709852f9edeba4a8d9f4b232c2f1b70396f0286b040370eb3f789f6782bf",
    zip_name: "camps-docling.zip",
    event: "docling-progress",
    marker: "converter-docling-x86_64-pc-windows-msvc.exe",
    label: "PDF → Markdown",
};

/// ffmpeg + ffprobe. Fora do instalador porque somam 168 MB crus — mais que
/// todo o resto junto. Ver `python build.py ffmpeg` para gerar o zip e o SHA.
const FFMPEG: RemoteModule = RemoteModule {
    url: "https://github.com/FelipeCamposM/CAMPS-UTILS/releases/download/ffmpeg-v1/camps-ffmpeg.zip",
    // SHA256 de `python/dist/camps-ffmpeg.zip` gerado por `python build.py ffmpeg`.
    // O zip é reproduzível (conferido): reempacotar dá o mesmo hash.
    sha256: "2d6433b3bd6c4f795819753313cbb87249bdc6bc69b6f74820d6bb9c1577b7fb",
    zip_name: "camps-ffmpeg.zip",
    event: "ffmpeg-progress",
    marker: "ffmpeg.exe",
    label: "Mídia (ffmpeg)",
};

/// Transcrição (faster-whisper). 90 MB medidos — ver o Portão 0 em
/// `roadmaps/ia-local/roadmap.md`. Autossuficiente: o PyAV que vem junto traz
/// o próprio ffmpeg, então não depende do módulo FFMPEG estar instalado.
const WHISPER: RemoteModule = RemoteModule {
    url: "https://github.com/FelipeCamposM/CAMPS-UTILS/releases/download/whisper-v1/camps-whisper.zip",
    // SHA do `python/dist/camps-whisper.zip` gerado em 2026-08-08 e testado
    // (transcreveu um WAV em pt-BR gerando 12 blocos).
    // ⚠️ Ao contrário do zip do ffmpeg, este NÃO é reproduzível: o PyInstaller
    // carimba data e build id, então recompilar muda o hash. Publique ESTE
    // arquivo, ou refaça o build e atualize esta constante junto.
    sha256: "e406ea734fb2bb469792b8e6750d406c81f05ee09b64b64238711799b52c6d66",
    zip_name: "camps-whisper.zip",
    event: "whisper-progress",
    marker: "converter-whisper-x86_64-pc-windows-msvc.exe",
    label: "Transcrição (Whisper)",
};

/// Profundidade (Depth Anything V2 via ONNX Runtime). Fora do instalador pelo
/// mesmo motivo dos outros: onnxruntime + numpy + Pillow não cabem numa
/// atualização que o updater rebaixa inteira a cada versão.
///
/// Os PESOS (~94 MB) não estão neste zip — o `depth.py` os baixa da HuggingFace
/// no primeiro uso e guarda em `~/.cache/camps-utils/models/`, igual ao Docling
/// e ao Whisper fazem com os deles.
const DEPTH: RemoteModule = RemoteModule {
    url: "https://github.com/FelipeCamposM/CAMPS-UTILS/releases/download/depth-v1/camps-depth.zip",
    // SHA do `python/dist/camps-depth.zip` gerado em 2026-08-11 e testado: o
    // .exe empacotado gerou o mapa de um PNG com alfa em 3,0 s.
    // ⚠️ Como o do whisper, este zip NÃO é reproduzível — o PyInstaller carimba
    // data e build id. Publique ESTE arquivo, ou refaça o build e atualize esta
    // constante junto.
    sha256: "73405d9391e3c275fda9cc724ad251f8f85ccc19fd1cdd7146a63f2f813b490f",
    zip_name: "camps-depth.zip",
    event: "depth-progress",
    marker: "converter-depth-x86_64-pc-windows-msvc.exe",
    label: "Profundidade (Depth Anything V2)",
};

/// Aumento de resolução (Real-ESRGAN). É o binário **ncnn/Vulkan** do upstream,
/// não a versão PyTorch: roda em GPU de qualquer fabricante via Vulkan e pesa
/// ~40 MB contra os ~490 MB que o torch custaria. Ver a decisão registrada em
/// `roadmaps/removebg-vtracer-realesrgan/roadmap.md`.
///
/// Conteúdo: `realesrgan-ncnn-vulkan.exe` + `vcomp140.dll` (runtime OpenMP que
/// o exe exige) + `models/realesrgan-x4plus.{param,bin}`. Os outros modelos do
/// pacote upstream (anime, animevideov3) ficaram de fora — ver `MODELOS_UPSCALE`.
const REALESRGAN: RemoteModule = RemoteModule {
    url: "https://github.com/FelipeCamposM/CAMPS-UTILS/releases/download/realesrgan-v1/camps-realesrgan.zip",
    // SHA do `python/dist/camps-realesrgan.zip` (31 MB) gerado por
    // `python build.py realesrgan` em 2026-08-13. Reproduzível: reempacotar deu
    // o mesmo hash (só reagrupa binários prontos, como o do ffmpeg).
    sha256: "b83144d11525a7719b0d3ecd7d85daf46c66f90fa8402a3f754c9093dd934444",
    zip_name: "camps-realesrgan.zip",
    event: "realesrgan-progress",
    marker: "realesrgan/realesrgan-ncnn-vulkan.exe",
    label: "Aumentar qualidade (Real-ESRGAN)",
};

/// Remoção de fundo (u2net via ONNX Runtime). Mesma pilha do módulo de
/// profundidade — onnxruntime + numpy + Pillow — em bundle próprio para que
/// quem só quer tirar fundo não veja "Profundidade" na tela de download.
///
/// Os PESOS não estão no zip: `bgremove.py` os busca no primeiro uso e guarda
/// em `~/.cache/camps-utils/models/`, como o Depth faz com os dele.
const REMBG: RemoteModule = RemoteModule {
    url: "https://github.com/FelipeCamposM/CAMPS-UTILS/releases/download/rembg-v1/camps-rembg.zip",
    // SHA do `python/dist/camps-rembg.zip` (136 MB) gerado por
    // `python build.py rembg` em 2026-08-13 e testado: o .exe empacotado
    // recortou um PNG de 512×512 em 19 s (a frio, 81 s).
    // ⚠️ Como os outros bundles de PyInstaller, este NÃO é reproduzível — a
    // ferramenta carimba data e build id. Publique ESTE arquivo, ou refaça o
    // build e atualize esta constante junto.
    sha256: "ecd06bda112050fa353a9cbd7d054007e84a8660474c43758da204b93f51fe3e",
    zip_name: "camps-rembg.zip",
    event: "rembg-progress",
    marker: "converter-rembg-x86_64-pc-windows-msvc.exe",
    label: "Remover fundo (u2net)",
};

/// Captura de site (Playwright dirigindo o Edge do Windows via `channel="msedge"`,
/// sem baixar Chromium). ~46 MB medidos, na faixa do realesrgan/depth.
const WEBCAPTURE: RemoteModule = RemoteModule {
    url: "https://github.com/FelipeCamposM/CAMPS-UTILS/releases/download/webcapture-v1/camps-webcapture.zip",
    sha256: "a7990e665875256f997784a71751e940e9dd82d6f1fefb11a8557a1a1cda78f8",
    zip_name: "camps-webcapture.zip",
    event: "webcapture-progress",
    marker: "converter-webcapture-x86_64-pc-windows-msvc.exe",
    label: "Capturar site (Playwright)",
};

fn docling_exe_name() -> String {
    format!("converter-docling-{TARGET_TRIPLE}.exe")
}

fn rembg_exe_name() -> String {
    format!("converter-rembg-{TARGET_TRIPLE}.exe")
}

#[cfg(not(debug_assertions))]
fn rembg_exe_path(app: &AppHandle) -> Option<PathBuf> {
    runtime_dir(app).map(|d| d.join(rembg_exe_name()))
}

/// Informa se o módulo de remoção de fundo está pronto. Em dev, sempre true —
/// o Rust roda `converter.py` pela .venv, que precisa ter onnxruntime.
#[tauri::command]
pub async fn rembg_installed(app: AppHandle) -> bool {
    #[cfg(debug_assertions)]
    {
        let _ = app;
        true
    }
    #[cfg(not(debug_assertions))]
    {
        module_installed(&app, &REMBG)
    }
}

/// Baixa e extrai o módulo de remoção de fundo. Emite `rembg-progress` (0–100).
#[tauri::command]
pub async fn ensure_rembg(app: AppHandle) -> Result<(), String> {
    #[cfg(debug_assertions)]
    {
        let _ = app;
        return Ok(());
    }
    #[cfg(not(debug_assertions))]
    {
        ensure_module(&app, &REMBG).await
    }
}

fn webcapture_exe_name() -> String {
    format!("converter-webcapture-{TARGET_TRIPLE}.exe")
}

#[cfg(not(debug_assertions))]
fn webcapture_exe_path(app: &AppHandle) -> Option<PathBuf> {
    runtime_dir(app).map(|d| d.join(webcapture_exe_name()))
}

/// Informa se o módulo de captura de site está pronto. Em dev, sempre true —
/// o Rust roda `converter.py` pela .venv, que precisa ter playwright.
#[tauri::command]
pub async fn webcapture_installed(app: AppHandle) -> bool {
    #[cfg(debug_assertions)]
    {
        let _ = app;
        true
    }
    #[cfg(not(debug_assertions))]
    {
        module_installed(&app, &WEBCAPTURE)
    }
}

/// Baixa e extrai o módulo de captura de site. Emite `webcapture-progress` (0–100).
#[tauri::command]
pub async fn ensure_webcapture(app: AppHandle) -> Result<(), String> {
    #[cfg(debug_assertions)]
    {
        let _ = app;
        return Ok(());
    }
    #[cfg(not(debug_assertions))]
    {
        ensure_module(&app, &WEBCAPTURE).await
    }
}

fn depth_exe_name() -> String {
    format!("converter-depth-{TARGET_TRIPLE}.exe")
}

#[cfg(not(debug_assertions))]
fn depth_exe_path(app: &AppHandle) -> Option<PathBuf> {
    runtime_dir(app).map(|d| d.join(depth_exe_name()))
}

/// Informa se o módulo de profundidade está pronto. Em dev, sempre true —
/// o Rust roda `converter.py` pela .venv, que precisa ter onnxruntime.
#[tauri::command]
pub async fn depth_installed(app: AppHandle) -> bool {
    #[cfg(debug_assertions)]
    {
        let _ = app;
        true
    }
    #[cfg(not(debug_assertions))]
    {
        module_installed(&app, &DEPTH)
    }
}

/// Baixa e extrai o módulo de profundidade. Emite `depth-progress` (0–100).
#[tauri::command]
pub async fn ensure_depth(app: AppHandle) -> Result<(), String> {
    #[cfg(debug_assertions)]
    {
        let _ = app;
        return Ok(());
    }
    #[cfg(not(debug_assertions))]
    {
        ensure_module(&app, &DEPTH).await
    }
}

fn whisper_exe_name() -> String {
    format!("converter-whisper-{TARGET_TRIPLE}.exe")
}

#[cfg(not(debug_assertions))]
fn whisper_exe_path(app: &AppHandle) -> Option<PathBuf> {
    runtime_dir(app).map(|d| d.join(whisper_exe_name()))
}

/// Informa se o módulo de transcrição está pronto. Em dev, sempre true —
/// o Rust roda `converter.py` pela .venv, que precisa ter faster-whisper.
#[tauri::command]
pub async fn whisper_installed(app: AppHandle) -> bool {
    #[cfg(debug_assertions)]
    {
        let _ = app;
        true
    }
    #[cfg(not(debug_assertions))]
    {
        module_installed(&app, &WHISPER)
    }
}

/// Baixa e extrai o módulo de transcrição. Emite `whisper-progress` (0–100).
#[tauri::command]
pub async fn ensure_whisper(app: AppHandle) -> Result<(), String> {
    #[cfg(debug_assertions)]
    {
        let _ = app;
        return Ok(());
    }
    #[cfg(not(debug_assertions))]
    {
        ensure_module(&app, &WHISPER).await
    }
}

/// Destino de todo módulo baixado. Sobrevive a atualizações do app (fica fora
/// do diretório de instalação), então um update não força rebaixar 700 MB.
fn runtime_dir(app: &AppHandle) -> Option<PathBuf> {
    app.path().app_local_data_dir().ok().map(|d| d.join("runtime"))
}

fn docling_runtime_dir(app: &AppHandle) -> Option<PathBuf> {
    runtime_dir(app)
}

fn docling_exe_path(app: &AppHandle) -> Option<PathBuf> {
    runtime_dir(app).map(|d| d.join(docling_exe_name()))
}

fn module_installed(app: &AppHandle, m: &RemoteModule) -> bool {
    runtime_dir(app)
        .map(|d| d.join(m.marker).exists())
        .unwrap_or(false)
}

/// Informa se o módulo Docling está pronto. Em dev, sempre true (roda a fonte).
#[tauri::command]
pub async fn docling_installed(app: AppHandle) -> bool {
    #[cfg(debug_assertions)]
    {
        let _ = app;
        true
    }
    #[cfg(not(debug_assertions))]
    {
        module_installed(&app, &DOCLING)
    }
}

/// Informa se o ffmpeg está disponível. Sem `cfg`: em dev ele é achado em
/// `src-tauri/binaries/`, em produção na pasta `runtime` após o download — as
/// duas coisas que `resolve_bundled` já sabe procurar.
#[tauri::command]
pub async fn ffmpeg_installed(app: AppHandle) -> bool {
    resolve_bundled(&app, "ffmpeg.exe").is_some()
}

/// Baixa e extrai o ffmpeg/ffprobe. Emite `ffmpeg-progress` (0–100).
#[tauri::command]
pub async fn ensure_ffmpeg(app: AppHandle) -> Result<(), String> {
    if resolve_bundled(&app, "ffmpeg.exe").is_some() {
        return Ok(());
    }
    ensure_module(&app, &FFMPEG).await
}

/// Caminho do binário do Real-ESRGAN. Sem `cfg`, pelo mesmo motivo do ffmpeg:
/// em dev está em `src-tauri/binaries/realesrgan/`, em produção na `runtime/`
/// depois do download — os dois casos que `resolve_bundled` já cobre.
fn resolve_realesrgan(app: &AppHandle) -> Option<PathBuf> {
    resolve_bundled(app, "realesrgan/realesrgan-ncnn-vulkan.exe")
}

#[tauri::command]
pub async fn realesrgan_installed(app: AppHandle) -> bool {
    resolve_realesrgan(&app).is_some()
}

/// Baixa e extrai o Real-ESRGAN. Emite `realesrgan-progress` (0–100).
#[tauri::command]
pub async fn ensure_realesrgan(app: AppHandle) -> Result<(), String> {
    if resolve_realesrgan(&app).is_some() {
        return Ok(());
    }
    ensure_module(&app, &REALESRGAN).await
}

/// Percorre `dir` recursivamente coletando cada arquivo com seu caminho
/// relativo a `base` (o que vira o nome da entrada dentro do zip).
fn walk_files(base: &Path, dir: &Path, out: &mut Vec<(PathBuf, String)>) -> Result<(), String> {
    for entry in std::fs::read_dir(dir).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let path = entry.path();
        if path.is_dir() {
            walk_files(base, &path, out)?;
        } else {
            let rel = path
                .strip_prefix(base)
                .map_err(|e| e.to_string())?
                .to_string_lossy()
                .replace('\\', "/");
            out.push((path, rel));
        }
    }
    Ok(())
}

fn create_zip_blocking(source_dir: &Path, dest_zip: &Path) -> Result<(), String> {
    let mut files = Vec::new();
    walk_files(source_dir, source_dir, &mut files)?;

    let file = std::fs::File::create(dest_zip).map_err(|e| e.to_string())?;
    let mut zip = zip::ZipWriter::new(file);
    let options: zip::write::FileOptions<()> =
        zip::write::FileOptions::default().compression_method(zip::CompressionMethod::Deflated);

    for (path, name) in files {
        zip.start_file(name, options).map_err(|e| e.to_string())?;
        let mut f = std::fs::File::open(&path).map_err(|e| e.to_string())?;
        std::io::copy(&mut f, &mut zip).map_err(|e| e.to_string())?;
    }
    zip.finish().map_err(|e| e.to_string())?;
    Ok(())
}

/// Compacta `source_dir` inteiro em `dest_zip` (usado, p.ex., para exportar uma
/// captura de site como zip). Roda em `spawn_blocking` — I/O pesado não pode
/// travar o runtime async.
#[tauri::command]
pub async fn create_zip(source_dir: String, dest_zip: String) -> Result<(), String> {
    tokio::task::spawn_blocking(move || create_zip_blocking(Path::new(&source_dir), Path::new(&dest_zip)))
        .await
        .map_err(|e| e.to_string())?
}

fn extract_zip(zip_path: &Path, dest: &Path) -> Result<(), String> {
    let file = std::fs::File::open(zip_path).map_err(|e| e.to_string())?;
    let mut archive = zip::ZipArchive::new(file).map_err(|e| e.to_string())?;
    for i in 0..archive.len() {
        let mut entry = archive.by_index(i).map_err(|e| e.to_string())?;
        let out = dest.join(entry.name());
        if entry.is_dir() {
            std::fs::create_dir_all(&out).map_err(|e| e.to_string())?;
        } else {
            if let Some(p) = out.parent() {
                std::fs::create_dir_all(p).map_err(|e| e.to_string())?;
            }
            let mut o = std::fs::File::create(&out).map_err(|e| e.to_string())?;
            std::io::copy(&mut entry, &mut o).map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

/// Baixa, verifica e extrai um módulo em `runtime/`. Streaming: o zip nunca
/// fica inteiro em memória (o do Docling tem ~700 MB).
async fn ensure_module(app: &AppHandle, m: &RemoteModule) -> Result<(), String> {
    use futures_util::StreamExt;
    use sha2::Digest;
    use tokio::io::AsyncWriteExt;

    let dir = runtime_dir(app).ok_or("pasta local não encontrada")?;
    let marker = dir.join(m.marker);
    if marker.exists() {
        return Ok(());
    }
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;

    let resp = reqwest::get(m.url)
        .await
        .map_err(|e| format!("Falha no download: {e}"))?;
    if !resp.status().is_success() {
        return Err(format!("Download retornou HTTP {}.", resp.status()));
    }
    let total = resp.content_length().unwrap_or(0);

    let tmp = dir.join(format!("{}.part", m.zip_name));
    let mut out = tokio::fs::File::create(&tmp).await.map_err(|e| e.to_string())?;
    let mut hasher = sha2::Sha256::new();
    let mut downloaded: u64 = 0;
    let mut stream = resp.bytes_stream();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| e.to_string())?;
        hasher.update(&chunk);
        out.write_all(&chunk).await.map_err(|e| e.to_string())?;
        downloaded += chunk.len() as u64;
        if total > 0 {
            let pct = (downloaded * 100 / total) as u32;
            let _ = app.emit(m.event, pct);
        }
    }
    out.flush().await.ok();
    drop(out);

    if m.sha256.is_empty() {
        // Não é fatal p/ não travar o bring-up de um módulo novo, mas some do
        // radar num log — publicar sem SHA é aceitar binário não verificado.
        eprintln!("[modulo/{}] AVISO: sem SHA256, integridade NAO verificada", m.label);
    } else {
        let got = hex::encode(hasher.finalize());
        if !got.eq_ignore_ascii_case(m.sha256) {
            std::fs::remove_file(&tmp).ok();
            return Err("Verificação de integridade (SHA256) falhou.".to_string());
        }
    }

    let tmp2 = tmp.clone();
    let dir2 = dir.clone();
    tokio::task::spawn_blocking(move || extract_zip(&tmp2, &dir2))
        .await
        .map_err(|e| e.to_string())??;
    std::fs::remove_file(&tmp).ok();

    if !marker.exists() {
        return Err(format!(
            "Módulo {} extraído, mas {} não apareceu.",
            m.label, m.marker
        ));
    }
    let _ = app.emit(m.event, 100u32);
    Ok(())
}

/// Baixa e extrai o módulo Docling do GitHub Release (se ainda não presente).
/// Emite `docling-progress` (0–100). Em dev é no-op (roda a fonte pela venv).
#[tauri::command]
pub async fn ensure_docling(app: AppHandle) -> Result<(), String> {
    #[cfg(debug_assertions)]
    {
        let _ = app;
        return Ok(());
    }
    #[cfg(not(debug_assertions))]
    {
        ensure_module(&app, &DOCLING).await
    }
}

/// Acha um binário auxiliar, na ordem: módulo baixado → resource do bundle →
/// pasta do repo (dev) → ao lado do exe.
///
/// A pasta `runtime` vem primeiro porque é o único caminho que existe em
/// produção depois que o ffmpeg saiu do instalador; os outros três seguem
/// valendo para dev e para binários que continuam empacotados.
fn resolve_bundled(app: &AppHandle, name: &str) -> Option<PathBuf> {
    if let Some(p) = runtime_dir(app).map(|d| d.join(name)) {
        if p.exists() {
            return Some(p);
        }
    }
    if let Ok(p) = app.path().resolve(format!("binaries/{name}"), BaseDirectory::Resource) {
        if p.exists() {
            return Some(p);
        }
    }
    let dev = Path::new(env!("CARGO_MANIFEST_DIR")).join("binaries").join(name);
    if dev.exists() {
        return Some(dev);
    }
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            let p = dir.join(name);
            if p.exists() {
                return Some(p);
            }
        }
    }
    None
}

/// Mensagem única de ffmpeg ausente — o front usa isso p/ mandar o usuário
/// baixar o módulo em vez de mostrar "erro desconhecido".
const FFMPEG_AUSENTE: &str =
    "Módulo de mídia (ffmpeg) não instalado. Baixe em Configurações → Armazenamento.";

fn resolve_ffmpeg(app: &AppHandle) -> Option<String> {
    resolve_bundled(app, "ffmpeg.exe").map(|p| p.to_string_lossy().to_string())
}

async fn probe_duration(ffprobe: &Path, input: &str) -> f64 {
    headless_command(ffprobe)
        .args(["-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", input])
        .output()
        .await
        .ok()
        .and_then(|o| String::from_utf8(o.stdout).ok())
        .and_then(|s| s.trim().parse::<f64>().ok())
        .unwrap_or(0.0)
}

/// Roda o ffmpeg emitindo `tool-progress` (usa `-progress pipe:1` + duração total).
/// Traduz a cauda do stderr do ffmpeg numa mensagem que ajuda quem lê.
///
/// As causas conhecidas viram texto acionável; o resto sai cru, porque uma
/// linha do ffmpeg é sempre melhor que "falhou" e sem ela não há como
/// diagnosticar depois.
fn erro_do_ffmpeg(cauda: &std::sync::Mutex<std::collections::VecDeque<String>>) -> String {
    let linhas: Vec<String> = cauda
        .lock()
        .map(|c| c.iter().cloned().collect())
        .unwrap_or_default();
    let texto = linhas.join("\n");
    let baixo = texto.to_lowercase();

    // Caso clássico do .mov: áudio PCM/ProRes que o contêiner MP4 não aceita
    // com `-c:a copy`. A mensagem do ffmpeg fala de "tag for codec", que não
    // diz nada para quem só quer legendar um vídeo.
    if baixo.contains("could not find tag for codec") {
        return "O áudio deste arquivo não é compatível com MP4 e precisa ser reconvertido. \
                Tente de novo — se persistir, converta o vídeo antes em Comprimir vídeo."
            .to_string();
    }
    if baixo.contains("no such file or directory") {
        return "ffmpeg não encontrou um dos arquivos (vídeo ou legenda).".to_string();
    }
    if baixo.contains("permission denied") {
        return "Sem permissão para gravar no destino escolhido.".to_string();
    }
    if baixo.contains("invalid data found") {
        return "O arquivo de vídeo parece corrompido ou incompleto.".to_string();
    }
    if baixo.contains("unknown encoder") || baixo.contains("cannot load") {
        return format!("A placa de vídeo recusou a codificação. Detalhe do ffmpeg:\n{texto}");
    }

    if texto.trim().is_empty() {
        "ffmpeg falhou sem dizer o motivo.".to_string()
    } else {
        format!("ffmpeg falhou:\n{texto}")
    }
}

async fn ffmpeg_run_progress(
    app: &AppHandle,
    ffmpeg: &Path,
    args: Vec<String>,
    total: f64,
) -> Result<(), String> {
    use std::process::Stdio;
    use tokio::io::{AsyncBufReadExt, BufReader};

    let mut child = headless_command(ffmpeg)
        .args(&args)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("Falha ao iniciar ffmpeg: {e}"))?;

    if let Some(out) = child.stdout.take() {
        let app2 = app.clone();
        tokio::spawn(async move {
            let mut lines = BufReader::new(out).lines();
            while let Ok(Some(line)) = lines.next_line().await {
                if let Some(v) = line.strip_prefix("out_time_us=") {
                    if total > 0.0 {
                        if let Ok(us) = v.trim().parse::<f64>() {
                            let pct = ((us / 1_000_000.0) / total * 100.0).clamp(0.0, 100.0) as u32;
                            let _ = app2.emit("tool-progress", pct);
                        }
                    }
                }
            }
        });
    }
    // O stderr do ffmpeg PRECISA ser guardado, não só drenado: é o único lugar
    // onde ele diz por que falhou. Antes era lido e descartado, e todo erro
    // virava "ffmpeg falhou." — impossível diagnosticar, tanto para o usuário
    // quanto para quem for depurar.
    //
    // Guardar só a cauda: o ffmpeg escreve dezenas de linhas de banner e
    // metadados, e a causa está sempre nas últimas.
    let cauda = std::sync::Arc::new(std::sync::Mutex::new(std::collections::VecDeque::<String>::new()));
    if let Some(err) = child.stderr.take() {
        let cauda2 = cauda.clone();
        tokio::spawn(async move {
            let mut lines = BufReader::new(err).lines();
            while let Ok(Some(linha)) = lines.next_line().await {
                if let Ok(mut c) = cauda2.lock() {
                    if c.len() == 12 {
                        c.pop_front();
                    }
                    c.push_back(linha);
                }
            }
        });
    }

    let status = child.wait().await.map_err(|e| e.to_string())?;
    if !status.success() {
        return Err(erro_do_ffmpeg(&cauda));
    }
    let _ = app.emit("tool-progress", 100u32);
    Ok(())
}

/// Roda o ffmpeg sem progresso (operações rápidas em lote).
async fn ffmpeg_run(ffmpeg: &Path, args: &[String]) -> Result<(), String> {
    use std::process::Stdio;
    let status = headless_command(ffmpeg)
        .args(args)
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .await
        .map_err(|e| format!("Falha ao iniciar ffmpeg: {e}"))?;
    if !status.success() {
        return Err("ffmpeg falhou.".to_string());
    }
    Ok(())
}

#[derive(serde::Deserialize)]
pub struct CompressVideoArgs {
    input: String,
    output: String,
    crf: Option<u8>,
    preset: Option<String>,
}

// ─── Escolha do encoder de vídeo ─────────────────────────────────────────────
// Queimar legenda recodifica o vídeo inteiro. Em placa com encoder dedicado
// isso cai de dezenas de minutos para poucos — a maior diferença de tempo do
// app inteiro.

/// Candidatos em ordem de preferência, com os argumentos de qualidade de cada.
///
/// O `q` recebido é "estilo CRF" do x264 (menor = melhor). Cada encoder tem a
/// própria escala, e **passar o número cru produz arquivo inchado**: medido
/// aqui, `cq=20` no NVENC deu 9,75 MB onde o `crf=20` do x264 deu 3,88 MB —
/// 151% a mais pela mesma qualidade nominal. Daí o deslocamento por encoder.
///
/// Calibração: no NVENC, `crf 20` equivale a `cq ~32` em tamanho de arquivo
/// (medido: cq30 → 4,60 MB, cq34 → 3,37 MB, alvo 3,88 MB). O deslocamento das
/// outras duas é conservador e **não foi medido** — esta máquina só tem NVIDIA.
/// Se aparecer relato de arquivo grande em Intel ou AMD, é o primeiro suspeito.
///
/// `h264_mf` (MediaFoundation) ficou de fora de propósito: aceita quase tudo,
/// mas o controle de qualidade é impreciso e o libx264 é um plano B melhor.
type ArgsQualidade = fn(u8) -> Vec<String>;

/// Soma sem estourar o teto da escala.
fn desloca(q: u8, delta: u8) -> String {
    q.saturating_add(delta).min(51).to_string()
}

const ENCODERS: &[(&str, ArgsQualidade)] = &[
    ("h264_nvenc", |q| {
        // p5 = equilíbrio. p7 foi testado e não compensa: mesmo tempo (a GPU
        // não é o gargalo) e arquivo maior.
        vec!["-preset".into(), "p5".into(), "-rc".into(), "vbr".into(),
             "-cq".into(), desloca(q, 12), "-b:v".into(), "0".into()]
    }),
    ("h264_qsv", |q| {
        vec!["-global_quality".into(), desloca(q, 6),
             "-look_ahead".into(), "0".into()]
    }),
    ("h264_amf", |q| {
        vec!["-rc".into(), "cqp".into(),
             "-qp_i".into(), desloca(q, 8), "-qp_p".into(), desloca(q, 8)]
    }),
];

const ENCODER_CPU: (&str, ArgsQualidade) = ("libx264", |q| {
    vec!["-preset".into(), "medium".into(), "-crf".into(), q.to_string()]
});

/// Detectado uma vez por execução do app — cada tentativa custa um processo.
static ENCODER_ESCOLHIDO: tokio::sync::OnceCell<String> = tokio::sync::OnceCell::const_new();

/// Testa se o encoder realmente funciona nesta máquina.
///
/// Ter `h264_nvenc` compilado no ffmpeg não diz nada sobre haver GPU NVIDIA —
/// a única resposta confiável é tentar codificar e ver se o processo sai zero.
async fn encoder_funciona(ffmpeg: &Path, codec: &str) -> bool {
    let args = [
        "-hide_banner", "-loglevel", "error",
        "-f", "lavfi", "-i", "nullsrc=s=256x144:d=0.1",
        "-c:v", codec, "-f", "null", "-",
    ];
    matches!(
        headless_command(ffmpeg).args(args).output().await,
        Ok(saida) if saida.status.success()
    )
}

/// Melhor encoder disponível: GPU quando houver, CPU como plano B.
async fn escolher_encoder(ffmpeg: &Path) -> (&'static str, ArgsQualidade) {
    let nome = ENCODER_ESCOLHIDO
        .get_or_init(|| async {
            for (codec, _) in ENCODERS {
                if encoder_funciona(ffmpeg, codec).await {
                    eprintln!("[encoder] usando {codec} (hardware)");
                    return codec.to_string();
                }
            }
            eprintln!("[encoder] nenhum encoder de hardware disponível, usando libx264");
            ENCODER_CPU.0.to_string()
        })
        .await;

    ENCODERS
        .iter()
        .find(|(c, _)| c == nome)
        .copied()
        .unwrap_or(ENCODER_CPU)
}

/// Nome do encoder que será usado. Só para a interface informar o usuário.
#[tauri::command]
pub async fn video_encoder(app: AppHandle) -> String {
    match resolve_bundled(&app, "ffmpeg.exe") {
        Some(ff) => escolher_encoder(&ff).await.0.to_string(),
        None => ENCODER_CPU.0.to_string(),
    }
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BurnSubtitlesArgs {
    /// Vídeo de entrada.
    input: String,
    /// Legenda .ass (ou .srt) já gerada.
    subtitles: String,
    output: String,
    /// false = grava a legenda como faixa, sem recodificar (instantâneo).
    burn: Option<bool>,
    crf: Option<u8>,
}

/// Caminho de arquivo dentro de um filtro do ffmpeg.
///
/// O `-vf` tem sintaxe própria: `:` separa argumentos e `\` escapa. Um caminho
/// do Windows (`C:\Users\...`) entra cru como se fosse sintaxe de filtro e o
/// ffmpeg falha com um erro que não fala nada de caminho. A ordem importa:
/// escapar a barra invertida primeiro, senão as escapadas seguintes viram alvo.
fn escapar_para_filtro(p: &str) -> String {
    p.replace('\\', "/").replace(':', "\\:").replace('\'', "\\'")
}

/// Pasta com as fontes empacotadas, entregue ao libass via `fontsdir`.
///
/// Sem isto o libass só enxerga as fontes instaladas no Windows, e uma legenda
/// feita com fonte empacotada sairia renderizada em Arial sem nenhum aviso.
fn fontes_dir(app: &AppHandle) -> Option<PathBuf> {
    if let Ok(p) = app.path().resolve("fonts", BaseDirectory::Resource) {
        if p.is_dir() {
            return Some(p);
        }
    }
    // Dev: rodando pelo `tauri dev`, os recursos ainda não foram copiados.
    let dev = Path::new(env!("CARGO_MANIFEST_DIR")).parent()?.join("assets").join("fonts");
    dev.is_dir().then_some(dev)
}

/// Famílias de fonte instaladas no sistema, em ordem alfabética.
///
/// Lê o registro porque é lá que mora o NOME DE FAMÍLIA — que é por onde o
/// libass casa a fonte. Varrer `C:\Windows\Fonts` daria nome de arquivo
/// (`seguibl.ttf`), que não serve para nada no `.ass`.
#[tauri::command]
pub async fn system_fonts() -> Result<Vec<String>, String> {
    #[cfg(windows)]
    {
        use winreg::enums::HKEY_LOCAL_MACHINE;
        use winreg::RegKey;

        let hklm = RegKey::predef(HKEY_LOCAL_MACHINE);
        let chave = hklm
            .open_subkey(r"SOFTWARE\Microsoft\Windows NT\CurrentVersion\Fonts")
            .map_err(|e| e.to_string())?;

        let mut nomes: Vec<String> = chave
            .enum_values()
            .filter_map(|v| v.ok())
            .filter_map(|(nome, _)| {
                // O registro guarda "Arial (TrueType)" e "Arial Negrito
                // (TrueType)". O sufixo do tipo não é parte do nome da família.
                let limpo = nome
                    .rsplit_once(" (")
                    .map(|(n, _)| n)
                    .unwrap_or(&nome)
                    .trim()
                    .to_string();
                (!limpo.is_empty()).then_some(limpo)
            })
            .collect();

        nomes.sort_by_key(|n| n.to_lowercase());
        nomes.dedup();
        Ok(nomes)
    }
    #[cfg(not(windows))]
    {
        Ok(Vec::new())
    }
}

/// Grava a legenda no vídeo — queimada na imagem ou como faixa selecionável.
///
/// Queimar recodifica o vídeo inteiro (a legenda vira pixel), então é a
/// operação mais lenta do app. Como faixa é instantâneo, mas Instagram e TikTok
/// ignoram — daí as duas opções.
#[tauri::command]
pub async fn burn_subtitles(app: AppHandle, args: BurnSubtitlesArgs) -> Result<String, String> {
    let ffmpeg = resolve_bundled(&app, "ffmpeg.exe").ok_or(FFMPEG_AUSENTE)?;
    if !Path::new(&args.subtitles).exists() {
        return Err("Arquivo de legenda não encontrado.".to_string());
    }
    let total = match resolve_bundled(&app, "ffprobe.exe") {
        Some(fp) => probe_duration(&fp, &args.input).await,
        None => 0.0,
    };

    let ff_args: Vec<String> = if args.burn.unwrap_or(true) {
        // ⚠️ `fontsdir` também passa pelo escape: um `C:` cru vira separador de
        // opção do filtro e o ffmpeg falha com um erro que não fala de fonte.
        // `scale` ANTES do `ass`, e não depois: assim a legenda é desenhada já
        // no tamanho final, sem passar por reamostragem (que borraria o
        // contorno).
        //
        // ⚠️ O H.264 exige largura e altura PARES — libx264 recusa ímpar com
        // "Invalid argument" e nada é escrito. Um .mov de editor ou gravador de
        // tela pode ter dimensão ímpar, porque ProRes e MJPEG aceitam. Quando já
        // é par, isto é passagem direta.
        let par = "scale=trunc(iw/2)*2:trunc(ih/2)*2";
        let ass = match fontes_dir(&app) {
            Some(dir) => format!(
                "ass='{}':fontsdir='{}'",
                escapar_para_filtro(&args.subtitles),
                escapar_para_filtro(&dir.to_string_lossy())
            ),
            None => format!("ass='{}'", escapar_para_filtro(&args.subtitles)),
        };
        let filtro = format!("{par},{ass}");
        // Qualidade 20 (e não os 28 do compressor): a legenda tem borda dura e
        // compressão agressiva suja o contorno.
        let q = args.crf.unwrap_or(20).clamp(0, 51);
        let (codec, args_q) = escolher_encoder(&ffmpeg).await;

        let mut v: Vec<String> = vec![
            "-y".into(), "-i".into(), args.input.clone(),
            "-vf".into(), filtro,
            "-c:v".into(), codec.into(),
        ];
        v.extend(args_q(q));
        v.extend([
            "-c:a".into(), "copy".into(),
            "-progress".into(), "pipe:1".into(), "-nostats".into(),
            args.output.clone(),
        ]);
        v
    } else {
        vec![
            "-y".into(), "-i".into(), args.input.clone(),
            "-i".into(), args.subtitles.clone(),
            "-c".into(), "copy".into(),
            // mov_text é o único codec de legenda que MP4 aceita.
            "-c:s".into(), "mov_text".into(),
            "-metadata:s:s:0".into(), "language=por".into(),
            "-progress".into(), "pipe:1".into(), "-nostats".into(),
            args.output.clone(),
        ]
    };

    ffmpeg_run_progress(&app, &ffmpeg, ff_args, total).await?;
    Ok(args.output)
}

/// Comprime um vídeo (re-encode H.264) usando o ffmpeg empacotado.
#[tauri::command]
pub async fn compress_video(app: AppHandle, args: CompressVideoArgs) -> Result<String, String> {
    let ffmpeg = resolve_bundled(&app, "ffmpeg.exe").ok_or(FFMPEG_AUSENTE)?;
    let total = match resolve_bundled(&app, "ffprobe.exe") {
        Some(fp) => probe_duration(&fp, &args.input).await,
        None => 0.0,
    };
    let crf = args.crf.unwrap_or(28).clamp(0, 51).to_string();
    let preset = args.preset.unwrap_or_else(|| "medium".to_string());

    let ff_args: Vec<String> = vec![
        "-y", "-i", &args.input,
        "-c:v", "libx264", "-crf", &crf, "-preset", &preset,
        "-c:a", "aac", "-b:a", "128k",
        "-progress", "pipe:1", "-nostats",
        &args.output,
    ]
    .into_iter()
    .map(String::from)
    .collect();

    ffmpeg_run_progress(&app, &ffmpeg, ff_args, total).await?;
    Ok(args.output)
}

#[derive(serde::Deserialize)]
pub struct AudioConvertArgs {
    inputs: Vec<String>,
    out_dir: String,
    format: String,
    bitrate: Option<u32>,
}

/// Converte áudios em lote (mp3/wav/flac) via ffmpeg empacotado. Retorna caminhos.
#[tauri::command]
pub async fn convert_audio(app: AppHandle, args: AudioConvertArgs) -> Result<Vec<String>, String> {
    let ffmpeg = resolve_bundled(&app, "ffmpeg.exe").ok_or(FFMPEG_AUSENTE)?;
    let fmt = args.format.to_lowercase();
    let bitrate = args.bitrate.unwrap_or(192);

    let dir = PathBuf::from(&args.out_dir);
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;

    let mut outputs = Vec::with_capacity(args.inputs.len());
    for input in &args.inputs {
        let stem = Path::new(input)
            .file_stem()
            .and_then(|s| s.to_str())
            .ok_or("nome de arquivo inválido")?;
        let out_path = dir.join(format!("{stem}.{fmt}"));
        let out_str = out_path.to_string_lossy().to_string();

        let mut ff_args: Vec<String> = vec!["-y".into(), "-i".into(), input.clone()];
        match fmt.as_str() {
            "mp3" => {
                ff_args.extend(["-c:a".into(), "libmp3lame".into(), "-b:a".into(), format!("{bitrate}k")]);
            }
            "wav" => {
                ff_args.extend(["-c:a".into(), "pcm_s16le".into()]);
            }
            "flac" => {
                ff_args.extend(["-c:a".into(), "flac".into()]);
            }
            other => return Err(format!("formato de áudio não suportado: {other}")),
        }
        ff_args.push(out_str.clone());

        ffmpeg_run(&ffmpeg, &ff_args)
            .await
            .map_err(|e| format!("{input}: {e}"))?;
        outputs.push(out_str);
    }
    Ok(outputs)
}

#[derive(serde::Deserialize)]
pub struct GifArgs {
    input: String,
    output: String,
    fps: Option<u32>,
    width: Option<u32>,
    start: Option<f64>,
    duration: Option<f64>,
}

/// Converte um trecho de vídeo em GIF via ffmpeg empacotado.
#[tauri::command]
pub async fn video_to_gif(app: AppHandle, args: GifArgs) -> Result<String, String> {
    let ffmpeg = resolve_bundled(&app, "ffmpeg.exe").ok_or(FFMPEG_AUSENTE)?;
    let fps = args.fps.unwrap_or(12).clamp(1, 50);
    let width = args.width.unwrap_or(480).clamp(64, 1920);

    let total = match args.duration {
        Some(d) if d > 0.0 => d,
        _ => match resolve_bundled(&app, "ffprobe.exe") {
            Some(fp) => probe_duration(&fp, &args.input).await,
            None => 0.0,
        },
    };

    let mut ff_args: Vec<String> = vec!["-y".into()];
    if let Some(s) = args.start {
        ff_args.extend(["-ss".into(), s.to_string()]);
    }
    if let Some(d) = args.duration {
        ff_args.extend(["-t".into(), d.to_string()]);
    }
    ff_args.extend([
        "-i".into(),
        args.input.clone(),
        "-vf".into(),
        format!("fps={fps},scale={width}:-1:flags=lanczos"),
        "-progress".into(),
        "pipe:1".into(),
        "-nostats".into(),
        args.output.clone(),
    ]);

    ffmpeg_run_progress(&app, &ffmpeg, ff_args, total).await?;
    Ok(args.output)
}

/// Busca metadados do vídeo (título, thumbnail, qualidades) sem baixar.
#[tauri::command]
pub async fn youtube_info(app: AppHandle, url: String) -> Result<String, String> {
    let input = serde_json::json!({ "url": url }).to_string();
    run_python_tool(&app, "youtube_info", &input).await
}

/// Baixa vídeo/música do YouTube via yt-dlp, usando o ffmpeg empacotado.
/// mode: "audio" | "video" | "playlist_audio". Emite eventos `tool-progress`.
#[tauri::command]
pub async fn download_youtube(
    app: AppHandle,
    url: String,
    mode: String,
    output_dir: String,
    audio_kbps: Option<u32>,
    max_height: Option<u32>,
) -> Result<String, String> {
    let ffmpeg = resolve_ffmpeg(&app);
    let input = serde_json::json!({
        "url": url,
        "mode": mode,
        "outputDir": output_dir,
        "audioKbps": audio_kbps,
        "maxHeight": max_height,
        "ffmpegLocation": ffmpeg,
    })
    .to_string();
    run_python_tool(&app, "youtube", &input).await
}

#[derive(serde::Deserialize)]
pub struct ImageConvertArgs {
    inputs: Vec<String>,
    format: String,
    out_dir: Option<String>,
    quality: Option<u8>,
}

/// Batch image conversion (webp/png/jpg/ico), native via the `image`/`webp` crates.
/// Returns the list of output paths.
#[tauri::command]
pub async fn convert_images(args: ImageConvertArgs) -> Result<Vec<String>, String> {
    let quality = args.quality.unwrap_or(85).clamp(1, 100);
    let fmt = args.format.to_lowercase();
    let mut outputs = Vec::with_capacity(args.inputs.len());
    for input in &args.inputs {
        let out = convert_one_image(input, &fmt, args.out_dir.as_deref(), quality)
            .map_err(|e| format!("{input}: {e}"))?;
        outputs.push(out);
    }
    Ok(outputs)
}

fn ext_for(fmt: &str) -> &str {
    match fmt {
        "jpeg" => "jpg",
        other => other,
    }
}

/// Codifica uma imagem já decodificada em memória.
///
/// Separado de `write_image` porque a busca binária de `compress_images`
/// precisa MEDIR o tamanho de várias qualidades sem tocar no disco.
fn encode_image(img: &image::DynamicImage, fmt: &str, quality: u8) -> Result<Vec<u8>, String> {
    let mut buf: Vec<u8> = Vec::new();
    match fmt {
        "webp" => {
            let encoder = webp::Encoder::from_image(img).map_err(|e| e.to_string())?;
            buf = encoder.encode(quality as f32).to_vec();
        }
        "png" => {
            // `quality` é inerte aqui: PNG é sem perdas (a UI avisa disso).
            img.write_to(&mut std::io::Cursor::new(&mut buf), image::ImageFormat::Png)
                .map_err(|e| e.to_string())?;
        }
        "jpg" | "jpeg" => {
            let rgb = img.to_rgb8();
            let mut cursor = std::io::Cursor::new(&mut buf);
            let mut encoder =
                image::codecs::jpeg::JpegEncoder::new_with_quality(&mut cursor, quality);
            encoder.encode_image(&rgb).map_err(|e| e.to_string())?;
        }
        "ico" => {
            // ICO máximo é 256x256 — reduz se necessário.
            let icon = if img.width() > 256 || img.height() > 256 {
                img.resize(256, 256, image::imageops::FilterType::Lanczos3)
            } else {
                img.clone()
            };
            icon.write_to(&mut std::io::Cursor::new(&mut buf), image::ImageFormat::Ico)
                .map_err(|e| e.to_string())?;
        }
        other => return Err(format!("formato não suportado: {other}")),
    }
    Ok(buf)
}

/// Escreve uma imagem já decodificada no formato pedido.
fn write_image(
    img: &image::DynamicImage,
    fmt: &str,
    out_path: &Path,
    quality: u8,
) -> Result<(), String> {
    let bytes = encode_image(img, fmt, quality)?;
    std::fs::write(out_path, bytes).map_err(|e| e.to_string())
}

fn convert_one_image(
    input: &str,
    fmt: &str,
    out_dir: Option<&str>,
    quality: u8,
) -> Result<String, String> {
    let src = Path::new(input);
    let img = image::open(src).map_err(|e| format!("falha ao abrir imagem: {e}"))?;

    let stem = src
        .file_stem()
        .and_then(|s| s.to_str())
        .ok_or("nome de arquivo inválido")?;

    let dir: PathBuf = match out_dir {
        Some(d) => PathBuf::from(d),
        None => src.parent().unwrap_or(Path::new(".")).to_path_buf(),
    };
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let out_path = dir.join(format!("{stem}.{}", ext_for(fmt)));

    write_image(&img, fmt, &out_path, quality)?;
    Ok(out_path.to_string_lossy().to_string())
}

#[derive(serde::Deserialize)]
pub struct ResizeArgs {
    inputs: Vec<String>,
    out_dir: String,
    max_width: Option<u32>,
    max_height: Option<u32>,
    /// Escala percentual (1–100); aplicada se max_width/max_height não vierem.
    scale_pct: Option<u32>,
    /// Formato alvo; mantém o da origem se ausente.
    format: Option<String>,
    quality: Option<u8>,
    /// Se presente, saída = `<prefix>_<n>.<ext>` (renomeio em lote).
    rename_prefix: Option<String>,
}

/// Redimensiona/comprime imagens em lote. Retorna os caminhos gerados.
#[tauri::command]
pub async fn resize_images(args: ResizeArgs) -> Result<Vec<String>, String> {
    let quality = args.quality.unwrap_or(85).clamp(1, 100);
    let dir = PathBuf::from(&args.out_dir);
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;

    let mut outputs = Vec::with_capacity(args.inputs.len());
    for (i, input) in args.inputs.iter().enumerate() {
        let out = resize_one(input, &dir, &args, quality, i + 1)
            .map_err(|e| format!("{input}: {e}"))?;
        outputs.push(out);
    }
    Ok(outputs)
}

fn resize_one(
    input: &str,
    dir: &Path,
    args: &ResizeArgs,
    quality: u8,
    index: usize,
) -> Result<String, String> {
    let src = Path::new(input);
    let img = image::open(src).map_err(|e| format!("falha ao abrir imagem: {e}"))?;

    let resized = if args.max_width.is_some() || args.max_height.is_some() {
        let w = args.max_width.unwrap_or(u32::MAX);
        let h = args.max_height.unwrap_or(u32::MAX);
        img.resize(w, h, image::imageops::FilterType::Lanczos3)
    } else if let Some(pct) = args.scale_pct {
        let pct = pct.clamp(1, 100);
        let w = (img.width() * pct / 100).max(1);
        let h = (img.height() * pct / 100).max(1);
        img.resize(w, h, image::imageops::FilterType::Lanczos3)
    } else {
        img
    };

    let src_ext = src
        .extension()
        .and_then(|s| s.to_str())
        .unwrap_or("png")
        .to_lowercase();
    let fmt = args
        .format
        .as_deref()
        .map(|f| f.to_lowercase())
        .unwrap_or(src_ext);

    let stem = src
        .file_stem()
        .and_then(|s| s.to_str())
        .ok_or("nome de arquivo inválido")?;
    let name = match &args.rename_prefix {
        Some(prefix) => format!("{prefix}_{index}.{}", ext_for(&fmt)),
        None => format!("{stem}.{}", ext_for(&fmt)),
    };
    let out_path = dir.join(name);

    write_image(&resized, &fmt, &out_path, quality)?;
    Ok(out_path.to_string_lossy().to_string())
}

#[derive(serde::Deserialize)]
pub struct CompressArgs {
    inputs: Vec<String>,
    out_dir: String,
    /// "manter" | "webp" | "jpg"
    format: String,
    /// "qualidade" | "tamanho"
    mode: String,
    quality: Option<u8>,
    target_kb: Option<u32>,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CompressResult {
    input: String,
    output: String,
    before: u64,
    after: u64,
    quality: u8,
    /// false = nem na qualidade mínima coube no alvo (ou formato sem perdas).
    hit_target: bool,
}

/// Formatos sem perdas: `quality` não muda nada neles, então não vale rodar a
/// busca binária — um encode só e pronto.
fn is_lossless(fmt: &str) -> bool {
    matches!(fmt, "png" | "ico" | "gif" | "bmp" | "tiff" | "tif")
}

/// Maior qualidade cujo encode cabe em `target` bytes.
/// Retorna (bytes, qualidade usada, coube no alvo).
fn search_quality(
    img: &image::DynamicImage,
    fmt: &str,
    target: u64,
    ceiling: u8,
) -> Result<(Vec<u8>, u8, bool), String> {
    let mut lo = 1u8;
    let mut hi = ceiling.clamp(1, 100);
    let mut best: Option<(u8, Vec<u8>)> = None;

    // 8 iterações cobrem 1..=100 (2^7 = 128). Teto de custo: 8 encodes/arquivo.
    for _ in 0..8 {
        let q = lo + (hi - lo) / 2;
        let buf = encode_image(img, fmt, q)?;
        if buf.len() as u64 <= target {
            best = Some((q, buf));
            if q >= hi {
                break;
            }
            lo = q + 1;
        } else {
            if q <= lo {
                break;
            }
            hi = q - 1;
        }
    }

    match best {
        Some((q, b)) => Ok((b, q, true)),
        // Nem no mínimo coube: grava assim mesmo e a UI avisa.
        None => Ok((encode_image(img, fmt, 1)?, 1, false)),
    }
}

/// Comprime imagens em lote por qualidade fixa ou por tamanho-alvo.
/// Nativo (`image`/`webp`), sem sidecar.
#[tauri::command]
pub async fn compress_images(args: CompressArgs) -> Result<Vec<CompressResult>, String> {
    let dir = PathBuf::from(&args.out_dir);
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;

    let mut results = Vec::with_capacity(args.inputs.len());
    for input in &args.inputs {
        let r = compress_one(input, &dir, &args).map_err(|e| format!("{input}: {e}"))?;
        results.push(r);
    }
    Ok(results)
}

fn compress_one(input: &str, dir: &Path, args: &CompressArgs) -> Result<CompressResult, String> {
    let src = Path::new(input);
    let before = std::fs::metadata(src).map_err(|e| e.to_string())?.len();

    let src_ext = src
        .extension()
        .and_then(|s| s.to_str())
        .unwrap_or("png")
        .to_lowercase();
    let keep_format = args.format.eq_ignore_ascii_case("manter");
    let fmt = if keep_format {
        src_ext.clone()
    } else {
        args.format.to_lowercase()
    };

    let stem = src
        .file_stem()
        .and_then(|s| s.to_str())
        .ok_or("nome de arquivo inválido")?;
    let out_path = dir.join(format!("{stem}.{}", ext_for(&fmt)));

    let by_size = args.mode.eq_ignore_ascii_case("tamanho");
    let target = args.target_kb.unwrap_or(500).max(1) as u64 * 1024;
    let ceiling = args.quality.unwrap_or(85).clamp(1, 100);

    // Já está abaixo do alvo e não muda de formato: copiar é mais barato — e
    // recodificar poderia até piorar a imagem sem ganhar bytes.
    if by_size && keep_format && before <= target {
        copy_or_skip(src, &out_path)?;
        return Ok(CompressResult {
            input: input.to_string(),
            output: out_path.to_string_lossy().to_string(),
            before,
            after: before,
            quality: 100,
            hit_target: true,
        });
    }

    let img = image::open(src).map_err(|e| format!("falha ao abrir imagem: {e}"))?;

    let (bytes, quality, mut hit_target) = if by_size && !is_lossless(&fmt) {
        search_quality(&img, &fmt, target, ceiling)?
    } else {
        let buf = encode_image(&img, &fmt, ceiling)?;
        let fits = !by_size || buf.len() as u64 <= target;
        (buf, ceiling, fits)
    };

    // Um "compressor" que devolve arquivo maior é o bug clássico. Se o formato
    // não mudou e o encode engordou, fica com o original.
    let same_ext = ext_for(&fmt) == ext_for(&src_ext);
    if same_ext && bytes.len() as u64 >= before {
        copy_or_skip(src, &out_path)?;
        if by_size {
            hit_target = before <= target;
        }
        return Ok(CompressResult {
            input: input.to_string(),
            output: out_path.to_string_lossy().to_string(),
            before,
            after: before,
            quality: 100,
            hit_target,
        });
    }

    let after = bytes.len() as u64;
    std::fs::write(&out_path, bytes).map_err(|e| e.to_string())?;

    Ok(CompressResult {
        input: input.to_string(),
        output: out_path.to_string_lossy().to_string(),
        before,
        after,
        quality,
        hit_target,
    })
}

/// Copia o original para a saída. Se origem e destino são o mesmo arquivo
/// (out_dir == pasta de origem), não faz nada — copiar sobre si trunca.
fn copy_or_skip(src: &Path, out_path: &Path) -> Result<(), String> {
    let same = std::fs::canonicalize(src)
        .ok()
        .zip(std::fs::canonicalize(out_path).ok())
        .map(|(a, b)| a == b)
        .unwrap_or(false);
    if same {
        return Ok(());
    }
    std::fs::copy(src, out_path).map_err(|e| e.to_string())?;
    Ok(())
}

#[derive(serde::Deserialize)]
pub struct VectorizeArgs {
    input: String,
    /// Destino. Ausente = rascunho em temp (é o fluxo da prévia).
    out_path: Option<String>,
    /// "baixo" | "medio" | "alto" — apelidos dos parâmetros do VTracer.
    detail: Option<String>,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VectorizeResult {
    output_path: String,
    /// Nº de `<path>` no SVG. É a prova de que saiu vetor de verdade (e não uma
    /// imagem embrulhada), e dá ao usuário a noção de peso do arquivo.
    paths: usize,
    bytes: usize,
    width: u32,
    height: u32,
    /// Lado maior usado no traçado. Menor que o original = a imagem foi reduzida
    /// antes de traçar (ver `MAX_LADO_VETOR`).
    traced_side: u32,
    duration_ms: u64,
}

/// Teto do lado maior antes de traçar.
///
/// O custo do VTracer é por pixel e o SVG resultante cresce junto: uma foto de
/// 4000 px vira minutos de trabalho e dezenas de MB de `<path>`. Como a saída é
/// vetorial — escala sem perder nitidez — reduzir a entrada custa detalhe fino,
/// não resolução final.
// ponytail: teto fixo; virar opção da UI só se alguém reclamar de perder detalhe.
const MAX_LADO_VETOR: u32 = 2000;

/// Parâmetros do VTracer por nível de detalhe. O usuário escolhe Baixo/Médio/Alto;
/// os nomes do algoritmo (speckle, layer difference) não vão para a tela.
fn config_vetor(detail: &str) -> vtracer::Config {
    let base = vtracer::Config::default(); // Médio = o padrão do VTracer.
    match detail {
        // Menos cores e mais filtro de ruído: SVG pequeno, bom para logo e desenho.
        "baixo" => vtracer::Config {
            filter_speckle: 8,
            color_precision: 5,
            layer_difference: 24,
            ..base
        },
        // Mais camadas de cor e quase nenhum filtro: foto e degradê.
        "alto" => vtracer::Config {
            filter_speckle: 2,
            color_precision: 8,
            layer_difference: 8,
            ..base
        },
        _ => base,
    }
}

/// Vetoriza uma imagem raster em SVG (VTracer, nativo, 100% local).
///
/// A decodificação é feita aqui com o crate `image` do projeto em vez do
/// `convert_image_to_svg` do VTracer: aquele traz um `image` 0.23 próprio, que
/// não lê WebP, e dá a mesma mensagem de erro para qualquer falha.
#[tauri::command]
pub async fn vectorize_image(args: VectorizeArgs) -> Result<VectorizeResult, String> {
    let inicio = std::time::Instant::now();
    let src = Path::new(&args.input);
    let img = image::open(src).map_err(|e| format!("falha ao abrir imagem: {e}"))?;
    let (w0, h0) = (img.width(), img.height());
    if w0 == 0 || h0 == 0 {
        return Err("imagem vazia".to_string());
    }

    let maior = w0.max(h0);
    let img = if maior > MAX_LADO_VETOR {
        let f = MAX_LADO_VETOR as f32 / maior as f32;
        img.resize(
            ((w0 as f32 * f).round() as u32).max(1),
            ((h0 as f32 * f).round() as u32).max(1),
            image::imageops::FilterType::Lanczos3,
        )
    } else {
        img
    };

    // O VTracer keia o fundo transparente sozinho (procura uma cor não usada,
    // pinta os pixels com alfa 0 e descarta esses clusters), então o RGBA tem
    // que chegar inteiro — achatar o alfa aqui criaria o fundo branco que o
    // roadmap proíbe.
    let rgba = img.to_rgba8();
    let entrada = vtracer::ColorImage {
        width: rgba.width() as usize,
        height: rgba.height() as usize,
        pixels: rgba.into_raw(),
    };
    let traced_side = entrada.width.max(entrada.height) as u32;

    let svg = vtracer::convert(entrada, config_vetor(args.detail.as_deref().unwrap_or("medio")))
        .map_err(|e| format!("falha ao vetorizar: {e}"))?
        .to_string();

    let out_path = match args.out_path {
        Some(p) => PathBuf::from(p),
        None => std::env::temp_dir().join("camps-utils-vetor.svg"),
    };
    if let Some(parent) = out_path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    std::fs::write(&out_path, &svg).map_err(|e| format!("falha ao gravar SVG: {e}"))?;

    Ok(VectorizeResult {
        output_path: out_path.to_string_lossy().to_string(),
        paths: svg.matches("<path").count(),
        bytes: svg.len(),
        width: w0,
        height: h0,
        traced_side,
        duration_ms: inicio.elapsed().as_millis() as u64,
    })
}

/// Copia um arquivo já gerado para o destino escolhido pelo usuário.
///
/// Existe para o fluxo "gera rascunho em temp → mostra prévia → salva": sem
/// isto, salvar exigiria refazer o trabalho caro que a prévia já fez.
#[tauri::command]
pub async fn copy_file(from: String, to: String) -> Result<String, String> {
    let dest = PathBuf::from(&to);
    if let Some(parent) = dest.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    copy_or_skip(Path::new(&from), &dest)?;
    Ok(dest.to_string_lossy().to_string())
}

// ─── Aumentar qualidade (Real-ESRGAN ncnn/Vulkan) ────────────────────────────

/// Modelo do Real-ESRGAN e a escala que ele foi TREINADO para produzir.
///
/// A escala nativa não é decoração: o binário aceita `-s 2` com um modelo x4 e
/// devolve uma imagem do tamanho pedido — **corrompida**. Medido com a amostra
/// do upstream: `-s 2` no x4plus fica a 81,9 (0–255) de distância média de um
/// Lanczos 2x, enquanto rodar 4x e reduzir fica a 8,2. Por isso a inferência é
/// sempre na escala nativa e a redução é feita aqui.
struct ModeloUpscale {
    id: &'static str,
    arquivo: &'static str,
    escala_nativa: u32,
}

/// Um modelo hoje. Acrescentar outro (anime, animevideov3) é uma linha aqui +
/// os dois arquivos no zip do módulo — nada na UI nem no fluxo muda.
const MODELOS_UPSCALE: &[ModeloUpscale] = &[ModeloUpscale {
    id: "geral",
    arquivo: "realesrgan-x4plus",
    escala_nativa: 4,
}];

const REALESRGAN_AUSENTE: &str =
    "Módulo de aumento de qualidade (Real-ESRGAN) não instalado. Baixe em Configurações → Módulos.";

/// Impede duas inferências ao mesmo tempo. A UI já desabilita o botão, mas o
/// lock é o que garante a regra quando duas ferramentas (ou dois cliques que
/// escaparam) chegam juntas: cada processo reserva VRAM para os pesos, e dois
/// simultâneos derrubam justamente as máquinas mais fracas.
static UPSCALE_LOCK: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

#[derive(serde::Deserialize)]
pub struct UpscaleArgs {
    input: String,
    /// Destino. Ausente = rascunho em temp (fluxo da prévia).
    out_path: Option<String>,
    /// 2 ou 4. Outros valores caem em 4.
    scale: Option<u32>,
    /// Id de `MODELOS_UPSCALE`; ausente = o primeiro (geral).
    model: Option<String>,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpscaleResult {
    output_path: String,
    width: u32,
    height: u32,
    out_width: u32,
    out_height: u32,
    duration_ms: u64,
}

/// Traduz a saída do binário em mensagem acionável. Sem isto, "falhou" é tudo
/// o que sobra — e as duas causas de verdade (sem Vulkan, sem VRAM) têm
/// respostas completamente diferentes para quem está na frente da tela.
fn erro_do_realesrgan(cauda: &[String]) -> String {
    let texto = cauda.join("\n");
    let baixo = texto.to_lowercase();
    if baixo.contains("vkcreateinstance")
        || baixo.contains("no vulkan device")
        || baixo.contains("failed to create vulkan")
        || baixo.contains("vulkan device not found")
    {
        return "Sua placa de vídeo não tem suporte a Vulkan, ou o driver está desatualizado. \
                O Real-ESRGAN precisa de Vulkan para funcionar — atualize o driver da placa e \
                tente de novo."
            .to_string();
    }
    if baixo.contains("out of memory") || baixo.contains("vkallocatememory") || baixo.contains("oom") {
        return "A placa de vídeo ficou sem memória, mesmo processando a imagem em pedaços. \
                Tente uma imagem menor ou a escala 2x."
            .to_string();
    }
    if baixo.contains("decode image failed") || baixo.contains("unsupported") {
        return "Não consegui ler esta imagem. Use PNG, JPG ou WebP.".to_string();
    }
    if texto.trim().is_empty() {
        return "O Real-ESRGAN falhou sem dizer o motivo.".to_string();
    }
    format!("O Real-ESRGAN falhou: {}", texto.trim())
}

/// Roda o binário uma vez. `tile` = 0 deixa ele escolher pelo tamanho da VRAM.
async fn realesrgan_run(
    app: &AppHandle,
    exe: &Path,
    entrada: &Path,
    saida: &Path,
    modelo: &ModeloUpscale,
    tile: u32,
) -> Result<(), String> {
    use std::process::Stdio;
    use tokio::io::{AsyncBufReadExt, BufReader};

    let models_dir = exe.parent().unwrap_or(Path::new(".")).join("models");
    let args = vec![
        "-i".to_string(),
        entrada.to_string_lossy().to_string(),
        "-o".to_string(),
        saida.to_string_lossy().to_string(),
        "-n".to_string(),
        modelo.arquivo.to_string(),
        "-s".to_string(),
        modelo.escala_nativa.to_string(),
        "-m".to_string(),
        models_dir.to_string_lossy().to_string(),
        "-t".to_string(),
        tile.to_string(),
        "-f".to_string(),
        "png".to_string(),
    ];

    let mut child = headless_command(exe)
        .args(&args)
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("Falha ao iniciar o Real-ESRGAN: {e}"))?;

    // O binário escreve progresso E erro no mesmo stderr, então a leitura tem
    // que fazer as duas coisas: emitir o que é porcentagem e guardar o resto.
    let cauda = std::sync::Arc::new(std::sync::Mutex::new(std::collections::VecDeque::<String>::new()));
    let leitor = child.stderr.take().map(|err| {
        let app2 = app.clone();
        let cauda2 = cauda.clone();
        tokio::spawn(async move {
            let mut lines = BufReader::new(err).lines();
            while let Ok(Some(linha)) = lines.next_line().await {
                let t = linha.trim();
                // "25,00%" — a vírgula é do locale da máquina, não um typo.
                if let Some(num) = t.strip_suffix('%') {
                    if let Ok(pct) = num.replace(',', ".").parse::<f32>() {
                        let _ = app2.emit("tool-progress", pct.clamp(0.0, 100.0) as u32);
                        continue;
                    }
                }
                if let Ok(mut c) = cauda2.lock() {
                    if c.len() == 12 {
                        c.pop_front();
                    }
                    c.push_back(linha);
                }
            }
        })
    });

    let status = child.wait().await.map_err(|e| e.to_string())?;
    if let Some(h) = leitor {
        let _ = h.await;
    }
    if !status.success() {
        let linhas: Vec<String> = cauda.lock().map(|c| c.iter().cloned().collect()).unwrap_or_default();
        return Err(erro_do_realesrgan(&linhas));
    }
    Ok(())
}

/// Aumenta a resolução de uma imagem com o Real-ESRGAN (ncnn/Vulkan, local).
///
/// **Memória:** o modelo vive no processo filho, que morre ao fim da chamada —
/// RAM e VRAM voltam ao sistema incondicionalmente, sem depender de
/// `gc.collect()` nem de `empty_cache()`. Vale inclusive quando a inferência
/// falha, que é o caso em que a limpeza manual costuma ser esquecida.
#[tauri::command]
pub async fn upscale_image(app: AppHandle, args: UpscaleArgs) -> Result<UpscaleResult, String> {
    let _guarda = UPSCALE_LOCK.lock().await;
    let inicio = std::time::Instant::now();

    let exe = resolve_realesrgan(&app).ok_or(REALESRGAN_AUSENTE)?;
    let modelo = args
        .model
        .as_deref()
        .and_then(|id| MODELOS_UPSCALE.iter().find(|m| m.id == id))
        .unwrap_or(&MODELOS_UPSCALE[0]);
    let escala = match args.scale {
        Some(2) => 2,
        _ => 4,
    };

    let entrada = PathBuf::from(&args.input);
    let (w0, h0) = image::image_dimensions(&entrada)
        .map_err(|e| format!("falha ao ler a imagem: {e}"))?;

    let destino = match args.out_path {
        Some(p) => PathBuf::from(p),
        None => std::env::temp_dir().join("camps-utils-upscale.png"),
    };
    if let Some(parent) = destino.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }

    // A inferência sempre grava num arquivo próprio: quando a escala pedida é
    // menor que a nativa, o resultado ainda precisa ser reduzido antes de virar
    // o arquivo que o usuário vê.
    let bruto = std::env::temp_dir().join("camps-utils-upscale-bruto.png");

    // `-t 0` deixa o binário dimensionar o tile pela VRAM disponível. Se ainda
    // assim faltar memória, uma segunda tentativa com tile pequeno costuma
    // passar — é lento, mas é a diferença entre funcionar e não funcionar.
    if let Err(e) = realesrgan_run(&app, &exe, &entrada, &bruto, modelo, 0).await {
        if e.contains("sem memória") {
            let _ = app.emit("tool-step", "Reduzindo o tamanho dos blocos e tentando de novo…");
            realesrgan_run(&app, &exe, &entrada, &bruto, modelo, 128).await?;
        } else {
            std::fs::remove_file(&bruto).ok();
            return Err(e);
        }
    }

    let (out_w, out_h) = if escala == modelo.escala_nativa {
        std::fs::rename(&bruto, &destino)
            .or_else(|_| std::fs::copy(&bruto, &destino).map(|_| ()))
            .map_err(|e| format!("falha ao gravar a imagem: {e}"))?;
        std::fs::remove_file(&bruto).ok();
        image::image_dimensions(&destino).map_err(|e| e.to_string())?
    } else {
        let img = image::open(&bruto).map_err(|e| format!("falha ao ler o resultado: {e}"))?;
        let alvo_w = (w0 * escala).max(1);
        let alvo_h = (h0 * escala).max(1);
        img.resize_exact(alvo_w, alvo_h, image::imageops::FilterType::Lanczos3)
            .save(&destino)
            .map_err(|e| format!("falha ao gravar a imagem: {e}"))?;
        // O arquivo bruto é 4x: em foto grande são dezenas de MB de temp que
        // não servem mais para nada.
        std::fs::remove_file(&bruto).ok();
        (alvo_w, alvo_h)
    };

    let _ = app.emit("tool-progress", 100u32);
    Ok(UpscaleResult {
        output_path: destino.to_string_lossy().to_string(),
        width: w0,
        height: h0,
        out_width: out_w,
        out_height: out_h,
        duration_ms: inicio.elapsed().as_millis() as u64,
    })
}

/// Generates a QR code PNG for the given text. Returns the output path.
#[tauri::command]
pub async fn generate_qr(text: String, out_path: String, size: Option<u32>) -> Result<String, String> {
    if text.trim().is_empty() {
        return Err("Texto vazio.".to_string());
    }
    let dim = size.unwrap_or(512).clamp(64, 2048);

    let code = qrcode::QrCode::new(text.as_bytes()).map_err(|e| e.to_string())?;
    let img = code
        .render::<image::Luma<u8>>()
        .min_dimensions(dim, dim)
        .build();

    let out = Path::new(&out_path);
    if let Some(parent) = out.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    img.save_with_format(out, image::ImageFormat::Png)
        .map_err(|e| e.to_string())?;

    Ok(out_path)
}

#[derive(serde::Deserialize)]
pub struct HashArgs {
    paths: Vec<String>,
    algo: String,
}

#[derive(serde::Serialize)]
pub struct HashResult {
    path: String,
    hash: String,
}

fn hash_bytes(algo: &str, data: &[u8]) -> Result<String, String> {
    use sha2::Digest;
    match algo {
        "sha256" => Ok(hex::encode(sha2::Sha256::digest(data))),
        "sha1" => Ok(hex::encode(sha1::Sha1::digest(data))),
        "md5" => Ok(hex::encode(md5::compute(data).0)),
        other => Err(format!("algoritmo não suportado: {other}")),
    }
}

/// Computes file hashes (md5/sha1/sha256) for the given paths.
#[tauri::command]
pub async fn hash_files(args: HashArgs) -> Result<Vec<HashResult>, String> {
    let algo = args.algo.to_lowercase();
    let mut out = Vec::with_capacity(args.paths.len());
    for path in args.paths {
        let data = std::fs::read(&path).map_err(|e| format!("{path}: {e}"))?;
        let hash = hash_bytes(&algo, &data)?;
        out.push(HashResult { path, hash });
    }
    Ok(out)
}

/// Saves text content to the given path (used by save-as flows).
#[tauri::command]
pub async fn save_markdown(path: String, content: String) -> Result<(), String> {
    let out_path = Path::new(&path);

    if let Some(parent) = out_path.parent() {
        if !parent.exists() {
            std::fs::create_dir_all(parent)
                .map_err(|e| format!("Não foi possível criar o diretório: {e}"))?;
        }
    }

    std::fs::write(out_path, content.as_bytes())
        .map_err(|e| format!("Não foi possível salvar o arquivo: {e}"))
}

/// Opens the folder containing the given file path in the OS file manager.
#[tauri::command]
pub async fn open_folder(app: AppHandle, file_path: String) -> Result<(), String> {
    let path = Path::new(&file_path);
    let folder = if path.is_dir() {
        path.to_path_buf()
    } else {
        path.parent()
            .ok_or_else(|| "Caminho inválido.".to_string())?
            .to_path_buf()
    };

    app.opener()
        .open_path(folder.to_string_lossy().as_ref(), None::<&str>)
        .map_err(|e| format!("Não foi possível abrir a pasta: {e}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hash_known_vectors() {
        // Hashes conhecidos da string "abc".
        assert_eq!(
            hash_bytes("sha256", b"abc").unwrap(),
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
        );
        assert_eq!(hash_bytes("sha1", b"abc").unwrap(), "a9993e364706816aba3e25717850c26c9cd0d89d");
        assert_eq!(hash_bytes("md5", b"abc").unwrap(), "900150983cd24fb0d6963f7d28e17f72");
    }

    #[test]
    fn hash_unknown_algo_errors() {
        assert!(hash_bytes("crc32", b"abc").is_err());
    }

    #[test]
    fn qr_renders_png() {
        let code = qrcode::QrCode::new(b"https://exemplo.com").unwrap();
        let img = code.render::<image::Luma<u8>>().min_dimensions(128, 128).build();
        assert!(img.width() >= 128 && img.height() >= 128);
    }

    #[test]
    fn resize_and_convert_roundtrip() {
        let dir = std::env::temp_dir().join(format!("camps_test_{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let src = dir.join("src.png");
        image::DynamicImage::ImageRgb8(image::RgbImage::new(200, 100))
            .save(&src)
            .unwrap();

        // Redimensiona p/ caber em 50x50 (mantém proporção → 50x25) e converte p/ jpg.
        let img = image::open(&src).unwrap();
        let resized = img.resize(50, 50, image::imageops::FilterType::Lanczos3);
        assert_eq!(resized.width(), 50);
        assert_eq!(resized.height(), 25);

        let out = dir.join("out.jpg");
        write_image(&resized, "jpg", &out, 80).unwrap();
        assert!(out.exists());

        // png/ico saíam por save_with_format e agora saem por write_to —
        // cobre o refactor write_image → encode_image.
        let out_png = dir.join("out.png");
        write_image(&resized, "png", &out_png, 80).unwrap();
        assert_eq!(image::open(&out_png).unwrap().width(), 50);

        let out_ico = dir.join("out.ico");
        write_image(&resized, "ico", &out_ico, 80).unwrap();
        assert!(out_ico.metadata().unwrap().len() > 0);

        std::fs::remove_dir_all(&dir).ok();
    }

    fn bloco(dir: &Path, nome: &str, alfa_fora: u8) -> PathBuf {
        // Quadrado opaco no meio; a borda fica transparente quando alfa_fora=0.
        let mut raw = image::RgbaImage::new(64, 64);
        for (x, y, p) in raw.enumerate_pixels_mut() {
            let dentro = (12..52).contains(&x) && (12..52).contains(&y);
            *p = if dentro {
                image::Rgba([220, 30, 30, 255])
            } else {
                image::Rgba([255, 255, 255, alfa_fora])
            };
        }
        let path = dir.join(nome);
        image::DynamicImage::ImageRgba8(raw).save(&path).unwrap();
        path
    }

    fn vetorizar(args: VectorizeArgs) -> VectorizeResult {
        tokio::runtime::Runtime::new().unwrap().block_on(vectorize_image(args)).unwrap()
    }

    /// O critério do roadmap: SVG com geometria de verdade. Um `<image>` com PNG
    /// em base64 dentro de um `<svg>` passaria por "vetorizado" na tela e falharia
    /// em qualquer ampliação — é exatamente o que este teste recusa.
    #[test]
    fn vetoriza_gera_paths_e_nao_raster_embutido() {
        let dir = std::env::temp_dir().join(format!("camps_vetor_{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let src = bloco(&dir, "opaco.png", 255);
        let out = dir.join("saida.svg");

        let r = vetorizar(VectorizeArgs {
            input: src.to_string_lossy().to_string(),
            out_path: Some(out.to_string_lossy().to_string()),
            detail: None,
        });

        let svg = std::fs::read_to_string(&out).unwrap();
        assert!(r.paths >= 1, "nenhum path gerado");
        assert!(svg.contains("<path"), "sem geometria: {}", &svg[..svg.len().min(200)]);
        assert!(!svg.contains("<image"), "raster embutido no SVG");
        assert!(!svg.contains("base64"), "raster embutido no SVG");
        // Dimensões relatadas são as do ORIGINAL, não as do traçado — é o que a
        // UI mostra ao usuário.
        assert_eq!((r.width, r.height), (64, 64));

        std::fs::remove_dir_all(&dir).ok();
    }

    /// Fundo transparente não pode virar um path branco cobrindo tudo: o SVG do
    /// PNG com alfa tem que ter MENOS área pintada que o mesmo desenho opaco.
    #[test]
    fn vetoriza_preserva_transparencia() {
        let dir = std::env::temp_dir().join(format!("camps_vetor_alfa_{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();

        let opaco = vetorizar(VectorizeArgs {
            input: bloco(&dir, "opaco.png", 255).to_string_lossy().to_string(),
            out_path: Some(dir.join("opaco.svg").to_string_lossy().to_string()),
            detail: None,
        });
        let transp = vetorizar(VectorizeArgs {
            input: bloco(&dir, "transp.png", 0).to_string_lossy().to_string(),
            out_path: Some(dir.join("transp.svg").to_string_lossy().to_string()),
            detail: None,
        });

        assert!(transp.paths >= 1, "o desenho sumiu junto com o fundo");
        assert!(
            transp.paths < opaco.paths,
            "fundo transparente virou path ({} vs {} opaco)",
            transp.paths,
            opaco.paths
        );

        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn erro_do_realesrgan_separa_vulkan_de_memoria() {
        // As duas causas reais têm respostas opostas para quem está na tela:
        // uma pede driver, a outra pede imagem menor. Trocá-las é pior que não
        // dizer nada.
        let sem_vulkan = erro_do_realesrgan(&["vkCreateInstance failed -9".to_string()]);
        assert!(sem_vulkan.contains("Vulkan"), "{sem_vulkan}");
        assert!(sem_vulkan.contains("driver"), "{sem_vulkan}");

        let sem_vram = erro_do_realesrgan(&["vkAllocateMemory failed: out of memory".to_string()]);
        assert!(sem_vram.contains("memória"), "{sem_vram}");
        assert!(!sem_vram.contains("Vulkan"), "confundiu VRAM com falta de suporte: {sem_vram}");

        // Desconhecido sai cru: uma linha do binário é sempre melhor que
        // "falhou", e sem ela não há como diagnosticar depois.
        let outro = erro_do_realesrgan(&["find_blob_index_by_name data failed".to_string()]);
        assert!(outro.contains("find_blob_index_by_name"), "{outro}");

        let vazio = erro_do_realesrgan(&[]);
        assert!(vazio.contains("sem dizer o motivo"), "{vazio}");
    }

    /// O binário aceita `-s 2` num modelo x4 e devolve imagem corrompida do
    /// tamanho certo (medido: 81,9 de distância média contra 8,2 do caminho
    /// 4x+redução). Todo o desenho do `upscale_image` depende de a escala
    /// nativa declarada aqui bater com o modelo de verdade.
    #[test]
    fn modelo_de_upscale_declara_escala_nativa() {
        let geral = &MODELOS_UPSCALE[0];
        assert_eq!(geral.id, "geral");
        assert_eq!(geral.arquivo, "realesrgan-x4plus");
        assert_eq!(geral.escala_nativa, 4);
    }

    #[test]
    fn niveis_de_detalhe_sao_diferentes() {
        let (b, m, a) = (config_vetor("baixo"), config_vetor("medio"), config_vetor("alto"));
        assert!(b.filter_speckle > m.filter_speckle && m.filter_speckle > a.filter_speckle);
        assert!(b.color_precision < a.color_precision);
        // Rótulo desconhecido cai no médio em vez de explodir.
        assert_eq!(config_vetor("xpto").color_precision, m.color_precision);
    }

    /// Imagem de ruído: um gradiente liso comprimiria abaixo do alvo já em
    /// q=95 e o teste não provaria que a busca binária faz algo.
    fn noisy_image(w: u32, h: u32) -> image::DynamicImage {
        let mut raw = image::RgbImage::new(w, h);
        for (x, y, p) in raw.enumerate_pixels_mut() {
            *p = image::Rgb([
                (x * 7 % 256) as u8,
                (y * 13 % 256) as u8,
                ((x * y) % 256) as u8,
            ]);
        }
        image::DynamicImage::ImageRgb8(raw)
    }

    /// Auxiliar, não teste — daí não levar `#[test]`.
    fn cauda(linhas: &[&str]) -> std::sync::Mutex<std::collections::VecDeque<String>> {
        std::sync::Mutex::new(linhas.iter().map(|s| s.to_string()).collect())
    }

    #[test]
    fn erro_do_ffmpeg_sempre_diz_algo_util() {
        // O bug era este: o stderr era descartado e TODA falha virava
        // "ffmpeg falhou." — sem chance de diagnosticar.
        let saida = erro_do_ffmpeg(&cauda(&["[libx264] height not divisible by 2"]));
        assert!(saida.contains("height not divisible by 2"), "{saida}");
    }

    #[test]
    fn erro_do_ffmpeg_traduz_casos_conhecidos() {
        let pcm = erro_do_ffmpeg(&cauda(&["Could not find tag for codec pcm_s16le"]));
        assert!(pcm.contains("MP4"), "{pcm}");
        assert!(!pcm.contains("tag for codec"), "não deve vazar jargão: {pcm}");

        let sem_arquivo = erro_do_ffmpeg(&cauda(&["No such file or directory"]));
        assert!(sem_arquivo.contains("não encontrou"));

        let permissao = erro_do_ffmpeg(&cauda(&["Permission denied"]));
        assert!(permissao.contains("permissão"));
    }

    #[test]
    fn erro_do_ffmpeg_sem_stderr_nao_mente() {
        let vazio = erro_do_ffmpeg(&cauda(&[]));
        assert!(vazio.contains("sem dizer o motivo"), "{vazio}");
    }

    #[test]
    #[test]
    fn escape_de_filtro_protege_caminho_do_windows() {
        // Sem escapar, o `C:` vira separador de opção do filtro do ffmpeg e a
        // queima falha com um erro que não menciona legenda nem fonte. Vale
        // igual para o `fontsdir`, que é o segundo caminho no mesmo filtro.
        let saida = escapar_para_filtro(r"C:\Users\Fulano\Meus Vídeos\leg.ass");
        assert!(!saida.contains("C:"), "dois-pontos cru sobrou: {saida}");
        assert!(saida.contains(r"C\:"), "dois-pontos não escapado: {saida}");
        assert!(!saida.contains('\\') || saida.contains(r"\:"), "barra invertida crua: {saida}");
        // Espaço é legítimo dentro das aspas do filtro; não pode ser mexido.
        assert!(saida.contains("Meus Vídeos"));
    }

    #[test]
    fn escape_de_filtro_trata_aspas() {
        let saida = escapar_para_filtro("D:/pasta/o'brien.ass");
        assert!(saida.contains(r"\'"), "aspa simples não escapada: {saida}");
    }

    #[test]
    fn compress_busca_binaria_respeita_alvo() {
        let img = noisy_image(400, 300);

        // O alvo sai de uma MEDIÇÃO, não de uma constante: um número fixo ou
        // fica frouxo (q=95 já cabe, não prova nada) ou impossível (nem q=1
        // cabe), dependendo do quanto essa imagem comprime.
        let maior = encode_image(&img, "jpg", 95).unwrap().len() as u64;
        let menor = encode_image(&img, "jpg", 1).unwrap().len() as u64;
        assert!(menor < maior, "qualidade não afeta o tamanho — encoder quebrado");
        let alvo = (menor + maior) / 2;

        let (bytes, q, coube) = search_quality(&img, "jpg", alvo, 95).unwrap();
        assert!(coube, "alvo {alvo} está entre {menor} e {maior}, tinha que caber");
        assert!(bytes.len() as u64 <= alvo);
        assert!((1..=95).contains(&q));

        // Alvo impossível: devolve o mínimo e sinaliza que não coube.
        let (_, q1, coube1) = search_quality(&img, "jpg", menor / 2, 95).unwrap();
        assert!(!coube1);
        assert_eq!(q1, 1);
    }

    #[test]
    fn compress_nao_engorda_arquivo() {
        let dir = std::env::temp_dir().join(format!("camps_cmp_{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let out_dir = dir.join("out");

        // JPG já bem comprimido: recodificar com qualidade alta tende a crescer.
        let src = dir.join("src.jpg");
        std::fs::write(&src, encode_image(&noisy_image(300, 200), "jpg", 40).unwrap()).unwrap();
        let before = std::fs::metadata(&src).unwrap().len();

        let args = CompressArgs {
            inputs: vec![src.to_string_lossy().to_string()],
            out_dir: out_dir.to_string_lossy().to_string(),
            format: "manter".into(),
            mode: "qualidade".into(),
            quality: Some(100),
            target_kb: None,
        };
        std::fs::create_dir_all(&out_dir).unwrap();
        let r = compress_one(&args.inputs[0], &out_dir, &args).unwrap();

        assert!(r.after <= before, "saída ({}) maior que entrada ({before})", r.after);
        assert_eq!(std::fs::metadata(&r.output).unwrap().len(), r.after);

        std::fs::remove_dir_all(&dir).ok();
    }
}
