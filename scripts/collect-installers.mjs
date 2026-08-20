#!/usr/bin/env node
/**
 * Copia os artefatos do `tauri build` para `installers/` na raiz.
 *
 * Existe porque o caminho real é fundo demais para achar à mão:
 *   src-tauri/target/release/bundle/{nsis,msi}/…
 *
 * Só copia — não apaga o original nem limpa a pasta de destino. Manter a versão
 * anterior por perto é útil para testar uma atualização de N-1 para N.
 */
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const BUNDLE = join(RAIZ, "src-tauri", "target", "release", "bundle");
const DESTINO = join(RAIZ, "installers");

/** Instaladores + os artefatos que o updater do Tauri publica no Release. */
const EXTENSOES = [".exe", ".msi", ".zip", ".sig"];

/**
 * `target/` guarda artefatos de nomes de produto antigos para sempre — o build
 * nunca limpa. Sem este filtro a pasta herdava os 687 MB de "PDF to Markdown"
 * junto com o instalador atual.
 */
const PRODUTO = JSON.parse(
  readFileSync(join(RAIZ, "src-tauri", "tauri.conf.json"), "utf8")
).productName;

function arquivosDoBundle() {
  if (!existsSync(BUNDLE)) return [];
  return readdirSync(BUNDLE, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .flatMap((d) => {
      const sub = join(BUNDLE, d.name);
      return readdirSync(sub)
        .filter((f) => f.startsWith(PRODUTO))
        .filter((f) => EXTENSOES.some((e) => f.toLowerCase().endsWith(e)))
        .map((f) => join(sub, f));
    });
}

const encontrados = arquivosDoBundle();

if (encontrados.length === 0) {
  // Não é erro: `npm run build:vite` sozinho não gera bundle. Falhar aqui
  // quebraria o script de build por um passo que nem devia ter rodado.
  console.warn(`[installers] Nada de "${PRODUTO}" em ${BUNDLE} — rode "npm run build" antes.`);
  process.exit(0);
}

mkdirSync(DESTINO, { recursive: true });

const mb = (n) => (n / 1024 / 1024).toFixed(1).padStart(6);
console.log(`[installers] -> ${DESTINO}`);
for (const origem of encontrados) {
  const nome = origem.split(/[\\/]/).pop();
  copyFileSync(origem, join(DESTINO, nome));
  console.log(`  ${mb(statSync(origem).size)} MB  ${nome}`);
}
