/**
 * Fork (Roadmaps): animações curtas com Web Animations, só `opacity`/`transform`, sem `fill` (o
 * elemento volta ao CSS ao terminar) e nunca segurando clique: o enfeite tem `pointer-events: none`.
 * Nada anima com "reduzir movimento", animações desligadas, janela oculta ou pausa de energia.
 * Nada de View Transitions (travou a janela na 0.9.2).
 */
import { motionOn } from "../../lib/motion";

function pode(): boolean {
  return motionOn() && typeof document !== "undefined" && !document.hidden;
}

/** Etapa concluída: o nó pulsa, um anel se abre em volta e, com `rotulo`, sobe um "+250 XP". */
export function animarConclusao(no: HTMLElement | null, rotulo?: string): Animation[] {
  if (!no || !pode() || typeof no.animate !== "function") return [];
  const animacoes = [no.animate(
    [{ transform: "scale(1)" }, { transform: "scale(1.18)" }, { transform: "scale(0.96)" }, { transform: "scale(1)" }],
    { duration: 520, easing: "cubic-bezier(.2,.8,.2,1)" },
  )];
  const anel = document.createElement("span");
  anel.className = "roadmap-anel";
  anel.setAttribute("aria-hidden", "true");
  no.appendChild(anel);
  const abrir = anel.animate([{ opacity: 0.7, transform: "scale(0.8)" }, { opacity: 0, transform: "scale(2.1)" }], { duration: 650, easing: "ease-out" });
  const tirar = () => anel.remove();
  abrir.onfinish = tirar;
  abrir.oncancel = tirar;
  animacoes.push(abrir);
  if (rotulo) {
    const texto = document.createElement("span");
    texto.className = "roadmap-ganho";
    texto.setAttribute("aria-hidden", "true");
    texto.textContent = rotulo;
    no.appendChild(texto);
    const subir = texto.animate([{ opacity: 0, transform: "translate(-50%, 4px)" }, { opacity: 1, transform: "translate(-50%, -18px)", offset: 0.3 }, { opacity: 0, transform: "translate(-50%, -40px)" }], { duration: 1100, easing: "ease-out" });
    const tirarTexto = () => texto.remove();
    subir.onfinish = tirarTexto;
    subir.oncancel = tirarTexto;
    animacoes.push(subir);
  }
  return animacoes;
}

/** Entrada leve de um painel (etapa, revisão). */
export function animarEntrada(el: HTMLElement | null): Animation | null {
  if (!el || !pode() || typeof el.animate !== "function") return null;
  return el.animate([{ opacity: 0, transform: "translateY(6px)" }, { opacity: 1, transform: "none" }], { duration: 180, easing: "ease-out" });
}

/** Rola até o nó: suave só quando há movimento. */
export function rolarAte(el: HTMLElement | null) {
  el?.scrollIntoView?.({ block: "center", behavior: pode() ? "smooth" : "auto" });
}

export type Direcao = "frente" | "tras" | "neutra";

/**
 * Troca de tela (lista → trilha → estudo, aba do painel, card da revisão): entra deslizando do lado
 * para onde se vai. Só a entrada anima (a tela antiga some na hora): nunca há duas telas segurando clique.
 */
export function animarTroca(el: HTMLElement | null, direcao: Direcao = "neutra"): Animation | null {
  if (!el || !pode() || typeof el.animate !== "function") return null;
  const dx = direcao === "frente" ? 18 : direcao === "tras" ? -18 : 0;
  return el.animate(
    [{ opacity: 0, transform: `translate(${dx}px, ${dx ? 0 : 6}px) scale(.992)` }, { opacity: 1, transform: "none" }],
    { duration: 260, easing: "cubic-bezier(.2,.8,.2,1)" },
  );
}

/** Painel que abre de um lado (lateral da trilha). */
export function animarPainelLateral(el: HTMLElement | null): Animation | null {
  if (!el || !pode() || typeof el.animate !== "function") return null;
  return el.animate([{ opacity: 0, transform: "translateX(24px)" }, { opacity: 1, transform: "none" }], { duration: 240, easing: "cubic-bezier(.2,.8,.2,1)" });
}

/** Itens entrando em cascata (medalhões ao abrir o mapa): no máximo `limite`, o resto já aparece pronto. */
export function animarCascata(itens: HTMLElement[], passoMs = 28, limite = 14): Animation[] {
  if (!pode()) return [];
  return itens.slice(0, limite).filter((el) => typeof el.animate === "function").map((el, i) => el.animate(
    [{ opacity: 0, transform: "translateY(10px) scale(.94)" }, { opacity: 1, transform: "none" }],
    // `backwards`: espera a vez já no estado inicial, mas termina sem `fill` (volta ao CSS).
    { duration: 320, delay: i * passoMs, easing: "cubic-bezier(.2,.9,.25,1.15)", fill: "backwards" },
  ));
}
