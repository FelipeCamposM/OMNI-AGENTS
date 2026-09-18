import { useEffect, useRef } from "react";
import type { Project, WorkspacesAction } from "../../types/workspace";
import type { AttentionItem } from "../terminal/useAttention";
import { matchesShortcut } from "../../lib/shortcuts";

function isTerminalFocused(): boolean {
  return document.activeElement?.closest('[data-omni-context="terminal"]') != null;
}

/** Modelo de teclado de dois contextos (spec §22): dentro do terminal (foco no xterm),
 * só o atalho reservado é interceptado — tudo mais vai pro PTY. Fora dele, os atalhos
 * de navegação do app ficam ativos. Um único listener em `window`, sem Context API. */
export function useWorkspaceKeymap(
  project: Project | null,
  attention: AttentionItem[],
  dispatch: React.Dispatch<WorkspacesAction>
) {
  const projectRef = useRef(project);
  projectRef.current = project;
  const attentionRef = useRef(attention);
  attentionRef.current = attention;

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (matchesShortcut(event, "returnToApp")) {
        event.preventDefault();
        if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
        return;
      }

      if (isTerminalFocused()) return;

      const activeProject = projectRef.current;
      if (!activeProject) return;

      if (matchesShortcut(event, "splitHorizontal") || matchesShortcut(event, "splitVertical")) {
        event.preventDefault();
        dispatch({
          type: "SPLIT_PANE",
          paneId: activeProject.activePaneId,
          direction: matchesShortcut(event, "splitVertical") ? "vertical" : "horizontal",
        });
      } else if (matchesShortcut(event, "closePane")) {
        event.preventDefault();
        dispatch({ type: "CLOSE_PANE", paneId: activeProject.activePaneId });
      } else if (matchesShortcut(event, "maximizePane")) {
        event.preventDefault();
        dispatch({ type: "TOGGLE_MAXIMIZE", paneId: activeProject.activePaneId });
      } else if (matchesShortcut(event, "nextAttention")) {
        event.preventDefault();
        goToNextAttention(attentionRef.current, dispatch);
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [dispatch]);
}

function goToNextAttention(attention: AttentionItem[], dispatch: React.Dispatch<WorkspacesAction>) {
  // ponytail: pula pro item de atenção de maior prioridade (a lista já vem ordenada por
  // `useAttention`), não faz round-robin real entre vários pendentes. Adicionar um cursor
  // "último visitado" se isso incomodar com várias aprovações pendentes ao mesmo tempo.
  const next = attention[0];
  if (!next) return;
  // FOCUS_SESSION e não SELECT_PROJECT + ATTACH_TERMINAL: o projeto pode estar em outro
  // workspace, e aí o SELECT_PROJECT era no-op e o ATTACH grudava a sessão no projeto errado.
  dispatch({
    type: "FOCUS_SESSION",
    workspaceId: next.workspaceId,
    projectId: next.projectId,
    sessionId: next.sessionId,
    title: next.sessionName,
  });
}
