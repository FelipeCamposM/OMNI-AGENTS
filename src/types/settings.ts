import { PALETA_PADRAO } from "../lib/palettes";

export type Theme = "escuro" | "claro" | "sistema";
/**
 * Fundos estáticos (CSS, em `src/index.css`) mais qualquer id de efeito
 * animado registrado em `src/components/backgrounds/registry.tsx`.
 * O `(string & {})` mantém o autocomplete dos presets sem travar ids novos —
 * adicionar efeito não deve exigir mexer neste arquivo.
 */
export type Background =
  | "mesh-1"
  | "mesh-2"
  | "mesh-3"
  | "custom"
  | "nenhum"
  // eslint-disable-next-line @typescript-eslint/ban-types
  | (string & {});
export type GlassLevel = "sutil" | "medio" | "forte";
export type MotionLevel = "completas" | "reduzidas" | "desligadas";
export type ImageFormat = "webp" | "png" | "jpg" | "ico";
export type ResizeFormat = "manter" | "webp" | "png" | "jpg";
export type AudioFormat = "mp3" | "wav" | "flac";
export type HashAlgo = "md5" | "sha1" | "sha256";
export type WhisperModel = "tiny" | "base" | "small" | "medium" | "large-v3";
/* `.ass` de propósito fora daqui: é formato interno da queima (o único que
   carrega estilo), não uma saída que o usuário escolha. */
export type SubtitleFormat = "srt" | "vtt";
export type SubtitleRhythm = "classica" | "curta" | "tiktok";
/** Alinhamento numpad do ASS: 2 = rodapé, 5 = meio, 8 = topo. */
export type SubtitlePosition = 2 | 5 | 8;

/**
 * Preferências globais da suíte. Cada ferramenta lê daqui o valor inicial dos
 * seus controles — o usuário ainda pode mudar pontualmente dentro da tool.
 */
export interface AppSettings {
  // Geral
  theme: Theme;
  defaultOutputDir: string;
  openFolderAfterSave: boolean;
  maxFileSizeMb: number;

  // Aparência
  /**
   * Id da paleta de cor (ver `src/lib/palettes.ts`). Vale para ícones, foco,
   * opção selecionada, barra de rolagem e os fundos animados — id desconhecido
   * cai na primeira paleta em vez de deixar o app sem cor.
   */
  accent: string;
  background: Background;
  /** Caminho no disco; só usado quando background === "custom". */
  backgroundPath: string;
  backgroundOpacity: number; // 0..100
  backgroundBlur: number; // px, 0..40
  glass: GlassLevel;
  animations: MotionLevel;

  /**
   * Última versão cujas novidades o usuário já viu. Vazio = nunca viu, que é
   * o estado de quem instala pela primeira vez — daí o aviso aparecer uma vez
   * e só voltar quando houver versão nova. Ver `src/lib/changelog.ts`.
   */
  lastSeenVersion: string;

  // Documentos
  autoSaveNextToPdf: boolean;

  // Imagens
  imageFormat: ImageFormat;
  imageQuality: number;
  resizeMaxDim: number;
  resizeFormat: ResizeFormat;

  // Mídia
  audioFormat: AudioFormat;
  audioKbps: number;
  videoMaxHeight: number; // 0 = melhor disponível
  videoCrf: number;
  gifFps: number;
  gifWidth: number;
  /** Modelo do Whisper. Maior = melhor e mais lento; o download é separado. */
  whisperModel: WhisperModel;
  subtitleFormat: SubtitleFormat;
  /** Quantas palavras cabem por bloco — o que evita o paredão de texto. */
  subtitleRhythm: SubtitleRhythm;
  /** Família da fonte, igual ao que vai no `.ass`. Ver src/lib/subtitleFonts.ts. */
  subtitleFont: string;
  /** Medido numa tela de 1080 de altura (o `PlayResY` do ASS). */
  subtitleSize: number;
  subtitlePosition: SubtitlePosition;
  subtitleMarginV: number;
  subtitleKaraoke: boolean;
  /* Cores iniciais em `#RRGGBB`. Vazio = usa as do preset escolhido, que é o
     comportamento que quase todo mundo quer. */
  subtitleColor: string;
  subtitleOutlineColor: string;

  // Utilitários
  hashAlgo: HashAlgo;
  qrSize: number;

  // Histórico
  historyLimit: number;
}

export const DEFAULT_SETTINGS: AppSettings = {
  theme: "escuro",
  defaultOutputDir: "",
  openFolderAfterSave: false,
  maxFileSizeMb: 100,

  accent: PALETA_PADRAO,
  background: "mesh-1",
  backgroundPath: "",
  backgroundOpacity: 35,
  backgroundBlur: 12,
  glass: "medio",
  animations: "completas",

  lastSeenVersion: "",

  autoSaveNextToPdf: false,

  imageFormat: "webp",
  imageQuality: 85,
  resizeMaxDim: 1280,
  resizeFormat: "manter",

  audioFormat: "mp3",
  audioKbps: 192,
  videoMaxHeight: 0,
  videoCrf: 28,
  gifFps: 12,
  gifWidth: 480,
  // "small" é o ponto doce para português: ~460 MB de modelo e qualidade
  // utilizável em CPU. "medium" fica bom mas triplica o tempo.
  whisperModel: "small",
  subtitleFormat: "srt",
  subtitleRhythm: "classica",
  subtitleFont: "Bebas Neue",
  subtitleSize: 64,
  subtitlePosition: 2,
  subtitleMarginV: 60,
  subtitleKaraoke: false,
  subtitleColor: "",
  subtitleOutlineColor: "",

  hashAlgo: "sha256",
  qrSize: 512,

  historyLimit: 50,
};

/** Teto de segurança do campo "tamanho máximo de arquivo" (MB). */
export const MAX_FILE_SIZE_LIMIT_MB = 2000;
