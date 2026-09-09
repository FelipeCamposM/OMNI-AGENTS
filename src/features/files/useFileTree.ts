import { useCallback, useEffect, useRef, useState } from "react";
import { listDir, resolveIgnoreList, type FileEntry } from "./filesService";

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
      if (absoluteDirPath === projectPath) {
        setRoot(list);
      } else {
        setChildren((previous) => new Map(previous).set(absoluteDirPath, list));
      }
    },
    [projectPath, ignoreList]
  );

  return { root, children, expanded, toggle, refreshDir };
}
