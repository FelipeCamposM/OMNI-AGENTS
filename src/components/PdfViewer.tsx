import { Check, ZoomIn } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import gsap from "gsap";
import { usePdfDocument } from "../hooks/usePdfDocument";
import { usePulse } from "../lib/motion";
import { Button } from "./ui";

const THUMB_WIDTH = 150;
const ZOOM_WIDTH = 720;

export interface PdfViewerProps {
  /** Caminho do PDF no disco. */
  path: string | null;
  /** Ordem das páginas exibidas (1-based). Se omitido, usa 1..pageCount. */
  order?: number[];
  /** Páginas marcadas (1-based). */
  selected?: Set<number>;
  onToggle?: (page: number) => void;
  onReorder?: (order: number[]) => void;
  onPageCount?: (count: number) => void;
  /** Texto curto exibido na barra (ex.: "3 de 12 selecionadas"). */
  hint?: string;
  /** Ações extras na barra superior. */
  actions?: React.ReactNode;
}

export function PdfViewer({
  path,
  order,
  selected,
  onToggle,
  onReorder,
  onPageCount,
  hint,
  actions,
}: PdfViewerProps) {
  const { pageCount, loading, error, renderPage } = usePdfDocument(path);
  const [zoomPage, setZoomPage] = useState<number | null>(null);

  useEffect(() => {
    onPageCount?.(pageCount);
  }, [pageCount, onPageCount]);

  const pages = useMemo(
    () => order ?? Array.from({ length: pageCount }, (_, i) => i + 1),
    [order, pageCount]
  );

  if (!path) return null;

  return (
    <div className="glass p-3 space-y-3">
      <div className="flex items-center gap-2 flex-wrap">
        <p className="text-text-secondary text-xs font-medium">
          {loading ? "Abrindo PDF…" : `${pageCount} página(s)`}
          {hint ? <span className="text-text-muted"> · {hint}</span> : null}
        </p>
        <div className="ml-auto flex items-center gap-1.5">{actions}</div>
      </div>

      {error && (
        <p role="alert" className="text-danger text-xs">
          {error}
        </p>
      )}

      {pageCount > 0 && (
        <div
          className="grid gap-3 max-h-[26rem] overflow-y-auto pr-1"
          style={{ gridTemplateColumns: `repeat(auto-fill, minmax(${THUMB_WIDTH}px, 1fr))` }}
        >
          {pages.map((page, index) => (
            <PageThumb
              key={`${page}-${index}`}
              page={page}
              index={index}
              renderPage={renderPage}
              checked={selected?.has(page) ?? false}
              selectable={!!onToggle}
              draggable={!!onReorder}
              onToggle={onToggle}
              onZoom={() => setZoomPage(page)}
              onMove={(from, to) => {
                if (!onReorder || from === to) return;
                const next = [...pages];
                const [moved] = next.splice(from, 1);
                next.splice(to, 0, moved);
                onReorder(next);
              }}
            />
          ))}
        </div>
      )}

      {zoomPage !== null && (
        <ZoomOverlay
          page={zoomPage}
          pages={pages}
          renderPage={renderPage}
          onChange={setZoomPage}
          onClose={() => setZoomPage(null)}
        />
      )}
    </div>
  );
}

