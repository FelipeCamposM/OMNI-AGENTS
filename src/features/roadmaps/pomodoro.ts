/**
 * Pomodoro dos estudos: cronômetro de foco/pausa, histórico das sessões de foco por matéria.
 *
 * - O cronômetro vive na memória do módulo: trocar de tela não para a contagem. O tempo sai de
 *   relógio (`Date.now()`), não de contar ticks: janela minimizada atrasa o tick, nunca o tempo.
 * - Só sessões de FOCO vão para o histórico (`<dados>/roadmaps/pomodoros.json`). Foco interrompido
 *   com 1 min ou mais entra como incompleto; menos que isso é descartado.
 * - Matéria = um roadmap (id + nome + cor) ou um nome livre ("Cálculo").
 */
import { invoke } from "@tauri-apps/api/core";
import { useSyncExternalStore } from "react";
import { ATIVIDADES, type TipoDeAtividade } from "./tipos";

export type Fase = "foco" | "pausa" | "pausaLonga";

export interface Configuracao {
  foco: number;
  pausa: number;
  pausaLonga: number;
  /** Focos até a pausa longa. */
  ciclos: number;
  /** Ao terminar o foco, a pausa já começa contando. */
  pausaAutomatica: boolean;
  /** Minutos de foco por dia que contam como meta cumprida nas análises. */
  metaDiaria: number;
}

export const CONFIGURACAO_PADRAO: Configuracao = { foco: 25, pausa: 5, pausaLonga: 15, ciclos: 4, pausaAutomatica: true, metaDiaria: 100 };

export interface Materia { nome: string; roadmapId?: string; etapaId?: string; cor?: string; atividade?: TipoDeAtividade }

export interface SessaoDePomodoro {
  id: string;
  inicio: string;
  fim: string;
  /** Minutos de foco de verdade (pausas no meio não contam). */
  minutos: number;
  previsto: number;
  completo: boolean;
  materia: string;
  roadmapId?: string;
  etapaId?: string;
  cor?: string;
  atividade?: TipoDeAtividade;
}

export interface HistoricoDePomodoro { versao: 1; config: Configuracao; sessoes: SessaoDePomodoro[] }

const MAXIMO_DE_SESSOES = 20_000;
const MINIMO_PARA_GRAVAR_MS = 60_000;

// ---------- normalização (o arquivo pode vir de outra versão ou editado à mão) ----------

const numero = (v: unknown, padrao: number, min: number, max: number) =>
  typeof v === "number" && Number.isFinite(v) ? Math.min(max, Math.max(min, Math.round(v))) : padrao;
const texto = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");

export function normalizarConfiguracao(v: unknown): Configuracao {
  const o = (v && typeof v === "object" ? v : {}) as Record<string, unknown>;
  const p = CONFIGURACAO_PADRAO;
  return {
    foco: numero(o.foco, p.foco, 1, 180),
    pausa: numero(o.pausa, p.pausa, 1, 60),
    pausaLonga: numero(o.pausaLonga, p.pausaLonga, 1, 120),
    ciclos: numero(o.ciclos, p.ciclos, 1, 12),
    pausaAutomatica: typeof o.pausaAutomatica === "boolean" ? o.pausaAutomatica : p.pausaAutomatica,
    metaDiaria: numero(o.metaDiaria, p.metaDiaria, 5, 24 * 60),
  };
}

