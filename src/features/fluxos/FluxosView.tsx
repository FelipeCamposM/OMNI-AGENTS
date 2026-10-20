import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Background, BackgroundVariant, ConnectionLineType, Controls, MarkerType, MiniMap, ReactFlow, ReactFlowProvider, useReactFlow,
  type Connection, type EdgeChange, type FinalConnectionState, type NodeChange,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { Button, Field, Input, Select, Textarea } from "../../components/ui";
import { AgentIcon } from "../../components/ui/AgentIcon";
import { BookIcon, CloseIcon, CopyIcon, FolderIcon, PlayIcon, ReloadIcon, SparkleIcon, StopIcon, TrashIcon } from "../../components/ui/PixelIcon";
import {
  criarComIa, listarAgentes, listarModelos, nomeDeArquivo, ROTULO_ESFORCO, salvarAgente,
  type AgenteSalvo, type CliDoAgente, type ModeloDaCli,
} from "../agentes/agentesService";
import { SeletorDeModelo } from "../agentes/ModelosDeAgentes";
import { ManualDeAgentes } from "../agentes/ManualDeAgentes";
import { ArestaDoFluxo, type ArestaOmni } from "./ArestaDoFluxo";
import { NoDoFluxoView, type NoOmni } from "./NoDoFluxo";
import {
  abrirConversaDoNo, acaoNaExecucao, apagarFluxo, aprovarNo, criarFluxoComIa, etapasDoFluxo, fluxoVazio, historicoDoNo, iniciarExecucao,
  lerJsonDeFluxo, listarExecucoes, listarFluxos, obterExecucao, salvarFluxo, TIPOS, validarFluxo,
  type Execucao, type Fluxo, type FluxoGerado, type FluxoSalvo, type ItemDoHistorico, type NoDoFluxo, type ResumoDaExecucao, type TipoDeNo,
} from "./fluxosService";

const tiposDeNo = { omni: NoDoFluxoView };
const tiposDeAresta = { omni: ArestaDoFluxo };
const erroDe = (e: unknown) => (e instanceof Error ? e.message : String(e));
const STATUS_EXEC: Record<string, string> = { rodando: "Rodando", pausado: "Pausado", aguardando: "Esperando você", concluido: "Concluído", falhou: "Falhou", cancelado: "Cancelado" };
const COR_SAIDA: Record<string, string> = { sim: "#22c55e", nao: "#ef4444", esgotado: "#eab308" };
const NOME_TIPO: Record<TipoDeNo, string> = { entrada: "Entrada", agente: "Agente", condicao: "Condição", aprovacao: "Aprovação", sala: "Time", pr: "Pull request", fim: "Fim" };
const duracao = (ms: number) => { const s = Math.max(0, Math.round(ms / 1000)); return s < 60 ? `${s}s` : s < 3600 ? `${Math.floor(s / 60)}min ${s % 60}s` : `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}min`; };

interface Props {
  projectId: string | null;
  projectPath: string | null;
  /** Abre uma sessão já criada pelo engine numa aba do workspace (conversa de um nó). */
  onAbrirSessao: (sessionId: string, titulo: string) => void;
  onClose: () => void;
}

/**
 * Fluxos de agentes, no estilo n8n: à esquerda os fluxos salvos e as execuções; no centro o canvas
 * (editável, ou ao vivo durante uma execução); à direita o nó selecionado — configuração no editor,
 * histórico e ações na execução — ou, sem nó, o resumo da execução.
 */
export function FluxosView(props: Props) {
  // `fx-caixa`: container das consultas de largura — o editor vive em tela cheia ou num painel dividido.
  return <div className="fx-caixa"><ReactFlowProvider><Fluxos {...props} /></ReactFlowProvider></div>;
}

interface MenuRapido { x: number; y: number; de: string; saida?: string }

