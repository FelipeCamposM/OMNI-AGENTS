import {
  BookIcon,
  ChatIcon,
  CircuitIcon,
  ChevronDownIcon,
  CloseIcon,
  CopyIcon,
  DockerIcon,
  FolderIcon,
  FolderPlusIcon as FolderPlus,
  ImageIcon,
  GitBranchIcon,
  KanbanIcon,
  ReloadIcon,
  ServerIcon,
  SlidersIcon as Sliders,
  TerminalIcon,
} from "./ui/PixelIcon";
import { destaqueDaLinha, EtiquetaDoStatus, haQuantoTempo, IconeDoStatus, ResumoDeAgentes, rotuloDoStatus, statusDaConversa } from "./ConversaStatus";
import { conversationKey } from "../features/terminal/useAttention";
import { Fragment, useEffect, useLayoutEffect, useRef, useState } from "react";
import gsap from "gsap";
import { ProjectPicker } from "../features/projects/ProjectPicker";
import { EditableLabel } from "./ui/EditableLabel";
import { listProfiles, renameSession } from "../features/terminal/terminalService";
import { deslizarAba, moverIndicador, useStagger } from "../lib/motion";
import { AgentIcon } from "./ui/AgentIcon";
import type { SettingsSection } from "../hooks/useNotifications";
import type { KanbanState } from "../types/kanban";
import type { Project, WorkspaceState } from "../types/workspace";
import type { TerminalSession } from "../features/terminal/terminalService";
import type { AttentionItem } from "../features/terminal/useAttention";
import { WorkspaceList } from "./WorkspaceList";
import { arrastarParaOrdenar } from "../lib/ordenarArrastando";
import { AttentionPanel } from "./AttentionPanel";
import { FileTree } from "./FileTree";
import { GitPanel } from "./GitPanel";
import { DockerPanel } from "./DockerPanel";
import { ServidoresPanel } from "./ServidoresPanel";
import { KanbanPanel } from "./KanbanPanel";
import { SkillsList } from "./SkillsList";
import { AvatarDoProjeto, SimboloDoProjeto } from "./EscolherIcone";
import { useProjetoDaPasta } from "../features/projects/projetosContext";
import { RecentesConversas } from "../features/history/RecentesConversas";
import type { HistoryEntry } from "../features/history/historyService";
/* O mesmo arquivo que o Tauri usa como ícone do app (tauri.conf.json →
   bundle.icon). Importado em vez de copiado para src/assets: uma cópia
   dessincronizaria do ícone real na próxima troca de marca. */

/** Abas da lateral, uma por ícone na fileira do topo. "geral" junta atenção, workspaces, projetos,
 *  conversas e terminais; as outras são uma ferramenta do projeto cada. */
type Aba = "geral" | "files" | "git" | "docker" | "servidores" | "skills" | "kanban";
const ABAS: Record<Aba, { rotulo: string; icone: React.ComponentType<{ className?: string; "aria-hidden"?: boolean }>; precisaProjeto: boolean }> = {
  geral: { rotulo: "Conversas", icone: ChatIcon, precisaProjeto: false },
  files: { rotulo: "Arquivos", icone: FolderIcon, precisaProjeto: true },
  git: { rotulo: "Git", icone: GitBranchIcon, precisaProjeto: true },
  docker: { rotulo: "Docker", icone: DockerIcon, precisaProjeto: false },
  servidores: { rotulo: "Servidores locais", icone: ServerIcon, precisaProjeto: false },
  skills: { rotulo: "Skills", icone: BookIcon, precisaProjeto: true },
  kanban: { rotulo: "Kanban", icone: KanbanIcon, precisaProjeto: true },
};
const CHAVE_ABAS = "omni-lateral-abas";
/** Ordem salva das abas (arrastando os ícones); aba nova de uma versão futura entra no fim. */
function lerOrdemDasAbas(): Aba[] {
  const todas = Object.keys(ABAS) as Aba[];
  try {
    const salva = JSON.parse(localStorage.getItem(CHAVE_ABAS) ?? "[]") as string[];
    const validas = salva.filter((aba): aba is Aba => todas.includes(aba as Aba));
    return [...new Set([...validas, ...todas])];
  } catch {
    return todas;
  }
}

