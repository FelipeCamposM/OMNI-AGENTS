import { useRef } from "react";
import type { LayoutNode, Project, WorkspaceState } from "../../types/workspace";
import type { TerminalSession } from "./terminalService";

/** Motivo pelo qual um agente quer atenção. `usage_limit`/`api_error` vêm do `notice` do engine —
 *  são rótulos melhores pro mesmo estado ocioso, não estados novos (ver `notice` no protocolo). */
export type AttentionReason =
  | "approval_required"
  | "usage_limit"
  | "api_error"
  | "crashed"
  | "orphan"
  | "answered"
  | "stopped";

/** Ordem do Attention Center (spec §11.3): o que bloqueia o agente primeiro, o que é só aviso
 *  depois. Serve de teste de pertinência E de ordenação — uma lista só, nunca duas fora de sincronia. */
export const ATTENTION_ORDER: AttentionReason[] = [
  "approval_required",
  "usage_limit",
  "api_error",
  "crashed",
  "orphan",
  "answered",
  "stopped",
];

export const ATTENTION_LABEL: Record<AttentionReason, string> = {
  approval_required: "aprovação pendente",
  usage_limit: "limite de uso atingido",
  api_error: "erro de API",
  crashed: "travou",
  orphan: "sessão órfã",
  answered: "terminou",
  stopped: "parado",
};

export interface AttentionItem {
  sessionId: string;
  sessionName: string;
  reason: AttentionReason;
  projectId: string;
  projectName: string;
  workspaceId: string;
  workspaceName: string;
}

/** Abas ATIVAS de cada pane — as únicas que estão de fato na tela. Difere de `collectResourceIds`
 *  (que colhe todas as abas) porque uma aba em segundo plano não foi vista por ninguém. */
function activeResourceIds(node: LayoutNode): string[] {
  if (node.type === "pane") {
    const active = node.tabs.find((tab) => tab.id === node.activeTabId);
    return active?.resourceId ? [active.resourceId] : [];
  }
  return [...activeResourceIds(node.first), ...activeResourceIds(node.second)];
}

function findNode(node: LayoutNode, id: string): LayoutNode | null {
  if (node.id === id) return node;
  if (node.type === "pane") return null;
  return findNode(node.first, id) ?? findNode(node.second, id);
}

/** O que o usuário enxerga do projeto: com uma pane maximizada, só ela é renderizada
 *  (`PaneTree.tsx`) — as outras não contam como vistas. */
function visibleResourceIds(project: Project | null): string[] {
  if (!project) return [];
  const root = project.maximizedPaneId ? findNode(project.layout, project.maximizedPaneId) : null;
  return activeResourceIds(root ?? project.layout);
}

/**
 * Agentes que querem atenção, em qualquer workspace — inclusive nos que não estão abertos.
 *
 * O `answered` do engine é derivado de 1,5s sem saída, então TODO agente ocioso lê "terminou"
 * pra sempre. Sem o mapa de "já visto" abaixo a sidebar ficaria permanentemente acesa e o aviso
 * perderia todo o valor.
 *
 * `paneVisible = false` (Configurações abertas, por exemplo) significa que nenhuma pane está na
 * tela — nada é marcado como visto nesse caso.
 */
export function useAttention(
  sessions: TerminalSession[],
  workspaces: WorkspaceState[],
  activeWorkspaceId: string | null,
  paneVisible = true
): { items: AttentionItem[]; countByWorkspace: Record<string, number> } {
  // ponytail: mapa em memória — recarregar o app rebadgeia tudo que continua pendente, que é o
  // comportamento certo (o usuário não triou nada). Persistir exigiria podar ids mortos e lidar
  // com o `output_seq`, que reinicia em 0 a cada restart do engine.
  const seen = useRef<Record<string, number>>({});

  const sessionById = new Map(sessions.map((session) => [session.id, session]));
  const activeWorkspace = workspaces.find((workspace) => workspace.id === activeWorkspaceId);
  const activeProject =
    activeWorkspace?.projects.find((project) => project.id === activeWorkspace.activeProjectId) ?? null;

  // Gravado durante o render de propósito: num efeito, o cálculo abaixo usaria o valor do poll
  // anterior e o badge piscaria por ~1s no agente que o usuário está olhando agora. A escrita é
  // idempotente, então o render duplo do StrictMode não muda nada.
  if (paneVisible) {
    for (const resourceId of visibleResourceIds(activeProject)) {
      const session = sessionById.get(resourceId);
      if (session) seen.current[resourceId] = session.output_seq;
    }
  }

  const locate = new Map<string, { workspaceId: string; workspaceName: string; projectName: string }>();
  for (const workspace of workspaces) {
    for (const project of workspace.projects) {
      locate.set(project.id, {
        workspaceId: workspace.id,
        workspaceName: workspace.name,
        projectName: project.name,
      });
    }
  }

  const items: AttentionItem[] = [];
  for (const session of sessions) {
    const reason = (session.notice ?? session.state) as AttentionReason;
    if (!ATTENTION_ORDER.includes(reason)) continue;
    // Já visto: nada mudou desde a última vez que essa sessão esteve na tela.
    if (seen.current[session.id] === session.output_seq) continue;
    // Sessão de um projeto que não está em workspace nenhum (projeto fechado, sessão viva no
    // engine) não tem onde ser mostrada.
    const place = locate.get(session.project_id);
    if (!place) continue;
    items.push({
      sessionId: session.id,
      sessionName: session.name,
      reason,
      projectId: session.project_id,
      projectName: place.projectName,
      workspaceId: place.workspaceId,
      workspaceName: place.workspaceName,
    });
  }

  items.sort((a, b) => ATTENTION_ORDER.indexOf(a.reason) - ATTENTION_ORDER.indexOf(b.reason));

  // Derivado dos itens finais: badge e lista nunca podem discordar.
  const countByWorkspace: Record<string, number> = {};
  for (const item of items) {
    countByWorkspace[item.workspaceId] = (countByWorkspace[item.workspaceId] ?? 0) + 1;
  }

  return { items, countByWorkspace };
}
