import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { invoke } from "@tauri-apps/api/core";
import { UsoDeTodasAsContas } from "../features/terminal/UsoDeTodasAsContas";

const janela = (used: number) => ({ used_percent: used, resets_at: null, reset_label: null });

it("botão do rodapé abre o uso de todas as contas e atualiza uma por vez", async () => {
  vi.mocked(invoke).mockReset().mockImplementation(async (command, args) => {
    if (command === "list_profiles") return [
      { id: "a", provider: "claude", name: "Pessoal" },
      { id: "b", provider: "codex", name: "Trabalho" },
      { id: "c", provider: "cursor", name: "Cursor" },
    ];
    const { profileId, refresh } = args as { profileId: string; refresh: boolean };
    const base = profileId === "a" ? 12 : 30;
    return { status: "available", observed_at_ms: 1, primary: janela(refresh ? 77 : base), secondary: janela(5), reason: null };
  });
  render(<UsoDeTodasAsContas engineOnline contaAtiva="a" />);
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

  await userEvent.click(screen.getByRole("button", { name: "Uso de todas as contas" }));
  const painel = await screen.findByRole("dialog", { name: "Uso das contas" });
  await waitFor(() => expect(within(painel).getByText("12%")).toBeInTheDocument());
  expect(within(painel).getByText("30%")).toBeInTheDocument();
  expect(within(painel).getByText("Pessoal")).toBeInTheDocument();
  // Todas as IAs aparecem; o Cursor sem medidor (a CLI não informa consumo) e sem consulta.
  expect(within(painel).getByRole("region", { name: "Cursor" })).toHaveTextContent("não informa o consumo");
  expect(invoke).not.toHaveBeenCalledWith("account_usage", expect.objectContaining({ profileId: "c" }));
  expect(within(painel).queryByRole("button", { name: /Atualizar uso de Cursor/ })).not.toBeInTheDocument();
  expect(invoke).not.toHaveBeenCalledWith("account_usage", expect.objectContaining({ refresh: true }));

  await userEvent.click(within(painel).getByRole("button", { name: "Atualizar uso de Trabalho (Codex)" }));
  await waitFor(() => expect(within(painel).getByText("77%")).toBeInTheDocument());
  expect(invoke).toHaveBeenCalledWith("account_usage", { profileId: "b", refresh: true });
  expect(within(painel).getByText("12%")).toBeInTheDocument();

  await userEvent.keyboard("{Escape}");
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});
