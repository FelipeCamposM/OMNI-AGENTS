// Fork (Roadmaps): anima a entrada do conteúdo quando `chave` muda (troca de tela ou de aba).
import { useLayoutEffect, useRef, type RefObject } from "react";
import { animarTroca, type Direcao } from "./animacoes";

/** `naPrimeira = false`: não anima ao montar (quando quem está por fora já anima a entrada). */
export function useTransicao<T extends HTMLElement>(chave: string, direcao: Direcao = "neutra", naPrimeira = true): RefObject<T> {
  const ref = useRef<T>(null);
  const montou = useRef(false);
  useLayoutEffect(() => {
    const primeira = !montou.current;
    montou.current = true;
    if (primeira && !naPrimeira) return;
    const animacao = animarTroca(ref.current, direcao);
    return () => animacao?.cancel();
    // A direção vale para a troca que acabou de acontecer.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chave]);
  return ref;
}
