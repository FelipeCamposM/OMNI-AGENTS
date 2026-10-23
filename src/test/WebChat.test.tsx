import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { WebApp } from "../web/WebApp";
import { agruparMensagens } from "../mobile/MobileApp";
import { semRespostasAutomaticas } from "../web/TerminalEspelho";
import type { Conversation, Mensagem } from "../mobile/api";

beforeEach(() => {
  history.replaceState(null, "", "/pc");
  sessionStorage.clear();
  localStorage.clear();
  window.scrollTo = vi.fn() as unknown as typeof window.scrollTo;
});
afterEach(() => vi.unstubAllGlobals());

const CATALOGO = {
  published_at_ms: Date.now(),
  projects: [{ id: "p", name: "Projeto", path: "C:/p" }],
  agents: [],
  profiles: [{ id: "uber", provider: "claude", name: "EmailUber" }],
  theme: null,
};

function conversa(extra: Partial<Conversation> = {}): Conversation {
  return {
    id: "c", title: "Corrigir o login", project_id: "p", provider: "claude", profile_id: "uber",
    state: "answered", mode: "auto", live: true, updated_at_ms: Date.now() - 5 * 60_000,
    capabilities: { prompt: true, approve: false, revision: '"r"', approval_text: null, reason: null },
    ...extra,
  };
}

const MENSAGENS: Mensagem[] = [
  { id: "c:0", role: "user", text: "Rode os testes", provider: "claude", kind: "text" },
  { id: "c:1", role: "assistant", text: "Vou rodar.", provider: "claude", kind: "text" },
  { id: "c:2", role: "assistant", text: "Roda os testes", provider: "claude", kind: "tool", tool: "Bash" },
  { id: "c:3", role: "assistant", text: "C:/p/src/login.ts", provider: "claude", kind: "tool", tool: "Read" },
  { id: "c:4", role: "assistant", text: "C:/p/src/login.ts", provider: "claude", kind: "tool", tool: "Edit" },
  { id: "c:5", role: "assistant", text: "Corrigido.", provider: "claude", kind: "text" },
  { id: "c:6", role: "user", text: "/model opus", provider: "claude", kind: "command" },
  { id: "c:7", role: "assistant", text: "Interrompido por você", provider: "claude", kind: "notice" },
];

/** Servidor do PC de mentira, só com as rotas novas: `/painel` e a timeline com o estado junto. */
function servidor(estado: { lista: Conversation[]; enviados: { url: string; body: unknown }[]; painelLido: number; etag304?: boolean }) {
  return vi.fn(async (url: string, init?: RequestInit) => {
    if (init?.method === "POST") {
      estado.enviados.push({ url, body: init.body ? JSON.parse(String(init.body)) : null });
      return new Response(JSON.stringify({ id: "a", ok: true }), { status: 202 });
    }
    if (url === "/painel") {
      estado.painelLido += 1;
      const pedido = new Headers(init?.headers).get("If-None-Match");
      if (estado.etag304 && pedido === '"v1"') return new Response(null, { status: 304 });
      return new Response(JSON.stringify({ conversations: estado.lista, catalog: CATALOGO }), { headers: { etag: '"v1"' } });
    }
    if (url.includes("/timeline")) {
      return new Response(JSON.stringify({
        timeline: { messages: MENSAGENS, next_cursor: null, prev_cursor: null, unavailable_segments: [] },
        actions: [], conversation: estado.lista[0],
      }));
    }
    return new Response(JSON.stringify({ error: "não esperado" }), { status: 404 });
  });
}

async function abrir() {
  // Buscas por papel varrem a página inteira (o logo é um SVG grande): limite maior que o padrão.
  const conversa = await screen.findByRole("button", { name: /Abrir conversa/ }, { timeout: 4000 });
  await act(async () => { await userEvent.click(conversa); });
}

it("agrupa ações seguidas do agente num bloco só, entre as falas", () => {
  const blocos = agruparMensagens(MENSAGENS);
  expect(blocos.map((bloco) => bloco.tipo)).toEqual(["fala", "fala", "acoes", "fala", "comando", "aviso"]);
  const acoes = blocos[2];
  expect(acoes.tipo === "acoes" && acoes.acoes.map((a) => a.tool)).toEqual(["Bash", "Read", "Edit"]);
});

