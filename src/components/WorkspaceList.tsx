import { SelosDeAtencao } from "./AttentionPanel";
import type { AttentionItem } from "../features/terminal/useAttention";
import { useState } from "react";
import { AvatarDoWorkspace } from "./EscolherIcone";
import { ImageIcon } from "./ui/PixelIcon";
import { BoxIcon, CloseIcon, EditIcon, FolderPlusIcon, SlidersIcon } from "./ui/PixelIcon";
import { ResumoDeAgentes } from "./ConversaStatus";
import { AbrirWorkspace, GerenciarWorkspaces } from "./WorkspaceModais";
import { arrastarParaOrdenar } from "../lib/ordenarArrastando";
import type { TerminalSession } from "../features/terminal/terminalService";
import type { WorkspaceState } from "../types/workspace";

interface WorkspaceListProps {
  workspaces: WorkspaceState[];
  activeWorkspaceId: string | null;
  attention: AttentionItem[];
  /** Conversas de agente de todos os projetos (resumo por workspace). */
  agentSessions?: TerminalSession[];
  naoVistas?: Set<string>;
  onSelect: (workspaceId: string) => void;
  onCreate: (name: string) => void;
  /** Fechar na lateral só esconde: reabre pelo "+" ou pelo Gerenciar. */
  onHide: (workspaceId: string) => void;
  onShow: (workspaceId: string) => void;
  /** Excluir de vez (Gerenciar → confirmação). */
  onDelete: (workspaceId: string) => void;
  onMove: (workspaceId: string, beforeId: string | null) => void;
  onRemoveProject: (workspaceId: string, projectId: string) => void;
  onRename: (workspaceId: string, name: string) => void;
  /** Trocar o símbolo (favicon de um dos projetos). */
  onSetIcon?: (workspaceId: string, icone: string | null | undefined) => void;
}

/**
 * Lista de workspaces sempre visível, no lugar do antigo dropdown (`WorkspaceSwitcher`). O
 * dropdown escondia tanto a natureza da coisa ("Workspace 1" parecia um rótulo, não um seletor)
 * quanto o aviso de agente pendente, que é justamente o que precisa ser visto sem clique.
 *
 * Sem portal aqui: a máquina de `createPortal` + medição do switcher existia só porque um popover
 * dentro da `<aside>.glass` cai no contexto de empilhamento dela (ver `NotificationBell`). Uma
 * lista no fluxo normal não tem esse problema.
 */
