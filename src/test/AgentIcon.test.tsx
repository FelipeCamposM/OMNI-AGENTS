import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { AGENT_ICON, AgentIcon, ClaudeIcon, CursorIcon, GptIcon } from "../components/ui/AgentIcon";

function svgOf(ui: React.ReactElement) {
  return render(ui).container.querySelector("svg");
}

describe("AgentIcon", () => {
  it("cobre as três CLIs que o app sabe abrir", () => {
    expect(Object.keys(AGENT_ICON).sort()).toEqual(["claude", "codex", "cursor"]);
  });

  it("não renderiza nada para provider desconhecido, nulo ou ausente", () => {
    // O ícone entra em linhas que também existem sem provider (terminal puro, aba recém-criada);
    // devolver um svg vazio deixaria um buraco de 14px no alinhamento.
    for (const provider of ["gemini", null, undefined]) {
      expect(svgOf(<AgentIcon provider={provider} />)).toBeNull();
    }
  });

  it("cada marca desenha só retângulos — é pixel art, não logo vetorial", () => {
    for (const [name, Icon] of Object.entries({ ClaudeIcon, GptIcon, CursorIcon })) {
      const d = render(<Icon />).container.querySelector("path")?.getAttribute("d") ?? "";
      expect(d.length, `${name} saiu sem path`).toBeGreaterThan(10);
      expect(d, `${name} tem curva`).not.toMatch(/[CcSsQqTtAa]/);
    }
  });

  it("Claude nasce na cor da marca; Codex e Cursor herdam a cor do texto", () => {
    // A marca da OpenAI e a do Cursor são pretas: fixá-las sumiria no tema escuro.
    expect(svgOf(<ClaudeIcon />)).toHaveAttribute("fill", "#d97757");
    expect(svgOf(<GptIcon />)).toHaveAttribute("fill", "currentColor");
    expect(svgOf(<CursorIcon />)).toHaveAttribute("fill", "currentColor");
    expect(svgOf(<ClaudeIcon fill="currentColor" />)).toHaveAttribute("fill", "currentColor");
  });

  it("respeita o tamanho pedido sem esticar o desenho", () => {
    const svg = svgOf(<AgentIcon provider="codex" size={12} />);
    expect(svg).toHaveAttribute("width", "12");
    expect(svg).toHaveAttribute("height", "12");
    expect(svg).toHaveAttribute("viewBox", "0 0 57 57");
  });
});
