import { AudioLines, Clapperboard, Eraser, FileScan, Globe, Layers, Sparkles } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import {
  depthInstalled,
  doclingInstalled,
  ensureDepth,
  ensureDocling,
  ensureFfmpeg,
  ensureRealesrgan,
  ensureRembg,
  ensureWebcapture,
  ensureWhisper,
  ffmpegInstalled,
  realesrganInstalled,
  rembgInstalled,
  webcaptureInstalled,
  whisperInstalled,
} from "../services/conversionService";
import { Button } from "./ui";

/**
 * Módulos grandes demais para o instalador: ficam num Release do GitHub,
 * verificados por SHA256 e extraídos em `appLocalData/runtime/` no 1º uso.
 * O espelho em Rust é o `RemoteModule` de `src-tauri/src/commands.rs` —
 * mexeu num, confira o outro (principalmente o nome do evento).
 */
export const MODULES = {
  docling: {
    titulo: "Módulo PDF → Markdown",
    descricao:
      "A conversão de PDF usa o Docling (OCR e layout), baixado uma única vez (~700 MB). Requer internet nesta primeira vez.",
    rotuloBotao: "Baixar módulo (~700 MB)",
    tamanho: "~370 MB",
    usadoPor: "PDF → Markdown",
    icone: FileScan,
    evento: "docling-progress",
    checar: doclingInstalled,
    baixar: ensureDocling,
  },
  ffmpeg: {
    titulo: "Módulo de mídia (ffmpeg)",
    descricao:
      "Vídeo e áudio usam o ffmpeg, baixado uma única vez (~59 MB). Ele saiu do instalador para as atualizações do app ficarem leves.",
    rotuloBotao: "Baixar módulo (~59 MB)",
    tamanho: "~59 MB",
    usadoPor: "Vídeo, áudio, GIF e YouTube",
    icone: Clapperboard,
    evento: "ffmpeg-progress",
    checar: ffmpegInstalled,
    baixar: ensureFfmpeg,
  },
  whisper: {
    titulo: "Módulo de transcrição (Whisper)",
    descricao:
      "A legenda automática usa o Whisper, baixado uma única vez (~90 MB). O modelo de reconhecimento vem depois, na primeira transcrição.",
    rotuloBotao: "Baixar módulo (~90 MB)",
    tamanho: "~90 MB",
    usadoPor: "Legenda automática",
    icone: AudioLines,
    evento: "whisper-progress",
    checar: whisperInstalled,
    baixar: ensureWhisper,
  },
  realesrgan: {
    titulo: "Módulo de aumento de qualidade (Real-ESRGAN)",
    descricao:
      "O aumento de resolução usa o Real-ESRGAN, baixado uma única vez (~31 MB). Os pesos do modelo vêm dentro do módulo — depois disso funciona sem internet. Precisa de placa de vídeo com Vulkan.",
    rotuloBotao: "Baixar módulo (~31 MB)",
    tamanho: "~31 MB",
    usadoPor: "Aumentar qualidade",
    icone: Sparkles,
    evento: "realesrgan-progress",
    checar: realesrganInstalled,
    baixar: ensureRealesrgan,
  },
  rembg: {
    titulo: "Módulo de remoção de fundo (u2net)",
    descricao:
      "A remoção de fundo usa o rembg com o modelo u2net, baixado uma única vez (~136 MB). Os pesos do modelo (~168 MB) vêm depois, na primeira remoção.",
    rotuloBotao: "Baixar módulo (~136 MB)",
    tamanho: "~136 MB",
    usadoPor: "Remover fundo",
    icone: Eraser,
    evento: "rembg-progress",
    checar: rembgInstalled,
    baixar: ensureRembg,
  },
  depth: {
    titulo: "Módulo de profundidade (Depth Anything V2)",
    descricao:
      "O mapa de profundidade usa o Depth Anything V2 pelo ONNX Runtime, baixado uma única vez (~45 MB). Os pesos do modelo (~94 MB) vêm depois, na primeira geração.",
    rotuloBotao: "Baixar módulo (~45 MB)",
    tamanho: "~45 MB",
    usadoPor: "Gerar Depth Map",
    icone: Layers,
    evento: "depth-progress",
    checar: depthInstalled,
    baixar: ensureDepth,
  },
  webcapture: {
    titulo: "Módulo de captura de site",
    descricao:
      "Capturar site baixa o motor de captura de sites (~46 MB), baixado uma única vez. Ele navega o site de verdade (Chromium) para extrair texto, Markdown, links e screenshots.",
    rotuloBotao: "Baixar módulo (~46 MB)",
    tamanho: "~46 MB",
    usadoPor: "Capturar site",
    icone: Globe,
    evento: "webcapture-progress",
    checar: webcaptureInstalled,
    baixar: ensureWebcapture,
  },
} as const;

export type ModuleId = keyof typeof MODULES;

/** Estado do módulo + ação de baixar, para quem quer montar a própria UI. */
export function useModule(id: ModuleId) {
  const mod = MODULES[id];
  const [pronto, setPronto] = useState<boolean | null>(null);
  const [baixando, setBaixando] = useState(false);
  const [progresso, setProgresso] = useState(0);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    // Só um `false` explícito bloqueia. Fora do Tauri (testes, `dev:vite`) o
    // invoke devolve undefined ou rejeita — e travar a ferramenta por causa de
    // uma checagem que nem rodou é pior que deixar tentar e falhar com a
    // mensagem real do backend.
    mod
      .checar()
      .then((v) => setPronto(v !== false))
      .catch(() => setPronto(true));
  }, [mod]);

  useEffect(() => {
    const un = listen<number>(mod.evento, (e) => setProgresso(e.payload));
    return () => {
      un.then((fn) => fn());
    };
  }, [mod.evento]);

  const baixar = useCallback(async () => {
    setBaixando(true);
    setErro(null);
    setProgresso(0);
    try {
      await mod.baixar();
      setPronto(true);
    } catch (e) {
      setErro(String(e));
    } finally {
      setBaixando(false);
    }
  }, [mod]);

  return { mod, pronto, baixando, progresso, erro, baixar };
}

/**
 * Bloqueia a ferramenta até o módulo estar instalado. Enquanto a checagem não
 * volta, não renderiza nada — piscar o convite de download para quem já tem o
 * módulo é pior que meio segundo de vazio.
 */
export function ModuleGate({
  id,
  children,
}: {
  id: ModuleId;
  children: React.ReactNode;
}) {
  const { mod, pronto, baixando, progresso, erro, baixar } = useModule(id);

  if (pronto === null) return null;
  if (pronto) return <>{children}</>;

  return (
    <div className="glass p-6 text-center space-y-3">
      <p className="text-text-primary text-sm font-medium">{mod.titulo}</p>
      <p className="text-text-muted text-xs">{mod.descricao}</p>

      {erro && (
        <p role="alert" className="text-danger text-xs">
          {erro}
        </p>
      )}

      {baixando ? (
        <div className="space-y-1">
          <div className="glass-inset h-2 rounded-full overflow-hidden">
            <div
              className="shimmer h-full bg-accent transition-all duration-300"
              style={{ width: `${progresso}%` }}
              role="progressbar"
              aria-valuenow={progresso}
            />
          </div>
          <p className="text-text-muted text-[11px]">Baixando… {progresso}%</p>
        </div>
      ) : (
        <Button variant="primary" onClick={baixar}>
          {mod.rotuloBotao}
        </Button>
      )}
    </div>
  );
}
