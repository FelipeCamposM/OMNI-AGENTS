import { Button } from "../../components/ui";
import type { PaneNode, WorkspaceAction } from "../../types/workspace";
import { TAB_DRAG_TYPE, readDraggedTab } from "./tabDrag";

interface WorkspaceTabBarProps {
  pane: PaneNode;
  dispatch: React.Dispatch<WorkspaceAction>;
  onCloseTab: (tab: PaneNode["tabs"][number]) => void;
  dirtyTabIds?: Set<string>;
}

export function WorkspaceTabBar({ pane, dispatch, onCloseTab, dirtyTabIds }: WorkspaceTabBarProps) {
  function moveHere(event: React.DragEvent<HTMLDivElement>) {
    event.preventDefault();
    const dragged = readDraggedTab(event.dataTransfer);
    if (!dragged) return;
    dispatch({
      type: "MOVE_TAB",
      sourcePaneId: dragged.paneId,
      targetPaneId: pane.id,
      tabId: dragged.tabId,
    });
  }

  return (
    <div
      className="flex-1 min-w-0 flex overflow-x-auto"
      role="tablist"
      aria-label="Tabs do painel"
      onDragOver={(event) => event.preventDefault()}
      onDrop={moveHere}
    >
      {pane.tabs.map((item) => (
        <div
          key={item.id}
          draggable
          onDragStart={(event) => {
            const payload = JSON.stringify({ paneId: pane.id, tabId: item.id });
            event.dataTransfer.effectAllowed = "move";
            event.dataTransfer.setData(TAB_DRAG_TYPE, payload);
            event.dataTransfer.setData("text/plain", payload);
          }}
          className={[
            "group flex shrink-0 items-stretch border-r-2 border-border-subtle max-w-64",
            item.id === pane.activeTabId ? "bg-bg-surface" : "hover:bg-overlay/[0.04]",
          ].join(" ")}
        >
          <button
            type="button"
            role="tab"
            aria-selected={item.id === pane.activeTabId}
            onClick={() => dispatch({ type: "SELECT_TAB", paneId: pane.id, tabId: item.id })}
            className={[
              "min-w-0 px-3 text-[11px] truncate focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent",
              item.id === pane.activeTabId
                ? "text-text-primary"
                : "text-text-muted hover:text-text-secondary",
            ].join(" ")}
          >
            <span className="uppercase text-[9px] mr-2 text-accent">{item.kind}</span>
            {item.title}
            {dirtyTabIds?.has(item.id) && (
              <span className="ml-1.5 text-accent" title="Alterações não salvas" aria-label="Alterações não salvas">•</span>
            )}
          </button>
          <button
            type="button"
            aria-label={`Fechar tab ${item.title}`}
            title="Fechar tab"
            onClick={() => onCloseTab(item)}
            className="w-7 text-text-muted hover:text-danger focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
          >
            ×
          </button>
        </div>
      ))}
      <Button
        variant="ghost"
        size="sm"
        className="!px-2 !py-1 shrink-0"
        aria-label="Nova tab"
        title="Nova tab"
        onClick={() => dispatch({ type: "CREATE_TAB", paneId: pane.id })}
      >
        +
      </Button>
    </div>
  );
}
