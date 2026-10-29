import { act, render, screen, waitFor, within } from "@testing-library/react";
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

it("troca de projeto com conversa aberta, pesquisa globalmente e oferece voltar", async () => {
  vi.stubGlobal("fetch", servidor([
    conversa(),
    conversa({ id: "c2", title: "Auditar pagamentos", project_id: "p2" }),
  ].map((c) => ({ ...c, live: true }))));
  render(<WebApp />);

  const primeira = await screen.findByRole("button", { name: /Abrir conversa Corrigir o login/ });
  await act(async () => { await userEvent.click(primeira); });
  expect(await screen.findByRole("button", { name: "Fechar conversa" })).toBeInTheDocument();

  const lateral = screen.getByRole("complementary", { name: "Projetos e conversas" });
  await act(async () => { await userEvent.click(within(lateral).getByRole("button", { name: "Outro" })); });
  expect(within(lateral).getByRole("button", { name: /Abrir conversa Auditar pagamentos/ })).toBeInTheDocument();
  expect(within(lateral).queryByRole("button", { name: /Abrir conversa Corrigir o login/ })).not.toBeInTheDocument();
  // O título da seção diz de qual projeto são as abertas.
  expect(within(lateral).getByRole("heading", { name: /Abertas no PC.*Outro/ })).toBeInTheDocument();

  await act(async () => { await userEvent.type(within(lateral).getByLabelText("Pesquisar conversas"), "login"); });
  expect(within(lateral).getByRole("button", { name: /Abrir conversa Corrigir o login/ })).toBeInTheDocument();
  expect(within(lateral).queryByRole("button", { name: /Abrir conversa Auditar pagamentos/ })).not.toBeInTheDocument();

  await act(async () => { await userEvent.click(screen.getByRole("button", { name: "Fechar conversa" })); });
  expect(location.hash).toBe("");
  expect(await screen.findByText(/Escolha uma conversa/)).toBeInTheDocument();
});

/** "Várias conversas numa mesma janela se for de um mesmo projeto." */
it("abre outra conversa do mesmo projeto ao lado, e fecha uma de cada vez", async () => {
  vi.stubGlobal("fetch", servidor([
    conversa({ live: true }),
    conversa({ id: "c2", title: "Auditar pagamentos", live: true, state: "working" }),
  ]));
  render(<WebApp />);
  const primeira = await screen.findByRole("button", { name: /Abrir conversa Corrigir o login/ });
  await act(async () => { await userEvent.click(primeira); });
  const aoLado = await screen.findByRole("button", { name: "Abrir Auditar pagamentos ao lado" });
  await act(async () => { await userEvent.click(aoLado); });
  expect(location.hash).toBe("#/c/c,c2");
  const centro = screen.getByRole("main", { name: "Conversa" });
  expect(within(centro).getByRole("region", { name: "Corrigir o login" })).toBeInTheDocument();
  expect(within(centro).getByRole("region", { name: "Auditar pagamentos" })).toBeInTheDocument();
  await act(async () => { await userEvent.click(within(within(centro).getByRole("region", { name: "Corrigir o login" })).getByRole("button", { name: "Fechar conversa" })); });
  expect(location.hash).toBe("#/c/c2");
  expect(within(centro).queryByRole("region", { name: "Corrigir o login" })).not.toBeInTheDocument();
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

/** O bug do "clicar duas vezes": a troca anterior redesenha o rodapé do terminal e a versão da tela
 *  que a conversa tinha ficou velha. O PC recusa (412); a tela relê a versão e repete sozinha. */
it("troca de modo com a tela redesenhada relê a versão e repete, sem mostrar erro", async () => {
  const pedidos: { url: string; ifMatch: string | null }[] = [];
  const base = servidor([conversa()]);
  let recusou = false;
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    if (init?.method === "POST" && url.endsWith("/modo")) {
      const ifMatch = new Headers(init.headers).get("If-Match");
      pedidos.push({ url, ifMatch });
      return ifMatch === "r2"
        ? new Response(JSON.stringify({ id: "a" }), { status: 202 })
        : (recusou = true, new Response(JSON.stringify({ error: "O contexto mudou; atualize antes de responder" }), { status: 412 }));
    }
    if (url.includes("timeline") && recusou) {
      const nova = conversa();
      return new Response(JSON.stringify({ ...TIMELINE, conversation: { ...nova, capabilities: { ...nova.capabilities!, revision: "r2" } } }));
    }
    return base(url, init);
  }));
  render(<WebApp />);
  await screen.findByRole("button", { name: "Projeto" });
  await act(async () => {
    await userEvent.click(await screen.findByRole("button", { name: /Abrir conversa/ }));
  });
  await act(async () => {
    await userEvent.click(await screen.findByRole("button", { name: "Plano" }));
  });
  await waitFor(() => expect(pedidos).toHaveLength(2));
  expect(pedidos[1].ifMatch).toBe("r2");
  expect(screen.queryByText(/contexto mudou/i)).not.toBeInTheDocument();
});

