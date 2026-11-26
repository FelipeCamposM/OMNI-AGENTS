/**
 * Mentor de estudo: a pessoa conta o contexto (o que estuda, quais plataformas usa: questões,
 * videoaulas, método de música…) e, durante o dia, o que está fazendo ("terminei a aula de TypeScript
 * de 40 min", "fiz 30 questões, acertei 22"). A IA registra as atividades e orienta o próximo passo
 * concreto (o quê, quanto tempo, quantas questões, em qual plataforma), que vira um Pomodoro num toque.
 *
 * Tudo em `<dados>/roadmaps/mentor.json` (PC e celular): como no Pomodoro, toda gravação relê o disco
 * e junta pelo id, então um aparelho não apaga o que o outro registrou.
 */
import { invoke } from "@tauri-apps/api/core";
import { useSyncExternalStore } from "react";
import { cancelar, foiCancelado, perguntarJson } from "./ia";
import { normalizarIa } from "./normalizar";
import { diaLocal } from "./progresso";
import { ROTULO_DA_FASE, contando, restante, type Cronometro, type SessaoDePomodoro } from "./pomodoro";
import { ATIVIDADES, ROTULO_DA_ATIVIDADE, type IaEscolhida, type MetaDoRoadmap, type TipoDeAtividade } from "./tipos";

export { ATIVIDADES, ROTULO_DA_ATIVIDADE, type TipoDeAtividade };

export interface Plataforma { id: string; nome: string; tipo: TipoDeAtividade; nota?: string }

export interface PerfilDeEstudo {
  /** O que a pessoa estuda e como (texto livre: "concurso de TI do TRF, prova em março…"). */
  contexto: string;
  plataformas: Plataforma[];
  ia: IaEscolhida;
}

export interface Atividade {
  id: string;
  /** Quando foi registrada (fim da atividade). */
  em: string;
  tipo: TipoDeAtividade;
  materia: string;
  roadmapId?: string;
  plataforma?: string;
  minutos?: number;
  questoes?: number;
  acertos?: number;
  nota?: string;
}

export interface ProximoPasso {
  tipo: TipoDeAtividade;
  materia: string;
  roadmapId?: string;
  minutos: number;
  /** Quantas questões, páginas, exercícios… */
  quantidade?: number;
  plataforma?: string;
  descricao: string;
}

export interface MensagemDoMentor {
  id: string;
  de: "ia" | "eu";
  texto: string;
  em: string;
  proximo?: ProximoPasso;
  /** Ids das atividades que esta resposta registrou. */
  registradas?: string[];
}

export interface DadosDoMentor { versao: 1; perfil: PerfilDeEstudo; atividades: Atividade[]; conversa: MensagemDoMentor[] }

const MAXIMO_DE_ATIVIDADES = 20_000;
const MAXIMO_DE_MENSAGENS = 400;
export const ARQUIVO_DO_MENTOR = "mentor.json";
export const CHAVE_DO_MENTOR = "mentor";

// ---------- normalização ----------

const texto = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const inteiro = (v: unknown, max: number) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.min(max, Math.round(v)) : undefined);
const tipoDe = (v: unknown): TipoDeAtividade => (ATIVIDADES.includes(v as TipoDeAtividade) ? (v as TipoDeAtividade) : "outro");
const dataValida = (v: unknown) => (typeof v === "string" && !Number.isNaN(Date.parse(v)) ? v : "");
const novoId = (prefixo: string) => `${prefixo}-${Date.now().toString(36)}-${Math.floor(Math.random() * 0xffffff).toString(16)}`;

function opcionais<T extends object>(base: T, extras: Record<string, string | number | undefined>): T {
  for (const [k, v] of Object.entries(extras)) if (v !== undefined && v !== "") (base as Record<string, unknown>)[k] = v;
  return base;
}

export function normalizarAtividade(v: unknown, agora = new Date().toISOString()): Atividade | null {
  const o = (v && typeof v === "object" ? v : {}) as Record<string, unknown>;
  const materia = texto(o.materia, 80);
  if (!materia) return null;
  const questoes = inteiro(o.questoes, 10_000);
  const acertos = inteiro(o.acertos, 10_000);
  return opcionais<Atividade>({ id: texto(o.id, 60) || novoId("a"), em: dataValida(o.em) || agora, tipo: tipoDe(o.tipo), materia }, {
    roadmapId: texto(o.roadmapId, 64), plataforma: texto(o.plataforma, 80), minutos: inteiro(o.minutos, 24 * 60),
    questoes, acertos: acertos !== undefined && questoes !== undefined ? Math.min(acertos, questoes) : acertos, nota: texto(o.nota, 400),
  });
}

