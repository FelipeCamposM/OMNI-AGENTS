import type { LayoutPreset } from "../../types/workspace";

/**
 * Molde de um layout pronto: um painel (`"p"`) ou uma divisão — `h` lado a lado, `v` em cima e
 * embaixo, `r` a fração do primeiro lado. O mesmo molde monta a árvore (`buildPresetLayout`) e
 * desenha a miniatura do seletor, então layout novo é uma linha na lista.
 */
export type Molde = "p" | { d: "h" | "v"; r: number; a: Molde; b: Molde };

const P = "p";
const h = (a: Molde, b: Molde, r = 0.5): Molde => ({ d: "h", r, a, b });
const v = (a: Molde, b: Molde, r = 0.5): Molde => ({ d: "v", r, a, b });
/** `n` partes iguais: a primeira leva 1/n e o resto divide o que sobra. */
const colunas = (n: number): Molde => (n === 1 ? P : h(P, colunas(n - 1), 1 / n));
const linhas = (n: number): Molde => (n === 1 ? P : v(P, linhas(n - 1), 1 / n));

export const LAYOUT_PRESETS: { id: LayoutPreset; label: string; molde: Molde }[] = [
  { id: "columns-2", label: "2 colunas", molde: colunas(2) },
  { id: "columns-3", label: "3 colunas", molde: colunas(3) },
  { id: "columns-4", label: "4 colunas", molde: colunas(4) },
  { id: "rows-2", label: "2 linhas", molde: linhas(2) },
  { id: "rows-3", label: "3 linhas", molde: linhas(3) },
  { id: "grid-2x2", label: "Grade 2×2", molde: h(linhas(2), linhas(2)) },
  { id: "grid-3x2", label: "Grade 3×2", molde: h(linhas(2), h(linhas(2), linhas(2)), 1 / 3) },
  { id: "main-plus-side", label: "Principal + lateral", molde: h(P, linhas(2), 0.6) },
  { id: "side-plus-main", label: "Lateral + principal", molde: h(linhas(2), P, 0.4) },
  { id: "main-plus-3", label: "Principal + 3", molde: h(P, linhas(3), 0.6) },
  { id: "main-top", label: "Principal em cima", molde: v(P, colunas(2), 0.6) },
  { id: "main-bottom", label: "Principal embaixo", molde: v(colunas(2), P, 0.4) },
];

export function quantosPaineis(molde: Molde): number {
  return molde === P ? 1 : quantosPaineis(molde.a) + quantosPaineis(molde.b);
}

export interface Retangulo { x: number; y: number; w: number; h: number }

/** Retângulo de cada painel do molde, na ordem em que são preenchidos, com `vao` entre eles. */
export function celulas(molde: Molde, area: Retangulo, vao: number): Retangulo[] {
  if (molde === P) return [area];
  if (molde.d === "h") {
    const w = Math.round((area.w - vao) * molde.r);
    return [...celulas(molde.a, { ...area, w }, vao), ...celulas(molde.b, { ...area, x: area.x + w + vao, w: area.w - w - vao }, vao)];
  }
  const altura = Math.round((area.h - vao) * molde.r);
  return [...celulas(molde.a, { ...area, h: altura }, vao), ...celulas(molde.b, { ...area, y: area.y + altura + vao, h: area.h - altura - vao }, vao)];
}
