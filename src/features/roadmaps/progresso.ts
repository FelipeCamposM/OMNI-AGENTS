/**
 * Fork (Roadmaps): estado de cada etapa, etapa de hoje e sequência de dias. Funções puras: quem
 * grava é `armazenamento.ts`.
 *
 * Regra da trilha: uma etapa fica disponível quando todas as anteriores estão concluídas. O que já
 * foi começado ou concluído mantém o estado mesmo se o plano for reajustado e mudar a ordem.
 */
import type { Cards, Etapa, EstadoDaEtapa, Plano, Progresso, ResumoDoRoadmap } from "./tipos";
import { contarParaHoje } from "./revisao";

export function diaLocal(data: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${data.getFullYear()}-${p(data.getMonth() + 1)}-${p(data.getDate())}`;
}

function diaAnterior(dia: string): string {
  const [a, m, d] = dia.split("-").map(Number);
  return diaLocal(new Date(a, m - 1, d - 1));
}

export function etapasEmOrdem(plano: Plano): Etapa[] {
  return plano.modulos.flatMap((m) => m.etapas);
}

export function estadosDasEtapas(plano: Plano, progresso: Progresso): Record<string, EstadoDaEtapa> {
  const estados: Record<string, EstadoDaEtapa> = {};
  let anterioresConcluidas = true;
  for (const etapa of etapasEmOrdem(plano)) {
    const gravado = progresso.etapas[etapa.id]?.estado;
    estados[etapa.id] = gravado ?? (anterioresConcluidas ? "disponivel" : "bloqueada");
    if (gravado !== "concluida") anterioresConcluidas = false;
  }
  return estados;
}

/** A etapa para onde a trilha rola ao abrir: a em andamento, senão a primeira disponível, senão a última. */
export function etapaDeHoje(plano: Plano, progresso: Progresso): Etapa | undefined {
  const estados = estadosDasEtapas(plano, progresso);
  const etapas = etapasEmOrdem(plano);
  return etapas.find((e) => estados[e.id] === "andamento")
    ?? etapas.find((e) => estados[e.id] === "disponivel")
    ?? etapas[etapas.length - 1];
}

/** Dias seguidos com estudo terminando hoje (ou ontem: a sequência não quebra antes de o dia acabar). */
export function sequencia(dias: string[], hoje: string): number {
  const feitos = new Set(dias);
  let dia = feitos.has(hoje) ? hoje : diaAnterior(hoje);
  let n = 0;
  while (feitos.has(dia)) { n++; dia = diaAnterior(dia); }
  return n;
}

export function marcarDia(progresso: Progresso, dia: string): Progresso {
  if (progresso.dias.includes(dia)) return progresso;
  return { ...progresso, dias: [...progresso.dias, dia].sort() };
}

export function iniciarEtapa(progresso: Progresso, etapaId: string, agora: Date): Progresso {
  if (progresso.etapas[etapaId]) return progresso;
  return { ...progresso, etapas: { ...progresso.etapas, [etapaId]: { estado: "andamento", inicio: agora.toISOString() } } };
}

export function concluirEtapa(progresso: Progresso, etapaId: string, agora: Date): Progresso {
  const atual = progresso.etapas[etapaId];
  if (atual?.estado === "concluida") return progresso;
  const etapas = { ...progresso.etapas, [etapaId]: { estado: "concluida" as const, inicio: atual?.inicio ?? agora.toISOString(), fim: agora.toISOString() } };
  return marcarDia({ ...progresso, etapas }, diaLocal(agora));
}

/** Volta uma etapa concluída para "em andamento" (clique errado em concluir). */
export function reabrirEtapa(progresso: Progresso, etapaId: string): Progresso {
  const atual = progresso.etapas[etapaId];
  if (atual?.estado !== "concluida") return progresso;
  return { ...progresso, etapas: { ...progresso.etapas, [etapaId]: { estado: "andamento", ...(atual.inicio ? { inicio: atual.inicio } : {}) } } };
}

export function resumir(plano: Plano | null, progresso: Progresso, cards: Cards, agora: Date): ResumoDoRoadmap {
  const hoje = diaLocal(agora);
  const etapas = plano ? etapasEmOrdem(plano) : [];
  const concluidas = etapas.filter((e) => progresso.etapas[e.id]?.estado === "concluida").length;
  const resumo: ResumoDoRoadmap = { etapas: etapas.length, concluidas, sequencia: sequencia(progresso.dias, hoje), cardsParaHoje: contarParaHoje(cards, agora) };
  const ultimo = progresso.dias[progresso.dias.length - 1];
  if (ultimo) resumo.ultimoDia = ultimo;
  const proxima = plano && concluidas < etapas.length ? etapaDeHoje(plano, progresso) : undefined;
  if (proxima) resumo.proximaEtapa = proxima.titulo;
  return resumo;
}

/** Ids das etapas já começadas ou concluídas que sumiram de um plano novo (o reajuste não pode apagá-las sem aviso). */
export function etapasComProgressoQueSomem(atual: Plano, novo: Plano, progresso: Progresso): Etapa[] {
  const novos = new Set(etapasEmOrdem(novo).map((e) => e.id));
  return etapasEmOrdem(atual).filter((e) => progresso.etapas[e.id] && !novos.has(e.id));
}
