import { useEffect, useMemo, useRef, useState } from "react";
import { matchesShortcut } from "../../lib/shortcuts";
import { iconForEntry } from "./fileIcons";
import { baseName, dirName, listAllFiles, resolveIgnoreList, type FileEntry } from "./filesService";

const MAX_RESULTS = 50;

/** Pontuação fuzzy estilo Ctrl+P do VS Code: as letras da busca precisam aparecer em ordem no
 * caminho; sequência contínua, início de segmento e acerto no nome do arquivo valem mais.
 * `null` = não casa. */
export function fuzzyScore(query: string, target: string): number | null {
  const q = query.toLowerCase().replace(/\s+/g, "");
  if (!q) return 0;
  const t = target.toLowerCase();
  let score = 0;
  let from = 0;
  let streak = 0;
  for (const char of q) {
    const found = t.indexOf(char, from);
    if (found === -1) return null;
    streak = found === from && from > 0 ? streak + 1 : 0;
    const boundary = found === 0 || "/\\._- ".includes(t[found - 1]);
    score += 1 + streak * 2 + (boundary ? 3 : 0);
    from = found + 1;
  }
  const name = baseName(t);
  if (name.includes(q)) score += name.startsWith(q) ? 30 : 20;
  // Desempate: caminho mais curto primeiro.
  return score - t.length / 1000;
}

interface QuickOpenProps {
  projectPath: string | null;
  onOpenFile: (path: string) => void;
}

/** Ctrl+P: busca arquivo por nome no projeto ativo. Escuta em captura na `window` pra funcionar
 * até com o foco no terminal (igual o VS Code) — o xterm nunca recebe o ^P. */
export function QuickOpen({ projectPath, onOpenFile }: QuickOpenProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [files, setFiles] = useState<FileEntry[] | null>(null);
  const [selected, setSelected] = useState(0);
  const listRef = useRef<HTMLUListElement>(null);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (!matchesShortcut(event, "quickOpen")) return;
      if (!projectPath) return;
      event.preventDefault();
      event.stopPropagation();
      setOpen(true);
    }
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [projectPath]);

  // Índice refeito a cada abertura: sempre reflete o disco, sem cache pra invalidar.
  useEffect(() => {
    if (!open || !projectPath) return;
    let cancelled = false;
    setQuery("");
    setSelected(0);
    setFiles(null);
    void resolveIgnoreList(projectPath)
      .then((ignoreList) => listAllFiles(projectPath, ignoreList))
      .catch(() => [])
      .then((all) => {
        if (!cancelled) setFiles(all);
      });
    return () => {
      cancelled = true;
    };
  }, [open, projectPath]);

  const results = useMemo(() => {
    if (!files || !projectPath) return [];
    const withRelative = files.map((file) => ({ file, relative: file.path.slice(projectPath.length).replace(/^[\\/]/, "") }));
    if (!query.trim()) return withRelative.slice(0, MAX_RESULTS);
    return withRelative
      .map((item) => ({ ...item, score: fuzzyScore(query, item.relative) }))
      .filter((item): item is typeof item & { score: number } => item.score !== null)
      .sort((a, b) => b.score - a.score)
      .slice(0, MAX_RESULTS);
  }, [files, projectPath, query]);

  useEffect(() => {
    listRef.current?.children[selected]?.scrollIntoView?.({ block: "nearest" });
  }, [selected]);

  if (!open) return null;

  function choose(path: string | undefined) {
    if (!path) return;
    setOpen(false);
    onOpenFile(path);
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-center bg-black/30 px-4 pt-[12vh]" onPointerDown={() => setOpen(false)}>
      <div
        role="dialog"
        aria-label="Buscar arquivo"
        className="popover flex h-fit max-h-[60vh] w-full max-w-xl flex-col p-1"
        onPointerDown={(event) => event.stopPropagation()}
      >
        <input
          autoFocus
          value={query}
          placeholder="Buscar arquivo pelo nome"
          aria-label="Buscar arquivo pelo nome"
          className="field !py-1.5 px-2.5 text-xs"
          onChange={(event) => {
            setQuery(event.target.value);
            setSelected(0);
          }}
          onKeyDown={(event) => {
            if (event.key === "Escape") setOpen(false);
            else if (event.key === "Enter") choose(results[selected]?.file.path);
            else if (event.key === "ArrowDown") setSelected((index) => Math.min(index + 1, results.length - 1));
            else if (event.key === "ArrowUp") setSelected((index) => Math.max(index - 1, 0));
            else return;
            event.preventDefault();
          }}
        />
        {files === null ? (
          <p className="px-2.5 py-2 text-xs text-text-muted">Indexando arquivos…</p>
        ) : results.length === 0 ? (
          <p className="px-2.5 py-2 text-xs text-text-muted">Nenhum arquivo encontrado</p>
        ) : (
          <ul ref={listRef} role="listbox" className="mt-1 min-h-0 overflow-y-auto">
            {results.map(({ file, relative }, index) => {
              const Icon = iconForEntry(file.name, false);
              const folder = relative === file.name ? "" : dirName(relative);
              return (
                <li
                  key={file.path}
                  role="option"
                  aria-selected={index === selected}
                  onPointerMove={() => setSelected(index)}
                  onClick={() => choose(file.path)}
                  className={[
                    "flex cursor-default items-center gap-1.5 truncate px-2.5 py-1 text-xs",
                    index === selected ? "bg-accent-muted text-text-primary" : "text-text-secondary",
                  ].join(" ")}
                  title={file.path}
                >
                  <Icon className="h-3 w-3 shrink-0" aria-hidden />
                  <span className="shrink-0">{file.name}</span>
                  <span className="truncate text-text-muted">{folder}</span>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
