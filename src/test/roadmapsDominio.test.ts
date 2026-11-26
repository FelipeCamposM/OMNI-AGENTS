import { describe, expect, it, vi, beforeEach } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { normalizarCards, normalizarMeta, normalizarPlano, normalizarProgresso, lerConversa, idValido } from "../features/roadmaps/normalizar";
import {
  concluirEtapa, diaLocal, estadosDasEtapas, etapaDeHoje, etapasComProgressoQueSomem, iniciarEtapa, reabrirEtapa, resumir, sequencia,
} from "../features/roadmaps/progresso";
import { adicionarCards, contarParaHoje, filaDeAgora, previa, responder } from "../features/roadmaps/revisao";
import { extrairJson, perguntarJson } from "../features/roadmaps/ia";
import { lerCards, lerPlano, lerRespostaDoPainel, lerTurno, pedidoDaEntrevista, PERGUNTAS_MAXIMAS } from "../features/roadmaps/prompts";
import type { Plano } from "../features/roadmaps/tipos";

const mockedInvoke = vi.mocked(invoke);

const PLANO_DA_IA = {
  objetivo: "Fechar mais vendas B2B",
  visao: "Para quem vende serviço",
  modulos: [
    { titulo: "Fundamentos", etapas: [
      { titulo: "Rapport", minutos: 25, tarefa: "Ligar para 2 clientes", fontes: [
        { titulo: "Guia", url: "https://exemplo.com/guia", tipo: "Artigo", gratis: true },
        { titulo: "Curso pago", url: "https://exemplo.com/curso", tipo: "course", gratis: false },
        { titulo: "Perigoso", url: "javascript:alert(1)", tipo: "artigo" },
      ] },
      { titulo: "Perguntas SPIN" },
    ] },
    { titulo: "Fechamento", etapas: [{ titulo: "Objeções", id: "e-objecoes" }, { titulo: "Rapport" }] },
    { titulo: "Vazio", etapas: [] },
  ],
};

function plano(): Plano {
  const p = normalizarPlano(PLANO_DA_IA);
  if (!p) throw new Error("plano");
  return p;
}

describe("normalizar", () => {
  it("transforma o plano da IA: ids únicos e válidos, fontes seguras, módulo vazio fora", () => {
    const p = plano();
    expect(p.modulos.map((m) => m.titulo)).toEqual(["Fundamentos", "Fechamento"]);
    const ids = p.modulos.flatMap((m) => m.etapas.map((e) => e.id));
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.every(idValido)).toBe(true);
    expect(ids).toContain("e-objecoes");
    const fontes = p.modulos[0].etapas[0].fontes;
    expect(fontes.map((f) => [f.tipo, f.gratis])).toEqual([["artigo", true], ["curso", false]]);
    expect(p.modulos[0].etapas[1].minutos).toBe(20);
  });

  it("plano sem etapa nenhuma é recusado e o embrulho {plano:{...}} é aceito", () => {
    expect(normalizarPlano({ modulos: [{ titulo: "x", etapas: [] }] })).toBeNull();
    expect(normalizarPlano("lixo")).toBeNull();
    expect(normalizarPlano({ plano: PLANO_DA_IA })?.modulos).toHaveLength(2);
  });

  it("arquivo meio quebrado ainda abre", () => {
    expect(normalizarProgresso({ etapas: { "e-1": { estado: "concluida" }, "../x": { estado: "concluida" }, "e-2": { estado: "voando" } }, dias: ["2026-10-20", "2026-10-20", "x"] }))
      .toEqual({ versao: 1, etapas: { "e-1": { estado: "concluida" } }, dias: ["2026-10-20"] });
    expect(normalizarCards({ cards: [{ frente: "a", verso: "b", fsrs: { due: "quebrado" } }, null] }).cards).toEqual([]);
    const meta = normalizarMeta("r-1", { nome: "", cor: "vermelho", icone: "nada", fase: "x" });
    expect([meta.nome, meta.cor, meta.icone, meta.fase, meta.ia.cli]).toEqual(["Roadmap sem nome", "#3d7bff", "livro", "entrevista", "claude"]);
    expect(normalizarMeta("r-2", { cor: "#22a06b" }).cor).toBe("#00c46a");
  });

  it("conversa com a última linha cortada perde só ela", () => {
    const conteudo = `${JSON.stringify({ de: "eu", texto: "oi", em: "2026-10-21T10:00:00Z" })}\n${JSON.stringify({ de: "ia", texto: "olá", em: "2026-10-21T10:00:01Z" })}\n{"de":"eu","tex`;
    expect(lerConversa(conteudo).map((m) => m.texto)).toEqual(["oi", "olá"]);
  });
});

