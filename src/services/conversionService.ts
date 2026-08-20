import { invoke } from "@tauri-apps/api/core";
import type { ConversionRequest, ConversionResult } from "../types/conversion";

/**
 * O sidecar imprime o JSON de resultado como última linha do stdout, mas
 * bibliotecas (yt-dlp/ffmpeg) podem escrever linhas antes. Pega a última
 * linha que faz parse como JSON.
 */
function parseLastJson<T>(raw: string): T {
  const lines = raw.trim().split(/\r?\n/).filter((l) => l.trim());
  for (let i = lines.length - 1; i >= 0; i--) {
    try {
      return JSON.parse(lines[i]) as T;
    } catch {
      // tenta a linha anterior
    }
  }
  throw new Error("Resposta inválida do conversor.");
}

export async function convertPdf(
  request: ConversionRequest
): Promise<ConversionResult> {
  const inputJson = JSON.stringify(request);

  let rawOutput: string;
  try {
    rawOutput = await invoke<string>("convert_pdf", { inputJson });
  } catch (err) {
    return {
      success: false,
      errorCode: "SIDECAR_ERROR",
      message:
        "Não foi possível iniciar o conversor. Verifique se o sidecar foi compilado.",
    };
  }

  // The sidecar may output progress lines to stderr (captured by Rust),
  // but stdout should contain exactly one JSON line.
  const trimmed = rawOutput.trim();

  if (!trimmed) {
    return {
      success: false,
      errorCode: "CONVERSION_FAILED",
      message: "O conversor não retornou nenhuma resposta.",
    };
  }

  try {
    const result = JSON.parse(trimmed) as ConversionResult;
    return result;
  } catch {
    return {
      success: false,
      errorCode: "CONVERSION_FAILED",
      message: "Resposta inválida do conversor.",
    };
  }
}

/** Runs a generic Python sidecar tool (md2pdf, pdf_merge, youtube, …). */
export async function runTool<T = unknown>(
  tool: string,
  request: unknown
): Promise<T> {
  const inputJson = JSON.stringify(request);
  const raw = await invoke<string>("run_tool", { tool, inputJson });
  if (!raw.trim()) {
    throw new Error("O conversor não retornou nenhuma resposta.");
  }
  return parseLastJson<T>(raw);
}

export interface ImageConvertArgs {
  inputs: string[];
  format: "webp" | "png" | "jpg" | "ico";
  outDir?: string;
  quality?: number;
}

/** Batch image conversion (native Rust). Returns output paths. */
export async function convertImages(args: ImageConvertArgs): Promise<string[]> {
  return invoke<string[]>("convert_images", {
    args: {
      inputs: args.inputs,
      format: args.format,
      out_dir: args.outDir ?? null,
      quality: args.quality ?? null,
    },
  });
}

export type VectorDetail = "baixo" | "medio" | "alto";

export interface VectorizeArgs {
  input: string;
  /** Ausente = rascunho em temp (fluxo da prévia). */
  outPath?: string;
  detail?: VectorDetail;
}

export interface VectorizeResult {
  outputPath: string;
  /** Nº de `<path>` — prova de vetor de verdade, e noção do peso do arquivo. */
  paths: number;
  bytes: number;
  /** Dimensões do ORIGINAL (o SVG escala sem perder nitidez). */
  width: number;
  height: number;
  /** Lado maior usado no traçado; menor que o original = imagem reduzida antes. */
  tracedSide: number;
  durationMs: number;
}

/** Vetoriza uma imagem raster em SVG (VTracer, nativo, local). */
export async function vectorizeImage(args: VectorizeArgs): Promise<VectorizeResult> {
  return invoke<VectorizeResult>("vectorize_image", {
    args: {
      input: args.input,
      out_path: args.outPath ?? null,
      detail: args.detail ?? null,
    },
  });
}

export interface UpscaleArgs {
  input: string;
  /** Ausente = rascunho em temp (fluxo da prévia). */
  outPath?: string;
  /** 2 ou 4. */
  scale?: 2 | 4;
  /** Id do modelo; ausente = geral. */
  model?: string;
}

export interface UpscaleResult {
  outputPath: string;
  width: number;
  height: number;
  outWidth: number;
  outHeight: number;
  durationMs: number;
}

