import { Button } from "../../components/ui";
import { Component, useCallback, useState } from "react";
import type { ErrorInfo, ReactNode } from "react";
import type { PaneNode, SplitNode, WorkspaceAction } from "../../types/workspace";
import type { KanbanAction, KanbanState } from "../../types/kanban";
import { isImagePath } from "../files/filesService";
import { FilePane } from "../files/FilePane";
import { ImagePane } from "../files/ImagePane";
import { MarkdownPane } from "../files/MarkdownPane";
import { GitDiffPane } from "../git/GitDiffPane";
import { GitGraphPane } from "../git/GitGraphPane";
import { KanbanBoard } from "../kanban/KanbanBoard";
import { TerminalPane } from "../terminal/TerminalPane";
import { closeTerminal } from "../terminal/terminalService";
import { PANE_DRAG_TYPE } from "./tabDrag";
import { TabDropOverlay } from "./TabDropOverlay";
import { WorkspaceTabBar } from "./WorkspaceTabBar";

interface PaneViewProps {
  pane: PaneNode;
  active: boolean;
  onlyPane: boolean;
  maximized: boolean;
  projectId: string;
  projectPath: string;
  fileSaveMode: "auto" | "manual";
  kanban: KanbanState;
  kanbanDispatch: React.Dispatch<KanbanAction>;
  dispatch: React.Dispatch<WorkspaceAction>;
}

