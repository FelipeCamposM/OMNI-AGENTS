import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { CloseIcon, ListIcon } from "../../components/ui/PixelIcon";
import { motionOn } from "../../lib/motion";
import { TodoList, useTodos } from "./TodoList";
import "./tarefas.css";

const LARGURA = 380;
/** Tempo da animação de saída; o painel só desmonta depois dela. */
const SAIDA_MS = 160;

/**
 * Tarefas na barra superior: botão com contador e um painel por cima da tela. Com pendência, o
 * botão "respira" devagar (sem balançar como o sino: tarefa é lembrete, não alarme); atrasada
 * deixa o contador vermelho. Portal pelo mesmo motivo do sino (ver `NotificationBell`).
 */
export function TarefasNoTopo() {
  const tarefas = useTodos();
  const [aberto, setAberto] = useState(false);
  const [saindo, setSaindo] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const botao = useRef<HTMLButtonElement>(null);
  const painel = useRef<HTMLDivElement>(null);

  const medir = useCallback(() => {
    const r = botao.current?.getBoundingClientRect();
    if (r) setPos({ top: r.bottom + 8, left: Math.max(8, Math.min(r.right - LARGURA, window.innerWidth - LARGURA - 8)) });
  }, []);
  useLayoutEffect(() => { if (aberto) medir(); }, [aberto, medir]);

  const fechar = useCallback(() => {
    if (!motionOn()) { setAberto(false); return; }
    setSaindo(true);
    window.setTimeout(() => { setAberto(false); setSaindo(false); }, SAIDA_MS);
  }, []);

  useEffect(() => {
    if (!aberto) return;
    function fora(e: PointerEvent) {
      const alvo = e.target as Element;
      if (botao.current?.contains(alvo) || painel.current?.contains(alvo) || alvo.closest?.("[data-tarefas-flutuante]")) return;
      fechar();
    }
    function tecla(e: KeyboardEvent) { if (e.key === "Escape") fechar(); }
    document.addEventListener("pointerdown", fora);
    document.addEventListener("keydown", tecla);
    window.addEventListener("resize", medir);
    return () => {
      document.removeEventListener("pointerdown", fora);
      document.removeEventListener("keydown", tecla);
      window.removeEventListener("resize", medir);
    };
  }, [aberto, fechar, medir]);

  const { pendentes, atrasadas } = tarefas;
  const rotulo = pendentes === 0 ? "Tarefas: nenhuma pendente"
    : `Tarefas: ${pendentes} pendente${pendentes > 1 ? "s" : ""}${atrasadas ? `, ${atrasadas} atrasada${atrasadas > 1 ? "s" : ""}` : ""}`;

  return (
    <>
      <button ref={botao} type="button" aria-label={rotulo} title={rotulo} aria-expanded={aberto} aria-haspopup="dialog"
        onClick={() => (aberto ? fechar() : setAberto(true))}
        className={`tarefas-botao${pendentes > 0 ? " tarefas-botao-pendente" : ""}${aberto ? " tarefas-botao-aberto" : ""}`}>
        <ListIcon className="h-4 w-4" aria-hidden />
        <span className="tarefas-botao-nome">Tarefas</span>
        {pendentes > 0 && (
          // `key`: cada número novo entra com um pulo curto.
          <span key={pendentes} aria-hidden className={`tarefas-contador${atrasadas ? " tarefas-contador-atrasada" : ""}`}>
            {pendentes > 99 ? "99+" : pendentes}
          </span>
        )}
      </button>

      {aberto && pos && createPortal(
        <div ref={painel} role="dialog" aria-label="Tarefas" className={`tarefas-painel${saindo ? " tarefas-painel-saindo" : ""}`}
          style={{ position: "fixed", top: pos.top, left: pos.left, width: LARGURA }}>
          <header className="tarefas-painel-topo">
            <span className="min-w-0">
              <span className="pixel-text text-text-primary text-sm">Tarefas</span>
              <span className="tarefas-painel-resumo">
                {pendentes === 0 ? "Tudo em dia" : `${pendentes} pendente${pendentes > 1 ? "s" : ""}`}
                {atrasadas > 0 && <span className="text-danger"> · {atrasadas} atrasada{atrasadas > 1 ? "s" : ""}</span>}
              </span>
            </span>
            <button type="button" onClick={fechar} aria-label="Fechar tarefas" className="tarefas-fechar">
              <CloseIcon className="h-3.5 w-3.5" aria-hidden />
            </button>
          </header>
          <TodoList {...tarefas} />
        </div>,
        document.body,
      )}
    </>
  );
}
