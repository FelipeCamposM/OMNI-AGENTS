import { describe, expect, it } from "vitest";
import { workspacesReducer } from "../features/workspace/workspacesReducer";
import {
  loadWorkspaces,
  WORKSPACE_STORAGE_KEY,
  WORKSPACES_STORAGE_KEY,
} from "../services/workspaceService";
import type { WorkspaceCollection } from "../types/workspace";

function collection(): WorkspaceCollection {
  return workspacesReducer(
    { version: 1, workspaces: [], activeWorkspaceId: null },
    { type: "ADD_WORKSPACE", name: "Primeiro" }
  );
}

describe("workspacesReducer", () => {
  it("cria um segundo workspace, ativa ele e isola ações do primeiro", () => {
    let state = collection();
    const first = state.workspaces[0];

    state = workspacesReducer(state, { type: "ADD_WORKSPACE", name: "Segundo" });
    expect(state.workspaces).toHaveLength(2);
    expect(state.activeWorkspaceId).toBe(state.workspaces[1].id);

    state = workspacesReducer(state, { type: "ADD_PROJECT", path: "C:\\dev\\segundo" });
    expect(state.workspaces[1].projects).toHaveLength(1);
    expect(state.workspaces.find((ws) => ws.id === first.id)?.projects).toHaveLength(0);
  });

  it("fecha o workspace ativo e cai pro outro restante", () => {
    let state = collection();
    const first = state.workspaces[0];
    state = workspacesReducer(state, { type: "ADD_WORKSPACE", name: "Segundo" });
    const second = state.workspaces[1];

    state = workspacesReducer(state, { type: "CLOSE_WORKSPACE", workspaceId: second.id });
    expect(state.workspaces.map((ws) => ws.id)).toEqual([first.id]);
    expect(state.activeWorkspaceId).toBe(first.id);
  });

  it("renomeia um workspace sem afetar os outros", () => {
    let state = collection();
    const first = state.workspaces[0];
    state = workspacesReducer(state, { type: "ADD_WORKSPACE", name: "Segundo" });
    const second = state.workspaces[1];

    state = workspacesReducer(state, { type: "RENAME_WORKSPACE", workspaceId: first.id, name: "Trabalho" });
    expect(state.workspaces.find((ws) => ws.id === first.id)?.name).toBe("Trabalho");
    expect(state.workspaces.find((ws) => ws.id === second.id)?.name).toBe("Segundo");
  });

  it("ignora rename com nome vazio, mantendo o nome atual", () => {
    let state = collection();
    const first = state.workspaces[0];
    state = workspacesReducer(state, { type: "RENAME_WORKSPACE", workspaceId: first.id, name: "   " });
    expect(state.workspaces.find((ws) => ws.id === first.id)?.name).toBe("Primeiro");
  });

  it("nunca deixa a lista de workspaces vazia", () => {
    let state = collection();
    const only = state.workspaces[0];
    state = workspacesReducer(state, { type: "CLOSE_WORKSPACE", workspaceId: only.id });
    expect(state.workspaces).toHaveLength(1);
    expect(state.activeWorkspaceId).toBe(state.workspaces[0].id);
  });

  it("FOCUS_SESSION alcança um workspace inativo e anexa a sessão no projeto certo", () => {
    let state = collection();
    state = workspacesReducer(state, { type: "ADD_PROJECT", path: "C:\dev\alvo" });
    const alvo = state.workspaces[0];
    const projetoAlvo = alvo.projects[0];

    // Segundo workspace passa a ser o ativo — é daqui que o usuário clica no aviso.
    state = workspacesReducer(state, { type: "ADD_WORKSPACE", name: "Outro" });
    state = workspacesReducer(state, { type: "ADD_PROJECT", path: "C:\dev\outro" });
    expect(state.activeWorkspaceId).toBe(state.workspaces[1].id);

    state = workspacesReducer(state, {
      type: "FOCUS_SESSION",
      workspaceId: alvo.id,
      projectId: projetoAlvo.id,
      sessionId: "sessao-1",
      title: "Claude",
    });

    expect(state.activeWorkspaceId).toBe(alvo.id);
    const focado = state.workspaces.find((workspace) => workspace.id === alvo.id)!;
    expect(focado.activeProjectId).toBe(projetoAlvo.id);
    const projeto = focado.projects.find((item) => item.id === projetoAlvo.id)!;
    const pane = projeto.layout.type === "pane" ? projeto.layout : null;
    expect(pane?.tabs.some((tab) => tab.resourceId === "sessao-1")).toBe(true);
    // O workspace de onde o clique partiu não pode ter ganhado a aba.
    const outro = state.workspaces.find((workspace) => workspace.id !== alvo.id)!;
    const outroProjeto = outro.projects[0];
    const outraPane = outroProjeto.layout.type === "pane" ? outroProjeto.layout : null;
    expect(outraPane?.tabs.some((tab) => tab.resourceId === "sessao-1")).toBe(false);
  });

  it("FOCUS_SESSION ignora projeto que não existe no workspace alvo", () => {
    let state = collection();
    state = workspacesReducer(state, { type: "ADD_PROJECT", path: "C:\dev\alvo" });
    const antes = state;

    state = workspacesReducer(state, {
      type: "FOCUS_SESSION",
      workspaceId: antes.workspaces[0].id,
      projectId: "projeto-inexistente",
      sessionId: "sessao-1",
      title: "Claude",
    });

    expect(state).toBe(antes);
  });

  it("migra a chave legada de workspace único pra lista nova", () => {
    localStorage.setItem(
      WORKSPACE_STORAGE_KEY,
      JSON.stringify({
        version: 1,
        id: "default",
        name: "Workspace",
        projects: [],
        activeProjectId: null,
        updatedAt: new Date().toISOString(),
      })
    );
    localStorage.removeItem(WORKSPACES_STORAGE_KEY);

    const loaded = loadWorkspaces();
    expect(loaded.workspaces).toHaveLength(1);
    expect(loaded.workspaces[0].name).toBe("Workspace 1");
    expect(loaded.activeWorkspaceId).toBe(loaded.workspaces[0].id);
  });
});