describe("trilha e sequência", () => {
  it("só a próxima etapa fica disponível; as seguintes, bloqueadas", () => {
    const p = plano();
    const [a, b, c] = p.modulos.flatMap((m) => m.etapas);
    let prog = normalizarProgresso(null);
    expect(estadosDasEtapas(p, prog)[a.id]).toBe("disponivel");
    expect(estadosDasEtapas(p, prog)[b.id]).toBe("bloqueada");
    prog = iniciarEtapa(prog, a.id, new Date(2026, 9, 21, 9));
    expect(estadosDasEtapas(p, prog)[a.id]).toBe("andamento");
    expect(etapaDeHoje(p, prog)?.id).toBe(a.id);
    prog = concluirEtapa(prog, a.id, new Date(2026, 9, 21, 10));
    expect(estadosDasEtapas(p, prog)[b.id]).toBe("disponivel");
    expect(estadosDasEtapas(p, prog)[c.id]).toBe("bloqueada");
    expect(etapaDeHoje(p, prog)?.id).toBe(b.id);
    expect(prog.dias).toEqual(["2026-10-21"]);
    expect(concluirEtapa(prog, a.id, new Date())).toBe(prog);
    const reaberto = reabrirEtapa(prog, a.id);
    expect(reaberto.etapas[a.id].estado).toBe("andamento");
  });

  it("sequência conta até hoje ou ontem e quebra com um dia sem estudo", () => {
    expect(sequencia(["2026-10-19", "2026-10-20", "2026-10-21"], "2026-10-21")).toBe(3);
    expect(sequencia(["2026-10-19", "2026-10-20"], "2026-10-21")).toBe(2);
    expect(sequencia(["2026-10-18", "2026-10-20"], "2026-10-21")).toBe(1);
    expect(sequencia(["2026-10-18"], "2026-10-21")).toBe(0);
    expect(sequencia(["2026-02-28", "2026-03-01"], "2026-03-01")).toBe(2);
    expect(diaLocal(new Date(2026, 0, 5, 23, 59))).toBe("2026-01-05");
  });

  it("reajuste que apagaria etapa já começada é apontado", () => {
    const p = plano();
    const [a] = p.modulos.flatMap((m) => m.etapas);
    const prog = iniciarEtapa(normalizarProgresso(null), a.id, new Date());
    const novo: Plano = { ...p, modulos: p.modulos.map((m) => ({ ...m, etapas: m.etapas.filter((e) => e.id !== a.id) })) };
    expect(etapasComProgressoQueSomem(p, novo, prog).map((e) => e.id)).toEqual([a.id]);
    expect(etapasComProgressoQueSomem(p, p, prog)).toEqual([]);
  });

  it("resumo para a lista", () => {
    const p = plano();
    const [a] = p.modulos.flatMap((m) => m.etapas);
    const agora = new Date(2026, 9, 21, 12);
    const prog = concluirEtapa(normalizarProgresso(null), a.id, agora);
    const r = resumir(p, prog, normalizarCards(null), agora);
    expect(r).toMatchObject({ etapas: 4, concluidas: 1, sequencia: 1, cardsParaHoje: 0, ultimoDia: "2026-10-21", proximaEtapa: "Perguntas SPIN" });
  });
});

describe("revisão FSRS", () => {
  it("card novo entra na fila; bom manda para depois; errei volta logo; duplicado não entra", () => {
    const agora = new Date(2026, 9, 21, 9);
    let { cards, adicionados } = adicionarCards(normalizarCards(null), "e-1", [{ frente: "O que é SPIN?", verso: "Situação, Problema, Implicação, Necessidade" }, { frente: "o que é spin?", verso: "situação, problema, implicação, necessidade" }, { frente: "", verso: "x" }], agora);
    expect(adicionados).toBe(1);
    expect(filaDeAgora(cards, agora)).toHaveLength(1);
    const id = cards.cards[0].id;
    const rotulos = previa(cards.cards[0], agora);
    expect(Object.keys(rotulos)).toEqual(["1", "2", "3", "4"]);
    cards = responder(cards, id, 4, agora);
    expect(filaDeAgora(cards, agora)).toHaveLength(0);
    expect(Date.parse(cards.cards[0].fsrs.due)).toBeGreaterThan(agora.getTime() + 24 * 3600_000);
    expect(cards.revisoes).toEqual([{ cardId: id, nota: 4, em: agora.toISOString() }]);
    // Passa pelo disco (JSON) e volta igual: o próximo agendamento continua de onde parou.
    const relido = normalizarCards(JSON.parse(JSON.stringify(cards)));
    expect(relido.cards[0].fsrs).toEqual(cards.cards[0].fsrs);
    const depois = new Date(Date.parse(relido.cards[0].fsrs.due) + 1000);
    const errou = responder(relido, id, 1, depois);
    expect(errou.cards[0].fsrs.lapses).toBe(1);
    expect(Date.parse(errou.cards[0].fsrs.due) - depois.getTime()).toBeLessThan(24 * 3600_000);
    expect(contarParaHoje(errou, depois)).toBeGreaterThanOrEqual(0);
  });
});