/** Largura da lateral em px: arrastável pela borda direita, com teto para não engolir os painéis. */
const LARGURA = { min: 224, padrao: 256, max: 440 } as const;
const CHAVE_LARGURA = "omni-lateral-largura";
const limitarLargura = (valor: number) => Math.round(Math.min(LARGURA.max, Math.max(LARGURA.min, valor)));
function lerLargura(): number {
  try {
    const salva = Number(localStorage.getItem(CHAVE_LARGURA));
    return salva ? limitarLargura(salva) : LARGURA.padrao;
  } catch {
    return LARGURA.padrao;
  }
}

interface SidebarProps {
  workspaces: WorkspaceState[];
  activeWorkspaceId: string | null;
  onSelectWorkspace: (workspaceId: string) => void;
  onCreateWorkspace: (name: string) => void;
  onHideWorkspace: (workspaceId: string) => void;
  onShowWorkspace: (workspaceId: string) => void;
  onDeleteWorkspace: (workspaceId: string) => void;
  onMoveWorkspace: (workspaceId: string, beforeId: string | null) => void;
  onRemoveProjectFromWorkspace: (workspaceId: string, projectId: string) => void;
  onRenameWorkspace: (workspaceId: string, name: string) => void;
  /** Símbolo do workspace/projeto (favicon). Opcionais: sem eles o avatar fica fixo. */
  onSetWorkspaceIcon?: (workspaceId: string, icone: string | null | undefined) => void;
  onSetProjectIcon?: (projectId: string, icone: string | null | undefined) => void;
  attention: AttentionItem[];
  onFocusSession: (item: AttentionItem) => void;
  onDismissAttention: (item: AttentionItem) => void;
  /** Terminal novo no projeto ativo rodando `command` (logs/shell de container). */
  onRunInTerminal: (title: string, command: string) => void;
  projects: Project[];
  activeProjectId: string | null;
  activeProjectPath: string | null;
  onOpenFile: (path: string, kind: "file" | "markdown") => void;
  onFileRenamed: (fromPath: string, toPath: string, title: string) => void;
  onPathDeleted: (path: string) => void;
  terminalSessions: TerminalSession[];
  /** Conversas de agente de todos os projetos: resumo nas linhas de workspace e projeto. */
  agentSessions?: TerminalSession[];
  /** Sessão da aba em foco: a linha dela fica marcada na lista. */
  activeSessionId?: string | null;
  showSettings: boolean;
  showHistory: boolean;
  /** Tela de fluxos de agentes (editor estilo n8n e execuções). */
  showFluxos?: boolean;
  onOpenFluxos?: () => void;
  onOpenHistory: () => void;
  /** Retoma uma conversa do Histórico (a seção Recentes da lateral). */
  onResumeHistory?: (entry: HistoryEntry) => Promise<void>;
  /** Antigo clique no logo: o logo mudou para a barra superior (`TitleBar`). */
  onHome?: () => void;
  onAddProject: (path: string) => void;
  onSelectProject: (projectId: string) => void;
  onCloseProject: (projectId: string) => void;
  onMoveProject: (projectId: string, beforeId: string | null) => void;
  onAttachTerminal: (sessionId: string, title: string) => void;
  onCloseTerminal: (sessionId: string) => void;
  onDuplicateTerminal: (sessionId: string) => void;
  onRestartTerminal: (sessionId: string) => void;
  onOpenSettings: (secao?: SettingsSection) => void;
  onOpenGitDiff: (file: string, staged: boolean) => void;
  onOpenGitGraph: () => void;
  kanban: KanbanState;
  onOpenKanban: () => void;
}

