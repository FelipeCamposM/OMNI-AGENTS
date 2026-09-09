import {
  copyFile,
  exists,
  mkdir,
  readDir,
  readTextFile as pluginReadTextFile,
  remove,
  rename as pluginRename,
  stat,
  writeFile as pluginWriteFile,
  writeTextFile as pluginWriteTextFile,
} from "@tauri-apps/plugin-fs";

export interface FileEntry {
  name: string;
  path: string;
  isDirectory: boolean;
}

const IMAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "gif", "webp", "bmp", "ico", "svg"]);

export function isImagePath(path: string): boolean {
  const extension = path.split(".").pop()?.toLowerCase() ?? "";
  return IMAGE_EXTENSIONS.has(extension);
}

export const DEFAULT_IGNORES = [
  ".git",
  "node_modules",
  "target",
  "dist",
  "build",
  ".venv",
  "venv",
  "__pycache__",
  ".next",
  "coverage",
];

export function isIgnored(name: string, ignoreList: string[]): boolean {
  return ignoreList.includes(name);
}

export function joinPath(base: string, ...parts: string[]): string {
  const separator = base.includes("\\") ? "\\" : "/";
  return [base.replace(/[\\/]+$/, ""), ...parts.filter(Boolean)].join(separator);
}

export function dirName(path: string): string {
  const index = Math.max(path.lastIndexOf("\\"), path.lastIndexOf("/"));
  return index === -1 ? path : path.slice(0, index);
}

export function baseName(path: string): string {
  const index = Math.max(path.lastIndexOf("\\"), path.lastIndexOf("/"));
  return index === -1 ? path : path.slice(index + 1);
}

function isWithinRoot(absolutePath: string, root: string): boolean {
  const normalized = absolutePath.replace(/\\/g, "/").toLowerCase();
  const normalizedRoot = root.replace(/\\/g, "/").toLowerCase().replace(/\/$/, "");
  return normalized === normalizedRoot || normalized.startsWith(`${normalizedRoot}/`);
}

function assertWithinRoot(absolutePath: string, projectRoot: string): void {
  if (!isWithinRoot(absolutePath, projectRoot)) {
    throw new Error(`Caminho fora da raiz do projeto: ${absolutePath}`);
  }
}

/** Lê `.omni/project.json` (spec §24.2) se existir e devolve a lista de ignore
 * mesclada com os padrões — nunca substitui, só acrescenta. Falha silenciosa
 * (config ausente/inválida cai pros padrões) — não é motivo de erro pro usuário. */
export async function resolveIgnoreList(projectRoot: string): Promise<string[]> {
  try {
    const configPath = joinPath(projectRoot, ".omni", "project.json");
    if (!(await exists(configPath))) return DEFAULT_IGNORES;
    const raw = await pluginReadTextFile(configPath);
    const parsed = JSON.parse(raw) as { exclude?: unknown };
    const extra = Array.isArray(parsed.exclude) ? parsed.exclude.filter((item): item is string => typeof item === "string") : [];
    return [...DEFAULT_IGNORES, ...extra];
  } catch {
    return DEFAULT_IGNORES;
  }
}

export async function listDir(projectRoot: string, relativePath: string, ignoreList: string[]): Promise<FileEntry[]> {
  const absoluteDir = relativePath ? joinPath(projectRoot, relativePath) : projectRoot;
  assertWithinRoot(absoluteDir, projectRoot);
  const entries = await readDir(absoluteDir);
  return entries
    .filter((entry) => !isIgnored(entry.name, ignoreList))
    .map((entry) => ({ name: entry.name, path: joinPath(absoluteDir, entry.name), isDirectory: entry.isDirectory }))
    .sort((a, b) => {
      if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
}

export async function readTextFile(absolutePath: string, projectRoot: string): Promise<string> {
  assertWithinRoot(absolutePath, projectRoot);
  return pluginReadTextFile(absolutePath);
}

export async function writeTextFile(absolutePath: string, projectRoot: string, content: string): Promise<void> {
  assertWithinRoot(absolutePath, projectRoot);
  await pluginWriteTextFile(absolutePath, content);
}

export async function fileMtime(absolutePath: string): Promise<number> {
  const info = await stat(absolutePath);
  return info.mtime ? info.mtime.getTime() : 0;
}

export async function createFile(projectRoot: string, absolutePath: string): Promise<void> {
  assertWithinRoot(absolutePath, projectRoot);
  await pluginWriteTextFile(absolutePath, "");
}

export async function createDir(projectRoot: string, absolutePath: string): Promise<void> {
  assertWithinRoot(absolutePath, projectRoot);
  await mkdir(absolutePath);
}

/** Também usado pra mover — mover é só renomear pra um caminho sob outra pasta. */
export async function renamePath(projectRoot: string, fromPath: string, toPath: string): Promise<void> {
  assertWithinRoot(fromPath, projectRoot);
  assertWithinRoot(toPath, projectRoot);
  await pluginRename(fromPath, toPath);
}

export async function removePath(projectRoot: string, absolutePath: string, isDirectory: boolean): Promise<void> {
  assertWithinRoot(absolutePath, projectRoot);
  await remove(absolutePath, { recursive: isDirectory });
}

/** Copia um arquivo/pasta de FORA do projeto (ex.: arrastado do Explorer do Windows) pra
 * dentro de `targetDirAbsolutePath`. A origem não precisa estar dentro da raiz — só o
 * destino é validado. Pastas são copiadas recursivamente (o plugin não tem cópia recursiva
 * nativa). Sobrescreve se já existir um item com o mesmo nome, igual o Explorer faria numa
 * colagem sem perguntar. */
export async function copyIntoProject(
  projectRoot: string,
  sourceAbsolutePath: string,
  targetDirAbsolutePath: string
): Promise<string> {
  assertWithinRoot(targetDirAbsolutePath, projectRoot);
  const destPath = joinPath(targetDirAbsolutePath, baseName(sourceAbsolutePath));
  const info = await stat(sourceAbsolutePath);
  if (info.isDirectory) {
    await mkdir(destPath, { recursive: true });
    const entries = await readDir(sourceAbsolutePath);
    for (const entry of entries) {
      await copyIntoProject(projectRoot, joinPath(sourceAbsolutePath, entry.name), destPath);
    }
  } else {
    await copyFile(sourceAbsolutePath, destPath);
  }
  return destPath;
}

/** Escreve bytes crus — usado pra colar (Ctrl+V) um arquivo copiado no Explorer, onde só se
 * tem o conteúdo (via Clipboard API), não o caminho original de disco. */
export async function writeBinaryFile(projectRoot: string, absolutePath: string, data: Uint8Array): Promise<void> {
  assertWithinRoot(absolutePath, projectRoot);
  await pluginWriteFile(absolutePath, data);
}
