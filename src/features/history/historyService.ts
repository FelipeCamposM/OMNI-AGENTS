import { invoke } from "@tauri-apps/api/core";

export type HistoryProvider = "claude" | "codex";

/** Uma conversa gravada pelo próprio CLI (`omni_core::history::HistoryEntry`). */
export interface HistoryEntry {
  provider: HistoryProvider;
  profile_id: string;
  profile_name: string;
  /** Id nativo — o que `claude --resume` e `codex resume` recebem. */
  session_id: string;
  title: string | null;
  first_prompt: string | null;
  cwd: string | null;
  started_at_ms: number | null;
  updated_at_ms: number;
  path: string;
}

export interface HistoryMessage {
  role: "user" | "assistant";
  text: string;
  timestamp: string | null;
}

export interface HistoryTranscript {
  messages: HistoryMessage[];
  total: number;
}

export async function listHistory(provider: HistoryProvider) {
  const entries = await invoke<HistoryEntry[]>("agent_history", { provider });
  return Array.isArray(entries) ? entries : [];
}

export async function readTranscript(entry: HistoryEntry) {
  return invoke<HistoryTranscript>("agent_history_transcript", { provider: entry.provider, path: entry.path });
}

/** Comando que reabre a conversa exata no CLI, na conta dela (o env da conta vem do `profileId`). */
export function resumeCommand(cliCommand: string, entry: HistoryEntry): string {
  return entry.provider === "claude"
    ? `${cliCommand} --resume ${entry.session_id}`
    : `${cliCommand} resume ${entry.session_id}`;
}

/** Caminhos do Windows chegam com caixa e barra diferentes conforme quem gravou. */
export function samePath(a: string | null | undefined, b: string | null | undefined): boolean {
  const normalize = (path: string) => path.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
  return a != null && b != null && normalize(a) === normalize(b);
}

export interface HistoryFilter {
  query: string;
  cwd: string;
  profileId: string;
}

/** Busca por palavras (todas precisam aparecer) em título, primeiro prompt, pasta e id. */
export function filterHistory(entries: HistoryEntry[], { query, cwd, profileId }: HistoryFilter): HistoryEntry[] {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  return entries.filter(
    (entry) =>
      (!cwd || samePath(entry.cwd, cwd)) &&
      (!profileId || entry.profile_id === profileId) &&
      terms.every((term) =>
        [entry.title, entry.first_prompt, entry.cwd, entry.session_id].some((field) => field?.toLowerCase().includes(term))
      )
  );
}
