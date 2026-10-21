import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AbaDeAgente } from "../features/conversa/AbaDeAgente";
import { transporteDoEngine } from "../features/conversa/transporteDoEngine";
import { usarTransporte } from "../mobile/api";
import { SessionProvidersContext } from "../features/terminal/sessionProviders";
import type { TerminalSession } from "../features/terminal/terminalService";

const engine = vi.hoisted(() => ({
  listTerminalSessions: vi.fn(),
  engineApi: vi.fn(),
}));
vi.mock("../features/terminal/terminalService", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../features/terminal/terminalService")>()),
  ...engine,
}));

const CONVERSA = {
  id: "conv-1", title: "Corrigir o login", project_id: "p", provider: "claude", profile_id: "p", state: "answered",
  capabilities: { prompt: true, approve: false, revision: '"r"', approval_text: null, reason: null }, live: true,
};
const TIMELINE = {
  timeline: { messages: [{ id: "m0", role: "assistant", text: "Resposta anterior", provider: "claude" }], next_cursor: null, prev_cursor: null, unavailable_segments: [] },
  actions: [],
  conversation: CONVERSA,
};

beforeEach(() => {
  vi.clearAllMocks();
  usarTransporte(transporteDoEngine);
  engine.listTerminalSessions.mockResolvedValue([{ id: "s1", conversation_id: "conv-1" }]);
  engine.engineApi.mockImplementation(async (_method: string, path: string) =>
    ({ type: "api", status: 200, body: JSON.stringify(path.includes("/timeline") ? TIMELINE : {}) }));
  window.HTMLElement.prototype.scrollTo = vi.fn() as never;
});
afterEach(() => usarTransporte((path, init) => fetch(path, init)));

