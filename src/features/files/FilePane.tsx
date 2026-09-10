import "./monacoSetup";
import Editor, { type OnMount } from "@monaco-editor/react";
import { useEffect, useRef, useState } from "react";
import type { WorkspaceTab } from "../../types/workspace";
import { readTextFile, writeTextFile } from "./filesService";

const LANGUAGE_BY_EXTENSION: Record<string, string> = {
  ts: "typescript",
  tsx: "typescript",
  js: "javascript",
  jsx: "javascript",
  json: "json",
  md: "markdown",
  markdown: "markdown",
  css: "css",
  scss: "css",
  html: "html",
  rs: "rust",
  py: "python",
  toml: "ini",
  yaml: "yaml",
  yml: "yaml",
  sh: "shell",
  bash: "shell",
  sql: "sql",
};

function languageFor(path: string): string {
  const extension = path.split(".").pop()?.toLowerCase() ?? "";
  return LANGUAGE_BY_EXTENSION[extension] ?? "plaintext";
}

const AUTO_SAVE_DELAY_MS = 1500;

interface FileDraft {
  text: string;
  saved: string;
  listeners: Set<() => void>;
}
// Moving a tab retains its object, even when React remounts the destination pane.
// Weak keys release drafts when their tabs are closed.
const drafts = new WeakMap<WorkspaceTab, FileDraft>();

interface FilePaneProps {
  projectPath: string;
  tab: WorkspaceTab;
  saveMode: "auto" | "manual";
  onDirtyChange: (tabId: string, dirty: boolean) => void;
}

export function FilePane({ projectPath, tab, saveMode, onDirtyChange }: FilePaneProps) {
  const path = tab.resourceId ?? "";
  const [content, setContent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const dirtyRef = useRef(false);
  const savedContentRef = useRef("");
  const autoSaveTimerRef = useRef<number | undefined>(undefined);
  const draftRef = useRef<FileDraft | undefined>(drafts.get(tab));

  useEffect(() => {
    const draft = drafts.get(tab);
    if (!draft) return;
    const update = () => onDirtyChange(tab.id, draft.text !== draft.saved);
    draft.listeners.add(update);
    update();
    return () => { draft.listeners.delete(update); };
  }, [tab, content, onDirtyChange]);

  useEffect(() => {
    let cancelled = false;
    setContent(null);
    setError(null);
    const existing = drafts.get(tab);
    if (existing && existing.text !== existing.saved) {
      draftRef.current = existing;
      savedContentRef.current = existing.saved;
      dirtyRef.current = true;
      setContent(existing.text);
      if (saveMode === "auto") {
        autoSaveTimerRef.current = window.setTimeout(() => void save(existing.text), AUTO_SAVE_DELAY_MS);
      }
      return () => window.clearTimeout(autoSaveTimerRef.current);
    }
    readTextFile(path, projectPath)
      .then((text) => {
        if (cancelled) return;
        savedContentRef.current = text;
        const draft = { text, saved: text, listeners: new Set<() => void>() };
        drafts.set(tab, draft);
        draftRef.current = draft;
        setContent(text);
      })
      .catch((reason) => {
        if (!cancelled) setError(reason instanceof Error ? reason.message : String(reason));
      });
    return () => {
      cancelled = true;
    };
  }, [path, projectPath, tab]);

  useEffect(() => () => window.clearTimeout(autoSaveTimerRef.current), []);

  function markDirty(next: boolean) {
    if (dirtyRef.current === next) return;
    dirtyRef.current = next;
    onDirtyChange(tab.id, next);
  }

  async function save(text: string) {
    try {
      await writeTextFile(path, projectPath, text);
      savedContentRef.current = text;
      const draft = draftRef.current;
      if (draft) {
        draft.saved = text;
        draft.listeners.forEach((listener) => listener());
      }
      markDirty(draft ? draft.text !== text : false);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  }

  function handleChange(value: string | undefined) {
    const text = value ?? "";
    if (draftRef.current) draftRef.current.text = text;
    markDirty(text !== savedContentRef.current);
    if (saveMode === "auto") {
      window.clearTimeout(autoSaveTimerRef.current);
      autoSaveTimerRef.current = window.setTimeout(() => void save(text), AUTO_SAVE_DELAY_MS);
    }
  }

  const handleMount: OnMount = (editor, monacoInstance) => {
    // Ctrl+S/Cmd+S salva na hora nos dois modos — auto-save não impede o atalho.
    editor.addCommand(monacoInstance.KeyMod.CtrlCmd | monacoInstance.KeyCode.KeyS, () => void save(editor.getValue()));
  };

  if (error) {
    return (
      <div role="alert" className="p-4 text-xs text-danger">
        {error}
      </div>
    );
  }
  if (content === null) {
    return <div className="p-4 text-xs text-text-muted">Carregando…</div>;
  }

  return (
    <Editor
      height="100%"
      language={languageFor(path)}
      defaultValue={content}
      onChange={handleChange}
      onMount={handleMount}
      theme="vs-dark"
      options={{ minimap: { enabled: false }, fontSize: 13, automaticLayout: true }}
    />
  );
}
