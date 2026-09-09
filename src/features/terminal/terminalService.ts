import { invoke } from "@tauri-apps/api/core";

export type TerminalState =
  | "working"
  | "answered"
  | "approval_required"
  | "crashed"
  | "stopped"
  | "orphan";

export interface TerminalSession {
  id: string;
  project_id: string;
  name: string;
  cwd: string;
  shell: string;
  state: TerminalState;
  pid: number | null;
  output_seq: number;
  rows: number;
  cols: number;
}

export type AgentCliId = "cursor" | "gemini" | "claude" | "codex";

export interface AgentCliStatus {
  id: AgentCliId;
  label: string;
  command: string;
  available: boolean;
}

type EngineResponse =
  | { type: "pong"; protocol_version: number; engine_pid: number }
  | { type: "sessions"; sessions: TerminalSession[] }
  | { type: "session"; session: TerminalSession }
  | {
      type: "snapshot";
      session: TerminalSession;
      from_seq: number;
      next_seq: number;
      data: string;
    }
  | { type: "ok" }
  | { type: "error"; code: string; message: string };

function expect<T extends EngineResponse["type"]>(response: EngineResponse, type: T) {
  if (response.type === "error") throw new Error(response.message);
  if (response.type !== type) throw new Error(`Resposta inesperada do engine: ${response.type}`);
  return response as Extract<EngineResponse, { type: T }>;
}

export async function ensureEngine() {
  return expect(await invoke<EngineResponse>("ensure_engine"), "pong");
}

export async function listTerminalSessions() {
  return expect(await invoke<EngineResponse>("terminal_sessions"), "sessions").sessions;
}

export async function listAgentClis() {
  const statuses = await invoke<AgentCliStatus[]>("agent_cli_statuses");
  return Array.isArray(statuses) ? statuses : [];
}

export async function connectAgentCli(id: AgentCliId) {
  await invoke("connect_agent_cli", { id });
}

/** Flag de retomar a última conversa de cada CLI SEM picker interativo — carrega direto as
 * últimas mensagens (igual o Maestrus). `--resume`/`resume` sozinho abre um seletor; o que
 * queremos é o equivalente a "continuar", que pula essa etapa. Genérico: adicionar um agente
 * novo que suporte isso é só uma entrada aqui — nada mais no fluxo de spawn muda. */
export const AGENT_RESUME_FLAG: Partial<Record<AgentCliId, string>> = {
  claude: "--continue",
  codex: "resume --last",
};

/** Pré-aprova o diálogo de "trust this folder" do CLI antes de abrir a PTY (equivalente ao
 * `ensureTrusted` do Maestrus). Não bloqueia o spawn se falhar — só deixa de pular o diálogo. */
export async function ensureAgentTrust(agentId: AgentCliId, cwd: string) {
  try {
    await invoke("ensure_agent_trust", { agentId, cwd });
  } catch {
    // non-blocking: pior caso o usuário só vê o diálogo de trust normalmente.
  }
}

export async function spawnTerminal(input: {
  projectId: string;
  name: string;
  cwd: string;
  rows: number;
  cols: number;
  initialCommand?: string;
}) {
  const { initialCommand, ...terminal } = input;
  const response = await invoke<EngineResponse>("spawn_terminal", {
    ...terminal,
    shell: null,
    initialCommand: initialCommand ?? null,
  });
  return expect(response, "session").session;
}

export async function writeTerminal(sessionId: string, data: string) {
  expect(await invoke<EngineResponse>("write_terminal", { sessionId, data }), "ok");
}

export async function resizeTerminal(sessionId: string, rows: number, cols: number) {
  expect(await invoke<EngineResponse>("resize_terminal", { sessionId, rows, cols }), "ok");
}

export async function stopTerminal(sessionId: string) {
  expect(await invoke<EngineResponse>("stop_terminal", { sessionId }), "ok");
}

export async function closeTerminal(sessionId: string) {
  expect(await invoke<EngineResponse>("close_terminal", { sessionId }), "ok");
}

export async function duplicateTerminal(sessionId: string) {
  return expect(await invoke<EngineResponse>("duplicate_terminal", { sessionId }), "session").session;
}

export async function restartTerminal(sessionId: string) {
  return expect(await invoke<EngineResponse>("restart_terminal", { sessionId }), "session").session;
}

export async function terminalSnapshot(sessionId: string, since: number) {
  return expect(
    await invoke<EngineResponse>("terminal_snapshot", { sessionId, since }),
    "snapshot"
  );
}