function Fluxos({ projectId, projectPath, onAbrirSessao, onClose }: Props) {
  const [fluxos, setFluxos] = useState<FluxoSalvo[]>([]);
  const [agentes, setAgentes] = useState<AgenteSalvo[]>([]);
  const [modelos, setModelos] = useState<Partial<Record<CliDoAgente, ModeloDaCli[]>>>({});
  const [execucoes, setExecucoes] = useState<ResumoDaExecucao[]>([]);
  const [rascunho, setRascunho] = useState<Fluxo | null>(null);
  const [origem, setOrigem] = useState<{ escopo: "global" | "projeto"; id?: string } | null>(null);
  const [escopo, setEscopo] = useState<"global" | "projeto">("global");
  const [sujo, setSujo] = useState(false);
  const [execucaoId, setExecucaoId] = useState<string | null>(null);
  const [execucao, setExecucao] = useState<Execucao | null>(null);
  const [selecionado, setSelecionado] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [iniciando, setIniciando] = useState(false);
  const [dialogo, setDialogo] = useState<"executar" | "ia" | "json" | null>(null);
  const [manual, setManual] = useState(false);
  const [menu, setMenu] = useState<MenuRapido | null>(null);
  const { screenToFlowPosition, fitView } = useReactFlow();
  const canvas = useRef<HTMLDivElement>(null);

  const recarregar = useCallback(async () => {
    try {
      const [f, a] = await Promise.all([listarFluxos(projectPath), listarAgentes(projectPath)]);
      setFluxos(f); setAgentes(a);
    } catch (e) { setErro(erroDe(e)); }
  }, [projectPath]);
  useEffect(() => { void recarregar(); }, [recarregar]);
  useEffect(() => { listarModelos().then(setModelos).catch(() => undefined); }, []);

  // Execuções: a lista anda devagar; a aberta, rápido enquanto está viva.
  useEffect(() => {
    let vivo = true;
    const ler = () => listarExecucoes().then((l) => { if (vivo) setExecucoes(l); }).catch(() => undefined);
    void ler();
    const t = window.setInterval(ler, 4000);
    return () => { vivo = false; window.clearInterval(t); };
  }, []);
  useEffect(() => {
    if (!execucaoId) { setExecucao(null); return; }
    let vivo = true;
    const ler = () => obterExecucao(execucaoId).then((x) => { if (vivo) setExecucao(x); }).catch((e) => vivo && setErro(erroDe(e)));
    void ler();
    const t = window.setInterval(ler, 1500);
    return () => { vivo = false; window.clearInterval(t); };
  }, [execucaoId]);

  const fluxoNaTela = execucao?.fluxo ?? rascunho;
  const emExecucao = Boolean(execucao);
  const agentePorNome = useCallback((nome?: string) => agentes.find((a) => a.name === nome && a.escopo === "projeto") ?? agentes.find((a) => a.name === nome), [agentes]);

  // Execução: centraliza no nó que está trabalhando (ou esperando você) quando ele muda.
  const noVivo = execucao ? Object.entries(execucao.nos).find(([, n]) => n.status === "rodando" || n.status === "aguardando")?.[0] : undefined;
  useEffect(() => {
    if (!noVivo) return;
    const t = window.setTimeout(() => fitView({ nodes: [{ id: noVivo }], padding: 1.2, maxZoom: 1, minZoom: 0.85, duration: 400 }), 80);
    return () => window.clearTimeout(t);
  }, [noVivo, execucaoId, fitView]);

  function mudarRascunho(f: (r: Fluxo) => Fluxo) { setRascunho((r) => (r ? f(r) : r)); setSujo(true); }

  const duplicarNo = useCallback((id: string) => {
    mudarRascunho((r) => {
      const no = r.nos.find((n) => n.id === id);
      if (!no) return r;
      let n = 2; while (r.nos.some((x) => x.id === `${id}-${n}`)) n += 1;
      const copia = { ...structuredClone(no), id: `${id}-${n}`, x: no.x + 40, y: no.y + 140, titulo: `${no.titulo} (cópia)` };
      setSelecionado(copia.id);
      return { ...r, nos: [...r.nos, copia] };
    });
  }, []);
  const apagarNo = useCallback((id: string) => {
    mudarRascunho((r) => ({ ...r, nos: r.nos.filter((n) => n.id !== id || n.tipo === "entrada"), conexoes: r.conexoes.filter((c) => c.de !== id && c.para !== id) }));
    setSelecionado((s) => (s === id ? null : s));
  }, []);

  const nodes: NoOmni[] = useMemo(() => (fluxoNaTela?.nos ?? []).map((no) => {
    const agente = agentePorNome(no.agente);
    const estado = execucao?.nos[no.id];
    return {
      id: no.id, type: "omni", position: { x: no.x, y: no.y }, selected: no.id === selecionado,
      deletable: !emExecucao && no.tipo !== "entrada", draggable: !emExecucao,
      data: {
        no, estado, cli: estado?.cli ?? agente?.cli,
        modelo: estado?.modelo ?? (String(no.config.modelo ?? "") || agente?.modelo || undefined),
        esforco: estado?.esforco ?? (String(no.config.esforco ?? "") || agente?.esforco || undefined),
        ...(emExecucao ? {} : { onDuplicar: duplicarNo, onApagar: apagarNo }),
      },
    };
  }), [fluxoNaTela, selecionado, emExecucao, execucao, agentePorNome, duplicarNo, apagarNo]);

  const edges: ArestaOmni[] = useMemo(() => (fluxoNaTela?.conexoes ?? []).map((c) => {
    const destino = execucao?.nos[c.para];
    const percorrida = execucao && execucao.nos[c.de]?.status === "concluido" && (!c.saida || execucao.nos[c.de]?.caminho === c.saida);
    return {
      id: `${c.de}|${c.saida ?? ""}|${c.para}`, type: "omni", source: c.de, target: c.para, sourceHandle: c.saida || "out",
      animated: destino?.status === "rodando", deletable: !emExecucao,
      markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16, color: c.saida ? COR_SAIDA[c.saida] : percorrida ? "#f97316" : "#6b6b85" },
      data: { saida: c.saida, editavel: !emExecucao, viva: Boolean(percorrida) },
    };
  }), [fluxoNaTela, execucao, emExecucao]);

  const onNodesChange = useCallback((changes: NodeChange<NoOmni>[]) => {
    for (const ch of changes) {
      if (ch.type === "select" && ch.selected) setSelecionado(ch.id);
      if (emExecucao) continue;
      if (ch.type === "position" && ch.position) {
        const { x, y } = ch.position;
        mudarRascunho((r) => ({ ...r, nos: r.nos.map((n) => (n.id === ch.id ? { ...n, x: Math.round(x), y: Math.round(y) } : n)) }));
      }
      if (ch.type === "remove") apagarNo(ch.id);
    }
  }, [emExecucao, apagarNo]);

  const onEdgesChange = useCallback((changes: EdgeChange<ArestaOmni>[]) => {
    if (emExecucao) return;
    for (const ch of changes) {
      if (ch.type !== "remove") continue;
      const [de, saida, para] = ch.id.split("|");
      mudarRascunho((r) => ({ ...r, conexoes: r.conexoes.filter((c) => !(c.de === de && (c.saida ?? "") === saida && c.para === para)) }));
    }
  }, [emExecucao]);

  const ligar = useCallback((de: string, para: string, handle?: string | null) => {
    const saida = !handle || handle === "out" ? undefined : handle;
    mudarRascunho((r) => r.conexoes.some((x) => x.de === de && x.para === para && (x.saida ?? "") === (saida ?? "")) ? r
      : { ...r, conexoes: [...r.conexoes, { de, para, ...(saida ? { saida } : {}) }] });
  }, []);

  const onConnect = useCallback((c: Connection) => { if (!emExecucao && c.source && c.target) ligar(c.source, c.target, c.sourceHandle); }, [emExecucao, ligar]);
  // Soltar a conexão no vazio abre o menu para criar a próxima etapa já ligada (como no n8n).
  const onConnectEnd = useCallback((evento: MouseEvent | TouchEvent, estado: FinalConnectionState) => {
    if (emExecucao || estado.isValid || !estado.fromNode || estado.fromHandle?.type !== "source") return;
    const ponto = "changedTouches" in evento ? evento.changedTouches[0] : evento;
    const caixa = canvas.current?.getBoundingClientRect();
    setMenu({ x: ponto.clientX - (caixa?.left ?? 0), y: ponto.clientY - (caixa?.top ?? 0), de: estado.fromNode.id, saida: estado.fromHandle.id ?? undefined });
  }, [emExecucao]);

  function abrirFluxo(f: Fluxo | null, info?: { escopo: "global" | "projeto"; id?: string }) {
    const base = f ? { id: f.id, nome: f.nome, descricao: f.descricao, nos: f.nos, conexoes: f.conexoes } : fluxoVazio();
    setRascunho(structuredClone(base));
    setOrigem(info ?? null);
    setEscopo(info?.escopo ?? "global");
    setExecucaoId(null); setSelecionado(null); setSujo(!info?.id); setErro(null); setMenu(null);
    // Abre no começo do fluxo, numa escala legível — o resto fica a um arraste (ou no minimapa).
    window.setTimeout(() => fitView({ nodes: base.nos.slice(0, 3).map((n) => ({ id: n.id })), padding: 0.2, maxZoom: 1, minZoom: 0.85, duration: 300 }), 60);
  }

  function criarNo(tipo: TipoDeNo, posicao?: { x: number; y: number }): NoDoFluxo | null {
    if (!rascunho) return null;
    const caixa = canvas.current?.getBoundingClientRect();
    const centro = posicao ?? screenToFlowPosition({ x: (caixa?.left ?? 0) + (caixa?.width ?? 800) / 2, y: (caixa?.top ?? 0) + (caixa?.height ?? 500) / 2 });
    let n = 1; while (rascunho.nos.some((x) => x.id === `${tipo}-${n}`)) n += 1;
    const nomes = [...new Set(agentes.map((a) => a.name))];
    const novo: NoDoFluxo = {
      id: `${tipo}-${n}`, tipo, titulo: NOME_TIPO[tipo], x: Math.round(centro.x - 110), y: Math.round(centro.y - 40),
      agente: tipo === "agente" ? nomes[0] ?? "" : undefined,
      config: tipo === "condicao" ? { max_voltas: 3 } : tipo === "sala" ? { participantes: nomes.slice(0, 3), rodadas: 3, objetivo: "{{entrada}}" } : tipo === "aprovacao" ? { pergunta: "Continuar?" } : {},
    };
    mudarRascunho((r) => ({ ...r, nos: [...r.nos, novo] }));
    setSelecionado(novo.id);
    return novo;
  }

  function escolherDoMenu(tipo: TipoDeNo) {
    if (!menu) return;
    const caixa = canvas.current?.getBoundingClientRect();
    const pos = screenToFlowPosition({ x: menu.x + (caixa?.left ?? 0) + 110, y: menu.y + (caixa?.top ?? 0) + 40 });
    const novo = criarNo(tipo, pos);
    if (novo) ligar(menu.de, novo.id, menu.saida);
    setMenu(null);
  }

  async function salvar() {
    if (!rascunho) return;
    const fluxo = { ...rascunho, id: rascunho.id || nomeDeArquivo(rascunho.nome) };
    try {
      await validarFluxo(fluxo);
      await salvarFluxo(escopo, projectPath, fluxo, origem?.escopo === escopo ? origem.id : undefined);
      if (origem?.id && origem.escopo !== escopo) await apagarFluxo(origem.escopo, projectPath, origem.id);
      setRascunho(fluxo); setOrigem({ escopo, id: fluxo.id }); setSujo(false); setErro(null); setAviso("Fluxo salvo.");
      await recarregar();
    } catch (e) { setErro(erroDe(e)); }
  }

  async function executar(entrada: string) {
    if (!rascunho || !projectId) return;
    setIniciando(true); setErro(null);
    try {
      const fluxo = { ...rascunho, id: rascunho.id || nomeDeArquivo(rascunho.nome) };
      await validarFluxo(fluxo);
      const x = await iniciarExecucao(fluxo, projectId, entrada);
      setDialogo(null); setExecucaoId(x.id); setExecucao(x); setSelecionado(null);
      setExecucoes(await listarExecucoes().catch(() => execucoes));
    } catch (e) { setErro(erroDe(e)); } finally { setIniciando(false); }
  }

  /** Fluxo vindo da IA ou de um JSON: salva os agentes novos (globais) e abre no canvas para revisar. */
  async function usarGerado(g: FluxoGerado) {
    for (const a of g.agentes_novos) await salvarAgente("global", projectPath, a);
    if (g.agentes_novos.length) await recarregar();
    abrirFluxo(g.fluxo);
    setDialogo(null);
    setAviso(g.agentes_novos.length ? `Fluxo montado. Agentes novos salvos: ${g.agentes_novos.map((a) => a.name).join(", ")}. Revise e salve.` : "Fluxo montado. Revise e salve.");
  }

  const noSelecionado = fluxoNaTela?.nos.find((n) => n.id === selecionado) ?? null;

  return (
    <div className="fx-tela">
      <aside className="fx-lateral">
        <div className="fx-lateral-topo">
          <h2 className="pixel-text">Fluxos</h2>
          <button type="button" className="fx-icone-botao" onClick={onClose} aria-label="Fechar fluxos" title="Fechar"><CloseIcon aria-hidden className="h-4 w-4" /></button>
        </div>
        <div className="fx-lateral-acoes">
          <Button variant="primary" size="sm" onClick={() => abrirFluxo(null)}>+ Novo</Button>
          <Button variant="ghost" size="sm" onClick={() => setDialogo("ia")}><SparkleIcon aria-hidden className="h-3.5 w-3.5" />Com IA</Button>
        </div>
        <button type="button" className="fx-lateral-link" onClick={() => setManual(true)}><BookIcon aria-hidden className="h-3.5 w-3.5" />Como usar fluxos e agentes</button>
        <p className="fx-rotulo">Salvos</p>
        <ul className="fx-lista">
          {fluxos.map((f) => (
            <li key={`${f.escopo}:${f.id}`}>
              <button type="button" onClick={() => abrirFluxo(f, { escopo: f.escopo, id: f.id })} className={`fx-item${!execucao && origem?.id === f.id && origem.escopo === f.escopo ? " is-ativo" : ""}`} title={f.descricao}>
                <span className="fx-item-nome">{f.nome}</span>
                <span className="fx-item-sub">{f.escopo === "global" ? "Global" : "Projeto"} · {f.nos.length} etapas</span>
              </button>
            </li>
          ))}
        </ul>
        <p className="fx-rotulo">Execuções</p>
        <ul className="fx-lista">
          {execucoes.length === 0 && <li className="fx-vazio">Nenhuma ainda.</li>}
          {execucoes.slice(0, 30).map((x) => (
            <li key={x.id}>
              <button type="button" onClick={() => { setExecucaoId(x.id); setSelecionado(null); setMenu(null); }} className={`fx-item${execucaoId === x.id ? " is-ativo" : ""}`} title={x.entrada}>
                <span className="fx-item-nome"><span className={`fx-ponto st-${x.status}`} />{x.fluxo}</span>
                <span className="fx-item-sub">{STATUS_EXEC[x.status]} · {new Date(x.criado_ms).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}</span>
              </button>
            </li>
          ))}
        </ul>
      </aside>

      <section className="fx-centro">
        <header className="fx-barra">
          {execucao ? (
            <>
              <span className={`fx-status st-${execucao.status}`}>{STATUS_EXEC[execucao.status]}</span>
              <div className="min-w-0 flex-1">
                <div className="fx-barra-titulo">{execucao.fluxo.nome}</div>
                <div className="fx-barra-sub" title={execucao.entrada}>{execucao.entrada}</div>
              </div>
              {execucao.pr_url && <a className="fx-link" href={execucao.pr_url} target="_blank" rel="noreferrer">Ver PR</a>}
              {execucao.status === "rodando" && <Button size="sm" variant="ghost" onClick={() => void acaoNaExecucao(execucao.id, "pausar").catch((e) => setErro(erroDe(e)))}><StopIcon aria-hidden className="h-3.5 w-3.5" />Pausar</Button>}
              {(execucao.status === "pausado" || execucao.status === "falhou") && <Button size="sm" variant="primary" onClick={() => void acaoNaExecucao(execucao.id, "retomar").catch((e) => setErro(erroDe(e)))}><PlayIcon aria-hidden className="h-3.5 w-3.5" />Retomar</Button>}
              {["rodando", "pausado", "aguardando", "falhou"].includes(execucao.status) && <Button size="sm" variant="ghost" onClick={() => void acaoNaExecucao(execucao.id, "cancelar").catch((e) => setErro(erroDe(e)))}>Cancelar</Button>}
              <Button size="sm" variant="ghost" onClick={() => { setExecucaoId(null); setSelecionado(null); }}>Editor</Button>
            </>
          ) : rascunho ? (
            <>
              <Input value={rascunho.nome} onChange={(e) => mudarRascunho((r) => ({ ...r, nome: e.target.value }))} aria-label="Nome do fluxo" className="fx-nome" size="sm" />
              <div className="w-32"><Select size="sm" value={escopo} onChange={(v) => { setEscopo(v); setSujo(true); }}
                options={[{ value: "global", label: "Global" }, { value: "projeto", label: "Projeto", disabled: !projectPath }]} /></div>
              <span className="flex-1" />
              {sujo && <span className="fx-barra-sub">não salvo</span>}
              <Button size="sm" variant="ghost" title="Colar o JSON de um fluxo" onClick={() => setDialogo("json")}>Importar</Button>
              <Button size="sm" variant="ghost" title="Copiar o JSON deste fluxo"
                onClick={() => void navigator.clipboard.writeText(JSON.stringify({ ...rascunho, id: rascunho.id || nomeDeArquivo(rascunho.nome) }, null, 2)).then(() => setAviso("JSON copiado."))}>
                <CopyIcon aria-hidden className="h-3.5 w-3.5" />JSON
              </Button>
              {origem?.id && <Button size="sm" variant="ghost" aria-label="Apagar fluxo" title="Apagar fluxo" onClick={() => void apagarFluxo(origem.escopo, projectPath, origem.id!).then(() => { setRascunho(null); setOrigem(null); return recarregar(); }).catch((e) => setErro(erroDe(e)))}><TrashIcon aria-hidden className="h-3.5 w-3.5" /></Button>}
              <Button size="sm" variant="ghost" onClick={() => void salvar()}>Salvar</Button>
              <Button size="sm" variant="primary" disabled={!projectId} title={projectId ? "Rodar este fluxo no projeto aberto" : "Abra um projeto para executar"} onClick={() => setDialogo("executar")}>
                <PlayIcon aria-hidden className="h-3.5 w-3.5" />Executar
              </Button>
            </>
          ) : <span className="fx-barra-sub">Escolha um fluxo à esquerda, crie um novo ou peça um para a IA.</span>}
        </header>
        {erro && <p role="alert" className="fx-erro">{erro}<button type="button" onClick={() => setErro(null)} aria-label="Fechar aviso">×</button></p>}
        {aviso && !erro && <p role="status" className="fx-aviso" onAnimationEnd={() => setAviso(null)}>{aviso}</p>}

        {rascunho && !execucao && (
          <div className="fx-paleta" role="toolbar" aria-label="Adicionar etapa">
            {TIPOS.map((t) => <button key={t.tipo} type="button" title={t.dica} className={`is-${t.tipo}`} onClick={() => criarNo(t.tipo)}><span className="fx-paleta-cor" />{t.nome}</button>)}
          </div>
        )}

        <div className="fx-canvas" ref={canvas}>
          {fluxoNaTela ? (
            <ReactFlow nodes={nodes} edges={edges} nodeTypes={tiposDeNo} edgeTypes={tiposDeAresta}
              onNodesChange={onNodesChange} onEdgesChange={onEdgesChange} onConnect={onConnect} onConnectEnd={onConnectEnd}
              isValidConnection={(c) => c.source !== c.target}
              connectionLineType={ConnectionLineType.SmoothStep} connectionLineStyle={{ stroke: "#f97316", strokeWidth: 2.5, strokeDasharray: "6 4" }}
              connectionRadius={36} snapToGrid snapGrid={[20, 20]}
              onPaneClick={() => { setSelecionado(null); setMenu(null); }} fitView fitViewOptions={{ padding: 0.3, maxZoom: 1, minZoom: 0.85 }}
              colorMode="dark" deleteKeyCode={["Delete", "Backspace"]} proOptions={{ hideAttribution: true }} minZoom={0.2}>
              <Background variant={BackgroundVariant.Dots} gap={20} size={1.6} />
              <Controls showInteractive={false} />
              <MiniMap pannable zoomable nodeStrokeWidth={2} nodeColor="#f97316" maskColor="rgba(14, 14, 20, 0.7)" className="fx-minimapa" />
            </ReactFlow>
          ) : (
            <div className="fx-boas-vindas">
              <h3 className="pixel-text">Monte times de agentes como no n8n</h3>
              <p>Arraste etapas, ligue umas nas outras e rode no seu projeto — cada agente numa cópia isolada do repositório.</p>
              <div className="flex flex-wrap justify-center gap-2">
                <Button variant="primary" onClick={() => abrirFluxo(null)}>+ Novo fluxo</Button>
                <Button variant="ghost" onClick={() => setDialogo("ia")}><SparkleIcon aria-hidden className="h-3.5 w-3.5" />Criar com IA</Button>
                <Button variant="ghost" onClick={() => setManual(true)}><BookIcon aria-hidden className="h-3.5 w-3.5" />Como usar</Button>
              </div>
            </div>
          )}
          {menu && (
            <div className="fx-menu-rapido" style={{ left: menu.x, top: menu.y }} role="menu" aria-label="Criar próxima etapa">
              <p>Próxima etapa{menu.saida && menu.saida !== "out" ? ` (${menu.saida === "nao" ? "não" : menu.saida})` : ""}</p>
              {TIPOS.map((t) => <button key={t.tipo} type="button" role="menuitem" className={`is-${t.tipo}`} onClick={() => escolherDoMenu(t.tipo)}><span className="fx-paleta-cor" />{t.nome}</button>)}
            </div>
          )}
        </div>
      </section>

      <aside className="fx-painel">
        {!noSelecionado ? (
          execucao ? <ResumoDaExecucao execucao={execucao} onSelecionar={setSelecionado} />
            : rascunho ? <ResumoDoFluxo fluxo={rascunho} onMudar={(parte) => mudarRascunho((r) => ({ ...r, ...parte }))} />
            : <div className="fx-painel-vazio"><p>Nada selecionado.</p></div>
        ) : execucao ? (
          <PainelDaExecucao execucao={execucao} no={noSelecionado} onErro={setErro} onAbrirSessao={onAbrirSessao} onVoltar={() => setSelecionado(null)} />
        ) : rascunho ? (
          <PainelDoNo no={noSelecionado} agentes={agentes} modelos={modelos} projectPath={projectPath} onAgenteCriado={recarregar} onErro={setErro}
            onMudar={(no) => mudarRascunho((r) => ({ ...r, nos: r.nos.map((n) => (n.id === no.id ? no : n)) }))} />
        ) : null}
      </aside>

      {dialogo === "executar" && rascunho && (
        <DialogoDeExecucao fluxo={rascunho} agentes={agentes} projeto={projectPath} iniciando={iniciando} onCancelar={() => setDialogo(null)} onIniciar={(t) => void executar(t)} />
      )}
      {dialogo === "ia" && <DialogoDeFluxoComIa projectPath={projectPath} onCancelar={() => setDialogo(null)} onUsar={(g) => void usarGerado(g).catch((e) => setErro(erroDe(e)))} />}
      {dialogo === "json" && <DialogoDeJson onCancelar={() => setDialogo(null)} onUsar={(g) => void usarGerado(g).catch((e) => setErro(erroDe(e)))} />}
      {manual && <ManualDeAgentes inicio="fluxo" onFechar={() => setManual(false)} />}
    </div>
  );
}

