/**
 * Paletas de cor do aplicativo.
 *
 * Fonte única das cores de destaque: as CSS vars (`--c-accent`,
 * `--c-selected`, …) são escritas a partir daqui pelo `useSettings`, e os
 * efeitos de fundo em WebGL recebem os hexadecimais como props — eles não
 * enxergam CSS. Duplicar a tabela em `index.css` faria a cor do canvas e a
 * cor da interface divergirem no dia em que alguém mexesse só num lado.
 *
 * Cada paleta declara **duas** cores; o resto é derivado (ver `coresDoEfeito`).
 * Duas porque é o mínimo que descreve um degradê: a cor e a sua sombra.
 */

export interface Paleta {
  /** Gravado em `settings.accent`. Trocar reseta a escolha de quem já usava. */
  id: string;
  label: string;
  /** Cor principal: ícones, foco, opção ligada, barra de rolagem, fundo animado. */
  base: string;
  /** Variação fechada: hover, crista da onda, brilho interno da rolagem. */
  deep: string;
  /**
   * Ajuste para o tema claro. Texto branco sobre a cor precisa de contraste, e
   * quase toda base clara reprova num fundo branco — sem isto, "Ciano" no tema
   * claro vira botão ilegível.
   */
  claro?: { base: string; deep: string };
}

export const PALETAS: Paleta[] = [
  {
    id: "roxo",
    label: "Roxo",
    base: "#A855F7",
    deep: "#8300FF",
    claro: { base: "#7C3AED", deep: "#6D28D9" },
  },
  {
    id: "indigo",
    label: "Índigo",
    // As cores que o app usava como `--c-accent` antes das paletas existirem.
    base: "#818CF8",
    deep: "#6366F1",
    claro: { base: "#4F46E5", deep: "#4338CA" },
  },
  {
    id: "azul",
    label: "Azul",
    base: "#3B82F6",
    deep: "#1D4ED8",
    claro: { base: "#2563EB", deep: "#1E40AF" },
  },
  {
    id: "ciano",
    label: "Ciano",
    base: "#22D3EE",
    deep: "#0891B2",
    claro: { base: "#0E7490", deep: "#155E75" },
  },
  {
    id: "verde",
    label: "Verde",
    base: "#34D399",
    deep: "#059669",
    claro: { base: "#047857", deep: "#065F46" },
  },
  {
    id: "ambar",
    label: "Âmbar",
    base: "#FBBF24",
    deep: "#D97706",
    claro: { base: "#B45309", deep: "#92400E" },
  },
  {
    id: "rosa",
    label: "Rosa",
    base: "#F472B6",
    deep: "#DB2777",
    claro: { base: "#DB2777", deep: "#9D174D" },
  },
  {
    id: "vermelho",
    label: "Vermelho",
    base: "#F87171",
    deep: "#DC2626",
    claro: { base: "#DC2626", deep: "#991B1B" },
  },
];

export const PALETA_PADRAO = "roxo";

export function getPaleta(id: string | undefined): Paleta {
  return PALETAS.find((p) => p.id === id) ?? PALETAS[0];
}

/** Cores efetivas da paleta no tema em uso. */
export function coresDaPaleta(id: string | undefined, temaClaro: boolean) {
  const p = getPaleta(id);
  return temaClaro && p.claro ? p.claro : { base: p.base, deep: p.deep };
}

/* ── Conversão ─────────────────────────────────────────────────────────── */

function componentes(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  const largo = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  const n = parseInt(largo, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function paraHex(r: number, g: number, b: number): string {
  const bt = (v: number) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0");
  return `#${bt(r)}${bt(g)}${bt(b)}`;
}

/**
 * `#RRGGBB` → `"r g b"`, que é o formato das CSS vars deste projeto.
 * As vars guardam os componentes soltos justamente para o Tailwind conseguir
 * aplicar alfa (`rgb(var(--c-accent) / 0.4)`) — um hex ali não permitiria.
 */
export function hexParaRgbCss(hex: string): string {
  return componentes(hex).join(" ");
}

/** Mistura linear entre duas cores. `t=0` devolve `a`, `t=1` devolve `b`. */
export function misturar(a: string, b: string, t: number): string {
  const [r1, g1, b1] = componentes(a);
  const [r2, g2, b2] = componentes(b);
  return paraHex(r1 + (r2 - r1) * t, g1 + (g2 - g1) * t, b1 + (b2 - b1) * t);
}

/** Clareia em direção ao branco. */
export function clarear(hex: string, t: number): string {
  return misturar(hex, "#FFFFFF", t);
}

/** Escurece em direção ao preto. */
export function escurecer(hex: string, t: number): string {
  return misturar(hex, "#000000", t);
}

/* ── Cores dos fundos animados ─────────────────────────────────────────── */

export interface CoresEfeito {
  /** Ondas: horizonte, corpo da onda, crista. */
  ondas: { horizonte: string; onda: string; crista: string };
  /** Linhas flutuantes: degradê de três paradas. */
  linhas: [string, string, string];
}

/**
 * Deriva as cores do canvas a partir da paleta.
 *
 * Derivar em vez de listar à mão: eram 5 cores por paleta × 8 paletas, e a
 * chance de alguém acrescentar uma paleta esquecendo metade delas é alta.
 * Os fatores foram escolhidos para reproduzir o visual original do roxo
 * (`#8944ff`/`#A855F7`/`#8300ff` nas ondas, `#7C3AED`/`#A855F7`/`#c73bf6` nas
 * linhas), que era feito à mão.
 */
export function coresDoEfeito(id: string | undefined): CoresEfeito {
  const { base, deep } = getPaleta(id);
  return {
    ondas: { horizonte: misturar(base, deep, 0.5), onda: base, crista: deep },
    linhas: [escurecer(base, 0.28), base, clarear(base, 0.14)],
  };
}
