import { useEffect, useState } from "react";
import { Button } from "../../components/ui";
import { KANBAN_STATUS_LABEL, KANBAN_STATUSES, type KanbanAction, type KanbanState, type KanbanStatus, type KanbanTask } from "../../types/kanban";
import { listAgentClis, type AgentCliId, type AgentCliStatus } from "../terminal/terminalService";
import { KANBAN_CARD_DRAG_TYPE, readDraggedCard } from "./kanbanDrag";

interface KanbanBoardProps {
  projectId: string;
  kanban: KanbanState;
  dispatch: React.Dispatch<KanbanAction>;
}

export function KanbanBoard({ projectId, kanban, dispatch }: KanbanBoardProps) {
  const [agents, setAgents] = useState<AgentCliStatus[]>([]);
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  useEffect(() => {
    void listAgentClis().then(setAgents);
  }, []);

  const tasks = kanban.tasks.filter((task) => task.projectId === projectId);
  const agentId = kanban.agentByProject[projectId] ?? "";
  const pausedUntil = kanban.pausedUntil ? new Date(kanban.pausedUntil) : null;
  const pausedActive = pausedUntil ? pausedUntil.getTime() > Date.now() : false;

  function drop(event: React.DragEvent, status: KanbanStatus) {
    event.preventDefault();
    const dragged = readDraggedCard(event.dataTransfer);
    if (dragged) dispatch({ type: "MOVE_TASK", id: dragged.taskId, status });
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 flex-wrap items-center gap-3 border-b-2 border-border-subtle bg-bg-elevated px-4 py-2.5">
        <Button
          size="sm"
          variant={kanban.dispatcherEnabled ? "primary" : "glass"}
          onClick={() => dispatch({ type: "SET_DISPATCHER_ENABLED", enabled: !kanban.dispatcherEnabled })}
          title="Ligado: tasks em 'Pronta' são enviadas pro agente sozinhas, sem confirmar cada uma. Não afeta abrir agente manualmente — é um modo a mais."
        >
          {kanban.dispatcherEnabled ? "⏸ Dispatcher automático: ligado" : "▶ Dispatcher automático: desligado"}
        </Button>

        <label className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-text-muted">
          Agente
          <select
            value={agentId}
            onChange={(event) =>
              dispatch({ type: "SET_AGENT_FOR_PROJECT", projectId, agentId: event.target.value as AgentCliId })
            }
            className="border border-border-subtle bg-bg-surface px-1.5 py-1 text-xs text-text-primary"
          >
            <option value="" disabled>
              Primeiro disponível
            </option>
            {agents.map((agent) => (
              <option key={agent.id} value={agent.id} disabled={!agent.available}>
                {agent.label}
                {!agent.available ? " (não encontrado)" : ""}
              </option>
            ))}
          </select>
        </label>

        {pausedActive && pausedUntil && (
          <span className="text-xs text-danger" title="3 falhas seguidas em 5 minutos — circuit-breaker">
            ⏸ Pausado por falhas até {pausedUntil.toLocaleTimeString()}
          </span>
        )}

        <Button size="sm" variant="glass" className="ml-auto" onClick={() => setCreating(true)}>
          + Nova task
        </Button>
      </div>

      {creating && (
        <div className="shrink-0 border-b-2 border-border-subtle p-3">
          <TaskForm
            onCancel={() => setCreating(false)}
            onSave={(title, description, loopTotal) => {
              dispatch({ type: "CREATE_TASK", projectId, title, description, loopTotal });
              setCreating(false);
            }}
          />
        </div>
      )}

      <div className="grid min-h-0 flex-1 grid-cols-5 gap-2 overflow-auto p-3">
        {KANBAN_STATUSES.map((status) => {
          const columnTasks = tasks.filter((task) => task.status === status).sort((a, b) => a.position - b.position);
          return (
            <div
              key={status}
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => drop(event, status)}
              className="flex min-h-0 flex-col border-2 border-border-subtle bg-bg-surface/60"
            >
              <div className="shrink-0 border-b border-border-subtle px-2 py-1.5 text-[10px] uppercase tracking-wider text-text-muted">
                {KANBAN_STATUS_LABEL[status]} ({columnTasks.length})
              </div>
              <div className="flex-1 space-y-1.5 overflow-auto p-1.5">
                {columnTasks.map((task) =>
                  editingId === task.id ? (
                    <TaskForm
                      key={task.id}
                      initial={task}
                      onCancel={() => setEditingId(null)}
                      onSave={(title, description, loopTotal) => {
                        dispatch({ type: "UPDATE_TASK", id: task.id, title, description, loopTotal });
                        setEditingId(null);
                      }}
                    />
                  ) : (
                    <TaskCard
                      key={task.id}
                      task={task}
                      onEdit={() => setEditingId(task.id)}
                      onRemove={() => dispatch({ type: "REMOVE_TASK", id: task.id })}
                    />
                  )
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function TaskCard({ task, onEdit, onRemove }: { task: KanbanTask; onEdit: () => void; onRemove: () => void }) {
  return (
    <div
      draggable
      onDragStart={(event) => {
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData(KANBAN_CARD_DRAG_TYPE, JSON.stringify({ taskId: task.id }));
      }}
      className="group border border-border-subtle bg-bg-elevated p-2 text-xs"
      title={task.resultNote ?? undefined}
    >
      <div className="flex items-start justify-between gap-1">
        <p className="min-w-0 flex-1 truncate font-medium text-text-primary">{task.title}</p>
        <div className="flex shrink-0 gap-1.5 opacity-0 group-hover:opacity-100">
          <button type="button" aria-label="Editar task" onClick={onEdit} className="text-text-muted hover:text-accent">
            ✎
          </button>
          <button type="button" aria-label="Excluir task" onClick={onRemove} className="text-text-muted hover:text-danger">
            ×
          </button>
        </div>
      </div>
      {task.description && <p className="mt-1 line-clamp-2 text-text-muted">{task.description}</p>}
      {task.loopTotal !== null && (
        <p className="mt-1 text-[10px] text-accent">
          🔁 {task.loopTotal - (task.loopRemaining ?? 0) + 1}/{task.loopTotal}
        </p>
      )}
    </div>
  );
}

function TaskForm({
  initial,
  onSave,
  onCancel,
}: {
  initial?: KanbanTask;
  onSave: (title: string, description: string, loopTotal?: number) => void;
  onCancel: () => void;
}) {
  const [title, setTitle] = useState(initial?.title ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [loop, setLoop] = useState(initial?.loopTotal ? String(initial.loopTotal) : "");

  return (
    <div className="space-y-1.5 border border-accent bg-bg-elevated p-2">
      <input
        autoFocus
        value={title}
        onChange={(event) => setTitle(event.target.value)}
        placeholder="Título da task"
        className="w-full border border-border-subtle bg-bg-surface px-2 py-1 text-xs text-text-primary outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
      />
      <textarea
        value={description}
        onChange={(event) => setDescription(event.target.value)}
        placeholder="Descrição — vira o prompt mandado pro agente"
        rows={3}
        className="w-full resize-none border border-border-subtle bg-bg-surface px-2 py-1 text-xs text-text-primary outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
      />
      <div className="flex items-center gap-2">
        <label className="flex items-center gap-1 text-[10px] text-text-muted">
          Repetir
          <input
            type="number"
            min={2}
            max={25}
            value={loop}
            onChange={(event) => setLoop(event.target.value)}
            placeholder="—"
            className="w-14 border border-border-subtle bg-bg-surface px-1 py-0.5 text-xs text-text-primary outline-none"
          />
          x
        </label>
        <div className="ml-auto flex gap-1.5">
          <Button size="sm" variant="ghost" onClick={onCancel}>
            Cancelar
          </Button>
          <Button
            size="sm"
            variant="primary"
            disabled={!title.trim()}
            onClick={() => onSave(title.trim(), description, loop ? Number(loop) : undefined)}
          >
            Salvar
          </Button>
        </div>
      </div>
    </div>
  );
}
