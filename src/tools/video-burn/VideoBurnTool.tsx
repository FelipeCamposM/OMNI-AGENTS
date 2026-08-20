import { useEffect, useMemo, useRef, useState } from "react";
import { save } from "@tauri-apps/plugin-dialog";
import {
  burnSubtitles,
  nomeDoEncoder,
  readSubtitles,
  systemFonts,
  transcribe,
  videoEncoder,
  writeSubtitles,
  SUBTITLE_POSITIONS,
  SUBTITLE_STYLES,
  SUBTITLE_STYLE_COLORS,
  DISTANCIA_MINIMA_COR,
  distanciaCor,
} from "../../services/conversionService";
import type {
  SubtitleColors,
  SubtitleSegment,
  SubtitlePosition,
  SubtitleRhythm,
  SubtitleStyle,
  WhisperModelSize,
} from "../../services/conversionService";
import {
  Button,
  ColorPicker,
  Field,
  FilePicker,
  ResultPanel,
  SegmentedControl,
  Select,
  Slider,
} from "../../components/ui";
import { SubtitlePreview } from "../../components/SubtitlePreview";
import { SubtitleEditor } from "../../components/SubtitleEditor";
import { useToolEnter } from "../../lib/motion";
import { useToolProgress } from "../../hooks/useToolProgress";
import { useModule } from "../../components/ModuleGate";
import type { ToolProps } from "../registry";
import { FONTES_EMPACOTADAS, FONTES_WINDOWS } from "../../lib/subtitleFonts";
import { CamposTranscricao } from "../../components/CamposTranscricao";
import { ProgressoTranscricao } from "../../components/ProgressoTranscricao";

/** Presets que desenham caixa em vez de contorno — o rótulo do seletor muda. */
const GEOMETRIA_COM_CAIXA = new Set<SubtitleStyle>(["youtube"]);

const MIDIA_EXTS = ["mp4", "mkv", "mov", "avi", "webm", "flv", "wmv", "m4v"];
const LEGENDA_EXTS = ["srt", "vtt", "ass"];
const FRASE_EXEMPLO = "Assim vai ficar a legenda no vídeo";

function nome(p: string) {
  return p.split(/[/\\]/).pop() ?? p;
}

/**
 * Grava a legenda dentro do vídeo: transcreve na hora ou usa um arquivo pronto,
 * aplica estilo e mostra a prévia antes de codificar.
 *
 * Separada de "Legenda automática" porque a saída é outra (um .mp4, não um
 * .srt) e os controles são outros — fonte, tamanho e posição não fazem sentido
 * nenhum para quem só quer o arquivo de legenda.
 */
