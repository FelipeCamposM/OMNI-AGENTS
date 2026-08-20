import { useState } from "react";
import { hashFiles } from "../../services/conversionService";
import type { HashResult } from "../../services/conversionService";
import type { ToolProps } from "../registry";
import { useToolEnter } from "../../lib/motion";
import { Button, FilePicker, SegmentedControl } from "../../components/ui";

type Algo = "md5" | "sha1" | "sha256";
const ALGOS: Algo[] = ["md5", "sha1", "sha256"];

export function HashTool({ settings }: ToolProps) {
  const [files, setFiles] = useState<string[]>([]);
  const [algo, setAlgo] = useState<Algo>(settings.hashAlgo);
  const [results, setResults] = useState<HashResult[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleHash() {
    if (files.length === 0 || busy) return;
    setBusy(true);
    setError(null);
    try {
      setResults(await hashFiles(files, algo));
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  function name(path: string) {
    return path.split(/[/\\]/).pop() ?? path;
  }

  const toolRef = useToolEnter();

  return (
    <div ref={toolRef} className="space-y-4">
      <FilePicker
        multiple
        accept={["*"]}
        filterName="Todos os arquivos"
        onError={setError}
        onPick={(p) => { setFiles(p); setResults([]); setError(null); }}
        className="w-full"
      >
        {files.length > 0 ? `${files.length} arquivo(s) selecionado(s)` : "Selecionar arquivos"}
      </FilePicker>

      <SegmentedControl
        options={ALGOS.map((a) => ({ value: a, label: a.toUpperCase() }))}
        value={algo}
        onChange={setAlgo}
      />

      <Button
        variant="primary"
        className="w-full"
        onClick={handleHash}
        disabled={files.length === 0}
        loading={busy}
      >
        {busy ? "Calculando…" : "Calcular hash"}
      </Button>

      {error && <p role="alert" className="text-danger text-xs">{error}</p>}

      {results.length > 0 && (
        <ul className="space-y-2">
          {results.map((r) => (
            <li key={r.path} className="glass-inset p-3 space-y-1">
              <div className="flex items-center justify-between gap-2">
                <p className="text-text-primary text-xs font-medium truncate" title={r.path}>
                  {name(r.path)}
                </p>
                <Button
                  variant="ghost"
                  size="sm"
                  className="shrink-0"
                  onClick={() => navigator.clipboard.writeText(r.hash)}
                >
                  Copiar
                </Button>
              </div>
              <p className="text-text-muted text-[11px] font-mono break-all">{r.hash}</p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