describe("respostas da IA", () => {
  it("acha o JSON com cerca, texto em volta e chaves dentro de strings", () => {
    expect(extrairJson("Claro!\n```json\n{\"tipo\":\"pronto\",\"resumo\":\"a {b}\"}\n```\nAbraço")).toEqual({ tipo: "pronto", resumo: "a {b}" });
    expect(extrairJson("antes {\"a\":{\"b\":\"}\"}} depois")).toEqual({ a: { b: "}" } });
    expect(extrairJson("sem json")).toBeNull();
    // Markdown com ``` dentro do JSON: a cerca engana, o texto inteiro resolve.
    const comCodigo = `{"resumo":"## Título\\n\`\`\`js\\nx()\\n\`\`\`\\nfim"}`;
    expect(extrairJson(comCodigo)).toEqual({ resumo: "## Título\n```js\nx()\n```\nfim" });
  });

  it("turno da entrevista e limite de perguntas", () => {
    expect(lerTurno({ tipo: "pergunta", pergunta: "Qual seu nível?", opcoes: ["Iniciante", 3, ""] })).toEqual({ tipo: "pergunta", pergunta: "Qual seu nível?", opcoes: ["Iniciante"] });
    expect(lerTurno({ tipo: "pronto", resumo: "ok" })).toEqual({ tipo: "pronto", resumo: "ok" });
    expect(typeof lerTurno({ tipo: "pergunta" })).toBe("string");
    const mensagens = Array.from({ length: PERGUNTAS_MAXIMAS }, () => ({ de: "ia" as const, texto: "?", em: "" }));
    expect(pedidoDaEntrevista({ versao: 1, pedido: "vendas", mensagens })).toContain("responda com \"pronto\" agora");
  });

  it("cards, plano e blocos do painel", () => {
    expect(lerCards({ cards: [{ frente: "a", verso: "b" }, { frente: "c" }] })).toEqual([{ frente: "a", verso: "b" }]);
    expect(typeof lerCards({})).toBe("string");
    expect(typeof lerPlano({})).toBe("string");
    const resposta = `Você está indo bem.\n\`\`\`plano\n${JSON.stringify(PLANO_DA_IA)}\n\`\`\`\n\`\`\`tarefas\n{"tarefas":[{"texto":"Grave um pitch"}]}\n\`\`\``;
    const lida = lerRespostaDoPainel(resposta);
    expect(lida.texto).toBe("Você está indo bem.");
    expect(lida.plano?.modulos).toHaveLength(2);
    expect(lida.tarefas).toEqual(["Grave um pitch"]);
    expect(lerRespostaDoPainel("```plano\n{quebrado\n```").texto).toBe("(sem resposta)");
  });

  describe("pedido com correção", () => {
    beforeEach(() => mockedInvoke.mockReset());
    const pedido = { chave: "t", ia: { cli: "claude" as const }, sistema: "S", texto: "T", web: false };

    it("formato errado volta uma vez com o erro e a segunda resposta vale", async () => {
      mockedInvoke.mockResolvedValueOnce("não sei").mockResolvedValueOnce("{\"cards\":[{\"frente\":\"a\",\"verso\":\"b\"}]}");
      await expect(perguntarJson(pedido, lerCards)).resolves.toEqual([{ frente: "a", verso: "b" }]);
      expect(mockedInvoke).toHaveBeenCalledTimes(2);
      const segunda = mockedInvoke.mock.calls[1][1] as { pedido: { texto: string } };
      expect(segunda.pedido.texto).toContain("Sua resposta anterior não serviu");
    });

    it("duas respostas ruins viram erro claro; erro da CLI passa adiante", async () => {
      mockedInvoke.mockResolvedValue("nada");
      await expect(perguntarJson(pedido, lerCards)).rejects.toThrow("formato esperado");
      mockedInvoke.mockReset();
      mockedInvoke.mockRejectedValueOnce("Nenhuma conta do Codex com login");
      await expect(perguntarJson(pedido, lerCards)).rejects.toThrow("Nenhuma conta do Codex com login");
    });
  });
});
