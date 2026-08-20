import { describe, it, expect } from "vitest";
import {
  PALETAS,
  PALETA_PADRAO,
  clarear,
  coresDaPaleta,
  coresDoEfeito,
  escurecer,
  getPaleta,
  hexParaRgbCss,
  misturar,
} from "../lib/palettes";

describe("conversão de cor", () => {
  it("hex vira os componentes soltos que as CSS vars esperam", () => {
    // As vars guardam "r g b" (sem `rgb()`) para o Tailwind poder aplicar alfa.
    // Devolver "#A855F7" aqui não quebra o build — só apaga a cor na tela.
    expect(hexParaRgbCss("#A855F7")).toBe("168 85 247");
    expect(hexParaRgbCss("#000000")).toBe("0 0 0");
    expect(hexParaRgbCss("#fff")).toBe("255 255 255");
  });

  it("mistura anda de uma ponta à outra", () => {
    expect(misturar("#000000", "#FFFFFF", 0)).toBe("#000000");
    expect(misturar("#000000", "#FFFFFF", 1)).toBe("#ffffff");
    expect(misturar("#000000", "#FFFFFF", 0.5)).toBe("#808080");
    expect(clarear("#808080", 1)).toBe("#ffffff");
    expect(escurecer("#808080", 1)).toBe("#000000");
  });
});

describe("paletas", () => {
  it("id desconhecido cai na primeira em vez de deixar o app sem cor", () => {
    expect(getPaleta("xpto").id).toBe(PALETAS[0].id);
    expect(getPaleta(undefined).id).toBe(PALETAS[0].id);
  });

  it("a paleta padrão existe", () => {
    expect(PALETAS.some((p) => p.id === PALETA_PADRAO)).toBe(true);
  });

  it("toda paleta declara a variante do tema claro", () => {
    // Sem ela, a cor pensada para fundo escuro vira botão ilegível no claro —
    // e o defeito só aparece para quem usa o tema claro. Paleta nova reprova
    // aqui em vez de reprovar na cara do usuário.
    for (const p of PALETAS) {
      expect(p.claro, `paleta "${p.id}" sem variante clara`).toBeTruthy();
    }
  });

  it("o tema claro usa a variante, o escuro usa a base", () => {
    const p = getPaleta("ciano");
    expect(coresDaPaleta("ciano", false)).toEqual({ base: p.base, deep: p.deep });
    expect(coresDaPaleta("ciano", true)).toEqual(p.claro);
  });
});

describe("cores dos fundos animados", () => {
  it("seguem a paleta escolhida", () => {
    const p = getPaleta("verde");
    const c = coresDoEfeito("verde");
    expect(c.ondas.onda).toBe(p.base);
    expect(c.ondas.crista).toBe(p.deep);
    expect(c.linhas[1]).toBe(p.base);
  });

  it("o degradê das linhas vai de escuro a claro", () => {
    // Três paradas iguais deixariam o efeito chapado; a ordem errada inverte
    // a profundidade. Comparo a soma dos canais como proxy de luminosidade.
    const soma = (hex: string) =>
      [1, 3, 5].reduce((t, i) => t + parseInt(hex.slice(i, i + 2), 16), 0);
    for (const p of PALETAS) {
      const [escura, meio, clara] = coresDoEfeito(p.id).linhas;
      expect(soma(escura), p.id).toBeLessThan(soma(meio));
      expect(soma(clara), p.id).toBeGreaterThan(soma(meio));
    }
  });

  it("trocar de paleta troca as cores do canvas", () => {
    // O canvas não enxerga CSS var: se as cores parassem de vir da paleta, a
    // interface mudaria de cor e o fundo continuaria roxo.
    expect(coresDoEfeito("roxo")).not.toEqual(coresDoEfeito("ambar"));
  });
});
