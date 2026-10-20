import { request } from "./api";

/**
 * Linha que separa o texto do usuário da lista de anexos no prompt. O agente lê os caminhos e abre
 * os arquivos com as próprias ferramentas — é assim que as CLIs recebem arquivo. O desktop cola
 * imagem pelo clipboard do PC, que o celular não alcança.
 */
export const MARCADOR_ANEXOS = "[Anexos enviados pelo OMNI]";
/** O marcador das versões anteriores — mensagens antigas continuam virando cartões. */
const MARCADORES_ANTIGOS = ["[Anexos enviados pelo celular]"];

/** Evento que entrega arquivos a uma conversa aberta (`detail: File[]`). O app do PC usa: o arrastar
 *  do Windows chega pelo Tauri como caminhos, fora dos eventos de soltar do navegador. */
export const EVENTO_ANEXAR = "omni:anexar";
/** `detail: boolean` — arquivo sendo arrastado por cima da conversa (mostra "Solte para anexar"). */
export const EVENTO_ARRASTANDO = "omni:arrastando";
/** `detail: string` — arquivo citado na conversa, como o agente escreveu (relativo ao projeto ou
 *  absoluto, talvez com `:linha`). O app do PC abre num painel. */
export const EVENTO_ABRIR_ARQUIVO = "omni:abrir-arquivo";

/** Tipo pelo nome do arquivo, para quem só tem o caminho (o arrastar do app do PC). */
export function tipoPelaExtensao(nome: string): string {
  const ext = nome.split(".").pop()?.toLowerCase() ?? "";
  const tipos: Record<string, string> = {
    pdf: "application/pdf", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp",
    svg: "image/svg+xml", bmp: "image/bmp", csv: "text/csv", tsv: "text/tab-separated-values", txt: "text/plain",
    md: "text/markdown", json: "application/json", xml: "application/xml", html: "text/html", yaml: "text/yaml", yml: "text/yaml",
    xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", xls: "application/vnd.ms-excel",
    docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", doc: "application/msword",
    pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation", odt: "application/vnd.oasis.opendocument.text",
    ods: "application/vnd.oasis.opendocument.spreadsheet", zip: "application/zip",
  };
  return tipos[ext] ?? "application/octet-stream";
}

/** Espelha `ANEXO_MAX_BYTES` do engine: recusar aqui evita subir 40 MB no 4G para levar um 413. */
export const ANEXO_MAX_BYTES = 25 * 1024 * 1024;

export interface Anexo {
  id: string;
  arquivo: File;
  /** URL local da prévia, só para imagem. Revogada quando o anexo sai da tela. */
  previa: string | null;
  estado: "pronto" | "enviando" | "enviado" | "erro";
  /** Caminho no PC depois do upload. Guardado para um reenvio não subir o arquivo de novo. */
  caminho?: string;
  erro?: string;
}

let sequencia = 0;

export function criarAnexo(arquivo: File): Anexo {
  const grande = arquivo.size > ANEXO_MAX_BYTES;
  return {
    id: `anexo-${Date.now()}-${sequencia++}`,
    arquivo,
    previa: arquivo.type.startsWith("image/") && !grande ? URL.createObjectURL(arquivo) : null,
    estado: grande ? "erro" : "pronto",
    erro: grande ? `Maior que ${tamanhoLegivel(ANEXO_MAX_BYTES)}` : undefined,
  };
}

export function descartarAnexo(anexo: Anexo) {
  if (anexo.previa) URL.revokeObjectURL(anexo.previa);
}

export function tamanhoLegivel(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} MB`;
}

/** Nome para mostrar a partir do caminho no PC: tira a pasta e o prefixo `<data>-<id>-` que o
 *  engine põe para dois "image.png" não se sobrescreverem. */
export function nomeDoCaminho(caminho: string): string {
  const base = caminho.split(/[\\/]/).pop() ?? caminho;
  return base.replace(/^\d{10,}-[0-9a-f]{4}-/, "");
}

export function montarPrompt(texto: string, caminhos: string[]): string {
  const corpo = texto.trim();
  if (caminhos.length === 0) return corpo;
  const lista = [MARCADOR_ANEXOS, ...caminhos.map((caminho) => `- ${caminho}`)].join("\n");
  // Só anexo, sem texto: o marcador abre a mensagem — nunca um caminho, que no Mac/Linux começa com
  // `/` e o engine recusaria como comando.
  return corpo ? `${corpo}\n\n${lista}` : lista;
}

/** O inverso de `montarPrompt`, para o chat mostrar o texto e os anexos como cartões. Mensagem que
 *  só por acaso contém o marcador, sem a lista logo depois, fica intacta. */
export function separarAnexos(texto: string): { texto: string; anexos: string[] } {
  const marcador = [MARCADOR_ANEXOS, ...MARCADORES_ANTIGOS].find((m) => texto.includes(m));
  if (!marcador) return { texto, anexos: [] };
  const inicio = texto.lastIndexOf(marcador);
  const linhas = texto.slice(inicio + marcador.length).split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  // `-` sozinho: a CLI trocou o caminho de uma imagem por `[Image #N]` e guardou a imagem à parte —
  // ela aparece pela própria mensagem, não como cartão.
  if (linhas.length === 0 || !linhas.every((l) => l === "-" || l.startsWith("- "))) return { texto, anexos: [] };
  return { texto: texto.slice(0, inicio).trimEnd(), anexos: linhas.filter((l) => l !== "-").map((l) => l.slice(2)) };
}

/** Tira os `[Image #N]` que a CLI deixa no lugar da imagem colada: a imagem é mostrada de verdade. */
export function semMarcasDeImagem(texto: string): string {
  return texto.replace(/\[Image #\d+\]/g, "").replace(/[ \t]+\n/g, "\n").trim();
}

/** Sobe um arquivo para a pasta do projeto da conversa no PC e devolve o caminho gravado lá. */
export async function enviarAnexo(conversa: string, arquivo: File): Promise<string> {
  const resposta = await request<{ caminho: string }>(`/conversas/${encodeURIComponent(conversa)}/anexos`, {
    method: "POST",
    body: arquivo,
    headers: {
      "Content-Type": arquivo.type || "application/octet-stream",
      // Cabeçalho HTTP não carrega acento: vai codificado e o engine decodifica.
      "X-Omni-Nome": encodeURIComponent(arquivo.name || "anexo"),
    },
    // Foto de câmera no 4G passa fácil dos 15 s padrão.
    signal: AbortSignal.timeout(180_000),
  });
  return resposta.caminho;
}
