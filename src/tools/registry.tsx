import type { ReactNode, ComponentType } from "react";
import type { ModuleId } from "../components/ModuleGate";
import { Braces, Captions, CirclePlay, Eraser, FileOutput, FileText, FileType, Film, Globe, Hash, Image, Layers, Music, QrCode, Scaling, Scissors, Shrink, Sparkles, Spline, Subtitles, Video } from "lucide-react";
import type { AppSettings } from "../types/settings";
import type { HistoryEntry } from "../types/conversion";
import { PdfToMarkdownTool } from "./pdf-to-markdown/PdfToMarkdownTool";
import { MarkdownToPdfTool } from "./markdown-to-pdf/MarkdownToPdfTool";
import { DocxToPdfTool } from "./docx-to-pdf/DocxToPdfTool";
import { PdfToolsTool } from "./pdf-tools/PdfToolsTool";
import { ImageConvertTool } from "./image-convert/ImageConvertTool";
import { ImageResizeTool } from "./image-resize/ImageResizeTool";
import { ImageCompressTool } from "./image-compress/ImageCompressTool";
import { ImageVectorizeTool } from "./image-vectorize/ImageVectorizeTool";
import { ImageUpscaleTool } from "./image-upscale/ImageUpscaleTool";
import { BgRemoveTool } from "./bg-remove/BgRemoveTool";
import { DepthMapTool } from "./depth-map/DepthMapTool";
import { Base64Tool } from "./base64/Base64Tool";
import { QrCodeTool } from "./qr-code/QrCodeTool";
import { HashTool } from "./hash/HashTool";
import { YoutubeTool } from "./youtube/YoutubeTool";
import { VideoCompressTool } from "./video-compress/VideoCompressTool";
import { AudioConvertTool } from "./audio-convert/AudioConvertTool";
import { VideoToGifTool } from "./video-to-gif/VideoToGifTool";
import { VideoSubtitleTool } from "./video-subtitle/VideoSubtitleTool";
import { VideoBurnTool } from "./video-burn/VideoBurnTool";
import { WebCaptureTool } from "./web-capture/WebCaptureTool";

export type ToolCategory = "documentos" | "imagens" | "midia" | "utilitarios";

/** Props que todo componente de ferramenta recebe. */
export interface ToolProps {
  settings: AppSettings;
  addHistory: (entry: HistoryEntry) => void;
}

export interface ToolDef {
  id: string;
  name: string;
  description: string;
  category: ToolCategory;
  icon: ReactNode;
  component: ComponentType<ToolProps>;
  /** Ferramentas com grade (miniaturas de página) precisam de mais largura. */
  wide?: boolean;
  /**
   * Módulo pesado exigido por esta ferramenta (baixado sob demanda). O `App`
   * embrulha o componente num `<ModuleGate>` — a tool não precisa saber nada
   * sobre download. Ver `src/components/ModuleGate.tsx`.
   */
  module?: ModuleId;
}

export const CATEGORY_LABELS: Record<ToolCategory, string> = {
  documentos: "Documentos",
  imagens: "Imagens",
  midia: "Mídia",
  utilitarios: "Utilitários",
};

export const CATEGORY_ORDER: ToolCategory[] = [
  "documentos",
  "imagens",
  "midia",
  "utilitarios",
];

