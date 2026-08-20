import { Image as ImageIcon, RotateCcw } from "lucide-react";
import { useState } from "react";
import { open, save } from "@tauri-apps/plugin-dialog";
import { convertFileSrc } from "@tauri-apps/api/core";
import { depthAdjust, depthMap } from "../../services/conversionService";
import type { DepthMapResult } from "../../services/conversionService";
import { useDragDrop } from "../../hooks/useDragDrop";
import type { ToolProps } from "../registry";
import { revealMedia, useToolEnter } from "../../lib/motion";
import { useToolProgress } from "../../hooks/useToolProgress";
import { ProgressoTranscricao } from "../../components/ProgressoTranscricao";
import { Button, ResultPanel, SegmentedControl, Slider } from "../../components/ui";

const IMAGE_EXTS = ["png", "jpg", "jpeg", "webp"];

const CONTRASTE_PADRAO = 100;

const SENTIDOS = [
  { value: "normal", label: "Normal" },
  { value: "invertida", label: "Invertida" },
] as const;

type Sentido = (typeof SENTIDOS)[number]["value"];

function nome(p: string) {
  return p.split(/[/\\]/).pop() ?? p;
}

/**
 * Filtro CSS da prévia — espelho exato de `converter.py::_lut_ajuste`.
 *
 * Exportado só para poder ser travado em teste: se a ordem virar
 * `contrast() invert()`, a prévia passa a mostrar uma imagem que o arquivo
 * salvo não reproduz, e nada quebra visivelmente até alguém comparar os dois.
 */
export function filtroPreview(inverter: boolean, contrastePct: number): string {
  return [
    inverter ? "invert(1)" : "",
    contrastePct !== CONTRASTE_PADRAO ? `contrast(${contrastePct / 100})` : "",
  ].filter(Boolean).join(" ");
}

/** Rascunho gerado + o instante em que saiu, para furar o cache do WebView. */
interface Mapa {
  path: string;
  stamp: number;
  provider?: string;
  durationMs?: number;
}

/**
 * Mapa de profundidade monocular (Depth Anything V2, ONNX Runtime).
 *
 * Fluxo em duas etapas, pelo mesmo motivo do editor de legendas: a inferência é
 * a parte cara, e inverter ou mexer no contraste não pode custar outra. O
 * Python gera **uma vez** um PNG de rascunho em temp; inverter e contraste são
 * só um `filter` de CSS na prévia, aplicados de verdade aos pixels apenas na
 * hora de salvar (`depth_adjust`, que roda no sidecar light e nem conhece o
 * modelo).
 *
 * A prévia usa a MESMA fórmula que o Python (`(v − 0,5)·k + 0,5` em sRGB), então
 * o arquivo salvo sai idêntico ao que foi visto na tela.
 */
