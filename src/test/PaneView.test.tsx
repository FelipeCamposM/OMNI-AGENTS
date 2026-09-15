import { useEffect } from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";
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

it("o + escolhe entre agente e terminal", async () => {
  const dispatch = vi.fn();
  const pane: PaneNode = { type: "pane", id: "p", activeTabId: "tab", tabs: [{ id: "tab", kind: "agent", title: "Claude", resourceId: "s1" }] };
  render(<PaneView pane={pane} active onlyPane maximized={false} projectId="project" projectPath="C:/test" fileSaveMode="auto" kanban={{ version: 1, tasks: [], agentByProject: {}, dispatcherEnabled: false, failureTimestamps: [], pausedUntil: null }} kanbanDispatch={vi.fn()} dispatch={dispatch} />);

  expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "Nova tab" }));
  const menu = screen.getByRole("menu", { name: "Nova tab" });
  await userEvent.click(within(menu).getByRole("menuitem", { name: /Novo terminal/ }));
  expect(dispatch).toHaveBeenCalledWith({ type: "CREATE_TAB", paneId: "p", kind: "terminal", title: "Novo terminal" });
  expect(screen.queryByRole("menu")).not.toBeInTheDocument();

  await userEvent.click(screen.getByRole("button", { name: "Nova tab" }));
  await userEvent.click(within(screen.getByRole("menu")).getByRole("menuitem", { name: /Novo agente/ }));
  expect(dispatch).toHaveBeenCalledWith({ type: "CREATE_TAB", paneId: "p", kind: "agent", title: "Novo agente" });
});

