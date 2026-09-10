import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

/**
 * Regressão de identidade referencial. Os efeitos do React Bits guardam as
 * cores em listas de dependência de `useEffect` (ex.: `linesGradient` em
 * FloatingLines.tsx:487, `gridMul` em FaultyTerminal.tsx:487). Se o
 * `<AppBackground>` montar objeto novo a cada render, o efeito destrói e
 * reconstrói o renderer WebGL toda vez — e ele re-renderiza a cada saída de
 * terminal, porque mora no App. Sintoma: app travado e fundo piscando.
 */
const recebidas: unknown[] = [];

vi.mock("../components/backgrounds/registry", async (importOriginal) => {
  const real = await importOriginal<typeof import("../components/backgrounds/registry")>();
  return {
    ...real,
    getBackgroundEffect: () => ({
      id: "fake",
      label: "Fake",
      component: ({ cores }: { cores: unknown }) => {
        recebidas.push(cores);
        return null;
      },
    }),
  };
});

const { AppBackground } = await import("../components/backgrounds/AppBackground");
const { DEFAULT_SETTINGS } = await import("../types/settings");

describe("AppBackground", () => {
  it("mantém a mesma referência de cores entre renders (senão o WebGL remonta)", async () => {
    const { rerender } = render(<AppBackground settings={DEFAULT_SETTINGS} />);
    rerender(<AppBackground settings={DEFAULT_SETTINGS} />);
    rerender(<AppBackground settings={{ ...DEFAULT_SETTINGS }} />);

    expect(recebidas.length).toBeGreaterThanOrEqual(3);
    expect(new Set(recebidas).size).toBe(1);
  });
});
