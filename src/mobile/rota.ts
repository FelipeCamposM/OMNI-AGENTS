import { useCallback, useEffect, useState } from "react";

export type Rota =
  | { tela: "inicio" }
  | { tela: "projeto"; projeto: string }
  | { tela: "conversa"; conversa: string }
  | { tela: "ajustes" }
  | { tela: "estudos"; secao: "roadmaps" | "mentor" | "pomodoro" | "analises"; roadmap?: string };

/** `#/p/<projeto>` ou `#/c/<conversa>`. Qualquer outra coisa (inclusive o `#t=` do QR) é o início. */
export function lerRota(hash = location.hash): Rota {
  if (hash === "#/ajustes") return { tela: "ajustes" };
  // Estudos: `#/estudos`, `#/estudos/mentor`, `#/estudos/pomodoro`, `#/estudos/analises`, `#/estudos/r/<roadmap>`.
  if (hash === "#/estudos" || hash === "#/estudos/roadmaps") return { tela: "estudos", secao: "roadmaps" };
  if (hash === "#/estudos/mentor") return { tela: "estudos", secao: "mentor" };
  if (hash === "#/estudos/pomodoro") return { tela: "estudos", secao: "pomodoro" };
  if (hash === "#/estudos/analises") return { tela: "estudos", secao: "analises" };
  const [, roadmap] = hash.match(/^#\/estudos\/r\/([a-z0-9-]{1,64})$/) ?? [];
  if (roadmap) return { tela: "estudos", secao: "roadmaps", roadmap };
  const [, tipo, id] = hash.match(/^#\/([pc])\/([^/?#]+)$/) ?? [];
  if (!id) return { tela: "inicio" };
  let valor: string;
  try { valor = decodeURIComponent(id); } catch { return { tela: "inicio" }; }
  return tipo === "p" ? { tela: "projeto", projeto: valor } : { tela: "conversa", conversa: valor };
}

export function urlDaRota(rota: Rota): string {
  const base = location.pathname + location.search;
  if (rota.tela === "projeto") return `${base}#/p/${encodeURIComponent(rota.projeto)}`;
  if (rota.tela === "conversa") return `${base}#/c/${encodeURIComponent(rota.conversa)}`;
  if (rota.tela === "ajustes") return `${base}#/ajustes`;
  if (rota.tela === "estudos") return rota.roadmap ? `${base}#/estudos/r/${rota.roadmap}` : `${base}#/estudos${rota.secao === "roadmaps" ? "" : `/${rota.secao}`}`;
  return base;
}

/**
 * Onde o usuário está, guardado no endereço. Atualizar a página volta para a mesma conversa — antes
 * a tela vivia só no estado do React e todo refresh caía no início — e o gesto de voltar do celular
 * anda pelas telas do app como em qualquer outro.
 */
export function useRota() {
  const [rota, setRota] = useState<Rota>(() => lerRota());

  useEffect(() => {
    const sincronizar = () => setRota(lerRota());
    window.addEventListener("popstate", sincronizar);
    window.addEventListener("hashchange", sincronizar);
    return () => {
      window.removeEventListener("popstate", sincronizar);
      window.removeEventListener("hashchange", sincronizar);
    };
  }, []);

  const ir = useCallback((destino: Rota) => {
    history.pushState({ omni: true }, "", urlDaRota(destino));
    setRota(destino);
  }, []);

  /** Volta pela pilha quando a tela anterior é do próprio app; aberto direto num endereço (favorito,
   *  app da tela inicial reaberto), não há para onde voltar — então vai para a tela-pai. */
  const voltar = useCallback((pai: Rota) => {
    if ((history.state as { omni?: boolean } | null)?.omni) { history.back(); return; }
    history.replaceState(null, "", urlDaRota(pai));
    setRota(pai);
  }, []);

  return { rota, ir, voltar };
}