export function normalizarProximo(v: unknown): ProximoPasso | undefined {
  const o = (v && typeof v === "object" ? v : null) as Record<string, unknown> | null;
  if (!o) return undefined;
  const materia = texto(o.materia, 80), minutos = inteiro(o.minutos, 240);
  if (!materia || !minutos) return undefined;
  return opcionais<ProximoPasso>({ tipo: tipoDe(o.tipo), materia, minutos, descricao: texto(o.descricao, 400) || `${ROTULO_DA_ATIVIDADE[tipoDe(o.tipo)]} de ${materia}` }, {
    roadmapId: texto(o.roadmapId, 64), quantidade: inteiro(o.quantidade, 10_000), plataforma: texto(o.plataforma, 80),
  });
}

export function normalizarMentor(v: unknown): DadosDoMentor {
  const o = (v && typeof v === "object" ? v : {}) as Record<string, unknown>;
  const p = (o.perfil && typeof o.perfil === "object" ? o.perfil : {}) as Record<string, unknown>;
  const plataformas = (Array.isArray(p.plataformas) ? p.plataformas : []).flatMap((x): Plataforma[] => {
    const xo = (x && typeof x === "object" ? x : {}) as Record<string, unknown>;
    const nome = texto(xo.nome, 80);
    return nome ? [opcionais<Plataforma>({ id: texto(xo.id, 60) || novoId("pl"), nome, tipo: tipoDe(xo.tipo) }, { nota: texto(xo.nota, 200) })] : [];
  }).slice(0, 30);
  const atividades = (Array.isArray(o.atividades) ? o.atividades : []).map((a) => normalizarAtividade(a)).filter((a): a is Atividade => a !== null)
    .sort((a, b) => Date.parse(a.em) - Date.parse(b.em)).slice(-MAXIMO_DE_ATIVIDADES);
  const conversa = (Array.isArray(o.conversa) ? o.conversa : []).flatMap((m): MensagemDoMentor[] => {
    const mo = (m && typeof m === "object" ? m : {}) as Record<string, unknown>;
    const t = texto(mo.texto, 20_000), em = dataValida(mo.em);
    if (!t || !em) return [];
    const msg: MensagemDoMentor = { id: texto(mo.id, 60) || novoId("m"), de: mo.de === "ia" ? "ia" : "eu", texto: t, em };
    const proximo = normalizarProximo(mo.proximo);
    if (proximo) msg.proximo = proximo;
    if (Array.isArray(mo.registradas)) msg.registradas = mo.registradas.filter((x): x is string => typeof x === "string").slice(0, 20);
    return [msg];
  }).sort((a, b) => Date.parse(a.em) - Date.parse(b.em)).slice(-MAXIMO_DE_MENSAGENS);
  return { versao: 1, perfil: { contexto: texto(p.contexto, 6000), plataformas, ia: normalizarIa(p.ia) }, atividades, conversa };
}

/** Disco + memória: atividades e mensagens pelo id (sem as apagadas aqui); perfil daqui só se mudou aqui. */
export function juntarMentor(disco: DadosDoMentor, memoria: DadosDoMentor, apagadas: ReadonlySet<string>, perfilDaqui: boolean): DadosDoMentor {
  const unir = <T extends { id: string; em: string }>(a: T[], b: T[], max: number) => {
    const porId = new Map<string, T>();
    for (const x of [...a, ...b]) if (!apagadas.has(x.id)) porId.set(x.id, x);
    return [...porId.values()].sort((x, y) => Date.parse(x.em) - Date.parse(y.em)).slice(-max);
  };
  return {
    versao: 1, perfil: perfilDaqui ? memoria.perfil : disco.perfil,
    atividades: unir(disco.atividades, memoria.atividades, MAXIMO_DE_ATIVIDADES),
    conversa: unir(disco.conversa, memoria.conversa, MAXIMO_DE_MENSAGENS),
  };
}

// ---------- o que a IA recebe e devolve ----------

