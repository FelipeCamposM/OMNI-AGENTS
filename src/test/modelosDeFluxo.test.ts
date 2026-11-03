import { describe, expect, it } from "vitest";
import { etapasDoFluxo, MODELOS_DE_FLUXO, SAIDAS } from "../features/fluxos/fluxosService";

// Mesmas regras do `validar` do omni-core: o modelo abre no editor e já salva/executa sem erro.
describe("modelos do Novo fluxo", () => {
  it.each(MODELOS_DE_FLUXO.map((m) => [m.nome, m] as const))("%s é um fluxo válido", (_, m) => {
    const f = m.fluxo();
    const ids = new Set(f.nos.map((n) => n.id));
    expect(ids.size).toBe(f.nos.length);
    expect(f.nos.filter((n) => n.tipo === "entrada")).toHaveLength(1);
    for (const n of f.nos) if (n.tipo === "agente") expect(n.agente).toBeTruthy();
    for (const c of f.conexoes) {
      const de = f.nos.find((n) => n.id === c.de)!;
      expect(de).toBeDefined();
      expect(ids.has(c.para)).toBe(true);
      expect(SAIDAS[de.tipo]).toContain(c.saida ?? "");
    }
    expect(etapasDoFluxo(f).at(-1)?.tipo).toBe("fim");
  });
});
