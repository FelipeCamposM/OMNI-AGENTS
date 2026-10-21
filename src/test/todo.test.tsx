import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TodoList, rotuloDoPrazo, useTodos } from "../features/todo/TodoList";
import { TarefasNoTopo } from "../features/todo/TarefasNoTopo";

function Lista() {
  return <TodoList {...useTodos()} />;
}

const H = 3_600_000;
/** Quarta, 21/10/2026 10:00 no fuso local. */
const AGORA = new Date(2026, 9, 21, 10, 0).getTime();

describe("TodoList", () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => vi.useRealTimers());

  it("adiciona, conclui, limpa e lembra depois de reabrir", () => {
    const { unmount } = render(<Lista />);
    const campo = screen.getByLabelText("Nova tarefa");
    fireEvent.change(campo, { target: { value: "revisar PR" } });
    fireEvent.submit(campo);
    fireEvent.change(campo, { target: { value: "  " } });
    fireEvent.submit(campo);
    expect(screen.getAllByRole("checkbox")).toHaveLength(1);

    unmount();
    render(<Lista />);
    fireEvent.click(screen.getByRole("checkbox"));
    expect(screen.getByRole("checkbox")).toBeChecked();
    fireEvent.click(screen.getByRole("button", { name: "Limpar 1 concluída" }));
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
  });

  it("separa atrasadas, hoje, próximas e sem prazo; tarefa salva antes do prazo continua lá", () => {
    vi.useFakeTimers({ now: AGORA, toFake: ["Date"] });
    localStorage.setItem("omni-todo", JSON.stringify([
      { id: "a", texto: "antiga sem prazo", feita: false },
      { id: "b", texto: "vencida", feita: false, prazo: AGORA - 2 * H },
      { id: "c", texto: "de tarde", feita: false, prazo: AGORA + 5 * H },
      { id: "d", texto: "semana que vem", feita: false, prazo: AGORA + 6 * 24 * H },
    ]));
    render(<Lista />);
    const grupo = (nome: string) => within(screen.getByRole("region", { name: nome }));
    expect(grupo("Atrasadas").getByText("vencida")).toBeInTheDocument();
    expect(grupo("Atrasadas").getByText("atrasada há 2 h")).toBeInTheDocument();
    expect(grupo("Hoje").getByText("hoje 15:00")).toBeInTheDocument();
    expect(grupo("Próximas").getByText("semana que vem")).toBeInTheDocument();
    expect(grupo("Sem prazo").getByText("antiga sem prazo")).toBeInTheDocument();
  });

  it("define o prazo pelo atalho e pelas rodas (teclado), e tira o prazo", () => {
    vi.useFakeTimers({ now: AGORA, toFake: ["Date"] });
    render(<Lista />);
    fireEvent.click(screen.getByRole("button", { name: "Definir prazo" }));
    fireEvent.click(screen.getByRole("button", { name: "Hoje 18:00" }));
    const campo = screen.getByLabelText("Nova tarefa");
    fireEvent.change(campo, { target: { value: "deploy" } });
    fireEvent.submit(campo);
    expect(within(screen.getByRole("region", { name: "Hoje" })).getByText("hoje 18:00")).toBeInTheDocument();

    // Trocar pela roda: amanhã no calendário, hora 9 com as setas, minuto 30.
    fireEvent.click(screen.getByRole("button", { name: /Prazo de deploy/ }));
    const seletor = within(screen.getByRole("dialog", { name: "Escolher prazo" }));
    fireEvent.click(seletor.getByRole("button", { name: /quinta-feira, 22 de outubro/ }));
    const horas = seletor.getByRole("spinbutton", { name: "Hora" });
    for (let i = 0; i < 9; i++) fireEvent.keyDown(horas, { key: "ArrowUp" });
    expect(horas).toHaveAttribute("aria-valuenow", "9");
    const minutos = seletor.getByRole("spinbutton", { name: "Minuto" });
    fireEvent.keyDown(minutos, { key: "PageDown" });
    for (let i = 0; i < 25; i++) fireEvent.keyDown(minutos, { key: "ArrowDown" });
    fireEvent.click(seletor.getByRole("button", { name: "Definir" }));
    expect(within(screen.getByRole("region", { name: "Próximas" })).getByText("amanhã 09:30")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Prazo de deploy/ }));
    fireEvent.click(screen.getByRole("button", { name: "Sem prazo" }));
    expect(within(screen.getByRole("region", { name: "Sem prazo" })).getByText("deploy")).toBeInTheDocument();
  });

  it("cada clique da roda do mouse anda um item, não três", () => {
    vi.useFakeTimers({ now: AGORA, toFake: ["Date"] });
    render(<Lista />);
    fireEvent.click(screen.getByRole("button", { name: "Definir prazo" }));
    const horas = within(screen.getByRole("dialog", { name: "Escolher prazo" })).getByRole("spinbutton", { name: "Hora" });
    const trilho = horas.firstElementChild!;
    const inicial = Number(horas.getAttribute("aria-valuenow"));
    fireEvent.wheel(trilho, { deltaY: 100 });
    expect(horas).toHaveAttribute("aria-valuenow", String(inicial + 1));
    fireEvent.wheel(trilho, { deltaY: 100 });
    fireEvent.wheel(trilho, { deltaY: -100 });
    expect(horas).toHaveAttribute("aria-valuenow", String(inicial + 1));
    // Trackpad: deltas pequenos só andam depois de somar a altura de um item.
    fireEvent.wheel(trilho, { deltaY: 10 });
    fireEvent.wheel(trilho, { deltaY: 10 });
    expect(horas).toHaveAttribute("aria-valuenow", String(inicial + 1));
    fireEvent.wheel(trilho, { deltaY: 15 });
    expect(horas).toHaveAttribute("aria-valuenow", String(inicial + 2));
  });

  it("não deixa escolher um horário que já passou", () => {
    vi.useFakeTimers({ now: AGORA, toFake: ["Date"] });
    render(<Lista />);
    fireEvent.click(screen.getByRole("button", { name: "Definir prazo" }));
    const seletor = within(screen.getByRole("dialog", { name: "Escolher prazo" }));
    const horas = seletor.getByRole("spinbutton", { name: "Hora" });
    fireEvent.keyDown(horas, { key: "PageUp" });
    expect(seletor.getByText("Esse horário já passou")).toBeInTheDocument();
    expect(seletor.getByRole("button", { name: "Definir" })).toBeDisabled();
    // Dia passado nem é clicável.
    expect(seletor.getByRole("button", { name: /terça-feira, 20 de outubro/ })).toBeDisabled();
  });

  it("copia o texto da tarefa com um clique e confirma com ✓", async () => {
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    localStorage.setItem("omni-todo", JSON.stringify([{ id: "a", texto: "npm run build:all", feita: false }]));
    render(<Lista />);
    fireEvent.click(screen.getByRole("button", { name: "Copiar texto da tarefa npm run build:all" }));
    expect(writeText).toHaveBeenCalledWith("npm run build:all");
    expect(await screen.findByRole("button", { name: "Copiado" })).toBeInTheDocument();
  });

  it("rótulo do prazo", () => {
    expect(rotuloDoPrazo(AGORA + 24 * H, AGORA).texto).toBe("amanhã 10:00");
    expect(rotuloDoPrazo(AGORA - 5 * 60_000, AGORA)).toEqual({ texto: "atrasada há 5 min", tom: "atrasada" });
  });
});

