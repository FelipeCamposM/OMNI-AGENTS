import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { App } from "../App";
import { hexParaRgbCss } from "../lib/palettes";
import { NOVIDADES } from "../lib/changelog";

const mockInvoke = vi.mocked((await import("@tauri-apps/api/core")).invoke);
const mockOpen = vi.mocked((await import("@tauri-apps/plugin-dialog")).open);

/** Roteia o invoke por comando. docling_installed=true por padrão; resto "{}". */
function routeInvoke(overrides: Record<string, () => Promise<unknown>> = {}) {
  mockInvoke.mockImplementation((cmd: string) => {
    if (overrides[cmd]) return overrides[cmd]();
    if (cmd === "docling_installed") return Promise.resolve(true);
    return Promise.resolve("{}");
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  routeInvoke();
});

/** Landing é a Home; abre a ferramenta PDF → Markdown antes de testar o conversor. */
async function openPdfTool() {
  await userEvent.click(screen.getByRole("button", { name: /abrir pdf/i }));
}

/** Abre o tool, seleciona um PDF via diálogo e retorna quando a fila aparece. */
async function addPdf(path = "C:\\docs\\relatorio.pdf") {
  mockOpen.mockResolvedValueOnce(path);
  await openPdfTool();
  await userEvent.click(screen.getByRole("button", { name: /arrastar/i }));
  await waitFor(() => screen.getByRole("button", { name: /^Converter$/ }));
}

describe("Home / navegação", () => {
  it("mostra a Home com as ferramentas no carregamento", () => {
    render(<App />);
    expect(screen.getByRole("button", { name: /abrir pdf/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /abrir converter imagens/i })).toBeInTheDocument();
  });

  it("abre a ferramenta PDF → Markdown e mostra a zona de soltar", async () => {
    render(<App />);
    await openPdfTool();
    expect(screen.getByRole("button", { name: /arrastar/i })).toBeInTheDocument();
  });
});

describe("PDF → Markdown", () => {
  it("mostra o botão Converter após selecionar um arquivo", async () => {
    render(<App />);
    await addPdf();
    expect(screen.getByRole("button", { name: /^Converter$/ })).toBeInTheDocument();
  });

  it("mostra progresso enquanto converte", async () => {
    routeInvoke({ convert_pdf: () => new Promise(() => {}) }); // nunca resolve
    render(<App />);
    await addPdf();
    await userEvent.click(screen.getByRole("button", { name: /^Converter$/ }));
    await waitFor(() => {
      expect(screen.getByText(/preparando documento/i)).toBeInTheDocument();
    });
  });

  it("mostra o visualizador de Markdown após conversão bem-sucedida", async () => {
    routeInvoke({
      convert_pdf: () =>
        Promise.resolve(
          JSON.stringify({ success: true, outputPath: "", markdown: "# Relatório\n\nConteúdo.", durationMs: 1200 })
        ),
    });
    render(<App />);
    await addPdf();
    await userEvent.click(screen.getByRole("button", { name: /^Converter$/ }));
    await waitFor(() => {
      expect(screen.getByLabelText(/conteúdo markdown/i)).toBeInTheDocument();
    });
  });

  it("mostra erro quando a conversão falha", async () => {
    routeInvoke({
      convert_pdf: () =>
        Promise.resolve(
          JSON.stringify({ success: false, errorCode: "CONVERSION_FAILED", message: "Não foi possível converter o documento." })
        ),
    });
    render(<App />);
    await addPdf();
    await userEvent.click(screen.getByRole("button", { name: /^Converter$/ }));
    await waitFor(() => {
      expect(screen.getByText(/erro na conversão/i)).toBeInTheDocument();
    });
  });

  it("copia o conteúdo Markdown", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, writable: true });

    routeInvoke({
      convert_pdf: () =>
        Promise.resolve(JSON.stringify({ success: true, outputPath: "", markdown: "# Título", durationMs: 800 })),
    });
    render(<App />);
    await addPdf();
    await userEvent.click(screen.getByRole("button", { name: /^Converter$/ }));
    await waitFor(() => screen.getByLabelText(/conteúdo markdown/i));

    await userEvent.click(screen.getByRole("button", { name: /copiar conteúdo/i }));
    expect(writeText).toHaveBeenCalledWith("# Título");
  });
});

