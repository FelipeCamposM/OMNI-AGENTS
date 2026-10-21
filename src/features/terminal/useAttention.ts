import { useReducer, useRef } from "react";
import type { LayoutNode, Project, WorkspaceState } from "../../types/workspace";
import type { TerminalSession, TerminalState } from "./terminalService";

/** Motivo pelo qual um agente quer atenção. `usage_limit`/`api_error` vêm do `notice` do engine —
 *  são rótulos melhores pro mesmo estado ocioso, não estados novos (ver `notice` no protocolo).
 *  `stopped`/`orphan` ficam de fora: toda sessão encerrada virava aviso, e reabrir o app enchia a
 *  lista de "encerrado" de conversas que ninguém tinha mexido. */
export type AttentionReason =
  | "approval_required"
  | "usage_limit"
  | "api_error"
  | "crashed"
  | "answered";

/** Ordem do Attention Center (spec §11.3): o que bloqueia o agente primeiro, o que é só aviso
 *  depois. Serve de teste de pertinência E de ordenação — uma lista só, nunca duas fora de sincronia. */
export const ATTENTION_ORDER: AttentionReason[] = [
  "approval_required",
  "usage_limit",
  "api_error",
  "crashed",
  "answered",
];

export const ATTENTION_LABEL: Record<AttentionReason, string> = {
  approval_required: "aprovação pendente",
  usage_limit: "limite de uso atingido",
  api_error: "erro de API",
  crashed: "travou",
  answered: "terminou",
};

export interface AttentionItem {
  sessionId: string;
  /** A conversa (ou a própria sessão, num terminal sem conversa). É a unidade do aviso: uma
   *  conversa com dez sessões — o failover abre uma nova a cada troca de conta — é um aviso só. */
  conversationKey: string;
  sessionName: string;
  /** Qual CLI (claude, codex…): o aviso mostra a marca, o nome da conversa sozinho não diz. */
  provider?: string | null;
  reason: AttentionReason;
  state: TerminalState;
  attentionSeq: number;
  /** Quando o aviso aconteceu (ms). Sessões gravadas antes do campo caem na última saída. */
  aconteceuEm?: number;
  projectId: string;
  projectName: string;
  workspaceId: string;
  workspaceName: string;
}

/**
 * O que caracteriza um evento de atenção desta sessão.
 *
 * **Não é `output_seq`.** Esse contador sobe a cada pedaço de saída, e a TUI do Claude redesenha o
 * tempo todo (relógio, rodapé, spinner) — então um aviso já lido voltava sozinho segundos depois,
 * sem nada ter acontecido. Era o bug de "já abri e continua apontando não lido".
 *
 * O engine tem o sinal certo: `attention_seq` sobe **uma vez** por fim de turno de verdade ou
 * diálogo de aprovação (ver `settle`/`append_output` no engine). O motivo entra na assinatura para
 * cobrir o que não mexe nesse contador — limite de uso, erro de API, sessão que travou: trocar de
 * motivo é evento novo e merece aparecer de novo.
 */
function assinatura(session: TerminalSession): string {
  const reason = session.notice ?? session.state;
  // Fim de turno e aprovação são eventos da sessão: o contador diz se é um novo. Limite de uso,
  // erro e travamento valem para a conversa: o failover tenta outra conta a cada 30 s, cada
  // tentativa é uma sessão nova batendo no mesmo limite — e isso não é notícia de novo.
  if (reason === "answered" || reason === "approval_required") return `${session.id}:${session.attention_seq ?? 0}:${reason}`;
  return reason;
}

export function conversationKey(session: Pick<TerminalSession, "id" | "conversation_id">): string {
  return session.conversation_id || session.id;
}

function criadaEm(session: TerminalSession): number {
  return session.created_at_ms ?? (Number(/^terminal-(\d+)/.exec(session.id)?.[1]) || 0);
}

/**
 * Uma sessão por conversa: a que está viva; entre várias, a mais nova. As outras são tentativas
 * antigas (failover, reinício) que pararam e não dizem mais nada sobre a conversa.
 */
