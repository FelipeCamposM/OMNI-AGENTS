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

  useEffect(() => {
    let cancelled = false;
    setContent(null);
    setError(null);
    readTextFile(path, projectPath)
      .then((text) => {
        if (cancelled) return;
        savedContentRef.current = text;
        setContent(text);
      })
      .catch((reason) => {
        if (!cancelled) setError(reason instanceof Error ? reason.message : String(reason));
      });
    return () => {
      cancelled = true;
    };
  }, [path, projectPath]);

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
      markDirty(false);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  }

  function handleChange(value: string | undefined) {
    const text = value ?? "";
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
