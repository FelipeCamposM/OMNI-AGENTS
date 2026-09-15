export interface TabDragData {
  paneId: string;
  tabId: string;
}

/** Arrastar a pane inteira (cabeçalho), não uma tab — HTML5 DnD com MIME próprio. As tabs
 * arrastam por pointer events (`tabPointerDrag.ts`). */
export const PANE_DRAG_TYPE = "application/x-omni-workspace-pane";

export interface PaneDragData {
  paneId: string;
}

export function readDraggedPane(transfer: DataTransfer): PaneDragData | null {
  try {
    const raw = transfer.getData(PANE_DRAG_TYPE);
    if (!raw) return null;
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== "object") return null;
    const candidate = value as Partial<PaneDragData>;
    return typeof candidate.paneId === "string" ? { paneId: candidate.paneId } : null;
  } catch {
    return null;
  }
}
