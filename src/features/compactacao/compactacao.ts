import { request } from "../../mobile/api";

/** `GET/POST /compactacao` do engine. A janela vale para as sessões abertas depois de salvar. */
export interface Compactacao {
  /** Contexto em que o Claude compacta sozinho: 400 mil ou 1 milhão de tokens. */
  janela: 400_000 | 1_000_000;
  /** Compactar na conta atual, com o agente parado, quando o uso das 5 h passar de `limiar` %. */
  antes_do_limite: boolean;
  limiar: number;
  /** Depois da troca de conta, compactar antes de continuar. */
  depois_da_troca: boolean;
}

export const COMPACTACAO_PADRAO: Compactacao = { janela: 400_000, antes_do_limite: true, limiar: 85, depois_da_troca: true };

export async function lerCompactacao(): Promise<Compactacao> {
  try { return { ...COMPACTACAO_PADRAO, ...(await request<Compactacao>("/compactacao")) }; }
  catch { return COMPACTACAO_PADRAO; }
}

export function salvarCompactacao(ajuste: Compactacao) {
  return request<Compactacao>("/compactacao", {
    method: "POST", body: JSON.stringify(ajuste), headers: { "Content-Type": "application/json" },
  });
}

/** 132400 → "132k"; 1000000 → "1M". */
export function tokensCurtos(n: number): string {
  if (n >= 1_000_000) return `${+(n / 1_000_000).toFixed(1)}M`;
  return `${Math.round(n / 1000)}k`;
}
