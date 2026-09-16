import type { Project, WorkspacesAction } from "../../types/workspace";
import type { KanbanAction, KanbanState } from "../../types/kanban";
import type { AttentionItem } from "../terminal/useAttention";
import { AgentUsageStatus } from "../terminal/AgentUsageStatus";
import { findPane } from "./workspaceReducer";
import { LayoutPresetPicker } from "./LayoutPresetPicker";
import { PaneTree } from "./PaneTree";
import { useWorkspaceKeymap } from "./useWorkspaceKeymap";

interface WorkspaceViewProps {
  project: Project | null;
  engineOnline: boolean;
  attention: AttentionItem[];
  fileSaveMode: "auto" | "manual";
  kanban: KanbanState;
  kanbanDispatch: React.Dispatch<KanbanAction>;
  dispatch: React.Dispatch<WorkspacesAction>;
}

export function WorkspaceView({
  project,
  engineOnline,
  attention,
  fileSaveMode,
  kanban,
  kanbanDispatch,
  dispatch,
}: WorkspaceViewProps) {
  useWorkspaceKeymap(project, attention, dispatch);

  if (!project) {
    return (
      <div className="h-full flex items-center justify-center text-center px-6">
        <div className="space-y-2">
          <p className="pixel-text text-text-primary text-xs">READY PLAYER ONE</p>
          <p className="text-text-secondary text-sm">Nenhum painel aberto</p>
          <p className="text-text-muted text-xs">Adicione um projeto na barra lateral para começar.</p>
        </div>
      </div>
    );
  }

  const paneCount = countPanes(project.layout);
  // Aba em foco: é ela que decide de quem é o uso no rodapé.
  const panePrincipal = findPane(project.layout, project.activePaneId);
  const abaAtiva = panePrincipal?.tabs.find((tab) => tab.id === panePrincipal.activeTabId) ?? null;

  return (
    <div className="h-full min-h-0 flex flex-col">
      <div className="h-11 shrink-0 px-4 flex items-center justify-between border-b-2 border-border-subtle bg-bg-primary/80">
        <div className="min-w-0">
          <h1 className="pixel-text text-text-primary text-xs truncate">{project.name}</h1>
          <p className="text-text-muted text-[10px] truncate" title={project.path}>{project.path}</p>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-[10px] text-text-muted uppercase">{paneCount} {paneCount === 1 ? "painel" : "painéis"}</span>
          <LayoutPresetPicker dispatch={dispatch} />
        </div>
      </div>

      <div className="flex flex-1 min-h-0 p-2">
        <PaneTree
          node={project.layout}
          activePaneId={project.activePaneId}
          maximizedPaneId={project.maximizedPaneId}
          paneCount={paneCount}
          projectId={project.id}
          projectPath={project.path}
          fileSaveMode={fileSaveMode}
          kanban={kanban}
          kanbanDispatch={kanbanDispatch}
          dispatch={dispatch}
        />
      </div>

      <footer className="h-7 shrink-0 px-3 flex items-center justify-between gap-3 overflow-hidden whitespace-nowrap border-t-2 border-border-subtle bg-bg-elevated text-[10px] text-text-muted">
        <span className="hidden md:inline">● UI CONNECTED</span>
        <span className="flex min-w-0 flex-1 md:flex-none items-center justify-between md:justify-end gap-3 lg:gap-4">
          <AgentUsageStatus engineOnline={engineOnline} activeSessionId={abaAtiva?.resourceId ?? null} />
          <span className="shrink-0">ENGINE: {engineOnline ? "ONLINE" : "CONNECTING"}</span>
        </span>
      </footer>
    </div>
  );
}

function countPanes(node: Project["layout"]): number {
  return node.type === "pane" ? 1 : countPanes(node.first) + countPanes(node.second);
}
