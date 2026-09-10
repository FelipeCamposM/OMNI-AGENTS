import { describe, expect, it } from "vitest";
import { workspaceReducer } from "../features/workspace/workspaceReducer";
import { emptyWorkspace, loadWorkspace, WORKSPACE_STORAGE_KEY } from "../services/workspaceService";
import type { LayoutNode } from "../types/workspace";

function paneIds(node: LayoutNode): string[] {
  return node.type === "pane" ? [node.id] : [...paneIds(node.first), ...paneIds(node.second)];
}

function findPane(node: LayoutNode, paneId: string) {
  if (node.type === "pane") return node.id === paneId ? node : null;
  return findPane(node.first, paneId) ?? findPane(node.second, paneId);
}

describe("workspaceReducer", () => {
  it("descarta persistência estruturalmente inválida", () => {
    localStorage.setItem(
      WORKSPACE_STORAGE_KEY,
      JSON.stringify({ version: 1, id: "broken", name: "Broken", projects: [{}], activeProjectId: null })
    );

    expect(loadWorkspace().projects).toEqual([]);
  });

  it("não duplica o mesmo caminho e seleciona o projeto existente", () => {
    const added = workspaceReducer(emptyWorkspace(), { type: "ADD_PROJECT", path: "C:\\dev\\omni" });
    const duplicate = workspaceReducer(added, { type: "ADD_PROJECT", path: "c:\\DEV\\omni" });

    expect(duplicate.projects).toHaveLength(1);
    expect(duplicate.activeProjectId).toBe(added.projects[0].id);
  });

  it("divide, limita resize e fecha uma pane sem corromper a árvore", () => {
    let state = workspaceReducer(emptyWorkspace(), { type: "ADD_PROJECT", path: "C:\\dev\\omni" });
    const originalPane = state.projects[0].activePaneId;
    state = workspaceReducer(state, { type: "SPLIT_PANE", paneId: originalPane, direction: "horizontal" });

    const split = state.projects[0].layout;
    expect(split.type).toBe("split");
    if (split.type !== "split") throw new Error("layout deveria estar dividido");

    state = workspaceReducer(state, { type: "RESIZE_SPLIT", splitId: split.id, ratio: 0.99 });
    expect(state.projects[0].layout).toMatchObject({ type: "split", ratio: 0.8 });

    const secondPane = paneIds(state.projects[0].layout).find((id) => id !== originalPane);
    if (!secondPane) throw new Error("segunda pane ausente");
    state = workspaceReducer(state, { type: "CLOSE_PANE", paneId: secondPane });

    expect(state.projects[0].layout).toMatchObject({ type: "pane", id: originalPane });
    expect(state.projects[0].activePaneId).toBe(originalPane);
  });

  it("não fecha a última pane", () => {
    const state = workspaceReducer(emptyWorkspace(), { type: "ADD_PROJECT", path: "C:\\dev\\omni" });
    const paneId = state.projects[0].activePaneId;
    const next = workspaceReducer(state, { type: "CLOSE_PANE", paneId });

    expect(next.projects[0].layout).toEqual(state.projects[0].layout);
  });

  it("fecha um projeto e seleciona outro; fechar o último zera activeProjectId", () => {
    let state = workspaceReducer(emptyWorkspace(), { type: "ADD_PROJECT", path: "C:\\dev\\omni" });
    state = workspaceReducer(state, { type: "ADD_PROJECT", path: "C:\\dev\\outro" });
    const [first, second] = state.projects;
    expect(state.activeProjectId).toBe(second.id);

    state = workspaceReducer(state, { type: "CLOSE_PROJECT", projectId: second.id });
    expect(state.projects.map((project) => project.id)).toEqual([first.id]);
    expect(state.activeProjectId).toBe(first.id);

    state = workspaceReducer(state, { type: "CLOSE_PROJECT", projectId: first.id });
    expect(state.projects).toHaveLength(0);
    expect(state.activeProjectId).toBeNull();
  });

  it("cria, seleciona e fecha tabs mantendo uma tab ativa válida", () => {
    let state = workspaceReducer(emptyWorkspace(), { type: "ADD_PROJECT", path: "C:\\dev\\omni" });
    const paneId = state.projects[0].activePaneId;
    const originalTab = findPane(state.projects[0].layout, paneId)?.activeTabId;
    state = workspaceReducer(state, { type: "CREATE_TAB", paneId, kind: "command", title: "Tests" });

    const withTab = findPane(state.projects[0].layout, paneId);
    expect(withTab?.tabs).toHaveLength(2);
    expect(withTab?.tabs.find((tab) => tab.title === "Tests")?.id).toBe(withTab?.activeTabId);

    if (!withTab || !originalTab) throw new Error("tab ausente");
    state = workspaceReducer(state, { type: "CLOSE_TAB", paneId, tabId: withTab.activeTabId });
    expect(findPane(state.projects[0].layout, paneId)).toMatchObject({
      activeTabId: originalTab,
      tabs: [{ id: originalTab }],
    });
  });

  it("RENAME_TAB_RESOURCE atualiza o resourceId em todas as panes que apontam pra ele", () => {
    let state = workspaceReducer(emptyWorkspace(), { type: "ADD_PROJECT", path: "C:\\dev\\omni" });
    const paneId = state.projects[0].activePaneId;
    state = workspaceReducer(state, {
      type: "CREATE_TAB",
      paneId,
      kind: "file",
      title: "a.ts",
      resourceId: "C:\\dev\\omni\\a.ts",
    });
    state = workspaceReducer(state, { type: "SPLIT_PANE", paneId, direction: "horizontal" });
    const secondPaneId = state.projects[0].activePaneId;
    state = workspaceReducer(state, {
      type: "CREATE_TAB",
      paneId: secondPaneId,
      kind: "file",
      title: "a.ts",
      resourceId: "C:\\dev\\omni\\a.ts",
    });

    state = workspaceReducer(state, {
      type: "RENAME_TAB_RESOURCE",
      fromResourceId: "C:\\dev\\omni\\a.ts",
      toResourceId: "C:\\dev\\omni\\b.ts",
      title: "b.ts",
    });

    const firstPane = findPane(state.projects[0].layout, paneId);
    const secondPane = findPane(state.projects[0].layout, secondPaneId);
    expect(firstPane?.tabs.find((tab) => tab.title === "b.ts")?.resourceId).toBe("C:\\dev\\omni\\b.ts");
    expect(secondPane?.tabs.find((tab) => tab.title === "b.ts")?.resourceId).toBe("C:\\dev\\omni\\b.ts");
  });

  it("CLOSE_TABS_BY_RESOURCE_PREFIX fecha arquivos exatos e dentro de uma pasta excluída", () => {
    let state = workspaceReducer(emptyWorkspace(), { type: "ADD_PROJECT", path: "C:\\dev\\omni" });
    const paneId = state.projects[0].activePaneId;
    const originalTabId = findPane(state.projects[0].layout, paneId)?.activeTabId;
    state = workspaceReducer(state, {
      type: "CREATE_TAB",
      paneId,
      kind: "file",
      title: "a.ts",
      resourceId: "C:\\dev\\omni\\src\\a.ts",
    });
    state = workspaceReducer(state, {
      type: "CREATE_TAB",
      paneId,
      kind: "file",
      title: "readme.md",
      resourceId: "C:\\dev\\omni\\readme.md",
    });

    state = workspaceReducer(state, { type: "CLOSE_TABS_BY_RESOURCE_PREFIX", prefix: "C:\\dev\\omni\\src" });

    const pane = findPane(state.projects[0].layout, paneId);
    expect(pane?.tabs.map((tab) => tab.title)).toEqual(
      expect.arrayContaining(["readme.md"])
    );
    expect(pane?.tabs.some((tab) => tab.resourceId === "C:\\dev\\omni\\src\\a.ts")).toBe(false);
    expect(originalTabId && pane?.tabs.some((tab) => tab.id === originalTabId)).toBe(true);
  });

  it("CLOSE_TABS_BY_RESOURCE_PREFIX nunca deixa o projeto sem nenhuma pane", () => {
    let state = workspaceReducer(emptyWorkspace(), { type: "ADD_PROJECT", path: "C:\\dev\\omni" });
    const paneId = state.projects[0].activePaneId;
    const onlyTabId = findPane(state.projects[0].layout, paneId)?.activeTabId;
    if (!onlyTabId) throw new Error("tab ausente");
    state = workspaceReducer(state, {
      type: "BIND_TAB_RESOURCE",
      paneId,
      tabId: onlyTabId,
      resourceId: "C:\\dev\\omni\\a.ts",
    });

    state = workspaceReducer(state, { type: "CLOSE_TABS_BY_RESOURCE_PREFIX", prefix: "C:\\dev\\omni\\a.ts" });

    expect(state.projects[0].layout.type).toBe("pane");
    const tabs = findPane(state.projects[0].layout, paneId)?.tabs;
    expect(tabs).toEqual([]);
    expect(findPane(state.projects[0].layout, paneId)?.activeTabId).toBeNull();
  });

  it("CLOSE_TAB na última tab mantém a pane vazia (regressão: 'session not found')", () => {
    let state = workspaceReducer(emptyWorkspace(), { type: "ADD_PROJECT", path: "C:\\dev\\omni" });
    const paneId = state.projects[0].activePaneId;
    const onlyTabId = findPane(state.projects[0].layout, paneId)?.activeTabId;
    if (!onlyTabId) throw new Error("tab ausente");
    state = workspaceReducer(state, {
      type: "BIND_TAB_RESOURCE",
      paneId,
      tabId: onlyTabId,
      resourceId: "session-123",
    });

    state = workspaceReducer(state, { type: "CLOSE_TAB", paneId, tabId: onlyTabId });

    const pane = findPane(state.projects[0].layout, paneId);
    expect(pane?.tabs).toEqual([]);
    expect(pane?.activeTabId).toBeNull();
    localStorage.setItem(WORKSPACE_STORAGE_KEY, JSON.stringify(state));
    expect(loadWorkspace().projects[0].layout).toEqual(state.projects[0].layout);
    state = workspaceReducer(state, { type: "CREATE_TAB", paneId, kind: "agent", title: "Novo agente" });
    expect(findPane(state.projects[0].layout, paneId)?.tabs).toHaveLength(1);
    expect(findPane(state.projects[0].layout, paneId)?.activeTabId).not.toBe(onlyTabId);
  });

  it("move a última tab e colapsa a pane de origem", () => {
    let state = workspaceReducer(emptyWorkspace(), { type: "ADD_PROJECT", path: "C:\\dev\\omni" });
    const sourcePaneId = state.projects[0].activePaneId;
    const tabId = findPane(state.projects[0].layout, sourcePaneId)?.activeTabId;
    state = workspaceReducer(state, { type: "SPLIT_PANE", paneId: sourcePaneId, direction: "horizontal" });
    const targetPaneId = state.projects[0].activePaneId;
    if (!tabId) throw new Error("tab ausente");

    state = workspaceReducer(state, { type: "MOVE_TAB", sourcePaneId, targetPaneId, tabId });

    expect(state.projects[0].layout.type).toBe("pane");
    expect(findPane(state.projects[0].layout, targetPaneId)?.tabs.map((tab) => tab.id)).toContain(tabId);
    expect(state.projects[0].activePaneId).toBe(targetPaneId);
  });

  it("arrasta uma tab para criar um split sem duplicá-la", () => {
    let state = workspaceReducer(emptyWorkspace(), { type: "ADD_PROJECT", path: "C:\\dev\\omni" });
    const paneId = state.projects[0].activePaneId;
    state = workspaceReducer(state, { type: "CREATE_TAB", paneId, kind: "file", title: "README.md" });
    const tabId = findPane(state.projects[0].layout, paneId)?.activeTabId;
    if (!tabId) throw new Error("tab ausente");

    state = workspaceReducer(state, {
      type: "SPLIT_WITH_TAB",
      sourcePaneId: paneId,
      targetPaneId: paneId,
      tabId,
      direction: "vertical",
      position: "before",
    });

    expect(state.projects[0].layout).toMatchObject({ type: "split", direction: "vertical" });
    const ids = paneIds(state.projects[0].layout).flatMap(
      (id) => findPane(state.projects[0].layout, id)?.tabs.map((tab) => tab.id) ?? []
    );
    expect(ids.filter((id) => id === tabId)).toHaveLength(1);
  });

  it("anexa uma sessão persistente existente sem duplicar a tab", () => {
    let state = workspaceReducer(emptyWorkspace(), { type: "ADD_PROJECT", path: "C:\\dev\\omni" });

    state = workspaceReducer(state, {
      type: "ATTACH_TERMINAL",
      sessionId: "session-1",
      title: "PowerShell",
    });
    state = workspaceReducer(state, {
      type: "ATTACH_TERMINAL",
      sessionId: "session-1",
      title: "PowerShell",
    });

    const pane = findPane(state.projects[0].layout, state.projects[0].activePaneId);
    expect(pane?.tabs.filter((tab) => tab.resourceId === "session-1")).toHaveLength(1);
    expect(pane?.tabs.find((tab) => tab.resourceId === "session-1")?.id).toBe(pane?.activeTabId);
  });

  it("MOVE_PANE reposiciona a pane inteira sem perder ou duplicar tabs", () => {
    let state = workspaceReducer(emptyWorkspace(), { type: "ADD_PROJECT", path: "C:\\dev\\omni" });
    const paneA = state.projects[0].activePaneId;
    state = workspaceReducer(state, { type: "SPLIT_PANE", paneId: paneA, direction: "horizontal" });
    const [firstId, secondId] = paneIds(state.projects[0].layout);
    const paneB = firstId === paneA ? secondId : firstId;

    state = workspaceReducer(state, {
      type: "MOVE_PANE",
      sourcePaneId: paneB,
      targetPaneId: paneA,
      direction: "vertical",
      position: "before",
    });

    expect(state.projects[0].layout).toMatchObject({ type: "split", direction: "vertical" });
    expect(paneIds(state.projects[0].layout)).toHaveLength(2);
    expect(state.projects[0].layout.type === "split" && state.projects[0].layout.first.id).toBe(paneB);
    expect(state.projects[0].activePaneId).toBe(paneB);
  });

  it("SWAP_PANE troca o conteúdo de duas panes mantendo a terceira intacta", () => {
    let state = workspaceReducer(emptyWorkspace(), { type: "ADD_PROJECT", path: "C:\\dev\\omni" });
    const paneA = state.projects[0].activePaneId;
    state = workspaceReducer(state, { type: "SPLIT_PANE", paneId: paneA, direction: "horizontal" });
    const paneB = paneIds(state.projects[0].layout).find((id) => id !== paneA)!;
    state = workspaceReducer(state, { type: "SPLIT_PANE", paneId: paneB, direction: "vertical" });
    const paneC = paneIds(state.projects[0].layout).find((id) => id !== paneA && id !== paneB)!;

    state = workspaceReducer(state, { type: "CREATE_TAB", paneId: paneA, kind: "file", title: "a.ts" });
    state = workspaceReducer(state, { type: "CREATE_TAB", paneId: paneC, kind: "file", title: "c.ts" });
    const tabsBBefore = findPane(state.projects[0].layout, paneB)?.tabs.map((tab) => tab.id);

    state = workspaceReducer(state, { type: "SWAP_PANE", sourcePaneId: paneA, targetPaneId: paneC });

    expect(findPane(state.projects[0].layout, paneA)?.tabs.some((tab) => tab.title === "c.ts")).toBe(true);
    expect(findPane(state.projects[0].layout, paneC)?.tabs.some((tab) => tab.title === "a.ts")).toBe(true);
    expect(findPane(state.projects[0].layout, paneB)?.tabs.map((tab) => tab.id)).toEqual(tabsBBefore);
    expect(paneIds(state.projects[0].layout).sort()).toEqual([paneA, paneB, paneC].sort());
  });

  it("APPLY_LAYOUT_PRESET grid-2x2 monta 4 panes preservando a pane original", () => {
    let state = workspaceReducer(emptyWorkspace(), { type: "ADD_PROJECT", path: "C:\\dev\\omni" });
    const originalPane = state.projects[0].activePaneId;

    state = workspaceReducer(state, { type: "APPLY_LAYOUT_PRESET", preset: "grid-2x2" });

    const layout = state.projects[0].layout;
    expect(layout).toMatchObject({ type: "split", direction: "horizontal" });
    if (layout.type !== "split") throw new Error("layout deveria estar dividido");
    expect(layout.first).toMatchObject({ type: "split", direction: "vertical" });
    expect(layout.second).toMatchObject({ type: "split", direction: "vertical" });
    expect(paneIds(layout)).toHaveLength(4);
    expect(paneIds(layout)).toContain(originalPane);
  });

  it("APPLY_LAYOUT_PRESET columns-2 a partir de 1 pane cria a segunda vazia", () => {
    let state = workspaceReducer(emptyWorkspace(), { type: "ADD_PROJECT", path: "C:\\dev\\omni" });
    state = workspaceReducer(state, { type: "APPLY_LAYOUT_PRESET", preset: "columns-2" });

    expect(state.projects[0].layout).toMatchObject({ type: "split", direction: "horizontal" });
    expect(paneIds(state.projects[0].layout)).toHaveLength(2);
  });
});
