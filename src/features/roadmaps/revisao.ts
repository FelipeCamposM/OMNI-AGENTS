/**
 * Fork (Roadmaps): revisão espaçada com FSRS (`ts-fsrs`, MIT). Cards e registro em `cards.json`.
 * Notas: 1 errei, 2 difícil, 3 bom, 4 fácil (o `Rating` do FSRS).
 */
import { createEmptyCard, fsrs, type Card, type CardInput, type Grade } from "ts-fsrs";
import type { CardDeRevisao, Cards } from "./tipos";

/** Sem fuzz: o mesmo histórico dá sempre o mesmo próximo dia (e os testes ficam estáveis). */
const agendador = fsrs({ enable_fuzz: false });
const REGISTRO_MAXIMO = 5000;

export type Nota = 1 | 2 | 3 | 4;
export const NOTAS: { nota: Nota; rotulo: string }[] = [
  { nota: 1, rotulo: "Errei" }, { nota: 2, rotulo: "Difícil" }, { nota: 3, rotulo: "Bom" }, { nota: 4, rotulo: "Fácil" },
];

function paraDisco(card: Card): CardDeRevisao["fsrs"] {
  return {
    due: card.due.toISOString(),
    stability: card.stability,
    difficulty: card.difficulty,
    elapsed_days: card.elapsed_days,
    scheduled_days: card.scheduled_days,
    learning_steps: card.learning_steps,
    reps: card.reps,
    lapses: card.lapses,
    state: card.state,
    last_review: card.last_review ? card.last_review.toISOString() : null,
  };
}

function idDoCard(agora: Date, n: number): string {
  return `c-${agora.getTime().toString(36)}-${n.toString(36)}-${Math.floor(Math.random() * 0xffff).toString(16)}`;
}

/** Cards novos de uma etapa (frente/verso iguais a um que já existe não entram de novo). */
export function adicionarCards(cards: Cards, etapaId: string, novos: { frente: string; verso: string }[], agora: Date): { cards: Cards; adicionados: number } {
  const existentes = new Set(cards.cards.map((c) => `${c.frente.toLowerCase()}\u0000${c.verso.toLowerCase()}`));
  const criados: CardDeRevisao[] = [];
  for (const { frente, verso } of novos) {
    const chave = `${frente.toLowerCase()}\u0000${verso.toLowerCase()}`;
    if (!frente.trim() || !verso.trim() || existentes.has(chave)) continue;
    existentes.add(chave);
    criados.push({ id: idDoCard(agora, cards.cards.length + criados.length), etapaId, frente, verso, criadoEm: agora.toISOString(), fsrs: paraDisco(createEmptyCard(agora)) });
  }
  return { cards: { ...cards, cards: [...cards.cards, ...criados] }, adicionados: criados.length };
}

function fimDoDia(agora: Date): number {
  return new Date(agora.getFullYear(), agora.getMonth(), agora.getDate() + 1).getTime();
}

/** Fila de agora: cards vencidos, os mais atrasados primeiro. */
export function filaDeAgora(cards: Cards, agora: Date): CardDeRevisao[] {
  const t = agora.getTime();
  return cards.cards.filter((c) => Date.parse(c.fsrs.due) <= t).sort((a, b) => Date.parse(a.fsrs.due) - Date.parse(b.fsrs.due));
}

/** Quantos vencem até o fim do dia (inclui os de "daqui a 10 min" do aprendizado). */
export function contarParaHoje(cards: Cards, agora: Date): number {
  const fim = fimDoDia(agora);
  return cards.cards.filter((c) => Date.parse(c.fsrs.due) < fim).length;
}

/** Próximo card que vence hoje, para dizer "o próximo volta em 10 min". */
export function proximoDeHoje(cards: Cards, agora: Date): CardDeRevisao | undefined {
  const fim = fimDoDia(agora), t = agora.getTime();
  return cards.cards.filter((c) => { const d = Date.parse(c.fsrs.due); return d > t && d < fim; })
    .sort((a, b) => Date.parse(a.fsrs.due) - Date.parse(b.fsrs.due))[0];
}

export function responder(cards: Cards, cardId: string, nota: Nota, agora: Date): Cards {
  const i = cards.cards.findIndex((c) => c.id === cardId);
  if (i < 0) return cards;
  const { card } = agendador.next(cards.cards[i].fsrs as CardInput, agora, nota as Grade);
  const lista = cards.cards.slice();
  lista[i] = { ...cards.cards[i], fsrs: paraDisco(card) };
  const revisoes = [...cards.revisoes, { cardId, nota, em: agora.toISOString() }].slice(-REGISTRO_MAXIMO);
  return { ...cards, cards: lista, revisoes };
}

/** "10 min", "1 h", "3 d", "2 meses": quando o card volta com cada nota (rótulo dos botões). */
export function previa(card: CardDeRevisao, agora: Date): Record<Nota, string> {
  const resultado = agendador.repeat(card.fsrs as CardInput, agora);
  const rotulo = (due: Date) => {
    const min = Math.max(1, Math.round((due.getTime() - agora.getTime()) / 60_000));
    if (min < 60) return `${min} min`;
    if (min < 24 * 60) return `${Math.round(min / 60)} h`;
    const dias = Math.round(min / (24 * 60));
    if (dias < 31) return `${dias} d`;
    if (dias < 365) return `${Math.round(dias / 30)} ${Math.round(dias / 30) === 1 ? "mês" : "meses"}`;
    return `${Math.round(dias / 365)} a`;
  };
  return { 1: rotulo(resultado[1].card.due), 2: rotulo(resultado[2].card.due), 3: rotulo(resultado[3].card.due), 4: rotulo(resultado[4].card.due) };
}

export function removerCard(cards: Cards, cardId: string): Cards {
  return { ...cards, cards: cards.cards.filter((c) => c.id !== cardId) };
}
