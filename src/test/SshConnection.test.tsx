import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { ProjectPicker } from "../features/projects/ProjectPicker";
import { SshConnectionForm } from "../features/projects/SshConnectionForm";
import { NOVA_CONEXAO, type SshConnection } from "../features/projects/sshService";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("../features/terminal/terminalService", async (original) => ({
  ...(await original<typeof import("../features/terminal/terminalService")>()),
  wslDistros: vi.fn().mockResolvedValue([]),
}));

const conexao: SshConnection = {
  id: "srv1",
  name: "Servidor",
  host: "10.0.0.5",
  port: 22,
  user: "ana",
  key_path: "",
  remote_path: "/srv/app",
  drive: "X:",
};

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  vi.mocked(invoke).mockImplementation(async (comando: string) => {
    switch (comando) {
      case "ssh_connections":
        return [conexao];
      case "ssh_mount":
        return "X:";
      case "save_ssh_connection":
        return { ...conexao, id: "srv-novo" };
      case "test_ssh_connection":
        return "Linux servidor 6.8.0";
      default:
        return null;
    }
  });
});

describe("ProjectPicker — máquinas por SSH", () => {
  it("monta antes de abrir: sem a unidade montada o projeto entraria vazio", async () => {
    const onPick = vi.fn();
    render(<ProjectPicker onPick={onPick} onClose={() => {}} />);

    await userEvent.click(await screen.findByText("Servidor"));
    await waitFor(() => expect(vi.mocked(invoke)).toHaveBeenCalledWith("ssh_mount", { id: "srv1" }));
    expect(onPick).toHaveBeenCalledWith("X:\\");
  });

  it("falha de montagem aparece na tela em vez de abrir um projeto quebrado", async () => {
    vi.mocked(invoke).mockImplementation(async (comando: string) => {
      if (comando === "ssh_connections") return [conexao];
      if (comando === "ssh_mount") throw new Error("SSHFS-Win não está instalado.");
      return null;
    });
    const onPick = vi.fn();
    render(<ProjectPicker onPick={onPick} onClose={() => {}} />);

    await userEvent.click(await screen.findByText("Servidor"));
    expect(await screen.findByRole("alert")).toHaveTextContent(/SSHFS-Win/);
    expect(onPick).not.toHaveBeenCalled();
  });
});

describe("SshConnectionForm", () => {
  it("testa a conexão e mostra o que a máquina respondeu", async () => {
    render(<SshConnectionForm connection={{ ...NOVA_CONEXAO, ...conexao }} onSaved={() => {}} onCancel={() => {}} />);

    await userEvent.click(screen.getByRole("button", { name: "Testar conexão" }));
    expect(await screen.findByText(/Linux servidor/)).toBeInTheDocument();
    expect(vi.mocked(invoke)).toHaveBeenCalledWith("test_ssh_connection", { connection: expect.objectContaining({ host: "10.0.0.5" }) });
  });

  it("não tem campo de senha — credencial nunca é guardada pelo app", () => {
    const { container } = render(<SshConnectionForm connection={null} onSaved={() => {}} onCancel={() => {}} />);
    expect(container.querySelector('input[type="password"]')).toBeNull();
    expect(screen.queryByText(/senha/i)).toBeNull();
  });

  it("salvar devolve a conexão gravada pelo backend", async () => {
    const onSaved = vi.fn();
    render(<SshConnectionForm connection={{ ...conexao, id: "" }} onSaved={onSaved} onCancel={() => {}} />);

    await userEvent.click(screen.getByRole("button", { name: "Salvar" }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(expect.objectContaining({ id: "srv-novo" })));
  });
});
