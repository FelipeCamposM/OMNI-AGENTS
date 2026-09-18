import { useCallback, useEffect, useRef, useState } from "react";
import { usePoll } from "../../mobile/usePoll";
import { isRemoteProject } from "../projects/targetState";
import { listDir, resolveIgnoreList, type FileEntry } from "./filesService";

function sameEntries(a: FileEntry[] | undefined, b: FileEntry[]): boolean {
  return a?.length === b.length && a.every((entry, index) => entry.path === b[index].path && entry.isDirectory === b[index].isDirectory);
}

export function useFileTree(projectPath: string | null) {
  const [ignoreList, setIgnoreList] = useState<string[]>([]);
  const [root, setRoot] = useState<FileEntry[]>([]);
  const [children, setChildren] = useState<Map<string, FileEntry[]>>(new Map());
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const loadingRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    setRoot([]);
    setChildren(new Map());
    setExpanded(new Set());
    if (!projectPath) return;
    let cancelled = false;
    void resolveIgnoreList(projectPath).then(async (list) => {
      if (cancelled) return;
      setIgnoreList(list);
      const entries = await listDir(projectPath, "", list);
      if (!cancelled) setRoot(entries);
    });
    return () => {
      cancelled = true;
    };
  }, [projectPath]);

  const toggle = useCallback(
    (entry: FileEntry) => {
      if (!projectPath || !entry.isDirectory) return;
      setExpanded((previous) => {
        const next = new Set(previous);
        if (next.has(entry.path)) {
          next.delete(entry.path);
          return next;
        }
        next.add(entry.path);
        if (!children.has(entry.path) && !loadingRef.current.has(entry.path)) {
          loadingRef.current.add(entry.path);
          const relative = entry.path.slice(projectPath.length).replace(/^[\\/]/, "");
          void listDir(projectPath, relative, ignoreList).then((list) => {
            loadingRef.current.delete(entry.path);
            setChildren((previousChildren) => new Map(previousChildren).set(entry.path, list));
          });
        }
        return next;
      });
    },
    [projectPath, children, ignoreList]
  );

  /** Recarrega uma pasta específica (raiz ou já expandida) depois de criar,
   * renomear, mover ou excluir algo nela. */
  const refreshDir = useCallback(
    async (absoluteDirPath: string) => {
      if (!projectPath) return;
      const relative = absoluteDirPath === projectPath ? "" : absoluteDirPath.slice(projectPath.length).replace(/^[\\/]/, "");
      const list = await listDir(projectPath, relative, ignoreList);
      // Igual ao anterior não troca o estado — o poll abaixo não re-renderiza a árvore à toa.
      if (absoluteDirPath === projectPath) {
        setRoot((previous) => (sameEntries(previous, list) ? previous : list));
      } else {
        setChildren((previous) =>
          sameEntries(previous.get(absoluteDirPath), list) ? previous : new Map(previous).set(absoluteDirPath, list)
        );
      }
    },
    [projectPath, ignoreList]
  );

  // Arquivo criado fora da árvore (agente no terminal, editor externo) não aparecia até reabrir
  // o projeto. Relê a raiz e as pastas abertas no mesmo ritmo do resto dos polls.
  // ponytail: poll em vez de `watch` do plugin-fs (feature extra + permissão); trocar se 5s incomodar.
  usePoll(
    async () => {
      if (!projectPath || ignoreList.length === 0) return;
      await Promise.all([projectPath, ...expanded].map((dir) => refreshDir(dir).catch(() => undefined)));
    },
    () => undefined,
    [projectPath, ignoreList, expanded, refreshDir],
    // Cada tick relê a raiz e toda pasta aberta. Pela rede (WSL/SSHFS) isso é caro, então o ritmo
    // cai — o agente que mexe nos arquivos avisa pela própria saída, não por este poll.
    isRemoteProject(projectPath) ? 15_000 : undefined
  );

  return { root, children, expanded, toggle, refreshDir };
}
