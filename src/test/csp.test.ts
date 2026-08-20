import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Guarda de regressão do CSP.
 *
 * Este arquivo existe por causa de um bug que passou por todo o `tauri dev` sem
 * dar sinal e só apareceu no app instalado: o CSP liberava
 * `https://asset.localhost`, mas o `convertFileSrc` do Tauri gera
 * `http://asset.localhost` no Windows (o `protocolScheme` só vira `https` com
 * `useHttpsScheme: true`, que não usamos — mudar isso trocaria a origem da
 * janela e apagaria o localStorage de quem já tem o app).
 *
 * O CSP **não é aplicado em dev**: ele é injetado pelo handler de assets do
 * Tauri, e em dev o front vem do servidor do Vite. Ou seja, nenhum teste manual
 * na máquina de desenvolvimento pega isso. Só este arquivo pega.
 *
 * A correção NÃO é remover a variante https — em macOS e Linux o esquema é
 * `asset://`, e num dia em que `useHttpsScheme` for ligado a https volta a
 * valer. As três formas convivem.
 */
const CSP: string = JSON.parse(
  readFileSync(join(process.cwd(), "src-tauri", "tauri.conf.json"), "utf8")
).app.security.csp;

/** Diretivas que carregam arquivo do disco do usuário via `convertFileSrc`. */
const DIRETIVAS = {
  "img-src": "miniatura de imagem, PDF e depth map",
  "media-src": "prévia de vídeo e áudio",
  "connect-src": "pdf.js buscando o PDF",
};

function diretiva(nome: string): string {
  // Cada diretiva vai até o `;` seguinte.
  const m = CSP.match(new RegExp(`(?:^|;)\\s*${nome}\\s([^;]*)`));
  if (!m) throw new Error(`diretiva ${nome} ausente do CSP`);
  return m[1];
}

describe("CSP do tauri.conf.json", () => {
  for (const [nome, uso] of Object.entries(DIRETIVAS)) {
    it(`${nome} libera o asset protocol nas duas formas (${uso})`, () => {
      const valor = diretiva(nome);
      // http:// é o que o Windows usa HOJE. Sem ele a ferramenta quebra só no
      // app instalado, com o front reportando falha de carregamento.
      expect(valor).toContain("http://asset.localhost");
      expect(valor).toContain("https://asset.localhost");
      // `asset:` cobre macOS e Linux.
      expect(valor).toContain("asset:");
    });
  }

  it("o IPC continua liberado, senão nenhum invoke funciona", () => {
    expect(diretiva("connect-src")).toContain("ipc:");
    expect(diretiva("connect-src")).toContain("http://ipc.localhost");
  });

  it("worker-src permite o worker do pdf.js (mesma origem)", () => {
    expect(diretiva("worker-src")).toContain("'self'");
  });
});