export function VideoBurnTool({ settings, addHistory }: ToolProps) {
  const [input, setInput] = useState<string | null>(null);
  const { progresso, etapa, zerar: zerarProgresso } = useToolProgress();
  // A tool é gateada em ffmpeg (sempre necessário). O Whisper só entra no
  // caminho de transcrever, então o aviso é local em vez de bloquear a tela.
  const whisper = useModule("whisper");
  /** De onde vem a legenda: transcrever agora ou usar um arquivo pronto. */
  const [origem, setOrigem] = useState<"transcrever" | "arquivo">("transcrever");
  const [legendaPronta, setLegendaPronta] = useState<string | null>(null);

  const [idioma, setIdioma] = useState("pt");
  const [modelo, setModelo] = useState<WhisperModelSize>(settings.whisperModel);
  const [ritmo, setRitmo] = useState<SubtitleRhythm>(settings.subtitleRhythm);

  const [preset, setPreset] = useState<SubtitleStyle>("classico");
  const [cores, setCores] = useState<SubtitleColors>(SUBTITLE_STYLE_COLORS.classico);

  /**
   * Trocar o estilo recarrega as cores dele.
   *
   * Sem isto, escolher "Neon" depois de ter mexido nas cores não mudaria nada
   * visível — o preset só define cor, e as escolhidas continuariam mandando.
   * Quem quiser voltar a uma cor específica usa o "padrão" de cada seletor.
   */
  function trocarPreset(novo: SubtitleStyle) {
    setPreset(novo);
    setCores(SUBTITLE_STYLE_COLORS[novo]);
  }

  function mudarCor(campo: keyof SubtitleColors, valor: string) {
    setCores((c) => ({ ...c, [campo]: valor }));
  }
  const [fonte, setFonte] = useState(settings.subtitleFont);
  const [tamanho, setTamanho] = useState(settings.subtitleSize);
  const [posicao, setPosicao] = useState<SubtitlePosition>(settings.subtitlePosition);
  const [margemV, setMargemV] = useState(settings.subtitleMarginV);
  const [karaoke, setKaraoke] = useState(settings.subtitleKaraoke);
  const [gravacao, setGravacao] = useState<"imagem" | "faixa">("imagem");

  const [fontesDoSistema, setFontesDoSistema] = useState<string[]>([]);
  const [encoder, setEncoder] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [resultado, setResultado] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  /** Blocos aguardando revisão. Vazio = ainda não há o que revisar. */
  const [segmentos, setSegmentos] = useState<SubtitleSegment[]>([]);
  const midia = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    videoEncoder().then(setEncoder).catch(() => setEncoder(null));
    systemFonts().then(setFontesDoSistema).catch(() => setFontesDoSistema([]));
  }, []);

  // Karaokê precisa do tempo por palavra, que só a transcrição produz. Um .srt
  // importado não carrega isso — desligar aqui evita gerar um .ass em que o
  // destaque não anda e o usuário acha que é bug.
  const podeKaraoke = origem === "transcrever";
  const karaokeAtivo = karaoke && podeKaraoke;

  const opcoesFonte = useMemo(() => {
    const doSistema = fontesDoSistema.length
      ? fontesDoSistema.map((f) => ({ value: f, label: f, hint: "Do sistema" }))
      : FONTES_WINDOWS.map((f) => ({ value: f.familia, label: f.rotulo, hint: "Do sistema" }));
    return [
      ...FONTES_EMPACOTADAS.map((f) => ({
        value: f.familia,
        label: f.rotulo,
        hint: f.nota ? `${f.nota} · sempre igual` : "Empacotada",
      })),
      ...doSistema,
    ];
  }, [fontesDoSistema]);

  const estiloPreview = { fonte, tamanho, posicao, margemV, preset, cores };

  /**
   * Assim que existe transcrição, a prévia mostra a **primeira frase real** em
   * vez da de exemplo. É o que revela cedo que a fonte não cabe, que o texto
   * estourou duas linhas ou que a acentuação some naquela fonte.
   */
  const primeiraFrase = segmentos[0]?.text.replace(/\n/g, " ") || FRASE_EXEMPLO;

  // A mesma regra travada por teste no Python: abaixo disto a palavra acesa
  // some dentro do próprio contorno. Avisa em vez de bloquear — pode ser
  // intencional em algum vídeo.
  const destaqueSumido =
    karaokeAtivo && distanciaCor(cores.destaque, cores.contorno) < DISTANCIA_MINIMA_COR;
  const textoSumido = distanciaCor(cores.cor, cores.contorno) < 60;
  const pronto =
    !!input &&
    (origem === "transcrever" ? whisper.pronto !== false : !!legendaPronta);

  /**
   * Traz a legenda para a memória, sem gravar nada — é o passo que habilita a
   * revisão. Transcreve ou lê o arquivo pronto, conforme a origem.
   *
   * Separado de `gerar()` de propósito: corrigir um erro de grafia depois de
   * queimar significa recodificar o vídeo inteiro de novo.
   */
  async function revisar() {
    if (!input || busy || !pronto) return;

    setBusy(true);
    setErro(null);
    setResultado(null);
    setSegmentos([]);
    zerarProgresso();
    try {
      const r =
        origem === "transcrever"
          ? await transcribe({
              inputPath: input,
              // Descartado: o .ass que vale é gerado depois da revisão.
              outputPath: `${input}.rascunho.srt`,
              language: idioma || undefined,
              model: modelo,
              format: "srt",
              rhythm: ritmo,
            })
          : await readSubtitles(legendaPronta!);

      if (!r.success) {
        setErro(r.message ?? "Não foi possível obter a legenda.");
        return;
      }
      setSegmentos(r.segments ?? []);
    } catch (e) {
      setErro(String(e));
    } finally {
      setBusy(false);
    }
  }

  /** Leva o vídeo ao instante do bloco — é assim que se confere sincronia. */
  function ouvir(segundos: number) {
    const el = midia.current;
    if (!el) return;
    el.currentTime = segundos;
    void el.play().catch(() => undefined);
  }

  async function gerar() {
    if (!input || busy || !pronto) return;

    const base = nome(input).replace(/\.[^.]+$/, "");
    const destino = await save({
      filters: [{ name: "MP4", extensions: ["mp4"] }],
      defaultPath: settings.defaultOutputDir
        ? `${settings.defaultOutputDir}\\${base}-legendado.mp4`
        : `${base}-legendado.mp4`,
    });
    if (!destino) return;

    setBusy(true);
    setErro(null);
    setResultado(null);
    zerarProgresso();

    // O .ass fica ao lado do vídeo: é ele que carrega o estilo.
    const ass = destino.replace(/\.[^.]+$/, ".ass");

    try {
      // O .ass sai dos blocos REVISADOS, não de uma nova transcrição: refazer
      // aqui jogaria fora cada correção de grafia feita no editor.
      const r = await writeSubtitles({
        segments: segmentos,
        outputPath: ass,
        format: "ass",
        style: preset,
        font: fonte,
        size: tamanho,
        alignment: posicao,
        marginV: margemV,
        karaoke: karaokeAtivo,
        color: cores.cor,
        outlineColor: cores.contorno,
        highlightColor: cores.destaque,
        boxColor: cores.caixa,
      });
      if (!r.success) {
        setErro(r.message ?? "Não foi possível gerar a legenda.");
        return;
      }

      zerarProgresso();
      const final = await burnSubtitles({
        input,
        subtitles: ass,
        output: destino,
        burn: gravacao === "imagem",
      });

      setResultado(final);
      addHistory({
        id: crypto.randomUUID(),
        tool: "video-burn",
        filename: nome(input),
        inputPath: input,
        outputPath: final,
        durationMs: 0,
        timestamp: Date.now(),
        success: true,
      });
    } catch (e) {
      setErro(String(e));
    } finally {
      setBusy(false);
    }
  }

  const toolRef = useToolEnter();

  return (
    <div ref={toolRef} className="space-y-4">
      <FilePicker
        accept={MIDIA_EXTS}
        filterName="Vídeo"
        maxSizeMb={settings.maxFileSizeMb}
        onError={setErro}
        onPick={([p]) => { setInput(p); setResultado(null); setErro(null); setSegmentos([]); }}
        size="md"
        className="w-full"
      >
        {input ? `Trocar vídeo — ${nome(input)}` : "Escolher vídeo"}
      </FilePicker>

      {/* Duas colunas a partir de lg: a prévia gruda no topo e continua à vista
          enquanto se mexe nos controles e no texto — mudar cor, fonte ou uma
          palavra sem ver o efeito é o que fazia refazer a queima várias vezes.
          Abaixo de lg vira coluna única, e a prévia volta a rolar junto. */}
      <div className="grid gap-4 items-start lg:grid-cols-[minmax(0,1fr)_minmax(0,26rem)]">
        <div className="space-y-3 lg:sticky lg:top-4">
          {input ? (
            <SubtitlePreview
              path={input}
              texto={primeiraFrase}
              estilo={estiloPreview}
              onMargemChange={setMargemV}
              onMedia={(el) => { midia.current = el; }}
            />
          ) : (
            <div className="glass rounded-glass p-8 text-center">
              <p className="text-text-muted text-xs">
                Escolha um vídeo para ver a prévia da legenda.
              </p>
            </div>
          )}

          <Button
            variant="primary"
            className="w-full"
            onClick={segmentos.length ? gerar : revisar}
            disabled={!pronto}
            loading={busy}
          >
            {busy
              ? "Processando…"
              : segmentos.length
                ? "Gerar vídeo legendado…"
                : origem === "transcrever"
                  ? "Transcrever para revisar"
                  : "Carregar legenda para revisar"}
          </Button>

          {busy && (
            <ProgressoTranscricao
              progresso={progresso}
              etapa={etapa}
              aviso="Transcrever e recodificar levam tempo parecido com a duração do vídeo."
            />
          )}

          {erro && <p role="alert" className="text-danger text-xs">{erro}</p>}

          {resultado && <ResultPanel paths={[resultado]} label="Vídeo legendado" />}

          <p className="text-text-muted text-[11px]">
            A prévia é uma aproximação: o vídeo final é desenhado pelo ffmpeg, então pode haver
            pequena diferença no contorno e no espaçamento das letras.
          </p>
        </div>

        <div className="space-y-4 min-w-0">
      <SegmentedControl
        label="De onde vem a legenda"
        options={[
          { value: "transcrever" as const, label: "Transcrever o áudio" },
          { value: "arquivo" as const, label: "Usar arquivo pronto" },
        ]}
        value={origem}
        onChange={(v) => { setOrigem(v); setSegmentos([]); }}
      />

      {origem === "transcrever" && whisper.pronto === false && (
        <div className="rounded-glass border border-warning/40 bg-warning/10 px-3 py-2 flex items-start justify-between gap-2">
          <p className="text-warning text-xs">
            Transcrever exige o módulo de transcrição (~90 MB), ainda não instalado. Para gravar uma
            legenda que você já tem, escolha <b>Usar arquivo pronto</b>.
          </p>
          <Button
            variant="ghost"
            size="sm"
            className="shrink-0"
            loading={whisper.baixando}
            onClick={whisper.baixar}
          >
            Baixar
          </Button>
        </div>
      )}

      {origem === "arquivo" && (
        <FilePicker
          accept={LEGENDA_EXTS}
          filterName="Legenda"
          onError={setErro}
          onPick={([p]) => { setLegendaPronta(p); setErro(null); setSegmentos([]); }}
          className="w-full"
        >
          {legendaPronta ? nome(legendaPronta) : "Escolher .srt, .vtt ou .ass"}
        </FilePicker>
      )}

      <div className="glass rounded-glass p-4 space-y-3">
        {origem === "transcrever" && (
          <CamposTranscricao
            prefixo="vid"
            idioma={idioma}
            setIdioma={setIdioma}
            modelo={modelo}
            setModelo={setModelo}
            ritmo={ritmo}
            setRitmo={setRitmo}
          />
        )}

        <Field
          label="Estilo"
          htmlFor="vid-preset"
          description={SUBTITLE_STYLES.find((e) => e.value === preset)?.descricao}
        >
          <Select
            id="vid-preset"
            value={preset}
            options={SUBTITLE_STYLES.map((e) => ({ value: e.value, label: e.label }))}
            onChange={(v) => trocarPreset(v as SubtitleStyle)}
          />
        </Field>

        <Field label="Cor do texto" htmlFor="cor-texto">
          <ColorPicker
            id="cor-texto"
            value={cores.cor}
            onChange={(v) => mudarCor("cor", v)}
            onReset={() => mudarCor("cor", SUBTITLE_STYLE_COLORS[preset].cor)}
          />
        </Field>

        <Field
          label={GEOMETRIA_COM_CAIXA.has(preset) ? "Cor da caixa" : "Cor do contorno"}
          htmlFor="cor-contorno"
          description={
            GEOMETRIA_COM_CAIXA.has(preset)
              ? "A caixa fica semitransparente — a cor escolhida vale para o fundo dela."
              : undefined
          }
        >
          <ColorPicker
            id="cor-contorno"
            value={GEOMETRIA_COM_CAIXA.has(preset) ? cores.caixa : cores.contorno}
            onChange={(v) => mudarCor(GEOMETRIA_COM_CAIXA.has(preset) ? "caixa" : "contorno", v)}
            onReset={() =>
              GEOMETRIA_COM_CAIXA.has(preset)
                ? mudarCor("caixa", SUBTITLE_STYLE_COLORS[preset].caixa)
                : mudarCor("contorno", SUBTITLE_STYLE_COLORS[preset].contorno)
            }
          />
        </Field>

        {textoSumido && (
          <p className="text-warning text-[11px]">
            O texto e o contorno estão quase da mesma cor — a legenda pode ficar ilegível.
          </p>
        )}

        {podeKaraoke && (
          <Field
            label="Cor da palavra acesa"
            htmlFor="cor-destaque"
            description="Usada só quando a palavra destacada está ligada."
          >
            <ColorPicker
              id="cor-destaque"
              value={cores.destaque}
              disabled={!karaokeAtivo}
              onChange={(v) => mudarCor("destaque", v)}
              onReset={() => mudarCor("destaque", SUBTITLE_STYLE_COLORS[preset].destaque)}
            />
          </Field>
        )}

        {destaqueSumido && (
          <p className="text-warning text-[11px]">
            A palavra acesa está quase da cor do contorno — ela vai sumir dentro dele. Foi
            exatamente isso que deixava o roxo ilegível no estilo Karaokê.
          </p>
        )}

        <Field
          label="Fonte"
          htmlFor="vid-fonte"
          description="As empacotadas saem iguais em qualquer computador; as do sistema dependem do que estiver instalado."
        >
          <Select
            searchable
            searchPlaceholder="Pesquisar fonte…"
            id="vid-fonte"
            value={fonte}
            options={opcoesFonte}
            onChange={setFonte}
          />
        </Field>

        <Slider
          inline
          size="sm"
          id="vid-tamanho"
          label="Tamanho"
          min={24}
          max={140}
          value={tamanho}
          onChange={setTamanho}
          description="Medido numa tela de 1080 de altura — o vídeo é reescalado, então vale para qualquer resolução."
        />

        <SegmentedControl
          label="Posição"
          options={SUBTITLE_POSITIONS}
          value={posicao}
          onChange={setPosicao}
        />

        <Slider
          inline
          size="sm"
          id="vid-margem"
          label="Distância da borda"
          min={0}
          max={400}
          step={10}
          value={margemV}
          onChange={setMargemV}
          description="Dá para arrastar a legenda direto na prévia."
        />

        <SegmentedControl
          label="Palavra destacada"
          options={[
            { value: "sim" as const, label: "Acender palavra" },
            { value: "nao" as const, label: "Bloco inteiro" },
          ]}
          value={karaokeAtivo ? "sim" : "nao"}
          onChange={(v) => setKaraoke(v === "sim")}
          description={
            podeKaraoke
              ? "Acende cada palavra no momento em que é dita."
              : "Indisponível com arquivo pronto: o .srt não guarda o tempo de cada palavra."
          }
        />

        <SegmentedControl
          label="Como gravar"
          options={[
            { value: "imagem" as const, label: "Gravada na imagem" },
            { value: "faixa" as const, label: "Faixa que dá para desligar" },
          ]}
          value={gravacao}
          onChange={setGravacao}
        />

        {gravacao === "imagem" && encoder && (
          <p className="text-text-muted text-[11px]">
            Codificando com {nomeDoEncoder(encoder)}
            {encoder === "libx264"
              ? " — nenhuma placa compatível encontrada."
              : " — mais rápido que usar o processador."}
          </p>
        )}
        <p className="text-text-muted text-[11px]">
          {gravacao === "imagem"
            ? "A legenda vira parte da imagem — funciona em qualquer lugar, inclusive Instagram e TikTok. Recodifica o vídeo, então demora."
            : "Instantâneo, e dá para desligar a legenda no player. Mas redes sociais ignoram: o vídeo sai sem legenda nenhuma."}
        </p>
      </div>

          <SubtitleEditor
            segments={segmentos}
            onChange={setSegmentos}
            onSeek={ouvir}
          />
        </div>
      </div>
    </div>
  );
}
