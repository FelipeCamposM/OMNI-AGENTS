import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ProjectPicker } from "../features/projects/ProjectPicker";
import { listRecentProjects, rememberProject, wslDistroOf } from "../services/recentProjectsService";

vi.mock("../features/terminal/terminalService", async (original) => ({
  ...(await original<typeof import("../features/terminal/terminalService")>()),
  wslDistros: vi.fn().mockResolvedValue(["Ubuntu"]),
}));

const mockOpen = vi.mocked((await import("@tauri-apps/plugin-dialog")).open);

const WSL_API = String.raw`\\wsl.localhost\Ubuntu\home\ana\api`;
const WSL_NOVO = String.raw`\\wsl.localhost\Ubuntu\home\ana\novo`;

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
});

describe("recentProjectsService", () => {
  it("põe o último aberto no topo, sem duplicar caminho", () => {
    rememberProject(String.raw`C:\dev\a`);
    rememberProject(String.raw`C:\dev\b`);
    rememberProject(String.raw`c:\dev\a`);
    expect(listRecentProjects().map((item) => item.name)).toEqual(["a", "b"]);
  });

  it("reconhece caminho do WSL", () => {
    expect(wslDistroOf(WSL_API)).toBe("Ubuntu");
    expect(wslDistroOf("//wsl$/Debian/srv/app")).toBe("Debian");
    expect(wslDistroOf(String.raw`D:\dev\proj`)).toBeNull();
  });
});

describe("ProjectPicker", () => {
  it("lista os recentes e marca os do WSL", async () => {
    rememberProject(WSL_API);
    const onPick = vi.fn();
    render(<ProjectPicker onPick={onPick} onClose={() => {}} />);

    expect(await screen.findByText("WSL · Ubuntu")).toBeInTheDocument();
    await userEvent.click(screen.getByText("api"));
    expect(onPick).toHaveBeenCalledWith(WSL_API);
    // O caminho conhecido abre direto: o explorador do Windows é só para projeto novo.
    expect(mockOpen).not.toHaveBeenCalled();
  });

  it("sai da barra lateral por portal — dentro dela o z-index não vale", async () => {
    // A `<aside>` é `sticky`, o que cria contexto de empilhamento: o diálogo renderizado lá dentro
    // ficava atrás dos terminais por mais alto que fosse o z-index.
    const { container } = render(<ProjectPicker onPick={() => {}} onClose={() => {}} />);
    const dialogo = await screen.findByRole("dialog", { name: "Abrir projeto" });
    expect(container).toBeEmptyDOMElement();
    expect(document.body.contains(dialogo)).toBe(true);
  });

  it("o botão do WSL abre o explorador já dentro da distro", async () => {
    mockOpen.mockResolvedValueOnce(WSL_NOVO);
    const onPick = vi.fn();
    render(<ProjectPicker onPick={onPick} onClose={() => {}} />);

    await userEvent.click(await screen.findByRole("button", { name: /procurar no wsl · ubuntu/i }));
    expect(mockOpen).toHaveBeenCalledWith(
      expect.objectContaining({ directory: true, defaultPath: String.raw`\\wsl.localhost\Ubuntu\home` })
    );
    await waitFor(() => expect(onPick).toHaveBeenCalledWith(WSL_NOVO));
  });
});