export function PaneView({
  pane,
  active,
  onlyPane,
  maximized,
  projectId,
  projectPath,
  fileSaveMode,
  kanban,
  kanbanDispatch,
  dispatch,
}: PaneViewProps) {
  const [dragActive, setDragActive] = useState(false);
  const [dirtyTabIds, setDirtyTabIds] = useState<Set<string>>(new Set());
  const tab = pane.tabs.find((item) => item.id === pane.activeTabId) ?? pane.tabs[0];
  const tabId = tab?.id;

  const handleDirtyChange = useCallback((changedTabId: string, dirty: boolean) => {
    setDirtyTabIds((previous) => {
      if (dirty === previous.has(changedTabId)) return previous;
      const next = new Set(previous);
      if (dirty) next.add(changedTabId);
      else next.delete(changedTabId);
      return next;
    });
  }, []);

  function split(direction: SplitNode["direction"]) {
    dispatch({ type: "SPLIT_PANE", paneId: pane.id, direction });
  }

  function closeTab(item: PaneNode["tabs"][number]) {
    const close = item.resourceId && (item.kind === "agent" || item.kind === "terminal")
      ? closeTerminal(item.resourceId).catch(() => undefined) : Promise.resolve();
    void close.then(() => dispatch({ type: "CLOSE_TAB", paneId: pane.id, tabId: item.id }));
  }

  function closePane() {
    const sessions = pane.tabs.flatMap((item) => item.resourceId && (item.kind === "agent" || item.kind === "terminal") ? [closeTerminal(item.resourceId)] : []);
    void Promise.allSettled(sessions).then(() => dispatch({ type: "CLOSE_PANE", paneId: pane.id }));
  }

  const bindSession = useCallback(
    (sessionId: string, title: string) => {
      if (tabId) dispatch({ type: "BIND_TAB_RESOURCE", paneId: pane.id, tabId, resourceId: sessionId, title });
    },
    [dispatch, pane.id, tabId]
  );

  return (
    <section
      className={[
        "relative flex-1 min-w-0 min-h-0 flex flex-col bg-bg-surface/90 border-2",
        active ? "border-accent" : "border-border-subtle",
      ].join(" ")}
      aria-label={`Painel ${tab?.title ?? pane.id}`}
      onPointerDown={() => dispatch({ type: "FOCUS_PANE", paneId: pane.id })}
      onDragEnter={(event) => {
        event.preventDefault();
        setDragActive(true);
      }}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragActive(false);
      }}
      onDragEnd={() => setDragActive(false)}
    >
      <header
        className="h-10 shrink-0 flex items-stretch border-b-2 border-border-subtle bg-bg-elevated/90"
        draggable
        onDragStart={(event) => {
          event.dataTransfer.effectAllowed = "move";
          event.dataTransfer.setData(PANE_DRAG_TYPE, JSON.stringify({ paneId: pane.id }));
        }}
      >
        <WorkspaceTabBar pane={pane} dispatch={dispatch} onCloseTab={closeTab} dirtyTabIds={dirtyTabIds} />

        <div className="flex items-center gap-1 px-1" aria-label="Ações do painel">
          <PaneAction label="Dividir lado a lado" glyph="▥" onClick={() => split("horizontal")} />
          <PaneAction label="Dividir em cima e embaixo" glyph="▤" onClick={() => split("vertical")} />
          <PaneAction
            label={maximized ? "Restaurar painel" : "Maximizar painel"}
            glyph={maximized ? "↙" : "□"}
            onClick={() => dispatch({ type: "TOGGLE_MAXIMIZE", paneId: pane.id })}
          />
          <PaneAction
            label="Fechar painel"
            glyph="×"
            disabled={onlyPane}
            onClick={closePane}
          />
        </div>
      </header>

      <div className="flex-1 min-h-0">
        <PaneErrorBoundary key={tab?.id ?? pane.id}>
        {!tab ? (
          <div className="h-full flex items-center justify-center">
            <Button onClick={() => dispatch({ type: "CREATE_TAB", paneId: pane.id, kind: "agent", title: "Novo agente" })}>
              Novo agente
            </Button>
          </div>
        ) : tab.kind === "terminal" || tab.kind === "agent" ? (
          <TerminalPane
            projectId={projectId}
            projectPath={projectPath}
            paneId={pane.id}
            tab={tab}
            onSessionCreated={bindSession}
          />
        ) : tab?.kind === "file" && tab.resourceId && isImagePath(tab.resourceId) ? (
          <ImagePane tab={tab} />
        ) : tab?.kind === "file" ? (
          <FilePane projectPath={projectPath} tab={tab} saveMode={fileSaveMode} onDirtyChange={handleDirtyChange} />
        ) : tab?.kind === "markdown" ? (
          <MarkdownPane
            projectPath={projectPath}
            tab={tab}
            fileSaveMode={fileSaveMode}
            onDirtyChange={handleDirtyChange}
          />
        ) : tab?.kind === "git-diff" ? (
          <GitDiffPane projectPath={projectPath} tab={tab} />
        ) : tab?.kind === "git-graph" ? (
          <GitGraphPane projectPath={projectPath} />
        ) : tab?.kind === "kanban" ? (
          <KanbanBoard projectId={projectId} kanban={kanban} dispatch={kanbanDispatch} />
        ) : (
          <div className="h-full p-4 font-mono text-xs overflow-auto">
            <div className="text-text-muted mb-4">{tab?.kind ?? "painel"}://{pane.id}</div>
            <p className="text-text-primary">Este painel será conectado numa fase posterior.</p>
          </div>
        )}
        </PaneErrorBoundary>
      </div>
      {dragActive && (
        <TabDropOverlay targetPaneId={pane.id} dispatch={dispatch} onFinished={() => setDragActive(false)} />
      )}
    </section>
  );
}

function PaneAction({
  label,
  glyph,
  disabled,
  onClick,
}: {
  label: string;
  glyph: string;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <Button
      variant="ghost"
      size="sm"
      className="!px-1.5 !py-1 min-w-7 font-mono"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={(event) => {
        event.stopPropagation();
        onClick();
      }}
    >
      {glyph}
    </Button>
  );
}

/** Uma pane travada nunca pode derrubar o app inteiro — mesmo padrão do `EffectBoundary` do fundo
 * animado (`AppBackground.tsx`), aqui com um retry visível em vez de sumir silenciosamente.
 * `key={tab.id}` no call site garante que trocar de aba reseta o estado de erro. */
class PaneErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // eslint-disable-next-line no-console
    console.error("painel travou:", error, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div role="alert" className="h-full overflow-auto p-4 text-xs text-danger">
        <p className="mb-2">Este painel travou: {this.state.error.message}</p>
        <Button size="sm" variant="danger" onClick={() => this.setState({ error: null })}>
          Tentar de novo
        </Button>
      </div>
    );
  }
}
