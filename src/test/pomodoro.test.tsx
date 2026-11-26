import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import {
  CONFIGURACAO_PADRAO, avancar, comecar, normalizarHistorico, novoCronometro, pausar, pular, restante,
  acoesDoPomodoro, estadoDoPomodoro, gravacoesDoPomodoro, limparPomodoro, type SessaoDePomodoro,
} from "../features/roadmaps/pomodoro";
import { analisarPeriodo, analisarTudo, inicioDaSemana, type DadosDoRoadmap } from "../features/roadmaps/analises";
import { normalizarCards, normalizarMeta, normalizarPlano, normalizarProgresso } from "../features/roadmaps/normalizar";
import { TelaDoPomodoro } from "../features/roadmaps/TelaDoPomodoro";
import { TelaDeAnalises } from "../features/roadmaps/TelaDeAnalises";
import { limparLoja } from "../features/roadmaps/loja";

const MIN = 60_000;
const config = { ...CONFIGURACAO_PADRAO, foco: 25, pausa: 5, pausaLonga: 15, ciclos: 2, pausaAutomatica: true };
const t0 = new Date(2026, 10, 24, 9, 0).getTime(); // terça, 24/11/2026, 9h

describe("cronômetro", () => {
  it("conta pelo relógio, pausa sem perder tempo e grava o foco completo na matéria", () => {
    let c = comecar(novoCronometro(config, { nome: "Cálculo" }), t0);
    expect(restante(c, t0 + 10 * MIN)).toBe(15 * MIN);
    c = pausar(c, t0 + 10 * MIN);
    expect(restante(c, t0 + 60 * MIN)).toBe(15 * MIN); // pausado não anda
    c = comecar(c, t0 + 20 * MIN);
    // Tick atrasado (janela minimizada): o fim é o real, não a hora do tick.
    const passo = avancar(c, config, t0 + 50 * MIN);
    expect(passo.terminou).toBe("foco");
    expect(passo.sessao).toMatchObject({ materia: "Cálculo", minutos: 25, previsto: 25, completo: true });
    expect(passo.sessao?.fim).toBe(new Date(t0 + 35 * MIN).toISOString());
    expect(passo.cronometro.fase).toBe("pausa");
    expect(passo.cronometro.desde).toBe(t0 + 35 * MIN); // pausa automática começou no fim do foco
  });

  it("pausa longa depois dos ciclos; pular foco com menos de 1 min não grava, com mais grava interrompido", () => {
    let c = comecar(novoCronometro(config), t0);
    c = avancar(c, config, t0 + 25 * MIN).cronometro; // pausa
    c = avancar(c, config, t0 + 30 * MIN).cronometro; // foco (parado)
    expect(c.fase).toBe("foco");
    c = comecar(c, t0 + 31 * MIN);
    c = avancar(c, config, t0 + 56 * MIN).cronometro;
    expect(c.fase).toBe("pausaLonga");
    expect(restante(c, t0 + 56 * MIN)).toBe(15 * MIN);

    const curto = pular(comecar(novoCronometro(config), t0), config, t0 + 30_000);
    expect(curto.sessao).toBeNull();
    const longo = pular(comecar(novoCronometro(config), t0), config, t0 + 12 * MIN);
    expect(longo.sessao).toMatchObject({ minutos: 12, completo: false });
    expect(longo.cronometro.fase).toBe("pausa");
  });

  it("histórico estragado vira o que dá para aproveitar", () => {
    const h = normalizarHistorico({ config: { foco: 9999, ciclos: "x" }, sessoes: [{ inicio: "lixo" }, { inicio: "2026-11-24T12:00:00Z", fim: "2026-11-24T12:25:00Z", materia: "Inglês", minutos: 25, completo: true, cor: "red" }] });
    expect(h.config.foco).toBe(180);
    expect(h.config.ciclos).toBe(CONFIGURACAO_PADRAO.ciclos);
    expect(h.sessoes).toHaveLength(1);
    expect(h.sessoes[0].cor).toBeUndefined();
  });
});

function sessao(dia: number, hora: number, minutos: number, materia: string, roadmapId?: string, completo = true): SessaoDePomodoro {
  const inicio = new Date(2026, 10, dia, hora, 0);
  return { id: `p-${dia}-${hora}`, inicio: inicio.toISOString(), fim: new Date(inicio.getTime() + minutos * MIN).toISOString(), minutos, previsto: 25, completo, materia, ...(roadmapId ? { roadmapId } : {}) };
}

