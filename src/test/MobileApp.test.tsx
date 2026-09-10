import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MobileApp } from "../mobile/MobileApp";
import type { Conversation } from "../mobile/api";

afterEach(() => vi.unstubAllGlobals());

it("conversa sem sessão mostra histórico mas não oferece aprovação nem envio", async () => {
  vi.stubGlobal("fetch",vi.fn(async (url: string) => new Response(JSON.stringify(
    url.includes("timeline") ? { timeline: { messages: [{ id:"m",role:"assistant",text:"Resposta anterior",provider:"claude" }], next_cursor:null,unavailable_segments:[] },actions:[] }
      : url === "/atencao" ? [] : [{ id:"c",title:"Conversa de teste",provider:"claude",profile_id:"p",state:null,capabilities:null }]
  ))));
  render(<MobileApp />);
  await screen.findByRole("button",{name:"Abrir conversa"});
  await act(async () => { await userEvent.click(screen.getByRole("button",{name:"Abrir conversa"})); });
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
    const conversation: Conversation = { id:"c",title:"Teste",provider:"claude",profile_id:"p",state:"answered",capabilities:{prompt:true,approve:false,revision,approval_text:null,reason:null} };
    return new Response(JSON.stringify(url.includes("timeline") ? { timeline:{messages:[],next_cursor:null,unavailable_segments:[]},actions:[] } : [conversation]));
  }));
  render(<MobileApp />);
  await screen.findByRole("button",{name:"Abrir conversa"});
  await act(async () => { await userEvent.click(screen.getByRole("button",{name:"Abrir conversa"})); });
  await act(async () => { await userEvent.type(screen.getByLabelText("Sua resposta"),"Continuar"); await userEvent.click(screen.getByRole("button",{name:"Enviar resposta"})); });
  await screen.findByText(/Conexão perdida/);
  revision = '"new"';
  await act(async () => { await userEvent.click(screen.getByRole("button",{name:"Atualizar"})); });
  await act(async () => { await userEvent.click(screen.getByRole("button",{name:"Enviar resposta"})); });
  await waitFor(() => expect(posts).toHaveLength(2));
  expect(posts[1].headers).toEqual(posts[0].headers);
  expect((posts[1].headers as Record<string,string>)["If-Match"]).toBe('"first"');
});
