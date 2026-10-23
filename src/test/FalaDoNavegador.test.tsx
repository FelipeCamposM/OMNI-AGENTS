import { afterEach, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { Composer, Microfone } from "../mobile/Composer";

// Reconhecedor falso: o teste dispara os resultados e o fim como o Chrome faria.
class Falso {
  static ultimo: Falso;
  lang = ""; continuous = false; interimResults = false;
  onresult: ((e: unknown) => void) | null = null;
  onerror: ((e: unknown) => void) | null = null;
  onend: (() => void) | null = null;
  start = vi.fn(() => { Falso.ultimo = this; });
  stop = vi.fn(() => this.onend?.());
  abort = vi.fn();
  falar(...trechos: [string, boolean][]) {
    this.onresult?.({ results: trechos.map(([t, isFinal]) => Object.assign([{ transcript: t }], { isFinal })) });
  }
}

afterEach(() => { vi.unstubAllGlobals(); });

function Teste() {
  const [texto, setTexto] = useState("veja:");
  return <Composer texto={texto} onTexto={setTexto} anexos={[]} onAdicionar={vi.fn()} onRemover={vi.fn()}
    onEnviar={vi.fn()} podeEnviar ocupado={false} placeholder="msg" />;
}

it("com fala do navegador, o texto entra enquanto fala e sobrevive ao Chrome religar — sem modelo no PC", async () => {
  vi.stubGlobal("isSecureContext", true);
  vi.stubGlobal("webkitSpeechRecognition", Falso);
  render(<Teste />);
  const campo = () => (screen.getByLabelText("Sua resposta") as HTMLTextAreaElement).value;

  await act(async () => { await userEvent.click(screen.getByRole("button", { name: "Falar o prompt" })); });
  const primeiro = Falso.ultimo;
  expect(primeiro.interimResults).toBe(true);
  act(() => primeiro.falar(["abre o", false]));
  expect(campo()).toBe("veja: abre o");
  act(() => primeiro.falar(["abre o roadmap", true]));
  // Silêncio: o Chrome encerra sozinho, a escuta religa e guarda o que já veio.
  act(() => primeiro.onend?.());
  expect(Falso.ultimo).not.toBe(primeiro);
  act(() => Falso.ultimo.falar(["e marca a tarefa", false]));
  expect(campo()).toBe("veja: abre o roadmap e marca a tarefa");

  await act(async () => { await userEvent.click(screen.getByRole("button", { name: "Parar de ouvir" })); });
  expect(screen.getByRole("button", { name: "Falar o prompt" })).toBeInTheDocument();
  expect(campo()).toBe("veja: abre o roadmap e marca a tarefa");
});

it("navegador sem serviço de fala (Brave, Opera) explica o motivo em vez de \"sem conexão\"", async () => {
  vi.stubGlobal("isSecureContext", true);
  vi.stubGlobal("webkitSpeechRecognition", Falso);
  sessionStorage.clear();
  render(<Teste />);
  await act(async () => { await userEvent.click(screen.getByRole("button", { name: "Falar o prompt" })); });
  act(() => { Falso.ultimo.onerror?.({ error: "network" }); Falso.ultimo.onend?.(); });
  expect(screen.getByRole("status")).toHaveTextContent(/Use o Chrome ou o Edge/);
  expect(sessionStorage.getItem("omni-fala-sem-servico")).toBe("1");
});

it("microfone avulso (criar fluxo com IA) escreve no campo de fora do chat", async () => {
  vi.stubGlobal("isSecureContext", true);
  vi.stubGlobal("webkitSpeechRecognition", Falso);
  sessionStorage.clear();
  function Campo() {
    const [texto, setTexto] = useState("");
    return <><textarea aria-label="Descreva o fluxo" value={texto} readOnly /><Microfone texto={texto} onTexto={setTexto} /></>;
  }
  render(<Campo />);
  await act(async () => { await userEvent.click(screen.getByRole("button", { name: "Falar o prompt" })); });
  act(() => Falso.ultimo.falar(["recebe um bug e o QA testa", true]));
  expect(screen.getByLabelText("Descreva o fluxo")).toHaveValue("recebe um bug e o QA testa");
});
