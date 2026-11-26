/**
 * Análises dos estudos (puras): dia, semana e matéria, juntando o que já está gravado — sessões do
 * Pomodoro, etapas concluídas, revisões de cards de cada roadmap e as atividades do Mentor (questões e
 * acertos; os minutos delas ficam à parte do foco, para não contar duas vezes o mesmo bloco).
 */
import { diaLocal, etapasEmOrdem, sequencia } from "./progresso";
import type { Atividade } from "./mentor";
import type { SessaoDePomodoro } from "./pomodoro";
import type { Cards, MetaDoRoadmap, Plano, Progresso } from "./tipos";

export interface DadosDoRoadmap { meta: MetaDoRoadmap; plano: Plano | null; progresso: Progresso; cards: Cards }

export interface Totais { minutos: number; pomodoros: number; interrompidos: number; etapas: number; revisoes: number; questoes: number; acertos: number; atividades: number }
export interface TotaisDoDia extends Totais { dia: string }
export interface TotaisDaMateria extends Totais { chave: string; nome: string; cor: string; etapasNoPlano: number; ultimoDia?: string }

const COR_LIVRE = "#7d8a99";
const vazio = (): Totais => ({ minutos: 0, pomodoros: 0, interrompidos: 0, etapas: 0, revisoes: 0, questoes: 0, acertos: 0, atividades: 0 });

/** "73%" ou "" sem questões. */
export const taxaDeAcerto = (t: Pick<Totais, "questoes" | "acertos">) => (t.questoes ? `${Math.round((t.acertos / t.questoes) * 100)}%` : "");

/** Matéria de uma sessão: o roadmap, ou o nome livre sem diferença de maiúsculas. */
export const chaveDaMateria = (s: Pick<SessaoDePomodoro, "roadmapId" | "materia">) => s.roadmapId ?? `livre:${s.materia.trim().toLowerCase()}`;

interface Evento { dia: string; chave: string; nome: string; cor: string; tipo: "foco" | "etapa" | "revisao" | "atividade"; minutos: number; completo: boolean; questoes?: number; acertos?: number }

function eventos(sessoes: SessaoDePomodoro[], roadmaps: DadosDoRoadmap[], atividades: Atividade[]): Evento[] {
  const metas = new Map(roadmaps.map((r) => [r.meta.id, r.meta]));
  const lista: Evento[] = sessoes.map((s) => {
    const meta = s.roadmapId ? metas.get(s.roadmapId) : undefined;
    return { dia: diaLocal(new Date(s.inicio)), chave: chaveDaMateria(s), nome: meta?.nome ?? s.materia, cor: meta?.cor ?? s.cor ?? COR_LIVRE, tipo: "foco", minutos: s.minutos, completo: s.completo };
  });
  for (const a of atividades) {
    const meta = a.roadmapId ? metas.get(a.roadmapId) : undefined;
    lista.push({ dia: diaLocal(new Date(a.em)), chave: chaveDaMateria(a), nome: meta?.nome ?? a.materia, cor: meta?.cor ?? COR_LIVRE, tipo: "atividade", minutos: 0, completo: true, questoes: a.questoes ?? 0, acertos: a.acertos ?? 0 });
  }
  for (const r of roadmaps) {
    const base = { chave: r.meta.id, nome: r.meta.nome, cor: r.meta.cor, minutos: 0, completo: true };
    for (const p of Object.values(r.progresso.etapas)) {
      if (p.estado === "concluida" && p.fim && !Number.isNaN(Date.parse(p.fim))) lista.push({ ...base, dia: diaLocal(new Date(p.fim)), tipo: "etapa" });
    }
    for (const rev of r.cards.revisoes) {
      if (!Number.isNaN(Date.parse(rev.em))) lista.push({ ...base, dia: diaLocal(new Date(rev.em)), tipo: "revisao" });
    }
  }
  return lista;
}

function somar(t: Totais, e: Evento) {
  if (e.tipo === "foco") { t.minutos += e.minutos; if (e.completo) t.pomodoros++; else t.interrompidos++; }
  else if (e.tipo === "atividade") { t.atividades++; t.questoes += e.questoes ?? 0; t.acertos += e.acertos ?? 0; }
  else if (e.tipo === "etapa") t.etapas++;
  else t.revisoes++;
}

