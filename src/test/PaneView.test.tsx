import { useEffect } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PaneView } from "../features/workspace/PaneView";
import type { PaneNode } from "../types/workspace";

const lifecycle = vi.hoisted(() => ({ mounted: vi.fn(), unmounted: vi.fn() }));
vi.mock("../features/terminal/TerminalPane", () => ({ TerminalPane: () => {
  useEffect(() => { lifecycle.mounted(); return () => lifecycle.unmounted(); }, []);
  return <div>Terminal ativo</div>;
} }));
vi.mock("../features/kanban/KanbanBoard", () => ({ KanbanBoard: () => null }));
vi.mock("../features/files/FilePane", () => ({ FilePane: () => null }));
vi.mock("../features/files/MarkdownPane", () => ({ MarkdownPane: () => null }));
vi.mock("../features/git/GitGraphPane", () => ({ GitGraphPane: () => null }));
vi.mock("../features/git/GitDiffPane", () => ({ GitDiffPane: () => null }));

it("desmonta o terminal ao esvaziar a pane e permite criar agente sem tab fantasma", async () => {
  const dispatch = vi.fn();
  const pane: PaneNode = { type: "pane", id: "p", activeTabId: "tab", tabs: [{ id: "tab", kind: "agent", title: "Claude", resourceId: "closed" }] };
  const props = { pane, active: true, onlyPane: true, maximized: false, projectId: "project", projectPath: "C:/test", fileSaveMode: "auto" as const, kanban: { version: 1 as const, tasks: [], agentByProject: {}, dispatcherEnabled: false, failureTimestamps: [], pausedUntil: null }, kanbanDispatch: vi.fn(), dispatch };
  const view = render(<PaneView {...props} />);
  expect(lifecycle.mounted).toHaveBeenCalledTimes(1);
  view.rerender(<PaneView {...props} pane={{ ...pane, tabs: [], activeTabId: null }} />);
  expect(lifecycle.unmounted).toHaveBeenCalledTimes(1);
  expect(screen.queryByText("Terminal ativo")).not.toBeInTheDocument();
  expect(screen.queryByText("Iniciar nova sessão")).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "Novo agente", exact: true }));
  expect(dispatch).toHaveBeenCalledWith({ type: "CREATE_TAB", paneId: "p", kind: "agent", title: "Novo agente" });
  expect(screen.getByRole("button", { name: "Fechar painel" })).toBeDisabled();
});
