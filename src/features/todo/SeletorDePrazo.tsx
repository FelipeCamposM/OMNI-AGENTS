import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronDownIcon } from "../../components/ui/PixelIcon";
import { motionOn } from "../../lib/motion";

/*
 * Prazo de uma tarefa: atalhos, calendário do mês e as rodas de hora/minuto (estrutura do timer do
 * iPhone, visual do OMNI). Vai num portal: a lista de tarefas rola (`overflow: auto`) e cortaria o
 * popover de uma tarefa lá embaixo. `data-tarefas-flutuante` avisa o painel que clique aqui dentro
 * não é "clique fora".
 */

const ALTURA = 32;
const VISIVEIS = 5;
const DIA_MS = 24 * 60 * 60 * 1000;
const inicioDoDia = (ms: number) => { const d = new Date(ms); d.setHours(0, 0, 0, 0); return d.getTime(); };
const doisDigitos = (n: number) => String(n).padStart(2, "0");
const HORAS = Array.from({ length: 24 }, (_, i) => i);
const MINUTOS = Array.from({ length: 60 }, (_, i) => i);

/**
 * Uma roda: rolagem nativa com encaixe (`scroll-snap`), e cada item inclina e esmaece pela
 * distância até o centro — o cilindro do iOS. Arrastar com o mouse, roda, clique num número e
 * setas do teclado. O valor só muda quando a roda para.
 */
function Roda({ valores, valor, onChange, rotulo }: { valores: number[]; valor: number; onChange: (v: number) => void; rotulo: string }) {
  const trilho = useRef<HTMLDivElement>(null);
  const atual = useRef({ valor, onChange });
  atual.current = { valor, onChange };
  const parado = useRef<number>();
  const quadro = useRef<number>();
  const montada = useRef(false);
  const indice = Math.max(0, valores.indexOf(valor));

  const pintar = useCallback(() => {
    const el = trilho.current;
    if (!el) return;
    const centro = el.scrollTop + el.clientHeight / 2;
    for (const item of Array.from(el.children) as HTMLElement[]) {
      const d = (item.offsetTop + ALTURA / 2 - centro) / ALTURA;
      const a = Math.min(Math.abs(d), 3);
      item.style.transform = `perspective(260px) rotateX(${-d * 20}deg) scale(${1 - a * 0.07})`;
      item.style.opacity = String(Math.max(0.12, 1 - a * 0.32));
      item.dataset.centro = a < 0.5 ? "sim" : "nao";
    }
  }, []);

  const irPara = useCallback((i: number, suave: boolean) => {
    const el = trilho.current;
    if (!el) return;
    if (typeof el.scrollTo === "function") el.scrollTo({ top: i * ALTURA, behavior: suave && motionOn() ? "smooth" : "auto" });
    else el.scrollTop = i * ALTURA;
  }, []);

  // Valor que mudou por fora (atalho, abrir de novo): a roda gira até ele.
  useLayoutEffect(() => {
    const el = trilho.current;
    if (el && Math.abs(el.scrollTop - indice * ALTURA) > 1) irPara(indice, montada.current);
    montada.current = true;
    pintar();
  }, [indice, irPara, pintar]);

  // Roda do mouse: um "clique" rola ~100 px (três itens) e a rolagem nativa só encaixava depois,
  // pulando de 2 para 6. Aqui cada clique anda um item; no trackpad, um item a cada `ALTURA` px
  // acumulados. `alvo` guarda o passo já pedido, para cliques seguidos somarem antes do render.
  // Listener nativo porque o `onWheel` do React é passivo e não deixa cancelar a rolagem.
  const alvo = useRef(indice);
  alvo.current = indice;
  useEffect(() => {
    const el = trilho.current;
    if (!el) return;
    let acumulado = 0;
    function aoGirar(e: WheelEvent) {
      e.preventDefault();
      const px = e.deltaMode === 1 ? e.deltaY * ALTURA : e.deltaMode === 2 ? e.deltaY * ALTURA * VISIVEIS : e.deltaY;
      if (Math.sign(px) !== Math.sign(acumulado)) acumulado = 0;
      acumulado += px;
      if (Math.abs(acumulado) < ALTURA) return;
      const i = Math.min(valores.length - 1, Math.max(0, alvo.current + Math.sign(acumulado)));
      acumulado = 0;
      if (i === alvo.current) return;
      alvo.current = i;
      atual.current.onChange(valores[i]);
    }
    el.addEventListener("wheel", aoGirar, { passive: false });
    return () => el.removeEventListener("wheel", aoGirar);
  }, [valores]);

  function aoRolar() {
    if (quadro.current) cancelAnimationFrame(quadro.current);
    quadro.current = requestAnimationFrame(pintar);
    window.clearTimeout(parado.current);
    parado.current = window.setTimeout(() => {
      const el = trilho.current;
      if (!el) return;
      const i = Math.min(valores.length - 1, Math.max(0, Math.round(el.scrollTop / ALTURA)));
      if (valores[i] !== atual.current.valor) atual.current.onChange(valores[i]);
    }, 110);
  }

  // Arrastar com o mouse (o toque já rola sozinho). Ao soltar, encaixa no mais próximo.
  const arrasto = useRef<{ y: number; topo: number } | null>(null);
  function aoApertar(e: React.PointerEvent) {
    if (e.pointerType !== "mouse" || e.button !== 0 || !trilho.current) return;
    arrasto.current = { y: e.clientY, topo: trilho.current.scrollTop };
    trilho.current.setPointerCapture(e.pointerId);
    trilho.current.style.scrollSnapType = "none";
  }
  function aoMover(e: React.PointerEvent) {
    if (!arrasto.current || !trilho.current) return;
    trilho.current.scrollTop = arrasto.current.topo - (e.clientY - arrasto.current.y);
  }
  function aoSoltar(e: React.PointerEvent) {
    if (!arrasto.current || !trilho.current) return;
    const moveu = Math.abs(e.clientY - arrasto.current.y) > 3;
    arrasto.current = null;
    trilho.current.style.scrollSnapType = "";
    if (moveu) irPara(Math.round(trilho.current.scrollTop / ALTURA), true);
  }

  function aoTeclar(e: React.KeyboardEvent) {
    const passo = { ArrowUp: -1, ArrowDown: 1, PageUp: -5, PageDown: 5 }[e.key];
    if (passo === undefined) return;
    e.preventDefault();
    const i = Math.min(valores.length - 1, Math.max(0, indice + passo));
    onChange(valores[i]);
  }

  return (
    <div className="roda" role="spinbutton" tabIndex={0} aria-label={rotulo} aria-valuenow={valor}
      aria-valuemin={valores[0]} aria-valuemax={valores[valores.length - 1]} aria-valuetext={doisDigitos(valor)} onKeyDown={aoTeclar}>
      <div ref={trilho} className="roda-trilho" style={{ height: ALTURA * VISIVEIS, paddingBlock: ALTURA * 2 }}
        onScroll={aoRolar} onPointerDown={aoApertar} onPointerMove={aoMover} onPointerUp={aoSoltar} onPointerCancel={aoSoltar}>
        {valores.map((v, i) => (
          <div key={v} className="roda-item" style={{ height: ALTURA }} aria-hidden onClick={() => irPara(i, true)}>{doisDigitos(v)}</div>
        ))}
      </div>
    </div>
  );
}

