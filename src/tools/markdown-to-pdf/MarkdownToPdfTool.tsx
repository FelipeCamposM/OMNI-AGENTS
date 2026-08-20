import { X } from "lucide-react";
import { useState } from "react";
import { save } from "@tauri-apps/plugin-dialog";
import { runTool, openFolder } from "../../services/conversionService";
import type { ToolProps } from "../registry";
import { useToolEnter } from "../../lib/motion";
import { Button, Field, FilePicker, ResultPanel, Textarea } from "../../components/ui";

interface Md2PdfResult {
  success: boolean;
  outputPath?: string;
  durationMs?: number;
  errorCode?: string;
  message?: string;
}

export function MarkdownToPdfTool({ settings, addHistory }: ToolProps) {
  const [text, setText] = useState("");
  const [sourcePath, setSourcePath] = useState<string | null>(null);
  const [sourceName, setSourceName] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [resultPath, setResultPath] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function clearFile() {
    setSourcePath(null);
    setSourceName(null);
  }

  const canConvert = !busy && (sourcePath !== null || text.trim().length > 0);

  async function handleConvert() {
    if (!canConvert) return;
    setError(null);
    setResultPath(null);

    const baseName = sourceName ? sourceName.replace(/\.(md|markdown|txt)$/i, "") : "documento";
    const savePath = await save({
      filters: [{ name: "PDF", extensions: ["pdf"] }],
      defaultPath: settings.defaultOutputDir
        ? `${settings.defaultOutputDir}\\${baseName}.pdf`
        : `${baseName}.pdf`,
    });
    if (!savePath) return;

    setBusy(true);
    try {
      const result = await runTool<Md2PdfResult>("md2pdf", {
        inputPath: sourcePath ?? "",
        markdown: sourcePath ? "" : text,
        outputPath: savePath,
      });

      addHistory({
        id: crypto.randomUUID(),
        tool: "markdown-to-pdf",
        filename: sourceName ?? `${baseName}.pdf`,
        inputPath: sourcePath ?? "(texto)",
        outputPath: result.success ? result.outputPath : undefined,
        durationMs: result.success ? result.durationMs ?? 0 : 0,
        timestamp: Date.now(),
        success: result.success,
      });

      if (result.success && result.outputPath) {
        setResultPath(result.outputPath);
        if (settings.openFolderAfterSave) await openFolder(result.outputPath);
      } else {
        setError(result.message ?? "Não foi possível gerar o PDF.");
      }
    } catch {
      setError("Falha ao iniciar o conversor.");
    } finally {
      setBusy(false);
    }
  }

  const toolRef = useToolEnter();

  return (
    <div ref={toolRef} className="space-y-4">
      <div className="flex items-center gap-2">
        <FilePicker
          size="sm"
          accept={["md", "markdown", "txt"]}
          filterName="Markdown"
          maxSizeMb={settings.maxFileSizeMb}
          onError={setError}
          onPick={([p]) => {
            setSourcePath(p);
            setSourceName(p.split(/[/\\]/).pop() ?? p);
            setText("");
            setResultPath(null);
            setError(null);
          }}
        >
          Escolher arquivo .md
        </FilePicker>
        {sourceName && (
          <span className="flex items-center gap-1 text-xs text-text-secondary">
            {sourceName}
            <Button variant="ghost" size="sm" aria-label="Remover arquivo" onClick={clearFile}>
              <X aria-hidden="true" className="w-3.5 h-3.5" />
            </Button>
          </span>
        )}
      </div>

      {!sourcePath && (
        <Field label="…ou cole o Markdown" htmlFor="md-input">
          <Textarea
            id="md-input"
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={10}
            placeholder="# Título&#10;&#10;Seu conteúdo em Markdown…"
          />
        </Field>
      )}

      <Button
        variant="primary"
        className="w-full"
        onClick={handleConvert}
        disabled={!canConvert}
        loading={busy}
      >
        {busy ? "Gerando PDF…" : "Gerar PDF"}
      </Button>

      {error && <p role="alert" className="text-danger text-xs">{error}</p>}

      {resultPath && (
        <ResultPanel paths={[resultPath]} />
      )}
    </div>
  );
}
