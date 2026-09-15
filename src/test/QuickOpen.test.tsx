import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { listAllFiles } from "../features/files/filesService";
import { QuickOpen, fuzzyScore } from "../features/files/QuickOpen";

const mockReadDir = vi.mocked((await import("@tauri-apps/plugin-fs")).readDir);

function dir(entries: Array<[string, boolean]>) {
  return entries.map(([name, isDirectory]) => ({ name, isDirectory, isFile: !isDirectory, isSymlink: false }));
}

function mockProject() {
  mockReadDir.mockImplementation(async (path) => {
    const p = String(path);
    if (p === "C:\\proj") return dir([[".env", false], ["src", true], ["node_modules", true], ["package.json", false]]);
    if (p === "C:\\proj\\src") return dir([["App.tsx", false], ["env.ts", false]]);
    return [];
  });
}

describe("fuzzyScore", () => {
  it("exige as letras em ordem", () => {
    expect(fuzzyScore("apx", "src/App.tsx")).not.toBeNull();
    expect(fuzzyScore("xpa", "src/App.tsx")).toBeNull();
  });

  it("prefere acerto no nome do arquivo", () => {
    expect(fuzzyScore("env", ".env")!).toBeGreaterThan(fuzzyScore("env", "src/environments/config.ts")!);
  });
});

describe("listAllFiles", () => {
  it("desce nas pastas, respeita o ignore e mantém dotfiles", async () => {
    mockProject();
    const files = await listAllFiles("C:\\proj", ["node_modules"]);
    expect(files.map((file) => file.name).sort()).toEqual([".env", "App.tsx", "env.ts", "package.json"]);
  });
});

describe("QuickOpen", () => {
  it("Ctrl+P abre, filtra e Enter abre o arquivo", async () => {
    mockProject();
    const onOpenFile = vi.fn();
    render(<QuickOpen projectPath="C:\proj" onOpenFile={onOpenFile} />);

    fireEvent.keyDown(window, { key: "p", ctrlKey: true });
    const input = await screen.findByLabelText("Buscar arquivo pelo nome");
    await screen.findByText(".env");

    fireEvent.change(input, { target: { value: ".env" } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(onOpenFile).toHaveBeenCalledWith("C:\\proj\\.env");
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
