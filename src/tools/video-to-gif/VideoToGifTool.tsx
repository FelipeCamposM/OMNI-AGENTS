import { useEffect, useState } from "react";
import { save } from "@tauri-apps/plugin-dialog";
import { listen } from "@tauri-apps/api/event";
import { videoToGif } from "../../services/conversionService";
import type { ToolProps } from "../registry";
import { useToolEnter } from "../../lib/motion";
import { Button, FilePicker, Field, Input, ResultPanel, Slider } from "../../components/ui";

const VIDEO_EXTS = ["mp4", "mkv", "mov", "avi", "webm", "flv", "wmv", "m4v", "gif"];

export function VideoToGifTool({ settings, addHistory }: ToolProps) {
  const [input, setInput] = useState<string | null>(null);
  const [fps, setFps] = useState(settings.gifFps);
  const [width, setWidth] = useState(settings.gifWidth);
  const [start, setStart] = useState("");
  const [duration, setDuration] = useState("");
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

  async function handleConvert() {
    if (!input || busy) return;
    const base = name(input).replace(/\.[^.]+$/, "");
    const output = await save({ filters: [{ name: "GIF", extensions: ["gif"] }], defaultPath: `${base}.gif` });
    if (!output) return;

    setBusy(true);
    setError(null);
    setResult(null);
    setProgress(0);
    try {
      const path = await videoToGif(input, output, {
        fps,
        width,
        start: start ? Number(start) : undefined,
        duration: duration ? Number(duration) : undefined,
      });
      setResult(path);
      addHistory({
        id: crypto.randomUUID(),
        tool: "video-to-gif",
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

      <div className="glass rounded-glass p-4 space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <Slider size="sm" id="gif-fps" label="FPS" min={5} max={30} value={fps} onChange={setFps} />
          <Slider
            size="sm"
            id="gif-w"
            label="Largura"
            unit="px"
            min={120}
            max={1080}
            step={40}
            value={width}
            onChange={setWidth}
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Início (s) — opcional" htmlFor="gif-start">
            <Input
              id="gif-start"
              type="number"
              min={0}
              value={start}
              onChange={(e) => setStart(e.target.value)}
              placeholder="0"
            />
          </Field>
          <Field label="Duração (s) — opcional" htmlFor="gif-dur">
            <Input
              id="gif-dur"
              type="number"
              min={0}
              value={duration}
              onChange={(e) => setDuration(e.target.value)}
              placeholder="tudo"
            />
          </Field>
        </div>
      </div>

      <Button
        variant="primary"
        className="w-full"
        onClick={handleConvert}
        disabled={!input}
        loading={busy}
      >
        {busy ? "Gerando GIF…" : "Gerar GIF e salvar…"}
      </Button>

      {busy && (
        <div className="space-y-1">
          <div className="glass-inset h-2 rounded-full overflow-hidden">
            <div className="shimmer h-full bg-accent transition-all duration-300" style={{ width: `${progress}%` }} role="progressbar" aria-valuenow={progress} />
          </div>
          <p className="text-text-muted text-[11px] text-center">{progress}%</p>
        </div>
      )}

      {error && <p role="alert" className="text-danger text-xs">{error}</p>}

      {result && <ResultPanel paths={[result]} />}
    </div>
  );
}