/** Aumenta a resolução com o Real-ESRGAN (ncnn/Vulkan, local). */
export async function upscaleImage(args: UpscaleArgs): Promise<UpscaleResult> {
  return invoke<UpscaleResult>("upscale_image", {
    args: {
      input: args.input,
      out_path: args.outPath ?? null,
      scale: args.scale ?? null,
      model: args.model ?? null,
    },
  });
}

export async function realesrganInstalled(): Promise<boolean> {
  return invoke<boolean>("realesrgan_installed");
}

export async function ensureRealesrgan(): Promise<void> {
  await invoke("ensure_realesrgan");
}

/** Copia um arquivo já gerado (rascunho de prévia) para o destino escolhido. */
export async function copyFile(from: string, to: string): Promise<string> {
  return invoke<string>("copy_file", { from, to });
}

/** Generates a QR code PNG. Returns the output path. */
export async function generateQr(
  text: string,
  outPath: string,
  size?: number
): Promise<string> {
  return invoke<string>("generate_qr", { text, outPath, size: size ?? null });
}

export interface HashResult {
  path: string;
  hash: string;
}

/** Computes file hashes (md5/sha1/sha256). */
export async function hashFiles(
  paths: string[],
  algo: "md5" | "sha1" | "sha256"
): Promise<HashResult[]> {
  return invoke<HashResult[]>("hash_files", { args: { paths, algo } });
}

export interface ResizeArgs {
  inputs: string[];
  outDir: string;
  maxWidth?: number;
  maxHeight?: number;
  scalePct?: number;
  format?: "webp" | "png" | "jpg";
  quality?: number;
  renamePrefix?: string;
}

/** Batch resize/compress/rename images (native Rust). Returns output paths. */
export async function resizeImages(args: ResizeArgs): Promise<string[]> {
  return invoke<string[]>("resize_images", {
    args: {
      inputs: args.inputs,
      out_dir: args.outDir,
      max_width: args.maxWidth ?? null,
      max_height: args.maxHeight ?? null,
      scale_pct: args.scalePct ?? null,
      format: args.format ?? null,
      quality: args.quality ?? null,
      rename_prefix: args.renamePrefix ?? null,
    },
  });
}

export type CompressFormat = "manter" | "webp" | "jpg";
export type CompressMode = "qualidade" | "tamanho";

export interface CompressArgs {
  inputs: string[];
  outDir: string;
  format: CompressFormat;
  mode: CompressMode;
  /** Modo "qualidade": valor fixo. Modo "tamanho": teto da busca binária. */
  quality?: number;
  /** Modo "tamanho": limite por arquivo em KB. */
  targetKb?: number;
}

export interface CompressResult {
  input: string;
  output: string;
  before: number;
  after: number;
  quality: number;
  /** false = não coube no alvo nem na qualidade mínima (ou formato sem perdas). */
  hitTarget: boolean;
}

/** Batch image compression by quality or target size (native Rust). */
export async function compressImages(args: CompressArgs): Promise<CompressResult[]> {
  return invoke<CompressResult[]>("compress_images", {
    args: {
      inputs: args.inputs,
      out_dir: args.outDir,
      format: args.format,
      mode: args.mode,
      quality: args.quality ?? null,
      target_kb: args.targetKb ?? null,
    },
  });
}

export interface YoutubeResult {
  success: boolean;
  outputs?: string[];
  skipped?: { i: number; title: string }[];
  durationMs?: number;
  errorCode?: string;
  message?: string;
}

export type YoutubeMode = "audio" | "video" | "playlist_audio";

export interface YoutubeInfo {
  success: boolean;
  title?: string;
  thumbnail?: string;
  duration?: number;
  uploader?: string;
  isPlaylist?: boolean;
  trackCount?: number;
  heights?: number[];
  errorCode?: string;
  message?: string;
}

/** Fetches video metadata (title/thumbnail/qualities) without downloading. */
export async function youtubeInfo(url: string): Promise<YoutubeInfo> {
  const raw = await invoke<string>("youtube_info", { url });
  return parseLastJson<YoutubeInfo>(raw);
}

