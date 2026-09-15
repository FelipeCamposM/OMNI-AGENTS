import type { Dispatch, PointerEvent } from "react";
import type { WorkspaceAction } from "../../types/workspace";
import type { TabDragData } from "./tabDrag";

export const TAB_DRAG_EVENT = "omni-tab-drag";

export type DropZone = "center" | "left" | "right" | "top" | "bottom";
export interface TabDropTarget { paneId: string; zone: DropZone }
/** `null` = nenhum arraste; `target: null` = arrastando fora de qualquer painel. */
export type TabDragState = { tab: TabDragData; target: TabDropTarget | null } | null;

/** Faixa de cada borda, em fração do painel, que vira divisão em vez de "mover para cá". */
const EDGE = 0.3;

/** Sobre as abas/cabeçalho é sempre "mover para cá"; senão a borda mais próxima dentro da faixa. */
export function dropZone(rect: Pick<DOMRect, "left" | "top" | "width" | "height">, x: number, y: number, overHeader: boolean): DropZone {
  if (overHeader || rect.width <= 0 || rect.height <= 0) return "center";
  const fx = (x - rect.left) / rect.width;
  const fy = (y - rect.top) / rect.height;
  const edges: [DropZone, number][] = [["left", fx], ["right", 1 - fx], ["top", fy], ["bottom", 1 - fy]];
  const [zone, distance] = edges.reduce((best, edge) => (edge[1] < best[1] ? edge : best));
  return distance < EDGE ? zone : "center";
}

function targetAt(x: number, y: number): TabDropTarget | null {
  const element = document.elementFromPoint(x, y);
  const pane = element?.closest<HTMLElement>("[data-drop-pane]");
  if (!pane) return null;
  const overHeader = Boolean(element!.closest("header"));
  return { paneId: pane.dataset.dropPane!, zone: dropZone(pane.getBoundingClientRect(), x, y, overHeader) };
}

// Pointer events, não HTML5 DnD: com o drop de arquivos do Explorer ligado no Tauri (Windows),
// o webview nunca entrega `dragstart`/`drop` — abas de agente e terminal simplesmente não arrastavam.
export function startTabDrag(
  event: PointerEvent,
  tab: TabDragData & { title: string },
  dispatch: Dispatch<WorkspaceAction>,
) {
  if (event.button !== 0) return;
  // Cancel the browser's default drag before a draggable ancestor can take over.
  event.preventDefault();
  const source = event.currentTarget as HTMLElement;
  const { clientX, clientY, pointerId } = event;
  let dragging = false;
  let target: TabDropTarget | null = null;
  let announced = false;
  let ghost: HTMLDivElement | null = null;
  const announce = (state: TabDragState) => window.dispatchEvent(new CustomEvent(TAB_DRAG_EVENT, { detail: state }));
  function move(next: globalThis.PointerEvent) {
    if (next.pointerId !== pointerId) return;
    if (!dragging && Math.hypot(next.clientX - clientX, next.clientY - clientY) >= 6) {
      dragging = true;
      // Captura só depois do limiar: capturado desde o pointerdown, o click de um toque simples vai
      // para este wrapper e não para o botão da aba — trocar de aba parava de funcionar.
      source.setPointerCapture(pointerId);
      ghost = document.createElement("div");
      ghost.textContent = tab.title;
      ghost.setAttribute("aria-hidden", "true");
      ghost.className = "fixed z-50 pointer-events-none max-w-48 truncate border-2 border-accent bg-bg-elevated px-2 py-1 text-[11px] text-text-primary shadow-lg";
      document.body.appendChild(ghost);
    }
    if (!dragging) return;
    next.preventDefault();
    ghost!.style.left = `${next.clientX + 12}px`;
    ghost!.style.top = `${next.clientY + 12}px`;
    const found = targetAt(next.clientX, next.clientY);
    // Só avisa quando o destino muda: cada aviso re-renderiza todos os painéis.
    if (!announced || found?.paneId !== target?.paneId || found?.zone !== target?.zone) {
      announced = true;
      target = found;
      announce({ tab, target });
    }
  }
  function cleanup() {
    if (source.hasPointerCapture(pointerId)) source.releasePointerCapture(pointerId);
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", finish);
    window.removeEventListener("pointercancel", cleanup);
    window.removeEventListener("keydown", keydown);
    window.removeEventListener("blur", cleanup);
    ghost?.remove();
    if (dragging) announce(null);
  }
  function keydown(next: KeyboardEvent) { if (next.key === "Escape") cleanup(); }
  function finish(next: globalThis.PointerEvent) {
    if (next.pointerId !== pointerId) return;
    const drop = dragging ? targetAt(next.clientX, next.clientY) : null;
    cleanup();
    if (!drop) return;
    const { paneId: sourcePaneId, tabId } = tab;
    if (drop.zone === "center") {
      dispatch({ type: "MOVE_TAB", sourcePaneId, tabId, targetPaneId: drop.paneId });
      return;
    }
    dispatch({ type: "SPLIT_WITH_TAB", sourcePaneId, tabId, targetPaneId: drop.paneId,
      direction: drop.zone === "left" || drop.zone === "right" ? "horizontal" : "vertical",
      position: drop.zone === "left" || drop.zone === "top" ? "before" : "after" });
  }
  window.addEventListener("pointermove", move, { passive: false });
  window.addEventListener("pointerup", finish);
  window.addEventListener("pointercancel", cleanup);
  window.addEventListener("keydown", keydown);
  window.addEventListener("blur", cleanup);
}
