/**
 * Conversão entre o texto "1-3, 7, 10-12" e uma seleção de páginas.
 *
 * O parser é tolerante de propósito: o campo é editado enquanto o usuário
 * digita, então "1-" ou "3," no meio da frase são ignorados em vez de virarem
 * erro. Quem valida de verdade é o `pdf_split`/`pdf_pages` no Python.
 */

export type PageRange = [number, number];

/** "1-3, 7" → [[1,3],[7,7]]. Tokens incompletos/ inválidos somem. */
export function parseRanges(text: string, max?: number): PageRange[] {
  const out: PageRange[] = [];

  for (const token of text.split(/[,;\s]+/)) {
    if (!token) continue;
    const m = /^(\d+)(?:-(\d+))?$/.exec(token);
    if (!m) continue;

    let ini = Number(m[1]);
    let fim = m[2] === undefined ? ini : Number(m[2]);
    if (ini > fim) [ini, fim] = [fim, ini];
    if (ini < 1) ini = 1;
    if (max !== undefined) {
      if (ini > max) continue;
      if (fim > max) fim = max;
    }
    out.push([ini, fim]);
  }

  return out;
}

/** Mesmo texto, achatado em páginas individuais. */
export function parseSelection(text: string, max?: number): Set<number> {
  const set = new Set<number>();
  for (const [ini, fim] of parseRanges(text, max)) {
    for (let p = ini; p <= fim; p++) set.add(p);
  }
  return set;
}

/** [1,2,3,7,10,11] → "1-3, 7, 10-11". Ordena e remove duplicatas. */
export function formatSelection(pages: Iterable<number>): string {
  const sorted = [...new Set(pages)].sort((a, b) => a - b);
  if (sorted.length === 0) return "";

  const parts: string[] = [];
  let ini = sorted[0];
  let prev = sorted[0];

  for (const p of sorted.slice(1)) {
    if (p === prev + 1) {
      prev = p;
      continue;
    }
    parts.push(ini === prev ? `${ini}` : `${ini}-${prev}`);
    ini = p;
    prev = p;
  }
  parts.push(ini === prev ? `${ini}` : `${ini}-${prev}`);

  return parts.join(", ");
}

/** Marca/desmarca uma página, devolvendo um Set novo. */
export function togglePage(selected: Set<number>, page: number): Set<number> {
  const next = new Set(selected);
  if (!next.delete(page)) next.add(page);
  return next;
}
