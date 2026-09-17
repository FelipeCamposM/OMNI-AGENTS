import { aplicarPaleta } from "../lib/aplicarTema";

/** Aparência que o PC publicou. Tudo opcional: PC antigo não publica, e o celular cai no padrão. */
export interface TemaPublicado {
  accent?: string;
  theme?: string;
  background?: string;
  glass?: string;
}

const CHAVE = "omni-tema";

/** Fundos que existem só em CSS. Os efeitos animados do PC são WebGL — no celular gastariam bateria
 *  à toa — e a imagem própria mora no disco do PC; os dois viram a grade de pixels, que é o mesmo
 *  visual parado. */
const FUNDOS_CSS = new Set(["pixel-grid", "mesh-1", "mesh-2", "mesh-3", "nenhum"]);
const RELEVOS = new Set(["sutil", "medio", "forte"]);

/** Último tema recebido. É o que pinta a tela de pareamento e o primeiro quadro, antes de o
 *  servidor responder — sem isto o app piscaria laranja até a primeira leitura. */
export function temaGuardado(): TemaPublicado | null {
  try {
    const valor = JSON.parse(localStorage.getItem(CHAVE) ?? "null");
    return valor && typeof valor === "object" ? valor : null;
  } catch {
    return null;
  }
}

export function guardarTema(tema: TemaPublicado) {
  try { localStorage.setItem(CHAVE, JSON.stringify(tema)); } catch { /* sem armazenamento: vale só agora */ }
}

/**
 * Aplica no documento a mesma aparência do PC: paleta, claro/escuro, fundo e relevo dos painéis.
 * Devolve a função que para de acompanhar o tema do sistema (quando o PC usa "Sistema", quem
 * decide é o celular).
 */
export function aplicarTema(tema: TemaPublicado | null): () => void {
  const root = document.documentElement;
  root.dataset.bg = FUNDOS_CSS.has(tema?.background ?? "") ? tema!.background! : "pixel-grid";
  root.dataset.glass = RELEVOS.has(tema?.glass ?? "") ? tema!.glass! : "forte";

  const aplicar = (claro: boolean) => {
    aplicarPaleta(root, tema?.accent, claro);
    // A barra de status do celular acompanha o fundo do tema, claro ou escuro.
    const fundo = getComputedStyle(root).getPropertyValue("--c-bg-primary").trim().split(/\s+/).join(",");
    if (fundo) document.querySelector('meta[name="theme-color"]')?.setAttribute("content", `rgb(${fundo})`);
  };

  if (tema?.theme !== "sistema") {
    aplicar(tema?.theme === "claro");
    return () => {};
  }
  const media = window.matchMedia?.("(prefers-color-scheme: light)");
  const seguir = () => aplicar(Boolean(media?.matches));
  seguir();
  media?.addEventListener?.("change", seguir);
  return () => media?.removeEventListener?.("change", seguir);
}
