import { emptyWorkspace } from "../../services/workspaceService";
import type { WorkspaceCollection, WorkspaceState, WorkspacesAction } from "../../types/workspace";
import { moverAntes, workspaceReducer } from "./workspaceReducer";

let sequence = 0;

function nextWorkspaceId(): string {
  sequence += 1;
  return `workspace-${Date.now().toString(36)}-${sequence.toString(36)}`;
}

function novoWorkspace(state: WorkspaceCollection, name?: string): WorkspaceState {
  return {
    ...emptyWorkspace(),
    id: nextWorkspaceId(),
    name: name?.trim() || `Workspace ${state.workspaces.length + 1}`,
  };
}

/** Workspace que fica ativo quando o atual sai da lista: o primeiro visível que sobrou. Sem nenhum,
 *  um novo — o app nunca fica sem workspace aberto. */
function comAtivoVisivel(state: WorkspaceCollection, saindo: string): WorkspaceCollection {
  if (state.activeWorkspaceId !== saindo && state.workspaces.some((w) => w.id === state.activeWorkspaceId && !w.hidden)) return state;
  const visivel = state.workspaces.find((w) => !w.hidden && w.id !== saindo);
  if (visivel) return { ...state, activeWorkspaceId: visivel.id };
  const novo = novoWorkspace(state);
  return { ...state, workspaces: [...state.workspaces, novo], activeWorkspaceId: novo.id };
}

/** Mexer num workspace escondido (focar um agente dele) o traz de volta para a lista. */
function mostrar(state: WorkspaceCollection, workspaceId: string): WorkspaceState[] {
  return state.workspaces.map((w) => (w.id === workspaceId && w.hidden ? { ...w, hidden: false } : w));
}

export function workspacesReducer(state: WorkspaceCollection, action: WorkspacesAction): WorkspaceCollection {
  switch (action.type) {
    case "ADD_WORKSPACE": {
      const workspace = novoWorkspace(state, action.name);
      return { ...state, workspaces: [...state.workspaces, workspace], activeWorkspaceId: workspace.id };
    }
    case "SELECT_WORKSPACE":
    case "SHOW_WORKSPACE":
      return state.workspaces.some((workspace) => workspace.id === action.workspaceId)
        ? { ...state, workspaces: mostrar(state, action.workspaceId), activeWorkspaceId: action.workspaceId }
        : state;
    case "HIDE_WORKSPACE": {
      if (!state.workspaces.some((w) => w.id === action.workspaceId && !w.hidden)) return state;
      const escondido = { ...state, workspaces: state.workspaces.map((w) => (w.id === action.workspaceId ? { ...w, hidden: true } : w)) };
      return comAtivoVisivel(escondido, action.workspaceId);
    }
    case "DELETE_WORKSPACE": {
      const remaining = state.workspaces.filter((workspace) => workspace.id !== action.workspaceId);
      if (remaining.length === state.workspaces.length) return state;
      return comAtivoVisivel({ ...state, workspaces: remaining }, action.workspaceId);
    }
    case "MOVE_WORKSPACE": {
      const workspaces = moverAntes(state.workspaces, action.workspaceId, action.beforeId);
      return workspaces === state.workspaces ? state : { ...state, workspaces };
    }
    case "CLOSE_PROJECT_IN_WORKSPACE":
      return {
        ...state,
        workspaces: state.workspaces.map((workspace) =>
          workspace.id === action.workspaceId ? workspaceReducer(workspace, { type: "CLOSE_PROJECT", projectId: action.projectId }) : workspace
        ),
      };
    case "RENAME_WORKSPACE": {
      const name = action.name.trim();
      return {
        ...state,
        workspaces: state.workspaces.map((workspace) =>
          workspace.id === action.workspaceId ? { ...workspace, name: name || workspace.name } : workspace
        ),
      };
    }
    case "FOCUS_SESSION": {
      const target = state.workspaces.find((workspace) => workspace.id === action.workspaceId);
      // Sem o projeto dentro do workspace alvo, o SELECT_PROJECT abaixo viraria no-op e o
      // ATTACH_TERMINAL grudaria a sessão no projeto errado — o bug que essa ação existe pra matar.
      if (!target?.projects.some((project) => project.id === action.projectId)) return state;
      const selected = workspaceReducer(target, { type: "SELECT_PROJECT", projectId: action.projectId });
      // Ordem importa: ATTACH_TERMINAL passa por `updateActiveProject`, então só acha a pane certa
      // depois que o projeto alvo já é o ativo.
      const focused = workspaceReducer(selected, {
        type: "ATTACH_TERMINAL",
        sessionId: action.sessionId,
        title: action.title,
      });
      return {
        ...state,
        activeWorkspaceId: action.workspaceId,
        workspaces: state.workspaces.map((workspace) =>
          workspace.id === action.workspaceId ? { ...focused, hidden: false } : workspace
        ),
      };
    }
    default: {
      if (!state.activeWorkspaceId) return state;
      return {
        ...state,
        workspaces: state.workspaces.map((workspace) =>
          workspace.id === state.activeWorkspaceId ? workspaceReducer(workspace, action) : workspace
        ),
      };
    }
  }
}
