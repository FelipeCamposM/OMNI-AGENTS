import { useState } from "react";
import { BoxIcon, CloseIcon, EditIcon, FolderPlusIcon } from "./ui/PixelIcon";
import type { WorkspaceState } from "../types/workspace";

interface WorkspaceListProps {
  workspaces: WorkspaceState[];
  activeWorkspaceId: string | null;
  attentionByWorkspace: Record<string, number>;
  onSelect: (workspaceId: string) => void;
  onCreate: () => void;
  onClose: (workspaceId: string) => void;
  onRename: (workspaceId: string, name: string) => void;
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
  attentionByWorkspace,
  onSelect,
  onCreate,
  onClose,
  onRename,
}: WorkspaceListProps) {
  const [editandoId, setEditandoId] = useState<string | null>(null);

  function confirmarRename(workspaceId: string, valor: string) {
    setEditandoId(null);
    const nome = valor.trim();
    if (nome) onRename(workspaceId, nome);
  }

  return (
    <div className="space-y-0.5">
      <div className="flex items-center justify-between px-3 pt-1">
        <p className="text-text-muted text-[10px] font-medium uppercase tracking-wider">Workspaces</p>
        <button
          data-nav-item
          type="button"
          onClick={onCreate}
          aria-label="Criar workspace"
          title="Criar workspace"
          className="text-text-muted hover:text-text-primary rounded-none p-0.5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
        >
          <FolderPlusIcon className="w-3.5 h-3.5" aria-hidden="true" />
        </button>
      </div>

      {workspaces.map((workspace) => {
        const pendentes = attentionByWorkspace[workspace.id] ?? 0;
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
          <div key={workspace.id} className="group flex items-stretch">
            <button
              type="button"
              data-nav-item
              aria-current={ativo ? "page" : undefined}
              onClick={() => onSelect(workspace.id)}
              onDoubleClick={(event) => {
                event.stopPropagation();
                setEditandoId(workspace.id);
              }}
              title="Clique duplo para renomear"
              className={[
                "min-w-0 flex-1 flex items-center gap-2 px-3 py-2 text-left text-xs border-l-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent",
                ativo
                  ? "border-accent bg-accent-muted text-text-primary"
                  : "border-transparent text-text-secondary hover:text-text-primary hover:bg-overlay/[0.07]",
              ].join(" ")}
            >
              <BoxIcon className="w-3 h-3 shrink-0 text-accent" aria-hidden />
              <span className="min-w-0 flex-1 truncate">{workspace.name}</span>
              {pendentes > 0 && (
                <span
                  aria-label={`${pendentes} ${pendentes === 1 ? "agente esperando" : "agentes esperando"} em ${workspace.name}`}
                  className="badge-pulse grid h-4 min-w-4 shrink-0 place-items-center bg-danger px-1 text-[10px] font-bold leading-none text-bg-primary"
                >
                  {pendentes > 9 ? "9+" : pendentes}
                </span>
              )}
            </button>
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
              title="Fechar workspace"
              onClick={() => onClose(workspace.id)}
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
