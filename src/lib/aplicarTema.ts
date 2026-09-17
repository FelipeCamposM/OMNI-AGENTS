import { coresDaLogo, coresDaPaleta, hexParaRgbCss } from "./palettes";

/**
 * Escreve no `<html>` as cores da paleta e da logo para o tema já resolvido (claro ou escuro).
 *
 * Mora fora do `useSettings` porque o celular aplica a mesma paleta — a que o PC publicou — e duas
 * cópias deste bloco acabariam divergindo na primeira cor nova. Inline no `<html>` e não uma regra
 * `[data-accent]` no CSS porque a tabela de paletas precisa existir em TS para os efeitos WebGL.
 *
 * Devolve as cores da logo: o desktop ainda as usa para repintar o ícone da janela.
 */
export function aplicarPaleta(root: HTMLElement, accent: string | undefined, claro: boolean) {
  root.dataset.theme = claro ? "claro" : "escuro";
  const { base, deep } = coresDaPaleta(accent, claro);
  root.style.setProperty("--c-accent", hexParaRgbCss(base));
  root.style.setProperty("--c-accent-hover", hexParaRgbCss(deep));
  root.style.setProperty("--c-selected", hexParaRgbCss(base));
  root.style.setProperty("--c-selected-deep", hexParaRgbCss(deep));
  // As seis camadas da logo (`OmniLogo`) pintam por var, então ela acompanha paleta e tema.
  const logo = coresDaLogo(accent, claro);
  for (const [camada, cor] of Object.entries(logo)) {
    root.style.setProperty(`--omni-${camada}`, cor);
  }
  return logo;
}
