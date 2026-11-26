import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { DocumentoPaginado, repartir } from "../features/files/DocumentoPaginado";

describe("DocumentoPaginado", () => {
  it("reparte blocos por altura; bloco maior que a folha fica sozinho", () => {
    const b = (topo: number, altura: number) => ({ topo, altura });
    expect(repartir([b(0, 400), b(400, 400), b(800, 400), b(1200, 100)], 979)).toEqual([[0, 1], [2, 3]]);
    expect(repartir([b(0, 2000), b(2000, 10)], 979)).toEqual([[0], [1]]);
    expect(repartir([], 979)).toEqual([[]]);
  });

  it("mostra as folhas numeradas", () => {
    render(<DocumentoPaginado conteudo={"# Título\n\nTexto"} />);
    expect(screen.getByRole("region", { name: "Página 1 de 1" })).toHaveTextContent("Título");
  });
});
