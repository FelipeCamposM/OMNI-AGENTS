import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "tailwindcss";
import autoprefixer from "autoprefixer";
import { resolve } from "node:path";

export default defineConfig({
  root: "mobile",
  plugins: [react()],
  css: { postcss: { plugins: [tailwindcss({ config: resolve("tailwind.config.ts") }), autoprefixer()] } },
  resolve: { alias: { "/src": resolve("src") } },
  build: { outDir: "../dist-mobile", emptyOutDir: true },
});
