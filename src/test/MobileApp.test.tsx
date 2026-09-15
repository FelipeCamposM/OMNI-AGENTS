import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MobileApp } from "../mobile/MobileApp";
import type { Conversation } from "../mobile/api";

afterEach(() => vi.unstubAllGlobals());

/** O catálogo que a tela de projetos consome. Sem ele o app para no primeiro nível. */
const PROJETOS = { published_at_ms: Date.now(), projects: [{ id: "p", name: "Projeto", path: "C:/p" }], agents: [], profiles: [] };

/** Projetos → Conversas: o caminho que o usuário faz para chegar numa conversa.
 *  Os `findBy*` ficam **fora** do `act`: esperar por um elemento dentro dele impede o React de
 *  aplicar o estado que faria esse elemento aparecer, e a busca expira sozinha. */
async function abrirConversa() {
  const projeto = await screen.findByRole("button", { name: "Abrir projeto" });
  await act(async () => { await userEvent.click(projeto); });
  const conversa = await screen.findByRole("button", { name: "Abrir conversa" });
  await act(async () => { await userEvent.click(conversa); });
}

it("conversa sem sessão mostra histórico mas não oferece aprovação nem envio", async () => {
  vi.stubGlobal("fetch",vi.fn(async (url: string) => new Response(JSON.stringify(
    url.includes("timeline") ? { timeline: { messages: [{ id:"m",role:"assistant",text:"Resposta anterior",provider:"claude" }], next_cursor:null,unavailable_segments:[] },actions:[] }
      : url === "/projetos" ? PROJETOS
      : url === "/atencao" ? [] : [{ id:"c",title:"Conversa de teste",project_id:"p",provider:"claude",profile_id:"p",state:null,capabilities:null }]
  ))));
  render(<MobileApp />);
  await abrirConversa();
  expect(await screen.findByText("Resposta anterior")).toBeInTheDocument();
  expect(screen.getByRole("button",{name:"Enviar resposta"})).toBeDisabled();
  expect(screen.queryByRole("button",{name:"Permitir"})).not.toBeInTheDocument();
});

it("timeout mantém a chave de reenvio mesmo quando o status muda", async () => {
  let revision = '"first"';
  const posts: RequestInit[] = [];
  vi.stubGlobal("fetch",vi.fn(async (url: string, init?: RequestInit) => {
    if (init?.method === "POST") {
      posts.push(init);
      if (posts.length === 1) throw new TypeError("Conexão perdida");
      return new Response(JSON.stringify({ id:"a",state:"queued" }),{status:202});
    }
    const conversation: Conversation = { id:"c",title:"Teste",project_id:"p",provider:"claude",profile_id:"p",state:"answered",capabilities:{prompt:true,approve:false,revision,approval_text:null,reason:null} };
    return new Response(JSON.stringify(
      url.includes("timeline") ? { timeline:{messages:[],next_cursor:null,unavailable_segments:[]},actions:[] }
        : url === "/projetos" ? PROJETOS : [conversation]));
  }));
  render(<MobileApp />);
  await abrirConversa();
  await act(async () => { await userEvent.type(screen.getByLabelText("Sua resposta"),"Continuar"); await userEvent.click(screen.getByRole("button",{name:"Enviar resposta"})); });
  await screen.findByText(/Conexão perdida/);
  revision = '"new"';
  await act(async () => { await userEvent.click(screen.getByRole("button",{name:"Atualizar"})); });
  await act(async () => { await userEvent.click(screen.getByRole("button",{name:"Enviar resposta"})); });
  await waitFor(() => expect(posts).toHaveLength(2));
  expect(posts[1].headers).toEqual(posts[0].headers);
  expect((posts[1].headers as Record<string,string>)["If-Match"]).toBe('"first"');
});

