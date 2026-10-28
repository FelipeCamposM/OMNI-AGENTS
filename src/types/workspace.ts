export type PaneKind =
  | "agent"
  | "terminal"
  | "command"
  | "file"
  | "markdown"
  | "git-diff"
  | "git-graph"
  | "kanban"
  | "fluxos"
  | "logs"
  | "docker-logs";

export interface WorkspaceTab {
  id: string;
  kind: PaneKind;
  title: string;
  resourceId?: string;
  /** CLI que roda nesta aba (`claude`, `codex`, `cursor`). Só existe em aba de agente e é o que
   *  troca o ícone da aba pela marca do provider. */
  provider?: string;
}

export interface PaneNode {
  type: "pane";
  id: string;
  tabs: WorkspaceTab[];
  activeTabId: string | null;
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
  /** Símbolo do projeto: caminho de um favicon escolhido, `null` = ícone de pasta, sem campo = o
   *  primeiro favicon achado na pasta. */
  icone?: string | null;
}

export interface WorkspaceState {
  version: 1;
  id: string;
  name: string;
  projects: Project[];
  activeProjectId: string | null;
  updatedAt: string;
  /** Fechado pela lateral: some da lista, mas projetos, layout e agentes continuam — reabre igual. */
  hidden?: boolean;
  /** Símbolo do workspace: favicon escolhido de um dos projetos, `null` = a caixa padrão, sem campo = o
   *  favicon do primeiro projeto que tiver um. */
  icone?: string | null;
}

/** Vários workspaces independentes — cada um com seus próprios projects/layout. */
export interface WorkspaceCollection {
  version: 1;
  workspaces: WorkspaceState[];
  activeWorkspaceId: string | null;
}

export type WorkspaceAction =
  /** `id` opcional: quem precisa do id antes do reducer rodar (retomar conversa do Histórico). */
  | { type: "ADD_PROJECT"; path: string; id?: string }
  | { type: "SELECT_PROJECT"; projectId: string }
  | { type: "CLOSE_PROJECT"; projectId: string }
  /** Arrastar na lateral: vai para antes de `beforeId` (`null` = fim). */
  | { type: "MOVE_PROJECT"; projectId: string; beforeId: string | null }
  /** `icone` como em `Project.icone`; `undefined` volta para o automático. */
  | { type: "SET_PROJECT_ICON"; projectId: string; icone: string | null | undefined }
  | { type: "FOCUS_PANE"; paneId: string }
  | { type: "SELECT_TAB"; paneId: string; tabId: string }
  | { type: "CREATE_TAB"; paneId: string; kind?: PaneKind; title?: string; resourceId?: string }
  | { type: "BIND_TAB_RESOURCE"; paneId: string; tabId: string; resourceId: string; title?: string; provider?: string }
  | { type: "ATTACH_TERMINAL"; sessionId: string; title: string }
  | { type: "RENAME_TAB_RESOURCE"; fromResourceId: string; toResourceId: string; title?: string }
  | { type: "CLOSE_TABS_BY_RESOURCE_PREFIX"; prefix: string }
  | { type: "CLOSE_TAB"; paneId: string; tabId: string }
  /** `index`: posição de destino entre as abas (reordenar no mesmo painel); sem ele, vai para o fim. */
  | { type: "MOVE_TAB"; sourcePaneId: string; targetPaneId: string; tabId: string; index?: number }
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

/** Layouts prontos (estilo Snap Layouts do Windows). O molde de cada um está em
 * `features/workspace/layoutPresets.ts`; `buildPresetLayout` monta a árvore a partir das panes atuais. */
export type LayoutPreset =
  | "columns-2" | "columns-3" | "columns-4" | "rows-2" | "rows-3" | "grid-2x2" | "grid-3x2"
  | "main-plus-side" | "side-plus-main" | "main-plus-3" | "main-top" | "main-bottom";

export type WorkspacesAction =
  | { type: "ADD_WORKSPACE"; name?: string }
  | { type: "SELECT_WORKSPACE"; workspaceId: string }
  /** Fechar na lateral: só esconde. Os agentes seguem rodando. */
  | { type: "HIDE_WORKSPACE"; workspaceId: string }
  /** Reabrir um escondido: volta para a lista e vira o ativo. */
  | { type: "SHOW_WORKSPACE"; workspaceId: string }
  /** Apagar de vez (quem chama encerra os terminais antes). */
  | { type: "DELETE_WORKSPACE"; workspaceId: string }
  /** Arrastar na lateral: vai para antes de `beforeId` (`null` = fim). */
  | { type: "MOVE_WORKSPACE"; workspaceId: string; beforeId: string | null }
  /** Tirar um projeto de um workspace qualquer, inclusive escondido (gerenciar workspaces). */
  | { type: "CLOSE_PROJECT_IN_WORKSPACE"; workspaceId: string; projectId: string }
  | { type: "RENAME_WORKSPACE"; workspaceId: string; name: string }
  /** `undefined` volta para o automático. */
  | { type: "SET_WORKSPACE_ICON"; workspaceId: string; icone: string | null | undefined }
  /** Pula pra uma sessão que pode estar em OUTRO workspace: troca o ativo, seleciona o projeto
   *  e abre a aba. Precisa viver aqui, no nível da coleção — as ações de `WorkspaceAction` são
   *  roteadas só pro workspace ativo (`workspacesReducer`), que é exatamente o que impede
   *  alcançar um agente de outro workspace. */
  | { type: "FOCUS_SESSION"; workspaceId: string; projectId: string; sessionId: string; title: string }
  | WorkspaceAction;
