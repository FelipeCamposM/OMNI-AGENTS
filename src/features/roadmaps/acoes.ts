/**
 * Fork (Roadmaps): o que cada botão faz. Os pedidos de IA leem o roadmap da loja na hora de aplicar
 * a resposta (não no começo): o que a pessoa marcou enquanto a IA pensava não se perde.
 */
import { anexarNaConversa, criarRoadmap, gravarCaderno, gravarResumoDaEtapa, lerCaderno, lerConversaDoPainel, lerResumoDaEtapa } from "./armazenamento";
import { perguntar, perguntarJson } from "./ia";
import { acrescentarNaConversa, carregar, comTarefa, mudar, registrarNovo, roadmap } from "./loja";
import { normalizarCards, normalizarEntrevista, normalizarProgresso } from "./normalizar";
import { concluirEtapa, diaLocal, estadosDasEtapas, etapasEmOrdem, iniciarEtapa, marcarDia, reabrirEtapa, resumir } from "./progresso";
import {
  SISTEMA_DA_REVISAO_DO_CADERNO, SISTEMA_DOS_CARDS_DE_TUDO, lerCardsComEtapa, pedidoDaRevisaoDoCaderno, pedidoDeCardsDeTudo,
  SISTEMA_DA_ENTREVISTA, SISTEMA_DA_ETAPA, SISTEMA_DAS_TAREFAS, SISTEMA_DO_PAINEL, SISTEMA_DO_PLANO, SISTEMA_DOS_CARDS,
  lerCards, lerEtapaPreparada, lerPlano, lerRespostaDoPainel, lerTarefas, lerTurno,
  pedidoDaEntrevista, pedidoDaEtapa, pedidoDeCards, pedidoDeTarefas, pedidoDoPainel, pedidoDoPlano, perfilDaEntrevista,
  type RespostaDoPainel,
} from "./prompts";
import { adicionarCards, responder, type Nota } from "./revisao";
import { normalizarTarefas } from "./normalizar";
import type { Etapa, IaEscolhida, MensagemDoPainel, MetaDoRoadmap, Plano } from "./tipos";

export const chaves = {
  cardsDeTudo: (id: string) => `cardsdetudo:${id}`,
  caderno: (id: string) => `caderno:${id}`,
  entrevista: (id: string) => `entrevista:${id}`,
  plano: (id: string) => `plano:${id}`,
  etapa: (id: string, etapaId: string) => `etapa:${id}:${etapaId}`,
  cards: (id: string, etapaId: string) => `cards:${id}:${etapaId}`,
  tarefas: (id: string, etapaId: string) => `tarefas:${id}:${etapaId}`,
  painel: (id: string) => `painel:${id}`,
};

function acharEtapa(plano: Plano | null, etapaId: string): Etapa {
  const etapa = plano ? etapasEmOrdem(plano).find((e) => e.id === etapaId) : undefined;
  if (!etapa) throw new Error("Essa etapa não existe mais no plano");
  return etapa;
}

function trocarEtapa(plano: Plano, etapaId: string, fn: (e: Etapa) => Etapa): Plano {
  return { ...plano, modulos: plano.modulos.map((m) => ({ ...m, etapas: m.etapas.map((e) => (e.id === etapaId ? fn(e) : e)) })) };
}

export async function novoRoadmap(dados: { nome: string; cor: string; icone: string; ia: IaEscolhida; pedido: string }, agora = new Date()): Promise<MetaDoRoadmap> {
  const meta = await criarRoadmap(dados, agora);
  const entrevista = { ...normalizarEntrevista(null), pedido: dados.pedido.trim().slice(0, 2000) };
  registrarNovo(meta, { meta, entrevista, plano: null, progresso: normalizarProgresso(null), cards: normalizarCards(null), somenteLeitura: false });
  await mudar(meta.id, ["entrevista"], (r) => ({ ...r, entrevista }));
  return meta;
}

