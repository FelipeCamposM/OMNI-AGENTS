/**
 * Camada de animação da suíte — único módulo que conhece GSAP.
 *
 * Todos os hooks devolvem uma ref: `const ref = useEnter(); <div ref={ref}>`.
 * Respeitam a setting `animations` e o `prefers-reduced-motion` do sistema
 * (o sistema sempre vence: se o usuário pediu menos movimento no Windows,
 * "completas" não reativa).
 */
import { useCallback, useEffect, useRef } from "react";
import gsap from "gsap";
import { useGSAP } from "@gsap/react";
import type { MotionLevel } from "../types/settings";

gsap.registerPlugin(useGSAP);

const EASE = "power3.out";

let level: MotionLevel = "completas";

/** Chamado por useSettings sempre que a preferência muda. */
export function setMotionLevel(next: MotionLevel) {
  level = next;
}

function systemPrefersReduced() {
  return typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
}

/**
 * false = os hooks não animam nada e o DOM fica no estado final.
 * Exportado para quem anima fora do GSAP (ex.: fundos WebGL do React Bits).
 */
export function motionOn() {
  return level !== "desligadas" && !systemPrefersReduced();
}

/** "reduzidas" = mesma coreografia, metade do tempo e sem deslocamento. */
function d(base: number) {
  return level === "reduzidas" ? base * 0.5 : base;
}
function px(base: number) {
  return level === "reduzidas" ? 0 : base;
}

/**
 * Entrada segura: fade + deslocamento que NUNCA deixa o alvo invisível.
 *
 * `gsap.from` põe o elemento no estado inicial (opacity 0) imediatamente e só
 * o devolve ao terminar. Se o tween não completa — aba oculta congela o rAF, a
 * janela perde foco para um diálogo nativo de arquivo (acontece o tempo todo
 * aqui), o tween é morto por um re-render — o elemento fica invisível PARA
 * SEMPRE. Foi assim que o botão de salvar sumiu: era sempre o último item da
 * cascata, o que começa mais tarde e por isso é o primeiro a ser deixado para
 * trás.
 *
 * Duas garantias:
 * 1. `fromTo` com `opacity: 1` explícito + `clearProps` — o estado de repouso
 *    volta a ser o do CSS (visível), sem opacity inline pendurado.
 * 2. Um timer de segurança força o fim do tween. `setTimeout` é limitado em aba
 *    oculta, mas não é congelado como o rAF — então dispara de qualquer jeito.
 *
 * Retorna a limpeza do timer, para o chamador repassar ao useGSAP.
 */
function safeFrom(
  alvos: gsap.TweenTarget,
  from: gsap.TweenVars,
  to: gsap.TweenVars,
  duracaoTotal: number
): () => void {
  const tween = gsap.fromTo(
    alvos,
    from,
    { ...to, opacity: 1, clearProps: "opacity,transform" }
  );

  const id = window.setTimeout(() => {
    if (tween.progress() < 1) tween.progress(1);
    gsap.set(alvos, { clearProps: "opacity,transform" });
  }, duracaoTotal * 1000 + 250);

  return () => window.clearTimeout(id);
}

/** Entrada de um bloco: fade + subida curta. */
export function useEnter<T extends HTMLElement = HTMLDivElement>(deps: unknown[] = []) {
  const ref = useRef<T>(null);
  useGSAP(
    () => {
      if (!ref.current || !motionOn()) return;
      return safeFrom(
        ref.current,
        { opacity: 0, y: px(10) },
        { y: 0, duration: d(0.45), ease: EASE },
        d(0.45)
      );
    },
    { dependencies: deps, revertOnUpdate: true }
  );
  return ref;
}

/** Entrada em cascata dos filhos que casam com `selector`. */
export function useStagger<T extends HTMLElement = HTMLDivElement>(
  selector: string,
  deps: unknown[] = []
) {
  const ref = useRef<T>(null);
  useGSAP(
    () => {
      if (!ref.current || !motionOn()) return;
      const items = ref.current.querySelectorAll(selector);
      if (!items.length) return;
      return safeFrom(
        items,
        { opacity: 0, y: px(14), scale: level === "reduzidas" ? 1 : 0.97 },
        {
          y: 0,
          scale: 1,
          duration: d(0.45),
          ease: EASE,
          // `amount` (não `each`): a cascata inteira dura o mesmo tanto com 3 ou
          // 30 itens. Com `each`, a grade de 13 ferramentas levava >1s.
          stagger: { amount: d(0.3) },
        },
        d(0.45) + d(0.3)
      );
    },
    { scope: ref, dependencies: deps, revertOnUpdate: true }
  );
  return ref;
}

/**
 * Troca de tela no shell. Anima só a entrada — o conteúdo antigo já
 * desmontou, animar a saída exigiria segurar dois DOMs vivos.
 */
