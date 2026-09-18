import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MobileApp } from "../mobile/MobileApp";
import type { Conversation } from "../mobile/api";
import { MARCADOR_ANEXOS, montarPrompt, nomeDoCaminho, separarAnexos } from "../mobile/anexos";

beforeEach(() => {
  // A tela vive no endereço (`#/c/<id>`): sem zerar, cada teste começaria onde o anterior parou.
  history.replaceState(null, "", "/");
  sessionStorage.clear();
  // jsdom não tem as duas; o chat mostra prévia de imagem e a lista rola até o fim.
  URL.createObjectURL = vi.fn(() => "blob:previa");
  URL.revokeObjectURL = vi.fn();
  window.scrollTo = vi.fn() as unknown as typeof window.scrollTo;
});
afterEach(() => vi.unstubAllGlobals());

/** O catálogo que a tela de projetos consome. Sem ele o app para no primeiro nível. */
const PROJETOS = { published_at_ms: Date.now(), projects: [{ id: "p", name: "Projeto", path: "C:/p" }], agents: [], profiles: [], theme: null };

const TIMELINE_VAZIA = { timeline: { messages: [], next_cursor: null, prev_cursor: null, unavailable_segments: [] }, actions: [] };

function conversaPronta(extra: Partial<Conversation> = {}): Conversation {
  return { id: "c", title: "Chat", project_id: "p", provider: "claude", profile_id: "p", state: "answered",
    capabilities: { prompt: true, approve: false, revision: '"r"', approval_text: null, reason: null }, ...extra };
}

/** Projetos → Conversas: o caminho que o usuário faz para chegar numa conversa.
 *  Os `findBy*` ficam **fora** do `act`: esperar por um elemento dentro dele impede o React de
 *  aplicar o estado que faria esse elemento aparecer, e a busca expira sozinha. */
async function abrirConversa() {
  const projeto = await screen.findByRole("button", { name: /Abrir projeto/ });
  await act(async () => { await userEvent.click(projeto); });
  const conversa = await screen.findByRole("button", { name: /Abrir conversa/ });
  await act(async () => { await userEvent.click(conversa); });
}

