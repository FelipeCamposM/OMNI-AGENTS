import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { WorkspaceTabBar } from "../features/workspace/WorkspaceTabBar";
import { SessionProvidersContext } from "../features/terminal/sessionProviders";
import type { TerminalSession } from "../features/terminal/terminalService";
import type { PaneNode } from "../types/workspace";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn().mockResolvedValue({ type: "ok" }) }));

const pane: PaneNode = {
  type: "pane",
  id: "pane-1",
  tabs: [{ id: "t1", kind: "agent", title: "Corrigir o login", resourceId: "s1" }],
  activeTabId: "t1",
};

const sessao = {
  id: "s1",
  project_id: "p",
  name: "Corrigir o login",
  cwd: "C:/p",
  shell: "bash",
  state: "answered",
  pid: 1,
  output_seq: 0,
  rows: 30,
  cols: 120,
  provider: "claude",
  conversation_id: "conv-1",
} as TerminalSession;

function renderTabBar(dispatch = vi.fn(), sessions: Record<string, TerminalSession> = { s1: sessao }) {
  render(
    <SessionProvidersContext.Provider value={sessions}>
      <WorkspaceTabBar pane={pane} dispatch={dispatch} onCloseTab={vi.fn()} />
    </SessionProvidersContext.Provider>
  );
  return dispatch;
}

beforeEach(() => vi.clearAllMocks());

describe("renomear conversa pela aba", () => {
  it("duplo clique edita e o nome novo vai para o índice de conversas", async () => {
    const dispatch = renderTabBar();
    await userEvent.dblClick(screen.getByRole("tab", { name: /Corrigir o login/ }));

    const campo = await screen.findByLabelText(/Renomear aba/);
    await userEvent.clear(campo);
    await userEvent.type(campo, "Refatorar autenticação{Enter}");

    // A aba muda na hora (otimista) e o nome vai para a conversa — é por ela que barra lateral,
    // notificação e celular mostram o mesmo nome.
    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({ type: "RENAME_TAB_RESOURCE", title: "Refatorar autenticação" })
    );
    await waitFor(() =>
      expect(vi.mocked(invoke)).toHaveBeenCalledWith("rename_conversation", {
        conversationId: "conv-1",
        title: "Refatorar autenticação",
      })
    );
  });

  it("Esc cancela sem gravar nada", async () => {
    const dispatch = renderTabBar();
    await userEvent.dblClick(screen.getByRole("tab", { name: /Corrigir o login/ }));
    const campo = await screen.findByLabelText(/Renomear aba/);
    await userEvent.type(campo, "outro nome{Escape}");

    expect(dispatch).not.toHaveBeenCalledWith(expect.objectContaining({ type: "RENAME_TAB_RESOURCE" }));
    expect(vi.mocked(invoke)).not.toHaveBeenCalledWith("rename_conversation", expect.anything());
  });

  it("aba sem conversa (terminal puro) renomeia só a aba", async () => {
    const dispatch = renderTabBar(vi.fn(), { s1: { ...sessao, conversation_id: null } });
    await userEvent.dblClick(screen.getByRole("tab", { name: /Corrigir o login/ }));
    const campo = await screen.findByLabelText(/Renomear aba/);
    await userEvent.clear(campo);
    await userEvent.type(campo, "Build{Enter}");

    expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({ title: "Build" }));
    expect(vi.mocked(invoke)).not.toHaveBeenCalledWith("rename_conversation", expect.anything());
  });
});