/** Downloads from YouTube via yt-dlp (bundled ffmpeg). Progress via `tool-progress` events. */
export async function downloadYoutube(
  url: string,
  mode: YoutubeMode,
  outputDir: string,
  audioKbps?: number,
  maxHeight?: number
): Promise<YoutubeResult> {
  const raw = await invoke<string>("download_youtube", {
    url,
    mode,
    outputDir,
    audioKbps: audioKbps ?? null,
    maxHeight: maxHeight ?? null,
  });
  return parseLastJson<YoutubeResult>(raw);
}

/** Compresses a video via bundled ffmpeg (H.264 re-encode). Progress via `tool-progress`. */
export async function compressVideo(
  input: string,
  output: string,
  crf?: number,
  preset?: string
): Promise<string> {
  return invoke<string>("compress_video", {
    args: { input, output, crf: crf ?? null, preset: preset ?? null },
  });
}

/** Batch audio conversion (mp3/wav/flac) via bundled ffmpeg. Returns output paths. */
export async function convertAudio(
  inputs: string[],
  outDir: string,
  format: "mp3" | "wav" | "flac",
  bitrate?: number
): Promise<string[]> {
  return invoke<string[]>("convert_audio", {
    args: { inputs, out_dir: outDir, format, bitrate: bitrate ?? null },
  });
}

export interface GifOptions {
  fps?: number;
  width?: number;
  start?: number;
  duration?: number;
}

/** Converts a video clip to GIF via bundled ffmpeg. Progress via `tool-progress`. */
export async function videoToGif(
  input: string,
  output: string,
  opts: GifOptions = {}
): Promise<string> {
  return invoke<string>("video_to_gif", {
    args: {
      input,
      output,
      fps: opts.fps ?? null,
      width: opts.width ?? null,
      start: opts.start ?? null,
      duration: opts.duration ?? null,
    },
  });
}

/** Whether the on-demand Docling module (PDF→Markdown) is ready. Always true in dev. */
export async function doclingInstalled(): Promise<boolean> {
  return invoke<boolean>("docling_installed");
}

/** Downloads + extracts the Docling module if missing. Progress via `docling-progress`. */
export async function ensureDocling(): Promise<void> {
  await invoke("ensure_docling");
}

/**
 * Whether ffmpeg/ffprobe are available. Saíram do instalador (168 MB crus) e
 * vêm sob demanda — em dev resolvem de `src-tauri/binaries/` e isto dá true.
 */
export async function ffmpegInstalled(): Promise<boolean> {
  return invoke<boolean>("ffmpeg_installed");
}

/** Downloads + extracts ffmpeg/ffprobe if missing. Progress via `ffmpeg-progress`. */
export async function ensureFfmpeg(): Promise<void> {
  await invoke("ensure_ffmpeg");
}

/** Whether the on-demand transcription module (faster-whisper) is ready. */
export async function whisperInstalled(): Promise<boolean> {
  return invoke<boolean>("whisper_installed");
}

/** Downloads + extracts the Whisper module. Progress via `whisper-progress`. */
export async function ensureWhisper(): Promise<void> {
  await invoke("ensure_whisper");
}

/** Whether the on-demand depth module (Depth Anything V2 / ONNX) is ready. */
export async function depthInstalled(): Promise<boolean> {
  return invoke<boolean>("depth_installed");
}

/** Downloads + extracts the depth module. Progress via `depth-progress`. */
export async function ensureDepth(): Promise<void> {
  await invoke("ensure_depth");
}

export async function rembgInstalled(): Promise<boolean> {
  return invoke<boolean>("rembg_installed");
}

export async function ensureRembg(): Promise<void> {
  await invoke("ensure_rembg");
}

export interface RemoveBgResult {
  success: boolean;
  outputPath?: string;
  width?: number;
  height?: number;
  provider?: string;
  durationMs?: number;
  message?: string;
  errorCode?: string;
}

/** Remove o fundo (u2net via ONNX). Devolve um PNG com alfa em temp. */
export async function removeBg(inputPath: string): Promise<RemoveBgResult> {
  return runTool<RemoveBgResult>("remove_bg", { inputPath });
}

