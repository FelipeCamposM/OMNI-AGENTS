export const TAB_DRAG_TYPE = "application/x-omni-workspace-tab";

export interface TabDragData {
  paneId: string;
  tabId: string;
}

export function readDraggedTab(transfer: DataTransfer): TabDragData | null {
  try {
    const raw = transfer.getData(TAB_DRAG_TYPE) || transfer.getData("text/plain");
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== "object") return null;
    const candidate = value as Partial<TabDragData>;
    return typeof candidate.paneId === "string" && typeof candidate.tabId === "string"
      ? { paneId: candidate.paneId, tabId: candidate.tabId }
      : null;
  } catch {
    return null;
  }
}

/** Arrastar a pane inteira (cabeçalho), não uma tab — MIME próprio, sem fallback pra
 * "text/plain" (esse fallback é o que a tab usa; se a pane também escrevesse lá, um dropzone
 * checando os dois tipos veria os dois "presentes" pro mesmo gesto). */
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
