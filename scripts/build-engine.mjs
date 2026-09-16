import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { createConnection } from "node:net";
import { resolve } from "node:path";

// Identidade do engine de DESENVOLVIMENTO — espelha `DEV_ENGINE_PORT` e `DEV_DATA_DIR` do
// omni-protocol. **Nunca a do app instalado.**
//
// O único processo capaz de travar `src-tauri/binaries/omni-engine-*.exe` é um engine aberto pelo
// app de dev; o instalado roda de `AppData\Local\OMNI AGENTS`. Esta função antes mirava a porta
// 47321 com o token de `com.omni.agents`, que são do app instalado: toda vez que o binário de dev
// estava em uso, `npm run dev` derrubava o OMNI instalado e todas as sessões abertas nele.
//
// Porta e token de dev são duas travas independentes: mesmo que a porta um dia colida, o engine
// instalado recusa um token que não é o dele.
const DEV_ENGINE_PORT = 47_341;
const DEV_DATA_DIR = "com.omni.agents.dev";

function digest(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function delay(milliseconds) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));
}

async function shutdownRunningEngine() {
  const localAppData = process.env.LOCALAPPDATA;
  if (!localAppData) return;

  const tokenPath = resolve(localAppData, DEV_DATA_DIR, "engine", "engine.token");
  if (!existsSync(tokenPath)) return;

  const token = readFileSync(tokenPath, "utf8").trim();
  await new Promise((resolveShutdown) => {
    const socket = createConnection({ host: "127.0.0.1", port: DEV_ENGINE_PORT });
    const finish = () => {
      socket.destroy();
      resolveShutdown();
    };
    socket.setTimeout(1_000, finish);
    socket.once("error", finish);
    socket.once("connect", () => {
      socket.end(`${JSON.stringify({ type: "shutdown", token })}\n`);
    });
    socket.once("close", resolveShutdown);
  });
}

async function copyEngine(source, destination) {
  try {
    copyFileSync(source, destination);
    return;
  } catch (error) {
    if (error?.code !== "EBUSY" && error?.code !== "EPERM") throw error;
  }

  if (existsSync(destination) && digest(source) === digest(destination)) {
    console.log("OMNI Engine já está atualizado; mantendo a instância em execução.");
    return;
  }

  console.log("OMNI Engine em execução está desatualizado; reiniciando o sidecar...");
  await shutdownRunningEngine();
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      copyFileSync(source, destination);
      return;
    } catch (error) {
      if (error?.code !== "EBUSY" && error?.code !== "EPERM") throw error;
      await delay(100);
    }
  }
  // Parar aqui é o comportamento certo, não uma falha a contornar: o processo que trava o binário
  // não respondeu ao shutdown de dev, e a alternativa seria matar às cegas — que é justamente o que
  // derrubava o app instalado.
  throw new Error(
    `Não foi possível atualizar o OMNI Engine de desenvolvimento em ${destination}: outro processo ` +
      `está usando o arquivo. O app instalado não foi tocado. Feche o app de dev ` +
      `(ou encerre o processo omni-engine) e rode de novo.`,
  );
}

const release = process.argv.includes("--release");
execFileSync(process.execPath, [resolve("node_modules/vite/bin/vite.js"), "build", "--config", "vite.mobile.config.ts"], { cwd: resolve("."), stdio: "inherit" });
const profile = release ? "release" : "debug";
const engineTarget = resolve("target-engine");
const extension = process.platform === "win32" ? ".exe" : "";

// `--target <triple>`: build de release para outra arquitetura (CI). Sem ele, a da máquina — o
// Tauri procura o sidecar como `binaries/omni-engine-<triple>`, então o nome tem que bater.
const targetIndex = process.argv.indexOf("--target");
const requested = targetIndex >= 0 ? process.argv[targetIndex + 1] : process.env.TAURI_ENV_TARGET_TRIPLE;
const host = execFileSync("rustc", ["-vV"], { encoding: "utf8" }).match(/^host: (\S+)/m)[1]; // sem `$`: no Windows a linha termina em \r
const triple = requested ?? host;

function buildEngine(target) {
  const cargoArgs = ["build", "-p", "omni-engine", "-j", "1"];
  if (release) cargoArgs.push("--release");
  if (target) cargoArgs.push("--target", target);
  execFileSync("cargo", cargoArgs, {
    cwd: resolve("."),
    stdio: "inherit",
    env: { ...process.env, CARGO_INCREMENTAL: "0", CARGO_TARGET_DIR: engineTarget },
  });
  return resolve(engineTarget, ...(target ? [target] : []), profile, `omni-engine${extension}`);
}

const binaries = resolve("src-tauri", "binaries");
mkdirSync(binaries, { recursive: true });
const destination = resolve(binaries, `omni-engine-${triple}${extension}`);
if (triple === "universal-apple-darwin") {
  // O Tauri monta cada metade do app universal separadamente antes do `lipo`, então procura os
  // sidecars pelos triples de cada arquitetura. Mantenha também o universal: ele é o artefato
  // correto quando a resolução acontece diretamente pelo target pedido ao CLI.
  const targets = ["aarch64-apple-darwin", "x86_64-apple-darwin"];
  const parts = targets.map(buildEngine);
  for (let index = 0; index < targets.length; index += 1) {
    await copyEngine(parts[index], resolve(binaries, `omni-engine-${targets[index]}${extension}`));
  }
  execFileSync("lipo", ["-create", "-output", destination, ...parts], { stdio: "inherit" });
} else {
  await copyEngine(buildEngine(requested && requested !== host ? requested : undefined), destination);
}
console.log(`OMNI Engine copiado para src-tauri/binaries/omni-engine-${triple}${extension} (${profile}).`);
