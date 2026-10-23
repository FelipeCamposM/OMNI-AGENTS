import { useEffect, useLayoutEffect, useRef, useState } from "react";
import gsap from "gsap";
import { AgentIcon } from "../components/ui/AgentIcon";
import { ChartIcon, ChevronDownIcon, ReloadIcon } from "../components/ui/PixelIcon";
import { AGENTES_COM_USO, request } from "../mobile/api";
import { usePoll } from "../mobile/usePoll";
import { resetShort, usageTone, type UsageWindow } from "../lib/uso";
import { motionOn } from "../lib/motion";
import "./uso.css";

interface Conta {
  id: string;
  provider: string;
  name: string;
  usage: { status: string; primary: UsageWindow | null; secondary: UsageWindow | null; reason: string | null } | null;
}

const AGENTE: Record<string, string> = { claude: "Claude", codex: "Codex", antigravity: "Antigravity", cursor: "Cursor" };

/** O uso muda devagar (o PC relê a cada poucos minutos): um minuto entre leituras basta. */
const INTERVALO_MS = 60_000;

function Janela({ rotulo, janela }: { rotulo: string; janela: UsageWindow | null }) {
  if (!janela) return <span className="w-uso-janela"><span>{rotulo}</span><span className="w-uso-pct">—</span></span>;
  const usado = Math.min(100, Math.max(0, janela.used_percent));
  const tom = usageTone(janela.used_percent);
  const reset = resetShort(janela);
  return (
    <span className="w-uso-janela" title={reset ? `${rotulo}: reseta ${reset}` : undefined}>
      <span>{rotulo}</span>
      <span role="progressbar" aria-label={`${rotulo} consumido`} aria-valuenow={Math.round(usado)} aria-valuemin={0} aria-valuemax={100}
        className="w-uso-barra">
        <span className={`w-uso-preenchido ${tom.bar}`} style={{ width: `${usado}%` }} />
      </span>
      <span className={`w-uso-pct ${tom.text}`} data-valor={janela.used_percent}>{janela.used_percent.toLocaleString("pt-BR")}%</span>
    </span>
  );
}

/**
 * Uso de cada conta, como o rodapé do app do PC: janela de 5 h e semanal, com as mesmas cores (verde
 * até 60%, amarelo até 85%, vermelho acima). A conta da conversa aberta vem destacada.
 * Com `daConversa`, mostra só a conta que a conversa usa (sem conta escolhida, as do agente dela).
 */