/** Manda a resposta da pessoa (ou nada, para a primeira pergunta) e grava a próxima pergunta. "Pronto" monta o plano. */
export async function responderEntrevista(id: string, resposta?: string, agora = () => new Date()): Promise<void> {
  const r = await carregar(id);
  if (resposta?.trim()) {
    await mudar(id, ["entrevista"], (x) => ({ ...x, entrevista: { ...x.entrevista, mensagens: [...x.entrevista.mensagens, { de: "eu", texto: resposta.trim().slice(0, 4000), em: agora().toISOString() }] } }));
  }
  const turno = await comTarefa(chaves.entrevista(id), "Pensando na próxima pergunta…", () =>
    perguntarJson({ chave: chaves.entrevista(id), ia: r.meta.ia, sistema: SISTEMA_DA_ENTREVISTA, texto: pedidoDaEntrevista(roadmap(id)?.entrevista ?? r.entrevista), web: false }, lerTurno));
  if (turno.tipo === "pergunta") {
    await mudar(id, ["entrevista"], (x) => ({ ...x, entrevista: { ...x.entrevista, mensagens: [...x.entrevista.mensagens, { de: "ia", texto: turno.pergunta, ...(turno.opcoes.length ? { opcoes: turno.opcoes } : {}), em: agora().toISOString() }] } }));
    return;
  }
  if (turno.resumo) {
    await mudar(id, ["entrevista"], (x) => ({ ...x, entrevista: { ...x.entrevista, mensagens: [...x.entrevista.mensagens, { de: "ia", texto: turno.resumo, em: agora().toISOString() }] } }));
  }
  await gerarPlano(id);
}

/** Monta o plano da entrevista (ou reajusta a proposta/plano com `ajuste`) e deixa como proposta para revisar. */
export async function gerarPlano(id: string, ajuste?: string): Promise<void> {
  const r = await carregar(id);
  const base = ajuste ? (r.entrevista.proposta ?? r.plano ?? undefined) : undefined;
  const plano = await comTarefa(chaves.plano(id), ajuste ? "Reajustando o caminho…" : "Pesquisando fontes e montando o caminho…", () =>
    perguntarJson({
      chave: chaves.plano(id), ia: r.meta.ia, sistema: SISTEMA_DO_PLANO, web: true,
      texto: pedidoDoPlano(roadmap(id)?.entrevista ?? r.entrevista, ajuste && base ? { pedido: ajuste, atual: base, progresso: r.progresso } : undefined),
    }, lerPlano));
  await mudar(id, ["entrevista", "meta"], (x) => ({
    ...x,
    entrevista: { ...x.entrevista, proposta: plano },
    meta: { ...x.meta, fase: x.meta.fase === "ativo" ? "ativo" : "plano" },
  }));
}

/** Aceita a proposta: vira o plano da trilha. Progresso de etapas que continuam é mantido. */
export async function aceitarPlano(id: string): Promise<void> {
  await mudar(id, ["entrevista", "plano", "progresso", "meta"], (x) => {
    if (!x.entrevista.proposta) return x;
    const plano = x.entrevista.proposta;
    const { proposta: _aceita, ...entrevista } = x.entrevista;
    return { ...x, plano, entrevista, meta: { ...x.meta, fase: "ativo" } };
  });
}

export async function descartarProposta(id: string): Promise<void> {
  await mudar(id, ["entrevista", "meta"], (x) => {
    const { proposta: _descartada, ...entrevista } = x.entrevista;
    return { ...x, entrevista, meta: { ...x.meta, fase: x.plano ? "ativo" : "entrevista" } };
  });
}

/** Aplica um plano novo vindo do painel (já confirmado pela pessoa). */
export async function aplicarPlano(id: string, plano: Plano): Promise<void> {
  await mudar(id, ["plano", "meta"], (x) => ({ ...x, plano, meta: { ...x.meta, fase: "ativo" } }));
}

export async function comecarEtapa(id: string, etapaId: string, agora = new Date()) {
  await mudar(id, ["progresso"], (x) => ({ ...x, progresso: iniciarEtapa(x.progresso, etapaId, agora) }), agora);
}

export async function concluir(id: string, etapaId: string, agora = new Date()) {
  await mudar(id, ["progresso"], (x) => ({ ...x, progresso: concluirEtapa(x.progresso, etapaId, agora) }), agora);
}

export async function reabrir(id: string, etapaId: string) {
  await mudar(id, ["progresso"], (x) => ({ ...x, progresso: reabrirEtapa(x.progresso, etapaId) }));
}

export async function marcarTarefa(id: string, etapaId: string, tarefaId: string, feita: boolean) {
  await mudar(id, ["plano"], (x) => (x.plano ? { ...x, plano: trocarEtapa(x.plano, etapaId, (e) => ({ ...e, tarefas: e.tarefas.map((t) => (t.id === tarefaId ? { ...t, feita } : t)) })) } : x));
}

