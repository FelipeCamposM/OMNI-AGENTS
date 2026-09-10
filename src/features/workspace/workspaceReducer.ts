import type {
  LayoutNode,
  LayoutPreset,
  PaneNode,
  Project,
  SplitNode,
  WorkspaceAction,
  WorkspaceState,
  WorkspaceTab,
} from "../../types/workspace";

let sequence = 0;

function nextId(prefix: string): string {
  sequence += 1;
  return `${prefix}-${Date.now().toString(36)}-${sequence.toString(36)}`;
}

function projectName(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).pop() ?? path;
}

function welcomeTab(name: string): WorkspaceTab {
  return { id: nextId("tab"), kind: "agent", title: `${name} · novo agente` };
}

function createTab(kind: WorkspaceTab["kind"] = "agent", title?: string, resourceId?: string): WorkspaceTab {
  const tab: WorkspaceTab = { id: nextId("tab"), kind, title: title ?? `New ${kind}` };
  return resourceId ? { ...tab, resourceId } : tab;
}

function newPane(title: string): PaneNode {
  const tab = welcomeTab(title);
  return { type: "pane", id: nextId("pane"), tabs: [tab], activeTabId: tab.id };
}

export function createProject(path: string): Project {
  const name = projectName(path);
  const pane = newPane(name);
  return {
    id: nextId("project"),
    name,
    path,
    gitRoot: null,
    branch: null,
    composeFile: null,
    lastOpenedAt: new Date().toISOString(),
    layout: pane,
    activePaneId: pane.id,
    maximizedPaneId: null,
  };
}

function mapNode(node: LayoutNode, mapper: (node: LayoutNode) => LayoutNode): LayoutNode {
  const mapped = mapper(node);
  if (mapped !== node || mapped.type === "pane") return mapped;
  return { ...mapped, first: mapNode(mapped.first, mapper), second: mapNode(mapped.second, mapper) };
}

function findPane(node: LayoutNode, paneId: string): PaneNode | null {
  if (node.type === "pane") return node.id === paneId ? node : null;
  return findPane(node.first, paneId) ?? findPane(node.second, paneId);
}

function removePane(node: LayoutNode, paneId: string): LayoutNode | null {
  if (node.type === "pane") return node.id === paneId ? null : node;
  const first = removePane(node.first, paneId);
  const second = removePane(node.second, paneId);
  if (!first) return second;
  if (!second) return first;
  return { ...node, first, second };
}

function firstPane(node: LayoutNode): PaneNode {
  return node.type === "pane" ? node : firstPane(node.first);
}

function paneCount(node: LayoutNode): number {
  return node.type === "pane" ? 1 : paneCount(node.first) + paneCount(node.second);
}

function collectPanes(node: LayoutNode): PaneNode[] {
  return node.type === "pane" ? [node] : [...collectPanes(node.first), ...collectPanes(node.second)];
}

function splitOf(direction: SplitNode["direction"], first: LayoutNode, second: LayoutNode, ratio = 0.5): SplitNode {
  return { type: "split", id: nextId("split"), direction, ratio, first, second };
}

/** Monta a árvore de splits de um layout pronto (estilo Snap Layouts) a partir das panes já
 * abertas — reaproveita as que existem (com suas tabs) e completa com panes novas vazias
 * (`newPane`) se faltar; se sobrar pane além dos slots do preset, empilha as tabs extras no
 * último slot em vez de descartá-las. */
function buildPresetLayout(current: LayoutNode, preset: LayoutPreset): LayoutNode {
  const existing = collectPanes(current);
  const slots = preset === "grid-2x2" ? 4 : preset === "main-plus-side" ? 3 : 2;
  const panes: PaneNode[] = [];
  for (let i = 0; i < slots; i++) {
    panes.push(i < existing.length ? existing[i] : newPane("Novo painel"));
  }
  for (let i = slots; i < existing.length; i++) {
    const last = panes[slots - 1];
    const tabs = [...last.tabs, ...existing[i].tabs];
    panes[slots - 1] = { ...last, tabs, activeTabId: last.activeTabId ?? tabs[0]?.id ?? null };
  }

  switch (preset) {
    case "columns-2":
      return splitOf("horizontal", panes[0], panes[1]);
    case "rows-2":
      return splitOf("vertical", panes[0], panes[1]);
    case "grid-2x2":
      return splitOf("horizontal", splitOf("vertical", panes[0], panes[1]), splitOf("vertical", panes[2], panes[3]));
    case "main-plus-side":
      return splitOf("horizontal", panes[0], splitOf("vertical", panes[1], panes[2]), 0.6);
  }
}

/** IDs de sessão (terminal/agente) referenciados em qualquer tab da árvore — usado para
 * encerrar tudo antes de fechar um projeto. */
