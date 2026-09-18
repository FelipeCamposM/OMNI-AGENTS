import { normalizePath, projectName, wslDistroOf } from "../lib/paths";

const STORAGE_KEY = "omni-agents-recent-projects";
const LIMIT = 15;

export interface RecentProject {
  path: string;
  name: string;
  openedAt: number;
}

export function listRecentProjects(): RecentProject[] {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]");
    if (!Array.isArray(raw)) return [];
    return raw.filter((item): item is RecentProject => typeof item?.path === "string");
  } catch {
    return [];
  }
}

/** Move o projeto para o topo da lista (sem duplicar caminho, ignorando caixa, como o reducer). */
export function rememberProject(path: string): void {
  const outros = listRecentProjects().filter((item) => normalizePath(item.path) !== normalizePath(path));
  const lista = [{ path, name: projectName(path), openedAt: Date.now() }, ...outros].slice(0, LIMIT);
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(lista));
  } catch {
    /* sem armazenamento: a lista vale só nesta sessão */
  }
}

export function forgetProject(path: string): void {
  const lista = listRecentProjects().filter((item) => normalizePath(item.path) !== normalizePath(path));
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(lista));
  } catch {
    /* idem */
  }
}

// Reexportados para quem já importava daqui; a regra mora em `src/lib/paths.ts`.
export { projectName, wslDistroOf };