export function latestPerConversation(sessions: TerminalSession[]): TerminalSession[] {
  const porConversa = new Map<string, TerminalSession>();
  for (const session of sessions) {
    const key = conversationKey(session);
    const atual = porConversa.get(key);
    const viva = (s: TerminalSession) => (s.state === "stopped" ? 0 : 1);
    if (!atual || viva(session) > viva(atual) || (viva(session) === viva(atual) && criadaEm(session) > criadaEm(atual))) {
      porConversa.set(key, session);
    }
  }
  return sessions.filter((session) => porConversa.get(conversationKey(session)) === session);
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
): {
  items: AttentionItem[];
  all: AttentionItem[];
  dismiss: (sessionId: string) => void;
} {
  // ponytail: mapa em memória — recarregar o app rebadgeia tudo que continua pendente, que é o
  // comportamento certo (o usuário não triou nada). Persistir exigiria podar ids mortos e lidar
  // com sequências que reiniciam em 0 a cada restart do engine.
  const seen = useRef<Record<string, string>>({});

  const [, rerender] = useReducer((n: number) => n + 1, 0);

  const sessionById = new Map(sessions.map((session) => [session.id, session]));
  // O que a conversa está fazendo agora é o que a sessão mais nova dela diz.
  const atual = new Map(latestPerConversation(sessions).map((session) => [conversationKey(session), session]));

  /** O X do Attention Center: marca como visto sem abrir. Volta sozinho no **próximo evento** —
   *  fim de turno, pedido de aprovação ou motivo novo. */
  function dismiss(sessionId: string) {
    const session = sessionById.get(sessionId);
    if (!session) return;
    const key = conversationKey(session);
    seen.current[key] = assinatura(atual.get(key) ?? session);
    rerender();
  }
  const activeWorkspace = workspaces.find((workspace) => workspace.id === activeWorkspaceId);
  const activeProject =
    activeWorkspace?.projects.find((project) => project.id === activeWorkspace.activeProjectId) ?? null;

  // Gravado durante o render de propósito: num efeito, o cálculo abaixo usaria o valor do poll
  // anterior e o badge piscaria por ~1s no agente que o usuário está olhando agora. A escrita é
  // idempotente, então o render duplo do StrictMode não muda nada.
  //
  // Só grava quando a sessão está pedindo algo. Gravar "working" (um redesenho da TUI ao trocar de
  // aba, por exemplo) fazia o aviso já lido voltar sozinho 1,5 s depois, quando o estado retornava
  // a "terminou" — sem evento nenhum novo.
  if (paneVisible) {
    for (const resourceId of visibleResourceIds(activeProject)) {
      const aberta = sessionById.get(resourceId);
      // Abrir qualquer sessão da conversa é ver a conversa: marca a mais nova, que é a que avisa.
      const session = aberta && atual.get(conversationKey(aberta));
      if (session && ATTENTION_ORDER.includes((session.notice ?? session.state) as AttentionReason)) {
        seen.current[conversationKey(session)] = assinatura(session);
      }
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

  // `all` ignora o "já visto": é o que o notificador precisa. Com o filtro, um redesenho do CLI
  // depois de visto trazia o item de volta e soltava toast de um evento antigo.
  const all: AttentionItem[] = [];
  const items: AttentionItem[] = [];
  for (const session of atual.values()) {
    const reason = (session.notice ?? session.state) as AttentionReason;
    if (!ATTENTION_ORDER.includes(reason)) continue;
    // Sessão de um projeto que não está em workspace nenhum (projeto fechado, sessão viva no
    // engine) não tem onde ser mostrada.
    const place = locate.get(session.project_id);
    if (!place) continue;
    const item: AttentionItem = {
      sessionId: session.id,
      conversationKey: conversationKey(session),
      sessionName: session.name,
      provider: session.provider,
      reason,
      state: session.state,
      attentionSeq: session.attention_seq ?? 0,
      aconteceuEm: session.attention_at_ms || session.last_activity_at_ms,
      projectId: session.project_id,
      projectName: place.projectName,
      workspaceId: place.workspaceId,
      workspaceName: place.workspaceName,
    };
    all.push(item);
    // Já visto: nenhum evento novo desde a última vez que essa sessão esteve na tela.
    if (seen.current[conversationKey(session)] !== assinatura(session)) items.push(item);
  }

  items.sort((a, b) => ATTENTION_ORDER.indexOf(a.reason) - ATTENTION_ORDER.indexOf(b.reason));

  return { items, all, dismiss };
}
