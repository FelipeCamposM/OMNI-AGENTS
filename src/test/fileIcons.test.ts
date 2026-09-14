import { describe, expect, it } from "vitest";
import * as PixelIcon from "../components/ui/PixelIcon";
import { MAPAS_DE_ICONE, iconForEntry, iconForPath } from "../features/files/fileIcons";

describe("iconForEntry", () => {
  it("usa a extensão, ignorando caixa", () => {
    expect(iconForEntry("logo.PNG", false)).toBe(iconForEntry("foto.png", false));
    expect(iconForEntry("App.tsx", false)).toBe(PixelIcon.ReactIcon);
    expect(iconForEntry("main.rs", false)).toBe(PixelIcon.CpuIcon);
    expect(iconForEntry("demo.mp4", false)).toBe(PixelIcon.VideoIcon);
  });

  it("nome exato ganha da extensão", () => {
    // package.json não é "um json qualquer"
    expect(iconForEntry("package.json", false)).toBe(PixelIcon.NpmIcon);
    expect(iconForEntry("package.json", false)).not.toBe(iconForEntry("tsconfig.json", false));
    expect(iconForEntry("Dockerfile", false)).toBe(PixelIcon.DockerIcon);
    expect(iconForEntry("Makefile", false)).toBe(PixelIcon.ToolsIcon);
  });

  it("dotfile é identidade inteira, não extensão", () => {
    // `.gitignore` com split(".").pop() viraria extensão "gitignore" e cairia no fallback.
    expect(iconForEntry(".gitignore", false)).toBe(PixelIcon.GitBranchIcon);
    expect(iconForEntry(".env", false)).toBe(PixelIcon.KeyIcon);
    expect(iconForEntry(".gitignore", false)).not.toBe(PixelIcon.FileIcon);
  });

  it("pasta conhecida tem ícone próprio; o resto é pasta comum", () => {
    expect(iconForEntry("node_modules", true)).toBe(PixelIcon.PackageIcon);
    expect(iconForEntry("src", true)).toBe(PixelIcon.CodeIcon);
    expect(iconForEntry("qualquer-coisa", true)).toBe(PixelIcon.FolderIcon);
  });

  it("o mesmo nome muda de ícone conforme seja pasta ou arquivo", () => {
    expect(iconForEntry("src", true)).not.toBe(iconForEntry("src", false));
  });

  it("extensão desconhecida cai no ícone de arquivo genérico", () => {
    expect(iconForEntry("coisa.xyzabc", false)).toBe(PixelIcon.FileIcon);
    expect(iconForEntry("SemPontoNenhum", false)).toBe(PixelIcon.FileIcon);
  });

  it("iconForPath usa só o último segmento, em qualquer separador", () => {
    expect(iconForPath("C:\\dev\\projeto\\src\\App.tsx")).toBe(PixelIcon.ReactIcon);
    expect(iconForPath("/home/user/projeto/package.json")).toBe(PixelIcon.NpmIcon);
  });
});

describe("integridade dos mapas", () => {
  it("todo ícone referenciado existe de fato em PixelIcon", () => {
    // Um nome de export digitado errado vira `undefined` e só explode ao renderizar a árvore.
    const exportados = new Set(Object.values(PixelIcon));
    for (const [nomeDoMapa, mapa] of Object.entries(MAPAS_DE_ICONE)) {
      for (const [chave, icone] of Object.entries(mapa)) {
        expect(icone, `${nomeDoMapa}["${chave}"] aponta para um ícone inexistente`).toBeTypeOf(
          "function"
        );
        expect(exportados.has(icone), `${nomeDoMapa}["${chave}"] não é um ícone de PixelIcon`).toBe(
          true
        );
      }
    }
  });

  it("as chaves são minúsculas — a busca normaliza antes de consultar", () => {
    for (const [nomeDoMapa, mapa] of Object.entries(MAPAS_DE_ICONE)) {
      for (const chave of Object.keys(mapa)) {
        expect(chave, `${nomeDoMapa}: "${chave}" nunca casaria`).toBe(chave.toLowerCase());
      }
    }
  });

  it("usa formas variadas, não um ícone genérico para tudo", () => {
    // O app é monocromático: se metade das extensões apontar para o mesmo desenho, o ícone
    // deixa de informar. Este teste é o guarda-corpo dessa decisão de design.
    // Comparação por REFERÊNCIA, não por nome: `makeIcon` devolve sempre `function Icon`, então
    // todo ícone gerado tem o mesmo `.name` e um Set de nomes colapsaria em 1.
    const usados = Object.values(MAPAS_DE_ICONE.EXTENSOES);
    const distintos = new Set(usados);
    expect(distintos.size).toBeGreaterThanOrEqual(30);

    const maisComum = Math.max(
      ...[...distintos].map((icone) => usados.filter((usado) => usado === icone).length)
    );
    expect(maisComum / usados.length).toBeLessThan(0.15);
  });
});
