import type { LayoutNode, PaneNode, WorkspaceState, WorkspaceTab } from "../../types/workspace";
import type { TerminalSession } from "../terminal/terminalService";
import { latestPerConversation } from "../terminal/useAttention";

/** Aba que não é sessão (arquivo, markdown, git, kanban, agente ainda sem CLI escolhida): as com
 *  sessão viram nó de agente/terminal. */
export interface AbaAberta { tab: WorkspaceTab; paneId: string }

/** Um projeto aberto: a "ilha" do canvas com tudo o que roda nele. */
export interface Ilha {
  workspaceId: string;
  projectId: string;
  nome: string;
  caminho: string;
  branch: string | null;
  ativo: boolean;
  agentes: TerminalSession[];
  terminais: TerminalSession[];
  abas: AbaAberta[];
}

export interface Regiao { workspace: WorkspaceState; ativo: boolean; ilhas: Ilha[] }

export interface Panorama {
  regioes: Regiao[];
  /** Sessões vivas de projeto que não está aberto em nenhum workspace. */
  soltas: TerminalSession[];
  totais: { workspaces: number; projetos: number; agentes: number; trabalhando: number; pedindo: number; terminais: number; abas: number };
}

function panes(node: LayoutNode): PaneNode[] {
  return node.type === "pane" ? [node] : [...panes(node.first), ...panes(node.second)];
}

/** "Pedindo você": terminou o turno ou quer aprovação. */
export const pedeAtencao = (s: TerminalSession) => s.state === "approval_required" || s.state === "answered";

export function montarPanorama(workspaces: WorkspaceState[], activeWorkspaceId: string | null, sessions: TerminalSession[]): Panorama {
  // Rodando sem aba: uma por conversa (o failover abre várias) e sem as encerradas.
  const vivas = latestPerConversation(sessions).filter((s) => s.state !== "stopped");
  const porId = new Map(sessions.map((s) => [s.id, s]));
  const conversa = (s: TerminalSession) => s.conversation_id ?? s.id;
  const usadas = new Set<string>();

  const regioes = workspaces.map((workspace) => ({
    workspace,
    ativo: workspace.id === activeWorkspaceId,
    ilhas: workspace.projects.map((project): Ilha => {
      // Toda aba de agente/terminal aberta aparece, em qualquer estado (conversa parada continua aberta).
      const emAba = panes(project.layout).flatMap((pane) => pane.tabs.flatMap((tab) => {
        const s = tab.resourceId ? porId.get(tab.resourceId) : undefined;
        return s ? [s] : [];
      }));
      const conversas = new Set(emAba.map(conversa));
      const doProjeto = [...new Map([...emAba, ...vivas.filter((s) => s.project_id === project.id && !conversas.has(conversa(s)))].map((s) => [s.id, s])).values()];
      doProjeto.forEach((s) => { usadas.add(s.id); usadas.add(conversa(s)); });
      return {
        workspaceId: workspace.id,
        projectId: project.id,
        nome: project.name,
        caminho: project.path,
        branch: project.branch,
        ativo: workspace.id === activeWorkspaceId && workspace.activeProjectId === project.id,
        agentes: doProjeto.filter((s) => s.provider),
        terminais: doProjeto.filter((s) => !s.provider),
        abas: panes(project.layout).flatMap((pane) => pane.tabs
          .filter((tab) => !(tab.resourceId && porId.has(tab.resourceId)))
          .map((tab) => ({ tab, paneId: pane.id }))),
      };
    }),
  }));

  const ilhas = regioes.flatMap((r) => r.ilhas);
  const soltas = vivas.filter((s) => !usadas.has(s.id) && !usadas.has(conversa(s)));
  const sessoes = [...ilhas.flatMap((i) => [...i.agentes, ...i.terminais]), ...soltas];
  return {
    regioes,
    soltas,
    totais: {
      workspaces: workspaces.length,
      projetos: ilhas.length,
      agentes: sessoes.filter((s) => s.provider).length,
      trabalhando: sessoes.filter((s) => s.state === "working").length,
      pedindo: sessoes.filter(pedeAtencao).length,
      terminais: sessoes.filter((s) => !s.provider).length,
      abas: ilhas.reduce((n, i) => n + i.abas.length, 0),
    },
  };
}
