import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "tailwindcss";
import autoprefixer from "autoprefixer";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/** Cor de fundo do app — a mesma do terminal do desktop. Usada na barra do celular e no splash. */
const FUNDO = "#0e0e14";

/**
 * Ícones do celular saem **direto dos ícones do app** (`src-tauri/icons`), sem cópia no repositório:
 * trocar o ícone do app atualiza o do celular no próximo build, sem ninguém lembrar.
 *
 * Nomes fixos, sem hash, de propósito: o manifest aponta para eles pelo nome, e o servidor do
 * celular libera exatamente esses caminhos sem código de acesso — o navegador busca ícone e
 * manifest sem mandar o `X-Omni-Token`.
 */
const ICONES: Record<string, string> = {
  // 180×180 opaco: o iPhone pinta de preto o que for transparente na tela inicial.
  "apple-touch-icon.png": "src-tauri/icons/ios/AppIcon-60x60@3x.png",
  "icon-192.png": "src-tauri/icons/android/mipmap-xxxhdpi/ic_launcher.png",
  "icon-512.png": "src-tauri/icons/icon.png",
  "favicon.png": "src-tauri/icons/32x32.png",
};

const MANIFEST = {
  name: "OMNI AGENTS",
  short_name: "OMNI",
  start_url: "/",
  display: "standalone",
  background_color: FUNDO,
  theme_color: FUNDO,
  icons: [
    { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
    { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
  ],
};

function iconesDoApp(): Plugin {
  return {
    name: "omni-icones-pwa",
    generateBundle() {
      for (const [fileName, origem] of Object.entries(ICONES)) {
        this.emitFile({ type: "asset", fileName, source: readFileSync(resolve(origem)) });
      }
      this.emitFile({ type: "asset", fileName: "manifest.webmanifest", source: JSON.stringify(MANIFEST, null, 2) });
    },
  };
}

export default defineConfig({
  root: "mobile",
  plugins: [react(), iconesDoApp()],
  css: { postcss: { plugins: [tailwindcss({ config: resolve("tailwind.config.ts") }), autoprefixer()] } },
  resolve: { alias: { "/src": resolve("src") } },
  build: { outDir: "../dist-mobile", emptyOutDir: true },
});
