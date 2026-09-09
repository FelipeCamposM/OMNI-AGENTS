import type { AgentCliId } from "../features/terminal/terminalService";

export type KanbanStatus = "backlog" | "ready" | "doing" | "done" | "failed";

export const KANBAN_STATUSES: KanbanStatus[] = ["backlog", "ready", "doing", "done", "failed"];

export const KANBAN_STATUS_LABEL: Record<KanbanStatus, string> = {
  backlog: "Backlog",
  ready: "Pronta",
  doing: "Rodando",
  done: "Concluída",
  failed: "Falhou",
};

export interface KanbanTask {
  id: string;
  projectId: string;
  title: string;
  description: string;
  status: KanbanStatus;
  position: number;
  /** Total de repetições pedidas (ex.: 5) — `null` = não é loop. */
  loopTotal: number | null;
  /** Quantas repetições faltam, decrementa a cada sucesso. */
  loopRemaining: number | null;
  /** Fim da saída do agente (sucesso) ou resumo do erro (falha). */
  resultNote: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface KanbanState {
  version: 1;
  tasks: KanbanTask[];
  /** Qual CLI o dispatcher usa em cada projeto — default é o primeiro agente disponível. */
  agentByProject: Record<string, AgentCliId>;
  /** Desligado por padrão — capacidade adicional, não substitui o fluxo manual existente. */
  dispatcherEnabled: boolean;
  /** Janela de falhas recentes (ISO) pro circuit-breaker (3 em 5min pausa 30min). */
  failureTimestamps: string[];
  /** ISO — dispatcher pausado até aqui (`null` = não pausado). */
  pausedUntil: string | null;
}

export type KanbanAction =
  | { type: "CREATE_TASK"; projectId: string; title: string; description: string; loopTotal?: number }
  | { type: "UPDATE_TASK"; id: string; title: string; description: string; loopTotal?: number }
  | { type: "REMOVE_TASK"; id: string }
  | { type: "MOVE_TASK"; id: string; status: KanbanStatus }
  | { type: "SET_AGENT_FOR_PROJECT"; projectId: string; agentId: AgentCliId }
  | { type: "SET_DISPATCHER_ENABLED"; enabled: boolean }
  | { type: "TASK_STARTED"; id: string }
  | { type: "TASK_FINISHED"; id: string; outcome: "done" | "failed"; resultNote: string }
  | { type: "RECORD_FAILURE" }
  | { type: "CLEAR_PAUSE" };