export interface DepthMapResult {
  success: boolean;
  /** PNG de rascunho em temp. Modo LA quando a entrada tinha transparência. */
  outputPath?: string;
  width?: number;
  height?: number;
  hasAlpha?: boolean;
  /** Execution provider do ONNX Runtime efetivamente usado. */
  provider?: string;
  model?: string;
  durationMs?: number;
  message?: string;
  errorCode?: string;
}

/**
 * Gera o mapa de profundidade. Carrega o modelo, infere e o descarta — o
 * sidecar é um processo separado que morre no fim, então RAM e VRAM voltam ao
 * sistema sem depender de coleta de lixo.
 */
export async function depthMap(inputPath: string, model?: string): Promise<DepthMapResult> {
  return runTool<DepthMapResult>("depth_map", { inputPath, model });
}

export interface DepthAdjustArgs {
  /** O rascunho devolvido por `depthMap`. */
  inputPath: string;
  outputPath: string;
  invert?: boolean;
  /** 1 = sem alteração. Mesma fórmula do `filter: contrast()` do CSS. */
  contrast?: number;
}

/**
 * Salva o mapa com inversão/contraste aplicados. Roda no sidecar light: não
 * recarrega o modelo nem refaz inferência.
 */
export async function depthAdjust(args: DepthAdjustArgs): Promise<DepthMapResult> {
  return runTool<DepthMapResult>("depth_adjust", args);
}

export type WhisperModelSize = "tiny" | "base" | "small" | "medium" | "large-v3";
export type SubtitleFormat = "srt" | "vtt" | "ass";
export type SubtitleStyle = "classico" | "youtube" | "karaoke" | "minimalista" | "neon";

/**
 * Espelho de `ESTILOS` em `python/subtitles.py` — mexeu num, mexa no outro.
 * A descrição fica só aqui porque é texto de interface.
 */
export const SUBTITLE_STYLES: { value: SubtitleStyle; label: string; descricao: string }[] = [
  { value: "classico", label: "Clássico", descricao: "Branco com contorno preto, no rodapé." },
  { value: "youtube", label: "YouTube", descricao: "Caixa escura atrás do texto." },
  { value: "karaoke", label: "Karaokê", descricao: "Roxo, centralizado, com salto ao aparecer." },
  { value: "minimalista", label: "Minimalista", descricao: "Fino, sem contorno, discreto." },
  { value: "neon", label: "Neon", descricao: "Contorno roxo brilhando." },
];

export interface SubtitleColors {
  /** Cor do texto. */
  cor: string;
  contorno: string;
  /** Palavra acesa no karaokê. */
  destaque: string;
  /** Caixa atrás do texto (só o preset YouTube usa). */
  caixa: string;
}

/**
 * Cores padrão de cada preset — espelho de `ESTILOS` em `python/subtitles.py`,
 * já em `#RRGGBB`. É a fonte única da prévia e dos seletores de cor.
 *
 * O Python guarda em `&HAABBGGRR` (BGR, alfa invertido) e converte na entrada;
 * aqui tudo é hex normal para o `<input type="color">` funcionar direto.
 */
export const SUBTITLE_STYLE_COLORS: Record<SubtitleStyle, SubtitleColors> = {
  classico: { cor: "#FFFFFF", contorno: "#000000", destaque: "#FFD24A", caixa: "#000000" },
  youtube: { cor: "#FFFFFF", contorno: "#000000", destaque: "#FFD24A", caixa: "#000000" },
  karaoke: { cor: "#FFFFFF", contorno: "#A855F7", destaque: "#FFD24A", caixa: "#000000" },
  minimalista: { cor: "#FFFFFF", contorno: "#000000", destaque: "#FFD24A", caixa: "#000000" },
  neon: { cor: "#FFFFFF", contorno: "#8300FF", destaque: "#FFD24A", caixa: "#000000" },
};

/** Distância RGB entre duas cores `#RRGGBB`. */
export function distanciaCor(a: string, b: string): number {
  const rgb = (h: string) => {
    const s = h.replace("#", "");
    return [0, 2, 4].map((i) => parseInt(s.slice(i, i + 2), 16));
  };
  const [r1, g1, b1] = rgb(a);
  const [r2, g2, b2] = rgb(b);
  return Math.sqrt((r1 - r2) ** 2 + (g1 - g2) ** 2 + (b1 - b2) ** 2);
}