it("token do QR sai do fragmento, vai em todo request e some da barra", async () => {
  const headers: HeadersInit[] = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    headers.push(init?.headers ?? {});
    return new Response(JSON.stringify(url === "/atencao" ? [] : []));
  }));
  localStorage.clear();
  window.location.hash = "#t=segredo-do-qr";

  render(<MobileApp />);
  await waitFor(() => expect(headers.length).toBeGreaterThan(0));

  for (const enviado of headers) {
    expect((enviado as Record<string, string>)["X-Omni-Token"]).toBe("segredo-do-qr");
  }
  // Gravado para sobreviver ao recarregar, e fora da barra para não vazar em print ou histórico.
  expect(localStorage.getItem("omni-token")).toBe("segredo-do-qr");
  expect(window.location.hash).toBe("");
});

it("401 descarta o token: rotacionar no PC não deixa o celular insistindo com o segredo velho", async () => {
  vi.stubGlobal("fetch", vi.fn(async () =>
    new Response(JSON.stringify({ error: "Dispositivo não autorizado" }), { status: 401 })));
  localStorage.setItem("omni-token", "token-antigo");
  window.location.hash = "";

  render(<MobileApp />);
  await waitFor(() => expect(localStorage.getItem("omni-token")).toBeNull());
});

it("nova sessão manda só escolhas de lista e nunca um caminho", async () => {
  const posts: { url: string; body: unknown }[] = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    if (init?.method === "POST") {
      posts.push({ url, body: JSON.parse(String(init.body)) });
      return new Response(JSON.stringify({ id: "a", state: "queued" }), { status: 202 });
    }
    return new Response(JSON.stringify(
      url === "/projetos"
        ? { ...PROJETOS, agents: [{ id: "claude", label: "Claude", command: "claude", resume: null }], profiles: [] }
        : []));
  }));
  render(<MobileApp />);

  const projeto = await screen.findByRole("button", { name: "Abrir projeto" });
  await act(async () => { await userEvent.click(projeto); });
  const nova = await screen.findByRole("button", { name: "Nova sessão" });
  await act(async () => { await userEvent.click(nova); });
  await act(async () => { await userEvent.selectOptions(screen.getByLabelText("Agente"), "claude"); });
  await act(async () => { await userEvent.click(screen.getByRole("button", { name: "Abrir" })); });

  await waitFor(() => expect(posts).toHaveLength(1));
  expect(posts[0].url).toBe("/sessoes");
  // O celular escolhe id de projeto e de agente. Caminho e binário são resolvidos no servidor.
  expect(posts[0].body).toEqual({ project_id: "p", provider: "claude", profile_id: null });
});

it("conversa sem mensagens diz que está vazia, não que o histórico sumiu", async () => {
  vi.stubGlobal("fetch", vi.fn(async (url: string) => new Response(JSON.stringify(
    url.includes("timeline") ? { timeline: { messages: [], next_cursor: null, unavailable_segments: [] }, actions: [] }
      : url === "/projetos" ? PROJETOS
      : url === "/atencao" ? [] : [{ id: "c", title: "Nova", project_id: "p", provider: "claude", profile_id: "p", state: "answered", capabilities: null }]
  ))));
  render(<MobileApp />);
  await abrirConversa();
  expect(await screen.findByText(/Nenhuma mensagem ainda/)).toBeInTheDocument();
  expect(screen.queryByText(/indisponível/)).not.toBeInTheDocument();
});

it("mandar prompt vira balão no chat e mostra o agente trabalhando, sem aviso de fila", async () => {
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    if (init?.method === "POST") return new Response(JSON.stringify({ id: "a1", state: "queued" }), { status: 202 });
    return new Response(JSON.stringify(
      url.includes("timeline") ? { timeline: { messages: [], next_cursor: null, unavailable_segments: [] }, actions: [{ id: "a1", state: "sent", error: null }] }
        : url === "/projetos" ? PROJETOS
        : url === "/atencao" ? []
        : [{ id: "c", title: "Chat", project_id: "p", provider: "claude", profile_id: "p", state: "answered",
            capabilities: { prompt: true, approve: false, revision: '"r"', approval_text: null, reason: null } }]
    ));
  }));
  render(<MobileApp />);
  await abrirConversa();
  await act(async () => {
    await userEvent.type(screen.getByLabelText("Sua resposta"), "Olá agente");
    await userEvent.click(screen.getByRole("button", { name: "Enviar resposta" }));
  });

  expect(await screen.findByText("Olá agente")).toBeInTheDocument();
  expect(screen.getByRole("status")).toHaveTextContent("O agente está trabalhando");
  expect(screen.queryByText(/enfileirada/i)).not.toBeInTheDocument();
  expect(screen.queryByText(/Enviado ao CLI|Na fila/)).not.toBeInTheDocument();
});