export function UsoDasContas({ contaAtiva, daConversa, animar = false }: {
  contaAtiva: string | null;
  daConversa?: { profileId: string | null; provider: string | null };
  /** No popover do topo: cartões entram em cascata, barras enchem e números sobem do zero. */
  animar?: boolean;
}) {
  const lista = useRef<HTMLUListElement>(null);
  const [contas, setContas] = useState<Conta[]>([]);
  const [atualizando, setAtualizando] = useState<Set<string>>(new Set());
  const [erros, setErros] = useState<Record<string, string>>({});

  /** Pede ao PC uma leitura nova. No Claude o PC consulta o `/usage` — leva alguns segundos. */
  async function atualizar(id: string) {
    setAtualizando((atual) => new Set(atual).add(id));
    setErros(({ [id]: _, ...resto }) => resto);
    try {
      const nova = await request<Conta>(`/contas/${encodeURIComponent(id)}/uso`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
        signal: AbortSignal.timeout(90_000),
      });
      setContas((lista) => lista.map((conta) => (conta.id === id ? { ...conta, usage: nova.usage } : conta)));
    } catch (motivo) {
      setErros((atual) => ({ ...atual, [id]: motivo instanceof Error ? motivo.message : String(motivo) }));
    } finally {
      setAtualizando((atual) => { const novo = new Set(atual); novo.delete(id); return novo; });
    }
  }
  usePoll(async () => {
    const lista = await request<Conta[]>("/contas");
    setContas(Array.isArray(lista) ? lista : []);
  }, () => undefined, [], INTERVALO_MS);

  const temContas = contas.length > 0;
  // Uma vez, quando as contas chegam: depois, as trocas de valor só deslizam pela transição do CSS.
  useLayoutEffect(() => {
    const raiz = lista.current;
    if (!animar || !raiz || !motionOn()) return;
    const ctx = gsap.context(() => {
      gsap.from(".w-uso-conta", { x: 18, opacity: 0, duration: 0.5, ease: "expo.out", stagger: 0.06, clearProps: "transform,opacity" });
      gsap.from(".w-uso-preenchido", { scaleX: 0, transformOrigin: "left center", duration: 0.9, ease: "power3.out", stagger: 0.05, delay: 0.12, clearProps: "transform" });
      raiz.querySelectorAll<HTMLElement>(".w-uso-pct[data-valor]").forEach((el, i) => {
        const final = Number(el.dataset.valor);
        const contador = { v: 0 };
        gsap.to(contador, { v: final, duration: 0.9, delay: 0.12 + i * 0.05, ease: "power3.out",
          onUpdate: () => { el.textContent = `${Math.round(contador.v)}%`; },
          onComplete: () => { el.textContent = `${final.toLocaleString("pt-BR")}%`; } });
      });
      gsap.from(".w-uso-atualizar", { opacity: 0, y: 4, duration: 0.4, delay: 0.35, stagger: 0.04, clearProps: "transform,opacity" });
    }, raiz);
    return () => ctx.revert();
  }, [animar, temContas]); // eslint-disable-line react-hooks/exhaustive-deps

  const visiveis = !daConversa ? contas : contas.filter((conta) => daConversa.profileId
    ? conta.id === daConversa.profileId : conta.provider === daConversa.provider);
  if (visiveis.length === 0) return null;
  // Claude, Codex e Antigravity sabem reler o uso na hora; o Cursor não tem leitura.
  const atualizaveis = visiveis.filter((conta) => AGENTES_COM_USO.includes(conta.provider));
  const todasLendo = atualizaveis.length > 0 && atualizaveis.every((conta) => atualizando.has(conta.id));
  return (
    <>
      {!daConversa && <div className="w-uso-cabecalho">
        <h2 className="w-rotulo">Uso das contas</h2>
        {atualizaveis.length > 1 && (
          <button type="button" className="w-uso-atualizar" disabled={todasLendo} title="Buscar o uso de todas as contas de uma vez"
            onClick={() => atualizaveis.forEach((conta) => { if (!atualizando.has(conta.id)) void atualizar(conta.id); })}>
            <ReloadIcon aria-hidden className={`h-3 w-3${todasLendo ? " anexo-girando" : ""}`} />
            <span>{todasLendo ? "Lendo…" : "Atualizar todas"}</span>
          </button>
        )}
      </div>}
      <ul ref={lista} className={`w-uso${animar ? " is-animado" : ""}`}>
        {visiveis.map((conta) => (
          <li key={conta.id} className={`w-uso-conta${conta.id === contaAtiva ? " w-uso-conta-ativa" : ""}`}>
            <span className="w-uso-nome">
              <AgentIcon provider={conta.provider} size={12} className="shrink-0" />
              <span className="w-uso-texto">{conta.name}</span>
              <span className="w-uso-agente">{AGENTE[conta.provider] ?? conta.provider}</span>
            </span>
            {erros[conta.id] && <span className="w-uso-vazio w-uso-erro" role="alert">{erros[conta.id]}</span>}
            {conta.usage && conta.usage.status !== "unavailable" ? (
              <>
                <Janela rotulo="5H" janela={conta.usage.primary} />
                <Janela rotulo="Semana" janela={conta.usage.secondary} />
              </>
            ) : (
              <span className="w-uso-vazio">{conta.usage?.reason ?? "Sem leitura de uso ainda"}</span>
            )}
            {AGENTES_COM_USO.includes(conta.provider) && (
              <button type="button" className="w-uso-atualizar" disabled={atualizando.has(conta.id)}
                aria-label={`Atualizar uso de ${conta.name}`} title="Buscar o uso de novo"
                onClick={() => void atualizar(conta.id)}>
                <ReloadIcon aria-hidden className={`h-3 w-3${atualizando.has(conta.id) ? " anexo-girando" : ""}`} />
                <span>{atualizando.has(conta.id) ? "Lendo…" : "Atualizar"}</span>
              </button>
            )}
          </li>
        ))}
      </ul>
    </>
  );
}

