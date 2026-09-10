import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import type { SVGProps } from "react";
import * as PixelIcon from "../components/ui/PixelIcon";

type IconComponent = (props: SVGProps<SVGSVGElement> & { size?: number | string }) => JSX.Element;

const icons = Object.entries(PixelIcon) as [string, IconComponent][];

function pathOf(Icon: IconComponent) {
  const { container } = render(<Icon />);
  return container.querySelector("path")?.getAttribute("d") ?? "";
}

describe("PixelIcon", () => {
  it("exporta todos os ícones que a barra lateral consome", () => {
    // Se um nome sumir daqui, o import quebra em runtime e não no typecheck de quem gera.
    const required = [
      "ChatIcon", "TerminalIcon", "ListIcon", "DockerIcon", "FolderIcon", "FolderPlusIcon",
      "BookIcon", "GitBranchIcon", "KanbanIcon", "ChevronDownIcon",
      "CloseIcon", "CopyIcon", "ReloadIcon",
      "PlayIcon", "AlertIcon", "WarningIcon", "CircleIcon", "ZapOffIcon",
    ];
    expect(Object.keys(PixelIcon)).toEqual(expect.arrayContaining(required));
  });

  it("todo ícone renderiza um path com geometria de verdade", () => {
    for (const [name, Icon] of icons) {
      const path = pathOf(Icon);
      expect(path.length, `${name} saiu sem path`).toBeGreaterThan(10);
      // Path de pixel-art é só retângulo: M/m e h/v/z. Uma curva aqui denuncia que o arquivo foi
      // editado à mão ou que o gerador pegou o SVG errado.
      expect(path, `${name} tem curva — não é pixel-art`).not.toMatch(/[CcSsQqTtAa]/);
    }
  });

  it("nenhum ícone repete o desenho de outro", () => {
    // Duas entradas do mapa ICONS apontando pro mesmo arquivo passariam despercebidas: os dois
    // lugares da UI ficariam com o mesmo símbolo e ninguém liga os pontos olhando a tela.
    const seen = new Map<string, string>();
    for (const [name, Icon] of icons) {
      const path = pathOf(Icon);
      const previous = seen.get(path);
      expect(previous, `${name} desenha igual a ${previous}`).toBeUndefined();
      seen.set(path, name);
    }
  });

  it("respeita o tamanho pedido e herda a cor do texto", () => {
    const { container } = render(<PixelIcon.CloseIcon size={12} />);
    const svg = container.querySelector("svg");
    expect(svg).toHaveAttribute("width", "12");
    expect(svg).toHaveAttribute("viewBox", "0 0 24 24");
    expect(container.querySelector("path")).toHaveAttribute("fill", "currentColor");
  });
});