it("prompt recusado pela fila some do chat e diz o motivo", async () => {
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    if (init?.method === "POST") return new Response(JSON.stringify({ id: "a1", state: "queued" }), { status: 202 });
    return new Response(JSON.stringify(
      url.includes("timeline") ? { timeline: { messages: [], next_cursor: null, unavailable_segments: [] }, actions: [{ id: "a1", state: "rejected", error: "Sessão trocada" }] }
        : url === "/projetos" ? PROJETOS
        : url === "/atencao" ? []
        : [{ id: "c", title: "Chat", project_id: "p", provider: "claude", profile_id: "p", state: "answered",
            capabilities: { prompt: true, approve: false, revision: '"r"', approval_text: null, reason: null } }]
    ));
  }));
  render(<MobileApp />);
  await abrirConversa();
  await act(async () => {
    await userEvent.type(screen.getByLabelText("Sua resposta"), "vai falhar");
    await userEvent.click(screen.getByRole("button", { name: "Enviar resposta" }));
  });
  expect(await screen.findByText(/Não foi enviado: Sessão trocada/)).toBeInTheDocument();
  expect(screen.queryByText("vai falhar")).not.toBeInTheDocument();
});

describe("pareamento pelo Authy", () => {
  function servidor(parear: (codigo: string) => Response) {
    let pareado = false;
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      if (url === "/parear") {
        const resposta = parear(JSON.parse(String(init?.body)).codigo);
        if (resposta.ok) pareado = true;
        return resposta;
      }
      const token = (init?.headers as Record<string, string> | undefined)?.["X-Omni-Token"];
      if (!pareado || token !== "token-pareado") return new Response(JSON.stringify({ error: "Dispositivo não autorizado" }), { status: 401 });
      return new Response(JSON.stringify(url === "/projetos" ? PROJETOS : []));
    }));
  }

  beforeEach(() => { localStorage.clear(); window.location.hash = ""; });

  it("app sem acesso pede o código e, com o código certo, abre", async () => {
    servidor((codigo) => codigo === "287082"
      ? new Response(JSON.stringify({ token: "token-pareado" }))
      : new Response(JSON.stringify({ error: "Código do Authy não confere." }), { status: 401 }));
    render(<MobileApp />);

    const campo = await screen.findByLabelText("Código do Authy");
    await act(async () => {
      await userEvent.type(campo, "287082");
      await userEvent.click(screen.getByRole("button", { name: "Parear" }));
    });

    expect(await screen.findByRole("button", { name: "Abrir projeto" })).toBeInTheDocument();
    expect(localStorage.getItem("omni-token")).toBe("token-pareado");
  });

  it("mostra o motivo quando o servidor recusa e aceita só dígitos", async () => {
    servidor(() => new Response(JSON.stringify({ error: "Muitas tentativas erradas. Espere alguns minutos e tente de novo." }), { status: 429 }));
    render(<MobileApp />);

    const campo = await screen.findByLabelText("Código do Authy");
    await act(async () => { await userEvent.type(campo, "12ab34x56"); });
    expect(campo).toHaveValue("123456");
    await act(async () => { await userEvent.click(screen.getByRole("button", { name: "Parear" })); });
    expect(await screen.findByText(/Muitas tentativas erradas/)).toBeInTheDocument();
  });
});
