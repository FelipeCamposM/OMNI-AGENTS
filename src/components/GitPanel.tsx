import { useCallback, useEffect, useState } from "react";
import {
  gitCommit,
  gitStage,
  gitStatus,
  gitUnstage,
  isStaged,
  isUnstaged,
  type GitStatus,
  type GitStatusEntry,
} from "../features/git/gitService";

interface GitPanelProps {
  projectPath: string | null;
  onOpenDiff: (file: string, staged: boolean) => void;
  onOpenGraph: () => void;
}

/** Painel Git do projeto: status/stage/commit. O grafo (branches/merges) abre numa aba própria
 * via `onOpenGraph` — não cabe direito na largura da sidebar. */
export function GitPanel({ projectPath, onOpenDiff, onOpenGraph }: GitPanelProps) {
  // undefined = carregando; null = sem repositório git (normal, não é erro); GitStatus = carregado.
  const [status, setStatus] = useState<GitStatus | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(() => {
    if (!projectPath) return;
    setStatus(undefined);
    gitStatus(projectPath)
      .then((next) => {
        setStatus(next);
        setError(null);
      })
      .catch((reason) => setError(reason instanceof Error ? reason.message : String(reason)));
  }, [projectPath]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  if (!projectPath) return null;

  async function toggleStage(entry: GitStatusEntry, stage: boolean) {
    if (!projectPath) return;
    setBusy(true);
    try {
      if (stage) await gitStage(projectPath, [entry.path]);
      else await gitUnstage(projectPath, [entry.path]);
      refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  }

  async function commit() {
    if (!projectPath || !message.trim()) return;
    setBusy(true);
    try {
      await gitCommit(projectPath, message.trim());
      setMessage("");
      refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  }

  if (error) {
    return (
      <div className="px-6 py-1.5 space-y-1">
        <p className="text-danger text-xs">{error}</p>
        <button type="button" onClick={refresh} className="text-[10px] text-text-muted hover:text-text-primary underline">
          tentar de novo
        </button>
      </div>
    );
  }
  if (status === undefined) return <p className="text-text-muted text-xs px-6 py-1.5">Carregando…</p>;
  if (status === null) {
    return <p className="text-text-muted text-xs px-6 py-1.5">Nenhum repositório Git neste projeto.</p>;
  }

  const staged = status.entries.filter(isStaged);
  const unstaged = status.entries.filter((entry) => isUnstaged(entry) && !isStaged(entry));

  return (
    <div className="space-y-2 px-3 pb-2">
      <div className="flex items-center justify-between px-3 pt-0.5">
        <span className="text-[10px] text-text-muted truncate" title={status.branch}>⎇ {status.branch}</span>
        <button type="button" onClick={onOpenGraph} className="text-[10px] text-accent hover:underline shrink-0">
          Ver grafo
        </button>
      </div>

      {staged.length === 0 && unstaged.length === 0 && (
        <p className="text-text-muted text-xs px-3 py-1">Nada pra ver — árvore limpa.</p>
      )}

      {staged.length > 0 && (
        <GitFileGroup
          label="Staged"
          entries={staged}
          onToggle={(entry) => toggleStage(entry, false)}
          onOpenDiff={(entry) => onOpenDiff(entry.path, true)}
          busy={busy}
        />
      )}
      {unstaged.length > 0 && (
        <GitFileGroup
          label="Changes"
          entries={unstaged}
          onToggle={(entry) => toggleStage(entry, true)}
          onOpenDiff={(entry) => onOpenDiff(entry.path, false)}
          busy={busy}
        />
      )}

      {staged.length > 0 && (
        <div className="space-y-1 px-3">
          <textarea
            value={message}
            onChange={(event) => setMessage(event.target.value)}
            placeholder="Mensagem do commit"
            rows={2}
            className="w-full resize-none border border-border-subtle bg-bg-elevated px-2 py-1 text-xs text-text-primary outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
          />
          <button
            type="button"
            disabled={busy || !message.trim()}
            onClick={commit}
            className="w-full border border-border-subtle bg-bg-elevated py-1 text-xs text-text-primary hover:bg-overlay/[0.07] disabled:opacity-40"
          >
            Commit
          </button>
        </div>
      )}
    </div>
  );
}

function GitFileGroup({
  label,
  entries,
  onToggle,
  onOpenDiff,
  busy,
}: {
  label: string;
  entries: GitStatusEntry[];
  onToggle: (entry: GitStatusEntry) => void;
  onOpenDiff: (entry: GitStatusEntry) => void;
  busy: boolean;
}) {
  return (
    <div className="space-y-0.5">
      <p className="px-3 text-[10px] uppercase tracking-wider text-text-muted">{label} ({entries.length})</p>
      {entries.map((entry) => (
        <div key={`${entry.x}${entry.y}:${entry.path}`} className="group flex items-stretch pl-4">
          <button
            type="button"
            disabled={busy}
            title={label === "Staged" ? "Unstage" : "Stage"}
            onClick={() => onToggle(entry)}
            className="w-6 shrink-0 text-text-muted hover:text-accent disabled:opacity-40"
          >
            {label === "Staged" ? "−" : "+"}
          </button>
          <button
            type="button"
            onClick={() => onOpenDiff(entry)}
            className="min-w-0 flex-1 py-1.5 text-left text-xs text-text-secondary hover:text-text-primary truncate"
            title={entry.path}
          >
            <span className="mr-1.5 font-mono text-[10px] text-text-muted" aria-hidden="true">
              {entry.x === "?" ? "??" : `${entry.x}${entry.y}`}
            </span>
            {entry.path}
          </button>
        </div>
      ))}
    </div>
  );
}
