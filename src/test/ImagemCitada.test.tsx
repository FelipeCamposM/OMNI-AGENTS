import { expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const request = vi.fn();
vi.mock("../mobile/api", async (original) => ({ ...(await original<typeof import("../mobile/api")>()), request: (...a: unknown[]) => request(...a) }));
const { MessageBubble } = await import("../mobile/Chat");
const { pareceArquivo } = await import("../mobile/api");

it("mostra o nome do arquivo na barra e o caminho no texto abre a imagem", async () => {
  request.mockResolvedValue({ tipo: "image/png", dados: "cG5n", caminho: "C:\\Users\\Fulano de Tal\\Temp\\print.png" });
  render(<MessageBubble lado="agent" provider="claude" texto={"Salvei em `C:\\Users\\Fulano de Tal\\Temp\\print.png`.\n\n![prévia](C:\\Users\\Fulano de Tal\\Temp\\print.png)"}
    imagens={{ conversa: "c", n: 3, total: 1 }} />);

  expect(await screen.findByText("print.png")).toBeInTheDocument();
  // O `![…](C:\…)` não vira ícone quebrado no texto: a imagem é a do cartão.
  expect(screen.getAllByRole("img")).toHaveLength(1);

  await userEvent.click(screen.getByRole("button", { name: /C:\\Users\\Fulano de Tal\\Temp\\print\.png/ }));
  expect(screen.getByRole("dialog", { name: "print.png" })).toBeInTheDocument();
});

it("caminho absoluto com espaço parece arquivo; frase com espaço não", () => {
  expect(pareceArquivo("C:\\Users\\Fulano de Tal\\notas.md")).toBe(true);
  expect(pareceArquivo("/home/fulano/meu print.png")).toBe(true);
  expect(pareceArquivo("rode npm test.js")).toBe(false);
});
