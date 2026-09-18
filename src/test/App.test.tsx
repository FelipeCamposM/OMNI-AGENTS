import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { App } from "../App";

vi.mock("@tauri-apps/plugin-updater", () => ({ check: vi.fn().mockResolvedValue(null) }));
vi.mock("../features/docker/dockerService", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../features/docker/dockerService")>()),
  dockerContainers: vi.fn().mockResolvedValue([]),
}));

const mockOpen = vi.mocked((await import("@tauri-apps/plugin-dialog")).open);

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
});

/** "Adicionar projeto" abre a lista de recentes; o explorador do Windows é o segundo passo. */
async function adicionarProjeto() {
  await userEvent.click(screen.getByRole("button", { name: /adicionar projeto/i }));
  await userEvent.click(await screen.findByRole("button", { name: /procurar no computador/i }));
}

describe("App shell", () => {
  it("mostra o workspace vazio no carregamento", () => {
    render(<App />);
    expect(screen.getByText(/nenhum painel aberto/i)).toBeInTheDocument();
    expect(screen.getByText(/nenhum projeto ainda/i)).toBeInTheDocument();
  });

  it("adiciona um projeto pelo seletor de diretório", async () => {
    mockOpen.mockResolvedValueOnce("C:\\dev\\meu-projeto");
    render(<App />);

    await adicionarProjeto();

    expect(screen.getAllByText("meu-projeto").length).toBeGreaterThan(0);
    expect(screen.queryByText(/nenhum projeto ainda/i)).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /escolha a cli para meu-projeto/i })).toBeInTheDocument();
  });

  it("divide e restaura o layout persistido", async () => {
    mockOpen.mockResolvedValueOnce("C:\\dev\\persistente");
    const first = render(<App />);
    await adicionarProjeto();
    await userEvent.click(screen.getByRole("button", { name: /dividir lado a lado/i }));

    expect(screen.getByText("2 painéis")).toBeInTheDocument();
    first.unmount();
    render(<App />);

    expect(screen.getByText("2 painéis")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /fechar painel/i })).toHaveLength(2);
  });

  it("cria e fecha tabs pela barra do painel", async () => {
    mockOpen.mockResolvedValueOnce("C:\\dev\\tabs");
    render(<App />);
    await adicionarProjeto();

    await userEvent.click(screen.getByRole("button", { name: /nova tab/i }));
    await userEvent.click(screen.getByRole("menuitem", { name: /novo terminal/i }));
    expect(screen.getAllByRole("tab")).toHaveLength(2);
    expect(screen.getByRole("tab", { name: /novo terminal/i })).toHaveAttribute("aria-selected", "true");

    await userEvent.click(screen.getByRole("button", { name: /fechar tab novo terminal/i }));
    expect(screen.getAllByRole("tab")).toHaveLength(1);
  });

  it("cria um segundo workspace e mantém ambos isolados após remontar", async () => {
    mockOpen.mockResolvedValueOnce("C:\\dev\\workspace-um");
    const first = render(<App />);

    await adicionarProjeto();
    expect(screen.getAllByText("workspace-um").length).toBeGreaterThan(0);

    await userEvent.click(screen.getByRole("button", { name: /criar workspace/i }));

    expect(screen.getByText(/nenhum projeto ainda/i)).toBeInTheDocument();
    mockOpen.mockResolvedValueOnce("C:\\dev\\workspace-dois");
    await adicionarProjeto();
    expect(screen.getAllByText("workspace-dois").length).toBeGreaterThan(0);

    first.unmount();
    render(<App />);

    expect(screen.getByRole("button", { name: "Workspace 2" })).toBeInTheDocument();
    expect(screen.getAllByText("workspace-dois").length).toBeGreaterThan(0);

    await userEvent.click(screen.getByRole("button", { name: "Workspace 1" }));

    expect(screen.getAllByText("workspace-um").length).toBeGreaterThan(0);
  });

  it("navega para Configurações e volta pro workspace", async () => {
    render(<App />);

    await userEvent.click(screen.getByRole("button", { name: /^configurações$/i }));
    expect(screen.getByRole("heading", { name: /configurações/i })).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /^agentes$/i }));
    expect(screen.getByRole("heading", { name: /conexões de agentes/i })).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /omni agents/i }));
    expect(screen.getByText(/nenhum painel aberto/i)).toBeInTheDocument();
  });
});
