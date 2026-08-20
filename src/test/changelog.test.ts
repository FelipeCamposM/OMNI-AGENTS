import { describe, it, expect } from "vitest";
import { NOVIDADES, deveAvisar, novidadesDaVersao } from "../lib/changelog";

describe("quando o aviso de novidades aparece", () => {
  const comEntrada = NOVIDADES[0].versao;

  it("aparece uma vez para a versão instalada", () => {
    expect(deveAvisar(comEntrada, "")).toBe(true);
    expect(deveAvisar(comEntrada, comEntrada)).toBe(false);
  });

  it("versão sem entrada escrita não avisa nada", () => {
    // Silêncio é melhor que um cartão vazio: esquecer de escrever a novidade
    // não pode virar defeito visível.
    expect(deveAvisar("99.99.99", "")).toBe(false);
    expect(novidadesDaVersao("99.99.99")).toBeUndefined();
  });

  it("sem saber a versão, não avisa", () => {
    // Fora do Tauri o `getVersion` falha e vira null.
    expect(deveAvisar(null, "")).toBe(false);
    expect(deveAvisar(undefined, "")).toBe(false);
  });
});

describe("conteúdo das novidades", () => {
  it("está em ordem, da mais recente para a mais antiga", () => {
    // A lista é renderizada na ordem do arquivo; inverter deixaria a novidade
    // velha em cima sem nenhum erro aparecer.
    const peso = (v: string) =>
      v.split(".").reduce((t, p) => t * 1000 + Number(p), 0);
    for (let i = 1; i < NOVIDADES.length; i++) {
      expect(peso(NOVIDADES[i - 1].versao)).toBeGreaterThan(peso(NOVIDADES[i].versao));
    }
  });

  it("não repete versão", () => {
    const vs = NOVIDADES.map((n) => n.versao);
    expect(new Set(vs).size).toBe(vs.length);
  });

  it("nenhum item usa jargão técnico", () => {
    // É a regra do arquivo, e a que se perde primeiro quando alguém escreve a
    // entrada com o commit aberto do lado. Formato de arquivo (PNG, SVG) fica
    // de fora da lista porque é vocabulário de quem usa, não de quem programa.
    const proibidas = [
      "vtracer", "real-esrgan", "rembg", "onnx", "webgl", "css", "z-index",
      "pyinstaller", "sha256", "backdrop-filter", "api", "sidecar", "commit",
      "refator", "bug", "deploy", "build", "cache", "runtime",
    ];
    for (const n of NOVIDADES) {
      for (const item of n.itens) {
        const texto = item.toLowerCase();
        for (const palavra of proibidas) {
          expect(texto.includes(palavra), `"${palavra}" em: ${item}`).toBe(false);
        }
      }
    }
  });

  it("todo item é uma frase inteira", () => {
    for (const n of NOVIDADES) {
      expect(n.itens.length).toBeGreaterThan(0);
      for (const item of n.itens) {
        expect(item.length).toBeGreaterThan(20);
        expect(item.endsWith("."), item).toBe(true);
      }
    }
  });
});