export function useViewTransition<T extends HTMLElement = HTMLDivElement>(key: string) {
  const ref = useRef<T>(null);
  useGSAP(
    () => {
      if (!ref.current || !motionOn()) return;
      gsap.fromTo(
        ref.current,
        { opacity: 0, y: px(12), scale: level === "reduzidas" ? 1 : 0.985 },
        { opacity: 1, y: 0, scale: 1, duration: d(0.42), ease: EASE, clearProps: "transform" }
      );
    },
    { dependencies: [key], revertOnUpdate: true }
  );
  return ref;
}

/**
 * Escreve --mx/--my na superfície pra .glass-sheen desenhar o brilho radial
 * onde o cursor está. Barato: só custom properties, sem tween.
 */
export function useGlassSheen<T extends HTMLElement = HTMLDivElement>() {
  const ref = useRef<T>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el || !motionOn()) return;

    function onMove(e: PointerEvent) {
      const r = el!.getBoundingClientRect();
      el!.style.setProperty("--mx", `${e.clientX - r.left}px`);
      el!.style.setProperty("--my", `${e.clientY - r.top}px`);
    }

    el.addEventListener("pointermove", onMove);
    return () => el.removeEventListener("pointermove", onMove);
  }, []);

  return ref;
}

/** Número que corre até o valor novo. Escreve textContent direto. */
export function useCountUp<T extends HTMLElement = HTMLSpanElement>(
  value: number,
  format: (n: number) => string = (n) => String(Math.round(n))
) {
  const ref = useRef<T>(null);
  const from = useRef(value);
  const fmt = useRef(format);
  fmt.current = format;

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (!motionOn()) {
      el.textContent = fmt.current(value);
      from.current = value;
      return;
    }
    const obj = { n: from.current };
    const tween = gsap.to(obj, {
      n: value,
      duration: d(0.6),
      ease: EASE,
      onUpdate: () => {
        el.textContent = fmt.current(obj.n);
      },
    });
    from.current = value;
    return () => {
      tween.kill();
    };
  }, [value]);

  return ref;
}

/**
 * Chacoalhada curta — usada em erro. Dispara também na montagem: os painéis de
 * erro só existem quando já há erro, então pular o primeiro render mataria o
 * efeito justo na hora que ele importa.
 */
export function useShake<T extends HTMLElement = HTMLDivElement>(trigger: unknown) {
  const ref = useRef<T>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el || !trigger || !motionOn() || level === "reduzidas") return;
    gsap.fromTo(
      el,
      { x: -6 },
      { x: 0, duration: 0.5, ease: "elastic.out(1, 0.35)", clearProps: "x" }
    );
  }, [trigger]);

  return ref;
}

/**
 * Uma linha por ferramenta: entrada em cascata dos blocos de nível 1.
 *
 * Os botões de ação já tiveram efeito magnético (seguiam o cursor); saiu a
 * pedido — botão que foge do ponteiro atrapalha clicar em "salvar". O feedback
 * de hover/press agora é só do `.btn` no index.css.
 */
export function useToolEnter<T extends HTMLElement = HTMLDivElement>() {
  const ref = useRef<T>(null);

  useGSAP(
    () => {
      if (!ref.current || !motionOn()) return;
      const blocos = ref.current.querySelectorAll(":scope > *");
      if (!blocos.length) return;
      // O último bloco da cascata é quase sempre a CTA de salvar — e era
      // justamente ela que ficava invisível quando o tween não terminava.
      return safeFrom(
        blocos,
        { opacity: 0, y: px(12) },
        { y: 0, duration: d(0.4), ease: EASE, stagger: { amount: d(0.2) } },
        d(0.4) + d(0.2)
      );
    },
    { scope: ref }
  );

  return ref;
}

/**
 * Revela mídia que acabou de decodificar (img/canvas). Chamar no `onLoad`, não
 * na montagem: o `<img>` monta vazio e um fade no mount só mostraria o buraco.
 */
export function revealMedia(el: Element | null) {
  if (!el || !motionOn()) return;
  gsap.fromTo(
    el,
    { opacity: 0, scale: level === "reduzidas" ? 1 : 1.06 },
    { opacity: 1, scale: 1, duration: d(0.45), ease: EASE, clearProps: "scale" }
  );
}

/**
 * Tira o elemento de cena e só então avisa quem remove do estado — sem isso o
 * React desmonta antes de qualquer animação rodar.
 *
 * ponytail: os irmãos dão um salto ao reflow. Se incomodar, o upgrade é o
 * plugin Flip do GSAP para animar o reposicionamento da grade.
 */
export function animateOut(el: Element | null, done: () => void) {
  if (!el || !motionOn()) {
    done();
    return;
  }
  gsap.to(el, {
    opacity: 0,
    scale: level === "reduzidas" ? 1 : 0.82,
    duration: d(0.26),
    ease: "power2.in",
    onComplete: done,
  });
}

/**
 * Pulso imperativo numa superfície — confirma uma ação (página marcada,
 * arquivo adicionado) sem precisar de estado extra.
 */
export function usePulse() {
  return useCallback((el: Element | null) => {
    if (!el || !motionOn() || level === "reduzidas") return;
    gsap.fromTo(
      el,
      { scale: 0.94 },
      { scale: 1, duration: 0.4, ease: "back.out(2.2)", clearProps: "scale" }
    );
  }, []);
}
