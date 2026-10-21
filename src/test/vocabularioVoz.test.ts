import { describe, expect, it } from "vitest";
import { aplicarVocabulario, substituicoes } from "../mobile/voz";

describe("vocabulário da voz", () => {
  it("acha as palavras que a pessoa corrigiu depois de ditar", () => {
    const ditado = "abrir o abra-se e a plus e ver o domus a de pilot, por favor";
    const final = "abrir o SIAPLUS e ver o Domus AdPilot, por favor e mais nada";
    expect(substituicoes(ditado, final)).toEqual([
      { termo: "SIAPLUS", ouvido: ["abra-se e a plus"] },
      { termo: "Domus AdPilot", ouvido: ["domus a de pilot"] },
    ]);
  });

  it("texto só acrescentado, caixa ou pontuação não viram sugestão", () => {
    expect(substituicoes("abrir o projeto", "Abrir o projeto. Depois rode os testes")).toEqual([]);
    expect(substituicoes("uma frase inteira que foi reescrita do zero agora", "outra coisa completamente diferente escrita no lugar")).toEqual([]);
  });

  it("troca a forma ouvida pelo termo, sem caixa e com hífen valendo espaço", () => {
    const itens = [{ termo: "SIAPLUS", ouvido: ["abra-se e a plus"] }];
    expect(aplicarVocabulario("Abra se e a Plus agora", itens)).toBe("SIAPLUS agora");
    expect(aplicarVocabulario("palavra abra-se e a plusmais", itens)).toBe("palavra abra-se e a plusmais");
  });
});
