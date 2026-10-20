import { TitleBar } from "./components/TitleBar";
import { LayoutPresetPicker } from "./features/workspace/LayoutPresetPicker";
import { useEffect, useMemo, useRef, useState } from "react";
import { AppBackground } from "./components/backgrounds/AppBackground";
import { SettingsView } from "./components/SettingsView";
import { Sidebar } from "./components/Sidebar";
import { fileKind, joinPath } from "./features/files/filesService";
import { semLocal } from "./mobile/api";
import { EVENTO_ABRIR_ARQUIVO } from "./mobile/anexos";
import { QuickOpen } from "./features/files/QuickOpen";
import { useWorkspace } from "./features/workspace/useWorkspace";
import { collectResourceIds, findPane } from "./features/workspace/workspaceReducer";
import { RodapeDoProjeto, WorkspaceView } from "./features/workspace/WorkspaceView";
import { useKanban } from "./features/kanban/useKanban";
import { useKanbanDispatcher } from "./features/kanban/useKanbanDispatcher";
import { SessionProvidersContext } from "./features/terminal/sessionProviders";
import { useTerminalSessions } from "./features/terminal/useTerminalSessions";
import { latestPerConversation, useAttention, type AttentionItem } from "./features/terminal/useAttention";
import { useAttentionNotifier } from "./features/terminal/useAttentionNotifier";
import { useJanelaEmFoco } from "./hooks/useJanelaEmFoco";
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
import { FluxosView } from "./features/fluxos/FluxosView";
import { levarParaConta, resumeCommand, samePath, type HistoryEntry } from "./features/history/historyService";
import { rememberProject } from "./services/recentProjectsService";
import { primeSshDrives } from "./features/projects/targetState";
import type { SettingsSection } from "./hooks/useNotifications";
import { useSettings } from "./hooks/useSettings";
import { matchesShortcut } from "./lib/shortcuts";

type View = "workspace" | "settings" | "history" | "fluxos";

