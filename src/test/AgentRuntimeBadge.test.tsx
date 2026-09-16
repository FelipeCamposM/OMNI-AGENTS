import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
import {
  AgentRuntimeBadge,
  nomeCurtoDoModelo,
  rotuloDoEsforco,
} from "../features/terminal/AgentRuntimeBadge";

const mockInvoke = vi.mocked(invoke);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("nomeCurtoDoModelo", () => {
  it.each([
    ["claude-opus-5", "Opus 5"],
    ["claude-sonnet-4-5-20250929", "Sonnet 4.5"],
    ["claude-haiku-4-5", "Haiku 4.5"],
    ["gpt-6-astra", "GPT 6 Astra"],
    ["claude-opus-4-1-20250805", "Opus 4.1"],
  ])("%s vira %s", (id, esperado) => {
    expect(nomeCurtoDoModelo(id)).toBe(esperado);
  });

  it("id que não segue padrão nenhum é devolvido sem virar string vazia", () => {
    expect(nomeCurtoDoModelo("modelo-interno-xyz")).toBe("Modelo Interno Xyz");
    expect(nomeCurtoDoModelo("claude")).toBe("claude");
  });
});

describe("rotuloDoEsforco", () => {
  it("traduz os níveis conhecidos e repassa o desconhecido", () => {
    expect(rotuloDoEsforco("high")).toBe("esforço alto");
    expect(rotuloDoEsforco("MEDIUM")).toBe("esforço médio");
    expect(rotuloDoEsforco("turbo")).toBe("esforço turbo");
  });
});

describe("AgentRuntimeBadge", () => {
  const props = { provider: "claude", cwd: "D:/dev/projeto", externalSessionId: "s1" };

  it("mostra modelo e esforço, com o id cru no tooltip", async () => {
    mockInvoke.mockResolvedValue({ model: "claude-opus-5", effort: "high", cli_version: "2.1.273" });
    render(<AgentRuntimeBadge {...props} />);

    const etiqueta = await screen.findByLabelText(/modelo em uso: opus 5, esforço alto/i);
    expect(etiqueta).toHaveTextContent("Opus 5");
    expect(etiqueta).toHaveTextContent("esforço alto");
    expect(etiqueta).toHaveAttribute("title", "claude-opus-5 · CLI 2.1.273");
  });

  it("não ocupa espaço quando não há o que dizer", async () => {
    mockInvoke.mockResolvedValue(null);
    const { container } = render(<AgentRuntimeBadge {...props} />);
    await waitFor(() => expect(mockInvoke).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });

  it("falha de leitura não vira erro na tela", async () => {
    mockInvoke.mockRejectedValue(new Error("perfil sumiu"));
    const { container } = render(<AgentRuntimeBadge {...props} />);
    await waitFor(() => expect(mockInvoke).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });

  it("marca com ? e explica no tooltip quando é só o configurado", async () => {
    mockInvoke.mockResolvedValue({
      model: "opus",
      effort: null,
      cli_version: null,
      source: "config",
    });
    render(<AgentRuntimeBadge {...props} />);

    const etiqueta = await screen.findByLabelText(/modelo configurado: opus/i);
    expect(etiqueta).toHaveTextContent("Opus");
    expect(etiqueta).toHaveAttribute("title", expect.stringContaining("ainda não respondeu"));
  });

  it("o tooltip precisa ser alcançável pelo ponteiro", async () => {
    mockInvoke.mockResolvedValue({ model: "claude-opus-5", effort: "high", cli_version: null });
    render(<AgentRuntimeBadge {...props} />);

    const etiqueta = await screen.findByLabelText(/modelo em uso/i);
    expect(etiqueta.className).not.toContain("pointer-events-none");
  });

  it("nunca mostra marcador interno da CLI como se fosse modelo", async () => {
    mockInvoke.mockResolvedValue({ model: "<synthetic>", effort: null, cli_version: null });
    const { container } = render(<AgentRuntimeBadge {...props} />);
    await waitFor(() => expect(mockInvoke).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });

  it("mostra só o modelo quando a CLI não registra esforço", async () => {
    mockInvoke.mockResolvedValue({ model: "gpt-6-astra", effort: null, cli_version: null });
    render(<AgentRuntimeBadge {...props} provider="codex" />);

    const etiqueta = await screen.findByLabelText(/modelo em uso: gpt 6 astra$/i);
    expect(etiqueta).toHaveTextContent("GPT 6 Astra");
    expect(etiqueta).not.toHaveTextContent("esforço");
  });
});
