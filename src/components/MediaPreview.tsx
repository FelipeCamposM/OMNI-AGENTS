import { FileAudio, X } from "lucide-react";
import { useState } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { Button } from "./ui";

const EXTS_AUDIO = ["mp3", "wav", "m4a", "flac", "ogg", "aac", "wma"];

function ehAudio(caminho: string) {
  return EXTS_AUDIO.includes(caminho.split(".").pop()?.toLowerCase() ?? "");
}

function nomeDe(caminho: string) {
  return caminho.split(/[/\\]/).pop() ?? caminho;
}

function duracaoLegivel(s: number) {
  if (!Number.isFinite(s) || s <= 0) return null;
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const seg = Math.floor(s % 60);
  return h > 0
    ? `${h}:${String(m).padStart(2, "0")}:${String(seg).padStart(2, "0")}`
    : `${m}:${String(seg).padStart(2, "0")}`;
}

/**
 * Prévia do arquivo escolhido — confirma visualmente que é o vídeo certo antes
 * de gastar minutos processando.
 *
 * É um `<video>` de verdade, não uma miniatura estática: dá para dar play e
 * pular no meio. Vem de graça, sem passar pelo ffmpeg — o WebView decodifica
 * pelo asset protocol. Exige `media-src` no CSP (tauri.conf.json); sem isso o
 * elemento carrega vazio e o erro só aparece no console.
 */
export function MediaPreview({
  path,
  onClear,
  onDuration,
  onMedia,
}: {
  path: string;
  onClear?: () => void;
  /** Duração em segundos, lida do próprio arquivo. */
  onDuration?: (segundos: number) => void;
  /**
   * Entrega o elemento de mídia a quem precisa comandá-lo (o editor de legenda
   * pula para o instante do bloco). Callback ref em vez de `forwardRef` porque
   * o elemento alterna entre `<video>` e `<audio>` conforme o arquivo.
   */
  onMedia?: (el: HTMLVideoElement | HTMLAudioElement | null) => void;
}) {
  const [duracao, setDuracao] = useState<number | null>(null);
  const [falhou, setFalhou] = useState(false);
  const audio = ehAudio(path);

  function aoCarregar(e: React.SyntheticEvent<HTMLVideoElement | HTMLAudioElement>) {
    const d = e.currentTarget.duration;
    setDuracao(d);
    onDuration?.(d);
  }

  return (
    <div className="glass rounded-glass p-3 space-y-2">
      <div className="flex items-center gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-text-primary text-xs font-medium truncate" title={path}>
            {nomeDe(path)}
          </p>
          {duracao !== null && (
            <p className="text-text-muted text-[11px]">
              Duração {duracaoLegivel(duracao)}
            </p>
          )}
        </div>
        {onClear && (
          <Button variant="ghost" size="sm" aria-label="Remover arquivo" onClick={onClear}>
            <X aria-hidden="true" className="w-3.5 h-3.5" />
          </Button>
        )}
      </div>

      {falhou ? (
        <div className="glass-inset flex items-center gap-2 px-3 py-4">
          <FileAudio aria-hidden="true" className="w-5 h-5 text-text-muted shrink-0" />
          <p className="text-text-muted text-[11px]">
            Sem prévia para este formato — a transcrição funciona mesmo assim.
          </p>
        </div>
      ) : audio ? (
        <audio
          ref={onMedia}
          src={convertFileSrc(path)}
          controls
          preload="metadata"
          onLoadedMetadata={aoCarregar}
          onError={() => setFalhou(true)}
          className="w-full"
        />
      ) : (
        <video
          ref={onMedia}
          src={convertFileSrc(path)}
          controls
          preload="metadata"
          onLoadedMetadata={aoCarregar}
          onError={() => setFalhou(true)}
          className="glass-inset w-full max-h-56 bg-black object-contain"
        />
      )}
    </div>
  );
}