const SEMANA = ["D", "S", "T", "Q", "Q", "S", "S"];

/** Mês em grade de 6 semanas. Dias passados ficam apagados; trocar de mês desliza para o lado. */
function Calendario({ dia, hoje, onDia }: { dia: number; hoje: number; onDia: (ms: number) => void }) {
  const [mes, setMes] = useState(() => { const d = new Date(dia); return new Date(d.getFullYear(), d.getMonth(), 1).getTime(); });
  const [direcao, setDirecao] = useState<"frente" | "tras" | null>(null);
  // Escolheu um dia de outro mês (atalho): o calendário vai até ele.
  const mesRef = useRef(mes);
  mesRef.current = mes;
  useEffect(() => {
    const d = new Date(dia);
    const alvo = new Date(d.getFullYear(), d.getMonth(), 1).getTime();
    if (alvo === mesRef.current) return;
    setDirecao(alvo > mesRef.current ? "frente" : "tras");
    setMes(alvo);
  }, [dia]);

  const inicio = new Date(mes);
  const primeiro = new Date(inicio.getFullYear(), inicio.getMonth(), 1 - inicio.getDay());
  const dias = Array.from({ length: 42 }, (_, i) => new Date(primeiro.getFullYear(), primeiro.getMonth(), primeiro.getDate() + i).getTime());
  // "outubro de 2026" → "Outubro de 2026" (o `capitalize` do CSS faria "De").
  const titulo = inicio.toLocaleDateString("pt-BR", { month: "long", year: "numeric" }).replace(/^./, (c) => c.toUpperCase());
  const andar = (passo: number) => {
    setDirecao(passo > 0 ? "frente" : "tras");
    setMes(new Date(inicio.getFullYear(), inicio.getMonth() + passo, 1).getTime());
  };
  const mesDeHoje = new Date(new Date(hoje).getFullYear(), new Date(hoje).getMonth(), 1).getTime();

  return (
    <div className="cal">
      <div className="cal-topo">
        <button type="button" className="cal-seta" onClick={() => andar(-1)} disabled={mes <= mesDeHoje} aria-label="Mês anterior">
          <ChevronDownIcon className="h-3.5 w-3.5 rotate-90" aria-hidden />
        </button>
        <span key={mes} className="cal-titulo" data-direcao={direcao ?? undefined} aria-live="polite">{titulo}</span>
        <button type="button" className="cal-seta" onClick={() => andar(1)} aria-label="Próximo mês">
          <ChevronDownIcon className="h-3.5 w-3.5 -rotate-90" aria-hidden />
        </button>
      </div>
      <div className="cal-semana" aria-hidden>{SEMANA.map((s, i) => <span key={i}>{s}</span>)}</div>
      <div key={mes} className="cal-grade" data-direcao={direcao ?? undefined}>
        {dias.map((ms) => {
          const d = new Date(ms);
          const fora = d.getMonth() !== inicio.getMonth();
          const passado = ms < hoje;
          return (
            <button key={ms} type="button" disabled={passado} onClick={() => onDia(ms)}
              aria-pressed={ms === dia} aria-label={d.toLocaleDateString("pt-BR", { weekday: "long", day: "numeric", month: "long" })}
              className={`cal-dia${fora ? " cal-dia-fora" : ""}${ms === hoje ? " cal-dia-hoje" : ""}${ms === dia ? " cal-dia-escolhido" : ""}`}>
              {d.getDate()}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** Próximo dia `semana` (0 = domingo) depois de hoje, às `hora`. */
function proximo(agora: number, semana: number, hora: number) {
  const d = new Date(inicioDoDia(agora));
  d.setDate(d.getDate() + (((semana - d.getDay() + 7) % 7) || 7));
  d.setHours(hora);
  return d.getTime();
}

export function SeletorDePrazo({ valor, agora, onEscolher, onFechar }: {
  valor: number | null;
  agora: number;
  onEscolher: (prazo: number | null) => void;
  onFechar: () => void;
}) {
  const hoje = inicioDoDia(agora);
  const base = valor ?? (() => { const d = new Date(agora); d.setHours(d.getHours() + 1, 0, 0, 0); return d.getTime(); })();
  const [dia, setDia] = useState(inicioDoDia(base));
  const [horas, setHoras] = useState(new Date(base).getHours());
  const [minutos, setMinutos] = useState(new Date(base).getMinutes());
  const prazo = dia + horas * 3_600_000 + minutos * 60_000;
  const passou = prazo <= agora;

  const ancora = useRef<HTMLSpanElement>(null);
  const caixa = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number; cima: boolean } | null>(null);

  useLayoutEffect(() => {
    const botao = ancora.current?.parentElement?.getBoundingClientRect();
    const altura = caixa.current?.offsetHeight ?? 470;
    if (!botao) return;
    const cima = botao.bottom + 8 + altura > window.innerHeight && botao.top - 8 - altura > 0;
    const largura = 288;
    setPos({
      top: cima ? botao.top - 8 - altura : Math.min(botao.bottom + 8, window.innerHeight - altura - 8),
      left: Math.max(8, Math.min(botao.right - largura, window.innerWidth - largura - 8)),
      cima,
    });
  }, []);

  // Esc fecha só o seletor (o painel de tarefas continua aberto): captura antes do painel ouvir.
  useEffect(() => {
    function tecla(e: KeyboardEvent) { if (e.key === "Escape") { e.stopPropagation(); onFechar(); } }
    function fora(e: PointerEvent) {
      const alvo = e.target as Node;
      if (caixa.current?.contains(alvo) || ancora.current?.parentElement?.contains(alvo)) return;
      onFechar();
    }
    window.addEventListener("keydown", tecla, true);
    document.addEventListener("pointerdown", fora);
    return () => { window.removeEventListener("keydown", tecla, true); document.removeEventListener("pointerdown", fora); };
  }, [onFechar]);

  const atalhos: { rotulo: string; ms: number }[] = [
    { rotulo: "Hoje 18:00", ms: hoje + 18 * 3_600_000 },
    { rotulo: "Amanhã 09:00", ms: hoje + DIA_MS + 9 * 3_600_000 },
    { rotulo: "Segunda 09:00", ms: proximo(agora, 1, 9) },
  ].filter((a) => a.ms > agora);

  return (
    <>
      <span ref={ancora} hidden />
      {createPortal(
        <div ref={caixa} data-tarefas-flutuante role="dialog" aria-label="Escolher prazo"
          className="prazo-pop" data-lado={pos?.cima ? "cima" : "baixo"}
          style={{ position: "fixed", top: pos?.top ?? -9999, left: pos?.left ?? -9999 }}>
          <div className="prazo-atalhos">
            {atalhos.map((a) => (
              <button key={a.rotulo} type="button" className="prazo-atalho" onClick={() => onEscolher(a.ms)}>{a.rotulo}</button>
            ))}
            {valor != null && <button type="button" className="prazo-atalho prazo-atalho-tirar" onClick={() => onEscolher(null)}>Sem prazo</button>}
          </div>
          <Calendario dia={dia} hoje={hoje} onDia={setDia} />
          <div className="rodas">
            <span className="rodas-faixa" aria-hidden />
            <Roda valores={HORAS} valor={horas} onChange={setHoras} rotulo="Hora" />
            <span className="rodas-sep" aria-hidden>:</span>
            <Roda valores={MINUTOS} valor={minutos} onChange={setMinutos} rotulo="Minuto" />
          </div>
          <div className="prazo-rodape">
            <span className={`prazo-resumo${passou ? " prazo-resumo-passou" : ""}`} aria-live="polite">
              {passou ? "Esse horário já passou" : new Date(prazo).toLocaleString("pt-BR", { weekday: "short", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}
            </span>
            <button type="button" className="prazo-definir" disabled={passou} onClick={() => onEscolher(prazo)}>Definir</button>
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
