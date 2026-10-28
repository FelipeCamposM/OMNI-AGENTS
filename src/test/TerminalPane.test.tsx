import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { TerminalPane } from "../features/terminal/TerminalPane";
import type { WorkspaceTab } from "../types/workspace";

const engine = vi.hoisted(() => ({
  ensureEngine: vi.fn().mockResolvedValue(undefined),
  terminalSnapshot: vi.fn(),
  writeTerminal: vi.fn().mockResolvedValue(undefined),
  resizeTerminal: vi.fn().mockResolvedValue(undefined),
  restartTerminal: vi.fn().mockResolvedValue(undefined),
  stopTerminal: vi.fn().mockResolvedValue(undefined),
  spawnTerminal: vi.fn(),
  attachTerminal: vi.fn().mockResolvedValue(undefined),
  accountUsage: vi.fn(),
  beginConversation: vi.fn(),
  ensureAgentTrust: vi.fn().mockResolvedValue(undefined),
  listAgentClis: vi.fn(),
  listProfiles: vi.fn(),
  planSwitch: vi.fn(),
  engineApi: vi.fn(),
}));

vi.mock("../features/terminal/terminalService", async (original) => ({
  ...(await original<typeof import("../features/terminal/terminalService")>()),
  ...engine,
}));

function snapshot(seq: number, extra: Record<string, unknown> = {}) {
  return {
    data: "",
    from_seq: seq,
    next_seq: seq + 1,
    session: { id: "s1", state: "working", input_locked: false, ...extra },
  };
}

const tab: WorkspaceTab = { id: "t1", kind: "terminal", title: "Terminal", resourceId: "s1" };