export function normalizarHistorico(v: unknown): HistoricoDePomodoro {
  const o = (v && typeof v === "object" ? v : {}) as Record<string, unknown>;
  const sessoes = (Array.isArray(o.sessoes) ? o.sessoes : []).flatMap((s): SessaoDePomodoro[] => {
    const so = (s && typeof s === "object" ? s : {}) as Record<string, unknown>;
    const inicio = texto(so.inicio, 40), fim = texto(so.fim, 40), materia = texto(so.materia, 80);
    if (!inicio || !fim || !materia || Number.isNaN(Date.parse(inicio)) || Number.isNaN(Date.parse(fim))) return [];
    const sessao: SessaoDePomodoro = {
      id: texto(so.id, 60) || `p-${Date.parse(inicio).toString(36)}`,
      inicio, fim, materia,
      minutos: numero(so.minutos, 0, 0, 24 * 60),
      previsto: numero(so.previsto, 0, 0, 24 * 60),
      completo: so.completo === true,
    };
    const roadmapId = texto(so.roadmapId, 64), etapaId = texto(so.etapaId, 64), cor = texto(so.cor, 20);
    if (roadmapId) sessao.roadmapId = roadmapId;
    if (etapaId) sessao.etapaId = etapaId;
    if (/^#[0-9a-f]{3,8}$/i.test(cor)) sessao.cor = cor;
    if (ATIVIDADES.includes(so.atividade as TipoDeAtividade)) sessao.atividade = so.atividade as TipoDeAtividade;
    return [sessao];
  });
  sessoes.sort((a, b) => Date.parse(a.inicio) - Date.parse(b.inicio));
  return { versao: 1, config: normalizarConfiguracao(o.config), sessoes: sessoes.slice(-MAXIMO_DE_SESSOES) };
}

// ---------- cronômetro (puro: recebe `agora`) ----------

export interface Cronometro {
  fase: Fase;
  /** Duração da fase, em ms. */
  duracao: number;
  /** Tempo já contado antes do último "continuar". */
  acumulado: number;
  /** Quando voltou a contar; `null` = parado/pausado. */
  desde: number | null;
  /** Primeiro "começar" desta fase (início da sessão no histórico). */
  comecou: number | null;
  /** Focos completos no ciclo atual (para saber quando vem a pausa longa). */
  focosNoCiclo: number;
  materia: Materia;
}

export function duracaoDa(fase: Fase, config: Configuracao): number {
  return (fase === "foco" ? config.foco : fase === "pausa" ? config.pausa : config.pausaLonga) * 60_000;
}

export function novoCronometro(config: Configuracao, materia: Materia = { nome: "Estudo livre" }): Cronometro {
  return { fase: "foco", duracao: duracaoDa("foco", config), acumulado: 0, desde: null, comecou: null, focosNoCiclo: 0, materia };
}

export function decorrido(c: Cronometro, agora: number): number {
  return Math.min(c.duracao, c.acumulado + (c.desde === null ? 0 : Math.max(0, agora - c.desde)));
}

export const restante = (c: Cronometro, agora: number) => c.duracao - decorrido(c, agora);
export const contando = (c: Cronometro) => c.desde !== null;

export function comecar(c: Cronometro, agora: number): Cronometro {
  if (c.desde !== null) return c;
  return { ...c, desde: agora, comecou: c.comecou ?? agora };
}

export function pausar(c: Cronometro, agora: number): Cronometro {
  if (c.desde === null) return c;
  return { ...c, acumulado: decorrido(c, agora), desde: null };
}

function sessaoDoFoco(c: Cronometro, fimMs: number, completo: boolean): SessaoDePomodoro | null {
  if (c.fase !== "foco" || c.comecou === null) return null;
  const focado = decorrido(c, fimMs);
  if (!completo && focado < MINIMO_PARA_GRAVAR_MS) return null;
  const s: SessaoDePomodoro = {
    id: `p-${c.comecou.toString(36)}-${Math.floor(Math.random() * 0xffff).toString(16)}`,
    inicio: new Date(c.comecou).toISOString(), fim: new Date(fimMs).toISOString(),
    minutos: Math.round(focado / 60_000), previsto: Math.round(c.duracao / 60_000), completo,
    materia: c.materia.nome,
  };
  if (c.materia.roadmapId) s.roadmapId = c.materia.roadmapId;
  if (c.materia.etapaId) s.etapaId = c.materia.etapaId;
  if (c.materia.cor) s.cor = c.materia.cor;
  if (c.materia.atividade) s.atividade = c.materia.atividade;
  return s;
}

/** Próxima fase depois da atual (terminada ou pulada). */
function proximaFase(c: Cronometro, config: Configuracao, focoCompleto: boolean): Pick<Cronometro, "fase" | "focosNoCiclo"> {
  if (c.fase !== "foco") return { fase: "foco", focosNoCiclo: c.fase === "pausaLonga" ? 0 : c.focosNoCiclo };
  const focos = c.focosNoCiclo + (focoCompleto ? 1 : 0);
  return { fase: focos >= config.ciclos ? "pausaLonga" : "pausa", focosNoCiclo: focos };
}

export interface Passo { cronometro: Cronometro; sessao: SessaoDePomodoro | null; terminou: Fase | null }

/** Chamado a cada tick: se a fase acabou, grava o foco e passa para a próxima. */
export function avancar(c: Cronometro, config: Configuracao, agora: number): Passo {
  if (c.desde === null || restante(c, agora) > 0) return { cronometro: c, sessao: null, terminou: null };
  const fimMs = c.desde + (c.duracao - c.acumulado);
  const sessao = sessaoDoFoco(c, fimMs, true);
  const prox = proximaFase(c, config, true);
  const automatica = c.fase === "foco" && config.pausaAutomatica;
  const cronometro: Cronometro = {
    ...prox, materia: c.materia, duracao: duracaoDa(prox.fase, config), acumulado: 0,
    desde: automatica ? fimMs : null, comecou: automatica ? fimMs : null,
  };
  return { cronometro, sessao, terminou: c.fase };
}

/** Pular: foco interrompido entra no histórico se já tinha 1 min. */
export function pular(c: Cronometro, config: Configuracao, agora: number): Passo {
  const sessao = sessaoDoFoco(c, agora, false);
  const prox = proximaFase(c, config, false);
  return { cronometro: { ...prox, materia: c.materia, duracao: duracaoDa(prox.fase, config), acumulado: 0, desde: null, comecou: null }, sessao, terminou: null };
}

/** Zerar a fase atual (foco interrompido entra no histórico se já tinha 1 min). */
export function zerar(c: Cronometro, config: Configuracao, agora: number): Passo {
  const sessao = sessaoDoFoco(c, agora, false);
  return { cronometro: { ...c, duracao: duracaoDa(c.fase, config), acumulado: 0, desde: null, comecou: null }, sessao, terminou: null };
}

export function formatarTempo(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

export const ROTULO_DA_FASE: Record<Fase, string> = { foco: "Foco", pausa: "Pausa", pausaLonga: "Pausa longa" };

// ---------- loja (memória do módulo + arquivo) ----------

/** Onde o arquivo mora: no app, comandos do Tauri; no celular/web, rota `/roadmaps/geral` do engine. */
export interface TransporteDoPomodoro { ler(): Promise<string | null>; gravar(conteudo: string): Promise<void> }

let transporte: TransporteDoPomodoro = {
  ler: async () => (await invoke<string | null>("roadmaps_ler_geral", { nome: "pomodoros.json" })) ?? null,
  gravar: async (conteudo) => { await invoke("roadmaps_gravar_geral", { nome: "pomodoros.json", conteudo }); },
};
export function usarTransporteDoPomodoro(novo: TransporteDoPomodoro) { transporte = novo; }

/**
 * PC e celular gravam o mesmo arquivo: toda gravação relê o disco e junta as sessões pelo id (sem as
 * apagadas aqui), então um aparelho não apaga o pomodoro do outro. Ajustes daqui só vencem se mudaram aqui.
 */
export function juntarHistoricos(disco: HistoricoDePomodoro, memoria: HistoricoDePomodoro, apagadas: ReadonlySet<string>, configDaqui: boolean): HistoricoDePomodoro {
  const porId = new Map<string, SessaoDePomodoro>();
  for (const s of [...disco.sessoes, ...memoria.sessoes]) if (!apagadas.has(s.id)) porId.set(s.id, s);
  const sessoes = [...porId.values()].sort((a, b) => Date.parse(a.inicio) - Date.parse(b.inicio)).slice(-MAXIMO_DE_SESSOES);
  return { versao: 1, config: configDaqui ? memoria.config : disco.config, sessoes };
}

async function lerDoDisco(): Promise<HistoricoDePomodoro> {
  const t = await transporte.ler();
  let lido: unknown = null;
  try { lido = t ? JSON.parse(t) : null; } catch { lido = null; }
  return normalizarHistorico(lido);
}

let historico: HistoricoDePomodoro = { versao: 1, config: CONFIGURACAO_PADRAO, sessoes: [] };
let lendo: Promise<void> | null = null;
const apagadas = new Set<string>();
let configDaqui = false;
let erroDeGravacao = "";
let cronometro = novoCronometro(CONFIGURACAO_PADRAO);
let relogio: ReturnType<typeof setInterval> | undefined;
let versao = 0;
let fila: Promise<unknown> = Promise.resolve();
const ouvintes = new Set<() => void>();

function avisar() { versao++; for (const o of ouvintes) o(); }
const inscrever = (o: () => void) => { ouvintes.add(o); return () => { ouvintes.delete(o); }; };

/** Re-renderiza quem usa o pomodoro a cada mudança (e a cada segundo enquanto conta). */
export function usePomodoro(): number {
  return useSyncExternalStore(inscrever, () => versao, () => versao);
}

export const estadoDoPomodoro = () => ({ cronometro, historico, erro: erroDeGravacao });

/** Relê o arquivo (ao abrir a tela ou voltar ao app: o outro aparelho pode ter gravado algo). */
export function carregarPomodoros(): Promise<void> {
  lendo ??= lerDoDisco()
    .then((disco) => {
      historico = juntarHistoricos(disco, historico, apagadas, configDaqui);
      if (cronometro.comecou === null) cronometro = { ...cronometro, duracao: duracaoDa(cronometro.fase, historico.config) };
      avisar();
    })
    .catch((e) => { erroDeGravacao = `Não consegui ler o histórico do Pomodoro: ${String(e)}`; avisar(); })
    .finally(() => { lendo = null; });
  return lendo;
}

function gravar() {
  fila = fila.catch(() => undefined)
    .then(async () => {
      historico = juntarHistoricos(await lerDoDisco(), historico, apagadas, configDaqui);
      await transporte.gravar(`${JSON.stringify(historico, null, 2)}\n`);
      avisar();
    })
    .then(() => { if (erroDeGravacao) { erroDeGravacao = ""; avisar(); } })
    .catch((e) => { erroDeGravacao = `Não consegui gravar o Pomodoro: ${String(e)}`; avisar(); });
  return fila;
}

/** Espera as gravações (testes). */
export const gravacoesDoPomodoro = () => fila.catch(() => undefined);

function registrar(sessao: SessaoDePomodoro | null) {
  if (!sessao) return;
  historico = { ...historico, sessoes: [...historico.sessoes, sessao].slice(-MAXIMO_DE_SESSOES) };
  void gravar();
}

async function avisarFim(fase: Fase) {
  const titulo = fase === "foco" ? "Foco concluído" : "Pausa acabou";
  const corpo = fase === "foco" ? `Hora da pausa. ${cronometro.materia.nome}: mais um pomodoro no histórico.` : "Bora voltar ao foco.";
  try {
    if ("__TAURI_INTERNALS__" in window) {
      const { isPermissionGranted, requestPermission, sendNotification } = await import("@tauri-apps/plugin-notification");
      if (await isPermissionGranted() || (await requestPermission()) === "granted") sendNotification({ title: titulo, body: corpo });
    } else if (typeof Notification !== "undefined" && Notification.permission === "granted") {
      // Celular/web: só se os avisos já foram liberados nos Ajustes do aparelho (não pede de surpresa).
      new Notification(titulo, { body: corpo });
    }
  } catch { /* sem notificação (testes, navegador sem suporte) */ }
  try {
    const Contexto = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Contexto) return;
    const ctx = new Contexto();
    for (const [i, freq] of [880, 660, 880].entries()) {
      const osc = ctx.createOscillator(), ganho = ctx.createGain();
      osc.frequency.value = freq;
      ganho.gain.setValueAtTime(0.15, ctx.currentTime + i * 0.25);
      ganho.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + i * 0.25 + 0.22);
      osc.connect(ganho).connect(ctx.destination);
      osc.start(ctx.currentTime + i * 0.25);
      osc.stop(ctx.currentTime + i * 0.25 + 0.23);
    }
    setTimeout(() => void ctx.close().catch(() => undefined), 1200);
  } catch { /* sem áudio */ }
}

