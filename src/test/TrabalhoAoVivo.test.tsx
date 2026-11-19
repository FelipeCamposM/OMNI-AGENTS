import { afterEach, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const request = vi.fn();
vi.mock("../mobile/api", () => ({ request: (...args: unknown[]) => request(...args), actionKey: () => "chave" }));
const { TrabalhoAoVivo, pedidoDeParada } = await import("../mobile/TrabalhoAoVivo");

afterEach(() => request.mockReset());

const rodando = { id: "a1", tipo: "Explore", descricao: "Mapear rotas", estado: "rodando", ultima_acao: "Bash npm test", atualizado_ms: Date.now() };
const pronto = { id: "a2", tipo: "general-purpose", descricao: "Rodar testes", estado: "concluido", ultima_acao: null, atualizado_ms: Date.now() };

it("lista os subagentes, abre o histórico de um e para só aquele", async () => {
  request.mockImplementation(async (path: string) => {
    if (path === "/conversas/c1/subagentes") return { subagentes: [rodando, pronto] };
    if (path === "/conversas/c1/subagentes/a1") return { timeline: { messages: [{ id: "m1", role: "assistant", kind: "tool", tool: "Bash", text: "rg rotas", provider: "claude" }] } };
    return { ok: true };
  });
  render(<TrabalhoAoVivo conversaId="c1" provider="claude" ativo live />);

  expect(await screen.findByText("Mapear rotas")).toBeInTheDocument();
  expect(screen.getByTitle("Bash npm test")).toHaveTextContent("Bash npm test");
  expect(screen.getByText("1 rodando · 2 no total")).toBeInTheDocument();
  expect(screen.getAllByRole("button", { name: "Parar" })).toHaveLength(1);

  await userEvent.click(screen.getAllByRole("button", { name: "Ver" })[0]);
  expect(await screen.findByText("rg rotas")).toBeInTheDocument();

  // Parar pede ao agente principal (TaskStop) só aquele, com chave de idempotência; o botão trava.
  await userEvent.click(screen.getByRole("button", { name: "Parar" }));
  expect(request).toHaveBeenCalledWith("/conversas/c1/prompt", expect.objectContaining({
    method: "POST", body: JSON.stringify({ texto: pedidoDeParada(rodando), fila: true }),
    headers: expect.objectContaining({ "Idempotency-Key": expect.any(String) }),
  }));
  expect(pedidoDeParada(rodando)).toContain("a1");
  expect(screen.getByRole("button", { name: "Parando…" })).toBeDisabled();
});

it("Codex não tem subagentes: não consulta", () => {
  render(<TrabalhoAoVivo conversaId="c1" provider="codex" ativo={false} live={false} />);
  expect(request).not.toHaveBeenCalled();
});

it("só os que rodam ficam à vista; sem nenhum rodando, o painel some", async () => {
  request.mockImplementation(async () => ({ subagentes: [rodando, pronto] }));
  const { unmount } = render(<TrabalhoAoVivo conversaId="c1" provider="claude" ativo live />);
  expect(await screen.findByText("Mapear rotas")).toBeInTheDocument();
  expect(screen.queryByText("Rodar testes")).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "Ver concluídos (1)" }));
  expect(screen.getByText("Rodar testes")).toBeInTheDocument();
  unmount();

  request.mockImplementation(async () => ({ subagentes: [pronto] }));
  render(<TrabalhoAoVivo conversaId="c1" provider="claude" ativo live />);
  await waitFor(() => expect(request).toHaveBeenCalledWith("/conversas/c1/subagentes"));
  expect(screen.queryByLabelText("Subagentes")).not.toBeInTheDocument();
});
