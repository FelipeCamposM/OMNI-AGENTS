import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { FilePane } from "../features/files/FilePane";

const mockReadTextFile = vi.mocked((await import("@tauri-apps/plugin-fs")).readTextFile);
const mockWriteTextFile = vi.mocked((await import("@tauri-apps/plugin-fs")).writeTextFile);

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("FilePane", () => {
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
