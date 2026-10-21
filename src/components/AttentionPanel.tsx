import { CloseIcon } from "./ui/PixelIcon";
import { AgentIcon } from "./ui/AgentIcon";
import { NOME_DO_AGENTE } from "../mobile/api";
import { ATTENTION_LABEL, type AttentionItem, type AttentionReason } from "../features/terminal/useAttention";
import { EtiquetaDoStatus, haQuantoTempo, IconeDoStatus, rotuloDoStatus, seloDoStatus, type ConversaStatus } from "./ConversaStatus";

/** Motivo do engine → status da conversa, o mesmo vocabulário da lista de agentes. */
const STATUS: Record<AttentionReason, ConversaStatus> = {
  approval_required: "aprovacao",
  usage_limit: "interrompido",
  api_error: "interrompido",
  crashed: "interrompido",
  answered: "finalizado",
};

/** O detalhe que o status não diz: por que foi interrompido. */
const DETALHE: Partial<Record<AttentionReason, string>> = {
  usage_limit: "limite de uso",
  api_error: "erro de API",
  crashed: "travou",
};

const agenteDe = (item: AttentionItem) => (item.provider ? `${NOME_DO_AGENTE[item.provider] ?? item.provider} · ` : "");

const RESUMO: ConversaStatus[] = ["aprovacao", "interrompido", "finalizado"];

/** Um selo por tipo (ícone + quantos) em vez de um número vermelho só: dá para ver de longe se é
 *  aprovação. Usado no topo da Atenção e em cada workspace da lateral. */
export function SelosDeAtencao({ items, onde }: { items: AttentionItem[]; onde: string }) {
  if (items.length === 0) return null;
  const porStatus = new Map<ConversaStatus, number>();
  for (const item of items) porStatus.set(STATUS[item.reason], (porStatus.get(STATUS[item.reason]) ?? 0) + 1);
  return (
    <span role="img" aria-label={`${items.length} ${items.length === 1 ? "agente esperando" : "agentes esperando"} ${onde}`}
      className="flex shrink-0 items-center gap-1">
      {RESUMO.filter((status) => porStatus.has(status)).map((status) => (
        <span key={status} title={rotuloDoStatus(status)}
          className={`flex h-4 items-center gap-0.5 border px-1 text-[10px] font-bold leading-none ${seloDoStatus(status)}`}>
          <IconeDoStatus status={status} className="!h-2.5 !w-2.5" />
          {porStatus.get(status)}
        </span>
      ))}
    </span>
  );
}

/**
 * Attention Center (spec §11.3) na sidebar: o único lugar do app que mostra agentes de TODOS os
 * workspaces, inclusive os que não estão abertos. Fica como primeiro filho do `<nav>`, e não como
 * `SidebarSection`, porque aquelas seções são desabilitadas sem projeto ativo — e um agente de
 * outro workspace pedindo aprovação tem de aparecer justamente quando você não está nele.
 */
export function AttentionPanel({
  items,
  agora,
  onFocusSession,
  onDismiss,
}: {
  items: AttentionItem[];
  agora: number;
  onFocusSession: (item: AttentionItem) => void;
  onDismiss: (item: AttentionItem) => void;
}) {
  if (items.length === 0) return null;

  return (
    <div className="space-y-0.5">
      <div className="flex items-center justify-between gap-2 px-3 pt-1">
        <p className="text-text-muted text-[10px] font-medium uppercase tracking-wider">Atenção</p>
        <SelosDeAtencao items={items} onde="no total" />
      </div>
      {items.map((item) => {
        const status = STATUS[item.reason];
        const detalhe = DETALHE[item.reason];
        return (
          <div key={item.sessionId} className="group relative">
          <button
            type="button"
            data-nav-item
            onClick={() => onFocusSession(item)}
            title={`${agenteDe(item)}${item.workspaceName} · ${item.projectName} · ${item.sessionName} — ${ATTENTION_LABEL[item.reason]}`}
            className="glass-hover flex w-full items-center gap-2 py-1.5 pl-3 pr-7 text-left rounded-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
          >
            <span className={`grid h-6 w-6 shrink-0 place-items-center border ${seloDoStatus(status)}`}>
              <IconeDoStatus status={status} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="flex min-w-0 items-center gap-2">
                <AgentIcon provider={item.provider} className="h-3 w-3 shrink-0" />
                <span className="min-w-0 flex-1 truncate text-xs text-text-secondary">{item.sessionName}</span>
                {/* O X de dispensar aparece no mesmo canto no hover. */}
                <EtiquetaDoStatus status={status} className="group-hover:invisible" />
              </span>
              <span className="mt-0.5 flex min-w-0 gap-2 text-[10px] text-text-muted">
                <span className="min-w-0 flex-1 truncate">
                  {item.workspaceName} · {item.projectName}{detalhe ? ` · ${detalhe}` : ""}
                </span>
                {item.aconteceuEm ? (
                  <time className="shrink-0" dateTime={new Date(item.aconteceuEm).toISOString()}
                    title={new Date(item.aconteceuEm).toLocaleString("pt-BR")}>
                    {haQuantoTempo(item.aconteceuEm, agora) === "agora" ? "agora" : `há ${haQuantoTempo(item.aconteceuEm, agora)}`}
                  </time>
                ) : null}
              </span>
            </span>
          </button>
          <button
            type="button"
            onClick={() => onDismiss(item)}
            aria-label={`Dispensar aviso de ${item.sessionName}`}
            title="Dispensar aviso"
            className="absolute right-1.5 top-1/2 -translate-y-1/2 grid h-5 w-5 place-items-center text-text-muted opacity-0 transition-opacity hover:text-text-primary focus-visible:opacity-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent group-hover:opacity-100"
          >
            <CloseIcon className="h-3 w-3" aria-hidden="true" />
          </button>
          </div>
        );
      })}
    </div>
  );
}