function renderPane() {
  return render(
    <TerminalPane
      projectId="p1"
      projectPath="C:/dev/projeto"
      paneId="pane-1"
      tab={tab}
      onSessionCreated={vi.fn()}
    />
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("TerminalPane — resiliência do poll", () => {
  it("não mostra banner por falha isolada", async () => {
    engine.terminalSnapshot
      .mockRejectedValueOnce(new Error("os error 10048"))
      .mockResolvedValue(snapshot(1));

    renderPane();

    await waitFor(() => expect(engine.terminalSnapshot).toHaveBeenCalledTimes(2));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("mostra o banner depois de três falhas seguidas e o tira quando volta a responder", async () => {
    const falha = new Error(
      "Normalmente é permitida apenas uma utilização de cada endereço de soquete. (os error 10048)"
    );
    engine.terminalSnapshot.mockRejectedValue(falha);

    renderPane();

    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("os error 10048"));

    // Engine voltou: o banner sai sozinho, sem precisar trocar de projeto e voltar.
    engine.terminalSnapshot.mockResolvedValue(snapshot(1));
    await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument(), { timeout: 4_000 });
  });
});

describe("TerminalPane — etiqueta de modelo", () => {
  it("aparece em sessão restaurada, que nunca passou pelo seletor de agente", async () => {
    // O caso que falhou de verdade: app reaberto, aba reatachada. `launch` é null para sempre,
    // então tudo que identifica o agente tem de sair do snapshot da sessão.
    engine.terminalSnapshot.mockResolvedValue(
      snapshot(1, {
        provider: "claude",
        profile_id: "claude-padrao",
        external_session_id: "c962cd0e",
      })
    );
    const { invoke } = await import("@tauri-apps/api/core");
    vi.mocked(invoke).mockResolvedValue({
      model: "claude-opus-5",
      effort: "high",
      cli_version: "2.1.273",
    });

    renderPane();

    expect(await screen.findByLabelText(/modelo em uso: opus 5, esforço alto/i)).toBeInTheDocument();
    expect(vi.mocked(invoke)).toHaveBeenCalledWith(
      "agent_runtime",
      expect.objectContaining({ provider: "claude", externalSessionId: "c962cd0e" })
    );
  });

  it("terminal puro (sem provider) não mostra etiqueta nenhuma", async () => {
    engine.terminalSnapshot.mockResolvedValue(snapshot(1));
    renderPane();

    await waitFor(() => expect(engine.terminalSnapshot).toHaveBeenCalled());
    expect(screen.queryByLabelText(/modelo em uso/i)).not.toBeInTheDocument();
  });
});

describe("TerminalPane — sessão morta", () => {
  it("religa sozinha a sessão que o engine só conhece como histórica", async () => {
    engine.terminalSnapshot.mockResolvedValue({ ...snapshot(0, { state: "stopped" }), next_seq: 0 });
    renderPane();
    await waitFor(() => expect(engine.restartTerminal).toHaveBeenCalledWith("s1"));
    await waitFor(() => expect(engine.terminalSnapshot.mock.calls.length).toBeGreaterThan(2));
    expect(engine.restartTerminal).toHaveBeenCalledTimes(1);
  });

  it("não religa sessão parada que ainda tem saída no engine", async () => {
    engine.terminalSnapshot.mockResolvedValue(snapshot(5, { state: "stopped" }));
    renderPane();
    await waitFor(() => expect(engine.terminalSnapshot.mock.calls.length).toBeGreaterThan(2));
    expect(engine.restartTerminal).not.toHaveBeenCalled();
  });
});

describe("TerminalPane — ritmo da leitura", () => {
  /** Não há eco local: a tecla só aparece quando a leitura seguinte traz o redesenho da CLI. Com
   *  ritmo fixo de 100ms isso custava até 100ms por tecla — o "teclado lerdo" relatado. */
  it("com saída nova, lê num ritmo de quadro em vez de 100ms", async () => {
    let seq = 1;
    engine.terminalSnapshot.mockImplementation(async () => {
      seq += 1;
      return { ...snapshot(seq), data: "x" };
    });

    renderPane();
    await waitFor(() => expect(engine.terminalSnapshot).toHaveBeenCalled());
    const inicio = engine.terminalSnapshot.mock.calls.length;
    await new Promise((resolve) => setTimeout(resolve, 600));
    const leituras = engine.terminalSnapshot.mock.calls.length - inicio;

    // Em 600ms, o ritmo econômico (100ms) dá no máximo ~6 leituras; o de quadro, dezenas. Janela
    // larga porque é relógio de verdade: com a suíte inteira rodando em paralelo, 250ms/5 leituras
    // falhava às vezes sem regressão nenhuma.
    expect(leituras).toBeGreaterThan(8);
  });

  it("sem saída nenhuma, volta ao ritmo econômico", async () => {
    engine.terminalSnapshot.mockResolvedValue({ ...snapshot(1), data: "" });

    renderPane();
    await waitFor(() => expect(engine.terminalSnapshot).toHaveBeenCalled());
    // Passa a janela de atividade inicial antes de medir.
    await new Promise((resolve) => setTimeout(resolve, 750));
    const inicio = engine.terminalSnapshot.mock.calls.length;
    await new Promise((resolve) => setTimeout(resolve, 300));
    const leituras = engine.terminalSnapshot.mock.calls.length - inicio;

    expect(leituras).toBeLessThan(8);
  });
});

it("renomear a aba não derruba o terminal", async () => {
  // O nome automático chega depois do primeiro prompt. Se o título estivesse nas dependências do
  // efeito, o xterm seria destruído e o scrollback reproduzido do zero no meio da conversa.
  engine.terminalSnapshot.mockResolvedValue(snapshot(1));
  const { rerender } = render(
    <TerminalPane projectId="p1" projectPath="C:/dev/projeto" paneId="pane-1" tab={tab} onSessionCreated={vi.fn()} />
  );
  await waitFor(() => expect(engine.terminalSnapshot).toHaveBeenCalled());
  const leiturasAntes = engine.terminalSnapshot.mock.calls.length;

  rerender(
    <TerminalPane
      projectId="p1"
      projectPath="C:/dev/projeto"
      paneId="pane-1"
      tab={{ ...tab, title: "Corrigir o login" }}
      onSessionCreated={vi.fn()}
    />
  );
  await new Promise((resolve) => setTimeout(resolve, 150));

  // Remontar recomeçaria a sequência: a primeira leitura da montagem nova pede `since` 0.
  const desdeZero = engine.terminalSnapshot.mock.calls.slice(leiturasAntes).filter(([, since]) => since === 0);
  expect(desdeZero).toHaveLength(0);
});

describe("TerminalPane — troca de conta e compactação automáticas", () => {
  // Quem decide e age é o engine (`crates/omni-engine/src/automatico.rs`, testado lá); a aba só
  // mostra o selo e nunca troca de conta nem digita nada sozinha.
  it("mostra o selo do que o engine fez e não age por conta própria", async () => {
    engine.terminalSnapshot.mockResolvedValue(snapshot(1, {
      state: "answered", notice: "usage_limit", provider: "claude", profile_id: "pessoal", conversation_id: "conv-1",
      automatico: { tom: "success", texto: "conta trocada: Pessoal → Trabalho", detalhe: "Limite de Pessoal atingido" },
    }));
    renderPane();
    expect(await screen.findByRole("status")).toHaveTextContent("conta trocada: Pessoal → Trabalho");
    expect(screen.getByRole("status")).toHaveAttribute("title", "Limite de Pessoal atingido");
    await waitFor(() => expect(engine.terminalSnapshot.mock.calls.length).toBeGreaterThan(2));
    expect(engine.stopTerminal).not.toHaveBeenCalled();
    expect(engine.spawnTerminal).not.toHaveBeenCalled();
    expect(engine.engineApi).not.toHaveBeenCalled();
  });
});

describe("TerminalPane — abrir e reabrir terminal", () => {
  it("abre uma PTY só mesmo com o efeito rodando duas vezes (StrictMode)", async () => {
    const { StrictMode } = await import("react");
    let soltar: (valor: unknown) => void = () => {};
    engine.spawnTerminal.mockReturnValue(new Promise((resolve) => { soltar = resolve; }));
    engine.terminalSnapshot.mockResolvedValue(snapshot(1, { id: "novo" }));
    const onSessionCreated = vi.fn();
    render(
      <StrictMode>
        <TerminalPane projectId="p1" projectPath="C:/dev/projeto" paneId="pane-1"
          tab={{ id: "t2", kind: "terminal", title: "Novo terminal" }} onSessionCreated={onSessionCreated} />
      </StrictMode>
    );
    await waitFor(() => expect(engine.spawnTerminal).toHaveBeenCalled());
    soltar({ id: "novo", name: "Terminal", state: "working" });
    await waitFor(() => expect(onSessionCreated).toHaveBeenCalledWith("novo", "Terminal", undefined));
    expect(engine.spawnTerminal).toHaveBeenCalledTimes(1);
    expect(onSessionCreated).toHaveBeenCalledTimes(1);
  });

  it("não devolve à PTY as respostas do xterm ao histórico reproduzido", async () => {
    const { Terminal } = await import("@xterm/xterm");
    let digitar: (dados: string) => void = () => {};
    let terminarEscrita: (() => void) | undefined;
    vi.spyOn(Terminal.prototype, "onData").mockImplementation((fn: (dados: string) => void) => { digitar = fn; return { dispose() {} }; });
    vi.spyOn(Terminal.prototype, "write").mockImplementation((_dados: unknown, pronto?: () => void) => { terminarEscrita ??= pronto; });
    engine.terminalSnapshot.mockResolvedValueOnce({ ...snapshot(0), data: "PS C:\> \u001b[6n" }).mockResolvedValue(snapshot(1));

    renderPane();
    await waitFor(() => expect(terminarEscrita).toBeDefined());
    // O xterm responde à pergunta de posição do cursor que estava no histórico: não vai para o shell.
    digitar("\u001b[3;9R");
    expect(engine.writeTerminal).not.toHaveBeenCalled();
    // Histórico desenhado: o que você digita volta a ir.
    terminarEscrita?.();
    digitar("ls");
    expect(engine.writeTerminal).toHaveBeenCalledWith("s1", "ls");
    vi.restoreAllMocks();
  });
});