describe("arraste de abas entre painéis", () => {
  beforeEach(() => {
    vi.stubGlobal("PointerEvent", MouseEvent);
    Object.defineProperties(HTMLElement.prototype, {
      setPointerCapture: { configurable: true, value: vi.fn() },
      hasPointerCapture: { configurable: true, value: vi.fn(() => true) },
      releasePointerCapture: { configurable: true, value: vi.fn() },
    });
  });
  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

  type Kind = "file" | "markdown" | "agent" | "terminal";
  function setup(kind: Kind = "file", title = "code.ts", sourceTabs = 2) {
    const dispatch = vi.fn();
    const common = { active: true, onlyPane: false, maximized: false, projectId: "project", projectPath: "C:/test", fileSaveMode: "manual" as const, kanban: { version: 1 as const, tasks: [], agentByProject: {}, dispatcherEnabled: false, failureTimestamps: [], pausedUntil: null }, kanbanDispatch: vi.fn(), dispatch };
    const tabs = [{ id: "file", kind, title, resourceId: `C:/test/${title}` }, { id: "other", kind: "file" as const, title: "other.ts" }].slice(0, sourceTabs);
    render(<><PaneView {...common} pane={{ type: "pane", id: "source", activeTabId: "file", tabs }} /><PaneView {...common} pane={{ type: "pane", id: "target", tabs: [], activeTabId: null }} /></>);
    const source = screen.getByRole("tab", { name: new RegExp(title.replace(".", "\\.")) });
    const region = (name: string) => screen.getByRole("region", { name });
    // jsdom não faz layout: cada painel ocupa 400×400 e o ponteiro "acerta" o elemento pedido.
    for (const section of document.querySelectorAll<HTMLElement>("[data-drop-pane]")) {
      section.getBoundingClientRect = () => ({ left: 0, top: 0, width: 400, height: 400, right: 400, bottom: 400, x: 0, y: 0, toJSON: () => ({}) });
    }
    const pointAt = (element: Element) => Object.defineProperty(document, "elementFromPoint", { configurable: true, value: vi.fn(() => element) });
    const bodyOf = (name: string) => region(name).querySelector(":scope > div.flex-1")!;
    return { dispatch, source, region, pointAt, bodyOf };
  }

  it.each([["file", "code.ts"], ["file", "photo.png"], ["markdown", "README.md"], ["agent", "Claude"], ["terminal", "Terminal"]] as const)("move a aba %s %s para outro painel com prévia", (kind, title) => {
    const { dispatch, source, region, pointAt, bodyOf } = setup(kind, title);
    pointAt(bodyOf("Painel target"));
    expect(fireEvent.pointerDown(source, { button: 0, clientX: 10, clientY: 10 })).toBe(false);
    expect(source.parentElement!.setPointerCapture).not.toHaveBeenCalled();
    fireEvent.pointerMove(window, { clientX: 200, clientY: 200 });
    expect(source.parentElement!.setPointerCapture).toHaveBeenCalled();
    const preview = within(region("Painel target")).getByRole("status", { name: "Prévia do destino da aba" });
    expect(preview).toHaveTextContent("Mover para este painel");
    fireEvent.pointerUp(window, { clientX: 200, clientY: 200 });
    expect(dispatch).toHaveBeenCalledWith({ type: "MOVE_TAB", sourcePaneId: "source", targetPaneId: "target", tabId: "file" });
    expect(screen.queryByRole("status", { name: "Prévia do destino da aba" })).not.toBeInTheDocument();
  });

  it.each([
    ["left", 20, 200, "horizontal", "before"], ["right", 380, 200, "horizontal", "after"],
    ["top", 200, 60, "vertical", "before"], ["bottom", 200, 380, "vertical", "after"],
  ] as const)("prévia e divisão em %s", (zone, x, y, direction, position) => {
    const { dispatch, source, region, pointAt, bodyOf } = setup("agent", "Claude");
    pointAt(bodyOf("Painel target"));
    fireEvent.pointerDown(source, { button: 0, clientX: 10, clientY: 10 });
    fireEvent.pointerMove(window, { clientX: x, clientY: y });
    expect(within(region("Painel target")).getByRole("status")).toHaveAttribute("data-zone", zone);
    fireEvent.pointerUp(window, { clientX: x, clientY: y });
    expect(dispatch).toHaveBeenCalledWith({ type: "SPLIT_WITH_TAB", sourcePaneId: "source", targetPaneId: "target", tabId: "file", direction, position });
  });

  it("sobre as abas do outro painel é sempre mover, mesmo perto da borda", () => {
    const { dispatch, source, region, pointAt } = setup("terminal", "Terminal");
    pointAt(within(region("Painel target")).getByRole("tablist"));
    fireEvent.pointerDown(source, { button: 0, clientX: 10, clientY: 10 });
    fireEvent.pointerMove(window, { clientX: 200, clientY: 10 });
    fireEvent.pointerUp(window, { clientX: 200, clientY: 10 });
    expect(dispatch).toHaveBeenCalledWith({ type: "MOVE_TAB", sourcePaneId: "source", targetPaneId: "target", tabId: "file" });
  });

  it("no próprio painel com uma aba só não mostra divisão", () => {
    const { source, pointAt, bodyOf } = setup("agent", "Claude", 1);
    pointAt(bodyOf("Painel Claude"));
    fireEvent.pointerDown(source, { button: 0, clientX: 10, clientY: 10 });
    fireEvent.pointerMove(window, { clientX: 380, clientY: 200 });
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    fireEvent.pointerUp(window, { clientX: 380, clientY: 200 });
  });

  it("cancela com Escape sem mover nada", () => {
    const { dispatch, source, region, pointAt, bodyOf } = setup();
    fireEvent.dragEnter(region("Painel target"), { dataTransfer: { types: ["text/plain"] } });
    expect(screen.queryByLabelText("Destinos do painel")).not.toBeInTheDocument();
    pointAt(bodyOf("Painel target"));
    fireEvent.pointerDown(source, { button: 0, clientX: 10, clientY: 10 });
    fireEvent.pointerMove(window, { clientX: 200, clientY: 200 });
    expect(screen.getByRole("status")).toBeInTheDocument();
    fireEvent.keyDown(window, { key: "Escape" });
    fireEvent.pointerUp(window, { clientX: 200, clientY: 200 });
    expect(dispatch).not.toHaveBeenCalledWith(expect.objectContaining({ type: "MOVE_TAB" }));
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });
});

it("dropZone: bordas até 30% dividem, o resto e o cabeçalho movem", async () => {
  const { dropZone } = await import("../features/workspace/tabPointerDrag");
  const rect = { left: 100, top: 0, width: 200, height: 100 };
  expect(dropZone(rect, 110, 50, false)).toBe("left");
  expect(dropZone(rect, 290, 50, false)).toBe("right");
  expect(dropZone(rect, 200, 5, false)).toBe("top");
  expect(dropZone(rect, 200, 95, false)).toBe("bottom");
  expect(dropZone(rect, 200, 50, false)).toBe("center");
  expect(dropZone(rect, 110, 50, true)).toBe("center");
});
