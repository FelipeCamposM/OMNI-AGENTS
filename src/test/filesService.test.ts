import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  DEFAULT_IGNORES,
  baseName,
  copyIntoProject,
  createDir,
  createFile,
  dirName,
  isIgnored,
  isImagePath,
  joinPath,
  listDir,
  readTextFile,
  removePath,
  renamePath,
  writeBinaryFile,
  writeTextFile,
} from "../features/files/filesService";

const mockReadDir = vi.mocked((await import("@tauri-apps/plugin-fs")).readDir);
const mockReadTextFile = vi.mocked((await import("@tauri-apps/plugin-fs")).readTextFile);
const mockWriteTextFile = vi.mocked((await import("@tauri-apps/plugin-fs")).writeTextFile);
const mockMkdir = vi.mocked((await import("@tauri-apps/plugin-fs")).mkdir);
const mockRemove = vi.mocked((await import("@tauri-apps/plugin-fs")).remove);
const mockRename = vi.mocked((await import("@tauri-apps/plugin-fs")).rename);
const mockCopyFile = vi.mocked((await import("@tauri-apps/plugin-fs")).copyFile);
const mockWriteFile = vi.mocked((await import("@tauri-apps/plugin-fs")).writeFile);
const mockStat = vi.mocked((await import("@tauri-apps/plugin-fs")).stat);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("isIgnored", () => {
  it("ignora nomes da lista padrão", () => {
    expect(isIgnored("node_modules", DEFAULT_IGNORES)).toBe(true);
    expect(isIgnored(".git", DEFAULT_IGNORES)).toBe(true);
  });

  it("não ignora nomes fora da lista", () => {
    expect(isIgnored("src", DEFAULT_IGNORES)).toBe(false);
  });

  it("respeita uma lista customizada (aditiva)", () => {
    const custom = [...DEFAULT_IGNORES, "vendor"];
    expect(isIgnored("vendor", custom)).toBe(true);
    expect(isIgnored("node_modules", custom)).toBe(true);
  });
});

describe("listDir", () => {
  it("filtra entradas ignoradas e ordena pastas antes de arquivos", async () => {
    mockReadDir.mockResolvedValueOnce([
      { name: "zeta.ts", isDirectory: false, isFile: true, isSymlink: false },
      { name: "node_modules", isDirectory: true, isFile: false, isSymlink: false },
      { name: "alpha", isDirectory: true, isFile: false, isSymlink: false },
    ]);

    const entries = await listDir("C:\\dev\\projeto", "", DEFAULT_IGNORES);

    expect(entries.map((entry) => entry.name)).toEqual(["alpha", "zeta.ts"]);
    expect(entries[0].isDirectory).toBe(true);
  });
});

describe("restrição de raiz do projeto", () => {
  it("rejeita leitura de caminho fora da raiz do projeto", async () => {
    await expect(readTextFile("C:\\outro\\arquivo.txt", "C:\\dev\\projeto")).rejects.toThrow();
    expect(mockReadTextFile).not.toHaveBeenCalled();
  });

  it("rejeita escrita de caminho fora da raiz do projeto", async () => {
    await expect(writeTextFile("C:\\outro\\arquivo.txt", "C:\\dev\\projeto", "x")).rejects.toThrow();
    expect(mockWriteTextFile).not.toHaveBeenCalled();
  });

  it("permite leitura de caminho dentro da raiz", async () => {
    mockReadTextFile.mockResolvedValueOnce("conteúdo");
    const text = await readTextFile("C:\\dev\\projeto\\src\\a.ts", "C:\\dev\\projeto");
    expect(text).toBe("conteúdo");
  });

  it("rejeita criar arquivo/pasta fora da raiz", async () => {
    await expect(createFile("C:\\dev\\projeto", "C:\\outro\\a.ts")).rejects.toThrow();
    await expect(createDir("C:\\dev\\projeto", "C:\\outro\\pasta")).rejects.toThrow();
    expect(mockMkdir).not.toHaveBeenCalled();
  });

  it("rejeita renomear/mover pra fora da raiz", async () => {
    await expect(renamePath("C:\\dev\\projeto", "C:\\dev\\projeto\\a.ts", "C:\\outro\\a.ts")).rejects.toThrow();
    expect(mockRename).not.toHaveBeenCalled();
  });

  it("rejeita excluir fora da raiz", async () => {
    await expect(removePath("C:\\dev\\projeto", "C:\\outro\\a.ts", false)).rejects.toThrow();
    expect(mockRemove).not.toHaveBeenCalled();
  });

  it("passa recursive:true só pra pastas ao excluir", async () => {
    await removePath("C:\\dev\\projeto", "C:\\dev\\projeto\\src", true);
    expect(mockRemove).toHaveBeenCalledWith("C:\\dev\\projeto\\src", { recursive: true });

    await removePath("C:\\dev\\projeto", "C:\\dev\\projeto\\a.ts", false);
    expect(mockRemove).toHaveBeenCalledWith("C:\\dev\\projeto\\a.ts", { recursive: false });
  });
});

