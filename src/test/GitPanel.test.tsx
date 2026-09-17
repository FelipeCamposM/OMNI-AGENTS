import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { GitPanel } from "../components/GitPanel";

vi.mock("../features/git/gitService", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../features/git/gitService")>()),
  gitStatus: vi.fn(),
  gitCommit: vi.fn(),
  gitPush: vi.fn(),
  gitStage: vi.fn(),
}));

const { gitStatus, gitCommit, gitPush, gitStage } = vi.mocked(await import("../features/git/gitService"));

beforeEach(() => {
  vi.clearAllMocks();
  gitStatus.mockResolvedValue({ branch: "main", entries: [{ path: "a.ts", x: "M", y: "." }] });
  gitCommit.mockResolvedValue(undefined);
  gitPush.mockResolvedValue(undefined);
  gitStage.mockResolvedValue(undefined);
});

async function renderPanel() {
  render(<GitPanel projectPath="/dev/projeto" onOpenDiff={() => {}} onOpenGraph={() => {}} />);
  const textarea = await screen.findByPlaceholderText("Mensagem do commit");
  await userEvent.type(textarea, "feat: coisa");
  return textarea;
}

describe("GitPanel", () => {
  it("o botão Commit não faz push", async () => {
    await renderPanel();
    await userEvent.click(screen.getByRole("button", { name: "Commit" }));
    await waitFor(() => expect(gitCommit).toHaveBeenCalledWith("/dev/projeto", "feat: coisa"));
    expect(gitPush).not.toHaveBeenCalled();
  });

  it("Commit e push comita antes de empurrar", async () => {
    await renderPanel();
    await userEvent.click(screen.getByRole("button", { name: "Commit e push" }));
    await waitFor(() => expect(gitPush).toHaveBeenCalledWith("/dev/projeto"));
    expect(gitCommit.mock.invocationCallOrder[0]).toBeLessThan(gitPush.mock.invocationCallOrder[0]);
  });

  it("push que falha não esconde que o commit já foi feito", async () => {
    gitPush.mockRejectedValueOnce(new Error("remoto recusou"));
    await renderPanel();
    await userEvent.click(screen.getByRole("button", { name: "Commit e push" }));
    expect(await screen.findByText("remoto recusou")).toBeInTheDocument();
    expect(gitCommit).toHaveBeenCalled();
  });

  it("sem nada em stage, mostra Commit e leva todas as mudanças", async () => {
    gitStatus.mockResolvedValue({
      branch: "main",
      entries: [
        { path: "a.ts", x: ".", y: "M" },
        { path: "novo.ts", x: "?", y: "?" },
      ],
    });
    await renderPanel();
    await userEvent.click(screen.getByRole("button", { name: "Commit" }));
    await waitFor(() => expect(gitCommit).toHaveBeenCalled());
    expect(gitStage).toHaveBeenCalledWith("/dev/projeto", ["a.ts", "novo.ts"]);
    expect(gitStage.mock.invocationCallOrder[0]).toBeLessThan(gitCommit.mock.invocationCallOrder[0]);
  });

  it("com stage, não mexe no que ficou fora", async () => {
    await renderPanel();
    await userEvent.click(screen.getByRole("button", { name: "Commit" }));
    await waitFor(() => expect(gitCommit).toHaveBeenCalled());
    expect(gitStage).not.toHaveBeenCalled();
  });

  it("mudança feita por fora aparece sem recarregar o painel", async () => {
    gitStatus.mockResolvedValue({ branch: "main", entries: [] });
    render(<GitPanel projectPath="/dev/projeto" onOpenDiff={() => {}} onOpenGraph={() => {}} />);
    expect(await screen.findByText(/árvore limpa/)).toBeInTheDocument();
    gitStatus.mockResolvedValue({ branch: "main", entries: [{ path: "b.ts", x: ".", y: "M" }] });
    window.dispatchEvent(new Event("focus"));
    expect(await screen.findByPlaceholderText("Mensagem do commit")).toBeInTheDocument();
  });
});
