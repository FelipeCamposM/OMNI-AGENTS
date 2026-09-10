import type { SplitNode, WorkspaceAction } from "../../types/workspace";
import { readDraggedPane, readDraggedTab } from "./tabDrag";

interface TabDropOverlayProps {
  targetPaneId: string;
  dispatch: React.Dispatch<WorkspaceAction>;
  onFinished: () => void;
}

export function TabDropOverlay({ targetPaneId, dispatch, onFinished }: TabDropOverlayProps) {
  function drop(
    event: React.DragEvent<HTMLButtonElement>,
    direction?: SplitNode["direction"],
    position: "before" | "after" = "after"
  ) {
    event.preventDefault();
    event.stopPropagation();
    // Pane inteira arrastada pelo cabeçalho tem prioridade sobre tab — os dois nunca vêm juntos
    // no mesmo gesto (MIME types diferentes, ver tabDrag.ts).
    const draggedPane = readDraggedPane(event.dataTransfer);
    const draggedTab = draggedPane ? null : readDraggedTab(event.dataTransfer);
    onFinished();
    if (draggedPane) {
      dispatch(
        direction
          ? { type: "MOVE_PANE", sourcePaneId: draggedPane.paneId, targetPaneId, direction, position }
          : { type: "SWAP_PANE", sourcePaneId: draggedPane.paneId, targetPaneId }
      );
      return;
    }
    if (!draggedTab) return;
    dispatch(
      direction
        ? {
            type: "SPLIT_WITH_TAB",
            sourcePaneId: draggedTab.paneId,
            targetPaneId,
            tabId: draggedTab.tabId,
            direction,
            position,
          }
        : {
            type: "MOVE_TAB",
            sourcePaneId: draggedTab.paneId,
            targetPaneId,
            tabId: draggedTab.tabId,
          }
    );
  }

  const base = "absolute z-20 border-2 border-accent bg-accent/20 text-text-primary text-[10px] uppercase focus:outline-none";

  return (
    <div className="absolute inset-0 z-20 pointer-events-none" aria-label="Destinos da tab">
      <button data-tab-drop-pane={targetPaneId} data-tab-drop-direction="horizontal" data-tab-drop-position="before" className={`${base} pointer-events-auto hover:bg-accent/40 left-0 top-1/4 bottom-1/4 w-1/4`} onDragOver={allow} onDrop={(event) => drop(event, "horizontal", "before")}>Esquerda</button>
      <button data-tab-drop-pane={targetPaneId} data-tab-drop-direction="horizontal" data-tab-drop-position="after" className={`${base} pointer-events-auto hover:bg-accent/40 right-0 top-1/4 bottom-1/4 w-1/4`} onDragOver={allow} onDrop={(event) => drop(event, "horizontal", "after")}>Direita</button>
      <button data-tab-drop-pane={targetPaneId} data-tab-drop-direction="vertical" data-tab-drop-position="before" className={`${base} pointer-events-auto hover:bg-accent/40 top-0 left-1/4 right-1/4 h-1/4`} onDragOver={allow} onDrop={(event) => drop(event, "vertical", "before")}>Acima</button>
      <button data-tab-drop-pane={targetPaneId} data-tab-drop-direction="vertical" data-tab-drop-position="after" className={`${base} pointer-events-auto hover:bg-accent/40 bottom-0 left-1/4 right-1/4 h-1/4`} onDragOver={allow} onDrop={(event) => drop(event, "vertical", "after")}>Abaixo</button>
      <button data-tab-drop-pane={targetPaneId} className={`${base} pointer-events-auto hover:bg-accent/40 inset-1/4`} onDragOver={allow} onDrop={(event) => drop(event)}>Mover aqui</button>
    </div>
  );
}

function allow(event: React.DragEvent<HTMLButtonElement>) {
  event.preventDefault();
  event.dataTransfer.dropEffect = "move";
}