export function collectResourceIds(node: LayoutNode): string[] {
  if (node.type === "pane") {
    return node.tabs.flatMap((tab) => (tab.resourceId ? [tab.resourceId] : []));
  }
  return [...collectResourceIds(node.first), ...collectResourceIds(node.second)];
}

function matchesResourcePrefix(resourceId: string | undefined, prefix: string): boolean {
  if (!resourceId) return false;
  return resourceId === prefix || resourceId.startsWith(`${prefix}\\`) || resourceId.startsWith(`${prefix}/`);
}

/** Primeira tab (em qualquer pane) cujo resourceId é igual a `prefix` ou está dentro dele
 * (arquivo dentro de uma pasta excluída) — usado por `CLOSE_TABS_BY_RESOURCE_PREFIX`. */
function findMatchingTab(node: LayoutNode, prefix: string): { paneId: string; tabId: string } | null {
  if (node.type === "pane") {
    const tab = node.tabs.find((item) => matchesResourcePrefix(item.resourceId, prefix));
    return tab ? { paneId: node.id, tabId: tab.id } : null;
  }
  return findMatchingTab(node.first, prefix) ?? findMatchingTab(node.second, prefix);
}

function takeTab(
  layout: LayoutNode,
  paneId: string,
  tabId: string,
  allowPaneRemoval: boolean
): { layout: LayoutNode; tab: WorkspaceTab } | null {
  const pane = findPane(layout, paneId);
  const tab = pane?.tabs.find((item) => item.id === tabId);
  if (!pane || !tab) return null;

  if (pane.tabs.length === 1) {
    if (allowPaneRemoval && layout.type !== "pane") {
      const nextLayout = removePane(layout, paneId);
      if (nextLayout) return { layout: nextLayout, tab };
    }
    // A última pane permanece, mas seu conteúdo é desmontado de verdade.
    return {
      tab,
      layout: mapNode(layout, (node) =>
        node.type === "pane" && node.id === paneId ? { ...node, tabs: [], activeTabId: null } : node
      ),
    };
  }

  return {
    tab,
    layout: mapNode(layout, (node) => {
      if (node.type !== "pane" || node.id !== paneId) return node;
      const tabs = node.tabs.filter((item) => item.id !== tabId);
      const index = node.tabs.findIndex((item) => item.id === tabId);
      const activeTabId =
        node.activeTabId === tabId
          ? tabs[Math.min(index, tabs.length - 1)].id
          : node.activeTabId;
      return { ...node, tabs, activeTabId };
    }),
  };
}

function updateActiveProject(
  state: WorkspaceState,
  update: (project: Project) => Project
): WorkspaceState {
  if (!state.activeProjectId) return state;
  return {
    ...state,
    updatedAt: new Date().toISOString(),
    projects: state.projects.map((project) =>
      project.id === state.activeProjectId ? update(project) : project
    ),
  };
}

