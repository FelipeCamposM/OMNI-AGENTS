import { useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { convertAudio } from "../../services/conversionService";
import type { ToolProps } from "../registry";
import { useToolEnter } from "../../lib/motion";
import { Button, FilePicker, ResultPanel, SegmentedControl, Slider } from "../../components/ui";

type Fmt = "mp3" | "wav" | "flac";
const FORMATS: Fmt[] = ["mp3", "wav", "flac"];
const AUDIO_EXTS = ["mp3", "wav", "flac", "m4a", "aac", "ogg", "opus", "wma", "mp4", "mkv"];

export function AudioConvertTool({ settings, addHistory }: ToolProps) {
  const [files, setFiles] = useState<string[]>([]);
  const [format, setFormat] = useState<Fmt>(settings.audioFormat);
  const [bitrate, setBitrate] = useState(settings.audioKbps);
  const [busy, setBusy] = useState(false);
  const [outputs, setOutputs] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  async function handleConvert() {
    if (files.length === 0 || busy) return;
    const outDir = await open({ directory: true, title: "Escolher pasta de saída" });
    if (typeof outDir !== "string") return;

    setBusy(true);
    setError(null);
    setOutputs([]);
    try {
      const result = await convertAudio(files, outDir, format, format === "mp3" ? bitrate : undefined);
      setOutputs(result);
      addHistory({
        id: crypto.randomUUID(),
        tool: "audio-convert",
        filename: `${files.length} áudio(s) → ${format.toUpperCase()}`,
        inputPath: files[0],
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
      <FilePicker
        multiple
        accept={AUDIO_EXTS}
        filterName="Áudio/Vídeo"
        maxSizeMb={settings.maxFileSizeMb}
        onError={setError}
        onPick={(p) => { setFiles(p); setOutputs([]); setError(null); }}
        className="w-full"
      >
        {files.length > 0 ? `${files.length} arquivo(s) selecionado(s)` : "Selecionar áudios"}
      </FilePicker>

      <div className="glass rounded-glass p-4 space-y-3">
        <SegmentedControl
          label="Formato de saída"
          options={FORMATS.map((f) => ({ value: f, label: f.toUpperCase() }))}
          value={format}
          onChange={setFormat}
        />

        {format === "mp3" && (
          <Slider
            inline
            size="sm"
            id="au-br"
            label="Bitrate"
            unit=" kbps"
            min={64}
            max={320}
            step={32}
            value={bitrate}
            onChange={setBitrate}
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
