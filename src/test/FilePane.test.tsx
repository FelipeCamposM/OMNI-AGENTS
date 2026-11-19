import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { FilePane } from "../features/files/FilePane";

const opener = vi.hoisted(() => ({ openPath: vi.fn(async () => undefined), revealItemInDir: vi.fn(async () => undefined) }));
vi.mock("@tauri-apps/plugin-opener", () => opener);

const mockReadTextFile = vi.mocked((await import("@tauri-apps/plugin-fs")).readTextFile);
const mockWriteTextFile = vi.mocked((await import("@tauri-apps/plugin-fs")).writeTextFile);

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("FilePane", () => {
  it("binário (docx) não vira texto editável: oferece abrir no app padrão", async () => {
    mockReadTextFile.mockResolvedValueOnce("PK\u0003\u0004\u0000\u0000word/document.xml");
    const tab = { id: "docx", kind: "file" as const, title: "a.docx", resourceId: "C:/dev/projeto/a.docx" };
    render(<FilePane projectPath="C:/dev/projeto" tab={tab} saveMode="auto" onDirtyChange={vi.fn()} />);
    expect(await screen.findByText("Este arquivo .docx não é texto")).toBeInTheDocument();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Abrir no app padrão" }));
    expect(opener.openPath).toHaveBeenCalledWith("C:/dev/projeto/a.docx");
  });

  it.each(["manual", "auto"] as const)("preserva o rascunho ao remontar a aba em outro painel no modo %s", async (saveMode) => {
    mockReadTextFile.mockResolvedValueOnce("original");
    const tab = { id: "moving-file", kind: "file" as const, title: "a.ts", resourceId: "C:/dev/projeto/a.ts" };
    const props = { projectPath: "C:/dev/projeto", tab, saveMode, onDirtyChange: vi.fn() };
    const source = render(<FilePane {...props} />);
    const editor = await screen.findByRole("textbox");
    vi.useFakeTimers();
    fireEvent.change(editor, { target: { value: "unsaved draft" } });
    source.unmount();
    const onDirtyChange = vi.fn();
    render(<FilePane {...props} onDirtyChange={onDirtyChange} />);
    expect(screen.getByRole("textbox")).toHaveValue("unsaved draft");
    expect(onDirtyChange).toHaveBeenCalledWith(tab.id, true);
    expect(mockReadTextFile).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1500);
    if (saveMode === "auto") {
      expect(mockWriteTextFile).toHaveBeenCalledWith(tab.resourceId, "unsaved draft");
      expect(onDirtyChange).toHaveBeenLastCalledWith(tab.id, false);
    } else {
      expect(mockWriteTextFile).not.toHaveBeenCalled();
    }
  });

  it("salva sozinho depois do debounce em modo automático", async () => {
    mockReadTextFile.mockResolvedValueOnce("conteúdo original");

    render(
      <FilePane
        projectPath="C:/dev/projeto"
        tab={{ id: "tab-1", kind: "file", title: "a.ts", resourceId: "C:/dev/projeto/a.ts" }}
        saveMode="auto"
        onDirtyChange={() => {}}
      />
    );

    // Aguarda o carregamento inicial (real timers) antes de trocar pra fake timers,
    // senão o polling interno do `findBy*` fica travado esperando um setTimeout que
    // nunca avança.
    const editor = await screen.findByLabelText("editor de código");

    vi.useFakeTimers();
    fireEvent.change(editor, { target: { value: "conteúdo novo" } });

    expect(mockWriteTextFile).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1500);

    expect(mockWriteTextFile).toHaveBeenCalledWith("C:/dev/projeto/a.ts", "conteúdo novo");
  });

  it("não salva sozinho em modo manual", async () => {
    mockReadTextFile.mockResolvedValueOnce("conteúdo original");

    render(
      <FilePane
        projectPath="C:/dev/projeto"
        tab={{ id: "tab-1", kind: "file", title: "a.ts", resourceId: "C:/dev/projeto/a.ts" }}
        saveMode="manual"
        onDirtyChange={() => {}}
      />
    );

    const editor = await screen.findByLabelText("editor de código");

    vi.useFakeTimers();
    fireEvent.change(editor, { target: { value: "conteúdo novo" } });
    await vi.advanceTimersByTimeAsync(5000);

    expect(mockWriteTextFile).not.toHaveBeenCalled();
  });
});
