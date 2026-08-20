import { Image as ImageIcon } from "lucide-react";
import { useState } from "react";
import { open, save } from "@tauri-apps/plugin-dialog";
import { convertFileSrc } from "@tauri-apps/api/core";
import { copyFile, upscaleImage } from "../../services/conversionService";
import type { UpscaleResult } from "../../services/conversionService";
import { useDragDrop } from "../../hooks/useDragDrop";
import type { ToolProps } from "../registry";
import { revealMedia, useToolEnter } from "../../lib/motion";
import { useToolProgress } from "../../hooks/useToolProgress";
import { ProgressoTranscricao } from "../../components/ProgressoTranscricao";
import { Button, ResultPanel, SegmentedControl } from "../../components/ui";

const IMAGE_EXTS = ["png", "jpg", "jpeg", "webp"];

const ESCALAS = [
  { value: 2, label: "2x" },
  { value: 4, label: "4x" },
] as const;

type Escala = (typeof ESCALAS)[number]["value"];

function nome(p: string) {
  return p.split(/[/\\]/).pop() ?? p;
}

/**
 * Aumento de resolução com IA (Real-ESRGAN ncnn/Vulkan).
 *
 * O modelo roda num processo separado, que morre ao fim de cada imagem — RAM e
 * VRAM voltam ao sistema sem depender de limpeza manual. Nada é carregado até
 * o clique em "Aumentar qualidade".
 */
