#!/usr/bin/env node
/**
 * Passos da release do OMNI AGENTS, um por chamada. São as etapas "Comando" do fluxo
 * "Release do OMNI AGENTS" (`.omni/fluxos/release.json`), mas também servem na mão.
 *
 *   node scripts/release.mjs validar     versão sincronizada, changelog da versão, tag livre, os testes do CI
 *   node scripts/release.mjs publicar    commit de tudo, push da main, tag v<VERSION> e push da tag (dispara o release.yml)
 *   node scripts/release.mjs aguardar    espera o build do release.yml terminar; falha se o build falhar
 *   node scripts/release.mjs liberar     tira do rascunho, marca como latest e confere o latest.json público
 *   node scripts/release.mjs registrar   commit + push do roadmap
 *
 * Release normal, NUNCA pre-release: o updater lê `releases/latest`, que ignora pre-releases
 * (ver CLAUDE.md, "Dois tipos de Release").
 */
import { execSync, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const versao = readFileSync(join(RAIZ, "VERSION"), "utf8").trim();
const tag = `v${versao}`;

function falhar(mensagem) {
  console.error(`✗ ${mensagem}`);
  process.exit(1);
}

/** Roda e mostra a saída ao vivo; para tudo se falhar. */
function rodar(comando) {
  console.log(`\n$ ${comando}`);
  const r = spawnSync(comando, { cwd: RAIZ, shell: true, stdio: "inherit" });
  if (r.status !== 0) falhar(`${comando} (código ${r.status})`);
}

/** Roda e devolve o stdout, sem mostrar. */
const ler = (comando) => execSync(comando, { cwd: RAIZ, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();

const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

if (!/^\d+\.\d+\.\d+$/.test(versao)) falhar(`VERSION "${versao}" não é x.y.z`);

const passos = {
  validar() {
    rodar("node scripts/sync-version.mjs --check");
    if (!readFileSync(join(RAIZ, "src/lib/changelog.ts"), "utf8").includes(`"${versao}"`)) {
      falhar(`src/lib/changelog.ts não tem a entrada da ${versao} — sem ela o app não mostra as novidades`);
    }
    if (ler(`git tag -l ${tag}`) || ler(`git ls-remote --tags origin ${tag}`)) falhar(`a tag ${tag} já existe: essa versão já foi publicada`);
    rodar("npm run typecheck");
    rodar("npx vitest run");
    rodar("cargo test -p omni-engine -p omni-core -p omni-protocol");
    rodar("cargo check -p omni-agents");
    console.log(`\nVai entrar na ${tag}:\n${ler("git status --short") || "(nada pendente além do que já está commitado)"}`);
    console.log(`\n✓ ${tag} pronta para publicar`);
  },

  publicar() {
    const ramo = ler("git rev-parse --abbrev-ref HEAD");
    if (ramo !== "main") falhar(`a release sai da main, e a pasta está em "${ramo}"`);
    rodar("git add -A");
    if (ler("git diff --cached --name-only")) rodar(`git commit -m "release: versao ${versao}"`);
    rodar("git push origin main");
    rodar(`git tag ${tag}`);
    rodar(`git push origin ${tag}`);
    console.log(`\n✓ ${tag} enviada — o GitHub Actions começou o build (release.yml)`);
  },

  async aguardar() {
    let id = "";
    // O run aparece alguns segundos depois do push da tag.
    for (let i = 0; i < 24 && !id; i++) {
      id = ler(`gh run list --workflow release.yml --branch ${tag} --limit 1 --json databaseId --jq ".[0].databaseId"`);
      if (!id) await esperar(5000);
    }
    if (!id) falhar(`nenhum build do release.yml para ${tag} apareceu em 2 minutos`);
    console.log(`Build ${id} (Windows, macOS e Linux) — costuma levar 20 a 30 minutos.`);
    rodar(`gh run watch ${id} --exit-status --interval 30`);
    console.log(`\n✓ build terminou: rascunho da ${tag} pronto no GitHub`);
  },

  async liberar() {
    rodar(`gh release edit ${tag} --draft=false --prerelease=false --latest`);
    const repo = ler("gh repo view --json nameWithOwner -q .nameWithOwner");
    const url = `https://github.com/${repo}/releases/latest/download/latest.json`;
    // O latest.json público é o que o updater de todo mundo lê; o CDN demora um pouco a virar.
    for (let i = 0; i < 12; i++) {
      const lido = await fetch(url).then((r) => (r.ok ? r.json() : null)).catch(() => null);
      if (lido?.version === versao) {
        console.log(`\n✓ ${url} responde ${versao}: a atualização chegou para os usuários`);
        return;
      }
      console.log(`latest.json ainda responde ${lido?.version ?? "nada"}; tentando de novo em 10 s…`);
      await esperar(10_000);
    }
    falhar(`o latest.json público não virou ${versao} em 2 minutos — confira o release ${tag} no GitHub`);
  },

  registrar() {
    rodar("git add roadmaps");
    if (!ler("git diff --cached --name-only")) {
      console.log("Nada novo no roadmap para registrar.");
      return;
    }
    rodar(`git commit -m "docs: registra publicacao da release ${tag}"`);
    rodar("git push origin main");
    console.log("\n✓ roadmap registrado");
  },
};

const passo = passos[process.argv[2]];
if (!passo) falhar(`uso: node scripts/release.mjs <${Object.keys(passos).join("|")}>`);
await passo();