it("conversa sem sessão mostra histórico mas não oferece aprovação nem envio", async () => {
  vi.stubGlobal("fetch",vi.fn(async (url: string) => new Response(JSON.stringify(
    url.includes("timeline") ? { timeline: { messages: [{ id:"c:0",role:"assistant",text:"Resposta anterior",provider:"claude" }], next_cursor:null,unavailable_segments:[] },actions:[] }
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
    const conversation = conversaPronta({ title: "Teste", capabilities: { prompt:true,approve:false,revision,approval_text:null,reason:null } });
    return new Response(JSON.stringify(
      url.includes("timeline") ? TIMELINE_VAZIA : url === "/projetos" ? PROJETOS : [conversation]));
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

  const projeto = await screen.findByRole("button", { name: /Abrir projeto/ });
  await act(async () => { await userEvent.click(projeto); });
  const nova = await screen.findByRole("button", { name: "Nova sessão" });
  await act(async () => { await userEvent.click(nova); });
  // O seletor é o mesmo do PC (lista desenhada em HTML), não o `<select>` nativo.
  await act(async () => { await userEvent.click(screen.getByLabelText("Agente")); });
  await act(async () => { await userEvent.click(screen.getByRole("option", { name: "Claude" })); });
  await act(async () => { await userEvent.click(screen.getByRole("button", { name: "Abrir" })); });

  await waitFor(() => expect(posts).toHaveLength(1));
  expect(posts[0].url).toBe("/sessoes");
  // O celular escolhe id de projeto e de agente. Caminho e binário são resolvidos no servidor.
  expect(posts[0].body).toEqual({ project_id: "p", provider: "claude", profile_id: null });
});

it("conversa sem mensagens diz que está vazia, não que o histórico sumiu", async () => {
  vi.stubGlobal("fetch", vi.fn(async (url: string) => new Response(JSON.stringify(
    url.includes("timeline") ? TIMELINE_VAZIA
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
      url.includes("timeline") ? { ...TIMELINE_VAZIA, actions: [{ id: "a1", state: "sent", error: null }] }
        : url === "/projetos" ? PROJETOS
        : url === "/atencao" ? []
        : [conversaPronta()]
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
      url.includes("timeline") ? { ...TIMELINE_VAZIA, actions: [{ id: "a1", state: "rejected", error: "Sessão trocada" }] }
        : url === "/projetos" ? PROJETOS
        : url === "/atencao" ? []
        : [conversaPronta()]
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

describe("navegação", () => {
  function servidorPadrao() {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => new Response(JSON.stringify(
      url.includes("timeline") ? { timeline: { messages: [{ id: "c:0", role: "assistant", text: "Continuo aqui", provider: "claude" }], next_cursor: null, unavailable_segments: [] }, actions: [] }
        : url === "/projetos" ? PROJETOS
        : url === "/atencao" ? [] : [conversaPronta()]
    ))));
  }

  it("atualizar a página volta para a conversa que estava aberta", async () => {
    servidorPadrao();
    const primeira = render(<MobileApp />);
    await abrirConversa();
    expect(await screen.findByText("Continuo aqui")).toBeInTheDocument();
    expect(window.location.hash).toBe("#/c/c");

    // Refresh = o app nasce de novo com o mesmo endereço.
    primeira.unmount();
    render(<MobileApp />);
    expect(await screen.findByText("Continuo aqui")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Abrir projeto/ })).not.toBeInTheDocument();
  });

  it("rascunho sobrevive ao refresh", async () => {
    servidorPadrao();
    history.replaceState(null, "", "/#/c/c");
    const primeira = render(<MobileApp />);
    const campo = await screen.findByLabelText("Sua resposta");
    await act(async () => { await userEvent.type(campo, "meio caminho"); });
    primeira.unmount();

    render(<MobileApp />);
    expect(await screen.findByLabelText("Sua resposta")).toHaveValue("meio caminho");
  });

  it("voltar sai da conversa para o projeto, e do projeto para o início", async () => {
    servidorPadrao();
    history.replaceState(null, "", "/#/c/c");
    render(<MobileApp />);
    await screen.findByText("Continuo aqui");

    // Aberta direto pelo endereço: não há tela anterior do app, então o voltar vai para o pai.
    await act(async () => { await userEvent.click(screen.getByRole("button", { name: "Voltar" })); });
    expect(window.location.hash).toBe("#/p/p");
    expect(await screen.findByRole("button", { name: /Abrir conversa/ })).toBeInTheDocument();

    await act(async () => { await userEvent.click(screen.getByRole("button", { name: "Voltar" })); });
    expect(await screen.findByRole("button", { name: /Abrir projeto/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Voltar" })).not.toBeInTheDocument();
  });

  it("chat abre no fim da conversa e busca as anteriores sob demanda", async () => {
    const urls: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      urls.push(url);
      if (url.includes("timeline")) {
        const antigas = url.includes("cursor=50");
        return new Response(JSON.stringify({
          timeline: {
            messages: [{ id: antigas ? "c:50" : "c:150", role: "assistant", text: antigas ? "Mensagem antiga" : "Mensagem nova", provider: "claude" }],
            next_cursor: antigas ? 150 : null, prev_cursor: antigas ? 0 : 50, unavailable_segments: [],
          }, actions: [] }));
      }
      return new Response(JSON.stringify(url === "/projetos" ? PROJETOS : url === "/atencao" ? [] : [conversaPronta()]));
    }));
    history.replaceState(null, "", "/#/c/c");
    render(<MobileApp />);

    expect(await screen.findByText("Mensagem nova")).toBeInTheDocument();
    // Sem cursor: o servidor devolve o fim.
    expect(urls.find(u => u.includes("timeline"))).toBe("/conversas/c/timeline");

    await act(async () => { await userEvent.click(screen.getByRole("button", { name: "Mensagens anteriores" })); });
    expect(await screen.findByText("Mensagem antiga")).toBeInTheDocument();
    await act(async () => { await userEvent.click(screen.getByRole("button", { name: "Ir para as mais recentes" })); });
    expect(await screen.findByText("Mensagem nova")).toBeInTheDocument();
  });
});

describe("anexos", () => {
  function servidorComUpload(uploads: { url: string; init: RequestInit }[], prompts: unknown[]) {
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === "POST" && url.endsWith("/anexos")) {
        uploads.push({ url, init });
        const nome = decodeURIComponent((init.headers as Record<string, string>)["X-Omni-Nome"]);
        return new Response(JSON.stringify({ caminho: `C:\\p\\.omni-agents\\anexos\\1726000000000-ab12-${nome}` }));
      }
      if (init?.method === "POST") {
        prompts.push(JSON.parse(String(init.body)));
        return new Response(JSON.stringify({ id: "a1", state: "queued" }), { status: 202 });
      }
      return new Response(JSON.stringify(
        url.includes("timeline") ? TIMELINE_VAZIA : url === "/projetos" ? PROJETOS : url === "/atencao" ? [] : [conversaPronta()]));
    }));
  }

  it("anexar arquivo sobe para o PC e manda o caminho junto com o texto", async () => {
    const uploads: { url: string; init: RequestInit }[] = [];
    const prompts: unknown[] = [];
    servidorComUpload(uploads, prompts);
    history.replaceState(null, "", "/#/c/c");
    render(<MobileApp />);

    const seletor = await screen.findByLabelText("Anexar arquivo");
    const pdf = new File(["%PDF"], "relatório.pdf", { type: "application/pdf" });
    await act(async () => { await userEvent.upload(seletor, pdf); });
    const anexos = screen.getByRole("list", { name: "Anexos" });
    expect(within(anexos).getByText("relatório.pdf")).toBeInTheDocument();

    await act(async () => {
      await userEvent.type(screen.getByLabelText("Sua resposta"), "Resuma isto");
      await userEvent.click(screen.getByRole("button", { name: "Enviar resposta" }));
    });

    await waitFor(() => expect(prompts).toHaveLength(1));
    expect(uploads).toHaveLength(1);
    expect(uploads[0].url).toBe("/conversas/c/anexos");
    expect(uploads[0].init.body).toBe(pdf);
    // Nome com acento vai codificado: cabeçalho HTTP não carrega acento.
    expect((uploads[0].init.headers as Record<string, string>)["X-Omni-Nome"]).toBe("relat%C3%B3rio.pdf");
    expect(prompts[0]).toEqual({ texto: `Resuma isto\n\n${MARCADOR_ANEXOS}\n- C:\\p\\.omni-agents\\anexos\\1726000000000-ab12-relatório.pdf` });

    // O balão mostra o texto e o anexo como cartão, não a lista de caminhos crua.
    expect(await screen.findByText("Resuma isto")).toBeInTheDocument();
    expect(within(screen.getByRole("list", { name: "Anexos da mensagem" })).getByText("relatório.pdf")).toBeInTheDocument();
    expect(screen.queryByRole("list", { name: "Anexos" })).not.toBeInTheDocument();
  });

  it("colar imagem no campo vira anexo; colar texto continua texto", async () => {
    servidorComUpload([], []);
    history.replaceState(null, "", "/#/c/c");
    render(<MobileApp />);
    const campo = await screen.findByLabelText("Sua resposta");

    const print = new File(["png"], "image.png", { type: "image/png" });
    fireEvent.paste(campo, { clipboardData: { files: [print], getData: () => "" } });
    const anexos = await screen.findByRole("list", { name: "Anexos" });
    expect(within(anexos).getByText("image.png")).toBeInTheDocument();
    expect(anexos.querySelector("img")).toHaveAttribute("src", "blob:previa");

    fireEvent.paste(campo, { clipboardData: { files: [], getData: () => "só texto" } });
    expect(within(anexos).getAllByRole("listitem")).toHaveLength(1);
  });

  it("só anexo, sem texto, também envia", async () => {
    const prompts: unknown[] = [];
    servidorComUpload([], prompts);
    history.replaceState(null, "", "/#/c/c");
    render(<MobileApp />);
    const seletor = await screen.findByLabelText("Anexar arquivo");
    expect(screen.getByRole("button", { name: "Enviar resposta" })).toBeDisabled();

    await act(async () => { await userEvent.upload(seletor, new File(["x"], "foto.jpg", { type: "image/jpeg" })); });
    await act(async () => { await userEvent.click(screen.getByRole("button", { name: "Enviar resposta" })); });

    await waitFor(() => expect(prompts).toHaveLength(1));
    const { texto } = prompts[0] as { texto: string };
    expect(texto.startsWith(MARCADOR_ANEXOS)).toBe(true);
  });

  it("falha no upload não manda o prompt e mostra qual arquivo falhou", async () => {
    const prompts: unknown[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === "POST" && url.endsWith("/anexos")) return new Response(JSON.stringify({ error: "Arquivo vazio" }), { status: 400 });
      if (init?.method === "POST") { prompts.push(init.body); return new Response(JSON.stringify({ id: "a" }), { status: 202 }); }
      return new Response(JSON.stringify(
        url.includes("timeline") ? TIMELINE_VAZIA : url === "/projetos" ? PROJETOS : url === "/atencao" ? [] : [conversaPronta()]));
    }));
    history.replaceState(null, "", "/#/c/c");
    render(<MobileApp />);
    const seletor = await screen.findByLabelText("Anexar arquivo");
    await act(async () => { await userEvent.upload(seletor, new File(["x"], "nota.txt", { type: "text/plain" })); });
    await act(async () => { await userEvent.click(screen.getByRole("button", { name: "Enviar resposta" })); });

    expect(await screen.findByText(/Não consegui mandar "nota.txt"/)).toBeInTheDocument();
    expect(within(screen.getByRole("list", { name: "Anexos" })).getByText("Arquivo vazio")).toBeInTheDocument();
    expect(prompts).toHaveLength(0);
  });

  it("arquivo acima de 25 MB é recusado no celular, antes de subir", async () => {
    servidorComUpload([], []);
    history.replaceState(null, "", "/#/c/c");
    render(<MobileApp />);
    const seletor = await screen.findByLabelText("Anexar arquivo");
    const enorme = new File(["x"], "video.mp4", { type: "video/mp4" });
    Object.defineProperty(enorme, "size", { value: 30 * 1024 * 1024 });
    await act(async () => { await userEvent.upload(seletor, enorme); });

    expect(screen.getByText(/Tire o anexo acima de 25 MB/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Enviar resposta" })).toBeDisabled();
    await act(async () => { await userEvent.click(screen.getByRole("button", { name: "Remover video.mp4" })); });
    expect(screen.queryByText(/Tire o anexo acima de 25 MB/)).not.toBeInTheDocument();
  });

  it("mensagem que nunca chega ao transcript para de girar e avisa", async () => {
    // `shouldAdvanceTime` mantém o userEvent funcionando com o relógio falso.
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
    // Rede de segurança: a CLI pode recusar a entrada sem responder nada, e o celular ficava em
    // "trabalhando" para sempre.
    const prompts: unknown[] = [];
    servidorComUpload([], prompts);
    history.replaceState(null, "", "/#/c/c");
    render(<MobileApp />);
    const campo = await screen.findByLabelText("Sua resposta");
    await act(async () => {
      await userEvent.type(campo, "some no limbo");
      await userEvent.click(screen.getByRole("button", { name: "Enviar resposta" }));
    });
    expect(await screen.findByText("some no limbo")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("O agente está trabalhando");

    // O relógio do balão vence sem a mensagem aparecer na timeline.
    await act(async () => { vi.advanceTimersByTime(121_000); });

    expect(await screen.findByText(/Não consegui confirmar o envio/)).toBeInTheDocument();
    expect(screen.queryByText("some no limbo")).not.toBeInTheDocument();
    } finally { vi.useRealTimers(); }
  });

  it("formato do prompt com anexos ida e volta", () => {
    const caminhos = ["C:\\p\\.omni-agents\\anexos\\1726000000000-ab12-a.png", "/home/u/p/.omni-agents/anexos/1726000000001-00ff-b.pdf"];
    const texto = montarPrompt("  Veja  ", caminhos);
    expect(separarAnexos(texto)).toEqual({ texto: "Veja", anexos: caminhos });
    expect(separarAnexos("Texto sem anexo")).toEqual({ texto: "Texto sem anexo", anexos: [] });
    // Marcador citado no meio de uma conversa, sem lista depois, não vira anexo.
    expect(separarAnexos(`fale sobre ${MARCADOR_ANEXOS} e tal`).anexos).toEqual([]);
    expect(montarPrompt("só texto", [])).toBe("só texto");
    expect(nomeDoCaminho(caminhos[0])).toBe("a.png");
    expect(nomeDoCaminho(caminhos[1])).toBe("b.pdf");
  });
});

describe("tema do PC", () => {
  it("aplica a paleta publicada pelo PC e guarda para a próxima abertura", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => new Response(JSON.stringify(
      url === "/projetos" ? { ...PROJETOS, theme: { accent: "roxo", theme: "claro", background: "gradient-waves", glass: "sutil" } } : []
    ))));
    render(<MobileApp />);

    const root = document.documentElement;
    await waitFor(() => expect(root.dataset.theme).toBe("claro"));
    // Variante clara da paleta roxa (#7C3AED), igual ao PC.
    expect(root.style.getPropertyValue("--c-accent")).toBe("124 58 237");
    expect(root.style.getPropertyValue("--omni-primary")).toBe("#7C3AED");
    // Fundo animado (WebGL) do PC vira a grade de pixels no celular.
    expect(root.dataset.bg).toBe("pixel-grid");
    expect(root.dataset.glass).toBe("sutil");
    expect(JSON.parse(localStorage.getItem("omni-tema")!)).toMatchObject({ accent: "roxo", theme: "claro" });
  });
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

    expect(await screen.findByRole("button", { name: /Abrir projeto/ })).toBeInTheDocument();
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
