import { useEffect, useRef } from "react";
import type { KanbanAction, KanbanState } from "../../types/kanban";
import type { Project } from "../../types/workspace";
import {
  ensureAgentTrust,
  listAgentClis,
  spawnTerminal,
  terminalSnapshot,
  writeTerminal,
  type TerminalSession,
} from "../terminal/terminalService";

const TICK_MS = 1_000;
/** Estados que significam "essa sessão não serve mais pra continuar a fila" — precisa respawnar. */
const DEAD_STATES = new Set<TerminalSession["state"]>(["crashed", "stopped", "orphan"]);
const AGENT_STARTUP_DELAY_MS = 1_500;
const RESULT_NOTE_MAX_CHARS = 2_000;

/** Dispatcher automático do Kanban — capacidade adicional, desligada por padrão
 * (`kanban.dispatcherEnabled`). Não toca em nada do fluxo manual de abrir agente: spawna/reusa a
 * própria sessão por projeto (mapa em memória, não persistido — some num restart do app, o
 * próximo tick respawna) e só observa `sessions[].state` que `useTerminalSessions` já poll. */
export function useKanbanDispatcher(
  kanban: KanbanState,
  dispatch: React.Dispatch<KanbanAction>,
  projects: Project[],
  sessions: TerminalSession[]
) {
  const sessionByProjectRef = useRef<Record<string, string>>({});
  const runningRef = useRef(false);
  const kanbanRef = useRef(kanban);
  kanbanRef.current = kanban;
  const projectsRef = useRef(projects);
  projectsRef.current = projects;
  const sessionsRef = useRef(sessions);
  sessionsRef.current = sessions;

  useEffect(() => {
    let cancelled = false;
    let timer: number | undefined;

    async function checkDoingTask(project: Project, taskId: string) {
      const sessionId = sessionByProjectRef.current[project.id];
      const session = sessionId ? sessionsRef.current.find((item) => item.id === sessionId) : undefined;

      if (!session) {
        dispatch({
          type: "TASK_FINISHED",
          id: taskId,
          outcome: "failed",
          resultNote: "Sessão do agente encerrou inesperadamente.",
        });
        dispatch({ type: "RECORD_FAILURE" });
        delete sessionByProjectRef.current[project.id];
        return;
      }

      if (session.state === "answered") {
        let resultNote = "";
        try {
          const snapshot = await terminalSnapshot(session.id, 0);
          resultNote = snapshot.data.slice(-RESULT_NOTE_MAX_CHARS);
        } catch {
          // sem sorte pegar o texto de saída — a task ainda fecha como sucesso
        }
        dispatch({ type: "TASK_FINISHED", id: taskId, outcome: "done", resultNote });
        return;
      }

      if (DEAD_STATES.has(session.state)) {
        dispatch({
          type: "TASK_FINISHED",
          id: taskId,
          outcome: "failed",
          resultNote: `Sessão terminou em estado "${session.state}".`,
        });
        dispatch({ type: "RECORD_FAILURE" });
        delete sessionByProjectRef.current[project.id];
        return;
      }

      // "working"/"approval_required": ainda rodando, ou esperando o usuário responder um prompt
      // de permissão do próprio CLI — o dispatcher não aprova nada, só espera.
    }

    async function startTask(project: Project, taskId: string) {
      const task = kanbanRef.current.tasks.find((item) => item.id === taskId);
      if (!task) return;

      let sessionId = sessionByProjectRef.current[project.id];
      const session = sessionId ? sessionsRef.current.find((item) => item.id === sessionId) : undefined;

      if (!session || DEAD_STATES.has(session.state)) {
        const agents = await listAgentClis();
        const configuredId = kanbanRef.current.agentByProject[project.id];
        const configured = configuredId
          ? agents.find((item) => item.id === configuredId && item.available)
          : undefined;
        const agent = configured ?? agents.find((item) => item.available);
        if (!agent) return; // nenhuma CLI instalada/encontrada — nada a fazer ainda

        await ensureAgentTrust(agent.id, project.path);
        const spawned = await spawnTerminal({
          projectId: project.id,
          name: `Kanban · ${project.name}`,
          cwd: project.path,
          rows: 30,
          cols: 120,
          initialCommand: agent.command,
        });
        sessionId = spawned.id;
        sessionByProjectRef.current[project.id] = sessionId;
        // mesmo espírito do delay de 800ms que o engine usa antes de digitar o comando inicial —
        // dá tempo do agente subir antes de já mandar o prompt da task em cima.
        await new Promise((resolve) => setTimeout(resolve, AGENT_STARTUP_DELAY_MS));
      }

      await writeTerminal(sessionId, `${task.title}\n\n${task.description}\r`);
      dispatch({ type: "TASK_STARTED", id: taskId });
    }

    async function processProject(project: Project) {
      const state = kanbanRef.current;
      const doing = state.tasks.find((task) => task.projectId === project.id && task.status === "doing");
      if (doing) {
        await checkDoingTask(project, doing.id);
        return;
      }
      const next = state.tasks
        .filter((task) => task.projectId === project.id && task.status === "ready")
        .sort((a, b) => a.position - b.position)[0];
      if (next) await startTask(project, next.id);
    }

    async function runTick() {
      if (runningRef.current) return;
      runningRef.current = true;
      try {
        const state = kanbanRef.current;
        if (state.pausedUntil && Date.now() >= new Date(state.pausedUntil).getTime()) {
          dispatch({ type: "CLEAR_PAUSE" });
        }
        const stillPaused = kanbanRef.current.pausedUntil;
        if (!kanbanRef.current.dispatcherEnabled) return;
        if (stillPaused && Date.now() < new Date(stillPaused).getTime()) return;

        for (const project of projectsRef.current) {
          await processProject(project);
        }
      } finally {
        runningRef.current = false;
      }
    }

    async function tick() {
      if (!cancelled) await runTick();
      if (!cancelled) timer = window.setTimeout(tick, TICK_MS);
    }

    void tick();
    return () => {
      cancelled = true;
      if (timer) window.clearTimeout(timer);
    };
  }, [dispatch]);
}