export function Sidebar({
  workspaces,
  activeWorkspaceId,
  onSelectWorkspace,
  onCreateWorkspace,
  onHideWorkspace,
  onShowWorkspace,
  onDeleteWorkspace,
  onMoveWorkspace,
  onRemoveProjectFromWorkspace,
  onRenameWorkspace,
  onSetWorkspaceIcon,
  onSetProjectIcon,
  attention,
  onFocusSession,
  onDismissAttention,
  onRunInTerminal,
  projects,
  activeProjectId,
  activeProjectPath,
  onOpenFile,
  onFileRenamed,
  onPathDeleted,
  terminalSessions,
  agentSessions = [],
  activeSessionId = null,
  showSettings,
  showHistory,
  showFluxos = false,
  onOpenFluxos,
  onOpenHistory,
  onResumeHistory,
  onAddProject,
  onSelectProject,
  onCloseProject,
  onMoveProject,
  onAttachTerminal,
  onCloseTerminal,
  onDuplicateTerminal,
  onRestartTerminal,
  onOpenSettings,
  onOpenGitDiff,
  onOpenGitGraph,
  kanban,
  onOpenKanban,
}: SidebarProps) {
  const navRef = useStagger<HTMLDivElement>("[data-nav-item]");
  const naoVistas = new Set(attention.map((item) => item.conversationKey));

  const [pickerAberto, setPickerAberto] = useState(false);
  // Botão "Trocar ícone" da linha do projeto: cada clique abre o seletor do avatar dele.
  const [pedidosDeIcone, setPedidosDeIcone] = useState<Record<string, number>>({});
  // Nome de cada conta, para a segunda linha da conversa dizer em qual ela roda.
  const [contas, setContas] = useState<Record<string, string>>({});
  useEffect(() => {
    let vivo = true;
    listProfiles().then((perfis) => {
      if (vivo) setContas(Object.fromEntries(perfis.map((perfil) => [perfil.id, perfil.name])));
    }).catch(() => undefined);
    return () => { vivo = false; };
  }, []);
  // A segunda linha diz "há 3 min": relida a cada minuto sem depender de a sessão mudar.
  const [agora, setAgora] = useState(() => Date.now());
  useEffect(() => {
    const relogio = window.setInterval(() => setAgora(Date.now()), 60_000);
    return () => window.clearInterval(relogio);
  }, []);

  const [ordemAbas, setOrdemAbas] = useState(lerOrdemDasAbas);
  const [aba, setAba] = useState<Aba>("geral");
  // A aba de onde se saiu fica montada até o fim do deslize; depois some.
  const [saindo, setSaindo] = useState<Aba | null>(null);
  const direcao = useRef<1 | -1>(1);
  const paineis = useRef<Partial<Record<Aba, HTMLElement | null>>>({});
  const botoesAba = useRef<Partial<Record<Aba, HTMLButtonElement | null>>>({});
  const indicador = useRef<HTMLSpanElement>(null);
  function trocarAba(nova: Aba) {
    if (nova === aba) return;
    direcao.current = ordemAbas.indexOf(nova) > ordemAbas.indexOf(aba) ? 1 : -1;
    setSaindo(aba);
    setAba(nova);
  }
  useLayoutEffect(() => {
    if (!saindo) return;
    const quem = saindo;
    deslizarAba(paineis.current[aba] ?? null, paineis.current[quem] ?? null, direcao.current,
      () => setSaindo((atual) => (atual === quem ? null : atual)));
  }, [aba]); // eslint-disable-line react-hooks/exhaustive-deps
  function moverAba(id: string, antesDe: string | null) {
    setOrdemAbas((atual) => {
      const sem = atual.filter((item) => item !== id);
      const pos = antesDe ? sem.indexOf(antesDe as Aba) : sem.length;
      const nova = [...sem.slice(0, pos), id as Aba, ...sem.slice(pos)];
      try { localStorage.setItem(CHAVE_ABAS, JSON.stringify(nova)); } catch { /* sem armazenamento: vale só agora */ }
      return nova;
    });
  }

  const [largura, setLargura] = useState(lerLargura);
  // O marcador segue a aba ativa; reordenar ou alargar a lateral também o reposiciona.
  useLayoutEffect(() => {
    moverIndicador(indicador.current, botoesAba.current[aba] ?? null);
  }, [aba, ordemAbas, largura]);

  // Avisos na aba das conversas: quantos pedem atenção e se algum agente está trabalhando agora.
  const trabalhando = [...agentSessions, ...terminalSessions].some((session) => session.provider && session.state === "working");
  useEffect(() => {
    try { localStorage.setItem(CHAVE_LARGURA, String(largura)); } catch { /* sem armazenamento: vale só agora */ }
  }, [largura]);
  function arrastarBorda(evento: React.PointerEvent) {
    evento.preventDefault();
    const inicioX = evento.clientX;
    const inicio = largura;
    const mover = (movimento: PointerEvent) => setLargura(limitarLargura(inicio + movimento.clientX - inicioX));
    const soltar = () => {
      window.removeEventListener("pointermove", mover);
      window.removeEventListener("pointerup", soltar);
      document.body.classList.remove("redimensionando-lateral");
    };
    window.addEventListener("pointermove", mover);
    window.addEventListener("pointerup", soltar);
    // Sem isto o xterm debaixo do ponteiro "rouba" o arrasto e seleciona texto.
    document.body.classList.add("redimensionando-lateral");
  }

  return (
    // Logo e sino moram na barra superior (`TitleBar`): a lateral começa direto na navegação.
    <aside style={{ width: largura }} className="glass glass-strong shrink-0 flex flex-col h-full rounded-none border-y-0 border-l-0">
      {/* Borda arrastável: alarga até LARGURA.max; duplo clique volta ao padrão; setas pelo teclado. */}
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Largura da barra lateral"
        aria-valuemin={LARGURA.min}
        aria-valuemax={LARGURA.max}
        aria-valuenow={largura}
        tabIndex={0}
        title="Arraste para alargar · duplo clique volta ao tamanho padrão"
        onPointerDown={arrastarBorda}
        onDoubleClick={() => setLargura(LARGURA.padrao)}
        onKeyDown={(evento) => {
          if (evento.key !== "ArrowLeft" && evento.key !== "ArrowRight") return;
          evento.preventDefault();
          setLargura((atual) => limitarLargura(atual + (evento.key === "ArrowRight" ? 16 : -16)));
        }}
        className="lateral-alca"
      />

      {/* Fileira fixa de abas: clique troca, arrastar reordena (fica salvo). */}
      <div role="group" aria-label="Seções da lateral" className="lateral-abas">
        <span ref={indicador} aria-hidden className="lateral-abas-marcador" />
        {ordemAbas.map((id) => {
          const { rotulo, icone: Icone } = ABAS[id];
          const avisos = id === "geral" ? attention.length : 0;
          const vivo = id === "geral" && trabalhando;
          const extra = [avisos > 0 && `${avisos} pedindo atenção`, vivo && "agente trabalhando"].filter(Boolean).join(" · ");
          return (
            <button key={id} ref={(el) => { botoesAba.current[id] = el; }}
              type="button" aria-pressed={aba === id} aria-controls={`lateral-aba-${id}`}
              aria-label={extra ? `${rotulo} · ${extra}` : rotulo}
              title={`${rotulo}${extra ? ` · ${extra}` : ""}\nArraste para mudar a ordem`}
              data-ordem="abas" data-ordem-id={id}
              onPointerDown={(evento) => arrastarParaOrdenar(evento, "abas", id, moverAba, "x")}
              onClick={() => trocarAba(id)}
              className={`lateral-aba${aba === id ? " is-ativa" : ""}`}>
              <Icone className="h-4 w-4" aria-hidden />
              {avisos > 0 && <span aria-hidden className="lateral-aba-contagem">{avisos > 9 ? "9+" : avisos}</span>}
              {vivo && <span aria-hidden className="lateral-aba-vivo" />}
            </button>
          );
        })}
      </div>

      <div ref={navRef} className="relative min-h-0 flex-1 overflow-hidden">
        {ordemAbas.filter((id) => id === aba || id === saindo).map((id) => (
          <nav key={id} id={`lateral-aba-${id}`} aria-label={ABAS[id].rotulo}
            aria-hidden={id !== aba || undefined}
            ref={(el) => { paineis.current[id] = el; }}
            className={`absolute inset-0 overflow-y-auto overflow-x-hidden px-2 py-3 space-y-3${id !== aba ? " pointer-events-none" : ""}`}>
            {id === "geral" ? (
              <>
                <AttentionPanel items={attention} agora={agora} onFocusSession={onFocusSession} onDismiss={onDismissAttention} />

                <WorkspaceList
                  workspaces={workspaces}
                  activeWorkspaceId={activeWorkspaceId}
                  attention={attention}
                  agentSessions={agentSessions}
                  naoVistas={naoVistas}
                  onSelect={onSelectWorkspace}
                  onCreate={onCreateWorkspace}
                  onHide={onHideWorkspace}
                  onShow={onShowWorkspace}
                  onDelete={onDeleteWorkspace}
                  onMove={onMoveWorkspace}
                  onRemoveProject={onRemoveProjectFromWorkspace}
                  onRename={onRenameWorkspace}
                  onSetIcon={onSetWorkspaceIcon}
                />

                <div className="space-y-1">
                  <div className="flex items-center justify-between px-3 pt-1">
                    <p className="text-text-muted text-[10px] font-medium uppercase tracking-wider">Projects</p>
                    <button
                      data-nav-item
                      onClick={() => setPickerAberto(true)}
                      aria-label="Adicionar projeto"
                      className="text-text-muted hover:text-text-primary rounded-none p-0.5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
                    >
                      <FolderPlus className="w-3.5 h-3.5" aria-hidden="true" />
                    </button>
                  </div>
                  {projects.length === 0 ? (
                    <p data-nav-item className="text-text-muted text-xs px-3 py-1.5">
                      Nenhum projeto ainda.
                    </p>
                  ) : (
                    projects.map((project) => (
                      <div key={project.id}
                        data-ordem="projetos" data-ordem-id={project.id}
                        onPointerDown={(evento) => arrastarParaOrdenar(evento, "projetos", project.id, onMoveProject)}
                        className={`lateral-item group mx-1 flex items-stretch border-l-2 ring-1 ring-inset transition-colors ${
                          project.id === activeProjectId
                            ? "lateral-item-ativo border-accent ring-accent/50"
                            : "border-transparent ring-border-subtle/40 hover:ring-border-subtle"
                        }`}>
                        {onSetProjectIcon && (
                          <span className="grid shrink-0 place-items-center pl-2"><AvatarDoProjeto project={project} onEscolher={onSetProjectIcon}
                            vizinhos={projects} pedido={pedidosDeIcone[project.id]} /></span>
                        )}
                        <button
                          type="button"
                          data-nav-item
                          aria-current={project.id === activeProjectId ? "page" : undefined}
                          onClick={() => onSelectProject(project.id)}
                          className="flex min-w-0 flex-1 items-center gap-2.5 px-2 py-2 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
                          title={`${project.path}
Arraste para mudar a ordem`}
                        >
                          {!onSetProjectIcon && (
                            <span className="lateral-avatar grid h-8 w-8 shrink-0 place-items-center border border-border-subtle">
                              <FolderIcon className="h-3.5 w-3.5 text-accent" aria-hidden />
                            </span>
                          )}
                          <span className="min-w-0 flex-1">
                            <span className={`block truncate text-xs leading-4 ${
                              project.id === activeProjectId ? "font-semibold text-text-primary" : "text-text-secondary"
                            }`}>{project.name}</span>
                            <span aria-hidden className="mt-0.5 flex">
                              <ResumoDeAgentes
                                sessions={agentSessions.filter((session) => session.project_id === project.id)}
                                naoVistas={naoVistas}
                              />
                            </span>
                          </span>
                        </button>
                        {onSetProjectIcon && (
                          <button
                            type="button"
                            aria-label={`Escolher ícone do projeto ${project.name}`}
                            title="Trocar ícone (favicon de um dos projetos)"
                            onPointerDown={(event) => event.stopPropagation()}
                            onClick={() => setPedidosDeIcone((atual) => ({ ...atual, [project.id]: (atual[project.id] ?? 0) + 1 }))}
                            className="grid w-7 shrink-0 place-items-center text-text-muted opacity-60 hover:text-accent hover:opacity-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
                          >
                            <ImageIcon className="h-3 w-3" aria-hidden />
                          </button>
                        )}
                        <button
                          type="button"
                          aria-label={`Fechar projeto ${project.name}`}
                          title="Fechar projeto"
                          onClick={() => onCloseProject(project.id)}
                          className="grid w-8 shrink-0 place-items-center text-text-muted opacity-60 hover:text-danger hover:opacity-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
                        >
                          <CloseIcon className="h-3.5 w-3.5" aria-hidden="true" />
                        </button>
                      </div>
                    ))
                  )}
                </div>

                {(["CHATS", "TERMINALS"] as const).map((section) => {
                  // CHATS = conversas com um agente de IA; TERMINALS = shells (npm run dev, git…).
                  const lista = terminalSessions.filter((session) => Boolean(session.provider) === (section === "CHATS"))
                    // Conversas: a mexida por último primeiro. Terminais ficam na ordem em que foram abertos.
                    .sort((a, b) => section === "CHATS" ? (b.last_activity_at_ms ?? 0) - (a.last_activity_at_ms ?? 0) : 0);
                  return (
                    <Fragment key={section}>
                    <SidebarSection label={section} icon={section === "CHATS" ? ChatIcon : TerminalIcon}
                      disabled={!activeProjectId} contagem={lista.length}>
                      {lista.length > 0 ? lista.map((session) => (
                        <div key={session.id}
                          data-status={session.provider ? statusDaConversa(session, naoVistas.has(conversationKey(session))) : session.state === "working" ? "trabalhando" : undefined}
                          className={`lateral-item group relative mx-1 flex items-stretch border-l-2 ring-1 ring-inset transition-colors ${
                            session.id === activeSessionId
                              ? "lateral-item-ativo ring-accent/50"
                              : "ring-border-subtle/40 hover:ring-border-subtle"
                          } ${
                            session.provider ? destaqueDaLinha(statusDaConversa(session, naoVistas.has(conversationKey(session)))) : "border-transparent"
                          }`}>
                          <SessionLabel
                            session={session}
                            ativa={session.id === activeSessionId}
                            naoVista={naoVistas.has(conversationKey(session))}
                            conta={session.profile_id ? contas[session.profile_id] : undefined}
                            agora={agora}
                            onAttach={onAttachTerminal}
                          />
                          {/* Ações só no hover/foco, por cima do fim da linha: fora dele o espaço é do nome. */}
                          <div className="lateral-acoes absolute inset-y-0 right-0 hidden items-stretch border-l border-border-subtle bg-bg-elevated pl-0.5 shadow-[-12px_0_12px_-4px_rgb(var(--c-bg-elevated))] group-focus-within:flex group-hover:flex">
                          <button
                            type="button"
                            aria-label={session.provider ? `Bifurcar conversa ${session.name}` : `Duplicar terminal ${session.name}`}
                            title={session.provider
                              ? "Bifurcar: abre uma conversa nova com todo o histórico desta, que segue independente"
                              : "Duplicar: abre outro terminal na mesma pasta"}
                            onClick={() => onDuplicateTerminal(session.id)}
                            className="grid w-6 shrink-0 place-items-center text-text-muted opacity-60 hover:text-text-primary hover:opacity-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
                          >
                            {session.provider ? <GitBranchIcon className="h-3.5 w-3.5" aria-hidden="true" /> : <CopyIcon className="h-3.5 w-3.5" aria-hidden="true" />}
                          </button>
                          <button
                            type="button"
                            aria-label={`Reiniciar agente ${session.name}`}
                            title="Reiniciar sessão"
                            onClick={() => onRestartTerminal(session.id)}
                            className="grid w-6 shrink-0 place-items-center text-text-muted opacity-60 hover:text-text-primary hover:opacity-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
                          >
                            <ReloadIcon className="h-3.5 w-3.5" aria-hidden="true" />
                          </button>
                          <button
                            type="button"
                            aria-label={`Fechar agente ${session.name}`}
                            title="Encerrar e remover agente"
                            onClick={() => onCloseTerminal(session.id)}
                            className="grid w-6 shrink-0 place-items-center text-text-muted opacity-60 hover:text-danger hover:opacity-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
                          >
                            <CloseIcon className="h-3.5 w-3.5" aria-hidden="true" />
                          </button>
                          </div>
                        </div>
                      )) : undefined}
                    </SidebarSection>
                    {section === "CHATS" && onResumeHistory && (
                      <RecentesConversas agora={agora} onRetomar={onResumeHistory} onVerTodas={onOpenHistory}
                        abertas={agentSessions.flatMap((sessao) => sessao.external_session_id ? [sessao.external_session_id] : [])} />
                    )}
                    </Fragment>
                  );
                })}
              </>
            ) : ABAS[id].precisaProjeto && !activeProjectId ? (
              <p className="px-3 py-1.5 text-xs text-text-muted">Abra um projeto para ver {ABAS[id].rotulo.toLowerCase()}.</p>
            ) : (
              <div className="space-y-1">
                <p className="flex items-center gap-2 px-3 pt-1 text-[10px] font-medium uppercase tracking-wider text-text-muted">
                  {(() => { const Icone = ABAS[id].icone; return <Icone className="h-3 w-3 shrink-0" aria-hidden />; })()}
                  {ABAS[id].rotulo}
                </p>
                {id === "files" ? (
                  <FileTree projectPath={activeProjectPath} onOpenFile={onOpenFile} onFileRenamed={onFileRenamed} onPathDeleted={onPathDeleted} />
                ) : id === "docker" ? (
                  <DockerPanel onRunInTerminal={onRunInTerminal} />
                ) : id === "servidores" ? (
                  <ServidoresPanel />
                ) : id === "skills" ? (
                  <SkillsList projectPath={activeProjectPath} onOpenFile={onOpenFile} />
                ) : id === "git" ? (
                  <GitPanel projectPath={activeProjectPath} onOpenDiff={onOpenGitDiff} onOpenGraph={onOpenGitGraph} />
                ) : (
                  <KanbanPanel projectId={activeProjectId} kanban={kanban} onOpenBoard={onOpenKanban} />
                )}
              </div>
            )}
          </nav>
        ))}
      </div>

      {/* Footer */}
      <div className="px-2 py-3 border-t border-border-subtle/60 space-y-0.5">
        {onOpenFluxos && (
          <NavItem
            active={showFluxos}
            onClick={onOpenFluxos}
            icon={<CircuitIcon className="w-4 h-4" aria-hidden="true" />}
            label="Fluxos de agentes"
          />
        )}
        <NavItem
          active={showHistory}
          onClick={onOpenHistory}
          icon={<ChatIcon className="w-4 h-4" aria-hidden="true" />}
          label="Histórico"
        />
        <NavItem
          active={showSettings}
          onClick={() => onOpenSettings()}
          icon={<Sliders className="w-4 h-4" aria-hidden="true" />}
          label="Configurações"
        />
      </div>

      {pickerAberto && (
        <ProjectPicker
          onClose={() => setPickerAberto(false)}
          onPick={(path) => {
            setPickerAberto(false);
            onAddProject(path);
          }}
        />
      )}
    </aside>
  );
}