/**
 * Abaixo disto a cor some dentro da outra. É a mesma regra travada por teste em
 * `python/test_subtitles.py` — o app avisa em vez de deixar gerar ilegível.
 */
export const DISTANCIA_MINIMA_COR = 120;

/** Espelho de `RITMOS` em `python/subtitles.py`. */
export type SubtitleRhythm = "classica" | "curta" | "tiktok";

export const SUBTITLE_RHYTHMS: { value: SubtitleRhythm; label: string; descricao: string }[] = [
  { value: "classica", label: "Clássica", descricao: "Até 2 linhas, como legenda de filme." },
  { value: "curta", label: "Curta", descricao: "Uma linha por vez, lê mais rápido." },
  { value: "tiktok", label: "Dinâmica", descricao: "1 a 3 palavras por vez, ritmo de redes." },
];

/** Alinhamento numpad do ASS: 2 = base, 5 = meio, 8 = topo. */
export type SubtitlePosition = 2 | 5 | 8;

export const SUBTITLE_POSITIONS: { value: SubtitlePosition; label: string }[] = [
  { value: 2, label: "Rodapé" },
  { value: 5, label: "Meio" },
  { value: 8, label: "Topo" },
];

/** Famílias de fonte instaladas no Windows. Lista do registro, via Rust. */
export async function systemFonts(): Promise<string[]> {
  return invoke<string[]>("system_fonts");
}

export interface BurnSubtitlesArgs {
  input: string;
  /** Caminho do .ass (ou .srt) já gerado. */
  subtitles: string;
  output: string;
  /** true = queima na imagem (recodifica); false = grava como faixa. */
  burn?: boolean;
  crf?: number;
}

/**
 * Grava a legenda no vídeo. Progresso real via `tool-progress` (o ffmpeg
 * reporta `out_time_us`).
 *
 * Queimar recodifica o vídeo inteiro — é a operação mais lenta do app. Como
 * faixa é instantâneo, mas Instagram e TikTok ignoram legenda em faixa.
 */
export async function burnSubtitles(args: BurnSubtitlesArgs): Promise<string> {
  return invoke<string>("burn_subtitles", { args });
}

/** Codec que será usado ao queimar. Detectado uma vez e cacheado no Rust. */
export async function videoEncoder(): Promise<string> {
  return invoke<string>("video_encoder");
}

/** Nome legível do encoder, para a interface. */
export function nomeDoEncoder(codec: string): string {
  const mapa: Record<string, string> = {
    h264_nvenc: "placa NVIDIA",
    h264_qsv: "gráficos Intel",
    h264_amf: "placa AMD",
    libx264: "processador",
  };
  return mapa[codec] ?? codec;
}

export interface TranscribeArgs {
  inputPath: string;
  outputPath: string;
  /** "pt" por padrão — a autodetecção confunde português com espanhol. */
  language?: string;
  model?: WhisperModelSize;
  format?: SubtitleFormat;
  /** Quantas palavras cabem em cada bloco. Vale para todos os formatos. */
  rhythm?: SubtitleRhythm;
  /* Os campos abaixo só valem com `format: "ass"` — é o único que carrega
     estilo. Ausentes, o preset decide. */
  style?: SubtitleStyle;
  font?: string;
  /** Medido contra uma tela de 1080 de altura (o `PlayResY` do ASS). */
  size?: number;
  alignment?: SubtitlePosition;
  /** Distância da borda, na mesma escala de 1080. `0` é válido. */
  marginV?: number;
  /** Acende a palavra sendo dita. Exige tempo por palavra (já temos). */
  karaoke?: boolean;
  /* Cores em `#RRGGBB`. Ausentes, valem as do preset. A conversão para o
     formato do ASS acontece no Python (`hex_para_ass`). */
  color?: string;
  outlineColor?: string;
  highlightColor?: string;
  boxColor?: string;
}

export interface TranscribeResult {
  success: boolean;
  outputPath?: string;
  durationMs?: number;
  language?: string;
  /** Blocos finais de legenda, já segmentados. A Fase C edita isto. */
  segments?: { start: number; end: number; text: string }[];
  text?: string;
  errorCode?: string;
  message?: string;
}

