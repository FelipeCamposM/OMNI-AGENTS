import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import {
  acoesDoMentor, estadoDoMentor, gravacoesDoMentor, juntarMentor, lerRespostaDoMentor, limparMentor, normalizarMentor, pedidoDoMentor,
  type DadosDoMentor,
} from "../features/roadmaps/mentor";
import { analisarPeriodo } from "../features/roadmaps/analises";
import { estadoDoPomodoro, gravacoesDoPomodoro, limparPomodoro, restante } from "../features/roadmaps/pomodoro";
import { TelaDoMentor } from "../features/roadmaps/TelaDoMentor";
import { limparLoja } from "../features/roadmaps/loja";

const agora = new Date(2026, 10, 25, 14, 30);
const atividade = (id: string, materia: string, extra: object = {}) => ({ id, em: agora.toISOString(), tipo: "questoes", materia, ...extra });

describe("domínio do Mentor", () => {
  it("lê a resposta da IA: registra só o que veio válido, limita acertos e exige resposta", () => {
    const r = lerRespostaDoMentor({
      resposta: "Boa! Agora questões.",
      atividades: [{ tipo: "aula", materia: "TypeScript", minutos: 40, plataforma: "Alura" }, { tipo: "questoes", materia: "TS", questoes: 10, acertos: 99 }, { tipo: "aula" }],
      proximo: { tipo: "questoes", materia: "TypeScript", minutos: 40, quantidade: 30, plataforma: "QConcursos" },
    }, agora.toISOString());
    expect(typeof r).toBe("object");
    if (typeof r === "string") return;
    expect(r.atividades.map((a) => [a.tipo, a.materia, a.minutos, a.acertos])).toEqual([["aula", "TypeScript", 40, undefined], ["questoes", "TS", undefined, 10]]);
    expect(r.proximo).toMatchObject({ minutos: 40, quantidade: 30, plataforma: "QConcursos" });
    expect(lerRespostaDoMentor({ atividades: [] })).toBe("faltou \"resposta\"");
    expect(lerRespostaDoMentor({ resposta: "ok", proximo: { materia: "X" } })).toEqual({ resposta: "ok", atividades: [] });
  });

  it("junta PC e celular pelo id, sem ressuscitar o apagado, e o perfil só vence se mudou aqui", () => {
    const disco = normalizarMentor({ perfil: { contexto: "do celular" }, atividades: [atividade("a1", "Redes"), atividade("a2", "SQL")] });
    const memoria = normalizarMentor({ perfil: { contexto: "do PC" }, atividades: [atividade("a1", "Redes"), atividade("a3", "Java")] });
    const j = juntarMentor(disco, memoria, new Set(["a2"]), false);
    expect(j.atividades.map((a) => a.id).sort()).toEqual(["a1", "a3"]);
    expect(j.perfil.contexto).toBe("do celular");
    expect(juntarMentor(disco, memoria, new Set(), true).perfil.contexto).toBe("do PC");
  });

  it("o pedido leva contexto, plataformas, o feito hoje, o Pomodoro e a fala", () => {
    const dados: DadosDoMentor = normalizarMentor({
      perfil: { contexto: "Concurso TRF, banca FCC", plataformas: [{ nome: "QConcursos", tipo: "questoes" }] },
      atividades: [atividade("a1", "Redes", { questoes: 20, acertos: 15 })],
    });
    const texto = pedidoDoMentor({ agora, dados, roadmaps: [], sessoes: [], cronometro: null, mensagem: "terminei a aula de TypeScript de 40 min" });
    for (const trecho of ["Concurso TRF, banca FCC", "QConcursos (Questões)", "Redes", "20 questões, 15 acertos", "75% de acerto", "Pomodoro agora: parado", "Pessoa: terminei a aula de TypeScript de 40 min"]) {
      expect(texto).toContain(trecho);
    }
  });

  it("atividades entram nas análises com questões e acertos, sem somar minutos ao foco", () => {
    const dia = "2026-11-25";
    const dados = normalizarMentor({ atividades: [atividade("a1", "Redes", { questoes: 20, acertos: 15, minutos: 30 })] });
    const a = analisarPeriodo([], [], dia, 1, dados.atividades);
    expect(a.total).toMatchObject({ minutos: 0, questoes: 20, acertos: 15, atividades: 1 });
    expect(a.materias[0]).toMatchObject({ nome: "Redes", questoes: 20 });
  });
});