function porMateria(lista: Evento[], roadmaps: DadosDoRoadmap[]): TotaisDaMateria[] {
  const mapa = new Map<string, TotaisDaMateria>();
  for (const e of lista) {
    const m = mapa.get(e.chave) ?? { ...vazio(), chave: e.chave, nome: e.nome, cor: e.cor, etapasNoPlano: 0 };
    somar(m, e);
    if (!m.ultimoDia || e.dia > m.ultimoDia) m.ultimoDia = e.dia;
    mapa.set(e.chave, m);
  }
  for (const r of roadmaps) {
    const m = mapa.get(r.meta.id);
    if (m) m.etapasNoPlano = r.plano ? etapasEmOrdem(r.plano).length : 0;
  }
  return [...mapa.values()].sort((a, b) => b.minutos - a.minutos || b.etapas + b.revisoes - (a.etapas + a.revisoes) || a.nome.localeCompare(b.nome));
}

export function somarDias(dia: string, n: number): string {
  const [a, m, d] = dia.split("-").map(Number);
  return diaLocal(new Date(a, m - 1, d + n));
}

/** Segunda-feira da semana do dia. */
export function inicioDaSemana(dia: string): string {
  const [a, m, d] = dia.split("-").map(Number);
  const semana = (new Date(a, m - 1, d).getDay() + 6) % 7;
  return somarDias(dia, -semana);
}

export interface AnaliseDoPeriodo {
  dias: TotaisDoDia[];
  total: Totais;
  materias: TotaisDaMateria[];
}

export function analisarPeriodo(sessoes: SessaoDePomodoro[], roadmaps: DadosDoRoadmap[], primeiro: string, quantidade: number, atividades: Atividade[] = []): AnaliseDoPeriodo {
  const dias = Array.from({ length: quantidade }, (_, i) => ({ ...vazio(), dia: somarDias(primeiro, i) }));
  const indice = new Map(dias.map((d, i) => [d.dia, i]));
  const total = vazio();
  const doPeriodo = eventos(sessoes, roadmaps, atividades).filter((e) => indice.has(e.dia));
  for (const e of doPeriodo) { somar(dias[indice.get(e.dia) as number], e); somar(total, e); }
  return { dias, total, materias: porMateria(doPeriodo, roadmaps) };
}

export interface AnaliseGeral {
  materias: TotaisDaMateria[];
  total: Totais;
  /** Dias seguidos com algum estudo (foco, etapa ou revisão) até hoje. */
  sequencia: number;
  diasComEstudo: number;
}

export function analisarTudo(sessoes: SessaoDePomodoro[], roadmaps: DadosDoRoadmap[], hoje: string, atividades: Atividade[] = []): AnaliseGeral {
  const lista = eventos(sessoes, roadmaps, atividades);
  const total = vazio();
  for (const e of lista) somar(total, e);
  const dias = [...new Set(lista.map((e) => e.dia))].sort();
  return { materias: porMateria(lista, roadmaps), total, sequencia: sequencia(dias, hoje), diasComEstudo: dias.length };
}

/** "1 h 25 min", "40 min", "0 min". */
export function formatarMinutos(min: number): string {
  const h = Math.floor(min / 60), m = Math.round(min % 60);
  return h ? (m ? `${h} h ${m} min` : `${h} h`) : `${m} min`;
}

const NOMES_DOS_DIAS = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];
export function rotuloCurtoDoDia(dia: string): string {
  const [a, m, d] = dia.split("-").map(Number);
  return NOMES_DOS_DIAS[new Date(a, m - 1, d).getDay()];
}
export function rotuloDoDia(dia: string): string {
  const [a, m, d] = dia.split("-").map(Number);
  return new Date(a, m - 1, d).toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "2-digit" });
}

// ponytail: estes dois importam do agora real só para o rótulo "hoje"; os cálculos recebem o dia.
export const hojeLocal = () => diaLocal(new Date());