export interface RestyleArgs {
  /** .srt/.vtt já existente. */
  inputPath: string;
  /** .ass de saída. */
  outputPath: string;
  style?: SubtitleStyle;
  font?: string;
  size?: number;
  alignment?: SubtitlePosition;
  marginV?: number;
  color?: string;
  outlineColor?: string;
  boxColor?: string;
}

/**
 * Converte uma legenda pronta em `.ass` estilizado.
 *
 * É o caminho "revisei o .srt à mão e agora quero gravá-lo no vídeo": sem isto
 * a legenda importada só poderia ser queimada crua, porque estilo só existe no
 * .ass. Roda no bundle light — só mexe em texto, não carrega o Whisper.
 */
export async function restyleSubtitles(args: RestyleArgs): Promise<TranscribeResult> {
  return runTool<TranscribeResult>("restyle", args);
}

export interface SubtitleSegment {
  start: number;
  end: number;
  text: string;
  /** Tempo por palavra do Whisper. Sai do ar se o texto for editado. */
  words?: { start: number; end: number; word: string }[];
}

export interface WriteSubtitlesArgs {
  segments: SubtitleSegment[];
  outputPath: string;
  format: SubtitleFormat;
  style?: SubtitleStyle;
  font?: string;
  size?: number;
  alignment?: SubtitlePosition;
  marginV?: number;
  karaoke?: boolean;
  color?: string;
  outlineColor?: string;
  highlightColor?: string;
  boxColor?: string;
}

/** Lê .srt/.vtt e devolve os blocos, sem gravar nada. Para alimentar o editor. */
export async function readSubtitles(inputPath: string): Promise<TranscribeResult> {
  return runTool<TranscribeResult>("subtitle_read", { inputPath });
}

/**
 * Grava a legenda a partir dos blocos editados na interface.
 *
 * É o passo que fecha o editor: sem ele, corrigir uma palavra exigiria
 * transcrever tudo de novo (perdendo a correção) ou abrir o .srt fora do app.
 * Roda no bundle light — não carrega o Whisper.
 */
export async function writeSubtitles(args: WriteSubtitlesArgs): Promise<TranscribeResult> {
  return runTool<TranscribeResult>("subtitle_write", args);
}

/** Transcreve áudio/vídeo em legenda. Progresso real via evento `tool-progress`. */
export async function transcribe(args: TranscribeArgs): Promise<TranscribeResult> {
  return runTool<TranscribeResult>("transcribe", {
    language: "pt",
    model: "small",
    format: "srt",
    ...args,
  });
}

export async function saveMarkdown(
  path: string,
  content: string
): Promise<void> {
  await invoke("save_markdown", { path, content });
}

export async function openFolder(filePath: string): Promise<void> {
  await invoke("open_folder", { filePath });
}

export type CaptureScope = "pagina" | "pagina_subpaginas" | "dominio";

export interface CaptureOptions {
  texto: boolean;
  markdown: boolean;
  html: boolean;
  links: boolean;
  screenshot: boolean;
  metadados: boolean;
  explorarTabsAccordions: boolean;
  scrollAutomatico: boolean;
}

export interface CaptureArgs {
  url: string;
  escopo: CaptureScope;
  opcoes: CaptureOptions;
  maxPaginas?: number | null;   // null/undefined = sem limite
  concorrencia: number;          // default 5
}

export interface CapturePageResult {
  url: string;
  status: "ok" | "erro";
  mdPath?: string;
  htmlPath?: string;
  screenshotPath?: string;
  error?: string;
}

export interface CaptureResult {
  outputDir: string;
  encontradas: number;
  processadas: number;
  falharam: number;
  arquivos: { markdown: number; html: number; screenshots: number };
  paginas: CapturePageResult[];
  durationMs: number;
}

export async function captureSite(args: CaptureArgs) {
  return runTool<CaptureResult>("capture_site", {
    url: args.url,
    escopo: args.escopo,
    opcoes: args.opcoes,
    max_paginas: args.maxPaginas ?? null,
    concorrencia: args.concorrencia,
  });
}

export async function webcaptureInstalled() { return invoke<boolean>("webcapture_installed"); }
export async function ensureWebcapture() { await invoke("ensure_webcapture"); }
export async function createZip(sourceDir: string, destZip: string) {
  await invoke("create_zip", { sourceDir, destZip });
}