/** Nome da sessão na lista, renomeável no duplo clique — é o nome da conversa, o mesmo que a aba e
 *  o celular mostram. */
function SessionLabel({
  session,
  ativa,
  naoVista,
  conta,
  agora,
  onAttach,
}: {
  session: TerminalSession;
  /** É a aba em foco. */
  ativa: boolean;
  /** Há um aviso desta conversa que você ainda não viu — é o que separa "finalizado" de neutro. */
  naoVista: boolean;
  /** Nome da conta em que a conversa roda (só agente). */
  conta?: string;
  agora: number;
  onAttach: (sessionId: string, title: string) => void;
}) {
  const status = statusDaConversa(session, naoVista);
  const [editando, setEditando] = useState(false);
  const agente = Boolean(session.provider);
  // Segunda linha: o que está acontecendo, onde e há quanto tempo — como a lista da web.
  const situacao = agente
    ? rotuloDoStatus(status) || (session.state === "stopped" || session.state === "orphan" ? "encerrada" : "pronta")
    : session.state === "working" ? "rodando" : session.state === "stopped" || session.state === "crashed" ? "encerrado" : "parado";
  const tempo = session.last_activity_at_ms ? haQuantoTempo(session.last_activity_at_ms, agora) : null;

  if (editando) {
    return (
      <span className="min-w-0 flex-1 px-2 py-1.5">
        <EditableLabel
          value={session.name}
          editing
          onEditingChange={setEditando}
          label={`Renomear ${session.provider ? "conversa" : "terminal"} ${session.name}`}
          onCommit={(nome) => void renameSession(session, nome).catch(() => undefined)}
        />
      </span>
    );
  }

  return (
    <button
      type="button"
      onClick={() => onAttach(session.id, session.name)}
      onDoubleClick={() => setEditando(true)}
      aria-current={ativa ? "true" : undefined}
      className="flex min-w-0 flex-1 items-center gap-2.5 px-2 py-2 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
      title={`${session.name}${rotuloDoStatus(status) ? ` · ${rotuloDoStatus(status)}` : ""} — duplo clique renomeia`}
    >
      <span className={`lateral-avatar relative grid h-8 w-8 shrink-0 place-items-center border border-border-subtle${
        status === "trabalhando" || (!agente && session.state === "working") ? " lateral-avatar-vivo" : ""}`}>
        {agente
          ? <AgentIcon provider={session.provider} size={16} />
          : <TerminalIcon className={`h-3.5 w-3.5 ${session.state === "working" ? "text-success" : "text-text-muted"}`} aria-hidden />}
        {agente && status !== "neutro" && (
          <span className="absolute -bottom-1 -right-1 grid h-3.5 w-3.5 place-items-center border border-border-subtle bg-bg-surface">
            <IconeDoStatus status={status} className="!h-2.5 !w-2.5" />
          </span>
        )}
        {agente && <IconeDoProjetoDaSessao cwd={session.cwd} />}
      </span>
      <span className="min-w-0 flex-1">
        {/* Linha 1: nome e há quanto tempo, como numa lista de mensagens. Linha 2: situação e conta. */}
        <span className="flex min-w-0 items-baseline gap-2">
          <span className={`min-w-0 flex-1 truncate text-xs leading-4 ${
            ativa || status !== "neutro" || session.state === "working" ? "font-semibold text-text-primary" : "text-text-secondary"
          }`}>{session.name}</span>
          {tempo && <span className="shrink-0 text-[10px] leading-4 text-text-muted tabular-nums">{tempo}</span>}
        </span>
        <span className="mt-0.5 flex min-w-0 items-center gap-1 text-[10px] leading-4 text-text-muted">
          <span className={`shrink-0 ${status === "neutro" ? "" : "font-semibold"} ${corDaSituacao(status, session.state)}`}>{situacao}</span>
          {conta && <><span aria-hidden>·</span><span className="truncate">{conta}</span></>}
        </span>
      </span>
      <EtiquetaDoStatus status={status} className="hidden" />
    </button>
  );
}

