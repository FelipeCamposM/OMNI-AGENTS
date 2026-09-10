import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { createConnection } from "node:net";
import { resolve } from "node:path";

const ENGINE_PORT = 47_321;

function digest(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function delay(milliseconds) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));
}

async function shutdownRunningEngine() {
  const localAppData = process.env.LOCALAPPDATA;
  if (!localAppData) return;

  const tokenPath = resolve(localAppData, "com.omni.agents", "engine", "engine.token");
  if (!existsSync(tokenPath)) return;

  const token = readFileSync(tokenPath, "utf8").trim();
  await new Promise((resolveShutdown) => {
    const socket = createConnection({ host: "127.0.0.1", port: ENGINE_PORT });
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
  throw new Error(`Não foi possível atualizar o OMNI Engine bloqueado em ${destination}.`);
}

const release = process.argv.includes("--release");
execFileSync(process.execPath, [resolve("node_modules/vite/bin/vite.js"), "build", "--config", "vite.mobile.config.ts"], { cwd: resolve("."), stdio: "inherit" });
const profile = release ? "release" : "debug";
const engineTarget = resolve("target-engine");
const cargoArgs = ["build", "-p", "omni-engine", "-j", "1"];
if (release) cargoArgs.push("--release");

execFileSync("cargo", cargoArgs, {
  cwd: resolve("."),
  stdio: "inherit",
  env: { ...process.env, CARGO_INCREMENTAL: "0", CARGO_TARGET_DIR: engineTarget },
});

const extension = process.platform === "win32" ? ".exe" : "";
const triple = process.env.TAURI_ENV_TARGET_TRIPLE ?? "x86_64-pc-windows-msvc";
const source = resolve(engineTarget, profile, `omni-engine${extension}`);
const binaries = resolve("src-tauri", "binaries");
mkdirSync(binaries, { recursive: true });
await copyEngine(source, resolve(binaries, `omni-engine-${triple}${extension}`));
console.log(`OMNI Engine copiado para src-tauri/binaries (${profile}).`);
