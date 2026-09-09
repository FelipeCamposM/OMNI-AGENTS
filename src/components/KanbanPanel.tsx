import { KANBAN_STATUS_LABEL, KANBAN_STATUSES, type KanbanState } from "../types/kanban";

interface KanbanPanelProps {
  projectId: string | null;
  kanban: KanbanState;
  onOpenBoard: () => void;
}

/** Resumo compacto na Sidebar — o board de verdade é uma aba (`KanbanBoard.tsx`), mesmo padrão
 * simples de `GitPanel.tsx` (contagem + botão, sem duplicar a UI cheia aqui). */
export function KanbanPanel({ projectId, kanban, onOpenBoard }: KanbanPanelProps) {
  if (!projectId) return null;
  const tasks = kanban.tasks.filter((task) => task.projectId === projectId);

  return (
    <div className="space-y-1.5 px-3 pb-2">
      <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[10px] text-text-muted">
        {KANBAN_STATUSES.map((status) => (
          <span key={status}>
            {KANBAN_STATUS_LABEL[status]}: {tasks.filter((task) => task.status === status).length}
          </span>
        ))}
      </div>
      <button
        type="button"
        onClick={onOpenBoard}
        className="w-full border border-border-subtle bg-bg-elevated py-1 text-xs text-text-primary hover:bg-overlay/[0.07]"
      >
        Abrir board
      </button>
    </div>
  );
}
