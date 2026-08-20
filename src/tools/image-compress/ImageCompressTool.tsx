import { Image } from "lucide-react";
import { useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { compressImages } from "../../services/conversionService";
import type {
  CompressFormat,
  CompressMode,
  CompressResult,
} from "../../services/conversionService";
import { useDragDrop } from "../../hooks/useDragDrop";
import type { SelectedFile } from "../../types/conversion";
import type { ToolProps } from "../registry";
import { useToolEnter } from "../../lib/motion";
import { ImagePreviewGrid } from "../image-convert/ImageConvertTool";
import { Button, Field, Input, ResultPanel, SegmentedControl, Slider } from "../../components/ui";

const IMAGE_EXTS = ["jpg", "jpeg", "png", "bmp", "gif", "webp", "tiff"];

const MODES: { value: CompressMode; label: string }[] = [
  { value: "qualidade", label: "Qualidade" },
  { value: "tamanho", label: "Tamanho-alvo" },
];

const FORMATS: { value: CompressFormat; label: string }[] = [
  { value: "manter", label: "Manter" },
  { value: "webp", label: "WebP" },
  { value: "jpg", label: "JPG" },
];

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export function ImageCompressTool({ settings, addHistory }: ToolProps) {
  const [files, setFiles] = useState<SelectedFile[]>([]);
  const [mode, setMode] = useState<CompressMode>("qualidade");
  const [format, setFormat] = useState<CompressFormat>("manter");
  const [quality, setQuality] = useState(settings.imageQuality);
  const [targetKb, setTargetKb] = useState(500);
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<CompressResult[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [dropError, setDropError] = useState<string | null>(null);

  // PNG é sem perdas: com "Manter" o ganho é quase nulo. Avisar é mais honesto
  // que devolver um arquivo do mesmo tamanho sem explicação.
  const hasPng = files.some((f) => f.name.toLowerCase().endsWith(".png"));
  const warnPng = format === "manter" && hasPng;

  function addFiles(incoming: SelectedFile[]) {
    setResults([]);
    setError(null);
    setFiles((prev) => {
      const seen = new Set(prev.map((f) => f.path));
      const merged = [...prev];
      for (const f of incoming) {
        if (!seen.has(f.path)) {
          seen.add(f.path);
          merged.push(f);
        }
      }
      return merged;
    });
  }

  const { isDragging, handleDragOver, handleDragLeave, handleDrop } = useDragDrop({
    accept: IMAGE_EXTS,
    maxSizeMb: settings.maxFileSizeMb,
    onFiles: (fs) => { setDropError(null); addFiles(fs); },
    onError: setDropError,
  });

  async function pickFiles() {
    const picked = await open({
      multiple: true,
      filters: [{ name: "Imagens", extensions: IMAGE_EXTS }],
    });
    if (!picked) return;
    const list = Array.isArray(picked) ? picked : [picked];
    addFiles(list.map((p) => ({ name: p.split(/[/\\]/).pop() ?? p, path: p, size: 0 })));
  }

  async function handleCompress() {
    if (files.length === 0 || busy) return;

    const outDir = await open({
      directory: true,
      title: "Escolher pasta para salvar as imagens comprimidas",
    });
    if (typeof outDir !== "string") return;

    setBusy(true);
    setError(null);
    setResults([]);
    try {
      const out = await compressImages({
        inputs: files.map((f) => f.path),
        outDir,
        format,
        mode,
        quality,
        targetKb: mode === "tamanho" ? targetKb : undefined,
      });
      setResults(out);
      addHistory({
        id: crypto.randomUUID(),
        tool: "image-compress",
        filename: `${files.length} imagem(ns) comprimida(s)`,
        inputPath: files[0].path,
        outputPath: out[0]?.output,
        durationMs: 0,
        timestamp: Date.now(),
        success: true,
      });
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  const totalBefore = results.reduce((s, r) => s + r.before, 0);
  const totalAfter = results.reduce((s, r) => s + r.after, 0);
  const toolRef = useToolEnter();

  return (
    <div ref={toolRef} className="space-y-4">
      <div
        role="button"
        tabIndex={0}
        aria-label="Arraste imagens aqui ou clique para selecionar"
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onClick={pickFiles}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") { e.preventDefault(); pickFiles(); }
        }}
        className={[
          "rounded-glass border-2 border-dashed flex flex-col items-center justify-center gap-2 cursor-pointer transition-all",
          files.length > 0 ? "p-5" : "p-10",
          isDragging
            ? "border-accent bg-accent/10"
            : "border-border-subtle hover:border-border hover:bg-overlay/[0.07]",
        ].join(" ")}
      >
        <Image
          strokeWidth={1.5}
          aria-hidden="true"
          className={[
            "transition-all",
            files.length > 0 ? "w-6 h-6" : "w-9 h-9",
            isDragging ? "text-accent animate-float" : "text-text-muted",
          ].join(" ")}
        />
        <p className="text-text-primary text-sm font-medium">
          {isDragging
            ? "Solte as imagens aqui"
            : files.length > 0
              ? "Adicionar mais imagens"
              : "Arraste imagens aqui"}
        </p>
        {files.length === 0 && (
          <p className="text-text-muted text-xs">ou clique para selecionar — múltiplas</p>
        )}
      </div>

      {dropError && <p role="alert" className="text-danger text-xs">{dropError}</p>}

      {files.length > 0 && (
        <ImagePreviewGrid
          files={files}
          onRemove={(p) => setFiles((prev) => prev.filter((f) => f.path !== p))}
          onClear={() => setFiles([])}
        />
      )}

      <div className="glass rounded-glass p-4 space-y-3">
        <SegmentedControl label="Modo" options={MODES} value={mode} onChange={setMode} />

        {mode === "qualidade" ? (
          <Slider
            inline
            size="sm"
            id="cmp-quality"
            label="Qualidade"
            min={1}
            max={100}
            value={quality}
            onChange={setQuality}
          />
        ) : (
          <Field
            label="Tamanho-alvo (KB)"
            htmlFor="cmp-target"
            description="Busca a maior qualidade que ainda cabe nesse limite."
          >
            <Input
              id="cmp-target"
              type="number"
              min={1}
              max={100000}
              value={targetKb}
              onChange={(e) => setTargetKb(Math.max(1, Number(e.target.value) || 1))}
            />
          </Field>
        )}

        <SegmentedControl
          label="Formato de saída"
          options={FORMATS}
          value={format}
          onChange={setFormat}
        />
      </div>

      {warnPng && (
        <div className="rounded-glass border border-warning/40 bg-warning/10 px-3 py-2 flex items-start justify-between gap-2">
          <p className="text-warning text-xs">
            PNG é sem perdas: comprimir mantendo o formato economiza pouco. Converter para WebP
            costuma economizar ~80%.
          </p>
          <Button variant="ghost" size="sm" className="shrink-0" onClick={() => setFormat("webp")}>
            Usar WebP
          </Button>
        </div>
      )}

      <Button
        variant="primary"
        className="w-full"
        onClick={handleCompress}
        disabled={files.length === 0}
        loading={busy}
      >
        {busy ? "Comprimindo…" : "Comprimir e salvar…"}
      </Button>

      {error && <p role="alert" className="text-danger text-xs">{error}</p>}

      {results.length > 0 && (
        <ResultPanel
          paths={results.map((r) => r.output)}
          label={`${formatBytes(totalBefore)} → ${formatBytes(totalAfter)} (${savedLabel(totalBefore, totalAfter)})`}
          hidePaths
        >
          <ul className="space-y-1 max-h-52 overflow-y-auto">
            {results.map((r) => (
              <li key={r.output}>
                <div className="flex items-center justify-between gap-2 text-[11px]">
                  <span className="text-text-secondary truncate" title={r.output}>
                    {r.output.split(/[/\\]/).pop()}
                  </span>
                  <span className="text-text-muted tabular-nums shrink-0">
                    {formatBytes(r.before)} → {formatBytes(r.after)}
                  </span>
                  <SavedBadge before={r.before} after={r.after} />
                </div>
                {!r.hitTarget && (
                  <p className="text-warning text-[10px]">
                    Não coube em {targetKb} KB nem na qualidade mínima.
                  </p>
                )}
              </li>
            ))}
          </ul>
        </ResultPanel>
      )}
    </div>
  );
}

function savedLabel(before: number, after: number): string {
  if (before <= 0) return "0%";
  return `−${Math.round(((before - after) / before) * 100)}%`;
}

function SavedBadge({ before, after }: { before: number; after: number }) {
  const pct = before > 0 ? ((before - after) / before) * 100 : 0;
  return (
    <span
      className={[
        "text-[11px] font-medium tabular-nums shrink-0 w-12 text-right",
        pct < 5 ? "text-warning" : "text-success",
      ].join(" ")}
    >
      {savedLabel(before, after)}
    </span>
  );
}
