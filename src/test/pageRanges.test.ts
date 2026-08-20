import { describe, it, expect } from "vitest";
import {
  formatSelection,
  parseRanges,
  parseSelection,
  togglePage,
} from "../lib/pageRanges";

describe("parseRanges", () => {
  it("lê números soltos e intervalos", () => {
    expect(parseRanges("1-3, 7, 10-12")).toEqual([
      [1, 3],
      [7, 7],
      [10, 12],
    ]);
  });

  it("aceita ponto e vírgula e espaço como separador", () => {
    expect(parseRanges("1 2;3")).toEqual([
      [1, 1],
      [2, 2],
      [3, 3],
    ]);
  });

  it("normaliza intervalo invertido", () => {
    expect(parseRanges("9-4")).toEqual([[4, 9]]);
  });

  it("ignora token incompleto enquanto se digita", () => {
    expect(parseRanges("1-3, 7-")).toEqual([[1, 3]]);
    expect(parseRanges("abc")).toEqual([]);
  });

  it("corta pelo total de páginas", () => {
    expect(parseRanges("1-99", 5)).toEqual([[1, 5]]);
    expect(parseRanges("8-9", 5)).toEqual([]);
  });
});

describe("parseSelection", () => {
  it("achata intervalos em páginas", () => {
    expect([...parseSelection("1-3, 5")]).toEqual([1, 2, 3, 5]);
  });

  it("não duplica páginas de intervalos sobrepostos", () => {
    expect(parseSelection("1-4, 3-6").size).toBe(6);
  });
});

describe("formatSelection", () => {
  it("colapsa sequências", () => {
    expect(formatSelection([1, 2, 3, 7, 10, 11])).toBe("1-3, 7, 10-11");
  });

  it("ordena e remove duplicatas", () => {
    expect(formatSelection([5, 1, 5, 2])).toBe("1-2, 5");
  });

  it("vazio vira string vazia", () => {
    expect(formatSelection([])).toBe("");
  });

  it("é o inverso de parseSelection", () => {
    const texto = "2-4, 9, 12-14";
    expect(formatSelection(parseSelection(texto))).toBe(texto);
  });
});

describe("togglePage", () => {
  it("adiciona e remove sem mutar o original", () => {
    const base = new Set([1, 2]);
    const add = togglePage(base, 3);
    expect([...add]).toEqual([1, 2, 3]);
    expect([...base]).toEqual([1, 2]);
    expect([...togglePage(add, 2)]).toEqual([1, 3]);
  });
});
