import { describe, expect, it } from "vitest";
import { isStaged, isUnstaged, type GitStatusEntry } from "../features/git/gitService";

function entry(x: string, y: string): GitStatusEntry {
  return { path: "arquivo.ts", x, y };
}

/**
 * Contrato com o lado Rust (`parse_status_v1` em `src-tauri/src/git_client.rs`): coluna vazia é
 * PONTO. O git manda ESPAÇO no porcelain v1, e o parser normaliza — se alguém remover aquela
 * normalização, estes testes continuam verdes mas o app volta a classificar todo arquivo como
 * preparado E não preparado ao mesmo tempo. Por isso o lado Rust tem o teste espelho.
 */
describe("classificação de entradas do git status", () => {
  it("modificado só na árvore não conta como preparado", () => {
    expect(isStaged(entry(".", "M"))).toBe(false);
    expect(isUnstaged(entry(".", "M"))).toBe(true);
  });

  it("modificado e preparado não conta como pendente", () => {
    expect(isStaged(entry("M", "."))).toBe(true);
    expect(isUnstaged(entry("M", "."))).toBe(false);
  });

  it("modificado nos dois lugares aparece nas duas listas", () => {
    expect(isStaged(entry("M", "M"))).toBe(true);
    expect(isUnstaged(entry("M", "M"))).toBe(true);
  });

  it("não rastreado é pendente, nunca preparado", () => {
    expect(isStaged(entry("?", "?"))).toBe(false);
    expect(isUnstaged(entry("?", "?"))).toBe(true);
  });

  it("espaço cru (porcelain v1 sem normalizar) seria classificado errado", () => {
    // Documenta o bug original: é isto que chegava na UI antes da normalização no Rust.
    expect(isStaged(entry(" ", "M"))).toBe(true); // ← errado, e por isso o Rust normaliza
  });
});
