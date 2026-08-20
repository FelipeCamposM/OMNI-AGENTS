import { Image as ImageIcon } from "lucide-react";
import { useState } from "react";
import { open, save } from "@tauri-apps/plugin-dialog";
import { convertFileSrc } from "@tauri-apps/api/core";
import { copyFile, vectorizeImage } from "../../services/conversionService";
import type { VectorDetail, VectorizeResult } from "../../services/conversionService";
import { useDragDrop } from "../../hooks/useDragDrop";
import type { ToolProps } from "../registry";
import { revealMedia, useToolEnter } from "../../lib/motion";
import { Button, ResultPanel, SegmentedControl } from "../../components/ui";

const IMAGE_EXTS = ["png", "jpg", "jpeg", "webp"];

const DETALHES = [
  { value: "baixo", label: "Baixo" },
  { value: "medio", label: "Médio" },
  { value: "alto", label: "Alto" },
] as const;

function nome(p: string) {
  return p.split(/[/\\]/).pop() ?? p;
}

function kb(bytes: number) {
  return bytes < 1024 * 1024
    ? `${Math.round(bytes / 1024)} KB`
    : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/**
 * Vetorização raster → SVG (VTracer, nativo em Rust).
 *
 * Duas etapas como no mapa de profundidade: o traçado é a parte cara, então
 * grava um rascunho em temp para a prévia e salvar é só copiar. Trocar o nível
 * de detalhe refaz o traçado — é o único jeito, o parâmetro entra no algoritmo.
 */
export function ImageVectorizeTool({ settings, addHistory }: ToolProps) {
  const [input, setInput] = useState<string | null>(null);
  const [svg, setSvg] = useState<(VectorizeResult & { stamp: number }) | null>(null);
  const [detalhe, setDetalhe] = useState<VectorDetail>("medio");
  const [busy, setBusy] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [resultado, setResultado] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [dropError, setDropError] = useState<string | null>(null);

  function escolher(caminho: string) {
    setInput(caminho);
    // Trocar a imagem invalida o SVG: manter o antigo ao lado de uma original
    // nova é a forma mais fácil de salvar o arquivo errado.
    setSvg(null);
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

  async function vetorizar() {
    if (!input || busy) return;
    setBusy(true);
    setErro(null);
    setResultado(null);
    try {
      const r = await vectorizeImage({ input, detail: detalhe });
      setSvg({ ...r, stamp: Date.now() });
    } catch (e) {
      setErro(typeof e === "string" ? e : "Falha ao vetorizar a imagem.");
    } finally {
      setBusy(false);
    }
  }

  async function salvar() {
    if (!input || !svg || salvando) return;
    const base = nome(input).replace(/\.[^.]+$/, "");
    const destino = await save({
      filters: [{ name: "SVG", extensions: ["svg"] }],
      defaultPath: settings.defaultOutputDir
        ? `${settings.defaultOutputDir}\\${base}.svg`
        : `${base}.svg`,
    });
    if (!destino) return;

    setSalvando(true);
    setErro(null);
    try {
      const saida = await copyFile(svg.outputPath, destino);
      setResultado(saida);
      addHistory({
        id: crypto.randomUUID(),
        tool: "image-vectorize",
        filename: nome(input),
        inputPath: input,
        outputPath: saida,
        durationMs: svg.durationMs,
        timestamp: Date.now(),
        success: true,
      });
    } catch {
      setErro("Falha ao salvar o SVG.");
    } finally {
      setSalvando(false);
    }
  }

  const toolRef = useToolEnter();
  const reduzida = svg != null && svg.tracedSide < Math.max(svg.width, svg.height);

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
          <Painel titulo="Original">
            <img
              src={convertFileSrc(input)}
              alt={`Original — ${nome(input)}`}
              onLoad={(e) => revealMedia(e.currentTarget)}
              className="w-full h-full object-contain"
            />
          </Painel>

          <Painel titulo="Vetorizado">
            {svg ? (
              <img
                /* `?t=` fura o cache: o rascunho reusa o mesmo caminho a cada
                   traçado, e sem isto o WebView mostraria o SVG anterior. */
                src={`${convertFileSrc(svg.outputPath)}?t=${svg.stamp}`}
                alt="Resultado vetorizado"
                onLoad={(e) => revealMedia(e.currentTarget)}
                className="w-full h-full object-contain"
              />
            ) : (
              <p className="text-text-muted text-[11px] px-3 text-center">
                {busy ? "Vetorizando…" : "Ainda não vetorizado"}
              </p>
            )}
          </Painel>
        </div>
      )}

      <div className="glass rounded-glass p-4 space-y-2">
        <SegmentedControl
          label="Nível de detalhe"
          options={DETALHES as unknown as { value: VectorDetail; label: string }[]}
          value={detalhe}
          onChange={setDetalhe}
        />
        <p className="text-text-muted text-[11px]">
          Baixo gera um arquivo leve, bom para logo e desenho. Alto guarda mais cores e
          nuances, útil em fotografia — e pesa mais.
        </p>
      </div>

      <Button
        variant={svg ? "glass" : "primary"}
        className="w-full"
        onClick={vetorizar}
        disabled={!input || salvando}
        loading={busy}
      >
        {busy ? "Vetorizando…" : svg ? "Vetorizar de novo" : "Vetorizar"}
      </Button>

      {svg && (
        <>
          <Button variant="primary" className="w-full" onClick={salvar} loading={salvando}>
            {salvando ? "Salvando…" : "Salvar SVG…"}
          </Button>
          <p className="text-text-muted text-[11px]">
            {svg.paths.toLocaleString("pt-BR")} formas vetoriais · {kb(svg.bytes)} ·{" "}
            {(svg.durationMs / 1000).toFixed(1)} s
            {reduzida &&
              ` · traçado a partir de ${svg.tracedSide} px do lado maior (o SVG escala sem perder nitidez)`}
          </p>
        </>
      )}

      {erro && <p role="alert" className="text-danger text-xs">{erro}</p>}

      {resultado && <ResultPanel paths={[resultado]} label="SVG salvo" />}

      <p className="text-text-muted text-[11px]">
        A vetorização roda no seu computador — nenhuma imagem sai daqui.
      </p>
    </div>
  );
}

/**
 * Moldura das duas prévias. As duas ficam sobre o xadrez: o SVG preserva o
 * fundo transparente do PNG de entrada, então mostrar sobre branco ou preto
 * faria a prévia mentir sobre o arquivo final.
 */
function Painel({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5 min-w-0">
      <p className="text-text-secondary text-xs font-medium">{titulo}</p>
      <div className="glass-inset overflow-hidden aspect-square flex items-center justify-center checker">
        {children}
      </div>
    </div>
  );
}
