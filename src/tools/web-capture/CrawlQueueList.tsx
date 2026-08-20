import { useStagger } from "../../lib/motion";
import type { CrawlPageEvent } from "../../hooks/useCaptureEvents";

/**
 * Lista ao vivo das páginas concluídas durante o crawl — uma linha por
 * `capture-page-event`. Estilo copiado de `StatusDot`/`FileQueue`, componente
 * próprio porque a linha não representa um `FileItem`.
 */
export function CrawlQueueList({ paginas }: { paginas: CrawlPageEvent[] }) {
  const listRef = useStagger<HTMLUListElement>("li", [paginas.length]);

  if (paginas.length === 0) return null;

  return (
    <div className="glass overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-3 border-b border-border-subtle bg-overlay/[0.06]">
        <p className="text-text-primary text-sm font-medium">
          {paginas.length} de {paginas[paginas.length - 1]?.total ?? paginas.length} páginas
        </p>
      </div>
      <ul ref={listRef} className="divide-y divide-border-subtle max-h-64 overflow-y-auto">
        {paginas.map((p, i) => (
          <li key={`${p.url}-${i}`} className="flex items-center gap-3 px-4 py-2.5">
            <StatusDot status={p.status} />
            <div className="flex-1 min-w-0">
              <p className="text-text-primary text-xs truncate" title={p.url}>
                {p.url}
              </p>
              {p.status === "erro" && p.error && (
                <p className="text-danger text-[11px] truncate">{p.error}</p>
              )}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

function StatusDot({ status }: { status: CrawlPageEvent["status"] }) {
  const colors: Record<CrawlPageEvent["status"], string> = {
    ok: "bg-success",
    erro: "bg-danger",
  };
  return <span className={`w-2 h-2 rounded-full shrink-0 ${colors[status]}`} aria-hidden="true" />;
}
