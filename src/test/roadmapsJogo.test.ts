import { describe, expect, it } from "vitest";
import { bauAberto, estrelas, metaDoDia, nivel, xp, xpDoNivel } from "../features/roadmaps/jogo";
import { normalizarCards, normalizarPlano, normalizarProgresso } from "../features/roadmaps/normalizar";
import { concluirEtapa } from "../features/roadmaps/progresso";
import { adicionarCards, responder } from "../features/roadmaps/revisao";
import type { Plano } from "../features/roadmaps/tipos";

const plano = normalizarPlano({
  objetivo: "x", minutosPorDia: 15,
  modulos: [{ id: "m-1", titulo: "M", etapas: [
    { id: "e-a", titulo: "A", minutos: 20, tarefas: [{ id: "t-1", texto: "fazer" }] },
    { id: "e-b", titulo: "B", minutos: 30 },
  ] }],
}) as Plano;


describe("jogo", () => {
  it("nível sobe a cada faixa de XP (300, 450, 600…)", () => {
    expect(nivel(0)).toEqual({ nivel: 1, noNivel: 0, paraOProximo: 300, total: 0 });
    expect(nivel(299).nivel).toBe(1);
    expect(nivel(300)).toMatchObject({ nivel: 2, noNivel: 0, paraOProximo: 450 });
    expect(nivel(300 + 450 + 10)).toMatchObject({ nivel: 3, noNivel: 10 });
    expect(xpDoNivel(4)).toBe(750);
  });

  it("XP de etapas, tarefas e revisões; só o de hoje conta na meta", () => {
    const ontem = new Date(2026, 9, 20, 10), hoje = new Date(2026, 9, 21, 10);
    let progresso = concluirEtapa(normalizarProgresso(null), "e-a", ontem);
    progresso = concluirEtapa(progresso, "e-b", hoje);
    let { cards } = adicionarCards(normalizarCards(null), "e-b", [{ frente: "f", verso: "v" }], hoje);
    cards = responder(cards, cards.cards[0].id, 3, hoje);
    const comTarefa: Plano = { ...plano, modulos: [{ ...plano.modulos[0], etapas: plano.modulos[0].etapas.map((e) => ({ ...e, tarefas: e.tarefas.map((t) => ({ ...t, feita: true })) })) }] };
    expect(xp(comTarefa, progresso, cards, hoje)).toEqual({ total: 200 + 300 + 15 + 5, hoje: 300 + 5 });
    expect(metaDoDia(plano)).toBe(150);
    expect(metaDoDia(null)).toBe(250);
  });

  it("estrelas: concluir, prática feita, cards revisados; baú abre com a região completa", () => {
    const agora = new Date(2026, 9, 21);
    const [a, b] = plano.modulos[0].etapas;
    let progresso = normalizarProgresso(null);
    const vazio = normalizarCards(null);
    expect(estrelas(a, progresso, vazio)).toBe(0);
    progresso = concluirEtapa(progresso, a.id, agora);
    expect(estrelas(a, progresso, vazio)).toBe(1);
    const feita = { ...a, tarefas: a.tarefas.map((t) => ({ ...t, feita: true })) };
    expect(estrelas(feita, progresso, vazio)).toBe(3);
    let { cards } = adicionarCards(vazio, a.id, [{ frente: "f", verso: "v" }], agora);
    expect(estrelas(feita, progresso, cards)).toBe(2);
    cards = responder(cards, cards.cards[0].id, 3, agora);
    expect(estrelas(feita, progresso, cards)).toBe(3);
    expect(bauAberto(plano.modulos[0], progresso)).toBe(false);
    expect(bauAberto(plano.modulos[0], concluirEtapa(progresso, b.id, agora))).toBe(true);
  });
});
