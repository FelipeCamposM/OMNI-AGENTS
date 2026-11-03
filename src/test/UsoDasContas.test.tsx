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

it("Antigravity aparece com o nome e o botão de atualizar", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify([
    { id: "agy", provider: "antigravity", name: "Google", usage: { status: "available", reason: null,
      primary: { used_percent: 12, resets_at: null, reset_label: null }, secondary: { used_percent: 40, resets_at: null, reset_label: null } } },
  ]))));
  render(<UsoDasContas contaAtiva={null} />);
  const conta = (await screen.findByText("Google")).closest("li")!;
  expect(screen.getByText("Antigravity")).toBeInTheDocument(); // cabeçalho do grupo do agente
  expect(within(conta).getByText("12%")).toBeInTheDocument();
  expect(within(conta).getByRole("button", { name: "Atualizar uso de Google" })).toBeInTheDocument();
});

it("contas do mesmo agente ficam juntas e mostram quando o uso reseta", async () => {
  const reset = Math.floor(Date.now() / 1000) + 2 * 3600 + 600;
  const uso = { status: "available", reason: null, primary: { used_percent: 50, resets_at: reset, reset_label: null }, secondary: null };
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify([
    { id: "a", provider: "claude", name: "Pessoal", usage: uso },
    { id: "b", provider: "codex", name: "Trabalho", usage: uso },
    { id: "c", provider: "claude", name: "Uber", usage: uso },
  ]))));
  render(<UsoDasContas contaAtiva={null} />);
  await screen.findByText("Uber");
  const nomes = [...document.querySelectorAll(".w-uso-texto")].map((el) => el.textContent);
  expect(nomes).toEqual(["Pessoal", "Uber", "Trabalho"]);
  expect(screen.getByText("2 contas")).toBeInTheDocument();
  expect(screen.getAllByText(/em 2h 1\d?min/).length).toBe(3);
});
