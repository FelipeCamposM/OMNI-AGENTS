import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import { ServidoresPanel } from "../components/ServidoresPanel";
import type { ServidorLocal } from "../features/servidores/servidoresService";

vi.mock("../features/servidores/servidoresService", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../features/servidores/servidoresService")>()),
  servidoresLocais: vi.fn(),
  matarServidor: vi.fn(),
}));

const { servidoresLocais, matarServidor } = vi.mocked(await import("../features/servidores/servidoresService"));

const servidor = (nome: string, portas: number[], proprio = false): ServidorLocal =>
  ({ pasta: `D:\\P\\${nome}`, nome, tipo: "Vite", portas, pids: [1], comando: "node vite.js", proprio });

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  servidoresLocais.mockResolvedValue([servidor("OMNI", [1420], true), servidor("SIAPLUS", [1520])]);
  matarServidor.mockResolvedValue(undefined);
});

it("apelido fica guardado pela pasta e parar pede confirmação num modal", async () => {
  render(<ServidoresPanel />);
  await userEvent.click(await screen.findByRole("button", { name: "Dar apelido a SIAPLUS" }));
  const campo = screen.getByRole("textbox", { name: "Apelido de SIAPLUS" });
  await userEvent.clear(campo);
  await userEvent.type(campo, "Sia{Enter}");
  expect(screen.getByText("Sia")).toBeInTheDocument();
  expect(JSON.parse(localStorage.getItem("omni-servidores-apelidos")!)).toEqual({ "D:\\P\\SIAPLUS": "Sia" });

  // A porta aparece em destaque e é ela que abre no navegador.
  expect(screen.getByRole("button", { name: "Abrir localhost:1520 no navegador" })).toHaveTextContent("1520");

  await userEvent.click(screen.getByRole("button", { name: "Parar Sia" }));
  expect(matarServidor).not.toHaveBeenCalled();
  expect(screen.getByRole("dialog", { name: "Parar servidor" })).toHaveTextContent("localhost:1520");
  await userEvent.click(screen.getByRole("button", { name: "Parar servidor" }));
  await waitFor(() => expect(matarServidor).toHaveBeenCalledWith("D:\\P\\SIAPLUS"));
  expect(await screen.findByText("Servidor parado")).toBeInTheDocument();
});

it("o próprio OMNI em dev não tem botão de parar", async () => {
  render(<ServidoresPanel />);
  expect(await screen.findByText("OMNI")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Parar OMNI" })).toBeNull();
});
