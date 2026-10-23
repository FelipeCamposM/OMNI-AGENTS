import type { PointerEvent as ReactPointerEvent } from "react";
import { motionOn } from "./motion";

/**
 * Reordenar uma lista da lateral arrastando o item. Pointer events, não HTML5 DnD: com o drop de
 * arquivos do Tauri ligado (Windows) o webview nunca entrega `dragstart`/`drop` — o mesmo motivo de
 * `tabPointerDrag`.
 *
 * Cada item marca `data-ordem="<lista>"` e `data-ordem-id="<id>"`. Durante o arraste o item sob o
 * ponteiro ganha `data-soltar="antes" | "depois"` (a linha de inserção é CSS). Ao soltar:
 * `aoSoltar(id, beforeId)`, com `beforeId = null` para o fim da lista. `eixo = "x"` para uma fileira
 * (antes/depois pela metade horizontal do alvo).
 */
export function arrastarParaOrdenar(evento: ReactPointerEvent, lista: string, id: string, aoSoltar: (id: string, beforeId: string | null) => void, eixo: "x" | "y" = "y") {
  if (evento.button !== 0) return;
  const origem = evento.currentTarget as HTMLElement;
  const { clientX, clientY, pointerId } = evento;
  let arrastando = false;
  let marcado: HTMLElement | null = null;
  let destino: string | null | undefined;

  // Fantasma: cópia do item que segue o ponteiro no mesmo ponto em que foi pego, como o arrasto de
  // arquivo. Sem `data-ordem` (não entra na lista) e sem eventos (o `elementFromPoint` vê por baixo).
  let fantasma: HTMLElement | null = null;
  let pega = { x: 0, y: 0 };
  function criarFantasma() {
    const caixa = origem.getBoundingClientRect();
    pega = { x: clientX - caixa.left, y: clientY - caixa.top };
    const copia = origem.cloneNode(true) as HTMLElement;
    for (const el of [copia, ...Array.from(copia.querySelectorAll<HTMLElement>("[data-ordem], [id]"))]) {
      el.removeAttribute("data-ordem"); el.removeAttribute("data-ordem-id"); el.removeAttribute("id");
    }
    delete copia.dataset.arrastado;
    delete copia.dataset.soltar;
    copia.setAttribute("aria-hidden", "true");
    copia.classList.add("ordenar-fantasma");
    Object.assign(copia.style, { position: "fixed", top: "0", left: "0", margin: "0", width: `${caixa.width}px`, height: `${caixa.height}px` });
    document.body.appendChild(copia);
    fantasma = copia;
    posicionar(clientX, clientY);
  }
  function posicionar(x: number, y: number) {
    if (fantasma) fantasma.style.transform = `translate(${x - pega.x}px, ${y - pega.y}px)`;
  }
  /** Leva o fantasma até `alvo` (o lugar onde o item vai ficar, ou de onde saiu) e some com ele. */
  function pousar(alvo: { left: number; top: number }) {
    const el = fantasma;
    fantasma = null;
    if (!el) return;
    if (!motionOn() || !el.animate) { el.remove(); return; }
    const de = el.style.transform;
    const para = `translate(${alvo.left}px, ${alvo.top}px)`;
    el.classList.add("ordenar-fantasma-pousando");
    el.animate([{ transform: de, opacity: 1 }, { transform: para, opacity: 0 }], { duration: 180, easing: "cubic-bezier(.2, .8, .3, 1)", fill: "forwards" })
      .finished.finally(() => el.remove());
  }

  const itens = () => Array.from(document.querySelectorAll<HTMLElement>(`[data-ordem="${lista}"]`));
  function marcar(item: HTMLElement | null, lado?: "antes" | "depois") {
    if (marcado && marcado !== item) delete marcado.dataset.soltar;
    marcado = item;
    if (item && lado) item.dataset.soltar = lado;
  }
  function mover(proximo: PointerEvent) {
    if (proximo.pointerId !== pointerId) return;
    if (!arrastando) {
      if (Math.hypot(proximo.clientX - clientX, proximo.clientY - clientY) < 6) return;
      arrastando = true;
      origem.setPointerCapture?.(pointerId);
      origem.dataset.arrastado = "";
      document.body.classList.add("ordenando-lista");
      criarFantasma();
    }
    proximo.preventDefault();
    posicionar(proximo.clientX, proximo.clientY);
    const item = document.elementFromPoint(proximo.clientX, proximo.clientY)?.closest<HTMLElement>(`[data-ordem="${lista}"]`) ?? null;
    if (!item) { marcar(null); destino = undefined; return; }
    const caixa = item.getBoundingClientRect();
    const antes = eixo === "x" ? proximo.clientX < caixa.left + caixa.width / 2 : proximo.clientY < caixa.top + caixa.height / 2;
    const todos = itens();
    const seguinte = todos[todos.indexOf(item) + 1];
    destino = antes ? item.dataset.ordemId! : (seguinte?.dataset.ordemId ?? null);
    marcar(item, antes ? "antes" : "depois");
  }
  function limpar() {
    // Soltou num lugar válido: pousa na linha de inserção. Senão (Esc, fora da lista): volta para a origem.
    const linha = marcado?.getBoundingClientRect();
    const caixa = origem.getBoundingClientRect();
    const antes = marcado?.dataset.soltar === "antes";
    pousar(!(destino !== undefined && destino !== id && linha) ? caixa
      : eixo === "x" ? { top: caixa.top, left: (antes ? linha.left : linha.right) - caixa.width / 2 }
      : { left: caixa.left, top: (antes ? linha.top : linha.bottom) - caixa.height / 2 });
    if (origem.hasPointerCapture?.(pointerId)) origem.releasePointerCapture?.(pointerId);
    window.removeEventListener("pointermove", mover);
    window.removeEventListener("pointerup", soltar);
    window.removeEventListener("pointercancel", limpar);
    window.removeEventListener("keydown", tecla);
    marcar(null);
    delete origem.dataset.arrastado;
    document.body.classList.remove("ordenando-lista");
  }
  function tecla(proximo: KeyboardEvent) { if (proximo.key === "Escape") { destino = undefined; limpar(); } }
  function soltar(proximo: PointerEvent) {
    if (proximo.pointerId !== pointerId) return;
    const foi = arrastando;
    limpar();
    if (!foi) return;
    // O clique que vem junto do pointerup não pode "abrir" o item que acabou de ser arrastado.
    // Solto fora do item não há clique: o filtro sai no próximo tique para não engolir o clique seguinte.
    const engolir = (clique: MouseEvent) => { clique.stopPropagation(); clique.preventDefault(); };
    window.addEventListener("click", engolir, { capture: true, once: true });
    window.setTimeout(() => window.removeEventListener("click", engolir, { capture: true }), 0);
    if (destino !== undefined && destino !== id) aoSoltar(id, destino);
  }
  window.addEventListener("pointermove", mover, { passive: false });
  window.addEventListener("pointerup", soltar);
  window.addEventListener("pointercancel", limpar);
  window.addEventListener("keydown", tecla);
}
