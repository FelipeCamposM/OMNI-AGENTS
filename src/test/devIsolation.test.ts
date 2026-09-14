import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * `npm run dev` nunca pode encostar no OMNI instalado.
 *
 * O `build-engine.mjs`, ao achar o binário de dev travado, manda `shutdown` para um engine. Ele
 * mirava a porta e o token do app **instalado** — e todo `npm run dev` derrubava o app e as sessões
 * abertas nele. A identidade de dev vive duplicada à mão (JS e Rust); este teste é o que impede as
 * duas cópias de divergirem em silêncio.
 */
const script = readFileSync(resolve("scripts/build-engine.mjs"), "utf8");
const protocolo = readFileSync(resolve("crates/omni-protocol/src/lib.rs"), "utf8");

function constanteRust(nome: string): string {
  const achado = protocolo.match(new RegExp(`pub const ${nome}: [^=]+= ([^;]+);`));
  if (!achado) throw new Error(`${nome} sumiu do omni-protocol`);
  return achado[1].replace(/_/g, "").replace(/"/g, "").trim();
}

describe("isolamento entre dev e app instalado", () => {
  it("o script mira a mesma identidade de dev que o Rust usa", () => {
    expect(script).toContain(`const DEV_ENGINE_PORT = ${constanteRust("DEV_ENGINE_PORT").replace(/(\d{2})(\d{3})$/, "$1_$2")};`);
    expect(script).toContain(`const DEV_DATA_DIR = "${constanteRust("DEV_DATA_DIR")}";`);
  });

  it("dev e instalado nunca compartilham porta nem pasta", () => {
    expect(constanteRust("DEV_ENGINE_PORT")).not.toBe(constanteRust("DEFAULT_ENGINE_PORT"));
    expect(constanteRust("DEV_DATA_DIR")).not.toBe(constanteRust("DATA_DIR"));
  });

  it("o script não referencia a porta nem a pasta do app instalado fora dos comentários", () => {
    const codigo = script.split("\n").filter((linha) => !linha.trim().startsWith("//")).join("\n");
    expect(codigo).not.toMatch(/47_?321/);
    // A pasta do instalado só pode aparecer como prefixo da de dev.
    expect(codigo.replace(/com\.omni\.agents\.dev/g, "")).not.toContain("com.omni.agents");
  });
});
