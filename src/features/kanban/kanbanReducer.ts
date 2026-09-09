import type { KanbanAction, KanbanState, KanbanTask } from "../../types/kanban";

let sequence = 0;

function nextId(): string {
  sequence += 1;
  return `task-${Date.now().toString(36)}-${sequence.toString(36)}`;
}

/** Contador monotônico simples pra `position` — cada task nova/movida vai pro fim da sua coluna.
 * Não dá reordenação fina dentro da mesma coluna (arrastar só entre colunas), suficiente pro
 * pedido — sem lib de drag/sort nova só por causa disso. */
function nextPosition(): number {
  sequence += 1;
  return sequence;
}

const FAILURE_WINDOW_MS = 5 * 60_000;
const CIRCUIT_BREAKER_THRESHOLD = 3;
const PAUSE_DURATION_MS = 30 * 60_000;

export function emptyKanban(): KanbanState {
  return {
    version: 1,
    tasks: [],
    agentByProject: {},
    dispatcherEnabled: false,
    failureTimestamps: [],
    pausedUntil: null,
  };
}

export function kanbanReducer(state: KanbanState, action: KanbanAction): KanbanState {
  switch (action.type) {
    case "CREATE_TASK": {
      const now = new Date().toISOString();
      const task: KanbanTask = {
        id: nextId(),
        projectId: action.projectId,
        title: action.title.trim(),
        description: action.description,
        status: "backlog",
        position: nextPosition(),
        loopTotal: action.loopTotal && action.loopTotal > 1 ? action.loopTotal : null,
        loopRemaining: action.loopTotal && action.loopTotal > 1 ? action.loopTotal : null,
        resultNote: null,
        createdAt: now,
        updatedAt: now,
      };
      return { ...state, tasks: [...state.tasks, task] };
    }
    case "UPDATE_TASK":
      return {
        ...state,
        tasks: state.tasks.map((task) =>
          task.id === action.id
            ? {
                ...task,
                title: action.title.trim() || task.title,
                description: action.description,
                loopTotal: action.loopTotal && action.loopTotal > 1 ? action.loopTotal : null,
                loopRemaining: action.loopTotal && action.loopTotal > 1 ? action.loopTotal : null,
                updatedAt: new Date().toISOString(),
              }
            : task
        ),
      };
    case "REMOVE_TASK":
      return { ...state, tasks: state.tasks.filter((task) => task.id !== action.id) };
    case "MOVE_TASK":
      return {
        ...state,
        tasks: state.tasks.map((task) =>
          task.id === action.id
            ? { ...task, status: action.status, position: nextPosition(), updatedAt: new Date().toISOString() }
            : task
        ),
      };
    case "SET_AGENT_FOR_PROJECT":
      return { ...state, agentByProject: { ...state.agentByProject, [action.projectId]: action.agentId } };
    case "SET_DISPATCHER_ENABLED":
      return { ...state, dispatcherEnabled: action.enabled };
    case "TASK_STARTED":
      return {
        ...state,
        tasks: state.tasks.map((task) =>
          task.id === action.id ? { ...task, status: "doing", updatedAt: new Date().toISOString() } : task
        ),
      };
    case "TASK_FINISHED":
      return {
        ...state,
        tasks: state.tasks.map((task) => {
          if (task.id !== action.id) return task;
          const now = new Date().toISOString();
          if (action.outcome === "done" && task.loopRemaining && task.loopRemaining > 1) {
            // Loop: mais uma rodada — volta pra "ready" em vez de fechar em "done".
            return {
              ...task,
              status: "ready",
              loopRemaining: task.loopRemaining - 1,
              resultNote: action.resultNote,
              position: nextPosition(),
              updatedAt: now,
            };
          }
          return { ...task, status: action.outcome, resultNote: action.resultNote, updatedAt: now };
        }),
      };
    case "RECORD_FAILURE": {
      const now = Date.now();
      const recent = [...state.failureTimestamps, new Date(now).toISOString()].filter(
        (iso) => now - new Date(iso).getTime() <= FAILURE_WINDOW_MS
      );
      const pausedUntil =
        recent.length >= CIRCUIT_BREAKER_THRESHOLD ? new Date(now + PAUSE_DURATION_MS).toISOString() : state.pausedUntil;
      return { ...state, failureTimestamps: pausedUntil ? [] : recent, pausedUntil };
    }
    case "CLEAR_PAUSE":
      return { ...state, pausedUntil: null, failureTimestamps: [] };
  }
}
