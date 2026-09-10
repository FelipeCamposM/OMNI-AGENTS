import type { Dispatch, PointerEvent } from "react";
import type { WorkspaceAction } from "../../types/workspace";
import type { TabDragData } from "./tabDrag";

export const FILE_TAB_DRAG_EVENT = "omni-file-tab-drag";

// Pointer events work alongside Tauri's native Explorer file drop handler on Windows.
export function startFileTabDrag(
  event: PointerEvent,
  tab: TabDragData,
  dispatch: Dispatch<WorkspaceAction>,
) {
  if (event.button !== 0) return;
  const { clientX, clientY, pointerId } = event;
  let dragging = false;
  const announce = (active: boolean) => window.dispatchEvent(new CustomEvent(FILE_TAB_DRAG_EVENT, { detail: active }));
  function move(next: globalThis.PointerEvent) {
    if (next.pointerId !== pointerId) return;
    if (!dragging && Math.hypot(next.clientX - clientX, next.clientY - clientY) >= 6) {
      dragging = true;
      announce(true);
    }
    if (dragging) next.preventDefault();
  }
  function cleanup() {
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", finish);
    window.removeEventListener("pointercancel", cancel);
    window.removeEventListener("keydown", keydown);
    window.removeEventListener("blur", cancel);
    announce(false);
  }
  function cancel() { cleanup(); }
  function keydown(next: KeyboardEvent) { if (next.key === "Escape") cancel(); }
  function finish(next: globalThis.PointerEvent) {
    if (next.pointerId !== pointerId) return;
    const target = dragging
      ? document.elementFromPoint(next.clientX, next.clientY)?.closest<HTMLElement>("[data-tab-drop-pane]")
      : null;
    cleanup();
    if (!target) return;
    const targetPaneId = target.dataset.tabDropPane!;
    const direction = target.dataset.tabDropDirection;
    if (direction === "horizontal" || direction === "vertical") {
      dispatch({ type: "SPLIT_WITH_TAB", sourcePaneId: tab.paneId, tabId: tab.tabId, targetPaneId,
        direction, position: target.dataset.tabDropPosition === "before" ? "before" : "after" });
    } else {
      dispatch({ type: "MOVE_TAB", sourcePaneId: tab.paneId, tabId: tab.tabId, targetPaneId });
    }
  }
  window.addEventListener("pointermove", move, { passive: false });
  window.addEventListener("pointerup", finish);
  window.addEventListener("pointercancel", cancel);
  window.addEventListener("keydown", keydown);
  window.addEventListener("blur", cancel);
}
