import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { TerminalPane } from "../features/terminal/TerminalPane";
import type { WorkspaceTab } from "../types/workspace";

const engine = vi.hoisted(() => ({
  ensureEngine: vi.fn().mockResolvedValue(undefined),
  terminalSnapshot: vi.fn(),
  writeTerminal: vi.fn().mockResolvedValue(undefined),
  resizeTerminal: vi.fn().mockResolvedValue(undefined),
  restartTerminal: vi.fn().mockResolvedValue(undefined),
  stopTerminal: vi.fn().mockResolvedValue(undefined),
  spawnTerminal: vi.fn(),
  attachTerminal: vi.fn().mockResolvedValue(undefined),
  beginConversation: vi.fn(),
  ensureAgentTrust: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../features/terminal/terminalService", async (original) => ({
  ...(await original<typeof import("../features/terminal/terminalService")>()),
  ...engine,
}));

function snapshot(seq: number) {
  return {
    data: "",
    from_seq: seq,
    next_seq: seq + 1,
    session: { id: "s1", state: "working", input_locked: false },
  };
}

const tab: WorkspaceTab = { id: "t1", kind: "terminal", title: "Terminal", resourceId: "s1" };

function renderPane() {
  return render(
    <TerminalPane
      projectId="p1"
      projectPath="C:/dev/projeto"
      paneId="pane-1"
      tab={tab}
      onSessionCreated={vi.fn()}
    />
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("TerminalPane — resiliência do poll", () => {
  it("não mostra banner por falha isolada", async () => {
    engine.terminalSnapshot
      .mockRejectedValueOnce(new Error("os error 10048"))
      .mockResolvedValue(snapshot(1));

    renderPane();

    await waitFor(() => expect(engine.terminalSnapshot).toHaveBeenCalledTimes(2));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("mostra o banner depois de três falhas seguidas e o tira quando volta a responder", async () => {
    const falha = new Error(
      "Normalmente é permitida apenas uma utilização de cada endereço de soquete. (os error 10048)"
    );
    engine.terminalSnapshot.mockRejectedValue(falha);

    renderPane();

    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("os error 10048"));

    // Engine voltou: o banner sai sozinho, sem precisar trocar de projeto e voltar.
    engine.terminalSnapshot.mockResolvedValue(snapshot(1));
    await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument(), { timeout: 4_000 });
  });
});
