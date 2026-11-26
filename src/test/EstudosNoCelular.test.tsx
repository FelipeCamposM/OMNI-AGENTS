import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { usarTransporte } from "../mobile/api";
import { Estudos } from "../mobile/Estudos";
import { acoesDoPomodoro, gravacoesDoPomodoro, limparPomodoro } from "../features/roadmaps/pomodoro";
import { gravacoesPendentes } from "../features/roadmaps/armazenamento";
import { limparLoja } from "../features/roadmaps/loja";
import { lerRota, urlDaRota } from "../mobile/rota";

/** Engine falso: as rotas `/roadmaps` sobre um mapa de arquivos (o que o PC gravou). */
function engineFalso() {
  const arquivos = new Map<string, string>();
  const json = (corpo: unknown, status = 200) => new Response(JSON.stringify(corpo), { status, headers: { "Content-Type": "application/json" } });
  const meta = { versao: 1, id: "r-vendas", nome: "Vendas", cor: "#22a06b", icone: "dinheiro", arquivado: false, fase: "ativo", criadoEm: "2026-10-21T10:00:00Z", atualizadoEm: "2026-10-21T10:00:00Z", ia: { cli: "claude" }, resumo: { etapas: 2, concluidas: 0, sequencia: 0, cardsParaHoje: 0, proximaEtapa: "Rapport" } };
  arquivos.set("r-vendas/meta.json", JSON.stringify(meta));
  arquivos.set("r-vendas/plano.json", JSON.stringify({ versao: 1, objetivo: "Vender", visao: "", modulos: [{ id: "m-1", titulo: "Base", descricao: "", etapas: [
    { id: "e-rapport", titulo: "Rapport", objetivo: "Criar sintonia", minutos: 20, tarefa: "Ligue para 2 clientes", fontes: [{ titulo: "Guia", url: "https://exemplo.com/guia", tipo: "artigo", gratis: true }], tarefas: [], preparada: true },
    { id: "e-spin", titulo: "SPIN", objetivo: "", minutos: 25, tarefa: "", fontes: [], tarefas: [] },
  ] }] }));
  arquivos.set("r-vendas/etapas/e-rapport.md", "## Rapport\n\nSintonia antes de vender.");
  // O PC já gravou um pomodoro de Cálculo.
  let pomodoros: string | null = JSON.stringify({ versao: 1, sessoes: [{ id: "p-pc", inicio: "2026-11-24T12:00:00Z", fim: "2026-11-24T12:25:00Z", minutos: 25, previsto: 25, completo: true, materia: "Cálculo" }] });
  const pedidos: string[] = [];
  const responder = async (caminho: string, init: RequestInit) => {
    pedidos.push(`${init.method ?? "GET"} ${caminho}`);
    const url = new URL(caminho, "http://celular");
    if (url.pathname === "/roadmaps/geral") {
      if ((init.method ?? "GET") === "GET") return json({ conteudo: url.searchParams.get("nome") === "pomodoros.json" ? pomodoros : null });
      pomodoros = (JSON.parse(init.body as string) as { conteudo: string }).conteudo;
      return json({ ok: true });
    }
    if (url.pathname === "/roadmaps") return json([{ id: "r-vendas", meta: JSON.parse(arquivos.get("r-vendas/meta.json") as string) }]);
    const [, id, acao] = url.pathname.match(/^\/roadmaps\/([^/]+)\/(arquivo|conversa)$/) ?? [];
    if (acao === "arquivo" && (init.method ?? "GET") === "GET") return json({ conteudo: arquivos.get(`${id}/${url.searchParams.get("nome")}`) ?? null });
    if (acao === "arquivo") { const { nome, conteudo } = JSON.parse(init.body as string) as { nome: string; conteudo: string }; arquivos.set(`${id}/${nome}`, conteudo); return json({ ok: true }); }
    return json({ error: "não existe" }, 404);
  };
  return { arquivos, pedidos, responder, pomodoros: () => pomodoros };
}

let engine: ReturnType<typeof engineFalso>;
beforeEach(() => {
  limparLoja();
  limparPomodoro();
  engine = engineFalso();
  usarTransporte((caminho, init) => engine.responder(caminho, init));
});
afterEach(() => { act(() => limparPomodoro()); });
afterAll(() => usarTransporte((caminho, init) => fetch(caminho, init)));