export function workspaceReducer(state: WorkspaceState, action: WorkspaceAction): WorkspaceState {
  switch (action.type) {
    case "ADD_PROJECT": {
      const existing = state.projects.find(
        (project) => project.path.toLocaleLowerCase() === action.path.toLocaleLowerCase()
      );
      if (existing) return { ...state, activeProjectId: existing.id };
      const project = createProject(action.path);
      return {
        ...state,
        projects: [...state.projects, project],
        activeProjectId: project.id,
        updatedAt: new Date().toISOString(),
      };
    }
    case "SELECT_PROJECT":
      return state.projects.some((project) => project.id === action.projectId)
        ? { ...state, activeProjectId: action.projectId }
        : state;
    case "CLOSE_PROJECT": {
      const projects = state.projects.filter((project) => project.id !== action.projectId);
      if (projects.length === state.projects.length) return state;
      const activeProjectId =
        state.activeProjectId === action.projectId
          ? (projects[0]?.id ?? null)
          : state.activeProjectId;
      return { ...state, projects, activeProjectId, updatedAt: new Date().toISOString() };
    }
    case "FOCUS_PANE":
      return updateActiveProject(state, (project) =>
        findPane(project.layout, action.paneId)
          ? { ...project, activePaneId: action.paneId }
          : project
      );
    case "SELECT_TAB":
      return updateActiveProject(state, (project) => ({
        ...project,
        activePaneId: action.paneId,
        layout: mapNode(project.layout, (node) =>
          node.type === "pane" && node.id === action.paneId && node.tabs.some((tab) => tab.id === action.tabId)
            ? { ...node, activeTabId: action.tabId }
            : node
        ),
      }));
    case "CREATE_TAB":
      return updateActiveProject(state, (project) => {
        if (!findPane(project.layout, action.paneId)) return project;
        const tab = createTab(action.kind, action.title, action.resourceId);
        return {
          ...project,
          activePaneId: action.paneId,
          layout: mapNode(project.layout, (node) =>
            node.type === "pane" && node.id === action.paneId
              ? { ...node, tabs: [...node.tabs, tab], activeTabId: tab.id }
              : node
          ),
        };
      });
    case "BIND_TAB_RESOURCE":
      return updateActiveProject(state, (project) => ({
        ...project,
        layout: mapNode(project.layout, (node) =>
          node.type === "pane" && node.id === action.paneId
            ? {
                ...node,
                tabs: node.tabs.map((tab) =>
                  tab.id === action.tabId
                    ? { ...tab, kind: "agent", resourceId: action.resourceId, title: action.title ?? tab.title }
                    : tab
                ),
              }
            : node
        ),
      }));
    case "ATTACH_TERMINAL":
      return updateActiveProject(state, (project) => {
        const paneId = project.activePaneId;
        const pane = findPane(project.layout, paneId);
        if (!pane) return project;
        const existing = pane.tabs.find((tab) => tab.resourceId === action.sessionId);
        if (existing) {
          return {
            ...project,
            layout: mapNode(project.layout, (node) =>
              node.type === "pane" && node.id === paneId ? { ...node, activeTabId: existing.id } : node
            ),
          };
        }
        const tab = { ...createTab("agent", action.title), resourceId: action.sessionId };
        return {
          ...project,
          layout: mapNode(project.layout, (node) =>
            node.type === "pane" && node.id === paneId
              ? { ...node, tabs: [...node.tabs, tab], activeTabId: tab.id }
              : node
          ),
        };
      });
    case "RENAME_TAB_RESOURCE":
      // Percorre todas as panes (não só a ativa) — o mesmo arquivo pode estar
      // aberto em mais de uma tab ao mesmo tempo.
      return updateActiveProject(state, (project) => ({
        ...project,
        layout: mapNode(project.layout, (node) => {
          if (node.type !== "pane") return node;
          let changed = false;
          const tabs = node.tabs.map((tab) => {
            if (tab.resourceId !== action.fromResourceId) return tab;
            changed = true;
            return { ...tab, resourceId: action.toResourceId, title: action.title ?? tab.title };
          });
          return changed ? { ...node, tabs } : node;
        }),
      }));
    case "CLOSE_TABS_BY_RESOURCE_PREFIX":
      // Fecha todas as tabs cujo resourceId é (ou está dentro de) `prefix` — usado quando um
      // arquivo/pasta é excluído no painel de arquivos. Repete takeTab uma tab de cada vez:
      // fechar mexe na árvore (pode colapsar uma pane), então não dá pra calcular tudo de uma
      // vez só olhando o estado original.
      return updateActiveProject(state, (project) => {
        let layout = project.layout;
        let match = findMatchingTab(layout, action.prefix);
        while (match) {
          const taken = takeTab(layout, match.paneId, match.tabId, paneCount(layout) > 1);
          if (!taken) break; // não deveria acontecer (pane/tab já validados por findMatchingTab)
          layout = taken.layout;
          match = findMatchingTab(layout, action.prefix);
        }
        if (layout === project.layout) return project;
        const activePaneId = findPane(layout, project.activePaneId)?.id ?? firstPane(layout).id;
        return { ...project, layout, activePaneId, maximizedPaneId: null };
      });
    case "CLOSE_TAB":
      return updateActiveProject(state, (project) => {
        const taken = takeTab(project.layout, action.paneId, action.tabId, paneCount(project.layout) > 1);
        if (!taken) return project;
        const activePaneId = findPane(taken.layout, project.activePaneId)?.id ?? firstPane(taken.layout).id;
        return { ...project, layout: taken.layout, activePaneId, maximizedPaneId: null };
      });
    case "MOVE_TAB":
      return updateActiveProject(state, (project) => {
        if (action.sourcePaneId === action.targetPaneId) {
          const target = findPane(project.layout, action.targetPaneId);
          if (!target?.tabs.some((tab) => tab.id === action.tabId)) return project;
          return {
            ...project,
            activePaneId: action.targetPaneId,
            layout: mapNode(project.layout, (node) =>
              node.type === "pane" && node.id === action.targetPaneId
                ? { ...node, activeTabId: action.tabId }
                : node
            ),
          };
        }
        if (!findPane(project.layout, action.targetPaneId)) return project;
        const taken = takeTab(project.layout, action.sourcePaneId, action.tabId, true);
        if (!taken || !findPane(taken.layout, action.targetPaneId)) return project;
        return {
          ...project,
          activePaneId: action.targetPaneId,
          maximizedPaneId: null,
          layout: mapNode(taken.layout, (node) =>
            node.type === "pane" && node.id === action.targetPaneId
              ? { ...node, tabs: [...node.tabs, taken.tab], activeTabId: taken.tab.id }
              : node
          ),
        };
      });
    case "SPLIT_WITH_TAB":
      return updateActiveProject(state, (project) => {
        const targetBefore = findPane(project.layout, action.targetPaneId);
        if (!targetBefore) return project;
        const taken = takeTab(project.layout, action.sourcePaneId, action.tabId, true);
        if (!taken) return project;
        const target = findPane(taken.layout, action.targetPaneId);
        if (!target) return project;
        const pane: PaneNode = {
          type: "pane",
          id: nextId("pane"),
          tabs: [taken.tab],
          activeTabId: taken.tab.id,
        };
        return {
          ...project,
          activePaneId: pane.id,
          maximizedPaneId: null,
          layout: mapNode(taken.layout, (node) => {
            if (node.type !== "pane" || node.id !== target.id) return node;
            const children = action.position === "before" ? [pane, node] : [node, pane];
            return {
              type: "split",
              id: nextId("split"),
              direction: action.direction,
              ratio: 0.5,
              first: children[0],
              second: children[1],
            };
          }),
        };
      });
    case "SPLIT_PANE":
      return updateActiveProject(state, (project) => {
        const source = findPane(project.layout, action.paneId);
        if (!source) return project;
        const pane = newPane("Novo painel");
        return {
          ...project,
          activePaneId: pane.id,
          maximizedPaneId: null,
          layout: mapNode(project.layout, (node) =>
            node.type === "pane" && node.id === action.paneId
              ? {
                  type: "split",
                  id: nextId("split"),
                  direction: action.direction,
                  ratio: 0.5,
                  first: node,
                  second: pane,
                }
              : node
          ),
        };
      });
    case "CLOSE_PANE":
      return updateActiveProject(state, (project) => {
        if (project.layout.type === "pane") return project;
        const layout = removePane(project.layout, action.paneId);
        if (!layout) return project;
        const activePaneId = findPane(layout, project.activePaneId)?.id ?? firstPane(layout).id;
        return { ...project, layout, activePaneId, maximizedPaneId: null };
      });
    case "TOGGLE_MAXIMIZE":
      return updateActiveProject(state, (project) => ({
        ...project,
        activePaneId: action.paneId,
        maximizedPaneId: project.maximizedPaneId === action.paneId ? null : action.paneId,
      }));
    case "RESIZE_SPLIT":
      return updateActiveProject(state, (project) => ({
        ...project,
        layout: mapNode(project.layout, (node) =>
          node.type === "split" && node.id === action.splitId
            ? { ...node, ratio: Math.min(0.8, Math.max(0.2, action.ratio)) }
            : node
        ),
      }));
    case "MOVE_PANE":
      // Mesmo molde de SPLIT_WITH_TAB, mas arrancando a pane inteira (com todas as tabs) em vez
      // de uma tab só — arrasto do cabeçalho da pane, não de uma tab.
      return updateActiveProject(state, (project) => {
        if (action.sourcePaneId === action.targetPaneId) return project;
        const source = findPane(project.layout, action.sourcePaneId);
        if (!source) return project;
        const targetBefore = findPane(project.layout, action.targetPaneId);
        if (!targetBefore) return project;
        const removed = removePane(project.layout, action.sourcePaneId);
        if (!removed) return project;
        const target = findPane(removed, action.targetPaneId);
        if (!target) return project;
        return {
          ...project,
          activePaneId: source.id,
          maximizedPaneId: null,
          layout: mapNode(removed, (node) => {
            if (node.type !== "pane" || node.id !== target.id) return node;
            const children = action.position === "before" ? [source, node] : [node, source];
            return {
              type: "split",
              id: nextId("split"),
              direction: action.direction,
              ratio: 0.5,
              first: children[0],
              second: children[1],
            };
          }),
        };
      });
    case "SWAP_PANE":
      // Soltar no centro: troca só o conteúdo (tabs) das duas panes, mantendo id/posição de cada
      // uma na árvore — visualmente idêntico a trocar as posições, sem precisar reestruturar splits.
      return updateActiveProject(state, (project) => {
        if (action.sourcePaneId === action.targetPaneId) return project;
        const source = findPane(project.layout, action.sourcePaneId);
        const target = findPane(project.layout, action.targetPaneId);
        if (!source || !target) return project;
        return {
          ...project,
          activePaneId: action.targetPaneId,
          maximizedPaneId: null,
          layout: mapNode(project.layout, (node) => {
            if (node.type !== "pane") return node;
            if (node.id === source.id) return { ...node, tabs: target.tabs, activeTabId: target.activeTabId };
            if (node.id === target.id) return { ...node, tabs: source.tabs, activeTabId: source.activeTabId };
            return node;
          }),
        };
      });
    case "APPLY_LAYOUT_PRESET":
      return updateActiveProject(state, (project) => {
        const layout = buildPresetLayout(project.layout, action.preset);
        return { ...project, layout, activePaneId: firstPane(layout).id, maximizedPaneId: null };
      });
  }
}