describe("TarefasNoTopo", () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => vi.useRealTimers());

  it("mostra o contador, abre o painel e fecha no Esc; atrasada deixa o aviso no rótulo", async () => {
    vi.useFakeTimers({ now: AGORA, toFake: ["Date"] });
    localStorage.setItem("omni-todo", JSON.stringify([
      { id: "a", texto: "pagar boleto", feita: false, prazo: AGORA - H },
      { id: "b", texto: "ler spec", feita: false },
      { id: "c", texto: "feita", feita: true },
    ]));
    render(<TarefasNoTopo />);
    const botao = screen.getByRole("button", { name: "Tarefas: 2 pendentes, 1 atrasada" });
    expect(within(botao).getByText("2")).toBeInTheDocument();

    fireEvent.click(botao);
    const painel = screen.getByRole("dialog", { name: "Tarefas" });
    expect(within(painel).getByText("pagar boleto")).toBeInTheDocument();
    expect(within(painel).getByText(/1 atrasada/)).toBeInTheDocument();

    // Esc com o seletor aberto fecha só o seletor.
    fireEvent.click(within(painel).getByRole("button", { name: /Prazo de pagar boleto/ }));
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "Escolher prazo" })).not.toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: "Tarefas" })).toBeInTheDocument();

    vi.useRealTimers();
    fireEvent.keyDown(document, { key: "Escape" });
    await act(() => new Promise((r) => setTimeout(r, 250)));
    expect(screen.queryByRole("dialog", { name: "Tarefas" })).not.toBeInTheDocument();
  });
});