export function WorkspaceList({
  workspaces,
  activeWorkspaceId,
  attention,
  agentSessions = [],
  naoVistas = new Set(),
  onSelect,
  onCreate,
  onHide,
  onShow,
  onDelete,
  onMove,
  onRemoveProject,
  onRename,
  onSetIcon,
}: WorkspaceListProps) {
  const [editandoId, setEditandoId] = useState<string | null>(null);
  // Pedido de abrir o seletor de ícone pelo botão da linha (o avatar é que ancora o painel).
  const [pedidosDeIcone, setPedidosDeIcone] = useState<Record<string, number>>({});
  const [modal, setModal] = useState<"abrir" | "gerenciar" | null>(null);
  const visiveis = workspaces.filter((workspace) => !workspace.hidden);

  function confirmarRename(workspaceId: string, valor: string) {
    setEditandoId(null);
    const nome = valor.trim();
    if (nome) onRename(workspaceId, nome);
  }

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between px-3 pt-1">
        <p className="text-text-muted text-[10px] font-medium uppercase tracking-wider">Workspaces</p>
        <span className="flex items-center gap-1">
          <button
            data-nav-item
            type="button"
            onClick={() => setModal("gerenciar")}
            aria-label="Gerenciar workspaces"
            title="Gerenciar workspaces"
            className="text-text-muted hover:text-text-primary rounded-none p-0.5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
          >
            <SlidersIcon className="w-3.5 h-3.5" aria-hidden="true" />
          </button>
          <button
            data-nav-item
            type="button"
            onClick={() => setModal("abrir")}
            aria-label="Abrir workspace"
            title="Abrir workspace: um novo ou um já existente"
            className="text-text-muted hover:text-text-primary rounded-none p-0.5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
          >
            <FolderPlusIcon className="w-3.5 h-3.5" aria-hidden="true" />
          </button>
        </span>
      </div>

      {modal === "abrir" && (
        <AbrirWorkspace workspaces={workspaces} onFechar={() => setModal(null)}
          onNovo={(nome) => { onCreate(nome); setModal(null); }}
          onReabrir={(id) => { onShow(id); setModal(null); }} />
      )}
      {modal === "gerenciar" && (
        <GerenciarWorkspaces workspaces={workspaces} activeWorkspaceId={activeWorkspaceId} agentSessions={agentSessions}
          onFechar={() => setModal(null)} onAbrir={(id) => { onShow(id); setModal(null); }}
          onExcluir={onDelete} onRemoverProjeto={onRemoveProject} />
      )}

      {visiveis.map((workspace) => {
        const pendentes = attention.filter((item) => item.workspaceId === workspace.id);
        const ativo = workspace.id === activeWorkspaceId;

        if (editandoId === workspace.id) {
          return (
            <div key={workspace.id} className="flex items-stretch px-0.5">
              <input
                type="text"
                autoFocus
                defaultValue={workspace.name}
                aria-label={`Renomear workspace ${workspace.name}`}
                onFocus={(event) => event.currentTarget.select()}
                onBlur={(event) => confirmarRename(workspace.id, event.currentTarget.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") event.currentTarget.blur();
                  else if (event.key === "Escape") {
                    event.stopPropagation();
                    setEditandoId(null);
                  }
                }}
                className="min-w-0 flex-1 bg-transparent px-2 py-1.5 text-xs text-text-primary outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
              />
            </div>
          );
        }

        return (
          <div key={workspace.id}
            data-ordem="workspaces" data-ordem-id={workspace.id}
            onPointerDown={(evento) => arrastarParaOrdenar(evento, "workspaces", workspace.id, onMove)}
            className={`lateral-item group mx-1 flex items-stretch border-l-2 ring-1 ring-inset transition-colors ${
              ativo ? "lateral-item-ativo border-accent ring-accent/50" : "border-transparent ring-border-subtle/40 hover:ring-border-subtle"
            }`}>
            {onSetIcon && (
              <span className="grid shrink-0 place-items-center pl-2"><AvatarDoWorkspace workspace={workspace} onEscolher={onSetIcon} pedido={pedidosDeIcone[workspace.id]} /></span>
            )}
            <button
              type="button"
              data-nav-item
              aria-current={ativo ? "page" : undefined}
              onClick={() => onSelect(workspace.id)}
              onDoubleClick={(event) => {
                event.stopPropagation();
                setEditandoId(workspace.id);
              }}
              title="Clique duplo para renomear · arraste para mudar a ordem"
              className="flex min-w-0 flex-1 items-center gap-2.5 px-2 py-2 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
            >
              {!onSetIcon && (
                <span className="lateral-avatar grid h-8 w-8 shrink-0 place-items-center border border-border-subtle">
                  <BoxIcon className="h-3.5 w-3.5 text-accent" aria-hidden />
                </span>
              )}
              <span className="min-w-0 flex-1">
                <span className={`block truncate text-xs leading-4 ${ativo ? "font-semibold text-text-primary" : "text-text-secondary"}`}>
                  {workspace.name}
                </span>
                <span aria-hidden className="mt-0.5 flex">
                  <ResumoDeAgentes
                    sessions={agentSessions.filter((session) => workspace.projects.some((project) => project.id === session.project_id))}
                    naoVistas={naoVistas}
                  />
                </span>
              </span>
              <SelosDeAtencao items={pendentes} onde={`em ${workspace.name}`} />
            </button>
            {onSetIcon && (
              <button
                type="button"
                aria-label={`Escolher ícone do workspace ${workspace.name}`}
                title="Trocar ícone (favicon de um dos projetos)"
                onPointerDown={(event) => event.stopPropagation()}
                onClick={(event) => {
                  event.stopPropagation();
                  setPedidosDeIcone((atual) => ({ ...atual, [workspace.id]: (atual[workspace.id] ?? 0) + 1 }));
                }}
                className="grid w-7 shrink-0 place-items-center text-text-muted opacity-60 hover:text-accent hover:opacity-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
              >
                <ImageIcon className="w-3 h-3" aria-hidden />
              </button>
            )}
            <button
              type="button"
              aria-label={`Renomear workspace ${workspace.name}`}
              title="Renomear"
              onClick={(event) => {
                event.stopPropagation();
                setEditandoId(workspace.id);
              }}
              className="grid w-7 shrink-0 place-items-center text-text-muted opacity-60 hover:text-accent hover:opacity-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
            >
              <EditIcon className="w-3 h-3" aria-hidden />
            </button>
            <button
              type="button"
              aria-label={`Fechar workspace ${workspace.name}`}
              title="Fechar workspace (fica guardado: reabra pelo + ou em Gerenciar)"
              onClick={() => onHide(workspace.id)}
              className="grid w-7 shrink-0 place-items-center text-text-muted opacity-60 hover:text-danger hover:opacity-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
            >
              <CloseIcon className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
