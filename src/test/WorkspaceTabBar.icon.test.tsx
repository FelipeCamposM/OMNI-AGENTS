import { describe, it, expect, vi } from "vitest";
import { fireEvent, render } from "@testing-library/react";
import { WorkspaceTabBar } from "../features/workspace/WorkspaceTabBar";
import { SessionProvidersContext } from "../features/terminal/sessionProviders";
import { ClaudeIcon, CursorIcon, GptIcon } from "../components/ui/AgentIcon";
import type { PaneNode, WorkspaceTab } from "../types/workspace";
import type { TerminalSession } from "../features/terminal/terminalService";

function pathOf(Icon: (props: { size?: number }) => JSX.Element) {
  return render(<Icon />).container.querySelector("path")?.getAttribute("d") ?? "";
}

/** Só os campos que o ícone da aba olha; o resto da sessão não muda nada aqui. */
function sessao(id: string, provider: string) {
  return { id, provider } as TerminalSession;
}

function tabIconPath(tab: WorkspaceTab, sessions: Record<string, TerminalSession> = {}) {
  const pane: PaneNode = { type: "pane", id: "p", activeTabId: tab.id, tabs: [tab] };
  const { container } = render(
    <SessionProvidersContext.Provider value={sessions}>
      <WorkspaceTabBar pane={pane} dispatch={vi.fn()} onCloseTab={vi.fn()} />
    </SessionProvidersContext.Provider>
  );
  return container.querySelector('[role="tab"] svg path')?.getAttribute("d") ?? "";
}

describe("ícone da aba de agente", () => {
  it("usa a marca da CLI gravada na aba", () => {
    for (const [provider, Icon] of [["claude", ClaudeIcon], ["codex", GptIcon], ["cursor", CursorIcon]] as const) {
      const path = tabIconPath({ id: "t", kind: "agent", title: `${provider} · agent`, provider });
      expect(path, `aba de ${provider} não pegou a marca`).toBe(pathOf(Icon));
    }
  });

  it("cai na sessão viva quando a aba foi anexada fora do seletor de CLI", () => {
    // Anexar do menu lateral, duplicar e focar por notificação criam a aba sem passar provider.
    const path = tabIconPath({ id: "t", kind: "agent", title: "Codex · agent", resourceId: "s1" }, { s1: sessao("s1", "codex") });
    expect(path).toBe(pathOf(GptIcon));
  });

  it("aba de agente sem CLI conhecida mantém o ícone de conversa", () => {
    const semProvider = tabIconPath({ id: "t", kind: "agent", title: "Novo agente" });
    expect(semProvider).not.toBe("");
    expect(semProvider).not.toBe(pathOf(ClaudeIcon));
  });
});

describe("fechar aba com o botão do meio", () => {
  const pane: PaneNode = {
    type: "pane", id: "p", activeTabId: "a",
    tabs: [{ id: "a", kind: "file", title: "a.ts" }, { id: "b", kind: "file", title: "b.ts" }],
  };

  it("clique do meio fecha a aba clicada, e só ela", () => {
    const onCloseTab = vi.fn();
    const { getAllByRole } = render(<WorkspaceTabBar pane={pane} dispatch={vi.fn()} onCloseTab={onCloseTab} />);
    fireEvent(getAllByRole("tab")[1], new MouseEvent("auxclick", { bubbles: true, button: 1 }));
    expect(onCloseTab).toHaveBeenCalledTimes(1);
    expect(onCloseTab).toHaveBeenCalledWith(pane.tabs[1]);
  });

  it("botão direito não fecha nada, e o meio não liga a rolagem automática", () => {
    const onCloseTab = vi.fn();
    const { getAllByRole } = render(<WorkspaceTabBar pane={pane} dispatch={vi.fn()} onCloseTab={onCloseTab} />);
    fireEvent(getAllByRole("tab")[0], new MouseEvent("auxclick", { bubbles: true, button: 2 }));
    expect(onCloseTab).not.toHaveBeenCalled();
    const meio = new MouseEvent("mousedown", { bubbles: true, cancelable: true, button: 1 });
    getAllByRole("tab")[0].dispatchEvent(meio);
    expect(meio.defaultPrevented).toBe(true);
  });
});
