import { Image, ImageOff, X } from "lucide-react";
import { useRef, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { convertFileSrc } from "@tauri-apps/api/core";
import { convertImages } from "../../services/conversionService";
import type { ImageConvertArgs } from "../../services/conversionService";
import { useDragDrop } from "../../hooks/useDragDrop";
import type { SelectedFile } from "../../types/conversion";
import type { ToolProps } from "../registry";
import { animateOut, revealMedia, useToolEnter } from "../../lib/motion";
import { Button, ResultPanel, SegmentedControl, Slider } from "../../components/ui";

type Format = ImageConvertArgs["format"];

const FORMATS: { value: Format; label: string }[] = [
  { value: "webp", label: "WebP" },
  { value: "png", label: "PNG" },
  { value: "jpg", label: "JPG" },
  { value: "ico", label: "ICO" },
];

const IMAGE_EXTS = ["jpg", "jpeg", "png", "bmp", "gif", "webp", "tiff", "ico"];

export function ImageConvertTool({ settings, addHistory }: ToolProps) {
  const [files, setFiles] = useState<SelectedFile[]>([]);
  const [format, setFormat] = useState<Format>(settings.imageFormat);
  const [quality, setQuality] = useState(settings.imageQuality);
  const [busy, setBusy] = useState(false);
  const [outputs, setOutputs] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [dropError, setDropError] = useState<string | null>(null);

  const usesQuality = format === "webp" || format === "jpg";

  function addFiles(incoming: SelectedFile[]) {
    setOutputs([]);
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
    addFiles(
      list.map((p) => ({ name: p.split(/[/\\]/).pop() ?? p, path: p, size: 0 }))
    );
  }

  function removeFile(path: string) {
    setFiles((prev) => prev.filter((f) => f.path !== path));
  }

  async function handleConvert() {
    if (files.length === 0 || busy) return;

    const outDir = await open({
      directory: true,
      title: "Escolher pasta para salvar as imagens",
    });
    if (typeof outDir !== "string") return;

    setBusy(true);
    setError(null);
    setOutputs([]);
    try {
      const result = await convertImages({
        inputs: files.map((f) => f.path),
        format,
        outDir,
        quality: usesQuality ? quality : undefined,
      });
      setOutputs(result);
      addHistory({
        id: crypto.randomUUID(),
        tool: "image-convert",
        filename: `${files.length} imagem(ns) → ${format.toUpperCase()}`,
        inputPath: files[0].path,
        outputPath: result[0],
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

  const toolRef = useToolEnter();

  return (
    <div ref={toolRef} className="space-y-4">
      {/* Drop zone — encolhe quando já há arquivos: a atenção vai p/ as miniaturas. */}
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
        <ImgIcon dragging={isDragging} small={files.length > 0} />
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
        <ImagePreviewGrid files={files} onRemove={removeFile} onClear={() => setFiles([])} />
      )}

      {/* Opções — única superfície com backdrop-filter da tela. */}
      <div className="glass rounded-glass p-4 space-y-3">
        <SegmentedControl
          label="Formato de saída"
          options={FORMATS}
          value={format}
          onChange={setFormat}
        />
        {usesQuality && (
          <Slider
            inline
            size="sm"
            id="img-quality"
            label="Qualidade"
            min={1}
            max={100}
            value={quality}
            onChange={setQuality}
          />
        )}
      </div>

      <Button
        variant="primary"
        className="w-full"
        onClick={handleConvert}
        disabled={files.length === 0}
        loading={busy}
      >
        {busy ? "Convertendo…" : "Converter e salvar…"}
      </Button>

      {error && <p role="alert" className="text-danger text-xs">{error}</p>}

      <ResultPanel paths={outputs} />
    </div>
  );
}

/**
 * Grade de miniaturas. `object-contain` + xadrez em vez de `object-cover`:
 * num conversor o que se quer conferir é a imagem inteira, não um recorte.
 * Não mostra tamanho — SelectedFile.size vem 0 quando o arquivo veio do
 * diálogo (só o drag&drop preenche), e "0 KB" é pior que nada.
 */
export function ImagePreviewGrid({
  files,
  onRemove,
  onClear,
}: {
  files: SelectedFile[];
  onRemove: (path: string) => void;
  onClear: () => void;
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <p className="text-text-secondary text-xs font-medium">{files.length} imagem(ns)</p>
        <Button variant="ghost" size="sm" onClick={onClear}>
          Limpar
        </Button>
      </div>
      {/* Sem stagger na grade de propósito: ele re-dispara a cada remoção e a
          grade inteira pisca. Cada miniatura entra sozinha no `onLoad` da
          imagem (revealMedia) — a cascata sai de graça do tempo de decode. */}
      <ul className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        {files.map((f) => (
          <PreviewTile key={f.path} file={f} onRemove={() => onRemove(f.path)} />
        ))}
      </ul>
    </div>
  );
}

function PreviewTile({ file, onRemove }: { file: SelectedFile; onRemove: () => void }) {
  // .tiff e .ico estão em IMAGE_EXTS mas o WebView nem sempre decodifica.
  const [broken, setBroken] = useState(false);
  const tileRef = useRef<HTMLLIElement>(null);

  return (
    <li
      ref={tileRef}
      className="group relative glass-inset glass-hover overflow-hidden transition-shadow hover:shadow-glass"
    >
      <div className="checker aspect-square flex items-center justify-center">
        {broken ? (
          <ImageOff aria-hidden="true" className="w-7 h-7 text-text-muted" />
        ) : (
          <img
            src={convertFileSrc(file.path)}
            alt={file.name}
            loading="lazy"
            onLoad={(e) => revealMedia(e.currentTarget)}
            onError={() => setBroken(true)}
            className="w-full h-full object-contain transition-transform duration-300 group-hover:scale-[1.04]"
          />
        )}
      </div>
      <p className="text-text-muted text-[11px] px-2 py-1.5 truncate" title={file.name}>
        {file.name}
      </p>

      {/* O wrapper carrega a entrada do botão. Se as classes de transform
          fossem no próprio .btn, as utilities do Tailwind sobrescreveriam o
          transform da base e matariam a levitação/press dele. */}
      <span className="absolute top-1.5 right-1.5 opacity-0 scale-75 transition-all duration-200 group-hover:opacity-100 group-hover:scale-100 group-focus-within:opacity-100 group-focus-within:scale-100">
        <Button
          variant="ghost"
          size="sm"
          aria-label={`Remover ${file.name}`}
          onClick={() => animateOut(tileRef.current, onRemove)}
          className="group/x !p-1.5 !rounded-full bg-black/55 !text-white hover:!bg-danger hover:!text-white"
        >
          <X
            aria-hidden="true"
            className="w-3.5 h-3.5 transition-transform duration-200 group-hover/x:rotate-90"
          />
        </Button>
      </span>
    </li>
  );
}

function ImgIcon({ dragging, small }: { dragging: boolean; small?: boolean }) {
  return (
    <Image
      strokeWidth={1.5}
      aria-hidden="true"
      className={[
        "transition-all",
        small ? "w-6 h-6" : "w-9 h-9",
        dragging ? "text-accent animate-float" : "text-text-muted",
      ].join(" ")}
    />
  );
}