function PageThumb({
  page,
  index,
  renderPage,
  checked,
  selectable,
  draggable,
  onToggle,
  onZoom,
  onMove,
}: {
  page: number;
  index: number;
  renderPage: (n: number, canvas: HTMLCanvasElement, w: number) => Promise<void>;
  checked: boolean;
  selectable: boolean;
  draggable: boolean;
  onToggle?: (page: number) => void;
  onZoom: () => void;
  onMove: (from: number, to: number) => void;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [drawn, setDrawn] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const pulse = usePulse();

  // Só renderiza o que entra na viewport — um PDF de 500 páginas não pode
  // virar 500 canvas de uma vez.
  useEffect(() => {
    const host = hostRef.current;
    if (!host || drawn) return;

    const io = new IntersectionObserver(
      (entries) => {
        if (!entries.some((e) => e.isIntersecting)) return;
        io.disconnect();
        const canvas = canvasRef.current;
        if (!canvas) return;
        renderPage(page, canvas, THUMB_WIDTH)
          .then(() => {
            setDrawn(true);
            gsap.fromTo(canvas, { opacity: 0 }, { opacity: 1, duration: 0.35 });
          })
          .catch(() => undefined);
      },
      { root: host.closest(".overflow-y-auto"), rootMargin: "300px" }
    );
    io.observe(host);
    return () => io.disconnect();
  }, [page, renderPage, drawn]);

  function toggle() {
    if (!selectable || !onToggle) return;
    onToggle(page);
    pulse(hostRef.current);
  }

  return (
    <div
      ref={hostRef}
      draggable={draggable}
      onDragStart={(e) => e.dataTransfer.setData("text/plain", String(index))}
      onDragOver={(e) => {
        if (!draggable) return;
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        if (!draggable) return;
        e.preventDefault();
        setDragOver(false);
        const from = Number(e.dataTransfer.getData("text/plain"));
        if (Number.isFinite(from)) onMove(from, index);
      }}
      role={selectable ? "checkbox" : undefined}
      aria-checked={selectable ? checked : undefined}
      aria-label={`Página ${page}`}
      tabIndex={selectable ? 0 : undefined}
      onClick={toggle}
      onKeyDown={(e) => {
        if (e.key === " " || e.key === "Enter") {
          e.preventDefault();
          toggle();
        }
      }}
      className={[
        "glass glass-hover glass-sheen relative p-1.5 flex flex-col items-center gap-1",
        selectable ? "cursor-pointer" : "",
        draggable ? "cursor-grab active:cursor-grabbing" : "",
        checked ? "!border-accent shadow-glow" : "",
        dragOver ? "ring-2 ring-accent" : "",
      ].join(" ")}
    >
      <div
        className="glass-inset w-full flex items-center justify-center overflow-hidden bg-white"
        style={{ minHeight: THUMB_WIDTH * 1.3 }}
      >
        <canvas ref={canvasRef} className="max-w-full" />
      </div>

      <div className="w-full flex items-center justify-between gap-1 px-0.5">
        <span className="text-text-secondary text-[11px] tabular-nums">{page}</span>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onZoom();
          }}
          aria-label={`Ampliar página ${page}`}
          className="text-text-muted hover:text-accent transition-colors p-0.5 rounded focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
        >
          <ZoomIn className="w-3.5 h-3.5" aria-hidden="true" />
        </button>
      </div>

      {selectable && (
        <span
          aria-hidden="true"
          className={[
            "absolute top-2 left-2 w-4 h-4 rounded-md border flex items-center justify-center transition-colors",
            checked ? "bg-accent border-accent text-white" : "border-border bg-overlay/20",
          ].join(" ")}
        >
          {checked && <Check className="w-3 h-3" aria-hidden="true" />}
        </span>
      )}
    </div>
  );
}

function ZoomOverlay({
  page,
  pages,
  renderPage,
  onChange,
  onClose,
}: {
  page: number;
  pages: number[];
  renderPage: (n: number, canvas: HTMLCanvasElement, w: number) => Promise<void>;
  onChange: (page: number) => void;
  onClose: () => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const at = pages.indexOf(page);

  const go = useCallback(
    (delta: number) => {
      const next = pages[at + delta];
      if (next !== undefined) onChange(next);
    },
    [at, pages, onChange]
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas) renderPage(page, canvas, ZOOM_WIDTH).catch(() => undefined);
  }, [page, renderPage]);

  useEffect(() => {
    if (panelRef.current) {
      gsap.fromTo(
        panelRef.current,
        { opacity: 0, scale: 0.94 },
        { opacity: 1, scale: 1, duration: 0.3, ease: "power3.out" }
      );
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowRight") go(1);
      if (e.key === "ArrowLeft") go(-1);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [go, onClose]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Página ${page} ampliada`}
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-6"
    >
      <div
        ref={panelRef}
        onClick={(e) => e.stopPropagation()}
        className="glass glass-float max-w-[90vw] max-h-[90vh] overflow-auto p-3 space-y-2"
      >
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            onClick={() => go(-1)}
            disabled={at <= 0}
            className="!px-2.5 !py-1"
          >
            ←
          </Button>
          <span className="text-text-secondary text-xs tabular-nums">
            Página {page} ({at + 1}/{pages.length})
          </span>
          <Button
            size="sm"
            onClick={() => go(1)}
            disabled={at >= pages.length - 1}
            className="!px-2.5 !py-1"
          >
            →
          </Button>
          <Button size="sm" onClick={onClose} className="ml-auto !px-2.5 !py-1">
            Fechar
          </Button>
        </div>
        <div className="bg-white rounded-lg overflow-hidden">
          <canvas ref={canvasRef} className="block max-w-full" />
        </div>
      </div>
    </div>
  );
}


