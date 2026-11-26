/**
 * Fork (Roadmaps): pedido à IA pela CLI oficial (`roadmaps_ia` no Rust) e leitura da resposta.
 * Respostas estruturadas vêm em JSON; se o formato vier errado, devolve o erro uma vez para a IA
 * corrigir (como os Fluxos fazem).
 */
import { invoke } from "@tauri-apps/api/core";
import type { IaEscolhida } from "./tipos";

export const CANCELADO = "Pedido cancelado.";

export interface PedidoDeIa {
  /** Um pedido por chave; é por ela que fechar a tela cancela. */
  chave: string;
  ia: IaEscolhida;
  sistema: string;
  texto: string;
  web: boolean;
}

/** Como o pedido chega à CLI: no app, comando do Tauri; no celular/web, rota `/roadmaps/ia` do engine. */
export type TransporteDaIa = (pedido: { chave: string; cli: string; conta: string | null; modelo: string | null; sistema: string; texto: string; web: boolean }) => Promise<string>;
let transporte: TransporteDaIa = (pedido) => invoke<string>("roadmaps_ia", { pedido });
let cancelamento: (chave: string) => Promise<unknown> = (chave) => invoke("roadmaps_ia_cancelar", { chave });
export function usarTransporteDaIa(novo: TransporteDaIa, cancelar: (chave: string) => Promise<unknown>) { transporte = novo; cancelamento = cancelar; }

export async function perguntar(pedido: PedidoDeIa): Promise<string> {
  try {
    return await transporte({
      chave: pedido.chave, cli: pedido.ia.cli, conta: pedido.ia.conta || null, modelo: pedido.ia.modelo || null,
      sistema: pedido.sistema, texto: pedido.texto, web: pedido.web,
    });
  } catch (erro) {
    throw new Error(erro instanceof Error ? erro.message : String(erro));
  }
}

export function cancelar(chave: string) {
  void cancelamento(chave).catch(() => undefined);
}

export function foiCancelado(erro: unknown) {
  return erro instanceof Error && erro.message === CANCELADO;
}

/**
 * O primeiro objeto JSON da resposta: aceita cerca ```json e texto antes ou depois. JSON inválido
 * devolve `null` (e vira pedido de correção em `perguntarJson`).
 */
export function extrairJson(resposta: string): unknown {
  const cerca = resposta.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidatos = [cerca?.[1], resposta].filter((c): c is string => typeof c === "string");
  for (const bruto of candidatos) {
    const inicio = bruto.indexOf("{");
    if (inicio < 0) continue;
    // Do primeiro `{` até o `}` que fecha o nível, respeitando strings.
    let nivel = 0, emString = false, escape = false;
    for (let i = inicio; i < bruto.length; i++) {
      const c = bruto[i];
      if (emString) { if (escape) escape = false; else if (c === "\\") escape = true; else if (c === "\"") emString = false; continue; }
      if (c === "\"") emString = true;
      else if (c === "{") nivel++;
      else if (c === "}" && --nivel === 0) {
        try { return JSON.parse(bruto.slice(inicio, i + 1)); } catch { break; }
      }
    }
  }
  return null;
}

/**
 * Pede, lê como JSON e confere com `ler`. Se não servir, manda o erro de volta uma vez. `ler`
 * devolve o valor pronto ou uma string com o que estava errado.
 */
export async function perguntarJson<T>(pedido: PedidoDeIa, ler: (valor: unknown) => T | string): Promise<T> {
  const primeira = await perguntar(pedido);
  const lido = ler(extrairJson(primeira));
  if (typeof lido !== "string") return lido;
  const correcao = `${pedido.texto}\n\n---\nSua resposta anterior não serviu: ${lido}\nResponda de novo só com o JSON pedido, sem texto fora dele.`;
  const segunda = await perguntar({ ...pedido, texto: correcao });
  const relido = ler(extrairJson(segunda));
  if (typeof relido !== "string") return relido;
  throw new Error("A IA não respondeu no formato esperado; tente de novo");
}
