import { AlertIcon, CircleIcon, CloseIcon, WarningIcon, ZapOffIcon } from "./ui/PixelIcon";
import { ATTENTION_LABEL, type AttentionItem, type AttentionReason } from "../features/terminal/useAttention";

const REASON_ICON: Record<
  AttentionReason,
  { icon: React.ComponentType<{ className?: string; "aria-hidden"?: boolean }>; className: string }
> = {
  approval_required: { icon: AlertIcon, className: "text-warning" },
  usage_limit: { icon: WarningIcon, className: "text-warning" },
  api_error: { icon: ZapOffIcon, className: "text-danger" },
  crashed: { icon: ZapOffIcon, className: "text-danger" },
  orphan: { icon: WarningIcon, className: "text-text-muted" },
  answered: { icon: CircleIcon, className: "text-accent" },
  stopped: { icon: CircleIcon, className: "text-text-muted" },
};

/**
 * Attention Center (spec §11.3) na sidebar: o único lugar do app que mostra agentes de TODOS os
 * workspaces, inclusive os que não estão abertos. Fica como primeiro filho do `<nav>`, e não como
 * `SidebarSection`, porque aquelas seções são desabilitadas sem projeto ativo — e um agente de
 * outro workspace pedindo aprovação tem de aparecer justamente quando você não está nele.
 */
export function AttentionPanel({
  items,
  onFocusSession,
  onDismiss,
}: {
  items: AttentionItem[];
  onFocusSession: (item: AttentionItem) => void;
  onDismiss: (item: AttentionItem) => void;
}) {
  if (items.length === 0) return null;

  return (
    <div className="space-y-0.5">
      <div className="flex items-center justify-between px-3 pt-1">
        <p className="text-text-muted text-[10px] font-medium uppercase tracking-wider">Atenção</p>
        <span
          aria-label={`${items.length} ${items.length === 1 ? "agente esperando" : "agentes esperando"} no total`}
          className="badge-pulse grid h-4 min-w-4 place-items-center bg-danger px-1 text-[10px] font-bold leading-none text-bg-primary"
        >
          {items.length > 9 ? "9+" : items.length}
        </span>
      </div>
      {items.map((item) => {
        const { icon: Icon, className } = REASON_ICON[item.reason];
        return (
          <div key={item.sessionId} className="group relative">
          <button
            type="button"
            data-nav-item
            onClick={() => onFocusSession(item)}
            title={`${item.workspaceName} · ${item.projectName} · ${item.sessionName} — ${ATTENTION_LABEL[item.reason]}`}
            className="glass-hover w-full py-1.5 pl-3 pr-7 text-left rounded-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
          >
            <span className="flex min-w-0 items-center gap-2">
              <Icon className={`h-3 w-3 shrink-0 ${className}`} aria-hidden />
              <span className="min-w-0 flex-1 truncate text-xs text-text-secondary">{item.sessionName}</span>
            </span>
            <span className="mt-0.5 block truncate pl-5 text-[10px] text-text-muted">
              {item.workspaceName} · {item.projectName} · {ATTENTION_LABEL[item.reason]}
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