export function ImageUpscaleTool({ settings, addHistory }: ToolProps) {
  const [input, setInput] = useState<string | null>(null);
  const [saida, setSaida] = useState<(UpscaleResult & { stamp: number }) | null>(null);
  const [escala, setEscala] = useState<Escala>(2);
  const [busy, setBusy] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [resultado, setResultado] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [dropError, setDropError] = useState<string | null>(null);

  const { progresso, etapa, zerar } = useToolProgress();

  function escolher(caminho: string) {
    setInput(caminho);
    // Trocar a imagem invalida o resultado: manter o antigo ao lado de uma
    // original nova é a forma mais fácil de salvar o arquivo errado.
    setSaida(null);
    setResultado(null);
    setErro(null);
  }

  const { isDragging, handleDragOver, handleDragLeave, handleDrop } = useDragDrop({
    accept: IMAGE_EXTS,
    maxSizeMb: settings.maxFileSizeMb,
    onFiles: (fs) => { setDropError(null); if (fs[0]) escolher(fs[0].path); },
    onError: setDropError,
  });

  async function pickFile() {
    const picked = await open({
      multiple: false,
      filters: [{ name: "Imagens", extensions: IMAGE_EXTS }],
    });
    if (typeof picked === "string") escolher(picked);
  }

  async function aumentar() {
    if (!input || busy) return;
    setBusy(true);
    setErro(null);
    setResultado(null);
    zerar();
    try {
      const r = await upscaleImage({ input, scale: escala });
      setSaida({ ...r, stamp: Date.now() });
    } catch (e) {
      setErro(typeof e === "string" ? e : "Falha ao aumentar a qualidade.");
    } finally {
      setBusy(false);
    }
  }

  async function salvar() {
    if (!input || !saida || salvando) return;
    const base = nome(input).replace(/\.[^.]+$/, "");
    const destino = await save({
      filters: [{ name: "PNG", extensions: ["png"] }],
      defaultPath: settings.defaultOutputDir
        ? `${settings.defaultOutputDir}\\${base}-${escala}x.png`
        : `${base}-${escala}x.png`,
    });
    if (!destino) return;

    setSalvando(true);
    setErro(null);
    try {
      const gravado = await copyFile(saida.outputPath, destino);
      setResultado(gravado);
      addHistory({
        id: crypto.randomUUID(),
        tool: "image-upscale",
        filename: nome(input),
        inputPath: input,
        outputPath: gravado,
        durationMs: saida.durationMs,
        timestamp: Date.now(),
        success: true,
      });
    } catch {
      setErro("Falha ao salvar o PNG.");
    } finally {
      setSalvando(false);
    }
  }

  const toolRef = useToolEnter();

  return (
    <div ref={toolRef} className="space-y-4">
      <div
        role="button"
        tabIndex={0}
        aria-label="Arraste uma imagem aqui ou clique para selecionar"
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onClick={pickFile}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") { e.preventDefault(); void pickFile(); }
        }}
        className={[
          "rounded-glass border-2 border-dashed flex flex-col items-center justify-center gap-2 cursor-pointer transition-all",
          input ? "p-5" : "p-10",
          isDragging
            ? "border-accent bg-accent/10"
            : "border-border-subtle hover:border-border hover:bg-overlay/[0.07]",
        ].join(" ")}
      >
        <ImageIcon
          strokeWidth={1.5}
          aria-hidden="true"
          className={[
            "transition-all",
            input ? "w-6 h-6" : "w-9 h-9",
            isDragging ? "text-accent animate-float" : "text-text-muted",
          ].join(" ")}
        />
        <p className="text-text-primary text-sm font-medium">
          {isDragging
            ? "Solte a imagem aqui"
            : input
              ? `Trocar imagem — ${nome(input)}`
              : "Arraste uma imagem aqui"}
        </p>
        {!input && (
          <p className="text-text-muted text-xs">
            ou clique para selecionar — PNG, JPG ou WebP
          </p>
        )}
      </div>

      {dropError && <p role="alert" className="text-danger text-xs">{dropError}</p>}

      {input && (
        <div className="grid gap-3 sm:grid-cols-2">
          <Painel
            titulo="Original"
            legenda={saida ? `${saida.width} × ${saida.height}` : undefined}
          >
            <img
              src={convertFileSrc(input)}
              alt={`Original — ${nome(input)}`}
              onLoad={(e) => revealMedia(e.currentTarget)}
              className="w-full h-full object-contain"
            />
          </Painel>

          <Painel
            titulo="Melhorada"
            legenda={saida ? `${saida.outWidth} × ${saida.outHeight}` : undefined}
          >
            {saida ? (
              <img
                /* `?t=` fura o cache: o rascunho reusa o mesmo caminho a cada
                   execução, e sem isto o WebView mostraria o resultado anterior. */
                src={`${convertFileSrc(saida.outputPath)}?t=${saida.stamp}`}
                alt="Resultado com qualidade aumentada"
                onLoad={(e) => revealMedia(e.currentTarget)}
                className="w-full h-full object-contain"
              />
            ) : (
              <p className="text-text-muted text-[11px] px-3 text-center">
                {busy ? "Processando…" : "Ainda não processada"}
              </p>
            )}
          </Painel>
        </div>
      )}

      <div className="glass rounded-glass p-4 space-y-2">
        <SegmentedControl
          label="Escala"
          options={ESCALAS as unknown as { value: Escala; label: string }[]}
          value={escala}
          onChange={setEscala}
        />
        <p className="text-text-muted text-[11px]">
          O modelo trabalha sempre em 4x; no 2x o resultado é reduzido depois, o que costuma
          deixar a imagem mais limpa que pedir 2x direto.
        </p>
      </div>

      <Button
        variant={saida ? "glass" : "primary"}
        className="w-full"
        onClick={aumentar}
        disabled={!input || salvando}
        loading={busy}
      >
        {busy ? "Processando…" : saida ? "Processar de novo" : "Aumentar qualidade"}
      </Button>

      {busy && (
        <ProgressoTranscricao
          progresso={progresso}
          etapa={etapa}
          aviso="Roda na placa de vídeo. Imagem grande é dividida em blocos automaticamente."
        />
      )}

      {saida && (
        <>
          <Button variant="primary" className="w-full" onClick={salvar} loading={salvando}>
            {salvando ? "Salvando…" : "Salvar PNG…"}
          </Button>
          <p className="text-text-muted text-[11px]">
            {saida.width} × {saida.height} → {saida.outWidth} × {saida.outHeight} ·{" "}
            {(saida.durationMs / 1000).toFixed(1)} s
          </p>
        </>
      )}

      {erro && <p role="alert" className="text-danger text-xs">{erro}</p>}

      {resultado && <ResultPanel paths={[resultado]} label="Imagem salva" />}

      <p className="text-text-muted text-[11px]">
        O processamento roda no seu computador — nenhuma imagem sai daqui. O modelo é carregado
        na hora e liberado ao terminar.
      </p>
    </div>
  );
}

/** Moldura das duas prévias, sobre xadrez porque o PNG pode ter alfa. */
function Painel({
  titulo,
  legenda,
  children,
}: {
  titulo: string;
  legenda?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5 min-w-0">
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-text-secondary text-xs font-medium">{titulo}</p>
        {legenda && <p className="text-text-muted text-[11px] tabular-nums">{legenda}</p>}
      </div>
      <div className="glass-inset overflow-hidden aspect-square flex items-center justify-center checker">
        {children}
      </div>
    </div>
  );
}
