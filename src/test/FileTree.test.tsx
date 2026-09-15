import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { FileTree } from "../components/FileTree";
import * as files from "../features/files/filesService";

vi.mock("@tauri-apps/plugin-opener", () => ({ revealItemInDir: vi.fn() }));
vi.mock("../features/files/filesService", async (original) => ({
  ...(await original<typeof import("../features/files/filesService")>()),
  resolveIgnoreList: vi.fn().mockResolvedValue([]),
  listDir: vi.fn().mockResolvedValue([
    { name: "src", path: "/p/src", isDirectory: true },
    { name: "a.txt", path: "/p/a.txt", isDirectory: false },
  ]),
  createFile: vi.fn().mockResolvedValue(undefined),
  renamePath: vi.fn().mockResolvedValue(undefined),
}));

// jsdom não tem PointerEvent: um MouseEvent com o tipo pointer* carrega button/clientX.
function pointer(target: EventTarget, type: string, clientX: number, clientY: number) {
  act(() => { target.dispatchEvent(new MouseEvent(type, { bubbles: true, button: 0, clientX, clientY })); });
}

function renderTree(onOpenFile = vi.fn()) {
  render(<FileTree projectPath="/p" onOpenFile={onOpenFile} onFileRenamed={vi.fn()} onPathDeleted={vi.fn()} />);
  return onOpenFile;
}

it("novo arquivo é nomeado dentro da árvore, sem prompt do navegador", async () => {
  const prompt = vi.spyOn(window, "prompt");
  const onOpenFile = renderTree();
  fireEvent.contextMenu(await screen.findByText("a.txt"));
  await userEvent.click(screen.getByRole("menuitem", { name: "Novo arquivo" }));

  const input = screen.getByRole("textbox", { name: "Nome do novo arquivo" });
  await userEvent.type(input, "novo.ts{Enter}");

  expect(prompt).not.toHaveBeenCalled();
  await waitFor(() => expect(files.createFile).toHaveBeenCalledWith("/p", "/p/novo.ts"));
  expect(onOpenFile).toHaveBeenCalledWith("/p/novo.ts", "file");
  expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
});

it("Esc cancela a criação", async () => {
  renderTree();
  fireEvent.contextMenu(await screen.findByText("a.txt"));
  await userEvent.click(screen.getByRole("menuitem", { name: "Novo arquivo" }));
  await userEvent.type(screen.getByRole("textbox"), "x{Escape}");
  expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  expect(files.createFile).not.toHaveBeenCalledWith("/p", "/p/x");
});

it("arrastar mostra o item preso ao ponteiro e some ao soltar", async () => {
  document.elementFromPoint = () => null; // jsdom não implementa
  renderTree();
  const item = await screen.findByText("a.txt");
  pointer(item, "pointerdown", 10, 10);
  pointer(window, "pointermove", 60, 80);

  const ghost = await screen.findByTestId("file-drag-ghost");
  expect(ghost).toHaveTextContent("a.txt");
  expect(ghost.style.transform).toBe("translate(72px, 88px)");

  pointer(window, "pointermove", 100, 120);
  expect(ghost.style.transform).toBe("translate(112px, 128px)");

  pointer(window, "pointerup", 100, 120);
  await waitFor(() => expect(screen.queryByTestId("file-drag-ghost")).not.toBeInTheDocument());
});
