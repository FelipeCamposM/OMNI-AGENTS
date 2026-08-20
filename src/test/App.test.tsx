import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { App } from "../App";

vi.mock("@tauri-apps/plugin-updater", () => ({ check: vi.fn().mockResolvedValue(null) }));

const mockOpen = vi.mocked((await import("@tauri-apps/plugin-dialog")).open);

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
});

describe("App shell", () => {
  it("mostra o workspace vazio no carregamento", () => {
    render(<App />);
    expect(screen.getByText(/nenhuma pane aberta/i)).toBeInTheDocument();
    expect(screen.getByText(/nenhum projeto ainda/i)).toBeInTheDocument();
  });

  it("adiciona um projeto pelo seletor de diretório", async () => {
    mockOpen.mockResolvedValueOnce("C:\\dev\\meu-projeto");
    render(<App />);

    await userEvent.click(screen.getByRole("button", { name: /adicionar projeto/i }));

    expect(screen.getByText("meu-projeto")).toBeInTheDocument();
    expect(screen.queryByText(/nenhum projeto ainda/i)).not.toBeInTheDocument();
  });

  it("navega para Configurações e volta pro workspace", async () => {
    render(<App />);

    await userEvent.click(screen.getByRole("button", { name: /^configurações$/i }));
    expect(screen.getByRole("heading", { name: /configurações/i })).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /omni agents/i }));
    expect(screen.getByText(/nenhuma pane aberta/i)).toBeInTheDocument();
  });
});