describe("Histórico", () => {
  const ENTRIES = [
    { id: "a", tool: "pdf-to-markdown", filename: "relatorio.pdf", inputPath: "C:\\a\\relatorio.pdf", durationMs: 10, timestamp: Date.now(), success: true, markdown: "# Relatório" },
    { id: "b", tool: "youtube", filename: "musica.mp3", inputPath: "https://yt/x", durationMs: 20, timestamp: Date.now(), success: true },
  ];

  function seed() {
    localStorage.setItem("pdf-to-markdown-history", JSON.stringify(ENTRIES));
  }

  async function openHistory() {
    await userEvent.click(screen.getByRole("button", { name: /^histórico$/i }));
  }

  it("só filtra quando o botão Buscar é clicado", async () => {
    seed();
    render(<App />);
    await openHistory();

    await userEvent.type(screen.getByLabelText(/pesquisar no histórico/i), "musica");
    // Sem clicar em Buscar, a lista segue completa.
    expect(screen.getByText("relatorio.pdf")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /^buscar$/i }));
    expect(screen.queryByText("relatorio.pdf")).not.toBeInTheDocument();
    expect(screen.getByText("musica.mp3")).toBeInTheDocument();
  });

  it("limpa o histórico após confirmar", async () => {
    seed();
    render(<App />);
    await openHistory();

    await userEvent.click(screen.getByRole("button", { name: /limpar tudo/i }));
    await userEvent.click(screen.getByRole("button", { name: /confirmar/i }));
    expect(screen.getByText(/nenhuma conversão ainda/i)).toBeInTheDocument();
  });
});

describe("Novidades da versão", () => {
  it("aparece no Início e some depois de visto", async () => {
    // O mock global devolve "0.1.0", versão sem entrada escrita — por isso os
    // outros testes não veem o cartão.
    const { getVersion } = await import("@tauri-apps/api/app");
    vi.mocked(getVersion).mockResolvedValue(NOVIDADES[0].versao);

    const { unmount } = render(<App />);

    const cartao = await screen.findByText(
      new RegExp(`novidades da versão ${NOVIDADES[0].versao}`, "i")
    );
    expect(cartao).toBeInTheDocument();
    // O texto é o do arquivo, não um resumo genérico.
    expect(screen.getByText(NOVIDADES[0].itens[0])).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /entendi/i }));
    expect(screen.queryByText(/novidades da versão/i)).not.toBeInTheDocument();

    // Persistiu: remontar o app não traz o cartão de volta.
    unmount();
    render(<App />);
    await waitFor(() => expect(screen.getByRole("button", { name: /^início$/i })).toBeInTheDocument());
    expect(screen.queryByText(/novidades da versão/i)).not.toBeInTheDocument();
  });

  it("o histórico completo fica em Configurações → Sobre", async () => {
    render(<App />);
    await userEvent.click(screen.getByRole("button", { name: /^configurações$/i }));
    await userEvent.click(screen.getByRole("button", { name: /^sobre$/i }));

    // Todas as versões escritas, não só a instalada.
    for (const n of NOVIDADES) {
      expect(screen.getByText(`Versão ${n.versao}`)).toBeInTheDocument();
    }
  });
});