function Mini({ rotulo, janela }: { rotulo: string; janela: UsageWindow | null }) {
  if (!janela) return null;
  const usado = Math.min(100, Math.max(0, janela.used_percent));
  const tom = usageTone(janela.used_percent);
  const reset = resetShort(janela);
  return (
    <span className="w-topo-uso-janela" title={reset ? `${rotulo}: reseta ${reset}` : rotulo}>
      <span className="w-topo-uso-rotulo">{rotulo}</span>
      <span className="w-topo-uso-barra" aria-hidden><span className={`w-uso-preenchido ${tom.bar}`} style={{ width: `${usado}%` }} /></span>
      <span className={`w-topo-uso-pct ${tom.text}`}>{Math.round(janela.used_percent)}%</span>
    </span>
  );
}

/**
 * Uso no cabeçalho: a conta da conversa aberta (nome, 5 h e semana) e um botão que abre o uso de
 * todas as contas por cima da página. Sem conversa aberta, só o botão.
 */
export function UsoNoTopo({ profileId, provider }: { profileId: string | null; provider: string | null }) {
  const [contas, setContas] = useState<Conta[]>([]);
  const [aberto, setAberto] = useState(false);
  const caixa = useRef<HTMLDivElement>(null);
  usePoll(async () => {
    const lista = await request<Conta[]>("/contas");
    setContas(Array.isArray(lista) ? lista : []);
  }, () => undefined, [], INTERVALO_MS);
  useEffect(() => {
    if (!aberto) return;
    const fora = (evento: PointerEvent) => { if (!caixa.current?.contains(evento.target as Node)) setAberto(false); };
    const tecla = (evento: KeyboardEvent) => { if (evento.key === "Escape") setAberto(false); };
    window.addEventListener("pointerdown", fora);
    window.addEventListener("keydown", tecla);
    return () => { window.removeEventListener("pointerdown", fora); window.removeEventListener("keydown", tecla); };
  }, [aberto]);

  const conta = profileId ? contas.find((c) => c.id === profileId) : provider ? contas.find((c) => c.provider === provider) : undefined;
  const uso = conta?.usage && conta.usage.status !== "unavailable" ? conta.usage : null;
  // Popover abre crescendo do botão; o chip pisca de leve quando a leitura muda.
  const pop = useRef<HTMLDivElement>(null);
  const botao = useRef<HTMLButtonElement>(null);
  useLayoutEffect(() => {
    if (!aberto || !pop.current || !motionOn()) return;
    const t = gsap.fromTo(pop.current, { opacity: 0, scale: 0.94, y: -8, transformOrigin: "top right" },
      { opacity: 1, scale: 1, y: 0, duration: 0.38, ease: "expo.out", clearProps: "transform,opacity" });
    return () => { t.kill(); };
  }, [aberto]);
  const leitura = `${conta?.id}:${uso?.primary?.used_percent}:${uso?.secondary?.used_percent}`;
  const primeira = useRef(true);
  useEffect(() => {
    if (primeira.current) { primeira.current = false; return; }
    if (!botao.current || !motionOn()) return;
    const t = gsap.fromTo(botao.current, { boxShadow: "0 0 0 0 rgb(var(--c-accent) / .0)" },
      { boxShadow: "0 0 18px 2px rgb(var(--c-accent) / .55)", duration: 0.35, yoyo: true, repeat: 1, ease: "power2.out", clearProps: "boxShadow" });
    return () => { t.kill(); };
  }, [leitura]);
  return (
    <div ref={caixa} className="w-topo-uso">
      <button ref={botao} type="button" className={`w-topo-uso-botao${aberto ? " is-aberto" : ""}`} aria-expanded={aberto}
        aria-label="Uso das contas" title="Ver o uso de todas as contas" onClick={() => setAberto((a) => !a)}>
        {conta ? (
          <>
            <AgentIcon provider={conta.provider} size={14} className="shrink-0" />
            <span className="w-topo-uso-nome">{conta.name}</span>
            {uso ? <><Mini rotulo="5H" janela={uso.primary} /><Mini rotulo="Sem" janela={uso.secondary} /></>
              : <span className="w-topo-uso-sem">sem leitura</span>}
          </>
        ) : <><ChartIcon aria-hidden className="h-3.5 w-3.5" /><span className="w-topo-uso-nome">Uso das contas</span></>}
        <ChevronDownIcon aria-hidden className="w-topo-uso-seta h-3 w-3" />
      </button>
      {aberto && (
        <div ref={pop} className="w-topo-uso-pop glass glass-strong" role="dialog" aria-label="Uso de todas as contas">
          <UsoDasContas contaAtiva={conta?.id ?? null} animar />
        </div>
      )}
    </div>
  );
}
