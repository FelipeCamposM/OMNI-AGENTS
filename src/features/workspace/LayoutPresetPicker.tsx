import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { LayoutPreset } from "../../types/workspace";
import { GlifoGrade } from "../../components/ui/PixelGlyph";
import { celulas, LAYOUT_PRESETS, type Molde } from "./layoutPresets";

/** Miniatura do layout: cada painel é um bloco, com o mesmo vão de pixel do resto do app. */
function Miniatura({ molde }: { molde: Molde }) {
  return (
    <svg width={40} height={28} viewBox="0 0 40 28" shapeRendering="crispEdges" aria-hidden className="layout-miniatura">
      {celulas(molde, { x: 0, y: 0, w: 40, h: 28 }, 2).map((c, i) => <rect key={i} x={c.x} y={c.y} width={c.w} height={c.h} />)}
    </svg>
  );
}

interface LayoutPresetPickerProps {
  onEscolher: (preset: LayoutPreset) => void;
  /** Web: o layout em uso fica marcado e "Automático" volta a dividir pela quantidade de conversas. */
  atual?: LayoutPreset | null;
  onAutomatico?: () => void;
}

/** Flyout de layouts prontos (tipo Snap Layouts do Windows) — mesmo padrão de portal/medir-botão/
 * clique-fora do `WorkspaceSwitcher`/`NotificationBell`. */
export function LayoutPresetPicker({ onEscolher, atual, onAutomatico }: LayoutPresetPickerProps) {
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
        className={`titlebar-acao${aberto ? " is-aberto" : ""}`}
      >
        <GlifoGrade />
        Layouts
      </button>

      {aberto && pos && createPortal(
        <div
          ref={listaRef}
          role="dialog"
          aria-label="Layouts prontos"
          style={{ position: "fixed", top: pos.top, right: pos.right }}
          className="popover z-50 grid grid-cols-4 gap-1 p-1.5"
        >
          {onAutomatico && (
            <button type="button" title="Automático: divide pela quantidade de conversas abertas" aria-pressed={!atual}
              onClick={() => { onAutomatico(); setAberto(false); }} className={`layout-opcao${!atual ? " is-atual" : ""}`}>
              <Miniatura molde={{ d: "h", r: 0.5, a: "p", b: "p" }} />
              <span>Automático</span>
            </button>
          )}
          {LAYOUT_PRESETS.map((preset) => (
            <button
              key={preset.id}
              type="button"
              title={preset.label}
              aria-label={preset.label}
              aria-pressed={atual === undefined ? undefined : atual === preset.id}
              onClick={() => {
                onEscolher(preset.id);
                setAberto(false);
              }}
              className={`layout-opcao${atual === preset.id ? " is-atual" : ""}`}
            >
              <Miniatura molde={preset.molde} />
              <span>{preset.label}</span>
            </button>
          ))}
        </div>,
        document.body
      )}
    </>
  );
}
