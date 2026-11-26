// Seletor de cor próprio: o `<input type="color">` abre o diálogo do sistema, fora do tema do app.
// Quadrado de saturação × brilho, barra de matiz, campo hex e atalhos, num popover animado.
import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from "react";
import "./seletorDeCor.css";

type Hsv = { h: number; s: number; v: number };

const limitar = (n: number, min = 0, max = 1) => Math.min(max, Math.max(min, n));

export function hexParaHsv(hex: string): Hsv {
  const n = parseInt(hex.replace("#", ""), 16);
  const r = ((n >> 16) & 255) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255;
  const max = Math.max(r, g, b), d = max - Math.min(r, g, b);
  const h = d === 0 ? 0 : max === r ? ((g - b) / d + 6) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return { h: h * 60, s: max === 0 ? 0 : d / max, v: max };
}

export function hsvParaHex({ h, s, v }: Hsv): string {
  const f = (n: number) => {
    const k = (n + h / 60) % 6;
    return Math.round((v - v * s * Math.max(0, Math.min(k, 4 - k, 1))) * 255).toString(16).padStart(2, "0");
  };
  return `#${f(5)}${f(3)}${f(1)}`.toUpperCase();
}

const ATALHOS = ["#F97316", "#FBBF24", "#34D399", "#22D3EE", "#3B82F6", "#A855F7", "#F472B6", "#F87171", "#FFFFFF", "#000000"];

/** O painel em si (sem gatilho). `onChange` recebe sempre `#RRGGBB` maiúsculo. */
export function PainelDeCor({ value, onChange }: { value: string; onChange: (hex: string) => void }) {
  const [hsv, setHsv] = useState(() => hexParaHsv(value));
  const [texto, setTexto] = useState(value.toUpperCase());
  const area = useRef<HTMLDivElement>(null);
  const barra = useRef<HTMLDivElement>(null);
  const ultimo = useRef(value.toUpperCase());

  // Valor mudou por fora (atalho, outro componente): acompanha sem perder o matiz de um cinza.
  useEffect(() => {
    if (value.toUpperCase() === ultimo.current) return;
    ultimo.current = value.toUpperCase();
    setHsv(hexParaHsv(value));
    setTexto(value.toUpperCase());
  }, [value]);

  const aplicar = (novo: Hsv) => {
    setHsv(novo);
    const hex = hsvParaHex(novo);
    ultimo.current = hex;
    setTexto(hex);
    onChange(hex);
  };

  const arrastar = (alvo: "area" | "barra") => (e: PointerEvent<HTMLDivElement>) => {
    const el = (alvo === "area" ? area : barra).current;
    if (!el) return;
    if (e.type === "pointerdown") el.setPointerCapture(e.pointerId);
    else if (!el.hasPointerCapture(e.pointerId)) return;
    const caixa = el.getBoundingClientRect();
    const x = limitar((e.clientX - caixa.left) / caixa.width), y = limitar((e.clientY - caixa.top) / caixa.height);
    aplicar(alvo === "area" ? { ...hsv, s: x, v: 1 - y } : { ...hsv, h: x * 360 });
  };

  const teclasDaArea = (e: KeyboardEvent) => {
    const passo = e.shiftKey ? 0.1 : 0.02;
    const d: Record<string, [number, number]> = { ArrowLeft: [-passo, 0], ArrowRight: [passo, 0], ArrowUp: [0, passo], ArrowDown: [0, -passo] };
    if (!d[e.key]) return;
    e.preventDefault();
    aplicar({ ...hsv, s: limitar(hsv.s + d[e.key][0]), v: limitar(hsv.v + d[e.key][1]) });
  };
  const teclasDaBarra = (e: KeyboardEvent) => {
    const passo = e.shiftKey ? 15 : 2;
    const d: Record<string, number> = { ArrowLeft: -passo, ArrowDown: -passo, ArrowRight: passo, ArrowUp: passo };
    if (d[e.key] === undefined) return;
    e.preventDefault();
    aplicar({ ...hsv, h: limitar(hsv.h + d[e.key], 0, 360) });
  };

  const corPura = hsvParaHex({ h: hsv.h, s: 1, v: 1 });
  return (
    <div className="sc-painel">
      <div ref={area} className="sc-area" style={{ backgroundColor: corPura }} role="slider" tabIndex={0}
        aria-label="Saturação e brilho" aria-valuetext={`saturação ${Math.round(hsv.s * 100)}%, brilho ${Math.round(hsv.v * 100)}%`}
        aria-valuenow={Math.round(hsv.s * 100)} onPointerDown={arrastar("area")} onPointerMove={arrastar("area")} onKeyDown={teclasDaArea}>
        <span className="sc-mira" style={{ left: `${hsv.s * 100}%`, top: `${(1 - hsv.v) * 100}%`, backgroundColor: hsvParaHex(hsv) }} />
      </div>
      <div ref={barra} className="sc-matiz" role="slider" tabIndex={0} aria-label="Matiz" aria-valuemin={0} aria-valuemax={360}
        aria-valuenow={Math.round(hsv.h)} onPointerDown={arrastar("barra")} onPointerMove={arrastar("barra")} onKeyDown={teclasDaBarra}>
        <span className="sc-puxador" style={{ left: `${(hsv.h / 360) * 100}%`, backgroundColor: corPura }} />
      </div>
      <div className="sc-linha">
        <span className="sc-amostra" style={{ backgroundColor: hsvParaHex(hsv) }} aria-hidden="true" />
        <input className="sc-hex" aria-label="Cor em hexadecimal" value={texto} maxLength={7} spellCheck={false}
          onChange={(e) => {
            const limpo = "#" + e.target.value.replace(/[^0-9a-f]/gi, "").slice(0, 6).toUpperCase();
            setTexto(limpo);
            if (limpo.length === 7) aplicar(hexParaHsv(limpo));
          }} />
      </div>
      <div className="sc-atalhos">
        {ATALHOS.map((c) => (
          <button key={c} type="button" className="sc-atalho" aria-label={`Usar ${c}`} aria-pressed={hsvParaHex(hsv) === c}
            style={{ backgroundColor: c }} onClick={() => aplicar(hexParaHsv(c))} />
        ))}
      </div>
    </div>
  );
}

/** Gatilho + popover com o painel. Fecha no Esc e no clique fora. */
export function SeletorDeCor({ value, onChange, rotulo = "Escolher cor", disabled, children, className }: {
  value: string; onChange: (hex: string) => void; rotulo?: string; disabled?: boolean; children?: ReactNode; className?: string;
}) {
  const [aberto, setAberto] = useState(false);
  const raiz = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!aberto) return;
    const fora = (e: globalThis.PointerEvent) => { if (!raiz.current?.contains(e.target as Node)) setAberto(false); };
    const esc = (e: globalThis.KeyboardEvent) => { if (e.key === "Escape") setAberto(false); };
    document.addEventListener("pointerdown", fora);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("pointerdown", fora); document.removeEventListener("keydown", esc); };
  }, [aberto]);
  return (
    <div ref={raiz} className="sc-raiz">
      <button type="button" className={className} aria-label={rotulo} title={rotulo} aria-expanded={aberto} aria-haspopup="dialog"
        disabled={disabled} onClick={() => setAberto((v) => !v)}>
        {children}
      </button>
      {aberto && (
        <div className="sc-pop" role="dialog" aria-label={rotulo}>
          <PainelDeCor value={value} onChange={onChange} />
        </div>
      )}
    </div>
  );
}
