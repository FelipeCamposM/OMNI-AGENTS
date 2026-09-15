import { useState } from "react";
import { AppBackground } from "./components/backgrounds/AppBackground";
import { SettingsView } from "./components/SettingsView";
import { Sidebar } from "./components/Sidebar";
import { fileKind } from "./features/files/filesService";
import { QuickOpen } from "./features/files/QuickOpen";
import { useWorkspace } from "./features/workspace/useWorkspace";
import { collectResourceIds } from "./features/workspace/workspaceReducer";
import { WorkspaceView } from "./features/workspace/WorkspaceView";
import { useKanban } from "./features/kanban/useKanban";
import { useKanbanDispatcher } from "./features/kanban/useKanbanDispatcher";
import { useTerminalSessions } from "./features/terminal/useTerminalSessions";
import { useAttention, type AttentionItem } from "./features/terminal/useAttention";
import { useAttentionNotifier } from "./features/terminal/useAttentionNotifier";
import {
  closeTerminal,
  duplicateTerminal,
  ensureAgentTrust,
  ensureEngine,
  listAgentClis,
  restartTerminal,
  spawnTerminal,
} from "./features/terminal/terminalService";
import { HistoryView } from "./features/history/HistoryView";
import { resumeCommand, samePath, type HistoryEntry } from "./features/history/historyService";
import type { SettingsSection } from "./hooks/useNotifications";
import { useSettings } from "./hooks/useSettings";

type View = "workspace" | "settings" | "history";

