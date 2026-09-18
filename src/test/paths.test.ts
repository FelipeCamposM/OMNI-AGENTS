import { describe, expect, it } from "vitest";
import { normalizePath, projectName, samePath, targetLabel, wslDistroOf } from "../lib/paths";

describe("normalizePath", () => {
  it("colapsa separador, barra final e caixa", () => {
    expect(normalizePath("D:/dev/API/")).toBe(normalizePath(String.raw`d:\dev\api`));
  });

  it("trata `wsl$` e `wsl.localhost` como a mesma pasta", () => {
    // Era o buraco das três comparações antigas: o mesmo projeto aberto pelas duas formas virava
    // dois projetos na lista e sumia do filtro do histórico.
    expect(samePath("//wsl$/Ubuntu/home/ana/p", String.raw`\\wsl.localhost\Ubuntu\home\ana\p`)).toBe(true);
  });

  it("não confunde pastas diferentes", () => {
    expect(samePath(String.raw`D:\dev\a`, String.raw`D:\dev\b`)).toBe(false);
    expect(samePath(null, String.raw`D:\dev\a`)).toBe(false);
  });
});

describe("wslDistroOf e projectName", () => {
  it("lê a distro nas duas formas de caminho", () => {
    expect(wslDistroOf(String.raw`\\wsl.localhost\Ubuntu\home\ana\p`)).toBe("Ubuntu");
    expect(wslDistroOf("//wsl$/Debian/srv/app")).toBe("Debian");
    expect(wslDistroOf(String.raw`D:\dev\p`)).toBeNull();
  });

  it("nome do projeto é a última pasta", () => {
    expect(projectName(String.raw`\\wsl.localhost\Ubuntu\home\ana\api`)).toBe("api");
    expect(projectName("D:/dev/web/")).toBe("web");
  });
});

describe("targetLabel", () => {
  it("marca WSL pelo caminho e SSH pela unidade montada", () => {
    expect(targetLabel(String.raw`\\wsl.localhost\Ubuntu\home\ana\p`)).toBe("WSL · Ubuntu");
    expect(targetLabel(String.raw`X:\api`, { "X:": "Servidor" })).toBe("SSH · Servidor");
  });

  it("projeto local não tem alvo", () => {
    expect(targetLabel(String.raw`D:\dev\p`)).toBeNull();
    // Unidade que não é de nenhuma conexão é disco comum.
    expect(targetLabel(String.raw`Y:\api`, { "X:": "Servidor" })).toBeNull();
  });
});
