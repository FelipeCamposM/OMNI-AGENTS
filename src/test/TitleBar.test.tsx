import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TitleBar } from "../components/TitleBar";

const janela = { minimize: vi.fn(async () => undefined), startDragging: vi.fn(async () => undefined), toggleMaximize: vi.fn(async () => undefined), close: vi.fn(async () => undefined),
  isMaximized: vi.fn(async () => false), onResized: vi.fn(async () => () => undefined) };
vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: () => janela }));

it("barra superior mostra onde você está e controla a janela", async () => {
  const onHome = vi.fn();
  render(<TitleBar trilha={["Workspace 1", "omni-agents"]} dica="D:/omni-agents" onHome={onHome} onOpenSettings={() => undefined} />);
  expect(screen.getByText("omni-agents")).toHaveAttribute("title", "D:/omni-agents");

  await userEvent.click(screen.getByRole("button", { name: "Minimizar" }));
  await userEvent.click(screen.getByRole("button", { name: "Maximizar" }));
  await userEvent.click(screen.getByRole("button", { name: "Fechar" }));
  await vi.waitFor(() => expect(janela.close).toHaveBeenCalled());
  expect(janela.minimize).toHaveBeenCalled();
  expect(janela.toggleMaximize).toHaveBeenCalled();

  await userEvent.click(screen.getByRole("button", { name: /OMNI AGENTS/ }));
  expect(onHome).toHaveBeenCalled();
});

it("clique na barra não arrasta; só arrasta andando com o botão apertado", async () => {
  // Arrastar já no clique, com a janela fora de foco, fazia a janela grudar no ponteiro.
  render(<TitleBar trilha={[]} onHome={() => undefined} onOpenSettings={() => undefined} />);
  // O primeiro import dinâmico, vindo de um listener nativo, escapava do vi.mock: aquece antes.
  await import("@tauri-apps/api/window");
  const barra = document.querySelector("header")!;
  fireEvent.mouseDown(barra, { button: 0, clientX: 10, clientY: 10 });
  fireEvent.mouseUp(window);
  fireEvent.mouseMove(window, { buttons: 0, clientX: 50, clientY: 10 });
  expect(janela.startDragging).not.toHaveBeenCalled();

  fireEvent.mouseDown(barra, { button: 0, clientX: 10, clientY: 10 });
  fireEvent.mouseMove(window, { buttons: 1, clientX: 30, clientY: 10 });
  await vi.waitFor(() => expect(janela.startDragging).toHaveBeenCalledTimes(1));
});
