export type PaneKind =
  | "agent"
  | "terminal"
  | "command"
  | "file"
  | "markdown"
  | "git-diff"
  | "git-graph"
  | "kanban"
  | "logs"
  | "docker-logs";

export interface WorkspaceTab {
  id: string;
  kind: PaneKind;
  title: string;
  resourceId?: string;
}

export interface PaneNode {
  type: "pane";
  id: string;
  tabs: WorkspaceTab[];
  activeTabId: string;
}

export interface SplitNode {
  type: "split";
  id: string;
  direction: "horizontal" | "vertical";
  ratio: number;
  first: LayoutNode;
  second: LayoutNode;
}

export type LayoutNode = PaneNode | SplitNode;

export interface Project {
  id: string;
  name: string;
  path: string;
  gitRoot: string | null;
  branch: string | null;
  composeFile: string | null;
  lastOpenedAt: string;
  layout: LayoutNode;
  activePaneId: string;
  maximizedPaneId: string | null;
}

export interface WorkspaceState {
  version: 1;
  id: string;
  name: string;
  projects: Project[];
  activeProjectId: string | null;
  updatedAt: string;
}

/** Vários workspaces independentes — cada um com seus próprios projects/layout. */
export interface WorkspaceCollection {
  version: 1;
  workspaces: WorkspaceState[];
  activeWorkspaceId: string | null;
}

export type WorkspaceAction =
  | { type: "ADD_PROJECT"; path: string }
  | { type: "SELECT_PROJECT"; projectId: string }
  | { type: "CLOSE_PROJECT"; projectId: string }
  | { type: "FOCUS_PANE"; paneId: string }
  | { type: "SELECT_TAB"; paneId: string; tabId: string }
  | { type: "CREATE_TAB"; paneId: string; kind?: PaneKind; title?: string; resourceId?: string }
  | { type: "BIND_TAB_RESOURCE"; paneId: string; tabId: string; resourceId: string; title?: string }
  | { type: "ATTACH_TERMINAL"; sessionId: string; title: string }
  | { type: "RENAME_TAB_RESOURCE"; fromResourceId: string; toResourceId: string; title?: string }
  | { type: "CLOSE_TABS_BY_RESOURCE_PREFIX"; prefix: string }
  | { type: "CLOSE_TAB"; paneId: string; tabId: string }
  | { type: "MOVE_TAB"; sourcePaneId: string; targetPaneId: string; tabId: string }
  | {
      type: "SPLIT_WITH_TAB";
      sourcePaneId: string;
      targetPaneId: string;
      tabId: string;
      direction: SplitNode["direction"];
      position: "before" | "after";
    }
  | { type: "SPLIT_PANE"; paneId: string; direction: SplitNode["direction"] }
  | { type: "CLOSE_PANE"; paneId: string }
  | { type: "TOGGLE_MAXIMIZE"; paneId: string }
  | { type: "RESIZE_SPLIT"; splitId: string; ratio: number }
  | {
      type: "MOVE_PANE";
      sourcePaneId: string;
      targetPaneId: string;
      direction: SplitNode["direction"];
      position: "before" | "after";
    }
  | { type: "SWAP_PANE"; sourcePaneId: string; targetPaneId: string }
  | { type: "APPLY_LAYOUT_PRESET"; preset: LayoutPreset };

/** Layouts prontos (estilo Snap Layouts do Windows) — `buildPresetLayout` em
 * `workspaceReducer.ts` monta a árvore de splits correspondente a partir das panes atuais. */
export type LayoutPreset = "columns-2" | "rows-2" | "grid-2x2" | "main-plus-side";

export type WorkspacesAction =
  | { type: "ADD_WORKSPACE"; name?: string }
  | { type: "SELECT_WORKSPACE"; workspaceId: string }
  | { type: "CLOSE_WORKSPACE"; workspaceId: string }
  | { type: "RENAME_WORKSPACE"; workspaceId: string; name: string }
  | WorkspaceAction;
