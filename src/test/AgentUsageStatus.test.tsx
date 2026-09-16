import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { invoke } from "@tauri-apps/api/core";
import { AgentUsageStatus, timeAgo, usageTone } from "../features/terminal/AgentUsageStatus";
import { SessionProvidersContext } from "../features/terminal/sessionProviders";
import type { TerminalSession } from "../features/terminal/terminalService";

const janela = (used: number) => ({ used_percent: used, resets_at: null, reset_label: null });

function sessao(over: Partial<TerminalSession>): TerminalSession {
  return { id: "s1", cwd: "C:\\dev\\app", ...over } as TerminalSession;
}

it("rodapé lê o cache ao abrir e só digita /usage no botão de refresh", async () => {
  const observed = Date.now() - 3 * 60_000;
  vi.mocked(invoke).mockReset().mockImplementation(async (command, args) => {
    if (command === "list_profiles") return [
      { id: "antiga", provider: "claude", last_used_at_ms: 1 },
      { id: "recente", provider: "claude", last_used_at_ms: 2 },
    ];
    if (command === "agent_runtime") return null;
    return (args as { refresh: boolean }).refresh
      ? { status: "available", observed_at_ms: observed, primary: { used_percent: 12, resets_at: null, reset_label: "Resets 3pm (America/Sao_Paulo)" }, secondary: { used_percent: 8, resets_at: null, reset_label: "Resets Sep 20, 10am (America/Sao_Paulo)" }, reason: null }
      : { status: "unknown", observed_at_ms: null, primary: null, secondary: null, reason: "Nenhuma sessão" };
  });
  render(<AgentUsageStatus engineOnline />);
  expect(await screen.findByText("sem consulta")).toBeInTheDocument();
  await waitFor(() => expect(invoke).toHaveBeenCalledWith("account_usage", { profileId: "recente", refresh: false }));
  expect(invoke).not.toHaveBeenCalledWith("account_usage", expect.objectContaining({ refresh: true }));

  await userEvent.click(screen.getByRole("button", { name: "Consultar uso do CLAUDE" }));
  await waitFor(() => expect(screen.getByText("12%")).toBeInTheDocument());
  expect(screen.getByText("8%")).toBeInTheDocument();
  expect(screen.getByText("· reseta 3pm")).toBeInTheDocument();
  expect(screen.getByText("· reseta Sep 20, 10am")).toBeInTheDocument();
  expect(screen.getByText("consultado há 3 min")).toBeInTheDocument();
});

it("segue o agente da aba em foco, com modelo e esforço da sessão", async () => {
  // Duas contas de providers diferentes: sem a aba em foco o rodapé pegaria a mais recente (Codex).
  vi.mocked(invoke).mockReset().mockImplementation(async (command, args) => {
    if (command === "list_profiles") return [
      { id: "claude-1", provider: "claude", last_used_at_ms: 1 },
      { id: "codex-1", provider: "codex", last_used_at_ms: 99 },
    ];
    if (command === "agent_runtime") {
      expect(args).toMatchObject({ provider: "claude", profileId: "claude-1", externalSessionId: "ext-9" });
      return { model: "claude-opus-5", effort: "high", cli_version: "2.1.0", source: "sessao" };
    }
    return { status: "available", observed_at_ms: Date.now(), primary: janela(72), secondary: janela(9), reason: null };
  });

  const sessions = { s1: sessao({ provider: "claude", profile_id: "claude-1", external_session_id: "ext-9" }) };
  render(
    <SessionProvidersContext.Provider value={sessions}>
      <AgentUsageStatus engineOnline activeSessionId="s1" />
    </SessionProvidersContext.Provider>
  );

  expect(await screen.findByText("Opus 5 · esforço alto")).toBeInTheDocument();
  expect(screen.getByLabelText("Uso do CLAUDE")).toBeInTheDocument();
  expect(invoke).toHaveBeenCalledWith("account_usage", { profileId: "claude-1", refresh: false });
  expect(invoke).not.toHaveBeenCalledWith("account_usage", expect.objectContaining({ profileId: "codex-1" }));
});

it("barra mostra a fração consumida e troca de cor nas faixas pedidas", async () => {
  vi.mocked(invoke).mockReset().mockImplementation(async (command) => {
    if (command === "list_profiles") return [{ id: "codex-1", provider: "codex", last_used_at_ms: 1 }];
    if (command === "agent_runtime") return null;
    return { status: "available", observed_at_ms: Date.now(), primary: janela(90), secondary: janela(60), reason: null };
  });
  render(<AgentUsageStatus engineOnline />);

  const cinco = await screen.findByRole("progressbar", { name: "5H consumido" });
  expect(cinco).toHaveAttribute("aria-valuenow", "90");
  expect(cinco.firstElementChild).toHaveStyle({ width: "90%" });
  expect(cinco.firstElementChild?.className).toContain("bg-danger");

  const semana = screen.getByRole("progressbar", { name: "SEMANA consumido" });
  expect(semana.firstElementChild?.className).toContain("bg-success");
  // O número acompanha a mesma faixa da barra.
  expect(within(screen.getByLabelText("Uso do CODEX")).getByText("90%").className).toContain("text-danger");
});

it("faixas de cor: verde até 60, amarelo até 85, vermelho acima", () => {
  expect([0, 60].map(v => usageTone(v).bar)).toEqual(["bg-success", "bg-success"]);
  expect([60.1, 85].map(v => usageTone(v).bar)).toEqual(["bg-warning", "bg-warning"]);
  expect([85.4, 86, 100].map(v => usageTone(v).bar)).toEqual(["bg-danger", "bg-danger", "bg-danger"]);
});

it("tempo relativo", () => {
  expect(timeAgo(0, 30_000)).toBe("agora");
  expect(timeAgo(0, 2 * 3600_000)).toBe("há 2 h");
});
