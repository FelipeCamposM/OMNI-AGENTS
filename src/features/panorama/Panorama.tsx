import { Children, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import gsap from "gsap";
import { Button } from "../../components/ui/Button";
import { AgentIcon, AntigravityIcon, CursorIcon, GptIcon } from "../../components/ui/AgentIcon";
import { OmniLogo } from "../../components/ui/OmniLogo";
import {
  BlocksIcon, ChartLineIcon, CloseIcon, CodeIcon, EyeIcon, FileIcon, FileTextIcon, FolderIcon, GitBranchIcon,
  KanbanIcon, RobotIcon, SearchIcon, TerminalIcon,
} from "../../components/ui/PixelIcon";
import { shortcutFor } from "../../lib/shortcuts";
import { motionOn } from "../../lib/motion";
import { Mascote } from "../workspace/PainelVazio";
import type { TerminalSession } from "../terminal/terminalService";
import type { PaneKind, WorkspaceState } from "../../types/workspace";
import { montarPanorama, pedeAtencao, type Ilha } from "./panoramaModel";
import "./panorama.css";

const ESTADO: Record<string, string> = {
  working: "trabalhando", answered: "sua vez", approval_required: "pede aprovação", crashed: "caiu", orphan: "anterior", stopped: "parada",
};
const ICONE_DA_ABA: Partial<Record<PaneKind, typeof FileIcon>> = {
  agent: RobotIcon, terminal: TerminalIcon,
  markdown: FileTextIcon, "git-diff": GitBranchIcon, "git-graph": GitBranchIcon, kanban: KanbanIcon, fluxos: BlocksIcon, logs: ChartLineIcon, "docker-logs": ChartLineIcon, command: TerminalIcon,
};
const ZOOM_MIN = 0.3;
const ZOOM_MAX = 1.6;

export interface PanoramaProps {
  workspaces: WorkspaceState[];
  activeWorkspaceId: string | null;
  sessions: TerminalSession[];
  onSessao: (session: TerminalSession, workspaceId: string | null, projectId: string | null) => void;
  onProjeto: (workspaceId: string, projectId: string) => void;
  onAba: (workspaceId: string, projectId: string, paneId: string, tabId: string) => void;
  onWorkspace: (workspaceId: string) => void;
  onClose: () => void;
}

/** Cada agente com o seu jeito de se mexer: o Claude anda, o Codex gira, o Antigravity flutua, o
 *  Cursor pisca. Trabalhando, tudo acelera. */
function MascoteDoAgente({ provider, trabalhando }: { provider: string; trabalhando: boolean }) {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || !motionOn()) return;
    const tween = provider === "codex" ? gsap.to(el, { rotation: 360, duration: 4, ease: "none", repeat: -1 })
      : provider === "antigravity" ? gsap.fromTo(el, { y: 3 }, { y: -6, duration: 1.4, ease: "sine.inOut", repeat: -1, yoyo: true })
      : provider === "cursor" ? gsap.fromTo(el, { rotation: -8, scale: 0.94 }, { rotation: 8, scale: 1.06, duration: 0.9, ease: "sine.inOut", repeat: -1, yoyo: true })
      : gsap.fromTo(el, { y: 0 }, { y: -3, duration: 0.35, ease: "power1.out", repeat: -1, yoyo: true });
    tween.timeScale(trabalhando ? 2.2 : 1);
    return () => { tween.kill(); };
  }, [provider, trabalhando]);
  const corpo = provider === "claude" ? <Mascote />
    : provider === "codex" ? <GptIcon size={30} />
    : provider === "antigravity" ? <AntigravityIcon size={30} />
    : provider === "cursor" ? <CursorIcon size={30} />
    : <RobotIcon className="h-7 w-7" />;
  return (
    <span className={`pan-mascote is-${provider}`} aria-hidden>
      <span ref={ref} className="pan-mascote-corpo">{corpo}</span>
      {provider === "antigravity" && <span className="pan-sombra" />}
      {provider === "cursor" && <span className="pan-caret" />}
    </span>
  );
}

