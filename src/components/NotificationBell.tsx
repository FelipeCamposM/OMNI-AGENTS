import { Bell } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useNotifications } from "../hooks/useNotifications";
import type { SettingsSection } from "../hooks/useNotifications";

/**
 * Sino de pendências no topo da barra lateral. Só avisa e leva até
 * Configurações — quem instala é o card de lá (ver `useNotifications`).
 *
 * ⚠️ **A lista vai num portal para o `<body>`, e não é firula.** A `<aside>` é
 * `.glass`, e `backdrop-filter` **cria contexto de empilhamento**: dentro dela,
 * `z-50` só compete com os irmãos da própria barra. O conteúdo da página é
 * irmão POSTERIOR no DOM, então dropzone, cards e botões pintavam por cima do
 * popover — o `z-50` estava lá e não adiantava nada. Subir o z-index da barra
 * "resolveria" e quebraria o modal de zoom do PDF, que hoje passa por cima
 * dela. O portal tira a lista da armadilha sem mexer em mais nada.
 *
 * O preço do portal é posicionar à mão (`fixed` + medida do botão) e olhar dois
 * refs no clique-fora, porque a lista deixa de ser filha do sino.
 */
export function NotificationBell({
  onOpenSettings,
}: {
  onOpenSettings: (secao: SettingsSection) => void;
}) {
  const itens = useNotifications();
  const [aberto, setAberto] = useState(false);
  const caixaRef = useRef<HTMLDivElement>(null);
  const listaRef = useRef<HTMLDivElement>(null);
  const botaoRef = useRef<HTMLButtonElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  const medir = useCallback(() => {
    const r = botaoRef.current?.getBoundingClientRect();
    if (r) setPos({ top: r.bottom + 8, left: r.left });
  }, []);

  // `useLayoutEffect` e não `useEffect`: medir depois da pintura mostraria a
  // lista por um quadro no canto superior esquerdo antes de saltar para o lugar.
  useLayoutEffect(() => {
    if (aberto) medir();
  }, [aberto, medir]);

  // A barra é `sticky` e ocupa a altura toda, então a posição do sino só muda
  // quando a janela muda de tamanho.
  useEffect(() => {
    if (!aberto) return;
    window.addEventListener("resize", medir);
    return () => window.removeEventListener("resize", medir);
  }, [aberto, medir]);

  // Fecha ao clicar fora e no Esc — um popover que só fecha no próprio botão
  // vira armadilha quando o usuário já seguiu para outra coisa.
  useEffect(() => {
    if (!aberto) return;

    function onDown(e: PointerEvent) {
      const alvo = e.target as Node;
      // Dois refs: com o portal, a lista não é mais descendente do sino, e
      // olhar só o `caixaRef` fecharia o popover ao clicar dentro dele.
      if (caixaRef.current?.contains(alvo) || listaRef.current?.contains(alvo)) return;
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

  const total = itens.length;
  const temPendencia = total > 0;

  return (
    <div ref={caixaRef} className="relative shrink-0">
      <button
        ref={botaoRef}
        onClick={() => setAberto((v) => !v)}
        aria-label={
          temPendencia
            ? `Notificações: ${total} pendência${total > 1 ? "s" : ""}`
            : "Notificações: nenhuma pendência"
        }
        aria-expanded={aberto}
        aria-haspopup="dialog"
        className={[
          "relative p-1.5 !rounded-lg transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent",
          temPendencia
            ? "text-accent hover:bg-overlay/[0.07]"
            : "text-text-muted hover:text-text-secondary hover:bg-overlay/[0.07]",
        ].join(" ")}
      >
        <Bell className={`w-4 h-4 ${temPendencia ? "bell-ring" : ""}`} aria-hidden="true" />

        {temPendencia && (
          <span
            aria-hidden="true"
            className="badge-pulse absolute -top-0.5 -right-0.5 min-w-[15px] h-[15px] px-1 rounded-full bg-danger text-white text-[9px] font-bold leading-[15px] text-center"
          >
            {total > 9 ? "9+" : total}
          </span>
        )}
      </button>

      {aberto && pos && createPortal(
        <div
          ref={listaRef}
          role="dialog"
          aria-label="Notificações"
          style={{ position: "fixed", top: pos.top, left: pos.left }}
          className="popover w-64 z-50 p-2 space-y-1"
        >
          {total === 0 ? (
            <p className="text-text-muted text-xs px-2 py-3 text-center">
              Nada pendente por aqui.
            </p>
          ) : (
            itens.map((n) => (
              <button
                key={n.id}
                onClick={() => {
                  setAberto(false);
                  onOpenSettings(n.secao);
                }}
                className="glass-hover w-full text-left px-2.5 py-2 !rounded-lg focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
              >
                <span className="block text-text-primary text-xs font-medium">{n.titulo}</span>
                <span className="block text-text-muted text-[10px] leading-snug">{n.detalhe}</span>
              </button>
            ))
          )}
        </div>,
        document.body
      )}
    </div>
  );
}
