import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { invoke } from "@tauri-apps/api/core";
import { ExtensoesSettings } from "../features/extensoes/ExtensoesSettings";

vi.mock("@tauri-apps/plugin-opener", () => ({ revealItemInDir: vi.fn(async () => undefined) }));

const mcp = (nome: string, escopo: string, pasta: string | null = null) =>
  ({ nome, escopo, tipo: "http", destino: `https://${nome}.dev/mcp`, variaveis: nome === "stitch" ? ["X-Goog-Api-Key"] : [], ativo: true, pasta, arquivo: "C:/u/.claude.json" });

it("mostra MCPs, plugins e conectores por IA e por conta, dizendo onde cada MCP vale", async () => {
  vi.mocked(invoke).mockReset().mockImplementation(async (comando) => {
    if (comando !== "listar_extensoes") return null;
    return [
      { provider: "claude", conta_id: "a", conta_nome: "Padrão", arquivos: ["C:/u/.claude.json"],
        mcps: [mcp("stitch", "global"), mcp("n8n", "pasta", "C:/outra"), mcp("firecrawl", "pasta", "D:/proj")],
        plugins: [{ nome: "vercel", origem: "claude-plugins-official", ativo: true, versao: "0.50.0", escopo: "user", arquivo: "x" }],
        conectores: ["Gmail", "Notion"] },
      { provider: "claude", conta_id: "b", conta_nome: "Trabalho", arquivos: [], mcps: [], plugins: [], conectores: [] },
      { provider: "codex", conta_id: "c", conta_nome: "Padrão", arquivos: [], mcps: [mcp("node_repl", "global")], plugins: [], conectores: [] },
    ];
  });
  render(<ExtensoesSettings projectPath="D:\proj" />);

  const padrao = await screen.findByRole("region", { name: "Conta Padrão" });
  expect(within(padrao).getByText("stitch")).toBeInTheDocument();
  expect(within(padrao).getByText("X-Goog-Api-Key")).toBeInTheDocument();
  expect(within(padrao).getByText("Só em proj")).toBeInTheDocument();
  // MCP de outra pasta aparece, mas avisa que não vale no projeto aberto.
  expect(within(padrao).getAllByText("Não vale neste projeto")).toHaveLength(1);
  // Conta sem MCP mostra como adicionar.
  expect(within(screen.getByRole("region", { name: "Conta Trabalho" })).getByText(/claude mcp add/)).toBeInTheDocument();

  await userEvent.click(screen.getByRole("tab", { name: /^Conectores/ }));
  expect(await screen.findByText("Gmail")).toBeInTheDocument();

  await userEvent.click(screen.getByRole("tab", { name: /^Codex/ }));
  await waitFor(() => expect(screen.getByText("node_repl")).toBeInTheDocument());
  // Codex não tem conectores do claude.ai: a aba some e volta para MCPs.
  expect(screen.queryByRole("tab", { name: /^Conectores/ })).not.toBeInTheDocument();
});

it("foto da extensão: logo do plugin, marca conhecida ou inicial", async () => {
  const { render } = await import("@testing-library/react");
  const { IconeDaExtensao } = await import("../features/extensoes/IconeDaExtensao");
  const { container, rerender } = render(<IconeDaExtensao nome="ponytail" logo="data:image/png;base64,AA==" />);
  expect(container.querySelector("img")).toHaveAttribute("src", "data:image/png;base64,AA==");
  rerender(<IconeDaExtensao nome="meu-mcp" destino="https://api.github.com/mcp" />);
  expect(container.querySelector(".ext-foto.is-marca svg")).not.toBeNull();
  rerender(<IconeDaExtensao nome="Notion" />);
  expect(container.querySelector(".ext-foto")).toHaveTextContent("N");
});