export async function adicionarTarefas(id: string, etapaId: string, textos: string[]) {
  await mudar(id, ["plano"], (x) => {
    if (!x.plano) return x;
    return { ...x, plano: trocarEtapa(x.plano, etapaId, (e) => {
      const usados = new Set([...etapasEmOrdem(x.plano as Plano).flatMap((et) => et.tarefas.map((t) => t.id))]);
      const existentes = new Set(e.tarefas.map((t) => t.texto.toLowerCase()));
      const novas = normalizarTarefas(textos.filter((t) => !existentes.has(t.toLowerCase())), usados);
      return { ...e, tarefas: [...e.tarefas, ...novas].slice(0, 60) };
    }) };
  });
}

/** Escreve o resumo da etapa (`etapas/<id>.md`) e completa tarefa e fontes. */
export async function prepararEtapa(id: string, etapaId: string): Promise<void> {
  const r = await carregar(id);
  const etapa = acharEtapa(r.plano, etapaId);
  const preparada = await comTarefa(chaves.etapa(id, etapaId), "Pesquisando e escrevendo a etapa…", () =>
    perguntarJson({ chave: chaves.etapa(id, etapaId), ia: r.meta.ia, sistema: SISTEMA_DA_ETAPA, web: true, texto: pedidoDaEtapa(r.plano as Plano, etapa, perfilDaEntrevista(r.entrevista)) }, lerEtapaPreparada));
  await gravarResumoDaEtapa(id, etapaId, preparada.resumo);
  await mudar(id, ["plano"], (x) => (x.plano ? { ...x, plano: trocarEtapa(x.plano, etapaId, (e) => {
    const urls = new Set(e.fontes.map((f) => f.url));
    return { ...e, preparada: true, tarefa: e.tarefa || preparada.tarefa, fontes: [...e.fontes, ...preparada.fontes.filter((f) => !urls.has(f.url))].slice(0, 12) };
  }) } : x));
}

export async function gerarCardsDaEtapa(id: string, etapaId: string, agora = () => new Date()): Promise<number> {
  const r = await carregar(id);
  const etapa = acharEtapa(r.plano, etapaId);
  const resumo = await lerResumoDaEtapa(id, etapaId).catch(() => null);
  const novos = await comTarefa(chaves.cards(id, etapaId), "Criando cards…", () =>
    perguntarJson({ chave: chaves.cards(id, etapaId), ia: r.meta.ia, sistema: SISTEMA_DOS_CARDS, web: false, texto: pedidoDeCards(r.plano as Plano, etapa, resumo) }, lerCards));
  let adicionados = 0;
  await mudar(id, ["cards"], (x) => { const feito = adicionarCards(x.cards, etapaId, novos, agora()); adicionados = feito.adicionados; return { ...x, cards: feito.cards }; });
  return adicionados;
}

export async function gerarTarefasDaEtapa(id: string, etapaId: string): Promise<void> {
  const r = await carregar(id);
  const etapa = acharEtapa(r.plano, etapaId);
  const resumo = await lerResumoDaEtapa(id, etapaId).catch(() => null);
  const textos = await comTarefa(chaves.tarefas(id, etapaId), "Criando exercícios…", () =>
    perguntarJson({ chave: chaves.tarefas(id, etapaId), ia: r.meta.ia, sistema: SISTEMA_DAS_TAREFAS, web: false, texto: pedidoDeTarefas(r.plano as Plano, etapa, resumo) }, lerTarefas));
  await adicionarTarefas(id, etapaId, textos);
}

export async function revisar(id: string, cardId: string, nota: Nota, agora = new Date()) {
  await mudar(id, ["cards", "progresso"], (x) => ({ ...x, cards: responder(x.cards, cardId, nota, agora), progresso: marcarDia(x.progresso, diaLocal(agora)) }), agora);
}

/** Painel ao lado: grava a pergunta, pede, grava a resposta. Devolve o que veio (plano/tarefas para confirmar). */
export async function mensagemNoPainel(id: string, texto: string, etapaId: string | undefined, historico: MensagemDoPainel[], agora = () => new Date()): Promise<RespostaDoPainel & { mensagem: MensagemDoPainel; pergunta: MensagemDoPainel }> {
  const r = await carregar(id);
  const pergunta: MensagemDoPainel = { de: "eu", texto: texto.trim().slice(0, 8000), em: agora().toISOString(), ...(etapaId ? { etapaId } : {}) };
  await anexarNaConversa(id, pergunta);
  const etapa = etapaId && r.plano ? etapasEmOrdem(r.plano).find((e) => e.id === etapaId) : undefined;
  const bruto = await comTarefa(chaves.painel(id), "Pensando…", () =>
    perguntar({ chave: chaves.painel(id), ia: r.meta.ia, sistema: SISTEMA_DO_PAINEL, web: true, texto: `${perfilDaEntrevista(r.entrevista)}\n\n${pedidoDoPainel(roadmap(id)?.plano ?? r.plano, roadmap(id)?.progresso ?? r.progresso, etapa, historico, pergunta.texto)}` }));
  const lida = lerRespostaDoPainel(bruto);
  const mensagem: MensagemDoPainel = { de: "ia", texto: lida.texto, em: agora().toISOString(), ...(etapaId ? { etapaId } : {}) };
  await anexarNaConversa(id, mensagem);
  return { ...lida, mensagem, pergunta };
}

