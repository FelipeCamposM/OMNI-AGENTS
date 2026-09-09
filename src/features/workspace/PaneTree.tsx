import { useRef } from "react";
import type { LayoutNode, WorkspaceAction } from "../../types/workspace";
import type { KanbanAction, KanbanState } from "../../types/kanban";
import { PaneView } from "./PaneView";

interface PaneTreeProps {
  node: LayoutNode;
  activePaneId: string;
  maximizedPaneId: string | null;
  paneCount: number;
  projectId: string;
  projectPath: string;
  fileSaveMode: "auto" | "manual";
  kanban: KanbanState;
  kanbanDispatch: React.Dispatch<KanbanAction>;
  dispatch: React.Dispatch<WorkspaceAction>;
}

export function PaneTree(props: PaneTreeProps) {
  const { node, activePaneId, maximizedPaneId, paneCount, projectId, projectPath, fileSaveMode, kanban, kanbanDispatch, dispatch } =
    props;
  const containerRef = useRef<HTMLDivElement>(null);

  if (maximizedPaneId && node.type === "split") {
    const maximized = findNode(node, maximizedPaneId);
    if (maximized) return <PaneTree {...props} node={maximized} />;
  }

  if (node.type === "pane") {
    return (
      <PaneView
        pane={node}
        active={node.id === activePaneId}
        onlyPane={paneCount === 1}
        maximized={node.id === maximizedPaneId}
        projectId={projectId}
        projectPath={projectPath}
        fileSaveMode={fileSaveMode}
        kanban={kanban}
        kanbanDispatch={kanbanDispatch}
        dispatch={dispatch}
      />
    );
  }

  const row = node.direction === "horizontal";

  function startResize(event: React.PointerEvent<HTMLButtonElement>) {
    event.preventDefault();
    const container = containerRef.current;
    if (!container) return;
    const bounds = container.getBoundingClientRect();

    function move(pointer: PointerEvent) {
      const ratio = row
        ? (pointer.clientX - bounds.left) / bounds.width
        : (pointer.clientY - bounds.top) / bounds.height;
      dispatch({ type: "RESIZE_SPLIT", splitId: node.id, ratio });
    }

    function stop() {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", stop);
    }

    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop, { once: true });
  }

  return (
    <div
      ref={containerRef}
      className={`flex flex-1 min-w-0 min-h-0 ${row ? "flex-row" : "flex-col"}`}
    >
      <div className="flex min-w-0 min-h-0" style={{ flexBasis: `${node.ratio * 100}%` }}>
        <PaneTree {...props} node={node.first} />
      </div>
      <button
        type="button"
        aria-label={row ? "Redimensionar colunas" : "Redimensionar linhas"}
        onPointerDown={startResize}
        className={[
          "shrink-0 bg-border-subtle hover:bg-accent focus-visible:bg-accent focus-visible:outline-none touch-none",
          row ? "w-1 cursor-col-resize" : "h-1 cursor-row-resize",
        ].join(" ")}
      />
      <div className="flex flex-1 min-w-0 min-h-0">
        <PaneTree {...props} node={node.second} />
      </div>
    </div>
  );
}

function findNode(node: LayoutNode, paneId: string): LayoutNode | null {
  if (node.type === "pane") return node.id === paneId ? node : null;
  return findNode(node.first, paneId) ?? findNode(node.second, paneId);
}
