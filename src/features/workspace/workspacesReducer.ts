import { emptyWorkspace } from "../../services/workspaceService";
import type { WorkspaceCollection, WorkspacesAction } from "../../types/workspace";
import { workspaceReducer } from "./workspaceReducer";

let sequence = 0;

function nextWorkspaceId(): string {
  sequence += 1;
  return `workspace-${Date.now().toString(36)}-${sequence.toString(36)}`;
}

export function workspacesReducer(state: WorkspaceCollection, action: WorkspacesAction): WorkspaceCollection {
  switch (action.type) {
    case "ADD_WORKSPACE": {
      const workspace = {
        ...emptyWorkspace(),
        id: nextWorkspaceId(),
        name: action.name?.trim() || `Workspace ${state.workspaces.length + 1}`,
      };
      return { ...state, workspaces: [...state.workspaces, workspace], activeWorkspaceId: workspace.id };
    }
    case "SELECT_WORKSPACE":
      return state.workspaces.some((workspace) => workspace.id === action.workspaceId)
        ? { ...state, activeWorkspaceId: action.workspaceId }
        : state;
    case "CLOSE_WORKSPACE": {
      const remaining = state.workspaces.filter((workspace) => workspace.id !== action.workspaceId);
      if (remaining.length === state.workspaces.length) return state;
      // Nunca deixa o app sem workspace nenhum.
      const workspaces = remaining.length > 0 ? remaining : [emptyWorkspace()];
      const activeWorkspaceId =
        state.activeWorkspaceId === action.workspaceId ? workspaces[0].id : (state.activeWorkspaceId ?? workspaces[0].id);
      return { ...state, workspaces, activeWorkspaceId };
    }
    case "RENAME_WORKSPACE": {
      const name = action.name.trim();
      return {
        ...state,
        workspaces: state.workspaces.map((workspace) =>
          workspace.id === action.workspaceId ? { ...workspace, name: name || workspace.name } : workspace
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
