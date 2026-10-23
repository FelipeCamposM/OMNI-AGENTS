import { useEffect, useRef, useState, type RefObject } from "react";

/** Estilos que mudam onde o texto quebra: o espelho copia todos para o cursor cair no lugar certo. */
const MEDIDAS = [
  "boxSizing", "width", "paddingTop", "paddingRight", "paddingBottom", "paddingLeft",
  "borderTopWidth", "borderRightWidth", "borderBottomWidth", "borderLeftWidth",
  "fontFamily", "fontSize", "fontWeight", "fontStyle", "letterSpacing", "lineHeight",
  "textTransform", "wordSpacing", "tabSize", "textIndent",
] as const;

/**
 * Onde fica o cursor dentro do campo: um `div` invisível com o mesmo estilo recebe o texto até o
 * cursor e um marcador; a posição do marcador é a do cursor. É o jeito padrão — o navegador não
 * expõe as coordenadas do cursor de um `<textarea>`.
 */
function medir(campo: HTMLTextAreaElement) {
  const estilo = getComputedStyle(campo);
  const espelho = document.createElement("div");
  for (const p of MEDIDAS) espelho.style[p] = estilo[p];
  Object.assign(espelho.style, { position: "absolute", visibility: "hidden", top: "0", left: "-9999px", borderStyle: "solid", whiteSpace: "pre-wrap", overflowWrap: "break-word" });
  espelho.textContent = campo.value.slice(0, campo.selectionStart ?? campo.value.length);
  const marca = document.createElement("span");
  marca.textContent = "​";
  espelho.appendChild(marca);
  document.body.appendChild(espelho);
  // A altura da letra, não a da linha: o topo do marcador já é o topo da letra (sem a folga do
  // line-height), e somar a linha inteira a partir dali jogava o cursor para baixo.
  const altura = marca.offsetHeight || parseFloat(estilo.fontSize) * 1.2 || 20;
  const lugar = { x: marca.offsetLeft - campo.scrollLeft, y: marca.offsetTop - campo.scrollTop, altura };
  espelho.remove();
  return lugar;
}

/**
 * Cursor neon desenhado por cima do campo (o nativo fica transparente): bloco grosso na cor do tema,
 * com brilho, que desliza até a nova posição, dá um "soco" de luz a cada tecla e, parado, respira.
 * Some quando há seleção (a seleção do navegador fala por si) e quando o campo perde o foco.
 */
export function CursorNeon({ campo, valor }: { campo: RefObject<HTMLTextAreaElement | null>; valor: string }) {
  const [lugar, setLugar] = useState<{ x: number; y: number; altura: number } | null>(null);
  const [batida, setBatida] = useState(0);
  const [digitando, setDigitando] = useState(false);
  const parou = useRef<number>();

  useEffect(() => {
    const el = campo.current;
    if (!el) return;
    const atualizar = () => requestAnimationFrame(() => {
      setLugar(document.activeElement === el && el.selectionStart === el.selectionEnd ? medir(el) : null);
    });
    const tecla = () => {
      setBatida((b) => b + 1);
      setDigitando(true);
      window.clearTimeout(parou.current);
      parou.current = window.setTimeout(() => setDigitando(false), 550);
      atualizar();
    };
    const eventos = ["focus", "blur", "click", "keyup", "scroll", "select"] as const;
    eventos.forEach((e) => el.addEventListener(e, atualizar));
    el.addEventListener("input", tecla);
    document.addEventListener("selectionchange", atualizar);
    window.addEventListener("resize", atualizar);
    return () => {
      eventos.forEach((e) => el.removeEventListener(e, atualizar));
      el.removeEventListener("input", tecla);
      document.removeEventListener("selectionchange", atualizar);
      window.removeEventListener("resize", atualizar);
      window.clearTimeout(parou.current);
    };
  }, [campo]);

  // Texto trocado de fora (ditado, menção, campo limpo depois de enviar) não dispara `input`.
  useEffect(() => {
    const el = campo.current;
    if (el && document.activeElement === el) requestAnimationFrame(() => setLugar(medir(el)));
  }, [campo, valor]);

  if (!lugar) return null;
  return (
    <span aria-hidden className={`cursor-neon${digitando ? " is-digitando" : ""}`}
      style={{ transform: `translate(${lugar.x}px, ${lugar.y}px)`, height: lugar.altura }}>
      {/* `key` muda a cada tecla: remonta o brilho e a animação do "soco" recomeça. */}
      <span key={batida} className="cursor-neon-luz" />
    </span>
  );
}
