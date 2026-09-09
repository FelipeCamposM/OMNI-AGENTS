import * as monaco from "monaco-editor";
import { loader } from "@monaco-editor/react";

// App local-only: nunca buscar o Monaco de CDN (padrão do @monaco-editor/react).
// Aponta pro pacote já bundlado no build do Vite.
loader.config({ monaco });

// `?worker` num subpath fundo de node_modules não resolve de forma confiável no Rollup
// deste projeto (Vite 5). `new URL(..., import.meta.url)` é o mecanismo do Vite pra
// apontar pra um arquivo estático, mas só analisa string literal — sem template
// dinâmico, por isso uma constante por worker em vez de uma função geradora.
const editorWorkerUrl = new URL("monaco-editor/esm/vs/editor/editor.worker.js", import.meta.url);
const jsonWorkerUrl = new URL("monaco-editor/esm/vs/language/json/json.worker.js", import.meta.url);
const cssWorkerUrl = new URL("monaco-editor/esm/vs/language/css/css.worker.js", import.meta.url);
const htmlWorkerUrl = new URL("monaco-editor/esm/vs/language/html/html.worker.js", import.meta.url);
const tsWorkerUrl = new URL("monaco-editor/esm/vs/language/typescript/ts.worker.js", import.meta.url);

self.MonacoEnvironment = {
  getWorker(_workerId: string, label: string) {
    if (label === "json") return new Worker(jsonWorkerUrl, { type: "module" });
    if (["css", "scss", "less"].includes(label)) return new Worker(cssWorkerUrl, { type: "module" });
    if (["html", "handlebars", "razor"].includes(label)) return new Worker(htmlWorkerUrl, { type: "module" });
    if (["typescript", "javascript"].includes(label)) return new Worker(tsWorkerUrl, { type: "module" });
    return new Worker(editorWorkerUrl, { type: "module" });
  },
};
