import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { GitBranchStatus } from "../features/git/GitBranchStatus";

vi.mock("../features/git/gitService", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../features/git/gitService")>()),
  gitStatus: vi.fn(),
  gitPull: vi.fn(),
  gitBranches: vi.fn(),
  gitCheckoutBranch: vi.fn(),
}));

const { gitStatus, gitPull, gitBranches, gitCheckoutBranch } = vi.mocked(await import("../features/git/gitService"));

beforeEach(() => {
  vi.clearAllMocks();
  gitStatus.mockResolvedValue({ branch: "main", entries: [] });
  gitPull.mockResolvedValue("Already up to date.");
  gitBranches.mockResolvedValue([
    { name: "main", current: true },
    { name: "feat/logo", current: false },
  ]);
  gitCheckoutBranch.mockResolvedValue(undefined);
});

describe("GitBranchStatus", () => {
  it("mostra a branch e puxa no clique", async () => {
    render(<GitBranchStatus projectPath="/dev/projeto" />);
    expect(await screen.findByText("⎇ main")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "pull" }));
    await waitFor(() => expect(gitPull).toHaveBeenCalledWith("/dev/projeto"));
    expect(await screen.findByText("Already up to date.")).toBeInTheDocument();
  });

  it("pull recusado mostra o motivo do git", async () => {
    gitPull.mockRejectedValueOnce(new Error("fatal: Not possible to fast-forward, aborting."));
    render(<GitBranchStatus projectPath="/dev/projeto" />);
    await userEvent.click(await screen.findByRole("button", { name: "pull" }));
    expect(await screen.findByText(/Not possible to fast-forward/)).toBeInTheDocument();
  });

  it("projeto sem git não ocupa espaço no rodapé", async () => {
    gitStatus.mockResolvedValue(null);
    const { container } = render(<GitBranchStatus projectPath="/dev/sem-git" />);
    await waitFor(() => expect(gitStatus).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });

  it("clicar na branch abre a lista e troca para outra", async () => {
    render(<GitBranchStatus projectPath="/dev/projeto" />);
    await userEvent.click(await screen.findByRole("button", { name: /⎇ main/ }));
    await userEvent.click(await screen.findByRole("button", { name: /feat\/logo/ }));
    await waitFor(() => expect(gitCheckoutBranch).toHaveBeenCalledWith("/dev/projeto", "feat/logo", false));
  });

  it("nome que não existe vira branch nova a partir da atual", async () => {
    render(<GitBranchStatus projectPath="/dev/projeto" />);
    await userEvent.click(await screen.findByRole("button", { name: /⎇ main/ }));
    await userEvent.type(await screen.findByLabelText(/nome da branch nova/i), "fix/rodape");
    await userEvent.click(screen.getByRole("button", { name: /Criar .fix\/rodape. a partir de main/ }));
    await waitFor(() => expect(gitCheckoutBranch).toHaveBeenCalledWith("/dev/projeto", "fix/rodape", true));
  });

  it("o atalho abre direto o campo de nome", async () => {
    render(<GitBranchStatus projectPath="/dev/projeto" />);
    await screen.findByRole("button", { name: /⎇ main/ });
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "B", code: "KeyB", ctrlKey: true, shiftKey: true, bubbles: true }));
    expect(await screen.findByLabelText(/nome da branch nova/i)).toBeInTheDocument();
  });

  it("o popover é fixo — o rodapé tem overflow-hidden e recortaria um absolute", async () => {
    render(<GitBranchStatus projectPath="/dev/projeto" />);
    await userEvent.click(await screen.findByRole("button", { name: /⎇ main/ }));
    const dialogo = await screen.findByRole("dialog", { name: "Branches" });
    expect(dialogo.className).toContain("fixed");
    expect(dialogo.className).not.toContain("absolute");
  });
});
