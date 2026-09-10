import { useEffect } from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PaneView } from "../features/workspace/PaneView";
import type { PaneNode } from "../types/workspace";
import { PANE_DRAG_TYPE, TAB_DRAG_TYPE } from "../features/workspace/tabDrag";

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

describe("arraste de arquivos entre painéis", () => {
  beforeEach(() => {
    vi.stubGlobal("PointerEvent", MouseEvent);
    Object.defineProperties(HTMLElement.prototype, {
      setPointerCapture: { configurable: true, value: vi.fn() },
      hasPointerCapture: { configurable: true, value: vi.fn(() => true) },
      releasePointerCapture: { configurable: true, value: vi.fn() },
    });
  });
  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

  function setup(kind: "file" | "markdown" = "file", title = "code.ts") {
    const dispatch = vi.fn();
    const common = { active: true, onlyPane: false, maximized: false, projectId: "project", projectPath: "C:/test", fileSaveMode: "manual" as const, kanban: { version: 1 as const, tasks: [], agentByProject: {}, dispatcherEnabled: false, failureTimestamps: [], pausedUntil: null }, kanbanDispatch: vi.fn(), dispatch };
    const pane: PaneNode = { type: "pane", id: "source", activeTabId: "file", tabs: [{ id: "file", kind, title, resourceId: `C:/test/${title}` }, { id: "other", kind: "file", title: "other.ts" }] };
    render(<><PaneView {...common} pane={pane} /><PaneView {...common} pane={{ type: "pane", id: "target", tabs: [], activeTabId: null }} /></>);
    const source = screen.getByRole("tab", { name: new RegExp(title.replace(".", "\\.")) });
    return { dispatch, source };
  }

  it.each([["file", "code.ts"], ["file", "photo.png"], ["markdown", "README.md"]] as const)("move somente a aba %s %s para outro painel", (kind, title) => {
    const { dispatch, source } = setup(kind, title);
    expect(fireEvent.pointerDown(source, { button: 0, clientX: 10, clientY: 10 })).toBe(false);
    expect(source.parentElement!.setPointerCapture).toHaveBeenCalled();
    fireEvent.pointerMove(window, { clientX: 80, clientY: 80 });
    const destination = within(screen.getByRole("region", { name: "Painel target" })).getByRole("button", { name: "Mover aqui" });
    Object.defineProperty(document, "elementFromPoint", { configurable: true, value: vi.fn(() => destination) });
    fireEvent.pointerUp(window, { clientX: 80, clientY: 80 });
    expect(dispatch).toHaveBeenCalledWith({ type: "MOVE_TAB", sourcePaneId: "source", targetPaneId: "target", tabId: "file" });
    expect(dispatch.mock.calls.some(([action]) => action.type === "MOVE_PANE" || action.type === "SWAP_PANE")).toBe(false);
    expect(screen.queryByLabelText("Destinos da tab")).not.toBeInTheDocument();
  });

  it.each([["Esquerda", "horizontal", "before"], ["Direita", "horizontal", "after"], ["Acima", "vertical", "before"], ["Abaixo", "vertical", "after"]])("cria uma divisão ao soltar em %s", (label, direction, position) => {
    const { dispatch, source } = setup();
    fireEvent.pointerDown(source, { button: 0, clientX: 10, clientY: 10 });
    fireEvent.pointerMove(window, { clientX: 80, clientY: 80 });
    const destination = within(screen.getByRole("region", { name: "Painel target" })).getByRole("button", { name: label });
    Object.defineProperty(document, "elementFromPoint", { configurable: true, value: vi.fn(() => destination) });
    fireEvent.pointerUp(window, { clientX: 80, clientY: 80 });
    expect(dispatch).toHaveBeenCalledWith({ type: "SPLIT_WITH_TAB", sourcePaneId: "source", targetPaneId: "target", tabId: "file", direction, position });
  });

  it("cancela com Escape e ignora arraste de texto externo", () => {
    const { dispatch, source } = setup();
    fireEvent.dragEnter(screen.getByRole("region", { name: "Painel target" }), { dataTransfer: { types: ["text/plain"] } });
    expect(screen.queryByLabelText("Destinos da tab")).not.toBeInTheDocument();
    fireEvent.pointerDown(source, { button: 0, clientX: 10, clientY: 10 });
    fireEvent.pointerMove(window, { clientX: 80, clientY: 80 });
    fireEvent.keyDown(window, { key: "Escape" });
    fireEvent.pointerUp(window, { clientX: 80, clientY: 80 });
    expect(dispatch.mock.calls.some(([action]) => action.type === "MOVE_TAB")).toBe(false);
    expect(screen.queryByLabelText("Destinos da tab")).not.toBeInTheDocument();
  });

  it("não propaga o arraste HTML de uma aba de terminal para o cabeçalho", () => {
    const dispatch = vi.fn();
    const dataTransfer = { setData: vi.fn(), effectAllowed: "" };
    const pane: PaneNode = { type: "pane", id: "p", activeTabId: "t", tabs: [{ id: "t", kind: "terminal", title: "Terminal" }] };
    render(<PaneView pane={pane} active onlyPane maximized={false} projectId="p" projectPath="C:/test" fileSaveMode="auto" kanban={{ version: 1, tasks: [], agentByProject: {}, dispatcherEnabled: false, failureTimestamps: [], pausedUntil: null }} kanbanDispatch={vi.fn()} dispatch={dispatch} />);
    fireEvent.dragStart(screen.getByRole("tab"), { dataTransfer });
    expect(dataTransfer.setData).toHaveBeenCalledWith(TAB_DRAG_TYPE, expect.any(String));
    expect(dataTransfer.setData).not.toHaveBeenCalledWith(PANE_DRAG_TYPE, expect.any(String));
  });
});
