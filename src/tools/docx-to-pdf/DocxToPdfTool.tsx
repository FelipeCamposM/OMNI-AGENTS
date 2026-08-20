import { useState } from "react";
import { save } from "@tauri-apps/plugin-dialog";
import { runTool, openFolder } from "../../services/conversionService";
import type { ToolProps } from "../registry";
import { useToolEnter } from "../../lib/motion";
import { Button, FilePicker, ResultPanel } from "../../components/ui";

interface Docx2PdfResult {
  success: boolean;
  outputPath?: string;
  durationMs?: number;
  errorCode?: string;
  message?: string;
}

function baseName(p: string) {
  return p.split(/[/\\]/).pop() ?? p;
}

export function DocxToPdfTool({ settings, addHistory }: ToolProps) {
  const [sourcePath, setSourcePath] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [resultPath, setResultPath] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleConvert() {
    if (!sourcePath || busy) return;

    const stem = baseName(sourcePath).replace(/\.docx$/i, "");
    const savePath = await save({
      filters: [{ name: "PDF", extensions: ["pdf"] }],
      defaultPath: settings.defaultOutputDir
        ? `${settings.defaultOutputDir}\\${stem}.pdf`
        : `${stem}.pdf`,
    });
    if (!savePath) return;

    setBusy(true);
    setError(null);
    setResultPath(null);
    try {
      const result = await runTool<Docx2PdfResult>("docx2pdf", {
        inputPath: sourcePath,
        outputPath: savePath,
      });

      addHistory({
        id: crypto.randomUUID(),
        tool: "docx-to-pdf",
        filename: baseName(sourcePath),
        inputPath: sourcePath,
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
      <FilePicker
        accept={["docx"]}
        filterName="Word"
        maxSizeMb={settings.maxFileSizeMb}
        onError={setError}
        onPick={([p]) => { setSourcePath(p); setResultPath(null); setError(null); }}
        className="w-full"
      >
        {sourcePath ? baseName(sourcePath) : "Selecionar arquivo .docx"}
      </FilePicker>

      {/* O usuário precisa saber disso ANTES de converter, não depois de
          comparar com o Word. */}
      <div className="glass rounded-glass p-4 space-y-1">
        <p className="text-text-secondary text-xs font-medium">Como a conversão funciona</p>
        <p className="text-text-muted text-[11px]">
          O conteúdo é convertido localmente, sem Word nem LibreOffice instalados. Títulos, listas,
          tabelas e formatação de texto são preservados — mas a diagramação exata do Word (fontes,
          margens, cabeçalhos e quebras de página) não é reproduzida. Só o formato .docx é
          suportado; o .doc antigo não.
        </p>
      </div>

      <Button
        variant="primary"
        className="w-full"
        onClick={handleConvert}
        disabled={!sourcePath}
        loading={busy}
      >
        {busy ? "Gerando PDF…" : "Gerar PDF e salvar…"}
      </Button>

      {error && <p role="alert" className="text-danger text-xs">{error}</p>}

      {resultPath && <ResultPanel paths={[resultPath]} />}
    </div>
  );
}
