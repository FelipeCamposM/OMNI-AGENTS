import { useCallback, useEffect, useState } from "react";
import { iconForPath } from "../features/files/fileIcons";
import { isRemoteProject } from "../features/projects/targetState";
import {
  gitCommit,
  gitPush,
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

  /** `silent`: atualização de fundo — sem "Carregando…" piscando e sem trocar o erro da tela. */
  const refresh = useCallback((silent = false) => {
    if (!projectPath) return;
    if (!silent) {
      setStatus(undefined);
      // Limpa o erro aqui, síncrono, e não no `.then`: quem chama `refresh()` e logo depois reporta
      // uma falha própria (o push que quebrou depois de um commit que deu certo) teria a mensagem
      // apagada quando o status voltasse.
      setError(null);
    }
    gitStatus(projectPath)
      .then(setStatus)
      .catch((reason) => {
        if (!silent) setError(reason instanceof Error ? reason.message : String(reason));
      });
  }, [projectPath]);

  // Quem mexe nos arquivos é quase sempre o agente, não este painel: sem reler sozinho, as mudanças
  // dele nunca apareciam e o painel ficava em "árvore limpa", sem Commit.
  // ponytail: poll de 3s; trocar por watcher do .git se o custo do `git status` pesar em repo grande.
  useEffect(() => {
    refresh();
    // Projeto remoto: cada leitura é um `wsl`/`ssh`, então o ritmo cai.
    const timer = window.setInterval(() => refresh(true), isRemoteProject(projectPath) ? 10_000 : 3_000);
    const onFocus = () => refresh(true);
    window.addEventListener("focus", onFocus);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", onFocus);
    };
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

  /** `push` roda depois do commit e no mesmo try: se o push falhar (sem rede, sem remoto,
   *  rejeitado), o commit já está feito e o erro aparece — nada é desfeito. */
  async function commit(push: boolean) {
    if (!projectPath || !status || !message.trim()) return;
    setBusy(true);
    try {
      // Nada em stage = commita tudo que mudou (como o VS Code). Com stage, respeita a escolha.
      if (!status.entries.some(isStaged)) await gitStage(projectPath, status.entries.map((entry) => entry.path));
      await gitCommit(projectPath, message.trim());
      setMessage("");
      if (push) await gitPush(projectPath);
      refresh();
    } catch (reason) {
      // `refresh()` antes do `setError`: ele limpa o erro de forma síncrona, então reportar
      // depois é o que faz a mensagem sobreviver ao recarregamento do status.
      refresh();
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  }

  if (error) {
    return (
      <div className="px-6 py-1.5 space-y-1">
        <p className="text-danger text-xs">{error}</p>
        <button type="button" onClick={() => refresh()} className="text-[10px] text-text-muted hover:text-text-primary underline">
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

      {staged.length + unstaged.length > 0 && (
        <div className="space-y-1 px-3">
          <textarea
            value={message}
            onChange={(event) => setMessage(event.target.value)}
            placeholder="Mensagem do commit"
            title={staged.length > 0 ? undefined : "Sem nada em stage: o commit leva todas as mudanças"}
            rows={2}
            className="w-full resize-none border border-border-subtle bg-bg-elevated px-2 py-1 text-xs text-text-primary outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
          />
          <div className="flex gap-1">
            <button
              type="button"
              disabled={busy || !message.trim()}
              onClick={() => commit(false)}
              className="flex-1 border border-border-subtle bg-bg-elevated py-1 text-xs text-text-primary hover:bg-overlay/[0.07] disabled:opacity-40"
            >
              Commit
            </button>
            <button
              type="button"
              disabled={busy || !message.trim()}
              onClick={() => commit(true)}
              title={`Commit e push${status.branch ? ` em ${status.branch}` : ""}`}
              className="flex-1 border border-border-subtle bg-bg-elevated py-1 text-xs text-text-primary hover:bg-overlay/[0.07] disabled:opacity-40"
            >
              Commit e push
            </button>
          </div>
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
            {/* Ícone ao lado do status, não no lugar dele: "M" e "??" dizem o que mudou, e isso
                o tipo de arquivo não conta. */}
            <FileIconDoCaminho path={entry.path} />
            {entry.path}
          </button>
        </div>
      ))}
    </div>
  );
}

function FileIconDoCaminho({ path }: { path: string }) {
  const Icone = iconForPath(path);
  return <Icone className="mr-1.5 inline-block h-3 w-3 shrink-0 align-[-2px] text-text-muted" aria-hidden />;
}