/** Cor de cada marca (RGB em canais, como os tokens do tema). Sem marca: a cor do tema. */
const MARCA: Record<string, string> = { claude: "217 119 87", antigravity: "66 133 244", codex: "180 190 210", cursor: "170 170 190" };

function NoDeSessao({ session, onClick }: { session: TerminalSession; onClick: () => void }) {
  const agente = Boolean(session.provider);
  const estado = ESTADO[session.state];
  const marca = session.provider ? MARCA[session.provider] : undefined;
  return (
    <button type="button" data-anima className={`pan-no is-${session.state}${agente ? " is-agente" : " is-terminal"}${pedeAtencao(session) ? " is-atencao" : ""}`}
      style={marca ? ({ "--marca": marca } as React.CSSProperties) : undefined}
      onClick={onClick} title={`Ir para ${session.name}`}>
      {agente ? <MascoteDoAgente provider={session.provider!} trabalhando={session.state === "working"} />
        : <span className="pan-terminal" aria-hidden><TerminalIcon className="h-5 w-5" /><span className="pan-caret" /></span>}
      <span className="pan-no-corpo">
        <span className="pan-no-titulo">{session.name || (agente ? "Agente" : "Terminal")}</span>
        <span className="pan-no-sub">
          {estado && <span className={`pan-estado is-${session.state}`}>{session.state === "working" && <span className="pan-ponto" />}{estado}</span>}
          {!agente && <span className="truncate">{session.shell.split(/[\\/]/).pop()}</span>}
        </span>
      </span>
      <span className="pan-no-ir" aria-hidden>›</span>
    </button>
  );
}

function IlhaDoProjeto({ ilha, props }: { ilha: Ilha; props: PanoramaProps }) {
  const vazia = !ilha.agentes.length && !ilha.terminais.length && !ilha.abas.length;
  const sessoes = [...ilha.agentes, ...ilha.terminais];
  const trabalhando = sessoes.filter((s) => s.state === "working").length;
  const pedindo = sessoes.filter(pedeAtencao).length;
  return (
    <section data-no={`ilha-${ilha.projectId}`} data-anima className={`pan-ilha${ilha.ativo ? " is-ativa" : ""}${trabalhando ? " is-quente" : ""}`}>
      <button type="button" className="pan-ilha-topo" onClick={() => props.onProjeto(ilha.workspaceId, ilha.projectId)} title={`Abrir ${ilha.caminho}`}>
        <span className="pan-pasta" aria-hidden><FolderIcon className="h-6 w-6" /></span>
        <span className="min-w-0 flex-1">
          <span className="pan-ilha-nome">{ilha.nome}</span>
          <span className="pan-ilha-caminho">{ilha.caminho}</span>
        </span>
      </button>
      <div className="pan-ilha-meta">
        {trabalhando > 0 && <span className="pan-contador is-quente"><span className="pan-ponto" />{trabalhando} trabalhando</span>}
        {pedindo > 0 && <span className="pan-contador is-alerta"><span className="pan-ponto" />{pedindo} pedindo você</span>}
        <span className="pan-contador" title="Agentes"><RobotIcon aria-hidden className="h-3 w-3" />{ilha.agentes.length}</span>
        <span className="pan-contador" title="Terminais"><TerminalIcon aria-hidden className="h-3 w-3" />{ilha.terminais.length}</span>
        <span className="pan-contador" title="Abas abertas"><FileIcon aria-hidden className="h-3 w-3" />{ilha.abas.length}</span>
        {ilha.branch && <span className="pan-contador pan-branch" title={`Branch ${ilha.branch}`}><GitBranchIcon aria-hidden className="h-3 w-3 shrink-0" /><span>{ilha.branch}</span></span>}
      </div>
      {vazia && <p className="pan-vazio">Nada aberto aqui.</p>}
      {ilha.agentes.length > 0 && <Grupo titulo="Agentes">{ilha.agentes.map((s) => (
        <NoDeSessao key={s.id} session={s} onClick={() => props.onSessao(s, ilha.workspaceId, ilha.projectId)} />
      ))}</Grupo>}
      {ilha.terminais.length > 0 && <Grupo titulo="Terminais">{ilha.terminais.map((s) => (
        <NoDeSessao key={s.id} session={s} onClick={() => props.onSessao(s, ilha.workspaceId, ilha.projectId)} />
      ))}</Grupo>}
      {ilha.abas.length > 0 && <Grupo titulo="Abas abertas" compacto>{ilha.abas.map(({ tab, paneId }) => {
        const Icone = ICONE_DA_ABA[tab.kind] ?? (tab.kind === "file" ? CodeIcon : FileIcon);
        return (
          <button key={tab.id} type="button" data-anima className="pan-aba" title={tab.resourceId ?? tab.title}
            onClick={() => props.onAba(ilha.workspaceId, ilha.projectId, paneId, tab.id)}>
            <Icone aria-hidden className="h-3.5 w-3.5 shrink-0" /><span className="truncate">{tab.title}</span>
          </button>
        );
      })}</Grupo>}
    </section>
  );
}

