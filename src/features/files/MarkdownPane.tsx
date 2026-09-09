import ReactMarkdown from "react-markdown";
import rehypeSanitize from "rehype-sanitize";
import remarkGfm from "remark-gfm";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "../../components/ui";
import type { WorkspaceTab } from "../../types/workspace";
import { FilePane } from "./FilePane";
import { fileMtime, readTextFile } from "./filesService";

const POLL_INTERVAL_MS = 1_000;

interface MarkdownPaneProps {
  projectPath: string;
  tab: WorkspaceTab;
  fileSaveMode: "auto" | "manual";
  onDirtyChange: (tabId: string, dirty: boolean) => void;
}

type ViewMode = "app" | "document";

/** Reload automático quando o arquivo muda por fora, reaproveitando o mesmo padrão
 * setTimeout/cancelled de `useTerminalSessions`.
 *
 * Três estados: visualização integrada ao app, edição (reaproveita o `FilePane`/Monaco inteiro —
 * mesmo autosave/Ctrl+S/indicador de não-salvo já usados pelos outros arquivos, zero duplicação),
 * e "documento" — página branca centralizada com sombra, tipo o preview de PDF do Markdown
 * Preview Enhanced do VSCode (só leitura: imprimir/exportar não faz sentido editável). */
export function MarkdownPane({ projectPath, tab, fileSaveMode, onDirtyChange }: MarkdownPaneProps) {
  const path = tab.resourceId ?? "";
  const [content, setContent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<ViewMode>("app");
  const [editing, setEditing] = useState(false);
  const lastMtimeRef = useRef(0);

  const load = useCallback(async () => {
    try {
      const [text, mtime] = await Promise.all([readTextFile(path, projectPath), fileMtime(path)]);
      setContent(text);
      setError(null);
      lastMtimeRef.current = mtime;
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  }, [path, projectPath]);

  useEffect(() => {
    let cancelled = false;
    let timer: number | undefined;

    async function poll() {
      try {
        const mtime = await fileMtime(path);
        if (!cancelled && mtime !== lastMtimeRef.current) await load();
      } catch {
        // arquivo pode estar sendo escrito nesse instante — tenta de novo no próximo tick
      }
      if (!cancelled) timer = window.setTimeout(poll, POLL_INTERVAL_MS);
    }

    void load().then(() => {
      if (!cancelled) timer = window.setTimeout(poll, POLL_INTERVAL_MS);
    });
    return () => {
      cancelled = true;
      if (timer) window.clearTimeout(timer);
    };
  }, [load, path]);

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

  const isDocument = mode === "document";

  function stopEditing() {
    setEditing(false);
    void load(); // pega a versão salva na hora, sem esperar o próximo tick do poll
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center justify-end gap-2 border-b-2 border-border-subtle bg-bg-elevated px-3 py-2">
        {!isDocument && (
          <Button
            size="sm"
            variant={editing ? "primary" : "glass"}
            onClick={() => (editing ? stopEditing() : setEditing(true))}
            title={
              editing
                ? "Parar de editar e voltar para o texto renderizado"
                : "Editar o texto deste arquivo Markdown (abre o editor de código, com salvamento automático/Ctrl+S)"
            }
          >
            {editing ? "✓ Editando — clique para visualizar" : "✎ Editar texto"}
          </Button>
        )}
        <Button
          size="sm"
          variant="glass"
          onClick={() => {
            setEditing(false);
            setMode(isDocument ? "app" : "document");
          }}
          title={
            isDocument
              ? "Voltar para a visualização integrada ao tema do app"
              : "Ver este Markdown como um documento — página branca centralizada, igual a uma prévia de PDF"
          }
        >
          {isDocument ? "◧ Voltar ao app" : "▤ Ver como documento (estilo PDF)"}
        </Button>
      </div>

      {isDocument ? (
        <div className="min-h-0 flex-1 overflow-auto bg-[#3a3a42] px-6 py-10">
          <article className="prose prose-neutral mx-auto max-w-[820px] bg-white px-16 py-14 shadow-2xl">
            <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeSanitize]}>
              {content}
            </ReactMarkdown>
          </article>
        </div>
      ) : editing ? (
        <FilePane projectPath={projectPath} tab={tab} saveMode={fileSaveMode} onDirtyChange={onDirtyChange} />
      ) : (
        <div className="min-h-0 flex-1 overflow-auto p-6">
          <article className="prose prose-invert max-w-none text-sm">
            <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeSanitize]}>
              {content}
            </ReactMarkdown>
          </article>
        </div>
      )}
    </div>
  );
}
