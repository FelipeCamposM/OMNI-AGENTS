import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { invoke } from "@tauri-apps/api/core";
import { ClaudeUsageStatus, timeAgo } from "../features/terminal/ClaudeUsageStatus";

it("rodapé lê o cache ao abrir e só digita /usage no botão de refresh", async () => {
  const observed = Date.now() - 3 * 60_000;
  vi.mocked(invoke).mockReset().mockImplementation(async (command, args) => {
    if (command === "list_profiles") return [
      { id: "antiga", provider: "claude", last_used_at_ms: 1 },
      { id: "recente", provider: "claude", last_used_at_ms: 2 },
    ];
    return (args as { refresh: boolean }).refresh
      ? { status: "available", observed_at_ms: observed, primary: { used_percent: 12, resets_at: null, reset_label: "Resets 3pm (America/Sao_Paulo)" }, secondary: { used_percent: 8, resets_at: null, reset_label: "Resets Sep 20, 10am (America/Sao_Paulo)" }, reason: null }
      : { status: "unknown", observed_at_ms: null, primary: null, secondary: null, reason: "Nenhuma sessão" };
  });
  render(<ClaudeUsageStatus engineOnline />);
  expect(await screen.findByText("sem consulta")).toBeInTheDocument();
  expect(invoke).toHaveBeenCalledWith("account_usage", { profileId: "recente", refresh: false });
  expect(invoke).not.toHaveBeenCalledWith("account_usage", expect.objectContaining({ refresh: true }));

  await userEvent.click(screen.getByRole("button", { name: "Consultar uso do Claude" }));
  await waitFor(() => expect(screen.getByText("12%")).toBeInTheDocument());
  expect(screen.getByText("8%")).toBeInTheDocument();
  expect(screen.getByText("· reseta 3pm")).toBeInTheDocument();
  expect(screen.getByText("· reseta Sep 20, 10am")).toBeInTheDocument();
  expect(screen.getByText("consultado há 3 min")).toBeInTheDocument();
});

it("tempo relativo", () => {
  expect(timeAgo(0, 30_000)).toBe("agora");
  expect(timeAgo(0, 2 * 3600_000)).toBe("há 2 h");
});
