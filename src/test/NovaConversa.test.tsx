import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { NovaConversa } from "../web/NovaConversa";
import type { Projects } from "../mobile/api";

const catalog: Projects = {
  published_at_ms: 1,
  projects: [{ id: "p", name: "Projeto", path: "C:/p" }],
  agents: [{ id: "codex", label: "Codex", command: "codex", resume: null }],
  profiles: [{ id: "a", provider: "codex", name: "Conta A" }, { id: "b", provider: "codex", name: "Conta B" }],
  theme: null,
};

describe("NovaConversa", () => {
  it("atualização da tela atrás não rouba o foco do Nome nem zera a conta", () => {
    const props = { catalog, projetoInicial: "p", onAberta: () => {} };
    const { rerender } = render(<NovaConversa {...props} onFechar={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "Conta B" }));
    const nome = screen.getByLabelText(/Nome/);
    nome.focus();

    rerender(<NovaConversa {...props} onFechar={() => {}} />);

    expect(document.activeElement).toBe(nome);
    expect(screen.getByRole("button", { name: "Conta B" })).toHaveAttribute("aria-pressed", "true");
  });
});
