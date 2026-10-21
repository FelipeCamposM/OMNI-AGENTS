import type { Project, WorkspacesAction } from "../../types/workspace";
import type { AgentView } from "../../types/settings";
import type { KanbanAction, KanbanState } from "../../types/kanban";
import type { AttentionItem } from "../terminal/useAttention";
import { AgentUsageStatus } from "../terminal/AgentUsageStatus";
import { GitContaStatus } from "../git/GitBranchStatus";
import { findPane } from "./workspaceReducer";
import { PaneTree } from "./PaneTree";
import { useWorkspaceKeymap } from "./useWorkspaceKeymap";

interface WorkspaceViewProps {
  project: Project | null;
  engineOnline: boolean;
  attention: AttentionItem[];
  fileSaveMode: "auto" | "manual";
  /** Aba de agente: o chat (como na web) ou o terminal cru. Ver `AgentView` em `types/settings`. */
  agentView: AgentView;
  kanban: KanbanState;
  kanbanDispatch: React.Dispatch<KanbanAction>;
  dispatch: React.Dispatch<WorkspacesAction>;
}

export function WorkspaceView({
  project,
  engineOnline,
  attention,
  fileSaveMode,
  agentView,
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
      {/* Nome, caminho e layouts do projeto ficam na barra superior (`TitleBar`). */}
      <h1 className="sr-only">{project.name}</h1>
      <div className="flex flex-1 min-h-0 p-2">
        <PaneTree
          node={project.layout}
          activePaneId={project.activePaneId}
          maximizedPaneId={project.maximizedPaneId}
          paneCount={paneCount}
          projectId={project.id}
          projectPath={project.path}
          fileSaveMode={fileSaveMode}
        agentView={agentView}
          kanban={kanban}
          kanbanDispatch={kanbanDispatch}
          dispatch={dispatch}
        />
      </div>

      <RodapeDoProjeto projectPath={project.path} engineOnline={engineOnline} activeSessionId={abaAtiva?.resourceId ?? null} />
    </div>
  );
}

/** Conta do git, uso do agente em foco e engine (o uso de todas as contas fica no botão "Uso" da barra de cima) — no workspace e nos fluxos. A branch fica no topo da conversa. */
export function RodapeDoProjeto({ projectPath, engineOnline, activeSessionId }: { projectPath: string | null; engineOnline: boolean; activeSessionId: string | null }) {
  return (
    <footer className="rodape-app">
      <span className="rodape-grupo max-w-[40%] shrink-0">
        {projectPath && <GitContaStatus projectPath={projectPath} />}
      </span>
      <span className="rodape-grupo flex-1 justify-end">
        <AgentUsageStatus engineOnline={engineOnline} activeSessionId={activeSessionId} />
        <span className="rodape-engine" data-online={engineOnline} title={engineOnline ? "Engine rodando: terminais e conversas ativos" : "Conectando ao engine…"}>
          <span className="rodape-ponto" aria-hidden />
          {engineOnline ? "Engine online" : "Conectando…"}
        </span>
      </span>
    </footer>
  );
}

function countPanes(node: Project["layout"]): number {
  return node.type === "pane" ? 1 : countPanes(node.first) + countPanes(node.second);
}
