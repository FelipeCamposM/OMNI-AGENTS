import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MessageBubble } from "../mobile/Chat";
import { pareceArquivo, semLocal, usarAbrirArquivo } from "../mobile/api";

const TEXTO = "Mudei `src/App.tsx:42` e o [roadmap](roadmaps/omni-agents/roadmap.md#L10). Rode `npm test`; veja `console.log`.\n\n```\ncat src/App.tsx\n```";

describe("arquivo citado na conversa", () => {
  afterEach(() => usarAbrirArquivo(null));

  it("reconhece caminho e ignora o que não é arquivo", () => {
    for (const sim of ["src/App.tsx:42", "Cargo.toml", "D:\\proj\\a.rs", "./scripts/build.mjs", "roadmap.md#L10-L20", "crates/x/Makefile.am"]) {
      expect(pareceArquivo(sim), sim).toBe(true);
    }
    for (const nao of ["console.log", "npm test", "i.e", "https://x.dev/a.ts", "v1.2.3", "a b.ts"]) {
      expect(pareceArquivo(nao), nao).toBe(false);
    }
    expect(semLocal("src/App.tsx:42:7")).toBe("src/App.tsx");
  });

  it("no app do PC, código e link de arquivo abrem; comando e trecho de código não", async () => {
    const abrir = vi.fn();
    usarAbrirArquivo(abrir);
    render(<MessageBubble lado="agent" provider="claude" texto={TEXTO} />);
    await userEvent.click(screen.getByRole("button", { name: "src/App.tsx:42" }));
    expect(abrir).toHaveBeenCalledWith("src/App.tsx:42");
    await userEvent.click(screen.getByRole("button", { name: "roadmap" }));
    expect(abrir).toHaveBeenLastCalledWith("roadmaps/omni-agents/roadmap.md#L10");
    expect(screen.queryByRole("button", { name: "npm test" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "console.log" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /cat src/ })).not.toBeInTheDocument();
  });

  it("na web e no celular (sem abridor) o caminho continua texto", () => {
    render(<MessageBubble lado="agent" provider="claude" texto={TEXTO} />);
    expect(screen.queryByRole("button", { name: "src/App.tsx:42" })).not.toBeInTheDocument();
    expect(screen.getByText("src/App.tsx:42")).toBeInTheDocument();
  });
});
