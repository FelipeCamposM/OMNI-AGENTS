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
  input_locked?: boolean;
}

export type AgentCliId = "cursor" | "gemini" | "claude" | "codex";

export interface AgentCliStatus {
  id: AgentCliId;
  label: string;
  command: string;
  /** Caminho absoluto resolvido no PATH, ou null quando a CLI não foi encontrada. */
  path: string | null;
  /** A CLI existe no PATH. */
  available: boolean;
  /** A CLI tem credencial gravada no config dir dela — só isso conta como "conectado". */
  authenticated: boolean;
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

export async function connectAgentCli(id: AgentCliId, profileId?: string) {
  await invoke("connect_agent_cli", { id, profileId: profileId ?? null });
}

/** Conta de um provider, isolada por diretório de configuração (spec §9.3). O OMNI guarda só
 *  nome, provider e caminho — nunca credencial (§9.4). */
export interface Profile {
  id: string;
  provider: AgentCliId;
  name: string;
  config_dir: string;
  /** Aponta para o diretório nativo do CLI; nasce sozinho e não pode ser removido. */
  builtin: boolean;
  created_at_ms: number;
  last_used_at_ms: number | null;
  authenticated: boolean;
}

export async function listProfiles() {
  const profiles = await invoke<Profile[]>("list_profiles");
  return Array.isArray(profiles) ? profiles : [];
}

export async function createProfile(provider: AgentCliId, name: string) {
  return invoke<Profile>("create_profile", { provider, name });
}

export async function renameProfile(profileId: string, name: string) {
  await invoke("rename_profile", { profileId, name });
}

export async function deleteProfile(profileId: string) {
  await invoke("delete_profile", { profileId });
}

/** Providers que suportam mais de uma conta. Espelha `config_dir_var` em profiles.rs — os outros
 *  CLIs não leem env var de config dir, então só têm o perfil padrão. */
export const MULTI_ACCOUNT_PROVIDERS: AgentCliId[] = ["claude", "codex"];

/** O que o launcher devolve: qual CLI abrir e em qual conta. */
export interface AgentLaunch {
  agent: AgentCliStatus;
  profile: Profile | null;
  /** Já preenchido quando o lançamento veio de uma troca de conta/IA: a conversa existe, então
   *  não se abre outra. Ausente no primeiro lançamento. */
  conversationId?: string;
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
export async function ensureAgentTrust(agentId: AgentCliId, cwd: string, profileId?: string) {
  try {
    await invoke("ensure_agent_trust", { agentId, cwd, profileId: profileId ?? null });
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
  provider?: AgentCliId;
  profileId?: string;
  conversationId?: string;
  externalSessionId?: string;
}) {
  const { initialCommand, provider, profileId, conversationId, externalSessionId, ...terminal } = input;
  const response = await invoke<EngineResponse>("spawn_terminal", {
    ...terminal,
    shell: null,
    initialCommand: initialCommand ?? null,
    provider: provider ?? null,
    profileId: profileId ?? null,
    conversationId: conversationId ?? null,
    externalSessionId: externalSessionId ?? null,
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

/** Um trecho de conversa: uma sessão nativa de um provider, numa conta. */
export interface ConversationSegment {
  provider: AgentCliId;
  profile_id: string | null;
  external_session_id: string | null;
  transcript_path: string | null;
  terminal_session_id: string | null;
  started_at_ms: number;
  ended_at_ms: number | null;
}

/** Conversa lógica: a timeline que atravessa troca de conta e de IA. É um índice de ponteiros —
 *  as mensagens ficam nos `.jsonl` dos providers, o OMNI não as duplica. */
export interface Conversation {
  id: string;
  project_id: string;
  cwd: string;
  title: string;
  created_at_ms: number;
  segments: ConversationSegment[];
}

/** O que a UI precisa para abrir o próximo terminal de uma conversa. */
export interface LaunchPlan {
  conversation_id: string;
  provider: AgentCliId;
  profile_id: string | null;
  initial_command: string;
  external_session_id: string | null;
  /** `true` quando o agente novo recebe um briefing em vez da conversa. */
  handoff: boolean;
  handoff_path: string | null;
  notice: string | null;
}

export async function listConversations(projectId: string) {
  const conversations = await invoke<Conversation[]>("list_conversations", { projectId });
  return Array.isArray(conversations) ? conversations : [];
}

export async function beginConversation(input: {
  projectId: string;
  cwd: string;
  provider: AgentCliId;
  profileId?: string;
  command: string;
  title?: string;
}) {
  return invoke<LaunchPlan>("begin_conversation", {
    projectId: input.projectId,
    cwd: input.cwd,
    provider: input.provider,
    profileId: input.profileId ?? null,
    command: input.command,
    title: input.title ?? null,
  });
}

export async function attachTerminal(conversationId: string, terminalSessionId: string) {
  await invoke("attach_terminal", { conversationId, terminalSessionId });
}

/** Pede ao agente que ainda responde para deixar o briefing em disco antes de sair. Sempre melhor
 *  que o forçado: o agente sabe o que estava fazendo. */
export async function handoffPrompt(conversationId: string) {
  return invoke<string>("handoff_prompt", { conversationId });
}

export async function planSwitch(input: {
  conversationId: string;
  targetProvider: AgentCliId;
  targetProfileId?: string;
  targetCommand: string;
}) {
  return invoke<LaunchPlan>("plan_switch", {
    conversationId: input.conversationId,
    targetProvider: input.targetProvider,
    targetProfileId: input.targetProfileId ?? null,
    targetCommand: input.targetCommand,
  });
}
