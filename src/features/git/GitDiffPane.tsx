import { useEffect, useState } from "react";
import type { WorkspaceTab } from "../../types/workspace";
import { gitDiff } from "./gitService";

interface GitDiffPaneProps {
  projectPath: string;
  tab: WorkspaceTab;
}

/** resourceId no formato "staged::<path>" ou "unstaged::<path>" — ver `GitPanel.onOpenDiff`. */
function parseResourceId(resourceId: string | undefined): { staged: boolean; file: string } | null {
  if (!resourceId) return null;
  const [scope, ...rest] = resourceId.split("::");
  const file = rest.join("::");
  if (!file || (scope !== "staged" && scope !== "unstaged")) return null;
  return { staged: scope === "staged", file };
}

export function GitDiffPane({ projectPath, tab }: GitDiffPaneProps) {
  const target = parseResourceId(tab.resourceId);
  const [diff, setDiff] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!target) return;
    let cancelled = false;
    gitDiff(projectPath, target.file, target.staged)
      .then((text) => { if (!cancelled) setDiff(text); })
      .catch((reason) => { if (!cancelled) setError(reason instanceof Error ? reason.message : String(reason)); });
    return () => { cancelled = true; };
  }, [projectPath, target?.file, target?.staged]);

  if (!target) return <div className="p-4 text-xs text-danger">Diff inválido.</div>;
  if (error) return <div role="alert" className="p-4 text-xs text-danger">{error}</div>;
  if (diff === null) return <div className="p-4 text-xs text-text-muted">Carregando…</div>;
  if (!diff) return <div className="p-4 text-xs text-text-muted">Sem diferenças.</div>;

  return (
    <pre className="h-full overflow-auto p-4 font-mono text-xs leading-relaxed">
      {diff.split("\n").map((line, index) => (
        <span
          key={index}
          className={[
            "block whitespace-pre-wrap",
            line.startsWith("+") && !line.startsWith("+++") ? "text-success" : "",
            line.startsWith("-") && !line.startsWith("---") ? "text-danger" : "",
            line.startsWith("@@") ? "text-accent" : "",
          ].join(" ")}
        >
          {line || " "}
        </span>
      ))}
    </pre>
  );
}