export const SISTEMA_DO_MENTOR = `Você é um mentor de estudos experiente, direto e prático, ao lado da pessoa enquanto ela estuda. Fala em português do Brasil.
A pessoa conta o que está fazendo agora (começou ou terminou uma aula, vai fazer questões, terminou um bloco). Você:
1. Registra o que ela disse que JÁ FEZ como atividades (tipo, matéria, minutos, questões, acertos, plataforma). Planos e intenções não são atividades. Nunca invente números: se ela não disse quantas acertou, registre sem acertos e, se for útil, pergunte.
2. Orienta o PRÓXIMO PASSO concreto: o que fazer, por quantos minutos, quantas unidades (questões, páginas, exercícios) e em qual das plataformas dela. Seja específico ("30 questões de TypeScript no QConcursos em 40 min, só do assunto da aula"), não genérico.

Princípios (adapte ao contexto dela):
- Teoria pede prática logo depois: depois de uma videoaula, questões do mesmo assunto (em geral 1 questão a cada 1,5–2 min; ~20–40 questões após uma aula de 40–60 min).
- Taxa de acerto guia o passo seguinte: abaixo de ~60%, revisar a teoria/erros antes de mais questões; acima de ~80%, avançar de assunto ou subir a dificuldade.
- Revisão dos erros conta como atividade própria e vale mais que questões novas quando os erros se acumulam.
- Respeite o tempo que ela tem, o horário (tarde da noite: blocos menores, revisão) e o que já foi feito hoje e na semana (equilibre matérias, evite só uma).
- Concursos: priorize questões da banca e o edital; música e habilidades práticas: prática deliberada curta e diária.
- Pausas: depois de ~2 horas seguidas de foco, sugira pausa longa.

Use "materia" curta e estável (o mesmo nome entre um dia e outro; se casar com um roadmap da lista, devolva o "roadmapId" dele).
Tipos de atividade: ${ATIVIDADES.join(", ")}.

Responda SÓ com um JSON, sem texto fora dele:
{"resposta":"markdown curto para a pessoa (2 a 6 frases ou uma lista curta)","atividades":[{"tipo":"aula","materia":"TypeScript","minutos":40,"plataforma":"Alura"}],"proximo":{"tipo":"questoes","materia":"TypeScript","minutos":40,"quantidade":30,"plataforma":"QConcursos","descricao":"30 questões de TypeScript sobre tipos genéricos"}}
"atividades" pode ser [] e "proximo" pode ser null (só quando não há o que sugerir, ex.: ela vai parar por hoje).`;

export interface ContextoDoPedido {
  agora: Date;
  dados: DadosDoMentor;
  roadmaps: Pick<MetaDoRoadmap, "id" | "nome" | "resumo">[];
  sessoes: SessaoDePomodoro[];
  cronometro: Cronometro | null;
  mensagem: string;
}

const linhaDaAtividade = (a: Atividade) => [
  new Date(a.em).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }),
  ROTULO_DA_ATIVIDADE[a.tipo], a.materia, a.plataforma && `em ${a.plataforma}`, a.minutos !== undefined && `${a.minutos} min`,
  a.questoes !== undefined && `${a.questoes} questões${a.acertos !== undefined ? `, ${a.acertos} acertos` : ""}`, a.nota,
].filter(Boolean).join(" · ");

/** Semana: por matéria e tipo, minutos, questões e acertos. */
function resumoDaSemana(atividades: Atividade[], sessoes: SessaoDePomodoro[], agora: Date): string {
  const desde = agora.getTime() - 7 * 86_400_000;
  const mapa = new Map<string, { minutos: number; questoes: number; acertos: number; foco: number }>();
  const pegar = (k: string) => { const v = mapa.get(k) ?? { minutos: 0, questoes: 0, acertos: 0, foco: 0 }; mapa.set(k, v); return v; };
  for (const a of atividades) if (Date.parse(a.em) >= desde) {
    const v = pegar(`${a.materia} — ${ROTULO_DA_ATIVIDADE[a.tipo]}`);
    v.minutos += a.minutos ?? 0; v.questoes += a.questoes ?? 0; v.acertos += a.acertos ?? 0;
  }
  for (const s of sessoes) if (Date.parse(s.inicio) >= desde) pegar(`${s.materia} — foco no Pomodoro`).foco += s.minutos;
  return [...mapa.entries()].map(([k, v]) => `- ${k}: ${[v.minutos && `${v.minutos} min`, v.foco && `${v.foco} min de foco`, v.questoes && `${v.questoes} questões (${Math.round((v.acertos / v.questoes) * 100)}% de acerto)`].filter(Boolean).join(", ")}`).join("\n");
}

