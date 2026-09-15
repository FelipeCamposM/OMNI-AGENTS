export interface Conversation {
  id: string; title: string; project_id: string; provider: string | null; profile_id: string | null; state: string | null;
  capabilities: { prompt: boolean; approve: boolean; revision: string; approval_text: string | null; reason: string | null } | null;
}
export interface Projects {
  /** 0 = o desktop nunca publicou; a lista veio só das conversas já registradas. */
  published_at_ms: number;
  projects: { id: string; name: string; path: string }[];
  agents: { id: string; label: string; command: string; resume: string | null }[];
  profiles: { id: string; provider: string; name: string }[];
}
export interface Timeline {
  timeline: { messages: { id: string; role: string; text: string; provider: string }[]; next_cursor: number | null; unavailable_segments: number[] };
  actions: { id: string; state: string; error: string | null }[];
}
export class ApiError extends Error {
  constructor(message: string, public readonly status: number) { super(message); }
}
const TOKEN_KEY = "omni-token";

/**
 * Token de dispositivo. Chega pelo **fragmento** da URL (`#t=…`), que o QR do desktop embute: o
 * fragmento não é enviado ao servidor nem entra em log ou `Referer`, ao contrário de uma query.
 *
 * Lido dentro do `request()`, não no topo do módulo, para o teste conseguir trocar `location.hash`
 * sem precisar reimportar o módulo.
 */
function token(): string {
  try {
    const doFragmento = new URLSearchParams(location.hash.slice(1)).get("t");
    if (doFragmento) {
      localStorage.setItem(TOKEN_KEY, doFragmento);
      history.replaceState(null, "", location.pathname);
    }
    return localStorage.getItem(TOKEN_KEY) ?? "";
  } catch {
    // Navegador com armazenamento bloqueado: segue sem token e o servidor responde 401.
    return "";
  }
}

export function esquecerToken() {
  try { localStorage.removeItem(TOKEN_KEY); } catch { /* nada a fazer */ }
}

/** Grava o token recebido no pareamento pelo Authy — o caminho do app da tela inicial do iPhone,
 *  que não enxerga o token que o QR gravou no Safari. */
export function salvarToken(valor: string) {
  try { localStorage.setItem(TOKEN_KEY, valor); } catch { /* sem armazenamento: vale só nesta aba */ }
}

export async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: { ...init?.headers, "X-Omni-Token": token() },
    signal: init?.signal ?? AbortSignal.timeout(15_000),
  });
  const result = await response.json();
  if (!response.ok) {
    // Token inválido ou rotacionado no PC: descarta, senão o celular insiste com o segredo velho.
    if (response.status === 401) esquecerToken();
    throw new ApiError(result.error ?? `Falha HTTP ${response.status}`, response.status);
  }
  return result as T;
}
// HTTP on a Tailscale IP is not a secure context: crypto.randomUUID may be unavailable.
export function actionKey(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), byte => byte.toString(16).padStart(2,"0")).join("");
}
