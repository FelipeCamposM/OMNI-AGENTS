import { KANBAN_STATUSES, type KanbanState, type KanbanTask } from "../types/kanban";
import { emptyKanban } from "../features/kanban/kanbanReducer";

export const KANBAN_STORAGE_KEY = "omni-agents-kanban";

function isTask(value: unknown): value is KanbanTask {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<KanbanTask>;
  return (
    typeof candidate.id === "string" &&
    typeof candidate.projectId === "string" &&
    typeof candidate.title === "string" &&
    typeof candidate.description === "string" &&
    typeof candidate.status === "string" &&
    KANBAN_STATUSES.includes(candidate.status) &&
    typeof candidate.position === "number" &&
    typeof candidate.createdAt === "string" &&
    typeof candidate.updatedAt === "string"
  );
}

function normalize(raw: unknown): KanbanState | null {
  if (!raw || typeof raw !== "object") return null;
  const candidate = raw as Partial<KanbanState>;
  if (candidate.version !== 1 || !Array.isArray(candidate.tasks)) return null;
  return {
    version: 1,
    // Task individualmente inválida é descartada sozinha, não o board inteiro.
    tasks: candidate.tasks.filter(isTask),
    agentByProject:
      candidate.agentByProject && typeof candidate.agentByProject === "object" ? candidate.agentByProject : {},
    dispatcherEnabled: candidate.dispatcherEnabled === true,
    failureTimestamps: Array.isArray(candidate.failureTimestamps) ? candidate.failureTimestamps : [],
    pausedUntil: typeof candidate.pausedUntil === "string" ? candidate.pausedUntil : null,
  };
}

export function loadKanban(): KanbanState {
  try {
    const raw = localStorage.getItem(KANBAN_STORAGE_KEY);
    if (raw) {
      const normalized = normalize(JSON.parse(raw));
      if (normalized) return normalized;
    }
  } catch {
    // cai pro board vazio abaixo
  }
  return emptyKanban();
}

export function saveKanban(state: KanbanState): void {
  localStorage.setItem(KANBAN_STORAGE_KEY, JSON.stringify(state));
}
