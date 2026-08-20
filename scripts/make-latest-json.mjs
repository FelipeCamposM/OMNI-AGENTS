#!/usr/bin/env node
/**
 * Gera o `installers/latest.json` que o updater do app consulta.
 *
 * Roda depois do `npm run build` (o collect-installers já trouxe o .nsis.zip e
 * o .sig para `installers/`). Montar esse arquivo à mão a cada release é
 * pedir para errar a assinatura e derrubar a atualização de todo mundo.
 *
 * Uso:
 *   node scripts/make-latest-json.mjs
 *   node scripts/make-latest-json.mjs --notes "Visualizador de PDF e visual novo."
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const INSTALLERS = join(RAIZ, "installers");
const CONF = join(RAIZ, "src-tauri", "tauri.conf.json");

const conf = JSON.parse(readFileSync(CONF, "utf8"));
const versao = conf.version;

// A URL do endpoint aponta para `releases/latest`, mas o asset em si mora numa
// tag. Convenção: v<versao>. Mudou aqui, muda na hora de criar o Release.
const REPO = "FelipeCamposM/CAMPS-UTILS";
const TAG = `v${versao}`;

const notasIdx = process.argv.indexOf("--notes");
const notas = notasIdx >= 0 ? process.argv[notasIdx + 1] : `Versão ${versao}.`;

if (!existsSync(INSTALLERS)) {
  console.error(`[latest.json] ${INSTALLERS} não existe. Rode "npm run build" antes.`);
  process.exit(1);
}

const arquivos = readdirSync(INSTALLERS);

/**
 * O artefato assinado mudou de formato entre versões do Tauri: as antigas
 * geravam `<app>-setup.nsis.zip`, a 2.10 assina o `-setup.exe` direto. Aceita
 * os dois e prefere o da versão atual — assim o script não quebra num upgrade
 * do CLI. NSIS antes de MSI: é o instalador padrão e o que `windows.installMode`
 * configura.
 */
const CANDIDATOS = [
  `${nomeBase()}-setup.nsis.zip`,
  `${nomeBase()}-setup.exe`,
  `${nomeBase()}_x64_en-US.msi`,
];

function nomeBase() {
  return `${conf.productName}_${versao}_x64`;
}

const artefato = CANDIDATOS.find((c) => arquivos.includes(c) && arquivos.includes(`${c}.sig`));

if (!artefato) {
  const daVersao = arquivos.filter((f) => f.includes(versao));
  console.error(
    `[latest.json] Não achei instalador ASSINADO da versão ${versao} em installers/.\n` +
      `  Procurei (e o .sig de cada um): ${CANDIDATOS.join(", ")}\n` +
      `  O que existe da ${versao}: ${daVersao.length ? daVersao.join(", ") : "nada"}\n` +
      "  Sem o .sig, o build não assinou. Confira:\n" +
      '  - "createUpdaterArtifacts": true no src-tauri/tauri.conf.json\n' +
      "  - TAURI_SIGNING_PRIVATE_KEY e TAURI_SIGNING_PRIVATE_KEY_PASSWORD no ambiente"
  );
  process.exit(1);
}

// A assinatura vai INLINE no json — o updater não busca o .sig separado.
const assinatura = readFileSync(join(INSTALLERS, `${artefato}.sig`), "utf8").trim();

const latest = {
  version: versao,
  notes: notas,
  pub_date: new Date().toISOString(),
  platforms: {
    "windows-x86_64": {
      signature: assinatura,
      url: `https://github.com/${REPO}/releases/download/${TAG}/${encodeURIComponent(artefato)}`,
    },
  },
};

const saida = join(INSTALLERS, "latest.json");
writeFileSync(saida, JSON.stringify(latest, null, 2) + "\n", "utf8");

console.log(`[latest.json] ${saida}`);
console.log(`  versão: ${versao}   tag esperada: ${TAG}`);
console.log(`  asset:  ${artefato}`);
console.log("\n>> Crie o Release com a tag acima e suba: o instalador, o .sig dele e o latest.json.");