/** Sem nó selecionado no editor: descrição do fluxo e as etapas na ordem do caminho feliz. */
function ResumoDoFluxo({ fluxo, onMudar }: { fluxo: Fluxo; onMudar: (parte: Partial<Fluxo>) => void }) {
  const etapas = etapasDoFluxo(fluxo);
  return (
    <div className="fx-painel-corpo">
      <p className="fx-rotulo">Este fluxo</p>
      <Field label="Descrição" htmlFor="fx-desc" description="Aparece no cartão de início e na lista de fluxos.">
        <Textarea id="fx-desc" rows={3} value={fluxo.descricao} onChange={(e) => onMudar({ descricao: e.target.value })} />
      </Field>
      <p className="fx-rotulo">Caminho principal</p>
      <ol className="fx-etapas">
        {etapas.map((n, i) => <li key={n.id}><span className={`fx-etapa-num is-${n.tipo}`}>{i + 1}</span><span><b>{n.titulo || NOME_TIPO[n.tipo]}</b>{n.agente ? <em> · {n.agente}</em> : null}</span></li>)}
      </ol>
      <p className="fx-dica">Clique numa etapa para configurar. Arraste do quadradinho à direita de uma etapa para ligar; solte no vazio para criar a próxima. Delete apaga a seleção.</p>
    </div>
  );
}

