import { Image as ImageIcon } from "lucide-react";
import { useState } from "react";
import { open, save } from "@tauri-apps/plugin-dialog";
import { convertFileSrc } from "@tauri-apps/api/core";
import { copyFile, removeBg } from "../../services/conversionService";
import type { RemoveBgResult } from "../../services/conversionService";
import { useDragDrop } from "../../hooks/useDragDrop";
import type { ToolProps } from "../registry";
import { revealMedia, useToolEnter } from "../../lib/motion";
import { useToolProgress } from "../../hooks/useToolProgress";
import { ProgressoTranscricao } from "../../components/ProgressoTranscricao";
import { Button, ResultPanel } from "../../components/ui";

const IMAGE_EXTS = ["png", "jpg", "jpeg", "webp"];

function nome(p: string) {
  return p.split(/[/\\]/).pop() ?? p;
}

/**
 * Remoção de fundo (u2net via ONNX Runtime).
 *
 * Fluxo em duas etapas como as outras ferramentas de imagem: o Python grava um
 * PNG com alfa em temp, a prévia mostra sobre xadrez, e salvar é só copiar —
 * a segmentação não roda de novo.
 */
export function BgRemoveTool({ settings, addHistory }: ToolProps) {
  const [input, setInput] = useState<string | null>(null);
  const [saida, setSaida] = useState<(RemoveBgResult & { stamp: number }) | null>(null);
  const [busy, setBusy] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [resultado, setResultado] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [dropError, setDropError] = useState<string | null>(null);

  const { progresso, etapa, zerar } = useToolProgress();

  function escolher(caminho: string) {
    setInput(caminho);
    // Trocar a imagem invalida o recorte: manter o antigo ao lado de uma
    // original nova é a forma mais fácil de salvar o arquivo errado.
    setSaida(null);
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

  async function remover() {
    if (!input || busy) return;
    setBusy(true);
    setErro(null);
    setResultado(null);
    zerar();
    try {
      const r = await removeBg(input);
      if (!r.success || !r.outputPath) {
        setErro(r.message ?? "Falha ao remover o fundo.");
        return;
      }
      setSaida({ ...r, stamp: Date.now() });
    } catch {
      setErro("Falha ao iniciar a remoção de fundo.");
    } finally {
      setBusy(false);
    }
  }

  async function salvar() {
    if (!input || !saida?.outputPath || salvando) return;
    const base = nome(input).replace(/\.[^.]+$/, "");
    const destino = await save({
      filters: [{ name: "PNG", extensions: ["png"] }],
      defaultPath: settings.defaultOutputDir
        ? `${settings.defaultOutputDir}\\${base}-sem-fundo.png`
        : `${base}-sem-fundo.png`,
    });
    if (!destino) return;

    setSalvando(true);
    setErro(null);
    try {
      const gravado = await copyFile(saida.outputPath, destino);
      setResultado(gravado);
      addHistory({
        id: crypto.randomUUID(),
        tool: "bg-remove",
        filename: nome(input),
        inputPath: input,
        outputPath: gravado,
        durationMs: saida.durationMs ?? 0,
        timestamp: Date.now(),
        success: true,
      });
    } catch {
      setErro("Falha ao salvar o PNG.");
    } finally {
      setSalvando(false);
    }
  }

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

          <Painel titulo="Sem fundo">
            {saida?.outputPath ? (
              <img
                /* `?t=` fura o cache: o rascunho reusa o mesmo caminho a cada
                   execução, e sem isto o WebView mostraria o recorte anterior. */
                src={`${convertFileSrc(saida.outputPath)}?t=${saida.stamp}`}
                alt="Resultado sem fundo"
                onLoad={(e) => revealMedia(e.currentTarget)}
                className="w-full h-full object-contain"
              />
            ) : (
              <p className="text-text-muted text-[11px] px-3 text-center">
                {busy ? "Recortando…" : "Ainda não processada"}
              </p>
            )}
          </Painel>
        </div>
      )}

      <Button
        variant={saida ? "glass" : "primary"}
        className="w-full"
        onClick={remover}
        disabled={!input || salvando}
        loading={busy}
      >
        {busy ? "Removendo…" : saida ? "Remover de novo" : "Remover fundo"}
      </Button>

      {busy && (
        <ProgressoTranscricao
          progresso={progresso}
          etapa={etapa}
          aviso="Na primeira vez o modelo (~168 MB) é baixado; depois fica em cache no disco. Cada recorte leva cerca de 20 s — a maior parte é o carregamento da biblioteca."
        />
      )}

      {saida?.outputPath && (
        <>
          <Button variant="primary" className="w-full" onClick={salvar} loading={salvando}>
            {salvando ? "Salvando…" : "Salvar PNG…"}
          </Button>
          {saida.durationMs != null && (
            <p className="text-text-muted text-[11px]">
              {saida.width} × {saida.height} · {(saida.durationMs / 1000).toFixed(1)} s
              {saida.provider === "CPUExecutionProvider" && " · executado no processador"}
            </p>
          )}
        </>
      )}

      {erro && <p role="alert" className="text-danger text-xs">{erro}</p>}

      {resultado && <ResultPanel paths={[resultado]} label="PNG salvo" />}

      <p className="text-text-muted text-[11px]">
        A segmentação roda no seu computador — nenhuma imagem sai daqui. O modelo é carregado na
        hora e liberado ao terminar.
      </p>
    </div>
  );
}

/**
 * Moldura das duas prévias. As duas sobre o xadrez: o resultado é PNG com alfa
 * real, e mostrá-lo sobre branco esconderia justamente o que o usuário quer
 * conferir (borda de cabelo, resto de fundo).
 */
function Painel({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5 min-w-0">
      <p className="text-text-secondary text-xs font-medium">{titulo}</p>
      <div className="glass-inset overflow-hidden aspect-square flex items-center justify-center checker">
        {children}
      </div>
    </div>
  );
}
