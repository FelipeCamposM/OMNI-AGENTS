/**
 * Baixa as fontes empacotadas das legendas.
 *
 * Não ficam no repositório porque são binários; e não são baixadas em tempo de
 * execução porque o libass precisa delas em disco ANTES de queimar. Rode uma
 * vez após clonar: `npm run fonts`.
 *
 * Todas são SIL Open Font License 1.1 — redistribuir dentro do instalador é
 * permitido. Trocar por uma fonte não-OFL exige conferir a licença antes.
 */
import { mkdir, writeFile, access } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..");
const DESTINO = join(RAIZ, "assets", "fonts");

// Nome do arquivo → URL. O nome da FAMÍLIA (o que vai no .ass) está em
// src/lib/subtitleFonts.ts — mexeu aqui, confira lá.
const FONTES = {
  "Inter-Regular.ttf":
    "https://github.com/google/fonts/raw/main/ofl/inter/Inter%5Bopsz,wght%5D.ttf",
  "Montserrat-Bold.ttf":
    "https://github.com/google/fonts/raw/main/ofl/montserrat/Montserrat%5Bwght%5D.ttf",
  "BebasNeue-Regular.ttf":
    "https://github.com/google/fonts/raw/main/ofl/bebasneue/BebasNeue-Regular.ttf",
  "Anton-Regular.ttf":
    "https://github.com/google/fonts/raw/main/ofl/anton/Anton-Regular.ttf",
};

await mkdir(DESTINO, { recursive: true });

for (const [arquivo, url] of Object.entries(FONTES)) {
  const alvo = join(DESTINO, arquivo);
  try {
    await access(alvo);
    console.log(`· ${arquivo} — já existe`);
    continue;
  } catch {
    // não existe: baixa
  }

  process.stdout.write(`↓ ${arquivo} … `);
  const r = await fetch(url);
  if (!r.ok) {
    console.error(`FALHOU (HTTP ${r.status})\n  ${url}`);
    process.exitCode = 1;
    continue;
  }
  await writeFile(alvo, Buffer.from(await r.arrayBuffer()));
  console.log("ok");
}

console.log(`\nFontes em ${DESTINO}`);
