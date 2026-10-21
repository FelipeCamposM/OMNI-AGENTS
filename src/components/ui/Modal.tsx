import { useEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { CloseIcon } from "./PixelIcon";

/**
 * Janela por cima do app: fundo escuro, título, fechar no X, no Esc ou clicando fora. Portal no
 * `body` porque a lateral (`.glass`) cria contexto de empilhamento e prenderia a janela dentro dela.
 */
export function Modal({ titulo, onFechar, children, largura = "md" }: {
  titulo: string; onFechar: () => void; children: ReactNode; largura?: "sm" | "md";
}) {
  const caixa = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const tecla = (evento: KeyboardEvent) => {
      if (evento.key !== "Escape") return;
      // Modal em cima de modal (confirmar exclusão): só o de cima — o último no DOM — fecha.
      const modais = document.querySelectorAll(".modal");
      if (modais[modais.length - 1] !== caixa.current) return;
      evento.stopPropagation();
      onFechar();
    };
    window.addEventListener("keydown", tecla, { capture: true });
    return () => window.removeEventListener("keydown", tecla, { capture: true });
  }, [onFechar]);

  return createPortal(
    <div className="modal-fundo" onMouseDown={(evento) => { if (evento.target === evento.currentTarget) onFechar(); }}>
      <div ref={caixa} className={`modal modal-${largura}`} role="dialog" aria-modal="true" aria-label={titulo}>
        <header className="modal-topo">
          <h2 className="pixel-text">{titulo}</h2>
          <button type="button" className="modal-fechar" aria-label="Fechar" onClick={onFechar}>
            <CloseIcon className="h-3.5 w-3.5" aria-hidden />
          </button>
        </header>
        <div className="modal-corpo">{children}</div>
      </div>
    </div>,
    document.body,
  );
}
