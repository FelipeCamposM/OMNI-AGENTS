import { afterEach, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const request = vi.fn();
vi.mock("../mobile/api", () => ({ request: (...args: unknown[]) => request(...args) }));
const { TrabalhoAoVivo, pedidoDeParada } = await import("../mobile/TrabalhoAoVivo");

afterEach(() => request.mockReset());

const rodando = { id: "a1", tipo: "Explore", descricao: "Mapear rotas", estado: "rodando", ultima_acao: "Bash npm test", atualizado_ms: Date.now() };
const pronto = { id: "a2", tipo: "general-purpose", descricao: "Rodar testes", estado: "concluido", ultima_acao: null, atualizado_ms: Date.now() };

it("lista os subagentes, abre o histórico de um e para só aquele", async () => {
  request.mockImplementation(async (path: string) => {
    if (path === "/conversas/c1/subagentes") return { subagentes: [rodando, pronto] };
    if (path === "/conversas/c1/subagentes/a1") return { timeline: { messages: [{ id: "m1", role: "assistant", kind: "tool", tool: "Bash", text: "rg rotas", provider: "claude" }] } };
    if (path === "/conversas/c1/subagentes/a1/parar") return { ok: true, na_tela: true };
    return { ok: true };
  });
  render(<TrabalhoAoVivo conversaId="c1" provider="claude" ativo live />);

  expect(await screen.findByText("Mapear rotas")).toBeInTheDocument();
  expect(screen.getByText("Bash npm test")).toBeInTheDocument();
  expect(screen.getAllByRole("button", { name: "Parar" })).toHaveLength(1);

  await userEvent.click(screen.getAllByRole("button", { name: "Ver" })[0]);
  expect(await screen.findByText("rg rotas")).toBeInTheDocument();

  // O engine parou pelo painel da CLI: não precisa pedir ao agente.
  await userEvent.click(screen.getByRole("button", { name: "Parar" }));
  expect(request).toHaveBeenCalledWith("/conversas/c1/subagentes/a1/parar", { method: "POST" });
  expect(request).not.toHaveBeenCalledWith("/conversas/c1/prompt", expect.anything());
});

it("sem achar a linha no painel, pede ao agente para parar só aquele", async () => {
  request.mockImplementation(async (path: string) => {
    if (path === "/conversas/c1/subagentes") return { subagentes: [rodando] };
    if (path === "/conversas/c1/subagentes/a1/parar") return { ok: true, na_tela: false };
    return { ok: true };
  });
  render(<TrabalhoAoVivo conversaId="c1" provider="claude" ativo live />);
  await userEvent.click(await screen.findByRole("button", { name: "Parar" }));
  expect(request).toHaveBeenCalledWith("/conversas/c1/prompt", expect.objectContaining({
    method: "POST", body: JSON.stringify({ texto: pedidoDeParada(rodando), fila: true }),
  }));
  expect(pedidoDeParada(rodando)).toContain("a1");
});

it("Codex não tem subagentes: não consulta", () => {
  render(<TrabalhoAoVivo conversaId="c1" provider="codex" ativo={false} live={false} />);
  expect(request).not.toHaveBeenCalled();
});
