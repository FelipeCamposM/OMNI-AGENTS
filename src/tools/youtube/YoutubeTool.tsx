import { useEffect, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { listen } from "@tauri-apps/api/event";
import { downloadYoutube, youtubeInfo } from "../../services/conversionService";
import type { YoutubeMode, YoutubeInfo } from "../../services/conversionService";
import type { ToolProps } from "../registry";
import { useToolEnter } from "../../lib/motion";
import { Button, Field, Input, ResultPanel, SegmentedControl, Select, Slider } from "../../components/ui";

const MODES: { value: YoutubeMode; label: string }[] = [
  { value: "audio", label: "Música (MP3)" },
  { value: "video", label: "Vídeo (MP4)" },
  { value: "playlist_audio", label: "Playlist → MP3" },
];

const DEFAULT_HEIGHTS = [2160, 1440, 1080, 720, 480, 360];

function formatDuration(secs: number): string {
  if (!secs) return "";
  const m = Math.floor(secs / 60);
  const s = Math.floor(secs % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

type TrackStatus = "pending" | "downloading" | "done" | "skipped";
interface PlaylistTrack {
  i: number;
  title: string;
  status: TrackStatus;
}
type YoutubeEvent =
  | { type: "tracks"; tracks: { i: number; title: string }[] }
  | { type: "track"; i: number; status: TrackStatus };

export function YoutubeTool({ settings, addHistory }: ToolProps) {
  const [url, setUrl] = useState("");
  const [mode, setMode] = useState<YoutubeMode>("audio");
  const [kbps, setKbps] = useState(settings.audioKbps);
  const [maxHeight, setMaxHeight] = useState(settings.videoMaxHeight); // 0 = melhor
  const [info, setInfo] = useState<YoutubeInfo | null>(null);
  const [searching, setSearching] = useState(false);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [outputs, setOutputs] = useState<string[]>([]);
  const [tracks, setTracks] = useState<PlaylistTrack[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const unlistenProgress = listen<number>("tool-progress", (e) => setProgress(e.payload));
    const unlistenEvent = listen<YoutubeEvent>("youtube-event", (e) => {
      const ev = e.payload;
      if (ev.type === "tracks") {
        setTracks(ev.tracks.map((t) => ({ ...t, status: "pending" as TrackStatus })));
      } else if (ev.type === "track") {
        setTracks((prev) =>
          prev.map((t) => (t.i === ev.i ? { ...t, status: ev.status } : t))
        );
      }
    });
    return () => {
      unlistenProgress.then((fn) => fn());
      unlistenEvent.then((fn) => fn());
    };
  }, []);

  const isAudio = mode === "audio" || mode === "playlist_audio";
  const heights = info?.heights?.length ? info.heights : DEFAULT_HEIGHTS;

  async function handleSearch() {
    if (!url.trim() || searching) return;
    setSearching(true);
    setError(null);
    setInfo(null);
    setOutputs([]);
    try {
      const result = await youtubeInfo(url.trim());
      if (result.success) {
        setInfo(result);
        if (result.isPlaylist) setMode("playlist_audio");
      } else {
        setError(result.message ?? "Vídeo indisponível.");
      }
    } catch {
      setError("Falha ao buscar o vídeo.");
    } finally {
      setSearching(false);
    }
  }

  async function handleDownload() {
    if (!url.trim() || busy) return;

    const outputDir = await open({ directory: true, title: "Escolher pasta de destino" });
    if (typeof outputDir !== "string") return;

    setBusy(true);
    setError(null);
    setOutputs([]);
    setTracks([]);
    setProgress(0);
    try {
      const result = await downloadYoutube(
        url.trim(),
        mode,
        outputDir,
        isAudio ? kbps : undefined,
        !isAudio && maxHeight ? maxHeight : undefined
      );
      addHistory({
        id: crypto.randomUUID(),
        tool: "youtube",
        filename: info?.title || url.trim(),
        inputPath: url.trim(),
        outputPath: result.outputs?.[0],
        durationMs: result.durationMs ?? 0,
        timestamp: Date.now(),
        success: result.success,
      });
      if (result.success) setOutputs(result.outputs ?? []);
      else setError(result.message ?? "Falha no download.");
    } catch {
      setError("Falha ao iniciar o download.");
    } finally {
      setBusy(false);
    }
  }

  const toolRef = useToolEnter();

  return (
    <div ref={toolRef} className="space-y-4">
      <div className="space-y-1.5">
        <label htmlFor="yt-url" className="text-text-secondary text-xs font-medium">
          URL do YouTube
        </label>
        <div className="flex gap-2">
          <Input
            id="yt-url"
            className="flex-1 min-w-0"
            type="text"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSearch()}
            placeholder="https://www.youtube.com/watch?v=…"
          />
          <Button onClick={handleSearch} disabled={!url.trim()} loading={searching}>
            {searching ? "Buscando…" : "Buscar"}
          </Button>
        </div>
      </div>

      {/* Preview */}
      {info && (
        <div className="flex gap-3 glass p-3">
          {info.thumbnail && (
            <img
              src={info.thumbnail}
              alt={info.title}
              className="w-32 h-20 object-cover rounded-lg bg-overlay/[0.06] shrink-0"
            />
          )}
          <div className="min-w-0 flex flex-col justify-center">
            {info.isPlaylist && (
              <span className="text-accent text-[10px] font-medium uppercase tracking-wider">Playlist</span>
            )}
            <p className="text-text-primary text-sm font-medium line-clamp-2">{info.title}</p>
            {info.uploader && <p className="text-text-muted text-xs">{info.uploader}</p>}
            {info.isPlaylist ? (
              <p className="text-text-muted text-xs">{info.trackCount ?? 0} músicas</p>
            ) : info.duration ? (
              <p className="text-text-muted text-xs">{formatDuration(info.duration)}</p>
            ) : null}
          </div>
        </div>
      )}

      <div className="glass rounded-glass p-4 space-y-3">
        <SegmentedControl options={MODES} value={mode} onChange={setMode} />

        {isAudio ? (
          <Slider
            inline
            size="sm"
            id="yt-kbps"
            label="Qualidade do áudio"
            unit=" kbps"
            min={64}
            max={320}
            step={32}
            value={kbps}
            onChange={setKbps}
          />
        ) : (
          <Field label="Qualidade do vídeo" htmlFor="yt-quality">
            <Select
              id="yt-quality"
              value={maxHeight}
              options={[
                { value: 0, label: "Melhor disponível" },
                ...heights.map((h) => ({ value: h, label: `${h}p` })),
              ]}
              onChange={setMaxHeight}
            />
          </Field>
        )}
      </div>

      <Button
        variant="primary"
        className="w-full"
        onClick={handleDownload}
        disabled={!url.trim()}
        loading={busy}
      >
        {busy ? "Baixando…" : "Baixar e salvar…"}
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
          <p className="text-text-muted text-[11px] text-center">
            {mode === "playlist_audio" && tracks.length > 0
              ? `${tracks.filter((t) => t.status === "done" || t.status === "skipped").length}/${tracks.length} da playlist · ${progress}%`
              : `${progress}%`}
          </p>
        </div>
      )}

      {/* Playlist: fila à esquerda, prontas à direita */}
      {mode === "playlist_audio" && tracks.length > 0 && (
        <div className="grid grid-cols-2 gap-3">
          <div className="glass p-3 space-y-1.5">
            <p className="text-text-secondary text-xs font-medium">
              Na fila ({tracks.filter((t) => t.status === "pending" || t.status === "downloading").length})
            </p>
            <ul className="space-y-1 max-h-56 overflow-y-auto">
              {tracks
                .filter((t) => t.status === "pending" || t.status === "downloading" || t.status === "skipped")
                .map((t) => (
                  <li key={t.i} className="flex items-center gap-1.5 text-[11px]">
                    <span
                      className={
                        t.status === "downloading"
                          ? "w-1.5 h-1.5 rounded-full bg-accent animate-pulse shrink-0"
                          : t.status === "skipped"
                          ? "w-1.5 h-1.5 rounded-full bg-danger shrink-0"
                          : "w-1.5 h-1.5 rounded-full bg-border shrink-0"
                      }
                    />
                    <span
                      className={[
                        "truncate",
                        t.status === "downloading" ? "text-text-primary" : "text-text-muted",
                        t.status === "skipped" ? "line-through text-danger" : "",
                      ].join(" ")}
                      title={t.title}
                    >
                      {t.title}
                    </span>
                  </li>
                ))}
            </ul>
          </div>

          <div className="rounded-xl border border-success/40 bg-success/10 p-3 space-y-1.5">
            <p className="text-success text-xs font-medium">
              Baixadas ({tracks.filter((t) => t.status === "done").length})
            </p>
            <ul className="space-y-1 max-h-56 overflow-y-auto">
              {tracks
                .filter((t) => t.status === "done")
                .map((t) => (
                  <li key={t.i} className="flex items-center gap-1.5 text-[11px] text-text-secondary">
                    <span className="text-success shrink-0">✓</span>
                    <span className="truncate" title={t.title}>{t.title}</span>
                  </li>
                ))}
            </ul>
          </div>
        </div>
      )}

      {/* Resumo de puladas ao terminar */}
      {!busy && mode === "playlist_audio" && tracks.some((t) => t.status === "skipped") && (
        <div className="rounded-lg border border-warning/40 bg-warning/10 px-3 py-2">
          <p className="text-warning text-xs font-medium">
            {tracks.filter((t) => t.status === "skipped").length} faixa(s) pulada(s) por erro:
          </p>
          <ul className="text-text-muted text-[11px] mt-1 space-y-0.5">
            {tracks.filter((t) => t.status === "skipped").map((t) => (
              <li key={t.i} className="truncate">• {t.title}</li>
            ))}
          </ul>
        </div>
      )}

      {error && <p role="alert" className="text-danger text-xs">{error}</p>}

      <ResultPanel paths={outputs} label={`${outputs.length} arquivo(s) baixado(s)`} />

      <p className="text-text-muted text-[11px]">
        Baixe apenas conteúdo que você tem direito de baixar.
      </p>
    </div>
  );
}
