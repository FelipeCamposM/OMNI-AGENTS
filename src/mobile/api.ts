export interface Conversation {
  id: string; title: string; provider: string | null; profile_id: string | null; state: string | null;
  capabilities: { prompt: boolean; approve: boolean; revision: string; approval_text: string | null; reason: string | null } | null;
}
export interface Timeline {
  timeline: { messages: { id: string; role: string; text: string; provider: string }[]; next_cursor: number | null; unavailable_segments: number[] };
  actions: { id: string; state: string; error: string | null }[];
}
export class ApiError extends Error {
  constructor(message: string, public readonly status: number) { super(message); }
}
export async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, { ...init, signal: init?.signal ?? AbortSignal.timeout(15_000) });
  const result = await response.json();
  if (!response.ok) throw new ApiError(result.error ?? `Falha HTTP ${response.status}`, response.status);
  return result as T;
}
// HTTP on a Tailscale IP is not a secure context: crypto.randomUUID may be unavailable.
export function actionKey(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), byte => byte.toString(16).padStart(2,"0")).join("");
}