/** Ícone do projeto no canto do avatar, como nos Recentes e no Histórico. */
function IconeDoProjetoDaSessao({ cwd }: { cwd: string }) {
  const projeto = useProjetoDaPasta(cwd);
  return (
    <span className="lateral-recente-projeto" aria-hidden>
      <SimboloDoProjeto project={projeto ?? { path: cwd }} className="h-2.5 w-2.5" />
    </span>
  );
}

/** Cor da palavra de situação: a mesma do selo do status; terminal rodando fica verde. */
function corDaSituacao(status: ReturnType<typeof statusDaConversa>, state: TerminalSession["state"]): string {
  if (status === "trabalhando" || (status === "neutro" && state === "working")) return "text-success";
  if (status === "aprovacao") return "text-warning";
  if (status === "interrompido") return "text-danger";
  if (status === "finalizado") return "text-accent";
  return "";
}

function SidebarSection({
  label,
  icon: Icon,
  disabled,
  contagem,
  children,
}: {
  label: string;
  icon?: React.ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
  disabled: boolean;
  /** Quantos itens a seção tem (chats e terminais): aparece ao lado do título. */
  contagem?: number;
  children?: React.ReactNode;
}) {
  const [open, setOpen] = useState(true);
  return (
    <div className="space-y-0.5">
      <button
        type="button"
        data-nav-item
        aria-expanded={open}
        disabled={disabled}
        onClick={() => setOpen((value) => !value)}
        className="lateral-secao w-full flex items-center gap-2 text-text-muted text-[10px] font-medium uppercase tracking-wider px-3 pt-1 disabled:opacity-40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
      >
        <ChevronDownIcon
          className={`h-3 w-3 shrink-0 transition-transform ${open ? "" : "-rotate-90"}`}
          aria-hidden="true"
        />
        {Icon && <Icon className="w-3 h-3 shrink-0" aria-hidden />}
        {label}
        {!disabled && contagem !== undefined && contagem > 0 && (
          <span aria-hidden className="ml-auto min-w-[1.125rem] border border-border-subtle bg-overlay/[0.06] px-1 text-center text-[9px] leading-[14px] tabular-nums">
            {contagem}
          </span>
        )}
      </button>
      {open && !disabled && (contagem !== undefined && contagem > 0
        ? <div className="space-y-1 pt-0.5">{children}</div>
        : children ?? <p data-nav-item className="text-text-muted text-xs px-6 py-1.5">Vazio</p>)}
    </div>
  );
}

function NavItem({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
}) {
  const barRef = useRef<HTMLSpanElement>(null);

  // Barra de acento cresce ao virar ativo; some ao sair.
  useEffect(() => {
    const bar = barRef.current;
    if (!bar) return;
    gsap.to(bar, {
      scaleY: active ? 1 : 0,
      opacity: active ? 1 : 0,
      duration: 0.32,
      ease: active ? "back.out(2)" : "power2.in",
    });
  }, [active]);

  return (
    <button
      data-nav-item
      onClick={onClick}
      className={[
        "relative w-full flex items-center gap-2.5 px-3 py-2 rounded-none text-sm transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent",
        active
          ? "glass text-text-primary font-medium"
          : "text-text-secondary hover:text-text-primary hover:bg-overlay/[0.07]",
      ].join(" ")}
    >
      <span
        ref={barRef}
        aria-hidden="true"
        className={[
          "absolute left-0 top-1.5 bottom-1.5 w-0.5 rounded-none origin-center opacity-0 scale-y-0",
          active ? "neon-bar" : "bg-border",
        ].join(" ")}
      />
      <span className={active ? "neon" : ""}>{icon}</span>
      <span className="truncate">{label}</span>
    </button>
  );
}
