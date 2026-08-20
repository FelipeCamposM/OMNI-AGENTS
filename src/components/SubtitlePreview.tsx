import { useCallback, useEffect, useRef, useState } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { pilhaCss } from "../lib/subtitleFonts";
import type {
  SubtitleColors,
  SubtitlePosition,
  SubtitleStyle,
} from "../services/conversionService";

/** O ASS mede tudo contra esta altura (`PlayResY` em python/subtitles.py). */
export const ASS_ALTURA = 1080;

export interface EstiloPreview {
  fonte: string;
  /** Na escala de 1080 — o mesmo número que vai para o `.ass`. */
  tamanho: number;
  posicao: SubtitlePosition;
  margemV: number;
  preset: SubtitleStyle;
  /** Cores em `#RRGGBB`, as mesmas que vão para o `.ass`. */
  cores: SubtitleColors;
}

/**
 * Só a geometria vem do preset — espelho de `ESTILOS` em python/subtitles.py.
 * As CORES vêm das props: são escolhidas na interface.
 */
const GEOMETRIA: Record<
  SubtitleStyle,
  { larguraContorno: number; sombra: number; temCaixa: boolean; peso: number }
> = {
  classico: { larguraContorno: 3, sombra: 1, temCaixa: false, peso: 700 },
  youtube: { larguraContorno: 0, sombra: 0, temCaixa: true, peso: 700 },
  karaoke: { larguraContorno: 5, sombra: 2, temCaixa: false, peso: 700 },
  minimalista: { larguraContorno: 0, sombra: 2, temCaixa: false, peso: 400 },
  neon: { larguraContorno: 4, sombra: 4, temCaixa: false, peso: 700 },
};

/**
 * Espelho de `ENTRADAS` em python/subtitles.py — a classe CSS reproduz a
 * mesma animação que o libass vai desenhar. Mexeu lá, mexa aqui.
 */
const ANIMACAO: Record<SubtitleStyle, string> = {
  classico: "sub-assenta",
  youtube: "sub-cresce",
  karaoke: "sub-pop",
  minimalista: "sub-desfoca",
  neon: "sub-brilha",
};

const ALINHAMENTO: Record<SubtitlePosition, string> = {
  2: "flex-end",
  5: "center",
  8: "flex-start",
};

export interface Quadro {
  w: number;
  h: number;
  /** Altura da barra preta acima do quadro. */
  top: number;
}

/**
 * Mede o quadro **renderizado**, não o elemento.
 *
 * Com `object-contain` o vídeo deixa barras pretas, e a legenda queimada é
 * relativa ao quadro — usar a altura do elemento colocaria a legenda dentro da
 * barra preta em qualquer vídeo cuja proporção não seja a da caixa.
 *
 * Separado do componente para ser testável: é aqui que mora o erro que faria o
 * preview mentir.
 */
export function medirQuadro(
  videoW: number,
  videoH: number,
  caixaW: number,
  caixaH: number
): Quadro | null {
  if (!videoW || !videoH || !caixaW || !caixaH) return null;
  const contain = Math.min(caixaW / videoW, caixaH / videoH);
  const h = videoH * contain;
  return { w: videoW * contain, h, top: (caixaH - h) / 2 };
}

/** Fator entre o canvas do ASS (1080 de altura) e o quadro na tela. */
export function escalaAss(alturaDoQuadro: number): number {
  return alturaDoQuadro / ASS_ALTURA;
}

/**
 * Prévia da legenda queimada: `<video>` real com a legenda desenhada por cima
 * em HTML.
 *
 * ⚠️ É uma **aproximação** do libass, não o mesmo renderizador. Serve para
 * decidir fonte, tamanho e posição sem gastar a codificação inteira — não para
 * conferir pixel. Diferenças esperadas em kerning e na espessura do contorno.
 *
 * O que faz a prévia ser honesta é a escala: o ASS mede contra uma tela de
 * 1080 de altura e o libass reescala para o vídeo real. Sem repetir essa conta
 * aqui, o preview mentiria em qualquer vídeo que não fosse 1080p.
 */
