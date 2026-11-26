// Roda de números no jeito do alarme do iPhone: rola (dedo, roda do mouse ou setas) e o número do meio é o escolhido.
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";

/** Altura de cada linha em px: igual à `.roda-item` do CSS (o índice sai de scrollTop / ALTURA). */
const ALTURA = 32;

/** `digitavel`: campo embaixo para escrever o número (para rodas com muitas opções, ex.: meta do dia). */
export function RodaDeNumeros({ valor, min, max, passo = 1, rotulo, sufixo, digitavel, onChange }: {
  valor: number; min: number; max: number; passo?: number; rotulo: string; sufixo?: string; digitavel?: boolean; onChange: (n: number) => void;
}) {
  // Valor fora do passo (digitado, ex.: 137 com passo 5) entra na roda para ela mostrar o que vale de verdade.
  const valores = useMemo(() => {
    const base = Array.from({ length: Math.floor((max - min) / passo) + 1 }, (_, i) => min + i * passo);
    return base.includes(valor) || valor < min || valor > max ? base : [...base, valor].sort((a, b) => a - b);
  }, [min, max, passo, valor]);
  const limitar = (i: number) => Math.max(0, Math.min(valores.length - 1, i));
  const indiceDe = (v: number) => { const i = valores.indexOf(v); return i >= 0 ? i : limitar(Math.round((v - min) / passo)); };
  const ref = useRef<HTMLDivElement>(null);
  const espera = useRef<number | undefined>(undefined);
  const [atual, setAtual] = useState(() => indiceDe(valor));
  const ultimo = useRef(atual);
  const aoMudar = useRef(onChange);
  aoMudar.current = onChange;

  const confirmar = (i: number) => {
    window.clearTimeout(espera.current);
    espera.current = window.setTimeout(() => { if (valores[i] !== valor) aoMudar.current(valores[i]); }, 180);
  };
  const ir = (i: number, suave = false) => {
    const alvo = limitar(i);
    ultimo.current = alvo;
    setAtual(alvo);
    const el = ref.current;
    if (el) { if (el.scrollTo) el.scrollTo({ top: alvo * ALTURA, behavior: suave ? "smooth" : "auto" }); else el.scrollTop = alvo * ALTURA; }
    confirmar(alvo);
  };

  // Valor veio de fora (outro aparelho, primeira leitura): posiciona sem animar.
  useEffect(() => {
    const i = indiceDe(valor);
    ultimo.current = i;
    setAtual(i);
    if (ref.current) ref.current.scrollTop = i * ALTURA;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [valor, valores]);

  // Roda do mouse anda uma linha por clique (o padrão do Windows pularia três).
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const rodar = (e: WheelEvent) => { e.preventDefault(); if (Math.abs(e.deltaY) >= 1) ir(ultimo.current + Math.sign(e.deltaY)); };
    el.addEventListener("wheel", rodar, { passive: false });
    return () => el.removeEventListener("wheel", rodar);
  });
  useEffect(() => () => window.clearTimeout(espera.current), []);

  const aoRolar = () => {
    const el = ref.current;
    if (!el) return;
    const i = limitar(Math.round(el.scrollTop / ALTURA));
    if (i === ultimo.current) return;
    ultimo.current = i;
    setAtual(i);
    confirmar(i);
  };
  const teclas = (e: KeyboardEvent) => {
    const passos: Record<string, number> = { ArrowUp: -1, ArrowDown: 1, PageUp: -10, PageDown: 10 };
    if (e.key in passos) ir(atual + passos[e.key]);
    else if (e.key === "Home") ir(0);
    else if (e.key === "End") ir(valores.length - 1);
    else return;
    e.preventDefault();
  };

  return (
    <div className="roda">
      <span className="roda-rotulo">{rotulo}</span>
      <div className="roda-janela">
        <div ref={ref} className="roda-rolo" role="spinbutton" tabIndex={0} aria-label={rotulo}
          aria-valuenow={valores[atual]} aria-valuemin={min} aria-valuemax={valores[valores.length - 1]}
          aria-valuetext={sufixo ? `${valores[atual]} ${sufixo}` : String(valores[atual])} onScroll={aoRolar} onKeyDown={teclas}>
          {valores.map((v, i) => (
            <div key={v} className={`roda-item ${i === atual ? "is-atual" : ""}`} aria-hidden="true" onClick={() => ir(i, true)}>{v}</div>
          ))}
        </div>
        {sufixo && <span className="roda-sufixo" aria-hidden="true">{sufixo}</span>}
      </div>
      {digitavel && (
        <input className="es-campo roda-digitar" inputMode="numeric" pattern="[0-9]*" maxLength={String(max).length} aria-label={`${rotulo}: digitar`} placeholder="Digitar…" key={valor}
          onInput={(e) => { e.currentTarget.value = e.currentTarget.value.replace(/\D/g, ""); }}
          defaultValue="" onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }}
          onBlur={(e) => {
            const n = Number(e.target.value);
            e.target.value = "";
            if (Number.isFinite(n) && n > 0) aoMudar.current(Math.min(max, Math.max(min, n)));
          }} />
      )}
    </div>
  );
}
