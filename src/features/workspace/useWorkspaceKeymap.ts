import { useEffect, useRef } from "react";
import type { Project, WorkspaceAction } from "../../types/workspace";
import type { TerminalSession } from "../terminal/terminalService";

/** Ordem de prioridade do Attention Center (spec §11.3), reduzida aos 6 estados que o
 * engine hoje emite de fato. */
const ATTENTION_PRIORITY: TerminalSession["state"][] = ["approval_required", "crashed", "answered"];

function isTerminalFocused(): boolean {
  return document.activeElement?.closest('[data-omni-context="terminal"]') != null;
}

function isReturnToAppShortcut(event: KeyboardEvent): boolean {
  return event.ctrlKey && event.shiftKey && event.code === "Space";
}

/** Modelo de teclado de dois contextos (spec §22): dentro do terminal (foco no xterm),
 * só o atalho reservado é interceptado — tudo mais vai pro PTY. Fora dele, os atalhos
 * de navegação do app ficam ativos. Um único listener em `window`, sem Context API. */
export function useWorkspaceKeymap(
  project: Project | null,
  sessions: TerminalSession[],
  dispatch: React.Dispatch<WorkspaceAction>
) {
  const projectRef = useRef(project);
  projectRef.current = project;
  const sessionsRef = useRef(sessions);
  sessionsRef.current = sessions;

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (isReturnToAppShortcut(event)) {
        event.preventDefault();
        if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
        return;
      }

      if (isTerminalFocused()) return;

      const activeProject = projectRef.current;
      if (!activeProject) return;

      if (event.ctrlKey && event.key === "\\") {
        event.preventDefault();
        dispatch({
          type: "SPLIT_PANE",
          paneId: activeProject.activePaneId,
          direction: event.shiftKey ? "vertical" : "horizontal",
        });
      } else if (event.ctrlKey && event.key.toLowerCase() === "w") {
        event.preventDefault();
        dispatch({ type: "CLOSE_PANE", paneId: activeProject.activePaneId });
      } else if (event.ctrlKey && event.key.toLowerCase() === "m") {
        event.preventDefault();
        dispatch({ type: "TOGGLE_MAXIMIZE", paneId: activeProject.activePaneId });
      } else if (event.ctrlKey && event.key === "Tab") {
        event.preventDefault();
        goToNextAttention(activeProject, sessionsRef.current, dispatch);
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [dispatch]);
}

function goToNextAttention(
  activeProject: Project,
  sessions: TerminalSession[],
  dispatch: React.Dispatch<WorkspaceAction>
) {
  // ponytail: pula pro item de atenção de maior prioridade, não faz round-robin real
  // entre vários pendentes. Adicionar um cursor "último visitado" se isso incomodar
  // com múltiplas aprovações pendentes ao mesmo tempo.
  const ranked = sessions
    .filter((session) => ATTENTION_PRIORITY.includes(session.state))
    .sort((a, b) => ATTENTION_PRIORITY.indexOf(a.state) - ATTENTION_PRIORITY.indexOf(b.state));
  const next = ranked[0];
  if (!next) return;
  if (next.project_id !== activeProject.id) {
    dispatch({ type: "SELECT_PROJECT", projectId: next.project_id });
  }
  dispatch({ type: "ATTACH_TERMINAL", sessionId: next.id, title: next.name });
}