describe("AbaDeAgente", () => {
  it("Cursor (sem visão de conversa) fica no terminal mesmo no modo Conversa", async () => {
    const sessoes = { s1: { id: "s1", provider: "cursor" } as unknown as TerminalSession };
    render(
      <SessionProvidersContext.Provider value={sessoes}>
        <AbaDeAgente agentView="conversa" sessionId="s1"><p>TERMINAL</p></AbaDeAgente>
      </SessionProvidersContext.Provider>,
    );
    expect(screen.getByText("TERMINAL").parentElement).not.toHaveClass("invisible");
    expect(screen.queryByRole("tab", { name: "Terminal" })).not.toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: "Conversa" })).not.toBeInTheDocument();
  });

  it("no modo Conversa mostra o chat por cima do terminal, que continua montado", async () => {
    render(<AbaDeAgente agentView="conversa" sessionId="s1"><p>TERMINAL</p></AbaDeAgente>);

    expect(await screen.findByText("Resposta anterior")).toBeInTheDocument();
    // O terminal nunca desmonta (failover e respostas ao ConPTY dependem dele), mas fica invisível:
    // nada dele aparece por trás da conversa.
    expect(screen.getByText("TERMINAL")).toBeInTheDocument();
    expect(screen.getByText("TERMINAL").parentElement).toHaveClass("invisible");
    // A conversa passou pelo protocolo local do engine, não por HTTP.
    expect(engine.engineApi).toHaveBeenCalledWith("GET", "/conversas/conv-1/timeline", null, expect.anything());

    await act(async () => {
      await userEvent.click(screen.getByRole("tab", { name: "Terminal" }));
    });
    expect(screen.queryByText("Resposta anterior")).not.toBeInTheDocument();
    expect(screen.getByText("TERMINAL").parentElement).not.toHaveClass("invisible");
    await act(async () => {
      await userEvent.click(screen.getByRole("tab", { name: "Conversa" }));
    });
    expect(await screen.findByText("Resposta anterior")).toBeInTheDocument();
  });

  // Reabrindo uma conversa fechada o `claude --resume` ainda está sendo digitado: antes a conversa
  // dizia "trabalhando" e depois "entrada não reconhecida". Agora mostra as etapas até o agente subir.
  it("sessão recém-aberta mostra as etapas até o agente ficar pronto", async () => {
    let pronto = false;
    engine.listTerminalSessions.mockResolvedValue([{ id: "s1", conversation_id: "conv-1", created_at_ms: Date.now() }]);
    engine.engineApi.mockImplementation(async (_method: string, path: string) => ({
      type: "api", status: 200,
      body: JSON.stringify(path.includes("/timeline") ? { ...TIMELINE, conversation: { ...CONVERSA, state: "working",
        capabilities: { ...CONVERSA.capabilities, prompt: pronto, iniciando: !pronto, reason: pronto ? null : "Entrada do CLI não reconhecida" } } } : {}),
    }));
    render(<AbaDeAgente agentView="conversa" sessionId="s1"><p>TERMINAL</p></AbaDeAgente>);

    expect(await screen.findByText("Iniciando o Claude")).toBeInTheDocument();
    expect(screen.queryByText("Resposta anterior")).not.toBeInTheDocument();
    expect(screen.queryByText(/não reconhecida/)).not.toBeInTheDocument();
    pronto = true;
    expect(await screen.findByText("Resposta anterior", undefined, { timeout: 3000 })).toBeInTheDocument();
  });

  it("no modo Terminal e antes de existir sessão, só o terminal", () => {
    const { rerender } = render(<AbaDeAgente agentView="terminal" sessionId="s1"><p>TERMINAL</p></AbaDeAgente>);
    expect(screen.queryByRole("button", { name: /Ver / })).not.toBeInTheDocument();
    rerender(<AbaDeAgente agentView="conversa" sessionId={null}><p>TERMINAL</p></AbaDeAgente>);
    expect(screen.queryByRole("button", { name: /Ver / })).not.toBeInTheDocument();
    expect(engine.engineApi).not.toHaveBeenCalled();
  });

  it("engine antigo sem a rota explica em vez de ficar carregando", async () => {
    engine.engineApi.mockRejectedValue(new Error("unknown variant `api`"));
    render(<AbaDeAgente agentView="conversa" sessionId="s1"><p>TERMINAL</p></AbaDeAgente>);
    expect(await screen.findByText(/unknown variant/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Tentar de novo" })).toBeInTheDocument();
  });

  /** O relato: "preciso que o copiar imagem funcione". Imagem colada no chat do PC virava erro —
   *  o protocolo local só levava texto. */
  it("imagem colada vai em base64, com o nome e sem o token do celular", async () => {
    engine.engineApi.mockResolvedValue({ type: "api", status: 200, body: JSON.stringify({ caminho: "C:/p/print.png" }) });
    const png = new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])], "print.png", { type: "image/png" });

    const resposta = await transporteDoEngine("/conversas/c/anexos", {
      method: "POST",
      body: png,
      headers: { "Content-Type": "image/png", "X-Omni-Nome": "print.png", "X-Omni-Token": "segredo" },
    });

    expect(await resposta.json()).toEqual({ caminho: "C:/p/print.png" });
    expect(engine.engineApi).toHaveBeenCalledWith("POST", "/conversas/c/anexos", null, {
      bodyBase64: "iVBORw0KGgo=",
      headers: [["Content-Type", "image/png"], ["X-Omni-Nome", "print.png"]],
    });
  });

  /** "Trocar facilmente também no terminal a conta, igual na conversa." */
  it("no modo Terminal, a faixa acima do terminal troca a conta como na conversa", async () => {
    const OPCOES = {
      provider: "claude", profile_id: "emailuber", model: "claude-opus-5-5", effort: "medium", can_resume: true,
      profiles: [{ id: "claude-padrao", name: "Padrão" }, { id: "emailuber", name: "EmailUber" }],
      models: [{ id: "opus", label: "Opus", efforts: ["low", "medium", "high"] }],
    };
    engine.engineApi.mockImplementation(async (_method: string, path: string) => ({
      type: "api", status: path.includes("/ajustes") ? 202 : 200,
      body: JSON.stringify(path.includes("/opcoes") ? OPCOES : path.includes("/ajustes") ? { id: "a" } : TIMELINE),
    }));
    render(<AbaDeAgente agentView="terminal" sessionId="s1"><p>TERMINAL</p></AbaDeAgente>);

    expect(await screen.findByText("EmailUber", {}, { timeout: 4000 })).toBeInTheDocument();
    expect(screen.getByText("TERMINAL").parentElement).not.toHaveClass("invisible");
    const [conta] = screen.getAllByRole("combobox");
    await act(async () => { await userEvent.click(conta); });
    await act(async () => { await userEvent.click(screen.getByRole("option", { name: "Padrão" })); });
    await act(async () => { await userEvent.click(screen.getByRole("button", { name: /Aplicar/ })); });

    const pedido = engine.engineApi.mock.calls.find((chamada) => String(chamada[1]).endsWith("/ajustes"));
    expect(pedido?.[2]).toBe(JSON.stringify({ profile_id: "claude-padrao", model: "opus", effort: "medium" }));
    expect(pedido?.[3].headers).toContainEqual(["If-Match", '"r"']);
  });
});
