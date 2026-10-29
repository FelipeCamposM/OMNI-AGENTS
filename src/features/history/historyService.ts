import { invoke } from "@tauri-apps/api/core";
import { engineApi } from "../terminal/terminalService";

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
/**
 * Retomar noutra conta: o PC copia o transcript para a pasta da conta escolhida, porque o
 * `--resume` só acha conversas da própria conta. Mesma conta não faz nada.
 */
export async function levarParaConta(entry: HistoryEntry, destino: string): Promise<void> {
  if (!destino || destino === entry.profile_id) return;
  const resposta = await engineApi("POST", "/historico/levar", JSON.stringify({
    provider: entry.provider, profile_id: entry.profile_id, session_id: entry.session_id, destino,
  }));
  if (resposta.status >= 400) {
    let motivo = `Falha ao levar a conversa para a outra conta (${resposta.status})`;
    try { motivo = (JSON.parse(resposta.body) as { error?: string }).error ?? motivo; } catch { /* corpo não-JSON */ }
    throw new Error(motivo);
  }
}

export function resumeCommand(cliCommand: string, entry: HistoryEntry): string {
  return entry.provider === "claude"
    ? `${cliCommand} --resume ${entry.session_id}`
    : `${cliCommand} resume ${entry.session_id}`;
}

// Caminhos do Windows chegam com caixa, barra e host do WSL diferentes conforme quem gravou. A
// regra mora em `src/lib/paths.ts` — aqui era a terceira cópia, e a única que ignorava `wsl$`.
import { normalizePath, samePath } from "../../lib/paths";

export { samePath };

/**
 * Pasta do projeto de uma conversa. Ferramentas que rodam o CLI em subpastas descartáveis
 * (`DOMUS-ADPILOT/.worker-data/videos/<uuid>`, `.claude/worktrees/x`) viravam um "projeto" de
 * nome aleatório cada: vale o projeto do OMNI mais fundo que contém a pasta e, fora deles, o que
 * vem antes da primeira pasta oculta.
 */
export function pastaDoProjeto(cwd: string, projetos: readonly string[]): string {
  const alvo = normalizePath(cwd);
  const dono = projetos
    .filter((projeto) => { const base = normalizePath(projeto); return alvo === base || alvo.startsWith(`${base}/`); })
    .sort((a, b) => b.length - a.length)[0];
  if (dono) return dono;
  const oculta = /[\\/]\.[^\\/]/.exec(cwd);
  return oculta ? cwd.slice(0, oculta.index) : cwd;
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
