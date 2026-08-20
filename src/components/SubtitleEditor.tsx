import { Play, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import type { SubtitleSegment } from "../services/conversionService";
import { Button } from "./ui";

/** mm:ss.d — precisão de décimo basta para conferir sincronia a olho. */
function tempo(s: number) {
  const m = Math.floor(s / 60);
  const seg = s % 60;
  return `${m}:${seg.toFixed(1).padStart(4, "0")}`;
}

/**
 * Editor da transcrição: corrigir texto e ajustar tempo antes de gravar.
 *
 * Existe porque o Whisper erra nome próprio, sigla e número de forma previsível
 * — "transcrição" virou "transclica" no primeiro teste real. Sem este passo, a
 * saída não é publicável sem abrir o .srt num editor de texto.
 *
 * Só edita; quem grava é o `writeSubtitles`. Assim o mesmo editor serve para
 * salvar arquivo e para alimentar a queima no vídeo.
 */
export function SubtitleEditor({
  segments,
  onChange,
  onSeek,
  duracao,
}: {
  segments: SubtitleSegment[];
  onChange: (s: SubtitleSegment[]) => void;
  /** Leva o vídeo até o instante do bloco. */
  onSeek?: (segundos: number) => void;
  /** Duração da mídia, para não deixar arrastar um bloco para fora. */
  duracao?: number | null;
}) {
  const [aberto, setAberto] = useState(true);

  const editados = useMemo(
    () => segments.filter((s) => s.words && s.words.length !== s.text.trim().split(/\s+/).length),
    [segments]
  );

  function alterar(i: number, mudanca: Partial<SubtitleSegment>) {
    onChange(segments.map((s, n) => (n === i ? { ...s, ...mudanca } : s)));
  }

  function remover(i: number) {
    onChange(segments.filter((_, n) => n !== i));
  }

  /** Empurra início e fim juntos: mover um bloco não muda sua duração. */
  function deslocar(i: number, delta: number) {
    const s = segments[i];
    const limite = duracao ?? Infinity;
    const inicio = Math.max(0, Math.min(s.start + delta, limite));
    alterar(i, { start: inicio, end: Math.min(inicio + (s.end - s.start), limite) });
  }

  if (segments.length === 0) return null;

  return (
    <div className="glass rounded-glass p-4 space-y-3">
      <div className="flex items-center gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-text-primary text-sm font-medium">
            Revisar legenda — {segments.length} bloco(s)
          </p>
          <p className="text-text-muted text-[11px]">
            Nome próprio, sigla e número costumam sair errados. Corrija aqui antes de gravar.
          </p>
        </div>
        <Button variant="ghost" size="sm" onClick={() => setAberto((v) => !v)}>
          {aberto ? "Recolher" : "Expandir"}
        </Button>
      </div>

      {editados.length > 0 && (
        <p className="text-text-muted text-[11px]">
          {editados.length} bloco(s) editado(s): o tempo por palavra será recalculado a partir do
          texto novo, então o karaokê fica aproximado nesses.
        </p>
      )}

      {aberto && (
        <ul className="space-y-1.5 max-h-96 overflow-y-auto pr-1">
          {segments.map((s, i) => (
            <li key={i} className="glass-inset p-2 space-y-1.5">
              <div className="flex items-center gap-1.5">
                <span className="text-text-muted text-[10px] tabular-nums w-6 shrink-0">
                  {i + 1}
                </span>

                {onSeek && (
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-label={`Ouvir o bloco ${i + 1}`}
                    onClick={() => onSeek(s.start)}
                  >
                    <Play aria-hidden="true" className="w-3 h-3" />
                  </Button>
                )}

                <span className="text-text-muted text-[10px] tabular-nums">
                  {tempo(s.start)} → {tempo(s.end)}
                </span>

                {/* Ajuste fino em passos de 100 ms: o erro típico do Whisper é
                    dessa ordem, e digitar tempo à mão é lento demais. */}
                <div className="ml-auto flex items-center gap-0.5">
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-label={`Adiantar o bloco ${i + 1}`}
                    onClick={() => deslocar(i, -0.1)}
                  >
                    −0,1s
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-label={`Atrasar o bloco ${i + 1}`}
                    onClick={() => deslocar(i, 0.1)}
                  >
                    +0,1s
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-label={`Remover o bloco ${i + 1}`}
                    onClick={() => remover(i)}
                  >
                    <Trash2 aria-hidden="true" className="w-3 h-3" />
                  </Button>
                </div>
              </div>

              {/* textarea e não input: a quebra de linha é significativa — é ela
                  que vira \N no .ass e a segunda linha no .srt. */}
              <textarea
                value={s.text}
                onChange={(e) => alterar(i, { text: e.target.value })}
                aria-label={`Texto do bloco ${i + 1}`}
                rows={s.text.includes("\n") ? 2 : 1}
                spellCheck
                className="selectable w-full bg-transparent text-text-primary text-xs resize-none focus:outline-none"
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
