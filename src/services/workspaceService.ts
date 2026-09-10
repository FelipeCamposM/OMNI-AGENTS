import type { LayoutNode, Project, WorkspaceCollection, WorkspaceState } from "../types/workspace";

export const WORKSPACE_STORAGE_KEY = "omni-agents-workspace";
const PANE_KINDS = new Set([
  "agent",
  "terminal",
  "command",
  "file",
  "markdown",
  "git-diff",
  "git-graph",
  "kanban",
  "logs",
  "docker-logs",
]);

export function emptyWorkspace(): WorkspaceState {
  return {
    version: 1,
    id: "default",
    name: "Workspace",
    projects: [],
    activeProjectId: null,
    updatedAt: new Date().toISOString(),
  };
}

function isWorkspace(value: unknown): value is WorkspaceState {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<WorkspaceState>;
  return (
    candidate.version === 1 &&
    typeof candidate.id === "string" &&
    typeof candidate.name === "string" &&
    Array.isArray(candidate.projects) &&
    candidate.projects.every(isProject) &&
    (candidate.activeProjectId === null ||
      (typeof candidate.activeProjectId === "string" &&
        candidate.projects.some((project) => project.id === candidate.activeProjectId)))
  );
}

function isProject(value: unknown): value is Project {
  if (!value || typeof value !== "object") return false;
  const project = value as Partial<Project>;
  return (
    typeof project.id === "string" &&
    typeof project.name === "string" &&
    typeof project.path === "string" &&
    typeof project.activePaneId === "string" &&
    isLayoutNode(project.layout) &&
    hasPane(project.layout, project.activePaneId)
  );
}

function isLayoutNode(value: unknown): value is LayoutNode {
  if (!value || typeof value !== "object") return false;
  const node = value as Partial<LayoutNode>;
  if (node.type === "pane") {
    return (
      typeof node.id === "string" &&
      Array.isArray(node.tabs) &&
      node.tabs.every(
        (tab) =>
          tab &&
          typeof tab.id === "string" &&
          typeof tab.title === "string" &&
          typeof tab.kind === "string" && PANE_KINDS.has(tab.kind)
      ) &&
      (node.tabs.length === 0
        ? node.activeTabId === null
        : typeof node.activeTabId === "string" && node.tabs.some((tab) => tab.id === node.activeTabId))
    );
  }
  return (
    node.type === "split" &&
    typeof node.id === "string" &&
    (node.direction === "horizontal" || node.direction === "vertical") &&
    typeof node.ratio === "number" &&
    node.ratio >= 0.2 &&
    node.ratio <= 0.8 &&
    isLayoutNode(node.first) &&
    isLayoutNode(node.second)
  );
}

function hasPane(node: LayoutNode, paneId: string): boolean {
  return node.type === "pane"
    ? node.id === paneId
    : hasPane(node.first, paneId) || hasPane(node.second, paneId);
}

export function loadWorkspace(): WorkspaceState {
  try {
    const raw = localStorage.getItem(WORKSPACE_STORAGE_KEY);
    if (!raw) return emptyWorkspace();
    const parsed: unknown = JSON.parse(raw);
    return isWorkspace(parsed) ? parsed : emptyWorkspace();
  } catch {
    return emptyWorkspace();
  }
}

export function saveWorkspace(workspace: WorkspaceState): void {
  localStorage.setItem(WORKSPACE_STORAGE_KEY, JSON.stringify(workspace));
}

export const WORKSPACES_STORAGE_KEY = "omni-agents-workspaces";

function normalizeCollection(raw: unknown): WorkspaceCollection | null {
  if (!raw || typeof raw !== "object") return null;
  const candidate = raw as Partial<WorkspaceCollection>;
  if (candidate.version !== 1 || !Array.isArray(candidate.workspaces)) return null;
  // Um workspace estruturalmente inválido é descartado sozinho, não a coleção inteira —
  // diferente do "tudo ou nada" de isWorkspace, proporcional a uma lista de N itens.
  const workspaces = candidate.workspaces.filter(isWorkspace);
  if (workspaces.length === 0) return { version: 1, workspaces: [emptyWorkspace()], activeWorkspaceId: null };
  const activeWorkspaceId = workspaces.some((workspace) => workspace.id === candidate.activeWorkspaceId)
    ? (candidate.activeWorkspaceId as string)
    : workspaces[0].id;
  return { version: 1, workspaces, activeWorkspaceId };
}

function migrateLegacyWorkspace(): WorkspaceCollection {
  const legacy = loadWorkspace();
  const workspace =
    legacy.id === "default" && legacy.name === "Workspace" ? { ...legacy, name: "Workspace 1" } : legacy;
  return { version: 1, workspaces: [workspace], activeWorkspaceId: workspace.id };
}

export function loadWorkspaces(): WorkspaceCollection {
  try {
    const raw = localStorage.getItem(WORKSPACES_STORAGE_KEY);
    if (raw) {
      const normalized = normalizeCollection(JSON.parse(raw));
      if (normalized) return normalized;
    }
  } catch {
    // cai para a migração da chave legada abaixo
  }
  return migrateLegacyWorkspace();
}

export function saveWorkspaces(collection: WorkspaceCollection): void {
  localStorage.setItem(WORKSPACES_STORAGE_KEY, JSON.stringify(collection));
}