describe("copiar arquivos externos (Explorer do Windows)", () => {
  it("copia um arquivo externo pro destino dentro do projeto", async () => {
    mockStat.mockResolvedValueOnce({ isDirectory: false, isFile: true, isSymlink: false } as never);

    const dest = await copyIntoProject("C:\\dev\\projeto", "C:\\Users\\me\\Desktop\\foto.png", "C:\\dev\\projeto\\assets");

    expect(dest).toBe("C:\\dev\\projeto\\assets\\foto.png");
    expect(mockCopyFile).toHaveBeenCalledWith("C:\\Users\\me\\Desktop\\foto.png", "C:\\dev\\projeto\\assets\\foto.png");
  });

  it("copia uma pasta externa recursivamente", async () => {
    mockStat.mockResolvedValueOnce({ isDirectory: true, isFile: false, isSymlink: false } as never);
    mockReadDir.mockResolvedValueOnce([{ name: "a.txt", isDirectory: false, isFile: true, isSymlink: false }]);
    mockStat.mockResolvedValueOnce({ isDirectory: false, isFile: true, isSymlink: false } as never);

    await copyIntoProject("C:\\dev\\projeto", "C:\\Users\\me\\Desktop\\pasta", "C:\\dev\\projeto");

    expect(mockMkdir).toHaveBeenCalledWith("C:\\dev\\projeto\\pasta", { recursive: true });
    expect(mockCopyFile).toHaveBeenCalledWith("C:\\Users\\me\\Desktop\\pasta\\a.txt", "C:\\dev\\projeto\\pasta\\a.txt");
  });

  it("rejeita copiar pra destino fora da raiz do projeto", async () => {
    await expect(copyIntoProject("C:\\dev\\projeto", "C:\\fora\\a.txt", "C:\\outro\\lugar")).rejects.toThrow();
    expect(mockCopyFile).not.toHaveBeenCalled();
  });
});

describe("colar (Ctrl+V) conteúdo de arquivo", () => {
  it("escreve os bytes recebidos dentro da raiz do projeto", async () => {
    const data = new Uint8Array([1, 2, 3]);
    await writeBinaryFile("C:\\dev\\projeto", "C:\\dev\\projeto\\colado.bin", data);
    expect(mockWriteFile).toHaveBeenCalledWith("C:\\dev\\projeto\\colado.bin", data);
  });

  it("rejeita colar fora da raiz do projeto", async () => {
    await expect(writeBinaryFile("C:\\dev\\projeto", "C:\\outro\\colado.bin", new Uint8Array())).rejects.toThrow();
    expect(mockWriteFile).not.toHaveBeenCalled();
  });
});

describe("isImagePath", () => {
  it("reconhece extensões de imagem comuns, sem diferenciar maiúsculas", () => {
    expect(isImagePath("C:\\dev\\projeto\\logo.png")).toBe(true);
    expect(isImagePath("C:\\dev\\projeto\\foto.JPG")).toBe(true);
    expect(isImagePath("C:\\dev\\projeto\\icone.svg")).toBe(true);
  });

  it("não marca arquivo de texto como imagem", () => {
    expect(isImagePath("C:\\dev\\projeto\\a.ts")).toBe(false);
    expect(isImagePath("C:\\dev\\projeto\\readme.md")).toBe(false);
  });
});

describe("path helpers", () => {
  it("joinPath junta segmentos respeitando o separador da base", () => {
    expect(joinPath("C:\\dev\\projeto", "src", "a.ts")).toBe("C:\\dev\\projeto\\src\\a.ts");
    expect(joinPath("/home/dev/projeto", "src", "a.ts")).toBe("/home/dev/projeto/src/a.ts");
  });

  it("dirName e baseName cobrem os dois separadores", () => {
    expect(dirName("C:\\dev\\projeto\\src\\a.ts")).toBe("C:\\dev\\projeto\\src");
    expect(baseName("C:\\dev\\projeto\\src\\a.ts")).toBe("a.ts");
    expect(dirName("/home/dev/projeto/a.ts")).toBe("/home/dev/projeto");
    expect(baseName("/home/dev/projeto/a.ts")).toBe("a.ts");
  });
});
