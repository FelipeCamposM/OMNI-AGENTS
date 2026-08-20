import { useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { resizeImages } from "../../services/conversionService";
import type { ResizeArgs } from "../../services/conversionService";
import type { ToolProps } from "../registry";
import { useToolEnter } from "../../lib/motion";
import { Button, FilePicker, Field, Input, ResultPanel, SegmentedControl, Slider } from "../../components/ui";

type Mode = "dimensao" | "escala";
type Fmt = "manter" | "webp" | "png" | "jpg";

const IMAGE_EXTS = ["jpg", "jpeg", "png", "bmp", "gif", "webp", "tiff"];

const MODES: { value: Mode; label: string }[] = [
  { value: "dimensao", label: "Dimensão máx." },
  { value: "escala", label: "Escala %" },
];

const FORMATS: { value: Fmt; label: string }[] = [
  { value: "manter", label: "Manter" },
  { value: "webp", label: "WEBP" },
  { value: "png", label: "PNG" },
  { value: "jpg", label: "JPG" },
];

export function ImageResizeTool({ settings }: ToolProps) {
  const [files, setFiles] = useState<string[]>([]);
  const [mode, setMode] = useState<Mode>("dimensao");
  const [maxDim, setMaxDim] = useState(settings.resizeMaxDim);
  const [scale, setScale] = useState(50);
  const [fmt, setFmt] = useState<Fmt>(settings.resizeFormat);
  const [quality, setQuality] = useState(settings.imageQuality);
  const [prefix, setPrefix] = useState("");
  const [busy, setBusy] = useState(false);
  const [outputs, setOutputs] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  const usesQuality = fmt === "webp" || fmt === "jpg";

  async function handleRun() {
    if (files.length === 0 || busy) return;
    const outDir = await open({ directory: true, title: "Escolher pasta de saída" });
    if (typeof outDir !== "string") return;

    setBusy(true);
    setError(null);
    setOutputs([]);
    try {
      const args: ResizeArgs = {
        inputs: files,
        outDir,
        quality: usesQuality ? quality : undefined,
        format: fmt === "manter" ? undefined : fmt,
        renamePrefix: prefix.trim() || undefined,
      };
      if (mode === "dimensao") args.maxWidth = args.maxHeight = maxDim;
      else args.scalePct = scale;

      setOutputs(await resizeImages(args));
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  const toolRef = useToolEnter();

  return (
    <div ref={toolRef} className="space-y-4">
      <FilePicker
        multiple
        accept={IMAGE_EXTS}
        filterName="Imagens"
        maxSizeMb={settings.maxFileSizeMb}
        onError={setError}
        onPick={(p) => { setFiles(p); setOutputs([]); setError(null); }}
        className="w-full"
      >
        {files.length > 0 ? `${files.length} imagem(ns) selecionada(s)` : "Selecionar imagens"}
      </FilePicker>

      <div className="glass rounded-glass p-4 space-y-3">
        <SegmentedControl options={MODES} value={mode} onChange={setMode} />

        {mode === "dimensao" ? (
          <Slider
            inline
            size="sm"
            id="max-dim"
            label="Máx. largura/altura"
            unit="px"
            min={64}
            max={4096}
            step={64}
            value={maxDim}
            onChange={setMaxDim}
            description="Mantém a proporção original."
          />
        ) : (
          <Slider
            inline
            size="sm"
            id="scale"
            label="Escala"
            unit="%"
            min={1}
            max={100}
            value={scale}
            onChange={setScale}
          />
        )}

        <SegmentedControl label="Formato de saída" options={FORMATS} value={fmt} onChange={setFmt} />

        {usesQuality && (
          <Slider
            inline
            size="sm"
            id="rq"
            label="Qualidade"
            min={1}
            max={100}
            value={quality}
            onChange={setQuality}
          />
        )}

        <Field label="Renomear em lote (opcional)" htmlFor="prefix">
          <Input
            id="prefix"
            type="text"
            value={prefix}
            onChange={(e) => setPrefix(e.target.value)}
            placeholder="ex.: foto → foto_1, foto_2…"
          />
        </Field>
      </div>

      <Button
        variant="primary"
        className="w-full"
        onClick={handleRun}
        disabled={files.length === 0}
        loading={busy}
      >
        {busy ? "Processando…" : "Redimensionar e salvar…"}
      </Button>

      {error && <p role="alert" className="text-danger text-xs">{error}</p>}

      <ResultPanel paths={outputs} />
    </div>
  );
}
