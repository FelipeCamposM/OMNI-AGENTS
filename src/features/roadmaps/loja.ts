/**
 * Fork (Roadmaps): uma cópia em memória de cada roadmap aberto, fonte única para as telas e para
 * os pedidos de IA que terminam com a tela fechada. Toda mudança passa por `mudar`, que aplica na
 * memória, recalcula o resumo da lista e grava só os arquivos afetados.
 *
 * Não há timer nem poll: quem não está inscrito não custa nada.
 */
import { useSyncExternalStore } from "react";
import {
  abrirRoadmap, gravarCards, gravarEntrevista, gravarMeta, gravarPlano, gravarProgresso, listarRoadmaps, ordenarRoadmaps,
  temGravacaoPendente, type RoadmapAberto,
} from "./armazenamento";
import { resumir } from "./progresso";
import type { MensagemDoPainel, MetaDoRoadmap } from "./tipos";

export type ArquivoDaLoja = "meta" | "entrevista" | "plano" | "progresso" | "cards";

const abertos = new Map<string, RoadmapAberto>();
const carregando = new Map<string, Promise<RoadmapAberto>>();
const erros = new Map<string, string>();
let lista: MetaDoRoadmap[] | null = null;
let erroDaLista = "";
/** Pedidos de IA rodando: chave → o que está fazendo. */
const tarefas = new Map<string, string>();
const ouvintes = new Set<() => void>();
let fotografia = 0;

function avisar() { fotografia++; for (const ouvinte of ouvintes) ouvinte(); }
function inscrever(ouvinte: () => void) { ouvintes.add(ouvinte); return () => { ouvintes.delete(ouvinte); }; }
const versaoAtual = () => fotografia;

/** Re-renderiza quando qualquer coisa da loja muda (a loja é pequena; o React compara o resto). */
export function useLoja(): number {
  return useSyncExternalStore(inscrever, versaoAtual, versaoAtual);
}

export function roadmap(id: string): RoadmapAberto | undefined { return abertos.get(id); }
export function erroDoRoadmap(id: string): string | undefined { return erros.get(id); }
export function listaAtual(): MetaDoRoadmap[] | null { return lista; }
export function erroDaListaAtual(): string { return erroDaLista; }
export function tarefaEmAndamento(chave: string): string | undefined { return tarefas.get(chave); }

export async function carregarLista(): Promise<void> {
  try {
    lista = await listarRoadmaps();
    // O que está aberto em memória é mais novo que o disco (gravação ainda na fila).
    lista = lista.map((m) => abertos.get(m.id)?.meta ?? m);
    erroDaLista = "";
  } catch (erro) {
    erroDaLista = erro instanceof Error ? erro.message : String(erro);
  }
  avisar();
}

export function carregar(id: string): Promise<RoadmapAberto> {
  const pronto = abertos.get(id);
  if (pronto) return Promise.resolve(pronto);
  const pendente = carregando.get(id);
  if (pendente) return pendente;
  const promessa = abrirRoadmap(id).then((r) => {
    abertos.set(id, r);
    erros.delete(id);
    return r;
  }).catch((erro: unknown) => {
    erros.set(id, erro instanceof Error ? erro.message : String(erro));
    throw erro;
  }).finally(() => { carregando.delete(id); avisar(); });
  carregando.set(id, promessa);
  return promessa;
}

/**
 * Troca a memória pelo disco (o celular pode ter mudado algo). Não mexe com gravação na fila nem com
 * pedido de IA rodando para este roadmap: a memória é mais nova nesses casos.
 */
export async function recarregar(id: string): Promise<void> {
  if (!abertos.has(id) || temGravacaoPendente(id) || [...tarefas.keys()].some((c) => c.includes(`:${id}`))) return;
  try {
    const novo = await abrirRoadmap(id);
    if (temGravacaoPendente(id)) return;
    abertos.set(id, novo);
    if (lista) lista = lista.map((m) => (m.id === id ? novo.meta : m));
    // Conversa e caderno lidos de novo do disco na próxima vez que aparecerem.
    lembrancas.delete(`conversa:${id}`);
    lembrancas.delete(`caderno:${id}`);
    avisar();
  } catch { /* fica com a memória */ }
}

/** Entra na lista (no começo) um roadmap recém-criado. */
export function registrarNovo(meta: MetaDoRoadmap, r: RoadmapAberto) {
  abertos.set(meta.id, r);
  lista = [meta, ...(lista ?? []).filter((m) => m.id !== meta.id)];
  avisar();
}

