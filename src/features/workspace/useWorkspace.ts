import { useEffect, useReducer, useRef } from "react";
import { loadWorkspaces, saveWorkspaces } from "../../services/workspaceService";
import { publishWorkspace, type PublishedTheme } from "../terminal/terminalService";
import { workspacesReducer } from "./workspacesReducer";
import { iconeEfetivo, iconesDe } from "../projects/iconesDoProjeto";

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
    const unicos = [
      ...new Map(collection.workspaces.flatMap((workspace) => workspace.projects.map((project) => [project.id, project] as const))).values(),
    ];
    let vivo = true;
    // O ícone vai junto (o mesmo que a lateral mostra): sem escolha, o favicon achado na varredura,
    // que tem cache por pasta — publicar de novo não varre de novo.
    void Promise.all(unicos.map(async (project) => {
      const icone = iconeEfetivo(project.icone, project.icone === undefined ? await iconesDe(project.path) : null);
      return { id: project.id, name: project.name, path: project.path, ...(icone ? { icone } : {}) };
    })).then((projetos) => {
      const projecao = JSON.stringify([projetos, tema]);
      if (!vivo || projecao === publicado.current) return;
      publicado.current = projecao;
      // Engine fora do ar é estado normal aqui: o celular fica com a última lista gravada em disco.
      void publishWorkspace(projetos, tema).catch(() => undefined);
    });
    return () => { vivo = false; };
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
