import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { CartaoDePergunta } from "../mobile/CartaoDePergunta";
import type { Escolha } from "../mobile/api";

const escolha = {
  pergunta: "Quais?", detalhe: null, multipla: true,
  opcoes: [{ numero: 1, rotulo: "A" }, { numero: 2, rotulo: "B" }],
} as unknown as Escolha;

describe("CartaoDePergunta", () => {
  it("marca na hora e enfileira toques feitos enquanto o anterior está a caminho", () => {
    const onEscolher = vi.fn();
    const { rerender } = render(<CartaoDePergunta escolha={escolha} busy={false} onEscolher={onEscolher} onAvancar={() => {}} />);
    fireEvent.click(screen.getByRole("checkbox", { name: /A/ }));
    expect(screen.getByRole("checkbox", { name: /A/ })).toHaveAttribute("aria-checked", "true");
    expect(onEscolher).toHaveBeenCalledWith(1);

    rerender(<CartaoDePergunta escolha={escolha} busy onEscolher={onEscolher} onAvancar={() => {}} />);
    fireEvent.click(screen.getByRole("checkbox", { name: /B/ }));
    expect(screen.getByRole("checkbox", { name: /B/ })).toHaveAttribute("aria-checked", "true");
    expect(onEscolher).toHaveBeenCalledTimes(1);

    rerender(<CartaoDePergunta escolha={escolha} busy={false} onEscolher={onEscolher} onAvancar={() => {}} />);
    expect(onEscolher).toHaveBeenLastCalledWith(2);
  });

  it("várias perguntas: Voltar aparece depois de alguma respondida", () => {
    const onVoltar = vi.fn();
    const etapas = (respondida: boolean) => ({ ...escolha, etapas: [{ titulo: "Cor", respondida }, { titulo: "Fruta", respondida: false }] }) as unknown as Escolha;
    const { rerender } = render(<CartaoDePergunta escolha={etapas(false)} busy={false} onEscolher={() => {}} onAvancar={() => {}} onVoltar={onVoltar} />);
    expect(screen.queryByRole("button", { name: "← Voltar" })).toBeNull();
    rerender(<CartaoDePergunta escolha={etapas(true)} busy={false} onEscolher={() => {}} onAvancar={() => {}} onVoltar={onVoltar} />);
    fireEvent.click(screen.getByRole("button", { name: "← Voltar" }));
    expect(onVoltar).toHaveBeenCalled();
  });
});
