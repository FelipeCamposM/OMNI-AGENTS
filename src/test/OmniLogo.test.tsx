import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { OmniLogo, svgDaLogo, LADO_DA_LOGO, type CamadaDaLogo } from "../components/ui/OmniLogo";
import { PALETAS, coresDaLogo } from "../lib/palettes";

const CAMADAS: CamadaDaLogo[] = ["outline", "shadow", "primary", "secondary", "accent", "highlight"];

describe("OmniLogo", () => {
  it("pinta cada camada por variável CSS, com o laranja como fallback", () => {
    // A var é o mecanismo inteiro do tema: trocar `fill` por cor fixa aqui congelaria a logo.
    const { container } = render(<OmniLogo />);
    const fills = [...container.querySelectorAll("path")].map((p) => p.getAttribute("fill"));
    expect(fills).toHaveLength(CAMADAS.length);
    for (const [i, camada] of CAMADAS.entries()) {
      expect(fills[i]).toMatch(new RegExp(`^var\\(--omni-${camada}, #[0-9A-F]{6}\\)$`));
    }
  });

  it("é pixel art: só retângulos, nenhuma curva", () => {
    const { container } = render(<OmniLogo />);
    for (const path of container.querySelectorAll("path")) {
      expect(path.getAttribute("d")).not.toMatch(/[CcSsQqTtAa]/);
    }
  });

  it("viewBox quadrado para não esmagar num slot w-7 h-7", () => {
    const { container } = render(<OmniLogo />);
    const [, , largura, altura] = container.querySelector("svg")!.getAttribute("viewBox")!.split(" ");
    expect(largura).toBe(altura);
  });

  it("svgDaLogo embute as cores — é o que o ícone da janela rasteriza", () => {
    const cores = coresDaLogo("roxo", false);
    const markup = svgDaLogo(cores, LADO_DA_LOGO * 4);
    expect(markup).not.toContain("var(");
    for (const camada of CAMADAS) expect(markup).toContain(`fill="${cores[camada]}"`);
    expect(markup).toContain(`width="${LADO_DA_LOGO * 4}"`);
  });
});

describe("coresDaLogo", () => {
  it("dá as seis camadas para toda paleta, nos dois temas", () => {
    for (const paleta of PALETAS) {
      for (const claro of [false, true]) {
        const cores = coresDaLogo(paleta.id, claro);
        expect(Object.keys(cores).sort(), paleta.id).toEqual([...CAMADAS].sort());
        for (const camada of CAMADAS) {
          expect(cores[camada], `${paleta.id}/${camada}`).toMatch(/^#[0-9A-Fa-f]{6}$/);
        }
      }
    }
  });

  it("é uma rampa: contorno mais escuro que a cor, e clareados acima dela", () => {
    const luz = (hex: string) => parseInt(hex.slice(1, 3), 16) + parseInt(hex.slice(3, 5), 16) + parseInt(hex.slice(5, 7), 16);
    for (const paleta of PALETAS) {
      const c = coresDaLogo(paleta.id, false);
      expect(luz(c.outline), paleta.id).toBeLessThan(luz(c.primary));
      expect(luz(c.secondary), paleta.id).toBeGreaterThan(luz(c.primary));
      expect(luz(c.accent), paleta.id).toBeGreaterThan(luz(c.secondary));
      expect(c.highlight).toBe("#FFFFFF");
    }
  });

  it("segue a variante clara da paleta", () => {
    // Sem isto a logo ficaria com o tom escuro do tema escuro sobre fundo branco.
    expect(coresDaLogo("roxo", true).primary).toBe(PALETAS.find(p => p.id === "roxo")!.claro!.base);
  });
});
