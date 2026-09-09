import type { Project, WorkspaceAction } from "../../types/workspace";
import type { KanbanAction, KanbanState } from "../../types/kanban";
import type { TerminalSession } from "../terminal/terminalService";
import { LayoutPresetPicker } from "./LayoutPresetPicker";
import { PaneTree } from "./PaneTree";
import { useWorkspaceKeymap } from "./useWorkspaceKeymap";

interface WorkspaceViewProps {
  project: Project | null;
  engineOnline: boolean;
  sessions: TerminalSession[];
  fileSaveMode: "auto" | "manual";
  kanban: KanbanState;
  kanbanDispatch: React.Dispatch<KanbanAction>;
  dispatch: React.Dispatch<WorkspaceAction>;
}

export function WorkspaceView({
  project,
  engineOnline,
  sessions,
  fileSaveMode,
  kanban,
  kanbanDispatch,
  dispatch,
}: WorkspaceViewProps) {
  useWorkspaceKeymap(project, sessions, dispatch);

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

      <footer className="h-7 shrink-0 px-3 flex items-center justify-between border-t-2 border-border-subtle bg-bg-elevated text-[10px] text-text-muted">
        <span>● UI CONNECTED</span>
        <span>ENGINE: {engineOnline ? "ONLINE" : "CONNECTING"}</span>
      </footer>
    </div>
  );
}

function countPanes(node: Project["layout"]): number {
  return node.type === "pane" ? 1 : countPanes(node.first) + countPanes(node.second);
}
