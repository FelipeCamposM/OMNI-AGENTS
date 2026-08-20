#!/usr/bin/env node
/**
 * Propaga a versão do arquivo `VERSION` para todos os lugares que precisam dela.
 *
 * `VERSION` na raiz é a **única fonte da verdade**. Edite lá e rode
 * `npm run version:sync` — ou nem isso, porque `npm run build` já sincroniza
 * antes de empacotar.
 *
 * Por que existe: a versão vivia em três arquivos e quem manda no updater é o
 * `tauri.conf.json`. Divergir entre eles não quebra o build — produz um
 * instalador com a versão errada, e o app deixa de reconhecer a atualização.
 * Falha silenciosa é a pior espécie.
 *
 * Uso:
 *   node scripts/sync-version.mjs           aplica
 *   node scripts/sync-version.mjs --check   só confere; sai 1 se divergir
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const CONFERIR = process.argv.includes("--check");

const versao = readFileSync(join(RAIZ, "VERSION"), "utf8").trim();

// O updater compara versões por semver; um valor fora do padrão faz a
// comparação falhar de forma difícil de diagnosticar.
if (!/^\d+\.\d+\.\d+$/.test(versao)) {
  console.error(`[versão] "${versao}" não é semver x.y.z. Corrija o arquivo VERSION.`);
  process.exit(1);
}

/** Cada alvo sabe ler e escrever a própria versão. */
const ALVOS = [
  {
    arquivo: "package.json",
    ler: (t) => JSON.parse(t).version,
    escrever: (t, v) => {
      const j = JSON.parse(t);
      j.version = v;
      return JSON.stringify(j, null, 2) + "\n";
    },
  },
  {
    arquivo: "src-tauri/tauri.conf.json",
    ler: (t) => JSON.parse(t).version,
    escrever: (t, v) => {
      const j = JSON.parse(t);
      j.version = v;
      return JSON.stringify(j, null, 2) + "\n";
    },
  },
  {
    arquivo: "src-tauri/Cargo.toml",
    // Escopado ao bloco [package]: um regex solto por `version = "…"` acertaria
    // também as versões das dependências mais abaixo no arquivo.
    ler: (t) => t.match(/\[package\][\s\S]*?\nversion = "([^"]+)"/)?.[1],
    escrever: (t, v) =>
      t.replace(/(\[package\][\s\S]*?\nversion = ")[^"]+(")/, `$1${v}$2`),
  },
];

let divergiu = false;

for (const alvo of ALVOS) {
  const caminho = join(RAIZ, alvo.arquivo);
  const texto = readFileSync(caminho, "utf8");
  const atual = alvo.ler(texto);

  if (atual === undefined) {
    console.error(`[versão] não achei a versão em ${alvo.arquivo}`);
    process.exit(1);
  }
  if (atual === versao) {
    console.log(`  ok      ${alvo.arquivo}  ${atual}`);
    continue;
  }

  divergiu = true;
  if (CONFERIR) {
    console.error(`  DIVERGE ${alvo.arquivo}  ${atual} != ${versao}`);
  } else {
    writeFileSync(caminho, alvo.escrever(texto, versao), "utf8");
    console.log(`  ->      ${alvo.arquivo}  ${atual} -> ${versao}`);
  }
}

if (CONFERIR && divergiu) {
  console.error("\n[versão] rode `npm run version:sync`.");
  process.exit(1);
}

console.log(`\n[versão] ${versao}`);
if (divergiu) {
  // O Cargo.lock guarda a versão do próprio crate; o cargo acerta sozinho no
  // próximo build, mas avisar evita um diff surpresa depois.
  console.log("O Cargo.lock será atualizado no próximo cargo check/build.");
}
