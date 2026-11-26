/**
 * Fork (Roadmaps): leitura e gravação dos arquivos de cada roadmap pelos comandos do Rust
 * (`src-tauri/src/roadmaps/`). Tudo que é lido passa por `normalizar.ts`.
 *
 * Gravações do mesmo arquivo entram numa fila: duas mudanças seguidas (concluir e logo marcar a
 * próxima) nunca chegam ao disco fora de ordem.
 */
import { invoke } from "@tauri-apps/api/core";
import {
  lerConversa, normalizarCards, normalizarEntrevista, normalizarMeta, normalizarPlano, normalizarProgresso,
} from "./normalizar";
import {
  VERSAO_DOS_ARQUIVOS,
  type Cards, type EntrevistaSalva, type IaEscolhida, type MensagemDoPainel, type MetaDoRoadmap, type Plano, type Progresso,
} from "./tipos";

type Arquivo = "meta.json" | "entrevista.json" | "plano.json" | "progresso.json" | "cards.json" | "caderno.md" | `etapas/${string}.md`;

/**
 * Como os arquivos chegam ao disco: no computador, pelos comandos do app (Tauri); no celular, pelas
 * rotas do engine (ainda não portadas para o OMNI: hoje só o computador).
 */
export interface TransporteDosRoadmaps {
  listar(): Promise<{ id: string; meta: unknown }[]>;
  criar(meta: unknown): Promise<string>;
  ler(id: string, arquivo: string): Promise<string | null>;
  gravar(id: string, arquivo: string, conteudo: string): Promise<void>;
  anexar(id: string, linha: string): Promise<void>;
  ordenar(ordem: string[]): Promise<void>;
  backupAntesDeMigrar(id: string, versaoAntiga: number): Promise<void>;
}

const peloApp: TransporteDosRoadmaps = {
  listar: () => invoke("roadmaps_listar"),
  criar: (meta) => invoke("roadmaps_criar", { meta }),
  ler: async (id, arquivo) => (await invoke<string | null>("roadmaps_ler", { id, arquivo })) ?? null,
  gravar: (id, arquivo, conteudo) => invoke("roadmaps_gravar", { id, arquivo, conteudo }),
  anexar: (id, linha) => invoke("roadmaps_anexar_conversa", { id, linha }),
  ordenar: (ordem) => invoke("roadmaps_ordenar", { ordem }),
  backupAntesDeMigrar: (id, versaoAntiga) => invoke("roadmaps_backup_antes_de_migrar", { id, versaoAntiga }),
};

let transporte: TransporteDosRoadmaps = peloApp;
export function usarTransporteDosRoadmaps(novo: TransporteDosRoadmaps) { transporte = novo; }

export interface RoadmapAberto {
  meta: MetaDoRoadmap;
  entrevista: EntrevistaSalva;
  plano: Plano | null;
  progresso: Progresso;
  cards: Cards;
  /** Algum arquivo veio de uma versão mais nova do app: mostra, mas não grava por cima. */
  somenteLeitura: boolean;
}

const filas = new Map<string, Promise<unknown>>();

function naFila<T>(chave: string, tarefa: () => Promise<T>): Promise<T> {
  const anterior = filas.get(chave) ?? Promise.resolve();
  const proxima = anterior.catch(() => undefined).then(tarefa);
  filas.set(chave, proxima);
  void proxima.finally(() => { if (filas.get(chave) === proxima) filas.delete(chave); }).catch(() => undefined);
  return proxima;
}

/** Há gravação na fila para este roadmap (não dá para trocar a memória pelo disco agora). */
export function temGravacaoPendente(id: string): boolean {
  return [...filas.keys()].some((chave) => chave.startsWith(`${id}/`));
}

/** Espera as gravações pendentes (antes de fechar a tela, nos testes). */
export async function gravacoesPendentes(): Promise<void> {
  await Promise.allSettled([...filas.values()]);
}

async function ler(id: string, arquivo: Arquivo | "conversa.jsonl"): Promise<string | null> {
  return (await transporte.ler(id, arquivo)) ?? null;
}

function lerJson(textoLido: string | null): unknown {
  if (!textoLido) return null;
  try { return JSON.parse(textoLido); } catch { return null; }
}

function gravar(id: string, arquivo: Arquivo, conteudo: string): Promise<void> {
  return naFila(`${id}/${arquivo}`, () => transporte.gravar(id, arquivo, conteudo));
}