export function pedidoDoMentor(c: ContextoDoPedido): string {
  const hoje = diaLocal(c.agora);
  const deHoje = c.dados.atividades.filter((a) => diaLocal(new Date(a.em)) === hoje);
  const focoHoje = c.sessoes.filter((s) => diaLocal(new Date(s.inicio)) === hoje);
  const conversa = c.dados.conversa.slice(-12).map((m) => `${m.de === "ia" ? "Mentor" : "Pessoa"}: ${m.texto.slice(0, 1500)}`).join("\n");
  const cronometro = c.cronometro && c.cronometro.comecou !== null
    ? `${ROTULO_DA_FASE[c.cronometro.fase]} de ${c.cronometro.materia.nome}${c.cronometro.materia.atividade ? ` (${ROTULO_DA_ATIVIDADE[c.cronometro.materia.atividade]})` : ""}, faltam ${Math.ceil(restante(c.cronometro, c.agora.getTime()) / 60_000)} min${contando(c.cronometro) ? "" : " (pausado)"}`
    : "parado";
  return [
    `Agora: ${c.agora.toLocaleString("pt-BR", { weekday: "long", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}`,
    `Contexto da pessoa:\n${c.dados.perfil.contexto || "(ainda não contou; pergunte o essencial se precisar)"}`,
    c.dados.perfil.plataformas.length ? `Plataformas que ela usa:\n${c.dados.perfil.plataformas.map((p) => `- ${p.nome} (${ROTULO_DA_ATIVIDADE[p.tipo]})${p.nota ? `: ${p.nota}` : ""}`).join("\n")}` : "",
    c.roadmaps.length ? `Roadmaps de estudo dela (id — nome — próxima etapa):\n${c.roadmaps.map((r) => `- ${r.id} — ${r.nome}${r.resumo.proximaEtapa ? ` — ${r.resumo.proximaEtapa}` : ""}`).join("\n")}` : "",
    `Hoje já registrado:\n${deHoje.map((a) => `- ${linhaDaAtividade(a)}`).join("\n") || "(nada)"}`,
    focoHoje.length ? `Pomodoros de hoje: ${focoHoje.map((s) => `${s.materia} ${s.minutos} min${s.completo ? "" : " (interrompido)"}`).join("; ")}` : "",
    `Pomodoro agora: ${cronometro}`,
    `Últimos 7 dias:\n${resumoDaSemana(c.dados.atividades, c.sessoes, c.agora) || "(nada)"}`,
    conversa ? `Conversa recente:\n${conversa}` : "",
    `Pessoa: ${c.mensagem}`,
  ].filter(Boolean).join("\n\n");
}

export interface RespostaDoMentor { resposta: string; atividades: Atividade[]; proximo?: ProximoPasso }

export function lerRespostaDoMentor(v: unknown, agora = new Date().toISOString()): RespostaDoMentor | string {
  const o = (v && typeof v === "object" ? v : {}) as Record<string, unknown>;
  const resposta = texto(o.resposta, 8000);
  if (!resposta) return "faltou \"resposta\"";
  const atividades = (Array.isArray(o.atividades) ? o.atividades : []).map((a) => normalizarAtividade({ ...(a as object), id: undefined, em: agora }, agora))
    .filter((a): a is Atividade => a !== null).slice(0, 10);
  const proximo = normalizarProximo(o.proximo);
  return proximo ? { resposta, atividades, proximo } : { resposta, atividades };
}

// ---------- loja (memória + arquivo) ----------

export interface TransporteDoMentor { ler(): Promise<string | null>; gravar(conteudo: string): Promise<void> }
let transporte: TransporteDoMentor = {
  ler: async () => (await invoke<string | null>("roadmaps_ler_geral", { nome: ARQUIVO_DO_MENTOR })) ?? null,
  gravar: async (conteudo) => { await invoke("roadmaps_gravar_geral", { nome: ARQUIVO_DO_MENTOR, conteudo }); },
};
export function usarTransporteDoMentor(novo: TransporteDoMentor) { transporte = novo; }

const vazio = (): DadosDoMentor => ({ versao: 1, perfil: { contexto: "", plataformas: [], ia: { cli: "claude" } }, atividades: [], conversa: [] });
let dados = vazio();
let carregou = false;
let pensando = false;
let erro = "";
let lendo: Promise<void> | null = null;
let fila: Promise<unknown> = Promise.resolve();
const apagadas = new Set<string>();
let perfilDaqui = false;
let versao = 0;
const ouvintes = new Set<() => void>();
function avisar() { versao++; for (const o of ouvintes) o(); }
const inscrever = (o: () => void) => { ouvintes.add(o); return () => { ouvintes.delete(o); }; };