function roadmapDeVendas(): DadosDoRoadmap {
  const plano = normalizarPlano({ objetivo: "x", modulos: [{ id: "m", titulo: "M", etapas: [{ id: "e-a", titulo: "A", minutos: 20 }, { id: "e-b", titulo: "B", minutos: 20 }] }] });
  return {
    meta: normalizarMeta("r-vendas", { nome: "Vendas", cor: "#22a06b" }),
    plano,
    progresso: normalizarProgresso({ etapas: { "e-a": { estado: "concluida", inicio: new Date(2026, 10, 23, 10).toISOString(), fim: new Date(2026, 10, 23, 11).toISOString() } }, dias: ["2026-11-23"] }),
    cards: normalizarCards({ cards: [], revisoes: [{ cardId: "c", nota: 3, em: new Date(2026, 10, 24, 8).toISOString() }] }),
  };
}

describe("análises", () => {
  const sessoes = [
    sessao(23, 10, 25, "Vendas", "r-vendas"),
    sessao(24, 9, 25, "Cálculo"),
    sessao(24, 14, 10, "cálculo ", undefined, false),
    sessao(16, 9, 25, "Cálculo"), // semana anterior
  ];

  it("semana de segunda a domingo, com dias, total e matérias (roadmap pelo nome atual, nome livre sem maiúsculas)", () => {
    expect(inicioDaSemana("2026-11-24")).toBe("2026-11-23");
    expect(inicioDaSemana("2026-11-29")).toBe("2026-11-23"); // domingo
    const a = analisarPeriodo(sessoes, [roadmapDeVendas()], "2026-11-23", 7);
    expect(a.dias.map((d) => d.minutos)).toEqual([25, 35, 0, 0, 0, 0, 0]);
    expect(a.total).toEqual({ minutos: 60, pomodoros: 2, interrompidos: 1, etapas: 1, revisoes: 1, questoes: 0, acertos: 0, atividades: 0 });
    expect(a.materias.map((m) => [m.nome, m.minutos, m.pomodoros, m.etapas, m.revisoes])).toEqual([
      ["Cálculo", 35, 1, 0, 0],
      ["Vendas", 25, 1, 1, 1],
    ]);
  });

  it("tudo: total, sequência de dias e etapas do plano por matéria", () => {
    const a = analisarTudo(sessoes, [roadmapDeVendas()], "2026-11-24");
    expect(a.sequencia).toBe(2);
    expect(a.diasComEstudo).toBe(3);
    expect(a.materias.find((m) => m.chave === "r-vendas")).toMatchObject({ etapas: 1, etapasNoPlano: 2, ultimoDia: "2026-11-24" });
  });
});

