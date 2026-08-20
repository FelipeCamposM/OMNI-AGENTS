import { useEffect, useState } from "react";
import { save } from "@tauri-apps/plugin-dialog";
import { listen } from "@tauri-apps/api/event";
import { compressVideo } from "../../services/conversionService";
import type { ToolProps } from "../registry";
import { useToolEnter } from "../../lib/motion";
import { Button, FilePicker, ResultPanel, SegmentedControl } from "../../components/ui";

const VIDEO_EXTS = ["mp4", "mkv", "mov", "avi", "webm", "flv", "wmv", "m4v"];

const LEVELS: { label: string; crf: number; hint: string }[] = [
  { label: "Leve", crf: 23, hint: "melhor qualidade" },
  { label: "Médio", crf: 28, hint: "equilíbrio" },
  { label: "Forte", crf: 32, hint: "menor arquivo" },
];

export function VideoCompressTool({ settings, addHistory }: ToolProps) {
  const [input, setInput] = useState<string | null>(null);
  const [crf, setCrf] = useState(settings.videoCrf);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const unlisten = listen<number>("tool-progress", (e) => setProgress(e.payload));
    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);

  function name(p: string) {
    return p.split(/[/\\]/).pop() ?? p;
  }

  async function handleCompress() {
    if (!input || busy) return;

    const base = name(input).replace(/\.[^.]+$/, "");
    const output = await save({
      filters: [{ name: "MP4", extensions: ["mp4"] }],
      defaultPath: `${base}_comprimido.mp4`,
    });
    if (!output) return;

    setBusy(true);
    setError(null);
    setResult(null);
    setProgress(0);
    try {
      const path = await compressVideo(input, output, crf, "medium");
      setResult(path);
      addHistory({
        id: crypto.randomUUID(),
        tool: "video-compress",
        filename: name(input),
        inputPath: input,
        outputPath: path,
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
      <FilePicker
        accept={VIDEO_EXTS}
        filterName="Vídeos"
        maxSizeMb={settings.maxFileSizeMb}
        onError={setError}
        onPick={([p]) => { setInput(p); setResult(null); setError(null); }}
        className="w-full"
      >
        {input ? name(input) : "Selecionar vídeo"}
      </FilePicker>

      <div className="glass rounded-glass p-4">
        <SegmentedControl
          label="Nível de compressão"
          options={LEVELS.map((l) => ({ value: l.crf, label: l.label, title: l.hint }))}
          value={crf}
          onChange={setCrf}
          description={LEVELS.find((l) => l.crf === crf)?.hint}
        />
      </div>

      <Button
        variant="primary"
        className="w-full"
        onClick={handleCompress}
        disabled={!input}
        loading={busy}
      >
        {busy ? "Comprimindo…" : "Comprimir e salvar…"}
      </Button>

      {busy && (
        <div className="space-y-1">
          <div className="glass-inset h-2 rounded-full overflow-hidden">
            <div
              className="shimmer h-full bg-accent transition-all duration-300"
              style={{ width: `${progress}%` }}
              role="progressbar"
              aria-valuenow={progress}
            />
          </div>
          <p className="text-text-muted text-[11px] text-center">{progress}%</p>
        </div>
      )}

      {error && <p role="alert" className="text-danger text-xs">{error}</p>}

      {result && <ResultPanel paths={[result]} />}
    </div>
  );
}