describe("tela do Mentor", () => {
  const mockedInvoke = vi.mocked(invoke);
  let mentor: string | null;
  let pedido: { sistema: string; texto: string } | null;

  beforeEach(() => {
    limparMentor(); limparPomodoro(); limparLoja();
    mentor = JSON.stringify({ versao: 1, perfil: { contexto: "Concurso de TI" }, atividades: [], conversa: [] });
    pedido = null;
    mockedInvoke.mockReset();
    mockedInvoke.mockImplementation(async (cmd: string, args?: unknown) => {
      const a = args as { nome?: string; conteudo?: string; pedido?: { sistema: string; texto: string } };
      if (cmd === "roadmaps_ler_geral") return a.nome === "mentor.json" ? mentor : null;
      if (cmd === "roadmaps_gravar_geral") { if (a.nome === "mentor.json") mentor = a.conteudo ?? null; return null; }
      if (cmd === "roadmaps_listar") return [];
      if (cmd === "roadmaps_ia") {
        pedido = a.pedido ?? null;
        return "```json\n" + JSON.stringify({
          resposta: "Ótimo. Agora **30 questões** do mesmo assunto.",
          atividades: [{ tipo: "aula", materia: "TypeScript", minutos: 40 }],
          proximo: { tipo: "questoes", materia: "TypeScript", minutos: 45, quantidade: 30, plataforma: "QConcursos", descricao: "30 questões de TypeScript" },
        }) + "\n```";
      }
      return null;
    });
  });
  afterEach(() => { act(() => { limparMentor(); limparPomodoro(); }); });

  it("conta o que fez, registra a aula, mostra o próximo passo e começa o Pomodoro com esse tempo", async () => {
    render(<TelaDoMentor />);
    await act(async () => { await Promise.resolve(); });
    fireEvent.change(screen.getByLabelText("Mensagem para o Mentor"), { target: { value: "terminei a aula de TypeScript de 40 min" } });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Enviar" })); });
    await act(async () => { await gravacoesDoMentor(); });

    expect(pedido?.texto).toContain("Concurso de TI");
    expect(pedido?.sistema).toContain("PRÓXIMO PASSO");
    expect(screen.getByText("30 questões", { selector: "strong" })).toBeInTheDocument();
    expect(screen.getByText(/Registrado: Aula · TypeScript · 40 min/)).toBeInTheDocument();
    const salvo = JSON.parse(mentor as string) as DadosDoMentor;
    expect(salvo.atividades.map((x) => [x.tipo, x.materia, x.minutos])).toEqual([["aula", "TypeScript", 40]]);
    expect(salvo.conversa.map((m) => m.de)).toEqual(["eu", "ia"]);

    fireEvent.click(screen.getByRole("button", { name: "Começar 45 min" }));
    const { cronometro } = estadoDoPomodoro();
    expect(cronometro.materia).toMatchObject({ nome: "TypeScript", atividade: "questoes" });
    expect(Math.round(restante(cronometro, Date.now()) / 60_000)).toBe(45);
    await act(async () => { await gravacoesDoPomodoro(); });
    expect(estadoDoMentor().erro).toBe("");
  });

  it("registro à mão e apagar", async () => {
    render(<TelaDoMentor />);
    await act(async () => { await Promise.resolve(); });
    fireEvent.click(screen.getByRole("button", { name: "Registrar à mão" }));
    fireEvent.change(screen.getByLabelText("Matéria"), { target: { value: "Redes" } });
    fireEvent.change(screen.getByLabelText("Questões"), { target: { value: "20" } });
    fireEvent.change(screen.getByLabelText("Acertos"), { target: { value: "25" } });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Registrar" })); });
    await act(async () => { await gravacoesDoMentor(); });
    expect(JSON.parse(mentor as string).atividades[0]).toMatchObject({ materia: "Redes", questoes: 20, acertos: 20 });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /Apagar Questões · Redes/ })); });
    await act(async () => { await gravacoesDoMentor(); });
    expect(JSON.parse(mentor as string).atividades).toEqual([]);
  });

  it("cancelar mata o pedido e não mostra erro", async () => {
    let soltar: (v: unknown) => void = () => undefined;
    mockedInvoke.mockImplementation(async (cmd: string, args?: unknown) => {
      const a = args as { nome?: string; conteudo?: string };
      if (cmd === "roadmaps_ler_geral") return a.nome === "mentor.json" ? mentor : null;
      if (cmd === "roadmaps_gravar_geral") { if (a.nome === "mentor.json") mentor = a.conteudo ?? null; return null; }
      if (cmd === "roadmaps_ia") return new Promise((_, falhar) => { soltar = falhar; });
      if (cmd === "roadmaps_ia_cancelar") { soltar("Pedido cancelado."); return null; }
      return null;
    });
    render(<TelaDoMentor />);
    await act(async () => { await Promise.resolve(); });
    fireEvent.change(screen.getByLabelText("Mensagem para o Mentor"), { target: { value: "vou fazer questões" } });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Enviar" })); });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Cancelar" })); });
    await act(async () => { await gravacoesDoMentor(); });
    expect(mockedInvoke).toHaveBeenCalledWith("roadmaps_ia_cancelar", { chave: "mentor" });
    expect(screen.queryByText("Pensando…")).not.toBeInTheDocument();
    expect(estadoDoMentor()).toMatchObject({ pensando: false, erro: "" });
    expect(screen.getByRole("button", { name: "Enviar" })).toBeInTheDocument();
  });
});
