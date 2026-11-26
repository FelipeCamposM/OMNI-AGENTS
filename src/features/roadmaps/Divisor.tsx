// Fork (Roadmaps): divisor arrastável entre dois painéis, com teclado (setas) e tamanho salvo.
import { useCallback, useState, type KeyboardEvent, type PointerEvent } from "react";

const PREFIXO = "omni-roadmaps-tamanho:";

function ler(chave: string): number | null {
  try { const v = Number(localStorage.getItem(PREFIXO + chave)); return Number.isFinite(v) && v > 0 ? v : null; } catch { return null; }
}
function gravar(chave: string, valor: number) {
  try { localStorage.setItem(PREFIXO + chave, String(Math.round(valor))); } catch { /* sem localStorage: vale só agora */ }
}

/** Tamanho (px ou escala) lembrado por chave; só conveniência, nada importante mora aqui. */
export function useTamanhoSalvo(chave: string, padrao: number, min: number, max: number): [number, (v: number) => void] {
  const [valor, setValor] = useState(() => Math.min(max, Math.max(min, ler(chave) ?? padrao)));
  const definir = useCallback((v: number) => {
    if (!Number.isFinite(v)) return;
    const limitado = Math.min(max, Math.max(min, v));
    setValor(limitado);
    gravar(chave, limitado);
  }, [chave, min, max]);
  return [valor, definir];
}

/**
 * `cresce`: para que lado o painel controlado aumenta ao arrastar para a direita (`"direita"` = o
 * painel está à esquerda do divisor; `"esquerda"` = o painel está à direita).
 */
export function Divisor({ valor, min, max, onChange, cresce, rotulo }: {
  valor: number; min: number; max: number; onChange: (v: number) => void; cresce: "direita" | "esquerda"; rotulo: string;
}) {
  const [arrastando, setArrastando] = useState(false);
  const inicio = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button > 0) return;
    e.preventDefault();
    const alvo = e.currentTarget;
    alvo.setPointerCapture?.(e.pointerId);
    const x0 = e.clientX, v0 = valor;
    setArrastando(true);
    // O webview nativo da fonte cobre o HTML e engoliria o mouse: some durante o arraste (NavegadorPane).
    document.body.classList.add("lateral-arrastando");
    const mover = (ev: globalThis.PointerEvent) => onChange(v0 + (ev.clientX - x0) * (cresce === "direita" ? 1 : -1));
    const fim = () => {
      setArrastando(false);
      document.body.classList.remove("lateral-arrastando");
      alvo.removeEventListener("pointermove", mover);
      alvo.removeEventListener("pointerup", fim);
      alvo.removeEventListener("pointercancel", fim);
    };
    alvo.addEventListener("pointermove", mover);
    alvo.addEventListener("pointerup", fim);
    alvo.addEventListener("pointercancel", fim);
  };
  const tecla = (e: KeyboardEvent<HTMLDivElement>) => {
    const passo = e.shiftKey ? 64 : 16;
    if (e.key === "ArrowLeft") { e.preventDefault(); onChange(valor + (cresce === "direita" ? -passo : passo)); }
    if (e.key === "ArrowRight") { e.preventDefault(); onChange(valor + (cresce === "direita" ? passo : -passo)); }
  };
  return (
    <div role="separator" aria-orientation="vertical" aria-label={rotulo} aria-valuenow={Math.round(valor)} aria-valuemin={min} aria-valuemax={max}
      tabIndex={0} className={`roadmap-divisor${arrastando ? " is-arrastando" : ""}`} onPointerDown={inicio} onKeyDown={tecla}
      onDoubleClick={() => onChange((min + max) / 2)} title="Arraste para redimensionar (duplo clique centraliza)" />
  );
}

/** A− / A+ do texto do roadmap (escala de 0,85 a 1,5). */
export function TamanhoDoTexto({ escala, onChange }: { escala: number; onChange: (v: number) => void }) {
  return (
    <span className="roadmap-tamanho-texto" role="group" aria-label="Tamanho do texto">
      <button type="button" aria-label="Diminuir o texto" disabled={escala <= 0.85} onClick={() => onChange(Math.round((escala - 0.1) * 100) / 100)}>A−</button>
      <button type="button" aria-label="Aumentar o texto" disabled={escala >= 1.5} onClick={() => onChange(Math.round((escala + 0.1) * 100) / 100)}>A+</button>
    </span>
  );
}

/** Escala do texto compartilhada por trilha, estudo e celular (em centésimos no armazenamento). */
export function useEscalaDoTexto(): [number, (v: number) => void] {
  const [centesimos, definir] = useTamanhoSalvo("texto", 100, 85, 150);
  return [centesimos / 100, (v: number) => definir(v * 100)];
}