export function App() {
  const [view, setView] = useState<View>("workspace");
  const [settingsSection, setSettingsSection] = useState<SettingsSection | undefined>();
  // Para onde o "fechar" das Configurações volta: a tela de antes, com o workspace intacto no reducer.
  const [viewBeforeSettings, setViewBeforeSettings] = useState<Exclude<View, "settings">>("workspace");
  // Mesma ideia para o Histórico. Aberto por cima das Configurações, volta para a tela de antes
  // delas — senão fechar o histórico reabriria as Configurações, que o usuário já tinha deixado.
  const [viewBeforeHistory, setViewBeforeHistory] = useState<Exclude<View, "history">>("workspace");
  const { settings, updateSettings, resetSettings } = useSettings();
  // Memo: o objeto novo a cada render faria o `useWorkspace` recalcular a projeção à toa.
  const temaPublicado = useMemo(
    () => ({ accent: settings.accent, theme: settings.theme, background: settings.background, glass: settings.glass }),
    [settings.accent, settings.theme, settings.background, settings.glass]
  );
  const { workspace, activeProject, dispatch, workspaces, activeWorkspaceId } = useWorkspace(temaPublicado);
  const { sessions, online: engineOnline } = useTerminalSessions();
  const { kanban, dispatch: kanbanDispatch } = useKanban();
  useKanbanDispatcher(kanban, kanbanDispatch, workspace.projects, sessions);
  // Com as Configurações abertas nenhuma pane está na tela, e com a janela fora de foco ninguém
  // está olhando para ela — nos dois casos nada pode ser marcado como visto.
  const janelaEmFoco = useJanelaEmFoco();
  const { items: attention, all: allAttention, countByWorkspace, dismiss: dismissAttention } = useAttention(
    sessions,
    workspaces,
    activeWorkspaceId,
    view === "workspace" && janelaEmFoco
  );

  useAttentionNotifier(allAttention, settings.notifyAttention, attention);

  // Sessões por id: a barra de abas troca o ícone de conversa pela marca do agente, e o rodapé
  // descobre provider, conta e transcript da aba em foco.
  const sessionsById = useMemo(
    () => Object.fromEntries(sessions.map((session) => [session.id, session])),
    [sessions]
  );

  function closeSettings() {
    setView(viewBeforeSettings);
  }

  function openHistory() {
    if (view === "history") return;
    const origem = view === "settings" ? viewBeforeSettings : view;
    // Histórico → Configurações → Histórico: mantém a volta que o primeiro Histórico já guardou.
    if (origem !== "history") setViewBeforeHistory(origem);
    setView("history");
  }

  function closeHistory() {
    setView(viewBeforeHistory);
  }

  // O engine devolve em `session.name` o nome da **conversa** (o primeiro prompt, ou o que o usuário
  // renomeou). Espelhar aqui é o que faz a aba deixar de ser "Claude · agent" sem cada tela precisar
  // saber o que é conversa. O reducer ignora quando o nome não mudou.
  useEffect(() => {
    for (const session of sessions) {
      if (!session.name) continue;
      dispatch({
        type: "RENAME_TAB_RESOURCE",
        fromResourceId: session.id,
        toResourceId: session.id,
        title: session.name,
      });
    }
  }, [sessions, activeProject?.id, dispatch]);

  // Qual unidade é qual máquina remota: lido uma vez, para os polls saberem que um projeto em
  // `X:\...` é SSH e não disco local (ver `targetState`).
  useEffect(() => {
    void primeSshDrives();
  }, []);

  useEffect(() => {
    if (view !== "settings" && view !== "history") return;
    function onKeyDown(event: KeyboardEvent) {
      // Esc dentro de campo/menu é do campo; só fecha a tela se ninguém mais tratou a tecla.
      if (event.defaultPrevented || (event.target as HTMLElement | null)?.closest?.("input, textarea, [role=listbox]")) return;
      if (!matchesShortcut(event, "closeSettings")) return;
      event.preventDefault();
      setView(view === "settings" ? viewBeforeSettings : viewBeforeHistory);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [view, viewBeforeSettings, viewBeforeHistory]);

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

  async function runInTerminal(title: string, command: string) {
    if (!activeProject) return;
    await ensureEngine();
    const session = await spawnTerminal({
      projectId: activeProject.id,
      name: title,
      cwd: activeProject.path,
      rows: 30,
      cols: 120,
      initialCommand: command,
    });
    dispatch({ type: "ATTACH_TERMINAL", sessionId: session.id, title: session.name });
    setView("workspace");
  }

  function openFile(path: string, kind: "file" | "markdown") {
    if (!activeProject) return;
    const title = path.split(/[\\/]/).filter(Boolean).pop() ?? path;
    dispatch({ type: "CREATE_TAB", paneId: activeProject.activePaneId, kind, title, resourceId: path });
    setView("workspace");
  }

  // Arquivo citado na conversa (`src/App.tsx:42`): relativo é do projeto, absoluto vale como está.
  // Fora do projeto o painel recusa ler, como em qualquer arquivo aberto.
  const abrirCitado = useRef(openFile);
  abrirCitado.current = openFile;
  const projetoDaCitacao = activeProject?.path ?? null;
  useEffect(() => {
    if (!projetoDaCitacao) return;
    const abrir = (evento: Event) => {
      const caminho = semLocal((evento as CustomEvent<string>).detail).replace(/^\.[\\/]/, "");
      const absoluto = /^([A-Za-z]:)?[\\/]/.test(caminho) ? caminho : joinPath(projetoDaCitacao, caminho);
      abrirCitado.current(absoluto, fileKind(absoluto));
    };
    window.addEventListener(EVENTO_ABRIR_ARQUIVO, abrir);
    return () => window.removeEventListener(EVENTO_ABRIR_ARQUIVO, abrir);
  }, [projetoDaCitacao]);

  /** Reabre uma conversa do Histórico num terminal do projeto dela — adicionando o projeto ao
   *  workspace ativo se ele ainda não estiver aberto em nenhum. */
  async function resumeHistory(entry: HistoryEntry, profileId: string = entry.profile_id) {
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
    if (!found) {
      rememberProject(cwd);
      dispatch({ type: "ADD_PROJECT", path: cwd, id: projectId });
    }

    await ensureEngine();
    // Outra conta: o transcript vai para lá antes, senão o `--resume` não acha a conversa.
    await levarParaConta(entry, profileId);
    await ensureAgentTrust(cli.id, cwd, profileId);
    const session = await spawnTerminal({
      projectId,
      name: `${cli.label} · ${(entry.title ?? "retomada").slice(0, 40)}`,
      cwd,
      rows: 30,
      cols: 120,
      initialCommand: resumeCommand(cli.command, entry),
      provider: cli.id,
      profileId,
      externalSessionId: entry.session_id,
    });
    dispatch({ type: "FOCUS_SESSION", workspaceId, projectId, sessionId: session.id, title: session.name });
    setView("workspace");
  }

  return (
    <SessionProvidersContext.Provider value={sessionsById}>
    <div className="flex h-screen flex-col overflow-hidden">
      <AppBackground settings={settings} />
      <TitleBar
        trilha={
          view === "settings" ? ["Configurações"]
            : view === "history" ? ["Histórico"]
            : view === "fluxos" ? ["Fluxos de agentes"]
            : [workspaces.find((item) => item.id === activeWorkspaceId)?.name, activeProject?.name].filter((parte): parte is string => Boolean(parte))
        }
        dica={view === "workspace" ? activeProject?.path : undefined}
        acoes={view === "workspace" && activeProject ? <LayoutPresetPicker dispatch={dispatch} /> : null}
        onHome={() => setView("workspace")}
        onOpenSettings={(section) => {
          setSettingsSection(section);
          if (view !== "settings") setViewBeforeSettings(view);
          setView("settings");
        }}
      />
      <div className="flex min-h-0 flex-1">
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
        onDismissAttention={(item) => dismissAttention(item.sessionId)}
        onRunInTerminal={(title, command) => void runInTerminal(title, command).catch(() => undefined)}
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
        // Uma linha por conversa: as tentativas antigas do failover (uma sessão parada por troca
        // de conta) repetiam a mesma conversa dez vezes na lista.
        activeSessionId={(() => {
          const pane = activeProject ? findPane(activeProject.layout, activeProject.activePaneId) : null;
          return pane?.tabs.find((tab) => tab.id === pane.activeTabId)?.resourceId ?? null;
        })()}
        terminalSessions={latestPerConversation(
          sessions.filter((session) => session.project_id === workspace.activeProjectId),
        )}
        agentSessions={latestPerConversation(sessions.filter((session) => session.provider))}
        showSettings={view === "settings"}
        showHistory={view === "history"}
        showFluxos={view === "fluxos"}
        onOpenFluxos={() => {
          // Com projeto aberto, o fluxo é uma aba como as outras (divide, arrasta, fica ao lado do
          // agente). Sem projeto, só existem os fluxos globais: tela cheia.
          if (!activeProject) { setView("fluxos"); return; }
          dispatch({ type: "CREATE_TAB", paneId: activeProject.activePaneId, kind: "fluxos", title: "Fluxos de agentes" });
          setView("workspace");
        }}
        onOpenHistory={openHistory}
        onHome={() => setView("workspace")}
        onAddProject={(path) => {
          rememberProject(path);
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
          if (view !== "settings") setViewBeforeSettings(view);
          setView("settings");
        }}
      />

      <div className="flex-1 flex flex-col min-w-0 min-h-0">
        <main className="flex-1 min-h-0">
          {view === "history" ? (
            <HistoryView onResume={resumeHistory} onClose={closeHistory} />
          ) : view === "fluxos" ? (
            <div className="h-full min-h-0 flex flex-col">
              <div className="flex-1 min-h-0">
                <FluxosView projectId={activeProject?.id ?? null} projectPath={activeProject?.path ?? null}
                  onAbrirSessao={(sessionId, title) => { dispatch({ type: "ATTACH_TERMINAL", sessionId, title }); setView("workspace"); }}
                  onClose={() => setView("workspace")} />
              </div>
              <RodapeDoProjeto projectPath={activeProject?.path ?? null} engineOnline={engineOnline} activeSessionId={null} />
            </div>
          ) : view === "settings" ? (
            <div className="h-full overflow-y-auto px-6 py-5 [scrollbar-gutter:stable]">
              <div className="w-full mx-auto max-w-[1180px]">
                <SettingsView
                  settings={settings}
                  onChange={updateSettings}
                  onReset={resetSettings}
                  initialSection={settingsSection}
                  projectPath={activeProject?.path ?? null}
                  projectPaths={[...new Set(workspaces.flatMap((item) => item.projects.map((project) => project.path)))]}
                  onClose={closeSettings}
                />
              </div>
            </div>
          ) : (
            <WorkspaceView
              project={activeProject}
              engineOnline={engineOnline}
              attention={attention}
              fileSaveMode={settings.fileSaveMode}
              agentView={settings.agentView}
              kanban={kanban}
              kanbanDispatch={kanbanDispatch}
              dispatch={dispatch}
            />
          )}
        </main>
      </div>
      </div>
    </div>
    </SessionProvidersContext.Provider>
  );
}
