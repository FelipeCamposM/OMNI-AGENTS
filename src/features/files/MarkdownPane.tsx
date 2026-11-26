import ReactMarkdown from "react-markdown";
import rehypeSanitize from "rehype-sanitize";
import remarkGfm from "remark-gfm";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "../../components/ui";
import type { WorkspaceTab } from "../../types/workspace";
import { invoke } from "@tauri-apps/api/core";
import { save } from "@tauri-apps/plugin-dialog";
import { DocumentoPaginado } from "./DocumentoPaginado";
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

/** Copia as folhas para `#md-impressao` (direto no body, fora das áreas com rolagem que cortariam a
 *  impressão), liga o CSS de impressão e pede o PDF ao WebView2. Fora do Windows, o diálogo de imprimir. */
async function imprimirFolhasEmPdf(destino: string) {
  const folhas = document.querySelector("[data-md-paginas]");
  if (!folhas) throw new Error("As páginas ainda não foram montadas.");
  const copia = document.createElement("div");
  copia.id = "md-impressao";
  copia.innerHTML = [...folhas.querySelectorAll(".md-folha")].map((f) => f.outerHTML).join("");
  document.body.appendChild(copia);
  document.documentElement.classList.add("imprimindo-md");
  try {
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    if (navigator.userAgent.includes("Windows")) await invoke("salvar_pdf_da_pagina", { caminho: destino });
    else window.print();
  } finally {
    document.documentElement.classList.remove("imprimindo-md");
    copia.remove();
  }
}

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
  const [baixando, setBaixando] = useState(false);
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

  async function baixar() {
    const nome = (path.split(/[\\/]/).pop() ?? "documento").replace(/\.(md|markdown)$/i, "") + ".pdf";
    const destino = await save({ defaultPath: nome, filters: [{ name: "PDF", extensions: ["pdf"] }] });
    if (!destino) return;
    setBaixando(true);
    try { await imprimirFolhasEmPdf(destino.toLowerCase().endsWith(".pdf") ? destino : `${destino}.pdf`); }
    catch (motivo) { setError(motivo instanceof Error ? motivo.message : String(motivo)); }
    finally { setBaixando(false); }
  }

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
        {isDocument && (
          <Button size="sm" variant="primary" loading={baixando} onClick={() => void baixar()}
            title="Salvar estas páginas como um arquivo PDF">
            Baixar PDF
          </Button>
        )}
      </div>

      {isDocument ? (
        <div className="min-h-0 flex-1 overflow-auto bg-[#3a3a42] px-6 py-10">
          <DocumentoPaginado conteudo={content} />
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
