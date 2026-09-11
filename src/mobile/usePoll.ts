import { useEffect, type DependencyList } from "react";

const BASE_DELAY_MS = 5_000;
const MAX_DELAY_MS = 60_000;

/**
 * Poll que pausa com a aba oculta **e acorda quando ela volta**.
 *
 * Sem o `visibilitychange` o celular é o pior caso: a aba quase sempre volta de background, então
 * a primeira carga era pulada e a tela ficava vazia — sem erro nenhum — até o próximo tick, o que
 * com o backoff podia chegar a 60s. O mesmo par pausa/acorda já existe em `GradientWaves.tsx`.
 *
 * O token de geração é o que impede duas cadeias de timer vivas ao mesmo tempo: acordar enquanto
 * uma chamada está em voo invalida a cadeia antiga, que morre ao tentar se reagendar.
 */
export function usePoll(run: () => Promise<void>, onError: (reason: unknown) => void, deps: DependencyList) {
  useEffect(() => {
    let cancelled = false;
    let timer: number | undefined;
    let delay = BASE_DELAY_MS;
    let generation = 0;

    async function poll(token: number) {
      if (cancelled || token !== generation) return;
      if (!document.hidden) {
        try {
          await run();
          delay = BASE_DELAY_MS;
        } catch (reason) {
          if (!cancelled && token === generation) onError(reason);
          delay = Math.min(delay * 2, MAX_DELAY_MS);
        }
      }
      if (!cancelled && token === generation) timer = window.setTimeout(() => void poll(token), delay);
    }

    function wake() {
      if (cancelled || document.hidden) return;
      // Voltar para a aba é sinal de que o usuário quer ver o estado agora: recomeça sem esperar
      // o backoff acumulado enquanto ela esteve oculta.
      generation += 1;
      delay = BASE_DELAY_MS;
      window.clearTimeout(timer);
      void poll(generation);
    }

    void poll(generation);
    document.addEventListener("visibilitychange", wake);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", wake);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}