const json = (valor: unknown) => `${JSON.stringify(valor, null, 2)}\n`;

export async function listarRoadmaps(): Promise<MetaDoRoadmap[]> {
  const itens = await transporte.listar();
  return (Array.isArray(itens) ? itens : []).map((item) => normalizarMeta(item.id, item.meta));
}

export async function criarRoadmap(dados: { nome: string; cor: string; icone: string; ia: IaEscolhida }, agora = new Date()): Promise<MetaDoRoadmap> {
  const base = {
    versao: VERSAO_DOS_ARQUIVOS, nome: dados.nome.trim().slice(0, 80) || "Novo roadmap", cor: dados.cor, icone: dados.icone,
    arquivado: false, fase: "entrevista", criadoEm: agora.toISOString(), atualizadoEm: agora.toISOString(), ia: dados.ia,
    resumo: { etapas: 0, concluidas: 0, sequencia: 0, cardsParaHoje: 0 },
  };
  const id = await transporte.criar(base);
  return normalizarMeta(id, { ...base, id });
}

/** Versão de cada arquivo lido. Mais antiga que a atual: cópia em `~/omni-backups/` antes de regravar. */
async function conferirVersoes(id: string, lidos: unknown[]): Promise<boolean> {
  const versoes = lidos.map((v) => (v && typeof v === "object" && typeof (v as { versao?: unknown }).versao === "number" ? (v as { versao: number }).versao : null))
    .filter((v): v is number => v !== null);
  if (versoes.some((v) => v > VERSAO_DOS_ARQUIVOS)) return true;
  const antiga = versoes.find((v) => v < VERSAO_DOS_ARQUIVOS);
  if (antiga !== undefined) await transporte.backupAntesDeMigrar(id, antiga);
  return false;
}

export async function abrirRoadmap(id: string): Promise<RoadmapAberto> {
  const [meta, entrevista, plano, progresso, cards] = await Promise.all(
    (["meta.json", "entrevista.json", "plano.json", "progresso.json", "cards.json"] as const).map((a) => ler(id, a).then(lerJson)),
  );
  const somenteLeitura = await conferirVersoes(id, [meta, entrevista, plano, progresso, cards]);
  return {
    meta: normalizarMeta(id, meta),
    entrevista: normalizarEntrevista(entrevista),
    plano: plano ? normalizarPlano(plano) : null,
    progresso: normalizarProgresso(progresso),
    cards: normalizarCards(cards),
    somenteLeitura,
  };
}

export const gravarMeta = (meta: MetaDoRoadmap) => gravar(meta.id, "meta.json", json(meta));
export const gravarEntrevista = (id: string, e: EntrevistaSalva) => gravar(id, "entrevista.json", json(e));
export const gravarPlano = (id: string, p: Plano) => gravar(id, "plano.json", json(p));
export const gravarProgresso = (id: string, p: Progresso) => gravar(id, "progresso.json", json(p));
export const gravarCards = (id: string, c: Cards) => gravar(id, "cards.json", json(c));
export const gravarResumoDaEtapa = (id: string, etapaId: string, markdown: string) => gravar(id, `etapas/${etapaId}.md`, markdown.endsWith("\n") ? markdown : `${markdown}\n`);
export const lerResumoDaEtapa = (id: string, etapaId: string) => ler(id, `etapas/${etapaId}.md`);
export const lerCaderno = (id: string) => ler(id, "caderno.md");
export const gravarCaderno = (id: string, texto: string) => gravar(id, "caderno.md", texto);

export async function lerConversaDoPainel(id: string): Promise<MensagemDoPainel[]> {
  return lerConversa(await ler(id, "conversa.jsonl"));
}

export function anexarNaConversa(id: string, mensagem: MensagemDoPainel): Promise<void> {
  return naFila(`${id}/conversa.jsonl`, () => transporte.anexar(id, JSON.stringify(mensagem)));
}

export function ordenarRoadmaps(ordem: string[]): Promise<void> {
  return naFila("indice", () => transporte.ordenar(ordem));
}

/** Último roadmap aberto (só conveniência; nada importante mora no localStorage). */
const CHAVE_DO_ULTIMO = "omni-roadmaps-ultimo";
export function lembrarUltimo(id: string) { try { localStorage.setItem(CHAVE_DO_ULTIMO, id); } catch { /* sem localStorage */ } }
export function ultimoAberto(): string | null { try { return localStorage.getItem(CHAVE_DO_ULTIMO); } catch { return null; } }
