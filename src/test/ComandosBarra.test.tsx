import { describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { barraNoCursor, Composer, filtrarComandos } from "../mobile/Composer";
import type { Comando } from "../mobile/api";

const LISTA: Comando[] = [
  { nome: "clear", descricao: "Começa uma conversa nova", origem: "cli" },
  { nome: "compact", descricao: "Resume a conversa", origem: "cli" },
  { nome: "context", descricao: "Uso do contexto", origem: "cli" },
  { nome: "caveman:compress", descricao: "Comprime memória", origem: "plugin" },
];

function montar(onEnviar = vi.fn()) {
  const comandos = vi.fn(async () => LISTA);
  function Teste() {
    const [texto, setTexto] = useState("");
    return <Composer texto={texto} onTexto={setTexto} anexos={[]} onAdicionar={vi.fn()} onRemover={vi.fn()}
      onEnviar={onEnviar} podeEnviar ocupado={false} placeholder="msg" comandos={comandos} />;
  }
  render(<Teste />);
  return { campo: screen.getByLabelText("Sua resposta") as HTMLTextAreaElement, comandos, onEnviar };
}

describe("comandos com / no chat", () => {
  it("só abre com / no começo da mensagem, e filtra pondo quem começa com a busca primeiro", () => {
    expect(barraNoCursor("/comp", 5)).toBe("comp");
    expect(barraNoCursor("/", 1)).toBe("");
    expect(barraNoCursor("veja /comp", 10)).toBeNull();
    expect(barraNoCursor("/compact agora", 14)).toBeNull();
    expect(barraNoCursor("src/a/b", 7)).toBeNull();
    expect(filtrarComandos(LISTA, "comp").map((c) => c.nome)).toEqual(["compact", "caveman:compress"]);
  });

  it("digitar / lista os comandos do agente; Tab completa sem enviar", async () => {
    const { campo, comandos, onEnviar } = montar();
    await act(async () => { await userEvent.type(campo, "/co"); });
    expect(comandos).toHaveBeenCalledTimes(1);
    expect(await screen.findByRole("option", { name: /\/compact/ })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: /caveman:compress/ })).toHaveTextContent("plugin");
    expect(screen.queryByRole("option", { name: /\/clear/ })).not.toBeInTheDocument();
    await act(async () => { await userEvent.keyboard("{ArrowDown}"); });
    await act(async () => { await userEvent.keyboard("{Tab}"); });
    expect(campo.value).toBe("/context ");
    expect(onEnviar).not.toHaveBeenCalled();
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("Enter completa um nome pela metade, mas envia quando o comando já está completo", async () => {
    const { campo, onEnviar } = montar();
    const matchMedia = vi.spyOn(window, "matchMedia").mockReturnValue({ matches: true } as MediaQueryList);
    await act(async () => { await userEvent.type(campo, "/compa"); });
    await screen.findByRole("option", { name: /\/compact/ });
    await act(async () => { await userEvent.keyboard("{Enter}"); });
    expect(campo.value).toBe("/compact ");
    expect(onEnviar).not.toHaveBeenCalled();

    await act(async () => { await userEvent.clear(campo); await userEvent.type(campo, "/compact"); });
    await screen.findByRole("option", { name: /\/compact/ });
    await act(async () => { await userEvent.keyboard("{Enter}"); });
    expect(onEnviar).toHaveBeenCalledTimes(1);
    matchMedia.mockRestore();
  });
});
