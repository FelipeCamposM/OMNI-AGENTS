import { useEffect, useReducer, useRef } from "react";
import { loadWorkspaces, saveWorkspaces } from "../../services/workspaceService";
import { publishWorkspace, type PublishedTheme } from "../terminal/terminalService";
import { workspacesReducer } from "./workspacesReducer";

/** `tema` é publicado junto com os projetos para o celular sair com a mesma cara do PC. */
export function useWorkspace(tema: PublishedTheme | null = null) {
  const [collection, dispatch] = useReducer(workspacesReducer, undefined, loadWorkspaces);
  const publicado = useRef<string | null>(null);

  useEffect(() => {
    saveWorkspaces(collection);
  }, [collection]);

  // Publica os projetos no engine para o celular enxergar. A projeção serializada **é** o debounce:
  // arrastar aba, mexer em split ou trocar de tab produz a mesma string e não gera IPC nenhum. Só
  // abrir, fechar ou renomear projeto publica de fato.
  useEffect(() => {
    const projetos = [
      ...new Map(
        collection.workspaces.flatMap((workspace) =>
          workspace.projects.map((project) => [project.id, { id: project.id, name: project.name, path: project.path }] as const)
        )
      ).values(),
    ];
    const projecao = JSON.stringify([projetos, tema]);
    if (projecao === publicado.current) return;
    publicado.current = projecao;
    // Engine fora do ar é estado normal aqui: o celular fica com a última lista gravada em disco.
    void publishWorkspace(projetos, tema).catch(() => undefined);
  }, [collection, tema]);

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
