import { useEffect, useReducer } from "react";
import { loadWorkspaces, saveWorkspaces } from "../../services/workspaceService";
import { workspacesReducer } from "./workspacesReducer";

export function useWorkspace() {
  const [collection, dispatch] = useReducer(workspacesReducer, undefined, loadWorkspaces);

  useEffect(() => {
    saveWorkspaces(collection);
  }, [collection]);

  const workspace =
    collection.workspaces.find((item) => item.id === collection.activeWorkspaceId) ?? collection.workspaces[0];

  const activeProject =
    workspace.projects.find((project) => project.id === workspace.activeProjectId) ?? null;

  return {
    workspace,
    activeProject,
    dispatch,
    workspaces: collection.workspaces,
    activeWorkspaceId: collection.activeWorkspaceId,
  };
}
