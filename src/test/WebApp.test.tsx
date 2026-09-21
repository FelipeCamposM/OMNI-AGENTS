import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi, afterEach } from "vitest";
import { WebApp } from "../web/WebApp";
import type { Conversation } from "../mobile/api";

beforeEach(() => {
  history.replaceState(null, "", "/pc");
  sessionStorage.clear();
  localStorage.clear();
  window.scrollTo = vi.fn() as unknown as typeof window.scrollTo;
});
afterEach(() => vi.unstubAllGlobals());

const PROJETOS = {
  published_at_ms: Date.now(),
  projects: [
    { id: "p", name: "Projeto", path: "C:/p" },
    { id: "p2", name: "Outro", path: "C:/p2" },
  ],
  agents: [],
  profiles: [],
  theme: null,
};

const TIMELINE = {
  timeline: {
    messages: [{ id: "c:0", role: "assistant", text: "Resposta anterior", provider: "claude" }],
    next_cursor: null,
    prev_cursor: null,
    unavailable_segments: [],
  },
  actions: [],
};

function conversa(extra: Partial<Conversation> = {}): Conversation {
  return {
    id: "c",
    title: "Corrigir o login",
    project_id: "p",
    provider: "claude",
    profile_id: "p",
    state: "answered",
    mode: "auto",
    capabilities: { prompt: true, approve: false, revision: '"r"', approval_text: null, reason: null },
    ...extra,
  };
}

function servidor(lista: Conversation[], enviados: { url: string; body: unknown }[] = []) {
  return vi.fn(async (url: string, init?: RequestInit) => {
    if (init?.method === "POST") {
      enviados.push({ url, body: init.body ? JSON.parse(String(init.body)) : null });
      return new Response(JSON.stringify({ id: "a" }), { status: 202 });
    }
    const corpo = url.includes("timeline")
      ? TIMELINE
      : url === "/projetos"
        ? PROJETOS
        : url === "/atencao"
          ? lista.filter((item) => item.capabilities?.approve)
          : lista;
    return new Response(JSON.stringify(corpo));
  });
}

it("mostra projetos, conversas e a conversa aberta ao mesmo tempo", async () => {
  vi.stubGlobal("fetch", servidor([conversa()]));
  render(<WebApp />);

  // As três colunas do layout de computador: no celular isso seriam três telas.
  expect(await screen.findByRole("button", { name: "Projeto" })).toBeInTheDocument();
  const conversaBotao = await screen.findByRole("button", { name: /Abrir conversa/ });
  expect(screen.getByText(/Escolha uma conversa/)).toBeInTheDocument();

  await act(async () => {
    await userEvent.click(conversaBotao);
  });
  expect(await screen.findByText("Resposta anterior")).toBeInTheDocument();
  // O endereço guarda a conversa: atualizar a página volta para ela.
  expect(location.hash).toBe("#/c/c");
});

it("alterna o modo do agente pelo botão, como o shift+tab faz no terminal", async () => {
  const enviados: { url: string; body: unknown }[] = [];
  vi.stubGlobal("fetch", servidor([conversa()], enviados));
  render(<WebApp />);
  await screen.findByRole("button", { name: "Projeto" });
  await act(async () => {
    await userEvent.click(await screen.findByRole("button", { name: /Abrir conversa/ }));
  });

  const plano = await screen.findByRole("button", { name: "Plano" });
  // O modo atual vem do servidor e aparece marcado.
  expect(screen.getByRole("button", { name: "Auto" })).toHaveAttribute("aria-pressed", "true");
  await act(async () => {
    await userEvent.click(plano);
  });
  await waitFor(() => expect(enviados.some((item) => item.url.endsWith("/modo"))).toBe(true));
  expect(enviados.find((item) => item.url.endsWith("/modo"))?.body).toEqual({ modo: "plan" });
});

it("renomear a conversa manda o nome novo para o PC", async () => {
  const enviados: { url: string; body: unknown }[] = [];
  vi.stubGlobal("fetch", servidor([conversa()], enviados));
  render(<WebApp />);
  await screen.findByRole("button", { name: "Projeto" });
  await act(async () => {
    await userEvent.click(await screen.findByRole("button", { name: /Abrir conversa/ }));
  });

  await act(async () => {
    await userEvent.click(await screen.findByRole("button", { name: "Corrigir o login" }));
  });
  const campo = await screen.findByLabelText("Nome da conversa");
  await act(async () => {
    await userEvent.clear(campo);
    await userEvent.type(campo, "Refatorar autenticação");
    await userEvent.click(screen.getByRole("button", { name: "Salvar" }));
  });

  await waitFor(() => expect(enviados.some((item) => item.url.endsWith("/nome"))).toBe(true));
  expect(enviados.find((item) => item.url.endsWith("/nome"))?.body).toEqual({ nome: "Refatorar autenticação" });
});

it("agente trabalhando trava a troca de modo — tecla no meio do turno não é para ele", async () => {
  vi.stubGlobal(
    "fetch",
    servidor([conversa({ state: "working", capabilities: { prompt: false, approve: false, revision: '"r"', approval_text: null, reason: "Agente ocupado" } })])
  );
  render(<WebApp />);
  await screen.findByRole("button", { name: "Projeto" });
  await act(async () => {
    await userEvent.click(await screen.findByRole("button", { name: /Abrir conversa/ }));
  });

  expect(await screen.findByRole("button", { name: "Plano" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Auto" })).toBeDisabled();
});