/**
 * Aplica `fn` no roadmap em memória e grava os arquivos de `afetados`. Mudou plano, progresso ou
 * cards: o resumo da lista é recalculado e o `meta.json` vai junto.
 */
export async function mudar(id: string, afetados: ArquivoDaLoja[], fn: (r: RoadmapAberto) => RoadmapAberto, agora = new Date()): Promise<RoadmapAberto> {
  const atual = abertos.get(id) ?? await carregar(id);
  if (atual.somenteLeitura) throw new Error("Este roadmap foi salvo por uma versão mais nova do app; atualize para mexer nele.");
  let novo = fn(atual);
  const arquivos = new Set(afetados);
  if (arquivos.has("plano") || arquivos.has("progresso") || arquivos.has("cards") || arquivos.has("meta")) {
    novo = { ...novo, meta: { ...novo.meta, resumo: resumir(novo.plano, novo.progresso, novo.cards, agora), atualizadoEm: agora.toISOString() } };
    arquivos.add("meta");
  }
  abertos.set(id, novo);
  if (lista) lista = lista.map((m) => (m.id === id ? novo.meta : m));
  avisar();
  const gravacoes: Promise<void>[] = [];
  if (arquivos.has("entrevista")) gravacoes.push(gravarEntrevista(id, novo.entrevista));
  if (arquivos.has("plano") && novo.plano) gravacoes.push(gravarPlano(id, novo.plano));
  if (arquivos.has("progresso")) gravacoes.push(gravarProgresso(id, novo.progresso));
  if (arquivos.has("cards")) gravacoes.push(gravarCards(id, novo.cards));
  if (arquivos.has("meta")) gravacoes.push(gravarMeta(novo.meta));
  await Promise.all(gravacoes);
  return novo;
}

export async function mudarMeta(id: string, mudanca: Partial<Pick<MetaDoRoadmap, "nome" | "cor" | "icone" | "arquivado" | "ia">>) {
  await mudar(id, ["meta"], (r) => ({ ...r, meta: { ...r.meta, ...mudanca } }));
}

/** Nova ordem da lista (só os ids que existem; arquivados mantêm a posição relativa). */
export async function reordenar(ids: string[]) {
  if (!lista) return;
  const porId = new Map(lista.map((m) => [m.id, m]));
  const resto = lista.filter((m) => !ids.includes(m.id));
  lista = [...ids.map((i) => porId.get(i)).filter((m): m is MetaDoRoadmap => m !== undefined), ...resto];
  avisar();
  await ordenarRoadmaps(lista.map((m) => m.id));
}

/** Marca um pedido de IA como rodando enquanto `fn` não termina (a tela mostra e deixa cancelar). */
export async function comTarefa<T>(chave: string, rotulo: string, fn: () => Promise<T>): Promise<T> {
  if (tarefas.has(chave)) throw new Error("Já tem um pedido em andamento aqui; espere ele terminar");
  tarefas.set(chave, rotulo);
  avisar();
  try { return await fn(); }
  finally { tarefas.delete(chave); avisar(); }
}

/**
 * Lembranças das telas nesta execução do app (roadmap aberto, etapa ao lado, proposta não aplicada,
 * conversa já lida). Não vão para o disco: o que importa já está nos arquivos.
 */
const lembrancas = new Map<string, unknown>();
export function lembranca<T>(chave: string): T | undefined { return lembrancas.get(chave) as T | undefined; }
export function lembrar(chave: string, valor: unknown) {
  if (lembrancas.get(chave) === valor) return;
  if (valor === undefined) lembrancas.delete(chave); else lembrancas.set(chave, valor);
  avisar();
}

/** Mensagens novas na conversa do painel já lida (a revisão do caderno também escreve nela). */
export function acrescentarNaConversa(id: string, ...mensagens: MensagemDoPainel[]) {
  const atual = lembranca<MensagemDoPainel[]>(`conversa:${id}`);
  if (atual) lembrar(`conversa:${id}`, [...atual, ...mensagens]);
}

/** Só para testes (e o "reabrir o app" deles): começa do zero. */
export function limparLoja() {
  abertos.clear(); carregando.clear(); erros.clear(); tarefas.clear(); lembrancas.clear(); lista = null; erroDaLista = ""; avisar();
}