describe("telas", () => {
  const mockedInvoke = vi.mocked(invoke);
  let arquivo: string | null;

  beforeEach(() => {
    limparPomodoro();
    limparLoja();
    arquivo = JSON.stringify({ versao: 1, config: { ...CONFIGURACAO_PADRAO, foco: 1 }, sessoes: [sessao(24, 9, 25, "Cálculo")] });
    mockedInvoke.mockReset();
    mockedInvoke.mockImplementation(async (cmd: string, args?: unknown) => {
      if (cmd === "roadmaps_ler_geral") return (args as { nome: string }).nome === "pomodoros.json" ? arquivo : null;
      if (cmd === "roadmaps_gravar_geral") { if ((args as { nome: string }).nome === "pomodoros.json") arquivo = (args as { conteudo: string }).conteudo; return null; }
      if (cmd === "roadmaps_listar") return [];
      return null;
    });
  });
  afterEach(() => { vi.useRealTimers(); act(() => limparPomodoro()); });

  it("Pomodoro: matéria livre, foco termina, entra no histórico gravado e a pausa começa", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "Date"] });
    vi.setSystemTime(t0);
    render(<TelaDoPomodoro />);
    await act(async () => { await Promise.resolve(); });
    expect(screen.getByRole("timer")).toHaveTextContent("01:00");
    fireEvent.change(screen.getByLabelText("Nome da matéria"), { target: { value: "Física" } });
    fireEvent.click(screen.getByRole("button", { name: "Usar" }));
    fireEvent.click(screen.getByRole("button", { name: "Começar" }));
    await act(async () => { vi.advanceTimersByTime(61_000); });
    await act(async () => { await gravacoesDoPomodoro(); });
    expect(screen.getByText("Pausa", { selector: "p" })).toBeInTheDocument();
    const salvo = JSON.parse(arquivo as string) as { sessoes: SessaoDePomodoro[] };
    expect(salvo.sessoes.map((s) => [s.materia, s.minutos, s.completo])).toEqual([["Cálculo", 25, true], ["Física", 1, true]]);
    const historico = screen.getByRole("region", { name: "Histórico do Pomodoro" });
    expect(within(historico).getByText("Física")).toBeInTheDocument();
    fireEvent.click(within(historico).getByRole("button", { name: /Apagar pomodoro de Física/ }));
    await act(async () => { await gravacoesDoPomodoro(); });
    expect((JSON.parse(arquivo as string) as { sessoes: unknown[] }).sessoes).toHaveLength(1);
  });

  it("parado, o Pomodoro não liga relógio nenhum", async () => {
    const intervalo = vi.spyOn(globalThis, "setInterval");
    render(<TelaDoPomodoro />);
    await act(async () => { await Promise.resolve(); });
    expect(intervalo).not.toHaveBeenCalled();
    act(() => { acoesDoPomodoro.comecar(); acoesDoPomodoro.pausar(); });
    expect(estadoDoPomodoro().cronometro.desde).toBeNull();
    intervalo.mockRestore();
  });

  it("Análises: semana, dia e matérias a partir do histórico", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 10, 24, 18, 0));
    render(<TelaDeAnalises />);
    expect(await screen.findByText("Foco na semana")).toBeInTheDocument();
    expect(screen.getAllByText("25 min").length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("button", { name: "Dia" }));
    expect(screen.getByText(/Hoje,/)).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Foco por hora" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Matérias" }));
    expect(screen.getByRole("table")).toHaveTextContent("Cálculo");
  });
});

describe("PC e celular no mesmo arquivo", () => {
  it("junta as sessões dos dois, o que foi apagado aqui não volta, ajuste daqui só vence se mudou aqui", async () => {
    const { juntarHistoricos } = await import("../features/roadmaps/pomodoro");
    const disco = normalizarHistorico({ config: { foco: 50 }, sessoes: [sessao(24, 9, 25, "Cálculo"), sessao(24, 10, 25, "Velha")] });
    const memoria = normalizarHistorico({ config: { foco: 30 }, sessoes: [sessao(24, 11, 25, "Física")] });
    const junto = juntarHistoricos(disco, memoria, new Set(["p-24-10"]), false);
    expect(junto.sessoes.map((s) => s.materia)).toEqual(["Cálculo", "Física"]);
    expect(junto.config.foco).toBe(50);
    expect(juntarHistoricos(disco, memoria, new Set(), true).config.foco).toBe(30);
  });
});

describe("roda de números", () => {
  it("setas andam um passo e o valor do meio é gravado", async () => {
    const { RodaDeNumeros } = await import("../features/roadmaps/RodaDeNumeros");
    const mudou = vi.fn();
    render(<RodaDeNumeros rotulo="Foco" sufixo="min" min={1} max={180} valor={25} onChange={mudou} />);
    const roda = screen.getByRole("spinbutton", { name: "Foco" });
    expect(roda).toHaveAttribute("aria-valuenow", "25");
    fireEvent.keyDown(roda, { key: "ArrowDown" });
    fireEvent.keyDown(roda, { key: "ArrowDown" });
    expect(roda).toHaveAttribute("aria-valuetext", "27 min");
    await waitFor(() => expect(mudou).toHaveBeenCalledWith(27));
    expect(mudou).toHaveBeenCalledTimes(1);
  });

  it("meta do dia aceita número digitado, limitado ao máximo", async () => {
    const { RodaDeNumeros } = await import("../features/roadmaps/RodaDeNumeros");
    const mudou = vi.fn();
    render(<RodaDeNumeros rotulo="Meta do dia" min={5} max={720} passo={5} valor={120} digitavel onChange={mudou} />);
    const campo = screen.getByLabelText("Meta do dia: digitar");
    fireEvent.change(campo, { target: { value: "137" } });
    fireEvent.blur(campo);
    expect(mudou).toHaveBeenLastCalledWith(137);
    fireEvent.change(campo, { target: { value: "9000" } });
    fireEvent.blur(campo);
    expect(mudou).toHaveBeenLastCalledWith(720);
    fireEvent.input(campo, { target: { value: "4a5b" } });
    expect(campo).toHaveValue("45");
  });
});
