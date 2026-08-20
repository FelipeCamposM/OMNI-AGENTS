import { describe, it, expect } from "vitest";
import { filtroPreview } from "../tools/depth-map/DepthMapTool";

/**
 * A prévia é um `<img>` com `filter` do CSS; o arquivo salvo é gerado pelo
 * Pillow em `converter.py::_lut_ajuste`. Os dois têm que aplicar a MESMA cadeia,
 * senão o usuário salva algo diferente do que viu — e nada quebra visivelmente
 * até alguém abrir os dois lado a lado.
 *
 * O lado Python está coberto por `TestDepthAjuste` em test_converter.py.
 */
describe("filtroPreview", () => {
  it("valores neutros não emitem filtro nenhum", () => {
    // String vazia vira `undefined` no style: sem camada de composição extra
    // no WebView quando não há ajuste.
    expect(filtroPreview(false, 100)).toBe("");
  });

  it("inverter sozinho", () => {
    expect(filtroPreview(true, 100)).toBe("invert(1)");
  });

  it("contraste vira fração, não porcentagem", () => {
    expect(filtroPreview(false, 180)).toBe("contrast(1.8)");
  });

  it("combina os dois na mesma ordem do Python", () => {
    // Aqui as duas operações comutam de verdade — (0,5−v)k + 0,5 sai igual dos
    // dois lados, e nenhuma das duas satura antes da outra. A ordem é fixada
    // por disciplina, não por necessidade: é o que mantém o `_lut_ajuste`
    // comparável linha a linha com este arquivo.
    expect(filtroPreview(true, 60)).toBe("invert(1) contrast(0.6)");
  });
});
