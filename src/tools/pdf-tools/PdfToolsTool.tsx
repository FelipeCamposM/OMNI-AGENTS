import { GripVertical, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { open, save } from "@tauri-apps/plugin-dialog";
import { runTool } from "../../services/conversionService";
import { DropZone } from "../../components/DropZone";
import { PdfViewer } from "../../components/PdfViewer";
import {
  formatSelection,
  parseRanges,
  parseSelection,
  togglePage,
} from "../../lib/pageRanges";
import { useEnter, useShake } from "../../lib/motion";
import { Button, Field, Input, ResultPanel, SegmentedControl, Slider } from "../../components/ui";
import type { ToolProps } from "../registry";
import type { SelectedFile } from "../../types/conversion";

type Mode = "merge" | "split" | "compress";
/** Sub-modos de "Dividir". */
type SplitMode = "selecionar" | "intervalos" | "cada-n" | "editar";

interface ToolResult {
  success: boolean;
  outputPath?: string;
  outputs?: string[];
  errorCode?: string;
  message?: string;
  durationMs?: number;
}

const MODES: { value: Mode; label: string }[] = [
  { value: "merge", label: "Juntar" },
  { value: "split", label: "Dividir" },
  { value: "compress", label: "Comprimir" },
];

const SPLIT_MODES: { value: SplitMode; label: string; help: string }[] = [
  {
    value: "selecionar",
    label: "Selecionar páginas",
    help: "Marque as páginas que ficam. Sai um único PDF, na ordem original.",
  },
  {
    value: "intervalos",
    label: "Intervalos",
    help: "Um PDF por intervalo. Marque nas miniaturas ou escreva no campo.",
  },
  {
    value: "cada-n",
    label: "A cada N páginas",
    help: "Fatia o PDF em blocos de tamanho fixo.",
  },
  {
    value: "editar",
    label: "Remover e reordenar",
    help: "Arraste para reordenar e remova as marcadas. Sai um único PDF.",
  },
];

function baseName(p: string) {
  return p.split(/[/\\]/).pop() ?? p;
}

function stem(p: string) {
  return baseName(p).replace(/\.pdf$/i, "");
}

export function PdfToolsTool({ settings, addHistory }: ToolProps) {
  const [mode, setMode] = useState<Mode>("merge");
  const [splitMode, setSplitMode] = useState<SplitMode>("selecionar");
  const [files, setFiles] = useState<string[]>([]);
  const [every, setEvery] = useState(1);
  const [busy, setBusy] = useState(false);
  const [outputs, setOutputs] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  // Seleção de páginas: o texto é a fonte da verdade, as miniaturas o
  // reescrevem quando clicadas. Assim os dois lados ficam sincronizados sem
  // um segundo estado pra desincronizar.
  const [rangeText, setRangeText] = useState("");
  const [pageCount, setPageCount] = useState(0);
  const [order, setOrder] = useState<number[]>([]);

  const single = mode === "split";
  const activePdf = single && files.length > 0 ? files[0] : null;
  const showViewer = single && splitMode !== "cada-n" && !!activePdf;

  const selected = useMemo(
    () => parseSelection(rangeText, pageCount || undefined),
    [rangeText, pageCount]
  );

  const rootRef = useEnter<HTMLDivElement>();
  const errorRef = useShake<HTMLParagraphElement>(error);

  // Trocar de PDF zera a seleção; trocar de modo não mexe nos arquivos.
  useEffect(() => {
    setRangeText("");
    setOrder([]);
    setPageCount(0);
  }, [activePdf]);

  const handlePageCount = useCallback((n: number) => {
    setPageCount(n);
    setOrder((prev) =>
      prev.length === n ? prev : Array.from({ length: n }, (_, i) => i + 1)
    );
  }, []);

  function switchMode(m: Mode) {
    setMode(m);
    setOutputs([]);
    setError(null);
  }

  function addFiles(picked: SelectedFile[]) {
    setError(null);
    setOutputs([]);
    const paths = picked.map((f) => f.path);
    setFiles((prev) => (single ? paths.slice(0, 1) : [...prev, ...paths.filter((p) => !prev.includes(p))]));
  }

  function removeFile(path: string) {
    setFiles((prev) => prev.filter((p) => p !== path));
  }

  function moveFile(from: number, to: number) {
    setFiles((prev) => {
      const next = [...prev];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      return next;
    });
  }

  function togglePageSelection(page: number) {
    setRangeText(formatSelection(togglePage(selected, page)));
  }

  /** Páginas que sobram no modo "remover e reordenar". */
  const kept = useMemo(() => order.filter((p) => !selected.has(p)), [order, selected]);

  const canRun = (() => {
    if (busy) return false;
    if (mode === "merge") return files.length >= 2;
    if (mode === "compress") return files.length >= 1;
    if (files.length !== 1) return false;
    if (splitMode === "selecionar") return selected.size > 0;
    if (splitMode === "intervalos") return parseRanges(rangeText, pageCount || undefined).length > 0;
    if (splitMode === "editar") return kept.length > 0 && pageCount > 0;
    return true; // cada-n
  })();

  function record(inputPath: string, result: ToolResult, outs: string[]) {
    addHistory({
      id: crypto.randomUUID(),
      tool: "pdf-tools",
      filename: baseName(inputPath),
      inputPath,
      outputPath: outs[0],
      durationMs: result.durationMs ?? 0,
      timestamp: Date.now(),
      success: !!result.success,
    });
  }

  async function askOutputDir() {
    if (settings.defaultOutputDir) return settings.defaultOutputDir;
    const dir = await open({ directory: true, title: "Escolher pasta de saída" });
    return typeof dir === "string" ? dir : null;
  }

  async function handleRun() {
    if (!canRun) return;
    setError(null);
    setOutputs([]);

    try {
      let result: ToolResult;
      const input = files[0];

      if (mode === "merge") {
        const outputPath = await save({
          filters: [{ name: "PDF", extensions: ["pdf"] }],
          defaultPath: "juntado.pdf",
        });
        if (!outputPath) return;
        setBusy(true);
        result = await runTool<ToolResult>("pdf_merge", { inputs: files, outputPath });
      } else if (mode === "compress") {
        const outputDir = await askOutputDir();
        if (!outputDir) return;
        setBusy(true);
        result = await runTool<ToolResult>("pdf_compress", { inputs: files, outputDir });
      } else if (splitMode === "selecionar" || splitMode === "editar") {
        const pages =
          splitMode === "selecionar"
            ? [...selected].sort((a, b) => a - b)
            : kept;
        const sufixo = splitMode === "selecionar" ? "_paginas" : "_editado";
        const outputPath = await save({
          filters: [{ name: "PDF", extensions: ["pdf"] }],
          defaultPath: `${stem(input)}${sufixo}.pdf`,
        });
        if (!outputPath) return;
        setBusy(true);
        result = await runTool<ToolResult>("pdf_pages", { inputPath: input, outputPath, pages });
      } else {
        const outputDir = await askOutputDir();
        if (!outputDir) return;
        setBusy(true);
        result = await runTool<ToolResult>("pdf_split", {
          inputPath: input,
          outputDir,
          every,
          ranges:
            splitMode === "intervalos"
              ? parseRanges(rangeText, pageCount || undefined)
              : undefined,
        });
      }

      const outs = result.outputs ?? (result.outputPath ? [result.outputPath] : []);
      if (result.success) {
        setOutputs(outs);
        record(mode === "merge" ? files[0] : input ?? files[0], result, outs);
      } else {
        setError(result.message ?? "Falha na operação.");
      }
    } catch {
      setError("Falha ao iniciar o conversor.");
    } finally {
      setBusy(false);
    }
  }

  const splitHelp = SPLIT_MODES.find((s) => s.value === splitMode)?.help;

  return (
    <div ref={rootRef} className="space-y-4">
      {/* Modo principal */}
      <SegmentedControl size="md" options={MODES} value={mode} onChange={switchMode} />

      <DropZone
        onFiles={addFiles}
        multiple={!single}
        compact={files.length > 0}
        maxSizeMb={settings.maxFileSizeMb}
        label={
          files.length > 0
            ? single ? "Trocar de PDF" : "Adicionar mais PDFs"
            : undefined
        }
      />

      {/* Lista de arquivos — no "Juntar" ela é a ordem do resultado. */}
      {files.length > 0 && (
        <ul className="space-y-1">
          {files.map((f, i) => (
            <li
              key={f}
              draggable={mode === "merge"}
              onDragStart={(e) => e.dataTransfer.setData("text/plain", String(i))}
              onDragOver={(e) => mode === "merge" && e.preventDefault()}
              onDrop={(e) => {
                if (mode !== "merge") return;
                e.preventDefault();
                const from = Number(e.dataTransfer.getData("text/plain"));
                if (Number.isFinite(from) && from !== i) moveFile(from, i);
              }}
              className={[
                "glass glass-hover flex items-center gap-2 px-3 py-2 text-xs",
                mode === "merge" ? "cursor-grab active:cursor-grabbing" : "",
              ].join(" ")}
            >
              {mode === "merge" && (
                <>
                  <GripVertical className="w-3.5 h-3.5 text-text-muted shrink-0" aria-hidden="true" />
                  <span className="text-text-muted tabular-nums shrink-0">{i + 1}.</span>
                </>
              )}
              <span className="truncate text-text-secondary flex-1">{baseName(f)}</span>
              <Button
                variant="ghost"
                size="sm"
                aria-label={`Remover ${baseName(f)}`}
                onClick={() => removeFile(f)}
                className="shrink-0 !p-1 hover:!text-danger"
              >
                <X className="w-3.5 h-3.5" aria-hidden="true" />
              </Button>
            </li>
          ))}
        </ul>
      )}

      {mode === "merge" && files.length > 1 && (
        <p className="text-text-muted text-[11px] px-1">
          Arraste os arquivos para definir a ordem do PDF final.
        </p>
      )}

      {/* Controles de divisão */}
      {single && files.length > 0 && (
        <div className="space-y-3">
          <SegmentedControl
            grow={false}
            options={SPLIT_MODES}
            value={splitMode}
            onChange={(v) => {
              setSplitMode(v);
              setOutputs([]);
              setError(null);
            }}
          />

          {splitHelp && <p className="text-text-muted text-[11px] px-1">{splitHelp}</p>}

          {splitMode === "cada-n" ? (
            <div className="glass rounded-glass p-4">
              <Slider
                inline
                size="sm"
                id="split-every"
                label="Páginas por arquivo"
                min={1}
                max={20}
                value={every}
                onChange={setEvery}
              />
            </div>
          ) : (
            <Field
              label={splitMode === "editar" ? "Páginas a remover" : "Páginas"}
              htmlFor="range-text"
            >
              <Input
                id="range-text"
                value={rangeText}
                onChange={(e) => setRangeText(e.target.value)}
                placeholder="ex.: 1-3, 7, 10-12"
              />
            </Field>
          )}
        </div>
      )}

      {/* Visualizador */}
      {showViewer && (
        <PdfViewer
          path={activePdf}
          order={splitMode === "editar" ? order : undefined}
          selected={selected}
          onToggle={togglePageSelection}
          onReorder={splitMode === "editar" ? setOrder : undefined}
          onPageCount={handlePageCount}
          hint={
            splitMode === "editar"
              ? `${kept.length} ficam, ${selected.size} saem`
              : `${selected.size} selecionada(s)`
          }
          actions={
            <>
              <MiniButton
                onClick={() =>
                  setRangeText(
                    formatSelection(Array.from({ length: pageCount }, (_, i) => i + 1))
                  )
                }
              >
                Tudo
              </MiniButton>
              <MiniButton
                onClick={() =>
                  setRangeText(
                    formatSelection(
                      Array.from({ length: pageCount }, (_, i) => i + 1).filter(
                        (p) => !selected.has(p)
                      )
                    )
                  )
                }
              >
                Inverter
              </MiniButton>
              <MiniButton onClick={() => setRangeText("")}>Limpar</MiniButton>
              {splitMode === "editar" && (
                <MiniButton
                  onClick={() =>
                    setOrder(Array.from({ length: pageCount }, (_, i) => i + 1))
                  }
                >
                  Ordem original
                </MiniButton>
              )}
            </>
          }
        />
      )}

      <Button variant="primary" className="w-full" onClick={handleRun} disabled={!canRun}>
        {busy ? "Processando…" : `${MODES.find((m) => m.value === mode)?.label} e salvar…`}
      </Button>

      {error && (
        <p ref={errorRef} role="alert" className="text-danger text-xs">
          {error}
        </p>
      )}

      <ResultPanel paths={outputs} />
    </div>
  );
}

function MiniButton({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <Button size="sm" onClick={onClick} className="!px-2 !py-1 !text-[11px]">
      {children}
    </Button>
  );
}
