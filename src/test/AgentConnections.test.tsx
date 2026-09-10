import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AgentConnections } from "../features/terminal/AgentConnections";
import type { AgentCliStatus, Profile } from "../features/terminal/terminalService";

const listAgentClis = vi.fn();
const listProfiles = vi.fn();
const connectAgentCli = vi.fn();
const createProfile = vi.fn();

vi.mock("../features/terminal/terminalService", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../features/terminal/terminalService")>()),
  listAgentClis: () => listAgentClis(),
  listProfiles: () => listProfiles(),
  connectAgentCli: (...args: unknown[]) => connectAgentCli(...args),
  createProfile: (...args: unknown[]) => createProfile(...args),
  deleteProfile: vi.fn(),
}));

function agent(overrides: Partial<AgentCliStatus> = {}): AgentCliStatus {
  return {
    id: "claude",
    label: "Claude",
    command: "claude",
    path: "C:\\Users\\dev\\.local\\bin\\claude.exe",
    available: true,
    authenticated: true,
    ...overrides,
  };
}

function profile(overrides: Partial<Profile> = {}): Profile {
  return {
    id: "claude-padrao",
    provider: "claude",
    name: "Padrão",
    config_dir: "C:\\Users\\dev\\.claude",
    builtin: true,
    created_at_ms: 0,
    last_used_at_ms: null,
    authenticated: true,
    ...overrides,
  };
}

beforeEach(() => {
  listAgentClis.mockReset();
  listProfiles.mockReset();
  connectAgentCli.mockReset().mockResolvedValue(undefined);
  createProfile.mockReset();
  listProfiles.mockResolvedValue([]);
});

describe("AgentConnections", () => {
  // "instalado" e "conectado" eram indistinguíveis: `available` só significava "resolve no PATH",
  // e o melhor estado que a UI sabia mostrar era o botão "Conectar".
  it("separa conectado, instalado sem login e ausente", async () => {
    listAgentClis.mockResolvedValue([
      agent({ id: "claude", label: "Claude", authenticated: true }),
      agent({ id: "gemini", label: "Gemini", command: "gemini", authenticated: false }),
      agent({ id: "cursor", label: "Cursor", command: "cursor-agent", path: null, available: false, authenticated: false }),
    ]);

    render(<AgentConnections />);

    await waitFor(() => expect(screen.getByText("conectado")).toBeInTheDocument());
    expect(screen.getByText("sem login")).toBeInTheDocument();
    expect(screen.getByText(/não encontrada no PATH/i)).toBeInTheDocument();

    // Providers sem isolamento de config dir mantêm o botão único de login.
    expect(screen.getByRole("button", { name: "Entrar" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Não instalado" })).toBeDisabled();
  });

  it("mostra o caminho resolvido, não só o nome do comando", async () => {
    listAgentClis.mockResolvedValue([agent()]);
    render(<AgentConnections />);
    await waitFor(() => expect(screen.getByText(/claude\.exe/)).toBeInTheDocument());
  });

  it("lista as contas de um provider multi-conta e loga em cada uma isoladamente", async () => {
    listAgentClis.mockResolvedValue([agent()]);
    listProfiles.mockResolvedValue([
      profile(),
      profile({ id: "trabalho", name: "Trabalho", builtin: false, authenticated: false }),
    ]);

    render(<AgentConnections />);

    await waitFor(() => expect(screen.getByText("Trabalho")).toBeInTheDocument());
    const account = screen.getByText("Trabalho").closest("li");
    expect(account).not.toBeNull();

    await userEvent.click(within(account as HTMLElement).getByRole("button", { name: "Entrar" }));
    // O login tem que carregar o profile: sem ele o CLI autentica no config dir nativo e a conta
    // nova nasceria eternamente vazia.
    expect(connectAgentCli).toHaveBeenCalledWith("claude", "trabalho");

    // O perfil padrão não pode ser removido — é o que preserva o login que já existia.
    const builtin = screen.getByText("Padrão").closest("li") as HTMLElement;
    expect(within(builtin).queryByRole("button", { name: "Remover" })).toBeNull();
  });

  it("criar conta grava o perfil e já abre o login dele", async () => {
    listAgentClis.mockResolvedValue([agent()]);
    listProfiles.mockResolvedValue([profile()]);
    createProfile.mockResolvedValue(profile({ id: "cliente-x", name: "Cliente X", builtin: false, authenticated: false }));

    render(<AgentConnections />);
    await waitFor(() => expect(screen.getByRole("button", { name: "+ Conta" })).toBeEnabled());

    await userEvent.click(screen.getByRole("button", { name: "+ Conta" }));
    await userEvent.type(screen.getByPlaceholderText(/nome da conta/i), "Cliente X");
    await userEvent.click(screen.getByRole("button", { name: "Criar e entrar" }));

    await waitFor(() => expect(createProfile).toHaveBeenCalledWith("claude", "Cliente X"));
    expect(connectAgentCli).toHaveBeenCalledWith("claude", "cliente-x");
  });

  it("falha na consulta vira alerta visível", async () => {
    listAgentClis.mockRejectedValue(new Error("engine offline"));
    render(<AgentConnections />);
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("engine offline"));
  });
});