export const TOOLS: ToolDef[] = [
  {
    id: "pdf-to-markdown",
    name: "PDF → Markdown",
    description: "Converte PDFs em Markdown localmente, com OCR.",
    category: "documentos",
    icon: <FileText className="w-full h-full" />,
    component: PdfToMarkdownTool,
    module: "docling",
  },
  {
    id: "markdown-to-pdf",
    name: "Markdown → PDF",
    description: "Gera um PDF a partir de arquivos ou texto Markdown.",
    category: "documentos",
    icon: <FileOutput className="w-full h-full" />,
    component: MarkdownToPdfTool,
  },
  {
    id: "docx-to-pdf",
    name: "Word → PDF",
    description: "Converte documentos .docx em PDF, sem precisar do Word.",
    category: "documentos",
    icon: <FileType className="w-full h-full" />,
    component: DocxToPdfTool,
  },
  {
    id: "pdf-tools",
    name: "Ferramentas de PDF",
    description: "Visualize as páginas, junte, divida ou comprima arquivos PDF.",
    category: "documentos",
    icon: <Scissors className="w-full h-full" />,
    component: PdfToolsTool,
    wide: true,
  },
  {
    id: "image-convert",
    name: "Converter imagens",
    description: "Converte imagens para WebP, PNG, JPG ou ICO.",
    category: "imagens",
    icon: <Image className="w-full h-full" />,
    component: ImageConvertTool,
  },
  {
    id: "image-resize",
    name: "Redimensionar imagens",
    description: "Redimensiona, comprime e renomeia imagens em lote.",
    category: "imagens",
    icon: <Scaling className="w-full h-full" />,
    component: ImageResizeTool,
  },
  {
    id: "image-compress",
    name: "Comprimir imagens",
    description: "Reduz o peso de imagens por qualidade ou tamanho-alvo.",
    category: "imagens",
    icon: <Shrink className="w-full h-full" />,
    component: ImageCompressTool,
  },
  {
    id: "image-vectorize",
    name: "Vetorizar imagem",
    description: "Converte PNG, JPG ou WebP em SVG vetorial de verdade (VTracer).",
    category: "imagens",
    icon: <Spline className="w-full h-full" />,
    component: ImageVectorizeTool,
  },
  {
    id: "image-upscale",
    name: "Aumentar qualidade",
    description: "Aumenta a resolução em 2x ou 4x com IA (Real-ESRGAN), na sua placa de vídeo.",
    category: "imagens",
    icon: <Sparkles className="w-full h-full" />,
    component: ImageUpscaleTool,
    module: "realesrgan",
  },
  {
    id: "bg-remove",
    name: "Remover fundo",
    description: "Detecta o objeto principal e devolve um PNG com fundo transparente.",
    category: "imagens",
    icon: <Eraser className="w-full h-full" />,
    component: BgRemoveTool,
    module: "rembg",
  },
  {
    id: "depth-map",
    name: "Gerar Depth Map",
    description: "Estima a profundidade de uma imagem e gera um mapa em escala de cinza.",
    category: "imagens",
    icon: <Layers className="w-full h-full" />,
    component: DepthMapTool,
    module: "depth",
  },
  {
    id: "video-subtitle",
    name: "Legenda automática",
    description: "Transcreve vídeo ou áudio num arquivo de legenda (SRT/VTT), sem nuvem.",
    category: "midia",
    icon: <Captions className="w-full h-full" />,
    component: VideoSubtitleTool,
    module: "whisper",
  },
  {
    id: "video-burn",
    name: "Legendar vídeo",
    description: "Grava a legenda dentro do vídeo, com estilo e prévia ao vivo.",
    category: "midia",
    icon: <Subtitles className="w-full h-full" />,
    component: VideoBurnTool,
    // Duas colunas: prévia fixa + controles e editor.
    wide: true,
    // ffmpeg, não whisper: a queima sempre precisa dele, e o Whisper só quando
    // a legenda é transcrita na hora — gatear nele bloquearia 90 MB de download
    // para quem só quer gravar um .srt que já tem. O caso do Whisper é tratado
    // dentro da tool, com o mesmo `useModule`.
    module: "ffmpeg",
  },
  {
    id: "youtube",
    name: "Baixar do YouTube",
    description: "Baixa música (MP3), vídeo (MP4) ou playlist.",
    category: "midia",
    icon: <CirclePlay className="w-full h-full" />,
    component: YoutubeTool,
    module: "ffmpeg",
  },
  {
    id: "video-compress",
    name: "Comprimir vídeo",
    description: "Reduz o tamanho de vídeos (H.264).",
    category: "midia",
    icon: <Video className="w-full h-full" />,
    component: VideoCompressTool,
    module: "ffmpeg",
  },
  {
    id: "audio-convert",
    name: "Converter áudio",
    description: "Converte áudios para MP3, WAV ou FLAC.",
    category: "midia",
    icon: <Music className="w-full h-full" />,
    component: AudioConvertTool,
    module: "ffmpeg",
  },
  {
    id: "video-to-gif",
    name: "Vídeo → GIF",
    description: "Cria um GIF a partir de um trecho de vídeo.",
    category: "midia",
    icon: <Film className="w-full h-full" />,
    component: VideoToGifTool,
    module: "ffmpeg",
  },
  {
    id: "base64",
    name: "Base64 / Texto",
    description: "Codifica e decodifica texto em Base64.",
    category: "utilitarios",
    icon: <Braces className="w-full h-full" />,
    component: Base64Tool,
  },
  {
    id: "qr-code",
    name: "QR code",
    description: "Gera um QR code PNG a partir de texto ou URL.",
    category: "utilitarios",
    icon: <QrCode className="w-full h-full" />,
    component: QrCodeTool,
  },
  {
    id: "hash",
    name: "Hash / Checksum",
    description: "Calcula MD5, SHA-1 ou SHA-256 de arquivos.",
    category: "utilitarios",
    icon: <Hash className="w-full h-full" />,
    component: HashTool,
  },
  {
    id: "web-capture",
    name: "Capturar site",
    description: "Navega um site de verdade e extrai texto, Markdown, HTML, links e screenshots.",
    category: "utilitarios",
    icon: <Globe className="w-full h-full" />,
    component: WebCaptureTool,
    module: "webcapture",
    wide: true,
  },
];

export function getTool(id: string): ToolDef | undefined {
  return TOOLS.find((t) => t.id === id);
}

export function toolsByCategory(category: ToolCategory): ToolDef[] {
  return TOOLS.filter((t) => t.category === category);
}