function Grupo({ titulo, compacto, children }: { titulo: string; compacto?: boolean; children: ReactNode }) {
  return (
    <div className="pan-grupo">
      <span className="pan-grupo-titulo">{titulo} <b>{Children.count(children)}</b></span>
      <div className={compacto ? "pan-abas" : "pan-nos"}>{children}</div>
    </div>
  );
}

/** Pastas e marcas soltas no fundo, à deriva. Decoração: fora do mundo, não mexem com o zoom. */
const DERIVA = [FolderIcon, ClaudeMini, FolderIcon, GptMini, FolderIcon, AntigravityMini, FolderIcon, CursorMini, FolderIcon, FolderIcon, ClaudeMini, FolderIcon];
function ClaudeMini() { return <AgentIcon provider="claude" size={22} />; }
function GptMini() { return <GptIcon size={22} />; }
function AntigravityMini() { return <AntigravityIcon size={22} />; }
function CursorMini() { return <CursorIcon size={22} />; }

function Deriva() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!ref.current || !motionOn()) return;
    const tweens = [...ref.current.children].map((el, i) => gsap.to(el, {
      x: `random(-60, 60)`, y: `random(-50, 50)`, rotation: `random(-25, 25)`,
      duration: 6 + (i % 5), ease: "sine.inOut", repeat: -1, yoyo: true, repeatRefresh: true, delay: i * 0.3,
    }));
    return () => tweens.forEach((t) => t.kill());
  }, []);
  return (
    <div ref={ref} className="pan-deriva" aria-hidden>
      {DERIVA.map((Icone, i) => (
        <span key={i} style={{ left: `${(i * 37 + 7) % 94}%`, top: `${(i * 53 + 11) % 88}%`, animationDelay: `${i * 0.4}s` }}>
          <Icone className="h-6 w-6" />
        </span>
      ))}
    </div>
  );
}

interface Aresta { id: string; d: string; quente: boolean }

/**
 * Tudo o que está acontecendo no OMNI num canvas: workspaces em colunas, cada projeto uma ilha com
 * os agentes (com mascote), terminais e abas abertas. Clicar leva até lá. Arraste para mover, role
 * para dar zoom. Fecha no X e no Esc, como as Configurações.
 */