it("mostra as ações resumidas, abre a lista ao clicar, e mostra comando e aviso como linhas", async () => {
  vi.stubGlobal("fetch", servidor({ lista: [conversa()], enviados: [], painelLido: 0 }));
  render(<WebApp />);
  await abrir();

  const bloco = await screen.findByRole("button", { name: /3 ações/ }, { timeout: 4000 });
  // Fechado, mostra a última ação como resumo.
  expect(bloco).toHaveTextContent("Editou");
  await act(async () => { await userEvent.click(bloco); });
  const lista = screen.getByRole("region", { name: "Ações do agente" });
  expect(within(lista).getByText("Rodou")).toBeInTheDocument();
  expect(within(lista).getByText("Leu")).toBeInTheDocument();

  expect(screen.getByText("/model opus")).toBeInTheDocument();
  expect(screen.getByText("Interrompido por você")).toHaveAttribute("role", "note");
  // Cabeçalho diz de quem é a conversa: estado, agente e conta.
  expect(screen.getByText(/Esperando você · Claude · EmailUber · Projeto/)).toBeInTheDocument();
});

it("lista e catálogo vêm do /painel; 304 mantém a tela sem refazer nada", async () => {
  const estado = { lista: [conversa()], enviados: [], painelLido: 0, etag304: true };
  vi.stubGlobal("fetch", servidor(estado));
  render(<WebApp />);
  expect(await screen.findByRole("button", { name: /Abrir conversa Corrigir o login/ }, { timeout: 4000 })).toBeInTheDocument();
  await act(async () => { await userEvent.click(screen.getByRole("button", { name: "Atualizar" })); });
  await waitFor(() => expect(estado.painelLido).toBeGreaterThanOrEqual(2));
  // O 304 não apagou a lista.
  expect(screen.getByRole("button", { name: /Abrir conversa Corrigir o login/ })).toBeInTheDocument();
  // Pendências no título da aba do navegador.
  expect(document.title).toBe("(1) OMNI AGENTS");
});

it("no computador Enter envia e Shift+Enter quebra linha", async () => {
  vi.stubGlobal("matchMedia", (consulta: string) => ({ matches: consulta.includes("pointer: fine"), addEventListener: vi.fn(), removeEventListener: vi.fn() }));
  const estado = { lista: [conversa()], enviados: [] as { url: string; body: unknown }[], painelLido: 0 };
  vi.stubGlobal("fetch", servidor(estado));
  render(<WebApp />);
  await abrir();
  const campo = await screen.findByLabelText("Sua resposta", {}, { timeout: 4000 });
  await act(async () => { await userEvent.type(campo, "linha 1{Shift>}{Enter}{/Shift}linha 2{Enter}"); });
  await waitFor(() => expect(estado.enviados.some((item) => item.url.endsWith("/prompt"))).toBe(true));
  expect(estado.enviados.find((item) => item.url.endsWith("/prompt"))?.body).toEqual({ texto: "linha 1\nlinha 2" });
});

it("com o agente trabalhando aparece o Parar, que para o agente no PC", async () => {
  const estado = { lista: [conversa({ state: "working", capabilities: { prompt: false, approve: false, revision: '"r"', approval_text: null, reason: null } })], enviados: [] as { url: string; body: unknown }[], painelLido: 0 };
  vi.stubGlobal("fetch", servidor(estado));
  render(<WebApp />);
  await abrir();
  const parar = await screen.findByRole("button", { name: "Parar" }, { timeout: 4000 });
  await act(async () => { await userEvent.click(parar); });
  await waitFor(() => expect(estado.enviados.some((item) => item.url.endsWith("/parar"))).toBe(true));
});

it("terminal: digitação passa, respostas automáticas do xterm não", () => {
  expect(semRespostasAutomaticas("abc\r")).toBe("abc\r");
  expect(semRespostasAutomaticas("\u001b[A")).toBe("\u001b[A");
  expect(semRespostasAutomaticas("\u001b[?1;2c")).toBe("");
  expect(semRespostasAutomaticas("\u001b[12;40R")).toBe("");
  expect(semRespostasAutomaticas("\u001b]11;rgb:0e0e/0e0e/1414\u0007")).toBe("");
  expect(semRespostasAutomaticas("\u001b[I\u001b[O")).toBe("");
});