describe("Configurações", () => {
  async function openSettings() {
    await userEvent.click(screen.getByRole("button", { name: /^configurações$/i }));
  }

  it("aplica o tema escolhido no documento", async () => {
    render(<App />);
    await openSettings();
    await userEvent.click(screen.getByRole("button", { name: /^aparência$/i }));
    await userEvent.click(screen.getByRole("button", { name: /^claro$/i }));
    expect(document.documentElement.dataset.theme).toBe("claro");
  });

  it("a cor de destaque escolhida vai para as CSS vars", async () => {
    // A paleta é escrita inline no <html> pelo useSettings. Se parar de ser,
    // o seletor continua marcando a cor e nada muda na tela.
    render(<App />);
    await openSettings();
    await userEvent.click(screen.getByRole("button", { name: /^aparência$/i }));

    await userEvent.click(screen.getByRole("radio", { name: /^âmbar$/i }));

    const estilo = document.documentElement.style;
    expect(estilo.getPropertyValue("--c-accent")).toBe(hexParaRgbCss("#FBBF24"));
    // Ícone e "opção ligada" andam juntos: é o pedido de "tudo daquela cor".
    expect(estilo.getPropertyValue("--c-selected")).toBe(hexParaRgbCss("#FBBF24"));
    expect(estilo.getPropertyValue("--c-selected-deep")).toBe(hexParaRgbCss("#D97706"));
  });

  it("no tema claro a paleta usa a variante de contraste", async () => {
    render(<App />);
    await openSettings();
    await userEvent.click(screen.getByRole("button", { name: /^aparência$/i }));

    await userEvent.click(screen.getByRole("radio", { name: /^ciano$/i }));
    await userEvent.click(screen.getByRole("button", { name: /^claro$/i }));

    // #22D3EE sobre fundo branco não passa contraste; a variante é #0E7490.
    expect(document.documentElement.style.getPropertyValue("--c-accent")).toBe(
      hexParaRgbCss("#0E7490")
    );
  });

  it("aplica fundo, vidro e animações no documento", async () => {
    render(<App />);
    await openSettings();
    await userEvent.click(screen.getByRole("button", { name: /^aparência$/i }));

    // Padrões
    expect(document.documentElement.dataset.bg).toBe("mesh-1");
    expect(document.documentElement.dataset.glass).toBe("medio");
    expect(document.documentElement.dataset.motion).toBe("completas");

    await userEvent.click(screen.getByRole("button", { name: /^nenhum$/i }));
    expect(document.documentElement.dataset.bg).toBe("nenhum");

    await userEvent.click(screen.getByRole("button", { name: /^desligadas$/i }));
    expect(document.documentElement.dataset.motion).toBe("desligadas");
  });

  it("efeito animado desliga as camadas CSS de fundo", async () => {
    render(<App />);
    await openSettings();
    await userEvent.click(screen.getByRole("button", { name: /^aparência$/i }));

    // "Ondas" vem do registry de efeitos, não da lista fixa de gradientes.
    await userEvent.click(screen.getByRole("button", { name: /^ondas$/i }));

    // data-bg genérico: quem desenha passa a ser o <AppBackground>, não o CSS.
    expect(document.documentElement.dataset.bg).toBe("efeito");
    // Desfoque não se aplica a canvas animado — o slider some.
    expect(screen.queryByLabelText(/desfoque/i)).not.toBeInTheDocument();
    expect(screen.getByLabelText(/opacidade/i)).toBeInTheDocument();
  });

  it("navega entre as seções", async () => {
    render(<App />);
    await openSettings();
    await userEvent.click(screen.getByRole("button", { name: /^utilitários$/i }));
    expect(screen.getByLabelText(/tamanho padrão do qr/i)).toBeInTheDocument();
  });

  it("usa a qualidade padrão de imagem na ferramenta de conversão", async () => {
    render(<App />);
    await openSettings();
    await userEvent.click(screen.getByRole("button", { name: /^imagens$/i }));
    fireEvent.change(screen.getByLabelText(/qualidade padrão/i), { target: { value: "60" } });

    await userEvent.click(screen.getByRole("button", { name: /^início$/i }));
    await userEvent.click(screen.getByRole("button", { name: /abrir converter imagens/i }));
    expect(screen.getByLabelText(/qualidade: 60/i)).toBeInTheDocument();
  });
});

describe("Base64 / Texto", () => {
  it("codifica texto em Base64", async () => {
    render(<App />);
    await userEvent.click(screen.getByRole("button", { name: /abrir base64/i }));
    await userEvent.type(screen.getByLabelText(/entrada/i), "abc");
    await userEvent.click(screen.getByRole("button", { name: /^codificar$/i }));
    await waitFor(() => {
      expect(screen.getByLabelText(/resultado base64/i)).toHaveValue("YWJj");
    });
  });
});