function PainelDoNo({ no, agentes, modelos, projectPath, onMudar, onAgenteCriado, onErro }: {
  no: NoDoFluxo; agentes: AgenteSalvo[]; modelos: Partial<Record<CliDoAgente, ModeloDaCli[]>>; projectPath: string | null;
  onMudar: (no: NoDoFluxo) => void; onAgenteCriado: () => Promise<void>; onErro: (e: string) => void;
}) {
  const cfg = (parte: Record<string, unknown>) => onMudar({ ...no, config: { ...no.config, ...parte } });
  const nomes = [...new Set(agentes.map((a) => a.name))];
  const agente = agentes.find((a) => a.name === no.agente);
  const participantes = Array.isArray(no.config.participantes) ? (no.config.participantes as string[]) : [];
  const [criando, setCriando] = useState(false);
  const [pedido, setPedido] = useState("");
  const [cli, setCli] = useState<CliDoAgente>("claude");
  const [ocupado, setOcupado] = useState(false);

  async function criarAgente() {
    setOcupado(true);
    try {
      const modelo = await criarComIa(pedido, cli, projectPath);
      await salvarAgente("global", projectPath, modelo);
      await onAgenteCriado();
      onMudar({ ...no, agente: modelo.name, titulo: no.titulo === "Agente" || !no.titulo ? modelo.name : no.titulo });
      setCriando(false); setPedido("");
    } catch (e) { onErro(erroDe(e)); } finally { setOcupado(false); }
  }

  return (
    <div className="fx-painel-corpo">
      <p className="fx-rotulo">{NOME_TIPO[no.tipo]} · {no.id}</p>
      <Field label="Título" htmlFor="fx-titulo"><Input id="fx-titulo" size="sm" value={no.titulo} onChange={(e) => onMudar({ ...no, titulo: e.target.value })} /></Field>
      {no.tipo === "entrada" && <p className="fx-dica">A tarefa que você digita ao executar. Nos prompts das etapas, use <code>{"{{entrada}}"}</code>.</p>}
      {no.tipo === "agente" && (
        <>
          <Field label="Agente" htmlFor="fx-agente" description="Os modelos de Configurações → Modelos de agentes.">
            <Select id="fx-agente" size="sm" value={no.agente ?? ""} onChange={(v) => onMudar({ ...no, agente: v })} searchable
              options={[{ value: "", label: "Escolha…" }, ...nomes.map((n) => { const a = agentes.find((x) => x.name === n)!; return { value: n, label: n, hint: a.description, icon: <AgentIcon provider={a.cli} size={12} /> }; })]} />
          </Field>
          {agente && <p className="fx-dica">{agente.description}</p>}
          {!criando ? (
            <button type="button" className="fx-criar-agente" onClick={() => setCriando(true)}><SparkleIcon aria-hidden className="h-3.5 w-3.5" />Criar novo agente com IA</button>
          ) : (
            <div className="fx-criar-agente-caixa">
              <Textarea rows={3} value={pedido} onChange={(e) => setPedido(e.target.value)} placeholder="Ex.: um agente que revisa a performance das queries SQL e propõe índices" aria-label="Descreva o agente" autoFocus />
              <div className="flex items-center gap-2">
                <div className="w-28"><Select size="sm" value={cli} onChange={setCli} options={[{ value: "claude", label: "Claude" }, { value: "codex", label: "Codex" }]} /></div>
                <Button size="sm" variant="primary" disabled={ocupado || pedido.trim().length < 8} onClick={() => void criarAgente()}>
                  {ocupado ? <><ReloadIcon aria-hidden className="h-3.5 w-3.5 animate-spin" />Criando… (~40 s)</> : "Criar e usar"}
                </Button>
                <Button size="sm" variant="ghost" disabled={ocupado} onClick={() => setCriando(false)}>Cancelar</Button>
              </div>
              <p className="fx-dica">Fica salvo nos modelos globais e já entra nesta etapa.</p>
            </div>
          )}
          {agente && (
            <div className="fx-grade-2">
              <SeletorDeModelo cli={agente.cli} modelos={modelos} rotuloPadrao={`Do agente (${[agente.modelo || "padrão", agente.esforco && (ROTULO_ESFORCO[agente.esforco] ?? agente.esforco).toLowerCase()].filter(Boolean).join(", ")})`}
                modelo={String(no.config.modelo ?? "")} esforco={String(no.config.esforco ?? "")}
                onMudar={(parte) => cfg(parte)} />
            </div>
          )}
          <Field label="Prompt desta etapa" htmlFor="fx-prompt" description="Vazio = a tarefa + o que veio da etapa anterior. Marcadores: {{entrada}}, {{anterior}}, {{no:id}}.">
            <Textarea id="fx-prompt" rows={9} className="font-mono text-xs" value={String(no.config.prompt ?? "")} onChange={(e) => cfg({ prompt: e.target.value })} />
          </Field>
        </>
      )}
      {no.tipo === "condicao" && (
        <>
          <p className="fx-dica">Lê o veredito da etapa anterior (bloco JSON <code>{"{\"veredito\": \"aprovado\"}"}</code>, como o do QA e do revisor). Aprovado → <b className="manual-sim">sim</b>; reprovado → <b className="manual-nao">não</b>; passou do limite → <b className="manual-esgotou">esgotou</b>.</p>
          <Field label="Limite de voltas" htmlFor="fx-voltas">
            <Input id="fx-voltas" type="number" min={1} max={10} size="sm" value={Number(no.config.max_voltas ?? 3)} onChange={(e) => cfg({ max_voltas: Math.max(1, Math.min(10, Number(e.target.value) || 1)) })} />
          </Field>
        </>
      )}
      {no.tipo === "aprovacao" && (
        <Field label="Pergunta" htmlFor="fx-pergunta" description="Aparece para você aprovar ou recusar.">
          <Input id="fx-pergunta" size="sm" value={String(no.config.pergunta ?? "")} onChange={(e) => cfg({ pergunta: e.target.value })} />
        </Field>
      )}
      {no.tipo === "sala" && (
        <>
          <Field label="Participantes" description="Falam nessa ordem, rodada após rodada. O primeiro escreve a ata.">
            <div className="agente-chips">
              {nomes.map((n) => (
                <button key={n} type="button" className="agente-chip is-botao" aria-pressed={participantes.includes(n)}
                  onClick={() => cfg({ participantes: participantes.includes(n) ? participantes.filter((x) => x !== n) : [...participantes, n] })}>{n}</button>
              ))}
            </div>
          </Field>
          <Field label="Rodadas (máximo)" htmlFor="fx-rodadas">
            <Input id="fx-rodadas" type="number" min={1} max={10} size="sm" value={Number(no.config.rodadas ?? 3)} onChange={(e) => cfg({ rodadas: Math.max(1, Math.min(10, Number(e.target.value) || 1)) })} />
          </Field>
          <Field label="Objetivo da reunião" htmlFor="fx-objetivo" description="Use {{entrada}} para a tarefa digitada.">
            <Textarea id="fx-objetivo" rows={4} value={String(no.config.objetivo ?? "{{entrada}}")} onChange={(e) => cfg({ objetivo: e.target.value })} />
          </Field>
        </>
      )}
      {no.tipo === "pr" && (
        <Field label="Título do PR" htmlFor="fx-titulopr" description="Vazio = a primeira linha da tarefa.">
          <Input id="fx-titulopr" size="sm" value={String(no.config.titulo_pr ?? "")} onChange={(e) => cfg({ titulo_pr: e.target.value })} />
        </Field>
      )}
    </div>
  );
}

