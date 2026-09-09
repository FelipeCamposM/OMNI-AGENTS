import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { LayoutPreset, WorkspaceAction } from "../../types/workspace";

const PRESETS: { id: LayoutPreset; glyph: string; label: string }[] = [
  { id: "columns-2", glyph: "▥", label: "2 colunas" },
  { id: "rows-2", glyph: "▤", label: "2 linhas" },
  { id: "grid-2x2", glyph: "▦", label: "Grade 2×2" },
  { id: "main-plus-side", glyph: "▣", label: "Principal + lateral" },
];

interface LayoutPresetPickerProps {
  dispatch: React.Dispatch<WorkspaceAction>;
}

/** Flyout de layouts prontos (tipo Snap Layouts do Windows) — mesmo padrão de portal/medir-botão/
 * clique-fora do `WorkspaceSwitcher`/`NotificationBell`. */
export function LayoutPresetPicker({ dispatch }: LayoutPresetPickerProps) {
  const [aberto, setAberto] = useState(false);
  const botaoRef = useRef<HTMLButtonElement>(null);
  const listaRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; right: number } | null>(null);

  const medir = useCallback(() => {
    const r = botaoRef.current?.getBoundingClientRect();
    if (r) setPos({ top: r.bottom + 4, right: window.innerWidth - r.right });
  }, []);

  useLayoutEffect(() => {
    if (aberto) medir();
  }, [aberto, medir]);

  useEffect(() => {
    if (!aberto) return;
    function onDown(e: PointerEvent) {
      const alvo = e.target as Node;
      if (botaoRef.current?.contains(alvo) || listaRef.current?.contains(alvo)) return;
      setAberto(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setAberto(false);
    }
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [aberto]);

  return (
    <>
      <button
        ref={botaoRef}
        type="button"
        onClick={() => setAberto((v) => !v)}
        aria-haspopup="dialog"
        aria-expanded={aberto}
        title="Layouts prontos"
        className="text-[10px] text-text-muted hover:text-text-primary uppercase tracking-wider px-2 py-1 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
      >
        ▦ Layouts
      </button>

      {aberto && pos && createPortal(
        <div
          ref={listaRef}
          role="dialog"
          aria-label="Layouts prontos"
          style={{ position: "fixed", top: pos.top, right: pos.right, minWidth: 180 }}
          className="popover z-50 p-1 space-y-0.5"
        >
          {PRESETS.map((preset) => (
            <button
              key={preset.id}
              type="button"
              onClick={() => {
                dispatch({ type: "APPLY_LAYOUT_PRESET", preset: preset.id });
                setAberto(false);
              }}
              className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-xs text-text-secondary hover:text-text-primary hover:bg-overlay/[0.07] focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
            >
              <span aria-hidden="true" className="text-accent">{preset.glyph}</span>
              {preset.label}
            </button>
          ))}
        </div>,
        document.body
      )}
    </>
  );
}
