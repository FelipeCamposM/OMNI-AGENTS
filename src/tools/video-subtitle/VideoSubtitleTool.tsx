import { useRef, useState } from "react";
import { save } from "@tauri-apps/plugin-dialog";
import { transcribe, writeSubtitles } from "../../services/conversionService";
import type {
  SubtitleFormat,
  SubtitleSegment,
  SubtitleRhythm,
  WhisperModelSize,
} from "../../services/conversionService";
import type { ToolProps } from "../registry";
import { useToolEnter } from "../../lib/motion";
import { useToolProgress } from "../../hooks/useToolProgress";
import {
  Button,
  FilePicker,
  ResultPanel,
  SegmentedControl,
} from "../../components/ui";
import { CamposTranscricao } from "../../components/CamposTranscricao";
import { ProgressoTranscricao } from "../../components/ProgressoTranscricao";
import { MediaPreview } from "../../components/MediaPreview";
import { SubtitleEditor } from "../../components/SubtitleEditor";

const MIDIA_EXTS = [
  "mp4", "mkv", "mov", "avi", "webm", "flv", "wmv", "m4v",
  "mp3", "wav", "m4a", "flac", "ogg", "aac",
];

const FORMATOS: { value: SubtitleFormat; label: string }[] = [
  { value: "srt", label: "SRT" },
  { value: "vtt", label: "VTT" },
];

function nome(p: string) {
  return p.split(/[/\\]/).pop() ?? p;
}

/**
 * Transcreve áudio/vídeo em arquivo de legenda (.srt/.vtt).
 *
 * Gravar a legenda dentro do vídeo é outra ferramenta (`video-burn`): a saída é
 * outra, os controles são outros, e juntar as duas numa tela só deixava metade
 * dos campos sem valer para o que estava selecionado.
 */