export function App() {
  const [view, setView] = useState<View>("workspace");
  const [settingsSection, setSettingsSection] = useState<SettingsSection | undefined>();
  const { settings, updateSettings, resetSettings } = useSettings();
  const { workspace, activeProject, dispatch, workspaces, activeWorkspaceId } = useWorkspace();
  const { sessions, online: engineOnline } = useTerminalSessions();
  const { kanban, dispatch: kanbanDispatch } = useKanban();
  useKanbanDispatcher(kanban, kanbanDispatch, workspace.projects, sessions);
  // Com as Configurações abertas nenhuma pane está na tela, então nada pode ser marcado como visto.
  const { items: attention, all: allAttention, countByWorkspace } = useAttention(
    sessions,
    workspaces,
    activeWorkspaceId,
    view === "workspace"
  );

  useAttentionNotifier(allAttention, settings.notifyAttention);

  function focusSession(item: AttentionItem) {
    dispatch({
      type: "FOCUS_SESSION",
      workspaceId: item.workspaceId,
      projectId: item.projectId,
      sessionId: item.sessionId,
      title: item.sessionName,
    });
    setView("workspace");
  }

  function openFile(path: string, kind: "file" | "markdown") {
    if (!activeProject) return;
    const title = path.split(/[\\/]/).filter(Boolean).pop() ?? path;
    dispatch({ type: "CREATE_TAB", paneId: activeProject.activePaneId, kind, title, resourceId: path });
    setView("workspace");
  }

  /** Reabre uma conversa do Histórico num terminal do projeto dela — adicionando o projeto ao
   *  workspace ativo se ele ainda não estiver aberto em nenhum. */
  async function resumeHistory(entry: HistoryEntry) {
    const cwd = entry.cwd;
    if (!cwd) throw new Error("Essa conversa não registrou a pasta onde rodou.");
    const cli = (await listAgentClis()).find((item) => item.id === entry.provider);
    if (!cli?.available) throw new Error(`${cli?.label ?? entry.provider} não foi encontrado no PATH.`);
    const found = workspaces
      .flatMap((item) => item.projects.map((project) => ({ workspaceId: item.id, project })))
      .find(({ project }) => samePath(project.path, cwd));
    const workspaceId = found?.workspaceId ?? activeWorkspaceId;
    if (!workspaceId) throw new Error("Crie um workspace antes de retomar a conversa.");
    // Id escolhido aqui pra já nascer a sessão no projeto certo, antes do reducer rodar.
    const projectId = found?.project.id ?? `project-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    if (!found) dispatch({ type: "ADD_PROJECT", path: cwd, id: projectId });

    await ensureEngine();
    await ensureAgentTrust(cli.id, cwd, entry.profile_id);
    const session = await spawnTerminal({
      projectId,
      name: `${cli.label} · ${(entry.title ?? "retomada").slice(0, 40)}`,
      cwd,
      rows: 30,
      cols: 120,
      initialCommand: resumeCommand(cli.command, entry),
      provider: cli.id,
      profileId: entry.profile_id,
      externalSessionId: entry.session_id,
    });
    dispatch({ type: "FOCUS_SESSION", workspaceId, projectId, sessionId: session.id, title: session.name });
    setView("workspace");
  }

  return (
    <div className="flex h-screen overflow-hidden">
      <AppBackground settings={settings} />
      <QuickOpen projectPath={activeProject?.path ?? null} onOpenFile={(path) => openFile(path, fileKind(path))} />
      <Sidebar
        workspaces={workspaces}
        activeWorkspaceId={activeWorkspaceId}
        onSelectWorkspace={(workspaceId) => dispatch({ type: "SELECT_WORKSPACE", workspaceId })}
        onCreateWorkspace={() => dispatch({ type: "ADD_WORKSPACE" })}
        onCloseWorkspace={(workspaceId) => {
          const closingWorkspace = workspaces.find((item) => item.id === workspaceId);
          const closing = (closingWorkspace?.projects ?? [])
            .flatMap((project) => collectResourceIds(project.layout))
            .map((id) => closeTerminal(id));
          void Promise.allSettled(closing).then(() => dispatch({ type: "CLOSE_WORKSPACE", workspaceId }));
        }}
        onRenameWorkspace={(workspaceId, name) => dispatch({ type: "RENAME_WORKSPACE", workspaceId, name })}
        attention={attention}
        attentionByWorkspace={countByWorkspace}
        onFocusSession={focusSession}
        projects={workspace.projects}
        activeProjectId={workspace.activeProjectId}
        activeProjectPath={activeProject?.path ?? null}
        onOpenFile={openFile}
        onFileRenamed={(fromPath, toPath, title) => {
          dispatch({ type: "RENAME_TAB_RESOURCE", fromResourceId: fromPath, toResourceId: toPath, title });
        }}
        onPathDeleted={(path) => {
          dispatch({ type: "CLOSE_TABS_BY_RESOURCE_PREFIX", prefix: path });
        }}
        terminalSessions={sessions.filter(
          (session) => session.project_id === workspace.activeProjectId,
        )}
        showSettings={view === "settings"}
        showHistory={view === "history"}
        onOpenHistory={() => setView("history")}
        onHome={() => setView("workspace")}
        onAddProject={(path) => {
          dispatch({ type: "ADD_PROJECT", path });
          setView("workspace");
        }}
        onSelectProject={(projectId) => {
          dispatch({ type: "SELECT_PROJECT", projectId });
          setView("workspace");
        }}
        onCloseProject={(projectId) => {
          const project = workspace.projects.find((item) => item.id === projectId);
          const closing = project ? collectResourceIds(project.layout).map((id) => closeTerminal(id)) : [];
          void Promise.allSettled(closing).then(() => dispatch({ type: "CLOSE_PROJECT", projectId }));
        }}
        onAttachTerminal={(sessionId, title) => {
          dispatch({ type: "ATTACH_TERMINAL", sessionId, title });
          setView("workspace");
        }}
        onCloseTerminal={(sessionId) => {
          void closeTerminal(sessionId).catch(() => undefined);
          // Fecha (ou reseta, se for a última tab) qualquer tab presa nessa sessão — senão ela
          // fica apontando pra um resourceId morto e o poll do TerminalPane vira "session not
          // found" pra sempre.
          dispatch({ type: "CLOSE_TABS_BY_RESOURCE_PREFIX", prefix: sessionId });
        }}
        onDuplicateTerminal={(sessionId) => {
          void duplicateTerminal(sessionId)
            .then((session) => dispatch({ type: "ATTACH_TERMINAL", sessionId: session.id, title: session.name }))
            .catch(() => undefined);
        }}
        onRestartTerminal={(sessionId) => { void restartTerminal(sessionId).catch(() => undefined); }}
        onOpenGitDiff={(file, staged) => {
          if (!activeProject) return;
          const title = file.split(/[\\/]/).filter(Boolean).pop() ?? file;
          dispatch({
            type: "CREATE_TAB",
            paneId: activeProject.activePaneId,
            kind: "git-diff",
            title: `${title} (diff)`,
            resourceId: `${staged ? "staged" : "unstaged"}::${file}`,
          });
          setView("workspace");
        }}
        onOpenGitGraph={() => {
          if (!activeProject) return;
          dispatch({ type: "CREATE_TAB", paneId: activeProject.activePaneId, kind: "git-graph", title: "Git Graph" });
          setView("workspace");
        }}
        kanban={kanban}
        onOpenKanban={() => {
          if (!activeProject) return;
          dispatch({ type: "CREATE_TAB", paneId: activeProject.activePaneId, kind: "kanban", title: "Kanban" });
          setView("workspace");
        }}
        onOpenSettings={(section) => {
          setSettingsSection(section);
          setView("settings");
        }}
      />

      <div className="flex-1 flex flex-col min-w-0 min-h-0">
        <main className="flex-1 min-h-0">
          {view === "history" ? (
            <HistoryView onResume={resumeHistory} />
          ) : view === "settings" ? (
            <div className="h-full overflow-y-auto px-6 py-6 [scrollbar-gutter:stable]">
              <div className="w-full mx-auto max-w-3xl">
                <SettingsView
                  settings={settings}
                  onChange={updateSettings}
                  onReset={resetSettings}
                  initialSection={settingsSection}
                />
              </div>
            </div>
          ) : (
            <WorkspaceView
              project={activeProject}
              engineOnline={engineOnline}
              attention={attention}
              fileSaveMode={settings.fileSaveMode}
              kanban={kanban}
              kanbanDispatch={kanbanDispatch}
              dispatch={dispatch}
            />
          )}
        </main>
      </div>
    </div>
  );
}