describe("Estudos no celular", () => {
  it("rotas #/estudos, #/estudos/pomodoro e #/estudos/r/<id>", () => {
    expect(lerRota("#/estudos")).toEqual({ tela: "estudos", secao: "roadmaps" });
    expect(lerRota("#/estudos/pomodoro")).toEqual({ tela: "estudos", secao: "pomodoro" });
    expect(lerRota("#/estudos/analises")).toEqual({ tela: "estudos", secao: "analises" });
    expect(lerRota("#/estudos/r/r-vendas")).toEqual({ tela: "estudos", secao: "roadmaps", roadmap: "r-vendas" });
    expect(lerRota("#/estudos/r/../x")).toEqual({ tela: "inicio" });
    expect(urlDaRota({ tela: "estudos", secao: "roadmaps", roadmap: "r-vendas" })).toMatch(/#\/estudos\/r\/r-vendas$/);
    expect(urlDaRota({ tela: "estudos", secao: "pomodoro" })).toMatch(/#\/estudos\/pomodoro$/);
  });

  it("Pomodoro do celular grava pelo engine sem apagar o que o PC gravou", async () => {
    render(<Estudos secao="pomodoro" roadmap={null} ir={() => undefined} />);
    expect(await screen.findByText("Cálculo")).toBeInTheDocument(); // histórico do PC
    act(() => { acoesDoPomodoro.materia({ nome: "Física" }); acoesDoPomodoro.comecar(); });
    await act(async () => { await new Promise((ok) => setTimeout(ok, 5)); });
    // Fecha o foco antes do tempo, com 1 min+ simulado: entra como interrompido.
    const agora = Date.now;
    Date.now = () => agora() + 2 * 60_000;
    try { act(() => acoesDoPomodoro.pular()); } finally { Date.now = agora; }
    await act(async () => { await gravacoesDoPomodoro(); });
    const salvo = JSON.parse(engine.pomodoros() as string) as { sessoes: { materia: string; completo: boolean }[] };
    expect(salvo.sessoes.map((x) => [x.materia, x.completo])).toEqual([["Cálculo", true], ["Física", false]]);
  });

  it("lista, abre a etapa, conclui, escreve card e caderno: tudo vai para os arquivos do PC", async () => {
    let aberto: string | null = null;
    const { rerender } = render(<Estudos secao="roadmaps" roadmap={null} ir={(_, id) => { aberto = id ?? null; }} />);
    fireEvent.click(await screen.findByRole("button", { name: "Abrir Vendas" }));
    expect(aberto).toBe("r-vendas");
    rerender(<Estudos secao="roadmaps" roadmap="r-vendas" ir={() => undefined} />);
    fireEvent.click(await screen.findByRole("button", { name: "Rapport: Disponível" }));
    expect(await screen.findByText("Sintonia antes de vender.")).toBeInTheDocument();
    // IA fica no PC: sem botões de IA.
    expect(screen.queryByRole("button", { name: /Gerar cards de revisão/ })).toBeNull();
    expect(screen.getByRole("link", { name: "Guia" })).toHaveAttribute("href", "https://exemplo.com/guia");

    fireEvent.click(screen.getByRole("button", { name: "Escrever um card" }));
    fireEvent.change(screen.getByLabelText("Frente do card"), { target: { value: "O que é rapport?" } });
    fireEvent.change(screen.getByLabelText("Verso do card"), { target: { value: "Sintonia" } });
    fireEvent.click(screen.getByRole("button", { name: "Guardar card" }));
    await screen.findByText("Card entrou na revisão de hoje.");
    fireEvent.click(screen.getByRole("button", { name: "Concluir etapa" }));
    await screen.findByText("Etapa concluída");
    await gravacoesPendentes();
    expect(JSON.parse(engine.arquivos.get("r-vendas/progresso.json") as string).etapas["e-rapport"].estado).toBe("concluida");
    expect(JSON.parse(engine.arquivos.get("r-vendas/cards.json") as string).cards[0].frente).toBe("O que é rapport?");
    expect(JSON.parse(engine.arquivos.get("r-vendas/meta.json") as string).resumo).toMatchObject({ concluidas: 1, cardsParaHoje: 1 });

    fireEvent.click(screen.getByRole("button", { name: "← Mapa" }));
    fireEvent.click(await screen.findByRole("button", { name: "Revisar (1)" }));
    const revisao = screen.getByRole("dialog", { name: "Revisão" });
    fireEvent.click(within(revisao).getByRole("button", { name: "Mostrar resposta" }));
    fireEvent.click(within(revisao).getByRole("button", { name: /Bom/ }));
    await within(revisao).findByText("1 feitas");
    fireEvent.click(within(revisao).getByRole("button", { name: "Fechar revisão" }));

    fireEvent.click(screen.getByRole("button", { name: "Caderno" }));
    const caderno = await screen.findByLabelText("Texto do caderno");
    fireEvent.change(caderno, { target: { value: "Aprendi rapport pelo celular." } });
    fireEvent.blur(caderno);
    await gravacoesPendentes();
    expect(engine.arquivos.get("r-vendas/caderno.md")).toContain("pelo celular");
    expect(screen.queryByRole("button", { name: "Pedir revisão à IA" })).toBeNull();
    expect(engine.pedidos.some((p) => p.startsWith("POST /roadmaps/r-vendas/arquivo"))).toBe(true);
  });
});