/** Sem nó selecionado na execução: o que é, onde está acontecendo, o que está rolando agora e as
 *  etapas que já passaram. */
function ResumoDaExecucao({ execucao, onSelecionar }: { execucao: Execucao; onSelecionar: (id: string) => void }) {
  const [agora, setAgora] = useState(() => Date.now());
  useEffect(() => { const t = window.setInterval(() => setAgora(Date.now()), 1000); return () => window.clearInterval(t); }, []);
  const vivo = Object.entries(execucao.nos).find(([, n]) => n.status === "rodando" || n.status === "aguardando");
  const noVivo = vivo ? execucao.fluxo.nos.find((n) => n.id === vivo[0]) : undefined;
  const passadas = execucao.fluxo.nos.map((n) => ({ no: n, estado: execucao.nos[n.id] }))
    .filter((x) => x.estado && x.estado.status !== "pendente" && x.no.tipo !== "entrada")
    .sort((a, b) => (a.estado!.inicio_ms || Infinity) - (b.estado!.inicio_ms || Infinity));
  const plano = (() => {
    const saida = Object.entries(execucao.nos).map(([id, e]) => ({ id, e })).find((x) => execucao.fluxo.nos.find((n) => n.id === x.id)?.agente === "orquestrador")?.e.saida;
    const bloco = saida?.match(/```(?:json)?\s*([\s\S]*?)```/g)?.pop()?.replace(/```(?:json)?/g, "");
    try { return bloco ? (JSON.parse(bloco).partes as { titulo: string; papel?: string }[] | undefined) : undefined; } catch { return undefined; }
  })();
  const fim = execucao.status === "concluido" || execucao.status === "cancelado" || execucao.status === "falhou" ? execucao.atualizado_ms : agora;

  return (
    <div className="fx-painel-corpo">
      <div className="fx-resumo-cartao">
        <p className="fx-rotulo">Tarefa</p>
        <p className="fx-texto">{execucao.entrada}</p>
        <dl className="fx-resumo-dados">
          <dt>Branch</dt><dd><code>{execucao.branch ?? "— (projeto sem git)"}</code>{execucao.base && <span> a partir de <code>{execucao.base}</code></span>}</dd>
          <dt>Worktree</dt><dd className="fx-resumo-pasta"><span title={execucao.pasta}>{execucao.pasta}</span>
            <button type="button" className="fx-icone-botao" title="Abrir a pasta" aria-label="Abrir a pasta do worktree" onClick={() => void revealItemInDir(execucao.pasta).catch(() => undefined)}><FolderIcon aria-hidden className="h-3.5 w-3.5" /></button></dd>
          <dt>Duração</dt><dd>{duracao(fim - execucao.criado_ms)}</dd>
          <dt>Custo</dt><dd>US$ {execucao.custo_usd.toFixed(2)}</dd>
        </dl>
      </div>
      {noVivo && vivo && (
        <button type="button" className="fx-agora" onClick={() => onSelecionar(noVivo.id)}>
          <span className="fx-rotulo">{vivo[1].status === "aguardando" ? "Esperando você" : "Agora"}</span>
          <b>{noVivo.titulo || noVivo.id}{noVivo.agente ? ` · ${noVivo.agente}` : ""}</b>
          <span className="fx-agora-atividade">{vivo[1].status === "aguardando" ? "Clique para aprovar ou recusar." : vivo[1].atividade || "Começando…"}</span>
        </button>
      )}
      {execucao.erro && <p className="fx-erro">{execucao.erro}</p>}
      {plano && plano.length > 0 && (
        <>
          <p className="fx-rotulo">Plano do orquestrador</p>
          <ol className="fx-etapas">{plano.map((p, i) => <li key={i}><span className="fx-etapa-num is-agente">{i + 1}</span><span>{p.titulo}{p.papel ? <em> · {p.papel}</em> : null}</span></li>)}</ol>
        </>
      )}
      <p className="fx-rotulo">Etapas</p>
      {passadas.length === 0 ? <p className="fx-dica">Começando…</p> : (
        <ol className="fx-linha-tempo">
          {passadas.map(({ no, estado }) => (
            <li key={no.id} className={`st-${estado!.status}`}>
              <button type="button" onClick={() => onSelecionar(no.id)}>
                <b>{no.titulo || no.id}</b>
                <span>{estado!.status === "rodando" ? "rodando" : estado!.status === "concluido" ? "feito" : estado!.status}
                  {estado!.caminho ? ` · ${estado!.caminho === "nao" ? "não" : estado!.caminho}` : ""}
                  {estado!.inicio_ms ? ` · ${duracao((estado!.fim_ms || agora) - estado!.inicio_ms)}` : ""}
                  {estado!.custo_usd > 0 ? ` · US$ ${estado!.custo_usd.toFixed(2)}` : ""}</span>
              </button>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

function PainelDaExecucao({ execucao, no, onErro, onAbrirSessao, onVoltar }: { execucao: Execucao; no: NoDoFluxo; onErro: (e: string) => void; onAbrirSessao: (id: string, titulo: string) => void; onVoltar: () => void }) {
  const estado = execucao.nos[no.id];
  const [historico, setHistorico] = useState<ItemDoHistorico[]>([]);
  const fimDaLista = useRef<HTMLLIElement>(null);
  useEffect(() => {
    let vivo = true;
    const ler = () => historicoDoNo(execucao.id, no.id).then((h) => { if (vivo) setHistorico(h); }).catch(() => undefined);
    void ler();
    const t = estado?.status === "rodando" ? window.setInterval(ler, 2000) : undefined;
    return () => { vivo = false; if (t) window.clearInterval(t); };
  }, [execucao.id, no.id, estado?.status]);
  useEffect(() => { if (estado?.status === "rodando") fimDaLista.current?.scrollIntoView?.({ block: "nearest" }); }, [historico.length, estado?.status]);

  return (
    <div className="fx-painel-corpo">
      <button type="button" className="fx-voltar" onClick={onVoltar}>← Resumo da execução</button>
      <p className="fx-rotulo">{no.titulo || no.id}{estado ? ` · ${estado.status}` : ""}</p>
      {(estado?.modelo || estado?.esforco || no.agente) && (
        <p className="fx-dica">{[no.agente, estado?.cli, estado?.modelo, estado?.esforco && `esforço ${(ROTULO_ESFORCO[estado.esforco] ?? estado.esforco).toLowerCase()}`].filter(Boolean).join(" · ")}</p>
      )}
      {estado?.status === "aguardando" && (
        <div className="fx-aprovar">
          <p>{String(no.config.pergunta || "Continuar?")}</p>
          <div className="flex gap-2">
            <Button size="sm" variant="primary" onClick={() => void aprovarNo(execucao.id, no.id, true).catch((e) => onErro(erroDe(e)))}>Aprovar</Button>
            <Button size="sm" variant="ghost" onClick={() => void aprovarNo(execucao.id, no.id, false).catch((e) => onErro(erroDe(e)))}>Recusar</Button>
          </div>
        </div>
      )}
      {estado?.status === "rodando" && estado.atividade && <div className="fx-agora is-compacto"><span className="fx-rotulo">Agora</span><span className="fx-agora-atividade">{estado.atividade}</span></div>}
      {estado?.session_id && (
        <Button size="sm" variant="ghost" title="Abre este agente numa aba, retomando a sessão dele no worktree da execução — peça ajustes ou que ele desfaça o que fez"
          onClick={() => void abrirConversaDoNo(execucao.id, no.id).then((s) => onAbrirSessao(s.session_id, s.name)).catch((e) => onErro(erroDe(e)))}>
          Abrir numa conversa (ajustar ou reverter)
        </Button>
      )}
      {estado?.erro && <p className="fx-erro">{estado.erro}</p>}
      {estado && (estado.voltas > 0 || estado.custo_usd > 0) && (
        <p className="fx-dica">{estado.voltas > 0 ? `${estado.voltas} volta(s) · ` : ""}{estado.custo_usd > 0 ? `US$ ${estado.custo_usd.toFixed(2)}` : ""}{estado.caminho ? ` · saiu por “${estado.caminho === "nao" ? "não" : estado.caminho}”` : ""}</p>
      )}
      <p className="fx-rotulo">Histórico</p>
      {historico.length === 0 ? <p className="fx-dica">{estado?.status === "rodando" ? "Começando…" : "Sem eventos."}</p> : (
        <ol className="fx-historico">
          {historico.map((h, i) => (
            <li key={i} className={`fx-h is-${h.kind}`}>
              {h.kind === "tool" ? <><span className="fx-h-ferramenta">{h.tool}</span><code title={h.text}>{h.text}</code></> : <span>{h.text}</span>}
            </li>
          ))}
          <li ref={fimDaLista} aria-hidden className="fx-h-fim" />
        </ol>
      )}
      {estado?.saida && (
        <>
          <p className="fx-rotulo">Saída</p>
          <pre className="fx-saida-texto">{estado.saida}</pre>
        </>
      )}
    </div>
  );
}

/** Cartão de início: o que vai acontecer, etapa por etapa, antes de escrever a tarefa. */
function DialogoDeExecucao({ fluxo, agentes, projeto, iniciando, onCancelar, onIniciar }: { fluxo: Fluxo; agentes: AgenteSalvo[]; projeto: string | null; iniciando: boolean; onCancelar: () => void; onIniciar: (t: string) => void }) {
  const [texto, setTexto] = useState("");
  const etapas = etapasDoFluxo(fluxo);
  const temPr = fluxo.nos.some((n) => n.tipo === "pr");
  const loops = fluxo.nos.filter((n) => n.tipo === "condicao");
  return (
    <div className="fx-dialogo-fundo" onMouseDown={(e) => { if (e.target === e.currentTarget) onCancelar(); }}>
      <div className="fx-dialogo is-largo" role="dialog" aria-modal="true" aria-label={`Executar ${fluxo.nome}`}>
        <h3 className="pixel-text">Executar “{fluxo.nome}”</h3>
        {fluxo.descricao && <p className="fx-texto">{fluxo.descricao}</p>}
        <div className="fx-inicio">
          <p className="fx-rotulo">O que vai acontecer</p>
          <ol className="fx-etapas is-grande">
            {etapas.map((n, i) => {
              const a = agentes.find((x) => x.name === n.agente);
              const detalhe = n.tipo === "agente" ? a?.description : n.tipo === "condicao" ? `Se reprovar, volta para corrigir (até ${String(n.config.max_voltas ?? 3)} vezes).`
                : n.tipo === "aprovacao" ? "Para e espera você aprovar." : n.tipo === "sala" ? "Os agentes discutem em rodadas até o consenso." : n.tipo === "pr" ? "Commit, push e pull request no GitHub." : n.tipo === "entrada" ? "Você descreve a tarefa abaixo." : "";
              return <li key={n.id}><span className={`fx-etapa-num is-${n.tipo}`}>{i + 1}</span><span><b>{n.titulo || NOME_TIPO[n.tipo]}</b>{n.agente ? <em> · {n.agente}</em> : null}{detalhe && <small>{detalhe}</small>}</span></li>;
            })}
          </ol>
          <p className="fx-dica">Projeto <b>{projeto?.split(/[\\/]/).filter(Boolean).pop() ?? "—"}</b> · os agentes trabalham num git worktree com branch nova, sem mexer na sua pasta{loops.length ? " · loops com limite de voltas" : ""}{temPr ? " · no fim, um pull request no GitHub (depois da sua aprovação)" : ""}.</p>
        </div>
        <Textarea autoFocus rows={5} value={texto} onChange={(e) => setTexto(e.target.value)} placeholder="Descreva a tarefa com o critério de pronto — ex.: “Adicionar exportação CSV no relatório de vendas, com testes; pronto quando o botão baixar o arquivo com as colunas da tabela.”" aria-label="Tarefa" />
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onCancelar} disabled={iniciando}>Cancelar</Button>
          <Button variant="primary" onClick={() => onIniciar(texto)} disabled={iniciando || texto.trim().length < 5}>{iniciando ? "Preparando o worktree…" : "Iniciar"}</Button>
        </div>
      </div>
    </div>
  );
}

function PreviaDoGerado({ g }: { g: FluxoGerado }) {
  const etapas = etapasDoFluxo(g.fluxo);
  return (
    <div className="fx-inicio">
      <p className="fx-rotulo">{g.fluxo.nome}</p>
      {g.fluxo.descricao && <p className="fx-texto">{g.fluxo.descricao}</p>}
      <ol className="fx-etapas">{etapas.map((n, i) => <li key={n.id}><span className={`fx-etapa-num is-${n.tipo}`}>{i + 1}</span><span><b>{n.titulo || NOME_TIPO[n.tipo]}</b>{n.agente ? <em> · {n.agente}</em> : null}</span></li>)}</ol>
      <p className="fx-dica">{g.fluxo.nos.length} etapas e {g.fluxo.conexoes.length} conexões no total (incluindo desvios).</p>
      {g.agentes_novos.length > 0 && (
        <>
          <p className="fx-rotulo">Agentes novos que vão ser salvos</p>
          <ul className="fx-novos">{g.agentes_novos.map((a) => <li key={a.name}><AgentIcon provider={a.cli} size={12} /><b>{a.name}</b><span>{a.description}</span></li>)}</ul>
        </>
      )}
    </div>
  );
}

function DialogoDeFluxoComIa({ projectPath, onCancelar, onUsar }: { projectPath: string | null; onCancelar: () => void; onUsar: (g: FluxoGerado) => void }) {
  const [texto, setTexto] = useState("");
  const [gerado, setGerado] = useState<FluxoGerado | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  async function gerar() {
    setOcupado(true); setErro(null); setGerado(null);
    try { setGerado(await criarFluxoComIa(texto, projectPath)); } catch (e) { setErro(erroDe(e)); } finally { setOcupado(false); }
  }
  return (
    <div className="fx-dialogo-fundo" onMouseDown={(e) => { if (e.target === e.currentTarget && !ocupado) onCancelar(); }}>
      <div className="fx-dialogo is-largo" role="dialog" aria-modal="true" aria-label="Criar fluxo com IA">
        <h3 className="pixel-text">Criar fluxo com IA</h3>
        <p className="fx-dica">Descreva o processo como você explicaria para alguém do time. A IA monta as etapas, as condições e os loops, usa os seus agentes e cria os que faltarem.</p>
        <Textarea autoFocus rows={5} value={texto} onChange={(e) => setTexto(e.target.value)} disabled={ocupado} aria-label="Descreva o fluxo"
          placeholder="Ex.: recebe um bug; um agente investiga a causa; o dev corrige; o QA testa em loop até 2 vezes; um revisor de segurança verifica e eu aprovo antes do PR." />
        {erro && <p role="alert" className="fx-erro">{erro}</p>}
        {gerado && <PreviaDoGerado g={gerado} />}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onCancelar} disabled={ocupado}>Cancelar</Button>
          <Button variant={gerado ? "ghost" : "primary"} onClick={() => void gerar()} disabled={ocupado || texto.trim().length < 10}>
            {ocupado ? <><ReloadIcon aria-hidden className="h-3.5 w-3.5 animate-spin" />Montando… (~1 min)</> : gerado ? "Gerar de novo" : <><SparkleIcon aria-hidden className="h-3.5 w-3.5" />Gerar fluxo</>}
          </Button>
          {gerado && <Button variant="primary" onClick={() => onUsar(gerado)}>Abrir no editor</Button>}
        </div>
      </div>
    </div>
  );
}

function DialogoDeJson({ onCancelar, onUsar }: { onCancelar: () => void; onUsar: (g: FluxoGerado) => void }) {
  const [texto, setTexto] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [gerado, setGerado] = useState<FluxoGerado | null>(null);
  async function conferir() {
    setErro(null); setGerado(null);
    try {
      const g = lerJsonDeFluxo(texto);
      await validarFluxo({ ...g.fluxo, id: g.fluxo.id || nomeDeArquivo(g.fluxo.nome) || "fluxo-importado" });
      setGerado(g);
    } catch (e) { setErro(erroDe(e)); }
  }
  return (
    <div className="fx-dialogo-fundo" onMouseDown={(e) => { if (e.target === e.currentTarget) onCancelar(); }}>
      <div className="fx-dialogo is-largo" role="dialog" aria-modal="true" aria-label="Importar JSON">
        <h3 className="pixel-text">Importar fluxo de JSON</h3>
        <p className="fx-dica">Cole o JSON de um fluxo (o mesmo de “Copiar JSON” ou de <code>~/.omni/fluxos</code>) ou a resposta da IA com <code>fluxo</code> e <code>agentes_novos</code>.</p>
        <Textarea autoFocus rows={12} className="font-mono text-xs" value={texto} onChange={(e) => { setTexto(e.target.value); setGerado(null); }} aria-label="JSON do fluxo" placeholder='{"id": "meu-fluxo", "nome": "…", "nos": [...], "conexoes": [...]}' />
        {erro && <p role="alert" className="fx-erro">{erro}</p>}
        {gerado && <PreviaDoGerado g={gerado} />}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onCancelar}>Cancelar</Button>
          {!gerado ? <Button variant="primary" onClick={() => void conferir()} disabled={!texto.trim()}>Conferir</Button>
            : <Button variant="primary" onClick={() => onUsar(gerado)}>Abrir no editor</Button>}
        </div>
      </div>
    </div>
  );
}
