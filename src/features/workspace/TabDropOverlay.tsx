import type { SplitNode, WorkspaceAction } from "../../types/workspace";
import { readDraggedPane } from "./tabDrag";

interface TabDropOverlayProps {
  targetPaneId: string;
  dispatch: React.Dispatch<WorkspaceAction>;
  onFinished: () => void;
}

/** Destinos do arraste do painel inteiro pelo cabeçalho (HTML5). */
export function TabDropOverlay({ targetPaneId, dispatch, onFinished }: TabDropOverlayProps) {
  function drop(
    event: React.DragEvent<HTMLButtonElement>,
    direction?: SplitNode["direction"],
    position: "before" | "after" = "after"
  ) {
    event.preventDefault();
    event.stopPropagation();
    const draggedPane = readDraggedPane(event.dataTransfer);
    onFinished();
    if (!draggedPane) return;
    dispatch(
      direction
        ? { type: "MOVE_PANE", sourcePaneId: draggedPane.paneId, targetPaneId, direction, position }
        : { type: "SWAP_PANE", sourcePaneId: draggedPane.paneId, targetPaneId }
    );
  }

  const base = "absolute z-20 border-2 border-accent bg-accent/20 text-text-primary text-[10px] uppercase focus:outline-none";

  return (
    <div className="absolute inset-0 z-20 pointer-events-none" aria-label="Destinos do painel">
      <button className={`${base} pointer-events-auto hover:bg-accent/40 left-0 top-1/4 bottom-1/4 w-1/4`} onDragOver={allow} onDrop={(event) => drop(event, "horizontal", "before")}>Esquerda</button>
      <button className={`${base} pointer-events-auto hover:bg-accent/40 right-0 top-1/4 bottom-1/4 w-1/4`} onDragOver={allow} onDrop={(event) => drop(event, "horizontal", "after")}>Direita</button>
      <button className={`${base} pointer-events-auto hover:bg-accent/40 top-0 left-1/4 right-1/4 h-1/4`} onDragOver={allow} onDrop={(event) => drop(event, "vertical", "before")}>Acima</button>
      <button className={`${base} pointer-events-auto hover:bg-accent/40 bottom-0 left-1/4 right-1/4 h-1/4`} onDragOver={allow} onDrop={(event) => drop(event, "vertical", "after")}>Abaixo</button>
      <button className={`${base} pointer-events-auto hover:bg-accent/40 inset-1/4`} onDragOver={allow} onDrop={(event) => drop(event)}>Mover aqui</button>
    </div>
  );
}

function allow(event: React.DragEvent<HTMLButtonElement>) {
  event.preventDefault();
  event.dataTransfer.dropEffect = "move";
}