/** Liga o tick de 1 s só enquanto conta: parado, nada roda. */
function acertarRelogio() {
  if (contando(cronometro) && !relogio) relogio = setInterval(tick, 1000);
  if (!contando(cronometro) && relogio) { clearInterval(relogio); relogio = undefined; }
}

function tick() {
  const passo = avancar(cronometro, historico.config, Date.now());
  cronometro = passo.cronometro;
  registrar(passo.sessao);
  if (passo.terminou) void avisarFim(passo.terminou);
  acertarRelogio();
  avisar();
}

function aplicar(passo: Passo) {
  cronometro = passo.cronometro;
  registrar(passo.sessao);
  acertarRelogio();
  avisar();
}

export const acoesDoPomodoro = {
  comecar() { void carregarPomodoros(); cronometro = comecar(cronometro, Date.now()); acertarRelogio(); avisar(); },
  /** Foco já com matéria e duração (o próximo passo do Mentor). Um foco em andamento é fechado antes. */
  comecarCom(materia: Materia, minutos: number) {
    void carregarPomodoros();
    const agora = Date.now();
    if (cronometro.comecou !== null) registrar(zerar(cronometro, historico.config, agora).sessao);
    const base = novoCronometro(historico.config, materia);
    cronometro = comecar({ ...base, focosNoCiclo: cronometro.focosNoCiclo, duracao: Math.max(1, Math.min(240, Math.round(minutos))) * 60_000 }, agora);
    acertarRelogio();
    avisar();
  },
  pausar() { cronometro = pausar(cronometro, Date.now()); acertarRelogio(); avisar(); },
  pular() { aplicar(pular(cronometro, historico.config, Date.now())); },
  zerar() { aplicar(zerar(cronometro, historico.config, Date.now())); },
  /** Trocar a matéria no meio de um foco: o que já foi feito fica com a matéria antiga. */
  materia(materia: Materia) {
    if (cronometro.fase === "foco" && cronometro.comecou !== null && materia.nome !== cronometro.materia.nome) {
      const agora = Date.now();
      const eraContando = contando(cronometro);
      const passo = zerar(cronometro, historico.config, agora);
      registrar(passo.sessao);
      const resto = { ...passo.cronometro, materia, duracao: cronometro.duracao - decorrido(cronometro, agora) };
      cronometro = eraContando ? comecar(resto, agora) : resto;
    } else {
      cronometro = { ...cronometro, materia };
    }
    acertarRelogio();
    avisar();
  },
  async configurar(mudanca: Partial<Configuracao>) {
    await carregarPomodoros();
    historico = { ...historico, config: normalizarConfiguracao({ ...historico.config, ...mudanca }) };
    configDaqui = true;
    if (cronometro.comecou === null) cronometro = { ...cronometro, duracao: duracaoDa(cronometro.fase, historico.config) };
    avisar();
    await gravar();
  },
  async apagarSessao(id: string) {
    apagadas.add(id);
    historico = { ...historico, sessoes: historico.sessoes.filter((s) => s.id !== id) };
    avisar();
    await gravar();
  },
};

/** Testes: volta ao estado inicial. */
export function limparPomodoro() {
  if (relogio) clearInterval(relogio);
  relogio = undefined;
  historico = { versao: 1, config: CONFIGURACAO_PADRAO, sessoes: [] };
  lendo = null;
  apagadas.clear();
  configDaqui = false;
  erroDeGravacao = "";
  cronometro = novoCronometro(CONFIGURACAO_PADRAO);
  fila = Promise.resolve();
  avisar();
}