export function useMentor(): number { return useSyncExternalStore(inscrever, () => versao, () => versao); }
export const estadoDoMentor = () => ({ dados, carregou, pensando, erro });

async function lerDoDisco(): Promise<DadosDoMentor> {
  const t = await transporte.ler();
  let lido: unknown = null;
  try { lido = t ? JSON.parse(t) : null; } catch { lido = null; }
  return normalizarMentor(lido);
}

export function carregarMentor(): Promise<void> {
  lendo ??= lerDoDisco()
    .then((disco) => { dados = juntarMentor(disco, dados, apagadas, perfilDaqui); carregou = true; avisar(); })
    .catch((e) => { erro = `Não consegui ler o Mentor: ${String(e)}`; avisar(); })
    .finally(() => { lendo = null; });
  return lendo;
}

function gravar() {
  fila = fila.catch(() => undefined)
    .then(async () => {
      dados = juntarMentor(await lerDoDisco(), dados, apagadas, perfilDaqui);
      await transporte.gravar(`${JSON.stringify(dados, null, 2)}\n`);
      avisar();
    })
    .catch((e) => { erro = `Não consegui gravar o Mentor: ${String(e)}`; avisar(); });
  return fila;
}
export const gravacoesDoMentor = () => fila.catch(() => undefined);

export const acoesDoMentor = {
  async perfil(mudanca: Partial<PerfilDeEstudo>) {
    dados = { ...dados, perfil: { ...dados.perfil, ...mudanca } };
    perfilDaqui = true;
    avisar();
    await gravar();
  },
  async apagarAtividade(id: string) {
    apagadas.add(id);
    dados = { ...dados, atividades: dados.atividades.filter((a) => a.id !== id) };
    avisar();
    await gravar();
  },
  async registrar(atividade: Atividade) {
    dados = { ...dados, atividades: [...dados.atividades, atividade] };
    avisar();
    await gravar();
  },
  async limparConversa() {
    for (const m of dados.conversa) apagadas.add(m.id);
    dados = { ...dados, conversa: [] };
    avisar();
    await gravar();
  },
  /** Manda a mensagem: grava já a pergunta, pede à IA, registra as atividades e guarda a resposta. */
  async enviar(mensagem: string, contexto: Omit<ContextoDoPedido, "dados" | "mensagem" | "agora">, agora = () => new Date()) {
    const textoDaPessoa = mensagem.trim();
    if (!textoDaPessoa || pensando) return;
    await carregarMentor();
    const pergunta: MensagemDoMentor = { id: novoId("m"), de: "eu", texto: textoDaPessoa.slice(0, 4000), em: agora().toISOString() };
    const pedido = pedidoDoMentor({ ...contexto, agora: agora(), dados, mensagem: pergunta.texto });
    dados = { ...dados, conversa: [...dados.conversa, pergunta] };
    pensando = true; erro = "";
    avisar();
    void gravar();
    try {
      const fim = agora().toISOString();
      const r = await perguntarJson({ chave: CHAVE_DO_MENTOR, ia: dados.perfil.ia, sistema: SISTEMA_DO_MENTOR, texto: pedido, web: false }, (v) => lerRespostaDoMentor(v, fim));
      const resposta: MensagemDoMentor = { id: novoId("m"), de: "ia", texto: r.resposta, em: agora().toISOString(), ...(r.proximo ? { proximo: r.proximo } : {}), ...(r.atividades.length ? { registradas: r.atividades.map((a) => a.id) } : {}) };
      dados = { ...dados, atividades: [...dados.atividades, ...r.atividades], conversa: [...dados.conversa, resposta] };
    } catch (e) {
      // Cancelou: a pergunta fica na conversa, sem aviso de erro.
      if (!foiCancelado(e)) erro = e instanceof Error ? e.message : String(e);
    } finally {
      pensando = false;
      avisar();
    }
    await gravar();
  },
  cancelar() { cancelar(CHAVE_DO_MENTOR); },
};

/** Testes: volta ao estado inicial. */
export function limparMentor() {
  dados = vazio(); carregou = false; pensando = false; erro = ""; lendo = null; fila = Promise.resolve();
  apagadas.clear(); perfilDaqui = false;
  avisar();
}
