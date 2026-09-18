import { describe, expect, it } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useAttention } from "../features/terminal/useAttention";
import type { TerminalSession } from "../features/terminal/terminalService";
import type { PaneNode, Project, WorkspaceState } from "../types/workspace";

function session(overrides: Partial<TerminalSession> & Pick<TerminalSession, "id" | "project_id">): TerminalSession {
  return {
    name: `Agente ${overrides.id}`,
    cwd: "C:/dev",
    shell: "bash",
    state: "answered",
    pid: 1,
    output_seq: 7,
    rows: 24,
    cols: 80,
    ...overrides,
  };
}

function project(id: string, sessionId: string | null, name = id): Project {
  const pane: PaneNode = {
    type: "pane",
    id: `pane-${id}`,
    tabs: sessionId ? [{ id: "tab", kind: "agent", title: "Claude", resourceId: sessionId }] : [],
    activeTabId: sessionId ? "tab" : null,
  };
  return {
    id,
    name,
    path: `C:/dev/${id}`,
    gitRoot: null,
    branch: null,
    composeFile: null,
    lastOpenedAt: "",
    layout: pane,
    activePaneId: pane.id,
    maximizedPaneId: null,
  };
}

function workspace(id: string, name: string, projects: Project[], activeProjectId: string | null): WorkspaceState {
  return { version: 1, id, name, projects, activeProjectId, updatedAt: "" };
}

describe("useAttention", () => {
  it("dispensar pelo X esconde o item até a sessão soltar saída nova", () => {
    const workspaces = [
      workspace("ws-a", "Cliente X", [project("api", null)], "api"),
      workspace("ws-b", "Estudos", [project("web", null)], "web"),
    ];
    const { result, rerender } = renderHook(
      ({ seq }) => useAttention([session({ id: "s1", project_id: "api", output_seq: seq })], workspaces, "ws-b"),
      { initialProps: { seq: 1 } }
    );

    act(() => result.current.dismiss("s1"));
    expect(result.current.items).toHaveLength(0);
    expect(result.current.all).toHaveLength(1);

    rerender({ seq: 2 });
    expect(result.current.items).toHaveLength(1);
  });

  it("lista agente de workspace inativo com o nome do workspace e do projeto", () => {
    const workspaces = [
      workspace("ws-a", "Cliente X", [project("api", null)], "api"),
      workspace("ws-b", "Estudos", [project("web", null)], "web"),
    ];
    const { result } = renderHook(() =>
      useAttention([session({ id: "s1", project_id: "api" })], workspaces, "ws-b")
    );

    expect(result.current.items).toHaveLength(1);
    expect(result.current.items[0]).toMatchObject({
      sessionId: "s1",
      reason: "answered",
      workspaceId: "ws-a",
      workspaceName: "Cliente X",
      projectName: "api",
    });
    expect(result.current.countByWorkspace).toEqual({ "ws-a": 1 });
  });

  it("some enquanto está na tela e volta quando produz saída nova em outro workspace", () => {
    const workspaces = [
      workspace("ws-a", "Cliente X", [project("api", "s1")], "api"),
      workspace("ws-b", "Estudos", [project("web", null)], "web"),
    ];
    const { result, rerender } = renderHook(
      ({ sessions, activeWorkspaceId }) => useAttention(sessions, workspaces, activeWorkspaceId),
      {
        initialProps: {
          sessions: [session({ id: "s1", project_id: "api" })],
          activeWorkspaceId: "ws-a",
        },
      }
    );

    // Aba ativa do projeto ativo: o usuário está olhando pra ela.
    expect(result.current.items).toHaveLength(0);

    // Trocou de workspace e o agente terminou algo novo depois disso.
    rerender({
      sessions: [session({ id: "s1", project_id: "api", output_seq: 12 })],
      activeWorkspaceId: "ws-b",
    });
    expect(result.current.items).toHaveLength(1);
    expect(result.current.countByWorkspace).toEqual({ "ws-a": 1 });

    // Voltar pro workspace dele zera o aviso de novo.
    rerender({
      sessions: [session({ id: "s1", project_id: "api", output_seq: 12 })],
      activeWorkspaceId: "ws-a",
    });
    expect(result.current.items).toHaveLength(0);
  });

  it("não marca nada como visto com as Configurações abertas", () => {
    const workspaces = [workspace("ws-a", "Cliente X", [project("api", "s1")], "api")];
    const { result } = renderHook(() =>
      useAttention([session({ id: "s1", project_id: "api" })], workspaces, "ws-a", false)
    );

    expect(result.current.items).toHaveLength(1);
  });

  it("uma pane maximizada esconde as outras, que continuam pendentes", () => {
    const first: PaneNode = {
      type: "pane",
      id: "pane-1",
      tabs: [{ id: "t1", kind: "agent", title: "A", resourceId: "s1" }],
      activeTabId: "t1",
    };
    const second: PaneNode = {
      type: "pane",
      id: "pane-2",
      tabs: [{ id: "t2", kind: "agent", title: "B", resourceId: "s2" }],
      activeTabId: "t2",
    };
    const split = project("api", null);
    split.layout = { type: "split", id: "split", direction: "horizontal", ratio: 0.5, first, second };
    split.activePaneId = "pane-1";
    split.maximizedPaneId = "pane-1";

    const { result } = renderHook(() =>
      useAttention(
        [session({ id: "s1", project_id: "api" }), session({ id: "s2", project_id: "api" })],
        [workspace("ws-a", "Cliente X", [split], "api")],
        "ws-a"
      )
    );

    expect(result.current.items.map((item) => item.sessionId)).toEqual(["s2"]);
  });

  it("ordena por prioridade e usa o notice do engine como motivo", () => {
    const workspaces = [workspace("ws-a", "Cliente X", [project("api", null)], "api")];
    const { result } = renderHook(() =>
      useAttention(
        [
          session({ id: "terminou", project_id: "api" }),
          session({ id: "limite", project_id: "api", notice: "usage_limit" }),
          session({ id: "aprovar", project_id: "api", state: "approval_required" }),
          session({ id: "rodando", project_id: "api", state: "working" }),
        ],
        workspaces,
        "ws-a"
      )
    );

    expect(result.current.items.map((item) => item.sessionId)).toEqual(["aprovar", "limite", "terminou"]);
    expect(result.current.items[1].reason).toBe("usage_limit");
    expect(result.current.countByWorkspace).toEqual({ "ws-a": 3 });
  });

  it("ignora sessão de projeto que não está em workspace nenhum", () => {
    const { result } = renderHook(() =>
      useAttention(
        [session({ id: "s1", project_id: "projeto-fechado" })],
        [workspace("ws-a", "Cliente X", [project("api", null)], "api")],
        "ws-a"
      )
    );

    expect(result.current.items).toHaveLength(0);
  });
});