export function DepthMapTool({ settings, addHistory }: ToolProps) {
  const [input, setInput] = useState<string | null>(null);
  const [mapa, setMapa] = useState<Mapa | null>(null);
  const [sentido, setSentido] = useState<Sentido>("normal");
  const [contraste, setContraste] = useState(CONTRASTE_PADRAO);
  const [busy, setBusy] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [resultado, setResultado] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [dropError, setDropError] = useState<string | null>(null);

  const { progresso, etapa, zerar } = useToolProgress();

  function escolher(caminho: string) {
    setInput(caminho);
    // Trocar a imagem invalida o mapa: manter o antigo na tela ao lado de uma
    // original nova é a forma mais fácil de salvar o arquivo errado.
    setMapa(null);
    setResultado(null);
    setErro(null);
  }

  const { isDragging, handleDragOver, handleDragLeave, handleDrop } = useDragDrop({
    accept: IMAGE_EXTS,
    maxSizeMb: settings.maxFileSizeMb,
    onFiles: (fs) => { setDropError(null); if (fs[0]) escolher(fs[0].path); },
    onError: setDropError,
  });

  async function pickFile() {
    const picked = await open({
      multiple: false,
      filters: [{ name: "Imagens", extensions: IMAGE_EXTS }],
    });
    if (typeof picked === "string") escolher(picked);
  }

  async function gerar() {
    if (!input || busy) return;
    setBusy(true);
    setErro(null);
    setResultado(null);
    zerar();
    try {
      const r: DepthMapResult = await depthMap(input);
      if (!r.success || !r.outputPath) {
        setErro(r.message ?? "Falha ao gerar o mapa de profundidade.");
        return;
      }
      setMapa({
        path: r.outputPath,
        stamp: Date.now(),
        provider: r.provider,
        durationMs: r.durationMs,
      });
    } catch {
      setErro("Falha ao iniciar a geração do mapa de profundidade.");
    } finally {
      setBusy(false);
    }
  }

  async function salvar() {
    if (!input || !mapa || salvando) return;
    const base = nome(input).replace(/\.[^.]+$/, "");
    const destino = await save({
      filters: [{ name: "PNG", extensions: ["png"] }],
      defaultPath: settings.defaultOutputDir
        ? `${settings.defaultOutputDir}\\${base}-depth.png`
        : `${base}-depth.png`,
    });
    if (!destino) return;

    setSalvando(true);
    setErro(null);
    try {
      const r = await depthAdjust({
        inputPath: mapa.path,
        outputPath: destino,
        invert: sentido === "invertida",
        contrast: contraste / 100,
      });
      if (!r.success || !r.outputPath) {
        setErro(r.message ?? "Falha ao salvar o PNG.");
        return;
      }
      setResultado(r.outputPath);
      addHistory({
        id: crypto.randomUUID(),
        tool: "depth-map",
        filename: nome(input),
        inputPath: input,
        outputPath: r.outputPath,
        durationMs: mapa.durationMs ?? 0,
        timestamp: Date.now(),
        success: true,
      });
    } catch {
      setErro("Falha ao salvar o PNG.");
    } finally {
      setSalvando(false);
    }
  }

  const filtro = filtroPreview(sentido === "invertida", contraste);
  const mexeu = sentido !== "normal" || contraste !== CONTRASTE_PADRAO;
  const toolRef = useToolEnter();

  return (
    <div ref={toolRef} className="space-y-4">
      <div
        role="button"
        tabIndex={0}
        aria-label="Arraste uma imagem aqui ou clique para selecionar"
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onClick={pickFile}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") { e.preventDefault(); void pickFile(); }
        }}
        className={[
          "rounded-glass border-2 border-dashed flex flex-col items-center justify-center gap-2 cursor-pointer transition-all",
          input ? "p-5" : "p-10",
          isDragging
            ? "border-accent bg-accent/10"
            : "border-border-subtle hover:border-border hover:bg-overlay/[0.07]",
        ].join(" ")}
      >
        <ImageIcon
          strokeWidth={1.5}
          aria-hidden="true"
          className={[
            "transition-all",
            input ? "w-6 h-6" : "w-9 h-9",
            isDragging ? "text-accent animate-float" : "text-text-muted",
          ].join(" ")}
        />
        <p className="text-text-primary text-sm font-medium">
          {isDragging
            ? "Solte a imagem aqui"
            : input
              ? `Trocar imagem — ${nome(input)}`
              : "Arraste uma imagem aqui"}
        </p>
        {!input && (
          <p className="text-text-muted text-xs">
            ou clique para selecionar — PNG, JPG ou WebP
          </p>
        )}
      </div>

      {dropError && <p role="alert" className="text-danger text-xs">{dropError}</p>}

      {input && (
        <div className="grid gap-3 sm:grid-cols-2">
          <Painel titulo="Original">
            <img
              src={convertFileSrc(input)}
              alt={`Original — ${nome(input)}`}
              onLoad={(e) => revealMedia(e.currentTarget)}
              className="w-full h-full object-contain"
            />
          </Painel>

          <Painel titulo="Mapa de profundidade" escuro>
            {mapa ? (
              <img
                /* `?t=` fura o cache: o rascunho reusa o mesmo caminho a cada
                   geração, e sem isto o WebView mostraria o mapa anterior. */
                src={`${convertFileSrc(mapa.path)}?t=${mapa.stamp}`}
                alt="Mapa de profundidade"
                onLoad={(e) => revealMedia(e.currentTarget)}
                style={{ filter: filtro || undefined }}
                className="w-full h-full object-contain"
              />
            ) : (
              <p className="text-text-muted text-[11px] px-3 text-center">
                {busy ? "Estimando…" : "Ainda não gerado"}
              </p>
            )}
          </Painel>
        </div>
      )}

      {mapa && (
        <div className="glass rounded-glass p-4 space-y-3">
          <SegmentedControl
            label="Profundidade"
            options={SENTIDOS as unknown as { value: Sentido; label: string }[]}
            value={sentido}
            onChange={setSentido}
          />
          <Slider
            inline
            size="sm"
            id="depth-contraste"
            label="Contraste"
            unit="%"
            min={50}
            max={250}
            step={5}
            value={contraste}
            onChange={setContraste}
          />
          {mexeu && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => { setSentido("normal"); setContraste(CONTRASTE_PADRAO); }}
            >
              <RotateCcw aria-hidden="true" className="w-3.5 h-3.5" />
              Restaurar valores
            </Button>
          )}
          <p className="text-text-muted text-[11px]">
            Ajustes são aplicados ao mapa já pronto — não recarregam o modelo nem refazem a
            estimativa.
          </p>
        </div>
      )}

      <Button
        variant={mapa ? "glass" : "primary"}
        className="w-full"
        onClick={gerar}
        disabled={!input || salvando}
        loading={busy}
      >
        {busy ? "Gerando…" : mapa ? "Gerar de novo" : "Gerar Depth Map"}
      </Button>

      {busy && (
        <ProgressoTranscricao
          progresso={progresso}
          etapa={etapa}
          aviso="Na primeira vez o modelo (~94 MB) é baixado; depois fica em cache no disco."
        />
      )}

      {mapa && (
        <Button variant="primary" className="w-full" onClick={salvar} loading={salvando}>
          {salvando ? "Salvando…" : "Salvar PNG…"}
        </Button>
      )}

      {erro && <p role="alert" className="text-danger text-xs">{erro}</p>}

      {resultado && <ResultPanel paths={[resultado]} label="Depth map salvo" />}

      <p className="text-text-muted text-[11px]">
        A estimativa roda no seu computador — nenhuma imagem sai daqui.
        {mapa?.provider === "CPUExecutionProvider" && " Executando no processador."}
      </p>
    </div>
  );
}

/**
 * Moldura das duas prévias. O mapa fica sobre preto, não sobre o xadrez: o
 * fundo transparente da entrada VIRA preto no PNG salvo, então mostrar xadrez
 * ali faria a prévia mentir sobre o arquivo final.
 */
function Painel({
  titulo,
  escuro,
  children,
}: {
  titulo: string;
  escuro?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5 min-w-0">
      <p className="text-text-secondary text-xs font-medium">{titulo}</p>
      <div
        className={[
          "glass-inset overflow-hidden aspect-square flex items-center justify-center",
          escuro ? "bg-black" : "checker",
        ].join(" ")}
      >
        {children}
      </div>
    </div>
  );
}
