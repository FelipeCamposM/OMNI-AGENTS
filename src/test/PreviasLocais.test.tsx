import { expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PreviasLocais } from "../web/PreviasLocais";

it("lista as portas abertas, abre a prévia numa aba nova e para a ativa", async () => {
  let ativas: { alvo: number; url: string }[] = [];
  const fetch = vi.fn(async (url: string, init?: RequestInit) => {
    if (url === "/previas" && init?.method === "POST") {
      ativas = [{ alvo: 3000, url: "http://100.1.2.3:13000/?__omni=abc" }];
      return new Response(JSON.stringify(ativas[0]));
    }
    if (url === "/previas/3000/fechar") { ativas = []; return new Response("{}"); }
    return new Response(JSON.stringify({ abertas: [3000, 5173], ativas }));
  });
  vi.stubGlobal("fetch", fetch);
  const janela = { location: { href: "" }, close: vi.fn() };
  vi.spyOn(window, "open").mockReturnValue(janela as unknown as Window);

  render(<PreviasLocais />);
  expect(await screen.findByText("localhost:5173")).toBeInTheDocument();
  const [abrir3000] = screen.getAllByRole("button", { name: "Abrir" });
  await act(async () => { await userEvent.click(abrir3000); });

  expect(janela.location.href).toBe("http://100.1.2.3:13000/?__omni=abc");
  expect(JSON.parse(String(fetch.mock.calls.find(([, init]) => init?.method === "POST" && init.body)?.[1]?.body))).toEqual({ porta: 3000 });
  await act(async () => { await userEvent.click(await screen.findByRole("button", { name: "Parar prévia de localhost:3000" })); });
  expect(fetch.mock.calls.some(([url]) => url === "/previas/3000/fechar")).toBe(true);
});

it("erro do PC aparece e a aba aberta antes é fechada", async () => {
  vi.stubGlobal("fetch", vi.fn(async (_url: string, init?: RequestInit) => init?.method === "POST"
    ? new Response(JSON.stringify({ error: "Nada respondendo em localhost:4321 no PC." }), { status: 502 })
    : new Response(JSON.stringify({ abertas: [], ativas: [] }))));
  const janela = { location: { href: "" }, close: vi.fn() };
  vi.spyOn(window, "open").mockReturnValue(janela as unknown as Window);
  render(<PreviasLocais />);
  expect(await screen.findByText("Nenhum servidor local rodando nas portas comuns.")).toBeInTheDocument();
  await userEvent.type(screen.getByLabelText("Outra porta"), "4321");
  await act(async () => { await userEvent.click(screen.getByRole("button", { name: "Abrir" })); });
  expect(await screen.findByRole("alert")).toHaveTextContent("Nada respondendo em localhost:4321");
  expect(janela.close).toHaveBeenCalled();
});
