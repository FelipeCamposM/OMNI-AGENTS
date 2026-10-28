import { describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";
import { chaveDaFerramenta, chaveDoIcone } from "../features/extensoes/chaveDoIcone";
import { usarBuscadorDeIcone, type Mensagem } from "../mobile/api";
import { BlocoDeAcoes } from "../mobile/Chat";

describe("chave do ícone", () => {
  it("a da aba Extensões e a da ferramenta na conversa batem", () => {
    expect(chaveDoIcone("https://stitch.googleapis.com/mcp", "stitch")).toBe("mcp:stitch");
    expect(chaveDaFerramenta("mcp__stitch__generate_screen_from_text")).toBe("mcp:stitch");
    expect(chaveDoIcone("pacote:https://github.com/vercel", "vercel")).toBe("plugin:vercel");
    expect(chaveDaFerramenta("mcp__plugin_vercel_vercel__deploy")).toBe("plugin:vercel");
    expect(chaveDoIcone("conector:claude.ai Google Drive", "claude.ai Google Drive")).toBe("conector:google drive");
    expect(chaveDaFerramenta("mcp__claude_ai_Google_Drive__search")).toBe("conector:google drive");
    expect(chaveDaFerramenta("Bash")).toBeNull();
    expect(chaveDaFerramenta(undefined)).toBeNull();
  });

  it("ação de MCP mostra a marca de quem foi chamado", async () => {
    usarBuscadorDeIcone(async (chave) => (chave === "mcp:stitch" ? "data:image/png;base64,SS==" : null));
    const acoes = [{ id: "1", kind: "tool", role: "assistant", text: "tela nova", tool: "mcp__stitch__generate_screen_from_text" }] as unknown as Mensagem[];
    const { container } = render(<BlocoDeAcoes acoes={acoes} aoVivo />);
    await vi.waitFor(() => expect(container.querySelector("img.acao-icone-marca")).toHaveAttribute("src", "data:image/png;base64,SS=="));
  });
});