export { lerConversaDoPainel, lerResumoDaEtapa };

/** Recalcula o resumo (para abrir a lista com o "cards para hoje" do dia certo). */
export function resumoDeAgora(id: string, agora = new Date()) {
  const r = roadmap(id);
  return r ? resumir(r.plano, r.progresso, r.cards, agora) : undefined;
}

/** Cards de tudo que já foi estudado (concluídas e em andamento), de uma vez. Devolve quantos entraram. */
export async function gerarCardsDeTudo(id: string, agora = () => new Date()): Promise<number> {
  const r = await carregar(id);
  if (!r.plano) throw new Error("Este roadmap ainda não tem caminho");
  const estados = estadosDasEtapas(r.plano, r.progresso);
  const etapas = etapasEmOrdem(r.plano).filter((e) => estados[e.id] === "concluida" || estados[e.id] === "andamento");
  if (etapas.length === 0) throw new Error("Comece ou conclua uma etapa antes: os cards saem do que você já estudou");
  const estudadas = await Promise.all(etapas.map(async (etapa) => ({ etapa, resumo: await lerResumoDaEtapa(id, etapa.id).catch(() => null) })));
  const novos = await comTarefa(chaves.cardsDeTudo(id), "Criando cards de tudo que você estudou…", () =>
    perguntarJson({ chave: chaves.cardsDeTudo(id), ia: r.meta.ia, sistema: SISTEMA_DOS_CARDS_DE_TUDO, web: false, texto: pedidoDeCardsDeTudo(r.plano as Plano, estudadas, r.cards.cards) },
      lerCardsComEtapa(new Set(etapas.map((e) => e.id)))));
  let adicionados = 0;
  await mudar(id, ["cards"], (x) => {
    let cards = x.cards;
    for (const etapa of [...new Set(novos.map((c) => c.etapa))]) {
      const feito = adicionarCards(cards, etapa, novos.filter((c) => c.etapa === etapa), agora());
      cards = feito.cards; adicionados += feito.adicionados;
    }
    return { ...x, cards };
  });
  return adicionados;
}

/** Card escrito à mão (no computador ou no celular). */
export async function criarCard(id: string, etapaId: string, frente: string, verso: string, agora = new Date()): Promise<boolean> {
  let entrou = false;
  await mudar(id, ["cards"], (x) => { const feito = adicionarCards(x.cards, etapaId, [{ frente: frente.trim(), verso: verso.trim() }], agora); entrou = feito.adicionados > 0; return { ...x, cards: feito.cards }; }, agora);
  return entrou;
}

export { lerCaderno, gravarCaderno };

/** A IA lê o caderno e devolve os toques. A revisão fica gravada na conversa do painel. */
export async function revisarCaderno(id: string, agora = () => new Date()): Promise<string> {
  const r = await carregar(id);
  const caderno = (await lerCaderno(id)) ?? "";
  if (caderno.trim().length < 20) throw new Error("Escreva um pouco mais no caderno antes de pedir a revisão");
  const resposta = await comTarefa(chaves.caderno(id), "Lendo o seu caderno…", () =>
    perguntar({ chave: chaves.caderno(id), ia: r.meta.ia, sistema: SISTEMA_DA_REVISAO_DO_CADERNO, web: false,
      texto: pedidoDaRevisaoDoCaderno(roadmap(id)?.plano ?? r.plano, roadmap(id)?.progresso ?? r.progresso, caderno, perfilDaEntrevista(r.entrevista)) }));
  const texto = resposta.trim() || "(sem resposta)";
  const pedido: MensagemDoPainel = { de: "eu", texto: "Revise o meu caderno.", em: agora().toISOString() };
  const revisao: MensagemDoPainel = { de: "ia", texto, em: agora().toISOString() };
  await anexarNaConversa(id, pedido);
  await anexarNaConversa(id, revisao);
  acrescentarNaConversa(id, pedido, revisao);
  return texto;
}
