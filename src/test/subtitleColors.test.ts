import { describe, it, expect } from "vitest";
import {
  DISTANCIA_MINIMA_COR,
  SUBTITLE_STYLE_COLORS,
  distanciaCor,
} from "../services/conversionService";

/**
 * Espelho, em TS, da regra travada em python/test_subtitles.py. Os dois lados
 * precisam concordar: o Python impede o preset ruim, o TS avisa o usuário.
 */
describe("distanciaCor", () => {
  it("cores iguais dão zero", () => {
    expect(distanciaCor("#A855F7", "#A855F7")).toBe(0);
  });

  it("preto e branco é a distância máxima", () => {
    expect(distanciaCor("#000000", "#FFFFFF")).toBeCloseTo(441.67, 1);
  });

  it("aceita maiúscula e minúscula", () => {
    expect(distanciaCor("#ffd24a", "#FFD24A")).toBe(0);
  });
});

describe("cores padrão dos presets", () => {
  it("nenhum preset nasce com destaque ilegível", () => {
    // Era o bug: no Karaokê o destaque era idêntico ao contorno (distância 0).
    for (const [nome, c] of Object.entries(SUBTITLE_STYLE_COLORS)) {
      expect(distanciaCor(c.destaque, c.contorno), nome).toBeGreaterThan(
        DISTANCIA_MINIMA_COR
      );
    }
  });

  it("o texto contrasta com o próprio contorno", () => {
    for (const [nome, c] of Object.entries(SUBTITLE_STYLE_COLORS)) {
      expect(distanciaCor(c.cor, c.contorno), nome).toBeGreaterThan(60);
    }
  });

  it("o roxo antigo reprovaria nos presets de contorno roxo", () => {
    // Guarda contra alguém "restaurar" o valor antigo achando que era melhor.
    expect(distanciaCor("#A855F7", SUBTITLE_STYLE_COLORS.karaoke.contorno)).toBe(0);
    expect(
      distanciaCor("#A855F7", SUBTITLE_STYLE_COLORS.neon.contorno)
    ).toBeLessThan(DISTANCIA_MINIMA_COR);
  });
});