it("com o agente trabalhando, a mensagem vai para a fila e o Parar continua à mão", async () => {
  const enviados: { url: string; body: unknown }[] = [];
  const trabalhando = conversa({
    state: "working", live: true, tokens: "1.2k",
    capabilities: { prompt: false, approve: false, revision: '"r"', approval_text: null, reason: null, enfileirar: true },
  });
  vi.stubGlobal("fetch", servidor([trabalhando], enviados));
  render(<WebApp />);
  await screen.findByRole("button", { name: "Projeto" });
  await act(async () => {
    await userEvent.click(await screen.findByRole("button", { name: /Abrir conversa/ }));
  });
  expect(await screen.findByText("↓ 1.2k tokens")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Parar" })).toBeInTheDocument();
  // Sem texto, só o Parar; com texto, o Enviar aparece ao lado e manda para a fila.
  expect(screen.queryByRole("button", { name: "Enviar para a fila" })).not.toBeInTheDocument();
  await act(async () => {
    await userEvent.type(screen.getByLabelText(/mensagem|resposta/i), "e depois isso");
  });
  await act(async () => {
    await userEvent.click(screen.getByRole("button", { name: "Enviar para a fila" }));
  });
  await waitFor(() => expect(enviados.some((item) => item.url.endsWith("/prompt"))).toBe(true));
  expect(enviados.find((item) => item.url.endsWith("/prompt"))?.body).toEqual({ texto: "e depois isso", fila: true });
  expect(await screen.findByText("na fila")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Parar" })).toBeInTheDocument();
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
    // O título também aparece na coluna "Precisa de você"; o de renomear é o da barra da conversa.
    await userEvent.click(await screen.findByTitle("Renomear conversa"));
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

/** O relato: abrir a conversa não tirava o aviso, e ele "voltava do nada". Abrir marca o pedido
 *  atual como visto; só um evento novo do agente (chave `attention` diferente) traz de volta. */
it("abrir a conversa tira de Precisa de você até o agente terminar outro turno", async () => {
  const lista = [conversa({ attention: "s:1" })];
  vi.stubGlobal("fetch", servidor(lista));
  render(<WebApp />);
  const pendencias = await screen.findByRole("region", { name: "Precisa de você" });
  await waitFor(() => expect(within(pendencias).getByTitle("Corrigir o login")).toBeInTheDocument());
  expect(document.title).toBe("(1) OMNI AGENTS");

  await act(async () => {
    await userEvent.click(within(pendencias).getByTitle("Corrigir o login"));
  });
  await waitFor(() => expect(within(pendencias).getByText("Nada pendente agora.")).toBeInTheDocument());
  await act(async () => {
    await userEvent.click(screen.getByRole("button", { name: "Fechar conversa" }));
  });
  // Fechada, continua vista: o agente parado esperando não é pedido novo.
  await act(async () => {
    await userEvent.click(screen.getByRole("button", { name: "Atualizar" }));
  });
  expect(within(pendencias).getByText("Nada pendente agora.")).toBeInTheDocument();
  expect(document.title).toBe("OMNI AGENTS");

  // Terminou outro turno: volta — uma vez só, mesmo que a lista traga a conversa de novo.
  lista[0] = conversa({ attention: "s:2" });
  await act(async () => {
    await userEvent.click(screen.getByRole("button", { name: "Atualizar" }));
  });
  await waitFor(() => expect(within(pendencias).getAllByTitle("Corrigir o login")).toHaveLength(1));
});

/** "No web eu devo conseguir acessar os terminais sem agentes, criar um novo terminal pra dar um
 *  npm run dev." */
it("cria um terminal sem agente no projeto, abre no centro e fecha", async () => {
  const shells: { id: string; name: string; project_id: string; cwd: string; state: string; updated_at_ms: number }[] = [];
  const enviados: { url: string; body: unknown }[] = [];
  const base = servidor([conversa()]);
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    if (url === "/terminais" && init?.method === "POST") {
      enviados.push({ url, body: JSON.parse(String(init.body)) });
      shells.push({ id: "t1", name: "Terminal", project_id: "p", cwd: "C:/p", state: "answered", updated_at_ms: Date.now() });
      return new Response(JSON.stringify({ id: "t1" }), { status: 201 });
    }
    if (url === "/terminais") return new Response(JSON.stringify(shells));
    if (url.startsWith("/terminais/t1/saida")) return new Response(JSON.stringify({ live: true, data: "$ ", from_seq: 0, next_seq: 1, cols: 80, rows: 24 }));
    if (url === "/terminais/t1/fechar") {
      enviados.push({ url, body: null });
      shells.length = 0;
      return new Response(JSON.stringify({ ok: true }));
    }
    return base(url, init);
  }));
  render(<WebApp />);
  await screen.findByRole("button", { name: "Projeto" });

  await act(async () => {
    await userEvent.click(await screen.findByRole("button", { name: "Novo terminal" }));
  });
  expect(enviados[0]).toEqual({ url: "/terminais", body: { project_id: "p" } });
  expect(await screen.findByRole("button", { name: "Fechar terminal" })).toBeInTheDocument();
  expect(location.hash).toBe("#/t/t1");

  await act(async () => {
    await userEvent.click(screen.getByRole("button", { name: "Fechar terminal" }));
  });
  await waitFor(() => expect(enviados.some((item) => item.url === "/terminais/t1/fechar")).toBe(true));
  await waitFor(() => expect(screen.queryByRole("button", { name: "Fechar terminal" })).not.toBeInTheDocument());
});

it("lateral em abas (Conversas | Prévia) e uso da conta da conversa no topo, com todas num clique", async () => {
  const contas = [
    { id: "p", provider: "claude", name: "Padrão", usage: { status: "ok", primary: { used_percent: 56 }, secondary: { used_percent: 8 }, reason: null } },
    { id: "u", provider: "claude", name: "EmailUber", usage: { status: "ok", primary: { used_percent: 24 }, secondary: { used_percent: 4 }, reason: null } },
  ];
  const base = servidor([conversa()]);
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) =>
    url === "/contas" ? new Response(JSON.stringify(contas))
      : url === "/previas" ? new Response(JSON.stringify({ abertas: [3000], ativas: [] }))
        : base(url, init)));
  history.replaceState(null, "", "/pc#/c/c");
  render(<WebApp />);
  const uso = await screen.findByRole("button", { name: "Uso das contas" });
  await waitFor(() => expect(within(uso).getByText("Padrão")).toBeInTheDocument());
  expect(within(uso).getByText("56%")).toBeInTheDocument();
  expect(screen.queryByText("EmailUber")).not.toBeInTheDocument();
  await act(async () => { await userEvent.click(uso); });
  expect(await screen.findByText("EmailUber")).toBeInTheDocument();
  await act(async () => { await userEvent.keyboard("{Escape}"); });
  expect(screen.queryByText("EmailUber")).not.toBeInTheDocument();

  const lateral = screen.getByRole("complementary", { name: "Projetos e conversas" });
  await act(async () => { await userEvent.click(within(lateral).getByRole("tab", { name: "Prévia" })); });
  expect(await within(lateral).findByText("localhost:3000")).toBeInTheDocument();
  // Nova sessão e Novo terminal continuam embaixo, em qualquer aba.
  expect(within(lateral).getByRole("button", { name: "Novo terminal" })).toBeInTheDocument();
});