export function VideoSubtitleTool({ settings, addHistory }: ToolProps) {
  const [input, setInput] = useState<string | null>(null);
  const [idioma, setIdioma] = useState("pt");
  const [modelo, setModelo] = useState<WhisperModelSize>(settings.whisperModel);
  const [ritmo, setRitmo] = useState<SubtitleRhythm>(settings.subtitleRhythm);
  const [formato, setFormato] = useState<SubtitleFormat>(settings.subtitleFormat);
  const [busy, setBusy] = useState(false);
  const [resultado, setResultado] = useState<string | null>(null);
  const [blocos, setBlocos] = useState(0);
  const [erro, setErro] = useState<string | null>(null);
  /** Blocos transcritos aguardando revisão. Vazio = nada a revisar ainda. */
  const [segmentos, setSegmentos] = useState<SubtitleSegment[]>([]);
  const [duracao, setDuracao] = useState<number | null>(null);
  const midia = useRef<HTMLVideoElement | HTMLAudioElement | null>(null);

  const { progresso, etapa, zerar } = useToolProgress();

  /**
   * Transcreve para a memória, sem escolher destino ainda.
   *
   * O diálogo de salvar mudou de lugar de propósito: pedir o caminho antes de
   * existir texto obrigava a decidir onde guardar algo que ainda pode estar
   * errado. Agora transcreve, revisa, e só então grava.
   */
  async function transcrever() {
    if (!input || busy) return;

    setBusy(true);
    setErro(null);
    setResultado(null);
    setSegmentos([]);
    zerar();
    try {
      const r = await transcribe({
        inputPath: input,
        // O Python exige um destino; este é descartado. O arquivo que conta é
        // o do `gravar()`, depois da revisão.
        outputPath: `${input}.rascunho.srt`,
        language: idioma || undefined,
        model: modelo,
        format: "srt",
        rhythm: ritmo,
      });
      if (!r.success) {
        setErro(r.message ?? "Falha ao transcrever.");
        return;
      }
      setSegmentos(r.segments ?? []);
      setBlocos(r.segments?.length ?? 0);
    } catch {
      setErro("Falha ao iniciar a transcrição.");
    } finally {
      setBusy(false);
    }
  }

  async function gravar() {
    if (!input || segmentos.length === 0 || busy) return;
    const base = nome(input).replace(/\.[^.]+$/, "");
    const destino = await save({
      filters: [{ name: formato.toUpperCase(), extensions: [formato] }],
      defaultPath: settings.defaultOutputDir
        ? `${settings.defaultOutputDir}\\${base}.${formato}`
        : `${base}.${formato}`,
    });
    if (!destino) return;

    setBusy(true);
    setErro(null);
    try {
      const r = await writeSubtitles({
        segments: segmentos,
        outputPath: destino,
        format: formato,
      });
      if (!r.success) {
        setErro(r.message ?? "Falha ao gravar a legenda.");
        return;
      }
      setResultado(r.outputPath ?? destino);
      addHistory({
        id: crypto.randomUUID(),
        tool: "video-subtitle",
        filename: nome(input),
        inputPath: input,
        outputPath: r.outputPath,
        durationMs: r.durationMs ?? 0,
        timestamp: Date.now(),
        success: true,
      });
    } catch {
      setErro("Falha ao gravar a legenda.");
    } finally {
      setBusy(false);
    }
  }

  /** Leva o vídeo até o bloco e toca — é assim que se confere sincronia. */
  function ouvir(segundos: number) {
    const el = midia.current;
    if (!el) return;
    el.currentTime = segundos;
    void el.play().catch(() => undefined);
  }

  const toolRef = useToolEnter();

  return (
    <div ref={toolRef} className="space-y-4">
      <FilePicker
        accept={MIDIA_EXTS}
        filterName="Vídeo ou áudio"
        maxSizeMb={settings.maxFileSizeMb}
        onError={setErro}
        onPick={([p]) => { setInput(p); setResultado(null); setErro(null); }}
        size="md"
        className="w-full"
      >
        {input ? `Trocar arquivo — ${nome(input)}` : "Escolher vídeo ou áudio"}
      </FilePicker>

      {input && (
        <MediaPreview
          path={input}
          onClear={() => { setInput(null); setResultado(null); setErro(null); setSegmentos([]); }}
          onDuration={setDuracao}
          onMedia={(el) => { midia.current = el; }}
        />
      )}

      <div className="glass rounded-glass p-4 space-y-3">
        <CamposTranscricao
          prefixo="leg"
          idioma={idioma}
          setIdioma={setIdioma}
          modelo={modelo}
          setModelo={setModelo}
          ritmo={ritmo}
          setRitmo={setRitmo}
        />
        <SegmentedControl label="Formato" options={FORMATOS} value={formato} onChange={setFormato} />
      </div>

      <Button
        variant={segmentos.length ? "glass" : "primary"}
        className="w-full"
        onClick={transcrever}
        disabled={!input}
        loading={busy && segmentos.length === 0}
      >
        {busy && segmentos.length === 0
          ? "Transcrevendo…"
          : segmentos.length
            ? "Transcrever de novo"
            : "Transcrever"}
      </Button>

      {busy && (
        <ProgressoTranscricao
          progresso={progresso}
          etapa={etapa}
          aviso="A transcrição roda no processador e costuma levar tempo parecido com a duração do arquivo."
        />
      )}

      {erro && <p role="alert" className="text-danger text-xs">{erro}</p>}

      {segmentos.length > 0 && (
        <>
          <SubtitleEditor
            segments={segmentos}
            onChange={setSegmentos}
            onSeek={ouvir}
            duracao={duracao}
          />
          <Button
            variant="primary"
            className="w-full"
            onClick={gravar}
            loading={busy}
          >
            {busy ? "Gravando…" : `Salvar ${formato.toUpperCase()}…`}
          </Button>
        </>
      )}

      {resultado && (
        <ResultPanel paths={[resultado]} label={`Legenda pronta — ${blocos} bloco(s)`} />
      )}

      <p className="text-text-muted text-[11px]">
        Tudo roda no seu computador. Nome próprio, sigla e número costumam sair errados — revise
        antes de publicar. Para gravar a legenda dentro do vídeo, use <b>Legendar vídeo</b>.
      </p>
    </div>
  );
}
