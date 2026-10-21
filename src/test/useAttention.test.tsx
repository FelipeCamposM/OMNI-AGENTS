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
    attention_seq: 1,
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
  it("dispensar pelo X esconde o item até o próximo evento de atenção", () => {
    const workspaces = [
      workspace("ws-a", "Cliente X", [project("api", null)], "api"),
      workspace("ws-b", "Estudos", [project("web", null)], "web"),
    ];
    const { result, rerender } = renderHook(
      ({ seq }) => useAttention([session({ id: "s1", project_id: "api", attention_seq: seq })], workspaces, "ws-b"),
      { initialProps: { seq: 1 } }
    );

    act(() => result.current.dismiss("s1"));
    expect(result.current.items).toHaveLength(0);
    expect(result.current.all).toHaveLength(1);

    rerender({ seq: 2 });
    expect(result.current.items).toHaveLength(1);
  });

  /** Visto durante um redesenho (estado "trabalhando" por um instante) não pode gravar
   *  "trabalhando": quando o estado voltava a "terminou", o aviso reaparecia sem evento novo. */
  it("olhar a sessão no meio de um redesenho não faz o aviso voltar depois", () => {
    const outro = [
      workspace("ws-a", "Cliente X", [project("api", "s1")], "api"),
      workspace("ws-b", "Estudos", [project("web", null)], "web"),
    ];
    const { result, rerender } = renderHook(
      ({ state, ws }) => useAttention([session({ id: "s1", project_id: "api", state })], outro, ws),
      { initialProps: { state: "answered" as TerminalSession["state"], ws: "ws-a" } }
    );
    expect(result.current.items).toHaveLength(0);
    rerender({ state: "working", ws: "ws-a" });
    rerender({ state: "answered", ws: "ws-b" });
    expect(result.current.items).toHaveLength(0);
  });

  /** O print do relato: "opa" dez vezes em ATENÇÃO. O failover abre uma sessão nova a cada troca
   *  de conta, e cada tentativa parada no limite virava um item. */
  it("uma conversa com várias sessões é um aviso só, da sessão mais nova", () => {
    const workspaces = [
      workspace("ws-a", "Faculdade", [project("barber", null)], "barber"),
      workspace("ws-b", "Outro", [project("web", null)], "web"),
    ];
    const tentativas = [1, 2, 3, 4].map((n) =>
      session({ id: `terminal-17900000000${n}0-${n}`, name: "opa", project_id: "barber", conversation_id: "conv", state: "stopped", notice: "usage_limit" })
    );
    const { result, rerender } = renderHook(
      ({ sessions }) => useAttention(sessions, workspaces, "ws-b"),
      { initialProps: { sessions: tentativas } }
    );
    expect(result.current.items).toHaveLength(1);
    expect(result.current.items[0].sessionId).toBe("terminal-1790000000040-4");
    expect(result.current.items.filter((item) => item.workspaceId === "ws-a")).toHaveLength(1);

    // Visto o limite, a próxima tentativa batendo no mesmo limite não é notícia.
    act(() => result.current.dismiss("terminal-1790000000040-4"));
    rerender({ sessions: [...tentativas, session({ id: "terminal-1790000000050-5", name: "opa", project_id: "barber", conversation_id: "conv", state: "stopped", notice: "usage_limit" })] });
    expect(result.current.items).toHaveLength(0);

    // A sessão viva representa a conversa, por mais antiga que seja.
    rerender({ sessions: [...tentativas, session({ id: "terminal-1780000000000-9", name: "opa", project_id: "barber", conversation_id: "conv", state: "answered", attention_seq: 3 })] });
    expect(result.current.items).toHaveLength(1);
    expect(result.current.items[0]).toMatchObject({ sessionId: "terminal-1780000000000-9", reason: "answered" });
  });

  /** O bug relatado: o aviso já lido voltava sozinho. A chave era `output_seq`, que sobe a cada
   *  pedaço de saída — e a TUI do Claude redesenha o tempo todo, mesmo sem nada acontecer. */
  it("redesenho da tela não traz de volta um aviso já visto", () => {
    const workspaces = [
      workspace("ws-a", "Cliente X", [project("api", null)], "api"),
      workspace("ws-b", "Estudos", [project("web", null)], "web"),
    ];
    const { result, rerender } = renderHook(
      ({ saida }) =>
        useAttention(
          [session({ id: "s1", project_id: "api", attention_seq: 4, output_seq: saida })],
          workspaces,
          "ws-b"
        ),
      { initialProps: { saida: 100 } }
    );

    act(() => result.current.dismiss("s1"));
    expect(result.current.items).toHaveLength(0);

    // Só redesenho: o contador de saída anda, o de atenção não.
    rerender({ saida: 101 });
    expect(result.current.items).toHaveLength(0);
    rerender({ saida: 150 });
    expect(result.current.items).toHaveLength(0);
  });

  /** Limite de uso e erro de API não mexem no contador de atenção, mas são evento novo: trocar de
   *  motivo tem de reacender o aviso. */
  it("motivo novo reacende o aviso mesmo sem evento de turno", () => {
    const workspaces = [workspace("ws-a", "Cliente X", [project("api", null)], "api")];
    const { result, rerender } = renderHook(
      ({ notice }) =>
        useAttention([session({ id: "s1", project_id: "api", attention_seq: 4, notice })], workspaces, "ws-a"),
      { initialProps: { notice: undefined as "usage_limit" | undefined } }
    );

    act(() => result.current.dismiss("s1"));
    expect(result.current.items).toHaveLength(0);

    rerender({ notice: "usage_limit" });
    expect(result.current.items).toHaveLength(1);
    expect(result.current.items[0].reason).toBe("usage_limit");
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
    expect(result.current.items.filter((item) => item.workspaceId === "ws-a")).toHaveLength(1);
  });

  it("some enquanto está na tela e volta com evento novo em outro workspace", () => {
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

    // Trocou de workspace e o agente terminou um turno novo depois disso.
    rerender({
      sessions: [session({ id: "s1", project_id: "api", attention_seq: 12 })],
      activeWorkspaceId: "ws-b",
    });
    expect(result.current.items).toHaveLength(1);
    expect(result.current.items.filter((item) => item.workspaceId === "ws-a")).toHaveLength(1);

    // Voltar pro workspace dele zera o aviso de novo.
    rerender({
      sessions: [session({ id: "s1", project_id: "api", attention_seq: 12 })],
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
    expect(result.current.items.filter((item) => item.workspaceId === "ws-a")).toHaveLength(3);
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

  it("sessão encerrada ou órfã não vira aviso; a hora é a do evento, não a do último redesenho", () => {
    const { result } = renderHook(() =>
      useAttention(
        [
          session({ id: "encerrada", project_id: "api", state: "stopped" }),
          session({ id: "orfa", project_id: "api", state: "orphan" }),
          session({ id: "terminou", project_id: "api", attention_at_ms: 1_000, last_activity_at_ms: 9_000 }),
        ],
        [workspace("ws-a", "Cliente X", [project("api", null)], "api")],
        "ws-a"
      )
    );

    expect(result.current.items.map((item) => item.sessionId)).toEqual(["terminou"]);
    expect(result.current.items[0].aconteceuEm).toBe(1_000);
  });
});
