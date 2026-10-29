import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { novosAvisos } from "../mobile/notificacoes";
import { lerRota, urlDaRota } from "../mobile/rota";
import { AjustesDoAparelho } from "../mobile/AjustesDoAparelho";
import { colocarNaCelula } from "../web/WebApp";
import type { Conversation } from "../mobile/api";

const conversa = (id: string, attention: string): Conversation =>
  ({ id, title: id, project_id: "p", provider: "claude", profile_id: null, state: "answered", capabilities: null, attention });

describe("celular: avisos, ajustes e layouts da web", () => {
  it("só avisa o que apareceu depois da primeira leitura, uma vez cada", () => {
    const vistos = new Set<string>();
    expect(novosAvisos([conversa("a", "s:1")], vistos, true)).toEqual([]);
    expect(novosAvisos([conversa("a", "s:1"), conversa("b", "t:1")], vistos, false).map((c) => c.id)).toEqual(["b"]);
    expect(novosAvisos([conversa("a", "s:2")], vistos, false).map((c) => c.id)).toEqual(["a"]);
    expect(novosAvisos([conversa("a", "s:2")], vistos, false)).toEqual([]);
  });

  it("a rota dos ajustes vai e volta pelo endereço", () => {
    expect(lerRota("#/ajustes")).toEqual({ tela: "ajustes" });
    expect(urlDaRota({ tela: "ajustes" })).toMatch(/#\/ajustes$/);
  });

  it("sem HTTPS explica por que não dá para ligar os avisos", () => {
    render(<AjustesDoAparelho />);
    expect(screen.getByRole("switch", { name: "Avisar quando precisar de mim" })).toBeDisabled();
    expect(screen.getByRole("note")).toHaveTextContent(/HTTPS|não mostra/);
    fireEvent.click(screen.getByRole("button", { name: /Desconectar este aparelho/ }));
    expect(screen.getByRole("alert")).toHaveTextContent("Desconectar este aparelho?");
  });

  it("arrastar para uma célula põe a conversa lá; de outra célula, troca de lugar", () => {
    expect(colocarNaCelula(["a"], "b", 2)).toEqual(["a", "b"]);
    expect(colocarNaCelula(["a", "b"], "c", 0)).toEqual(["c", "b"]);
    expect(colocarNaCelula(["a", "b", "c"], "c", 0)).toEqual(["c", "b", "a"]);
    expect(colocarNaCelula(["a", "b"], "a", 5)).toEqual(["b", "a"]);
  });
});