export function SubtitlePreview({
  path,
  texto,
  estilo,
  onMargemChange,
  onTempo,
  onMedia,
}: {
  path: string;
  /** Frase mostrada. Use um bloco real da transcrição quando houver. */
  texto: string;
  estilo: EstiloPreview;
  /** Arrastar a legenda escreve aqui, já na escala de 1080. */
  onMargemChange?: (margemV: number) => void;
  onTempo?: (segundos: number) => void;
  /** Entrega o <video> a quem precisa comandá-lo (o editor pula p/ o bloco). */
  onMedia?: (el: HTMLVideoElement | null) => void;
}) {
  // `| null` no tipo: sem ele o React devolve um ref somente-leitura e o
  // encadeamento com `onMedia` não compila.
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [quadro, setQuadro] = useState<Quadro | null>(null);
  const [arrastando, setArrastando] = useState(false);

  const medir = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    setQuadro(medirQuadro(v.videoWidth, v.videoHeight, v.clientWidth, v.clientHeight));
  }, []);

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    // `ResizeObserver` não existe no jsdom. Sem a guarda, um ReferenceError
    // aqui derruba a tool inteira nos testes — e derrubaria em qualquer webview
    // antigo também.
    if (typeof ResizeObserver === "undefined") {
      medir();
      return;
    }
    const ro = new ResizeObserver(medir);
    ro.observe(v);
    return () => ro.disconnect();
  }, [medir]);

  const escala = quadro ? escalaAss(quadro.h) : 0;
  const g = GEOMETRIA[estilo.preset] ?? GEOMETRIA.classico;
  const c = estilo.cores;

  function aoArrastar(e: React.PointerEvent) {
    if (!quadro || !onMargemChange) return;
    e.preventDefault();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    setArrastando(true);
  }

  function aoMover(e: React.PointerEvent) {
    if (!arrastando || !quadro || !onMargemChange) return;
    const caixa = e.currentTarget.getBoundingClientRect();
    // Distância até a borda de referência, convertida de volta para a escala
    // do ASS. No topo a margem cresce para baixo; no rodapé, para cima.
    const yNoQuadro = e.clientY - caixa.top - quadro.top;
    const distancia = estilo.posicao === 8 ? yNoQuadro : quadro.h - yNoQuadro;
    const emAss = Math.round(distancia / (escala || 1));
    // Prender: sem isto a legenda sai do quadro e some do vídeo final.
    onMargemChange(Math.max(0, Math.min(ASS_ALTURA / 2, emAss)));
  }

  const sombra = g.sombra
    ? `${g.sombra * escala}px ${g.sombra * escala}px ${g.sombra * escala * 1.5}px rgba(0,0,0,.75)`
    : undefined;

  return (
    <div className="glass-inset relative overflow-hidden bg-black">
      <video
        ref={(el) => {
          // Encadeia: o componente precisa do elemento para medir o quadro,
          // e quem chama precisa dele para dar seek.
          videoRef.current = el;
          onMedia?.(el);
        }}
        src={convertFileSrc(path)}
        controls
        preload="metadata"
        onLoadedMetadata={medir}
        onTimeUpdate={(e) => onTempo?.(e.currentTarget.currentTime)}
        className="w-full max-h-72 object-contain"
      />

      {quadro && (
        <div
          aria-hidden="true"
          onPointerMove={aoMover}
          onPointerUp={() => setArrastando(false)}
          onPointerCancel={() => setArrastando(false)}
          className="absolute inset-0 flex justify-center"
          style={{
            // `controls` do vídeo ficam embaixo; só a legenda captura ponteiro.
            pointerEvents: arrastando ? "auto" : "none",
            alignItems: ALINHAMENTO[estilo.posicao],
            paddingTop: estilo.posicao === 8 ? quadro.top + estilo.margemV * escala : quadro.top,
            paddingBottom:
              estilo.posicao === 2 ? quadro.top + estilo.margemV * escala : quadro.top,
          }}
        >
          <span
            /* Trocar a `key` remonta o elemento e a animação roda de novo — é
               o que deixa o ajuste de estilo dar retorno visual imediato. */
            key={`${estilo.preset}-${estilo.fonte}-${estilo.tamanho}-${c.cor}${c.contorno}`}
            onPointerDown={aoArrastar}
            className={[
              "max-w-[86%] text-center leading-tight select-none",
              ANIMACAO[estilo.preset] ?? "sub-assenta",
              onMargemChange ? "cursor-grab active:cursor-grabbing" : "",
              arrastando ? "ring-2 ring-selected rounded" : "",
            ].join(" ")}
            style={{
              pointerEvents: "auto",
              fontFamily: pilhaCss(estilo.fonte),
              fontSize: estilo.tamanho * escala,
              fontWeight: g.peso,
              color: c.cor,
              // A caixa do preset YouTube é semitransparente; o hex sozinho
              // seria opaco e taparia o vídeo.
              background: g.temCaixa ? `${c.caixa}80` : undefined,
              padding: g.temCaixa ? `${2 * escala}px ${10 * escala}px` : undefined,
              // O stroke sozinho come o miolo da letra em fonte fina; a sombra
              // dupla devolve o peso que o libass dá ao contorno.
              WebkitTextStroke: g.larguraContorno
                ? `${g.larguraContorno * escala}px ${c.contorno}`
                : undefined,
              paintOrder: "stroke fill",
              textShadow: sombra,
            }}
          >
            {texto}
          </span>
        </div>
      )}

      {!quadro && (
        <p className="text-text-muted text-[11px] p-3">Carregando prévia…</p>
      )}
    </div>
  );
}
