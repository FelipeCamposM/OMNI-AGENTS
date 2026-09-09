export const KANBAN_CARD_DRAG_TYPE = "application/x-omni-kanban-card";

export interface KanbanCardDragData {
  taskId: string;
}

export function readDraggedCard(transfer: DataTransfer): KanbanCardDragData | null {
  try {
    const raw = transfer.getData(KANBAN_CARD_DRAG_TYPE);
    if (!raw) return null;
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== "object") return null;
    const candidate = value as Partial<KanbanCardDragData>;
    return typeof candidate.taskId === "string" ? { taskId: candidate.taskId } : null;
  } catch {
    return null;
  }
}
