import { createContext, useContext } from "react";
import type { TerminalSession } from "./terminalService";

/**
 * Sessões vivas do engine, por id.
 *
 * Existe como contexto porque os consumidores estão fundos na árvore — a barra de abas
 * (`WorkspaceView` → `PaneTree` → `PaneView` → `WorkspaceTabBar`) e o rodapé — e nenhum nível do
 * meio tem uso para a lista. Cobre as abas que nascem fora do seletor de CLI (anexar do menu
 * lateral, duplicar, focar por notificação), onde o provider nunca passa pelo `BIND_TAB_RESOURCE`.
 */
export const SessionProvidersContext = createContext<Record<string, TerminalSession>>({});

export function useSession(sessionId: string | null | undefined) {
  const byId = useContext(SessionProvidersContext);
  return sessionId ? byId[sessionId] ?? null : null;
}

export function useSessionProvider(sessionId: string | undefined) {
  return useSession(sessionId)?.provider ?? undefined;
}
