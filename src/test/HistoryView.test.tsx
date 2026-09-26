import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HistoryView } from "../features/history/HistoryView";

vi.mock("../features/history/historyService", async (original) => ({
  ...(await original<typeof import("../features/history/historyService")>()),
  listHistory: vi.fn().mockResolvedValue([]),
}));

it("em tela cheia, o histórico fecha pelo botão do topo, igual às Configurações", async () => {
  const onClose = vi.fn();
  render(<HistoryView onResume={vi.fn()} onClose={onClose} />);

  const fechar = screen.getByRole("button", { name: "Fechar histórico" });
  expect(fechar).toHaveAttribute("title", "Fechar histórico (Escape)");
  await userEvent.click(fechar);
  expect(onClose).toHaveBeenCalledTimes(1);
});

it("embutido no Novo agente não mostra o fechar", () => {
  render(<HistoryView onResume={vi.fn()} lock={{ provider: "claude", cwd: "C:/dev/app" }} />);
  expect(screen.queryByRole("button", { name: "Fechar histórico" })).toBeNull();
});
