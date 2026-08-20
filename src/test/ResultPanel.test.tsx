import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ResultPanel } from "../components/ui/ResultPanel";

const openFolder = vi.fn();
vi.mock("../services/conversionService", () => ({
  openFolder: (p: string) => openFolder(p),
}));

beforeEach(() => {
  openFolder.mockClear();
});

const PASTA = "C:\\Users\\ana\\Documentos";

describe("ResultPanel", () => {
  it("não renderiza nada sem caminhos", () => {
    const { container } = render(<ResultPanel paths={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("separa nome do arquivo da pasta e mostra a pasta comum uma vez só", () => {
    render(<ResultPanel paths={[`${PASTA}\\a.pdf`, `${PASTA}\\b.pdf`]} />);

    expect(screen.getByText("2 arquivos gerados")).toBeInTheDocument();
    // Pasta compartilhada sobe pro cabeçalho em vez de repetir em cada linha.
    expect(screen.getAllByText(PASTA)).toHaveLength(1);
    expect(screen.getByText("a.pdf")).toBeInTheDocument();
    expect(screen.getByText("b.pdf")).toBeInTheDocument();
  });

  it("mostra a pasta por linha quando os destinos diferem", () => {
    render(<ResultPanel paths={["C:\\um\\a.pdf", "C:\\dois\\b.pdf"]} />);
    expect(screen.getByText("C:\\um")).toBeInTheDocument();
    expect(screen.getByText("C:\\dois")).toBeInTheDocument();
  });

  it("singular com um arquivo só", () => {
    render(<ResultPanel paths={[`${PASTA}\\solo.pdf`]} />);
    expect(screen.getByText("1 arquivo gerado")).toBeInTheDocument();
  });

  it("abre a pasta do arquivo daquela linha, não sempre a do primeiro", async () => {
    render(<ResultPanel paths={["C:\\um\\a.pdf", "C:\\dois\\b.pdf"]} />);

    await userEvent.click(screen.getByLabelText("Abrir pasta de b.pdf"));

    expect(openFolder).toHaveBeenCalledWith("C:\\dois\\b.pdf");
  });

  it("copia o caminho completo da linha", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, writable: true });

    render(<ResultPanel paths={[`${PASTA}\\a.pdf`]} />);
    await userEvent.click(screen.getByLabelText("Copiar caminho de a.pdf"));

    expect(writeText).toHaveBeenCalledWith(`${PASTA}\\a.pdf`);
  });

  it("label customizado substitui o título e hidePaths esconde a lista", () => {
    render(
      <ResultPanel paths={[`${PASTA}\\a.pdf`]} label="1,2 MB → 400 KB" hidePaths>
        <p>detalhes proprios</p>
      </ResultPanel>
    );

    expect(screen.getByText("1,2 MB → 400 KB")).toBeInTheDocument();
    expect(screen.getByText("detalhes proprios")).toBeInTheDocument();
    expect(screen.queryByText("a.pdf")).not.toBeInTheDocument();
  });

  it("cabeçalho mantém o atalho para a pasta do primeiro arquivo", async () => {
    render(<ResultPanel paths={["C:\\um\\a.pdf", "C:\\dois\\b.pdf"]} />);

    const cabecalho = screen.getByText("2 arquivos gerados").closest("div")!.parentElement!;
    await userEvent.click(within(cabecalho).getByRole("button", { name: /^abrir pasta$/i }));

    expect(openFolder).toHaveBeenCalledWith("C:\\um\\a.pdf");
  });
});
