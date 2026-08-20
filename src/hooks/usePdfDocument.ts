import { useCallback, useEffect, useRef, useState } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";

/**
 * Abre um PDF do disco com pdf.js só para EXIBIR. Nenhum PDF é montado aqui —
 * quem escreve arquivo é o PyMuPDF no sidecar Python.
 *
 * O import do pdf.js é dinâmico de propósito: são ~1 MB que só fazem sentido
 * quando alguém abre a ferramenta de PDF, e assim o jsdom dos testes não
 * precisa carregar o worker.
 */

type PdfDoc = {
  numPages: number;
  getPage(n: number): Promise<any>;
  destroy(): Promise<void>;
};

let pdfjsPromise: Promise<any> | null = null;

async function loadPdfjs() {
  if (!pdfjsPromise) {
    pdfjsPromise = (async () => {
      const pdfjs = await import("pdfjs-dist");
      const workerUrl = (await import("pdfjs-dist/build/pdf.worker.min.mjs?url")).default;
      pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
      return pdfjs;
    })();
  }
  return pdfjsPromise;
}

export interface PdfDocumentState {
  pageCount: number;
  loading: boolean;
  error: string | null;
  /** Desenha a página `n` (1-based) no canvas, com `cssWidth` de largura. */
  renderPage: (n: number, canvas: HTMLCanvasElement, cssWidth: number) => Promise<void>;
}

export function usePdfDocument(path: string | null): PdfDocumentState {
  const [pageCount, setPageCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const docRef = useRef<PdfDoc | null>(null);

  useEffect(() => {
    docRef.current = null;
    setPageCount(0);
    setError(null);

    if (!path) {
      setLoading(false);
      return;
    }

    let cancelled = false;
    let doc: PdfDoc | null = null;
    setLoading(true);

    (async () => {
      try {
        const pdfjs = await loadPdfjs();
        // O asset protocol já está com escopo "**" no tauri.conf.json e o
        // CSP libera connect-src pro asset:, então pdf.js busca direto.
        const task = pdfjs.getDocument({ url: convertFileSrc(path) });
        doc = (await task.promise) as PdfDoc;
        if (cancelled) {
          void doc.destroy();
          return;
        }
        docRef.current = doc;
        setPageCount(doc.numPages);
      } catch (e) {
        if (!cancelled) setError("Não foi possível abrir o PDF para visualização.");
        // eslint-disable-next-line no-console
        console.error("pdf preview:", e);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
      docRef.current = null;
      void doc?.destroy();
    };
  }, [path]);

  const renderPage = useCallback(
    async (n: number, canvas: HTMLCanvasElement, cssWidth: number) => {
      const doc = docRef.current;
      if (!doc) return;
      const page = await doc.getPage(n);
      const base = page.getViewport({ scale: 1 });
      // Telas HiDPI ficam borradas em escala 1; 2 já basta e não estoura memória.
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const viewport = page.getViewport({ scale: (cssWidth / base.width) * dpr });

      canvas.width = Math.floor(viewport.width);
      canvas.height = Math.floor(viewport.height);
      canvas.style.width = `${cssWidth}px`;
      canvas.style.height = `${Math.floor(viewport.height / dpr)}px`;

      // `canvas` (e não `canvasContext`): a partir do pdf.js 5 o contexto é
      // caminho legado e só vale com canvas: null.
      await page.render({ canvas, viewport }).promise;
    },
    []
  );

  return { pageCount, loading, error, renderPage };
}