export function Panorama(props: PanoramaProps) {
  const { workspaces, activeWorkspaceId, sessions, onClose } = props;
  const modelo = useMemo(() => montarPanorama(workspaces, activeWorkspaceId, sessions), [workspaces, activeWorkspaceId, sessions]);
  const palco = useRef<HTMLDivElement>(null);
  const mundo = useRef<HTMLDivElement>(null);
  const vista = useRef({ x: 0, y: 0, k: 1 });
  const [arestas, setArestas] = useState<Aresta[]>([]);
  const [zoom, setZoom] = useState(1);

  function aplicar() {
    const { x, y, k } = vista.current;
    if (mundo.current) mundo.current.style.transform = `translate(${x}px, ${y}px) scale(${k})`;
    setZoom(k);
  }

  function centralizar() {
    const p = palco.current, m = mundo.current;
    if (!p || !m) return;
    const k = Math.max(ZOOM_MIN, Math.min(1, (p.clientWidth - 80) / Math.max(1, m.offsetWidth), (p.clientHeight - 80) / Math.max(1, m.offsetHeight)));
    vista.current = { k, x: (p.clientWidth - m.offsetWidth * k) / 2, y: Math.max(24, (p.clientHeight - m.offsetHeight * k) / 2) };
    aplicar();
  }

  function zoomEm(fator: number, cx?: number, cy?: number) {
    const p = palco.current;
    if (!p) return;
    const { x, y, k } = vista.current;
    const nk = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, k * fator));
    const px = cx ?? p.clientWidth / 2, py = cy ?? p.clientHeight / 2;
    // O ponto sob o cursor fica parado: é o que faz o zoom parecer "ir até lá".
    vista.current = { k: nk, x: px - ((px - x) * nk) / k, y: py - ((py - y) * nk) / k };
    aplicar();
  }

  // Liga cada workspace ao hub e a cada ilha dele. Medido do DOM, porque o tamanho das ilhas depende
  // do que tem dentro. Pela posição de layout (`offset*`), não pela da tela: a entrada em cascata
  // desloca e encolhe os nós com transform, e medir no meio dela deixava as curvas terminando no ar.
  useLayoutEffect(() => {
    const m = mundo.current;
    if (!m) return;
    const medir = () => {
      const caixa = (id: string) => {
        const el = m.querySelector<HTMLElement>(`[data-no="${id}"]`);
        if (!el) return null;
        let x = 0, y = 0;
        for (let no: HTMLElement | null = el; no && no !== m; no = no.offsetParent as HTMLElement | null) { x += no.offsetLeft; y += no.offsetTop; }
        return { x, y, w: el.offsetWidth, h: el.offsetHeight };
      };
      const curva = (a: { x: number; y: number }, b: { x: number; y: number }) => {
        const meio = (a.y + b.y) / 2;
        return `M ${a.x} ${a.y} C ${a.x} ${meio}, ${b.x} ${meio}, ${b.x} ${b.y}`;
      };
      const hub = caixa("hub");
      const novas: Aresta[] = [];
      for (const r of modelo.regioes) {
        const ws = caixa(`ws-${r.workspace.id}`);
        if (!ws) continue;
        const quente = r.ilhas.some((i) => [...i.agentes, ...i.terminais].some((s) => s.state === "working"));
        if (hub) novas.push({ id: `hub-${r.workspace.id}`, d: curva({ x: hub.x + hub.w / 2, y: hub.y + hub.h }, { x: ws.x + ws.w / 2, y: ws.y }), quente });
        let de = { x: ws.x + ws.w / 2, y: ws.y + ws.h };
        for (const ilha of r.ilhas) {
          const c = caixa(`ilha-${ilha.projectId}`);
          if (!c) continue;
          const ate = { x: c.x + c.w / 2, y: c.y };
          novas.push({ id: `${r.workspace.id}-${ilha.projectId}`, d: curva(de, ate), quente: ilha.agentes.some((s) => s.state === "working") });
          de = { x: ate.x, y: c.y + c.h };
        }
      }
      // As sessões chegam por poll: sem isto, cada poll trocava o array e as faíscas recomeçavam.
      setArestas((atuais) => (JSON.stringify(atuais) === JSON.stringify(novas) ? atuais : novas));
    };
    medir();
    if (typeof ResizeObserver === "undefined") return;
    const obs = new ResizeObserver(medir);
    obs.observe(m);
    return () => obs.disconnect();
  }, [modelo]);

  // Entrada em cascata e enquadrar na primeira vez.
  useEffect(() => {
    centralizar();
    if (!mundo.current || !motionOn()) return;
    const ctx = gsap.context(() => {
      // `clearProps`: terminada a entrada, nada de transform inline sobrando no nó.
      const fim = { clearProps: "transform,opacity" };
      gsap.from(".pan-hub", { scale: 0.4, opacity: 0, duration: 0.6, ease: "back.out(2)", ...fim });
      gsap.from(".pan-ws", { y: -30, opacity: 0, duration: 0.5, stagger: 0.08, delay: 0.15, ease: "back.out(1.7)", ...fim });
      gsap.from("[data-anima]", { y: 24, scale: 0.9, opacity: 0, duration: 0.55, stagger: 0.025, delay: 0.25, ease: "back.out(1.5)", ...fim });
    }, mundo);
    return () => ctx.revert();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Faíscas correndo pelas ligações: um ponto por aresta, mais rápido onde tem agente trabalhando.
  const faiscas = useRef<SVGGElement>(null);
  // Relógio único: se as ligações mudam, cada faísca segue de onde estava em vez de voltar ao início.
  const inicio = useRef(performance.now()).current;
  useEffect(() => {
    const g = faiscas.current;
    if (!g || !motionOn()) return;
    let quadro = 0;
    const passo = (agora: number) => {
      const caminhos = g.parentElement?.querySelectorAll<SVGPathElement>("path[data-aresta]") ?? [];
      const pontos = g.children;
      caminhos.forEach((p, i) => {
        const ponto = pontos[i] as SVGCircleElement | undefined;
        if (!ponto || typeof p.getTotalLength !== "function") return;
        const total = p.getTotalLength();
        if (!total) return;
        // Velocidade em px/s (não em voltas): curva longa e curta andam no mesmo ritmo.
        const vel = p.dataset.quente === "1" ? 420 : 220;
        const pt = p.getPointAtLength((((agora - inicio) / 1000) * vel + i * 97) % total);
        ponto.setAttribute("cx", String(pt.x));
        ponto.setAttribute("cy", String(pt.y));
      });
      quadro = requestAnimationFrame(passo);
    };
    quadro = requestAnimationFrame(passo);
    return () => cancelAnimationFrame(quadro);
  }, [arestas]);

  // Arrastar o fundo move; a roda dá zoom no ponto do cursor.
  useEffect(() => {
    const p = palco.current;
    if (!p) return;
    const roda = (e: WheelEvent) => {
      e.preventDefault();
      const r = p.getBoundingClientRect();
      zoomEm(e.deltaY < 0 ? 1.1 : 1 / 1.1, e.clientX - r.left, e.clientY - r.top);
    };
    p.addEventListener("wheel", roda, { passive: false });
    return () => p.removeEventListener("wheel", roda);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const arrasto = useRef<{ x: number; y: number } | null>(null);

  const { totais } = modelo;
  const kpis = [
    { rotulo: "agentes", valor: totais.agentes, icone: <RobotIcon className="h-3.5 w-3.5" /> },
    { rotulo: "trabalhando", valor: totais.trabalhando, quente: totais.trabalhando > 0 },
    { rotulo: "pedindo você", valor: totais.pedindo, alerta: totais.pedindo > 0 },
    { rotulo: "terminais", valor: totais.terminais, icone: <TerminalIcon className="h-3.5 w-3.5" /> },
    { rotulo: "projetos", valor: totais.projetos, icone: <FolderIcon className="h-3.5 w-3.5" /> },
    { rotulo: "abas", valor: totais.abas, icone: <FileIcon className="h-3.5 w-3.5" /> },
  ];

  return (
    <div className="pan">
      <header className="settings-topo glass">
        <span className="settings-topo-icone" aria-hidden><EyeIcon className="h-5 w-5" /></span>
        <div className="min-w-0 flex-1">
          <h1 className="pixel-text text-text-primary text-base">Panorama</h1>
          <p className="text-text-secondary text-xs">Tudo o que está aberto e rodando no OMNI. Clique para ir até lá.</p>
        </div>
        <ul className="pan-kpis" aria-label="Resumo">
          {kpis.map((k) => (
            <li key={k.rotulo} className={`pan-kpi${k.quente ? " is-quente" : ""}${k.alerta ? " is-alerta" : ""}`}>
              {k.icone ?? <span className="pan-ponto" />}
              <strong>{k.valor}</strong><span>{k.rotulo}</span>
            </li>
          ))}
        </ul>
        <Button size="sm" variant="ghost" onClick={onClose} aria-label="Fechar panorama" title={`Fechar panorama (${shortcutFor("closeSettings")})`}>
          <CloseIcon className="h-3.5 w-3.5" aria-hidden="true" />
          Fechar
        </Button>
      </header>

      <div ref={palco} className="pan-palco"
        onPointerDown={(e) => {
          if ((e.target as HTMLElement).closest("button")) return;
          arrasto.current = { x: e.clientX - vista.current.x, y: e.clientY - vista.current.y };
          e.currentTarget.setPointerCapture?.(e.pointerId);
          e.currentTarget.classList.add("is-arrastando");
        }}
        onPointerMove={(e) => {
          if (!arrasto.current) return;
          vista.current = { ...vista.current, x: e.clientX - arrasto.current.x, y: e.clientY - arrasto.current.y };
          aplicar();
        }}
        onPointerUp={(e) => { arrasto.current = null; e.currentTarget.classList.remove("is-arrastando"); }}
        onPointerCancel={(e) => { arrasto.current = null; e.currentTarget.classList.remove("is-arrastando"); }}>
        <Deriva />

        <div ref={mundo} className="pan-mundo">
          <svg className="pan-arestas" aria-hidden>
            {arestas.map((a) => <path key={a.id} data-aresta data-quente={a.quente ? "1" : "0"} d={a.d} className={a.quente ? "is-quente" : undefined} />)}
            <g ref={faiscas}>{arestas.map((a) => <circle key={a.id} r={3} className={a.quente ? "is-quente" : undefined} />)}</g>
          </svg>

          <div data-no="hub" className="pan-hub">
            <OmniLogo className="neon-glow h-8 w-8" />
            <span className="pixel-text">OMNI AGENTS</span>
          </div>

          <div className="pan-regioes">
            {modelo.regioes.map((r) => (
              <div key={r.workspace.id} className="pan-regiao">
                <button type="button" data-no={`ws-${r.workspace.id}`} onClick={() => props.onWorkspace(r.workspace.id)}
                  className={`pan-ws${r.ativo ? " is-ativo" : ""}${r.workspace.hidden ? " is-escondido" : ""}`}
                  title={r.workspace.hidden ? "Workspace fechado: clique para reabrir" : `Ir para ${r.workspace.name}`}>
                  <BlocksIcon aria-hidden className="h-4 w-4" />
                  {r.workspace.name}
                  {r.workspace.hidden && <span className="pan-tag">fechado</span>}
                  {r.ativo && <span className="pan-tag is-ativo">aqui</span>}
                </button>
                {r.ilhas.length === 0 && <p className="pan-vazio">Sem projetos.</p>}
                {r.ilhas.map((ilha) => <IlhaDoProjeto key={ilha.projectId} ilha={ilha} props={props} />)}
              </div>
            ))}
            {modelo.soltas.length > 0 && (
              <div className="pan-regiao">
                <span data-no="ws-soltas" className="pan-ws is-escondido"><SearchIcon aria-hidden className="h-4 w-4" />Fora dos workspaces</span>
                <section data-anima className="pan-ilha">
                  <Grupo titulo="Sessões de projetos fechados">{modelo.soltas.map((s) => (
                    <NoDeSessao key={s.id} session={s} onClick={() => props.onSessao(s, null, null)} />
                  ))}</Grupo>
                </section>
              </div>
            )}
          </div>
          {modelo.regioes.length === 0 && <p className="pan-vazio">Nenhum workspace ainda. Crie um na lateral.</p>}
        </div>

        <div className="pan-controles" onPointerDown={(e) => e.stopPropagation()}>
          <button type="button" aria-label="Diminuir zoom" onClick={() => zoomEm(1 / 1.2)}>−</button>
          <span>{Math.round(zoom * 100)}%</span>
          <button type="button" aria-label="Aumentar zoom" onClick={() => zoomEm(1.2)}>+</button>
          <button type="button" onClick={centralizar}>Centralizar</button>
        </div>
        <p className="pan-dica">Arraste para mover · role para zoom</p>
      </div>
    </div>
  );
}