it("aba Histórico separada: agrupa por período, filtra por projeto e mostra o projeto de cada conversa", async () => {
  vi.stubGlobal("fetch", servidor([
    conversa({ updated_at_ms: Date.now() }),
    conversa({ id: "c2", title: "Auditar pagamentos", project_id: "p2", updated_at_ms: Date.now() - 40 * 86_400_000 }),
  ]));
  render(<WebApp />);
  const lateral = await screen.findByRole("complementary", { name: "Projetos e conversas" });
  await screen.findByRole("button", { name: /Abrir conversa Corrigir o login/ });
  expect(within(lateral).getByText("Últimas conversas")).toBeInTheDocument();
  await act(async () => { await userEvent.click(within(lateral).getByRole("button", { name: /Ver todo o histórico/ })); });
  const painel = within(lateral).getByRole("tabpanel", { name: "Histórico" });
  expect(within(painel).getByText("Hoje")).toBeInTheDocument();
  expect(within(painel).getByText("Mais antigas")).toBeInTheDocument();
  await act(async () => { await userEvent.click(within(painel).getByRole("combobox", { name: "Projeto do histórico" })); });
  await act(async () => { await userEvent.click(screen.getByRole("option", { name: (nome) => nome.startsWith("Outro") })); });
  expect(within(painel).queryByRole("button", { name: /Corrigir o login/ })).not.toBeInTheDocument();
  expect(within(within(painel).getByRole("button", { name: /Auditar pagamentos/ })).getByText("Outro")).toBeInTheDocument();
});


it("configurações da web: avisos, layout e conexão numa página, pelo engrenagem do topo", async () => {
  vi.stubGlobal("fetch", servidor([conversa()]));
  render(<WebApp />);
  await screen.findByRole("button", { name: /Abrir conversa/ });
  await act(async () => { await userEvent.click(screen.getByRole("button", { name: "Configurações" })); });
  expect(location.hash).toBe("#/ajustes");
  expect(screen.getByRole("heading", { name: "Notificações" })).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "Tela" })).toBeInTheDocument();
  expect(screen.getByRole("link", { name: /versão de celular/ })).toHaveAttribute("href", "/");
});
