import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { GitPanel } from "../components/GitPanel";

vi.mock("../features/git/gitService", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../features/git/gitService")>()),
  gitStatus: vi.fn(),
  gitCommit: vi.fn(),
  gitPush: vi.fn(),
}));

const { gitStatus, gitCommit, gitPush } = vi.mocked(await import("../features/git/gitService"));

beforeEach(() => {
  vi.clearAllMocks();
  gitStatus.mockResolvedValue({ branch: "main", entries: [{ path: "a.ts", x: "M", y: "." }] });
  gitCommit.mockResolvedValue(undefined);
  gitPush.mockResolvedValue(undefined);
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
});
