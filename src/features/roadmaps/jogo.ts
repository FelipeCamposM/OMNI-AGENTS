/**
 * Fork (Roadmaps): a parte de jogo — XP, nível, estrelas por etapa, meta do dia e baú de cada módulo.
 * Tudo é calculado do que já está nos arquivos (progresso, cards, tarefas): nada novo para gravar,
 * nada para migrar, e o número nunca diverge do que aconteceu.
 */
import { diaLocal, etapasEmOrdem } from "./progresso";
import type { Cards, Etapa, Modulo, Plano, Progresso } from "./tipos";

export const XP = { porMinuto: 10, tarefa: 15, revisao: 5 } as const;

/** XP total de uma etapa concluída (o tempo previsto dela vale 10 XP por minuto). */
export function xpDaEtapa(etapa: Etapa): number { return etapa.minutos * XP.porMinuto; }

/** XP que falta para sair do nível `n` (1→2 pede 300; cada nível pede 150 a mais). */
export function xpDoNivel(n: number): number { return 300 + (n - 1) * 150; }

export interface Nivel { nivel: number; noNivel: number; paraOProximo: number; total: number }

export function nivel(total: number): Nivel {
  let n = 1, resto = Math.max(0, Math.floor(total));
  while (resto >= xpDoNivel(n)) { resto -= xpDoNivel(n); n++; }
  return { nivel: n, noNivel: resto, paraOProximo: xpDoNivel(n), total: Math.max(0, Math.floor(total)) };
}

function concluidaEm(progresso: Progresso, etapa: Etapa): string | undefined {
  const p = progresso.etapas[etapa.id];
  return p?.estado === "concluida" ? (p.fim ?? "") : undefined;
}

/** XP de tudo e só de hoje. Tarefa extra feita não tem data: conta no total, não no dia. */
export function xp(plano: Plano | null, progresso: Progresso, cards: Cards, agora: Date): { total: number; hoje: number } {
  const hoje = diaLocal(agora);
  let total = 0, deHoje = 0;
  for (const etapa of plano ? etapasEmOrdem(plano) : []) {
    const fim = concluidaEm(progresso, etapa);
    if (fim !== undefined) {
      total += xpDaEtapa(etapa);
      if (fim && diaLocal(new Date(fim)) === hoje) deHoje += xpDaEtapa(etapa);
    }
    total += etapa.tarefas.filter((t) => t.feita).length * XP.tarefa;
  }
  for (const r of cards.revisoes) {
    total += XP.revisao;
    if (diaLocal(new Date(r.em)) === hoje) deHoje += XP.revisao;
  }
  return { total, hoje: deHoje };
}

/** Meta de XP do dia: o tempo diário combinado na entrevista (25 min se não houver). */
export function metaDoDia(plano: Plano | null): number {
  return (plano?.minutosPorDia ?? 25) * XP.porMinuto;
}

/**
 * Estrelas de uma etapa (0 a 3): 1 ao concluir; 2 com a prática feita (todas as tarefas extras, se
 * houver); 3 com os cards dela revisados ao menos uma vez (se houver cards).
 */
export function estrelas(etapa: Etapa, progresso: Progresso, cards: Cards): number {
  if (progresso.etapas[etapa.id]?.estado !== "concluida") return 0;
  let n = 1;
  if (etapa.tarefas.every((t) => t.feita)) n++;
  const daEtapa = cards.cards.filter((c) => c.etapaId === etapa.id);
  const revisados = new Set(cards.revisoes.map((r) => r.cardId));
  if (n === 2 && daEtapa.length > 0 && daEtapa.every((c) => revisados.has(c.id))) n++;
  else if (n === 2 && daEtapa.length === 0) n++;
  return n;
}

/** Baú do módulo: abre quando todas as etapas dele estão concluídas. */
export function bauAberto(modulo: Modulo, progresso: Progresso): boolean {
  return modulo.etapas.length > 0 && modulo.etapas.every((e) => progresso.etapas[e.id]?.estado === "concluida");
}
