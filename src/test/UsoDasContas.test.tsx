import { expect, it, vi } from "vitest";
import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { UsoDasContas } from "../web/UsoDasContas";

it("mostra 5H e semana de cada conta, com a cor da faixa e a conta da conversa destacada", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify([
    { id: "emailuber", provider: "claude", name: "EmailUber", usage: { status: "ok", reason: null,
      primary: { used_percent: 33, resets_at: null, reset_label: "Resets 8pm" }, secondary: { used_percent: 90, resets_at: null, reset_label: null } } },
    { id: "cdx", provider: "codex", name: "Codex", usage: null },
  ]))));
  render(<UsoDasContas contaAtiva="emailuber" />);

  const conta = (await screen.findByText("EmailUber")).closest("li")!;
  expect(conta).toHaveClass("w-uso-conta-ativa");
  expect(within(conta).getByText("33%")).toHaveClass("text-success");
  // Acima de 85% é vermelho, como no rodapé do app.
  expect(within(conta).getByText("90%")).toHaveClass("text-danger");
  expect(screen.getByText("Sem leitura de uso ainda")).toBeInTheDocument();
});

it("o botão de atualizar busca o uso de novo e troca os números", async () => {
  const fetch = vi.fn(async (url: string, init?: RequestInit) => new Response(JSON.stringify(init?.method === "POST"
    ? { id: "emailuber", provider: "claude", name: "EmailUber", usage: { status: "ok", reason: null, primary: { used_percent: 51, resets_at: null, reset_label: null }, secondary: null } }
    : [{ id: "emailuber", provider: "claude", name: "EmailUber", usage: { status: "ok", reason: null, primary: { used_percent: 33, resets_at: null, reset_label: null }, secondary: null } }])));
  vi.stubGlobal("fetch", fetch);
  render(<UsoDasContas contaAtiva={null} />);
  expect(await screen.findByText("33%")).toBeInTheDocument();
  await act(async () => { await userEvent.click(screen.getByRole("button", { name: "Atualizar uso de EmailUber" })); });
  expect(await screen.findByText("51%")).toBeInTheDocument();
  expect(fetch.mock.calls.some(([url, init]) => url === "/contas/emailuber/uso" && init?.method === "POST")).toBe(true);
});

it("na conversa mostra só a conta dela; sem conta escolhida, as do agente dela", async () => {
  const contas = [
    { id: "emailuber", provider: "claude", name: "EmailUber", usage: null },
    { id: "pessoal", provider: "claude", name: "Pessoal", usage: null },
    { id: "cdx", provider: "codex", name: "Trabalho", usage: null },
  ];
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(contas))));
  const { unmount } = render(<UsoDasContas contaAtiva={null} daConversa={{ profileId: "pessoal", provider: "claude" }} />);
  expect(await screen.findByText("Pessoal")).toBeInTheDocument();
  expect(screen.queryByText("EmailUber")).not.toBeInTheDocument();
  expect(screen.queryByText("Uso das contas")).not.toBeInTheDocument();
  unmount();

  render(<UsoDasContas contaAtiva={null} daConversa={{ profileId: null, provider: "codex" }} />);
  expect(await screen.findByText("Trabalho")).toBeInTheDocument();
  expect(screen.queryByText("Pessoal")).not.toBeInTheDocument();
});
