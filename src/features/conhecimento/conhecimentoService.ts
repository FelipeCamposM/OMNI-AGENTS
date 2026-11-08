import { invoke } from "@tauri-apps/api/core";

export interface FonteDeConhecimento {
  id: number;
  nome: string;
  caminho: string;
  tipo: string;
  tamanho: number;
  trechos: number;
  estado: "importando" | "pronto" | "erro";
  erro: string | null;
  criado_em_ms: number;
}

export interface ResultadoDeBusca {
  id: number;
  fonte: string;
  titulo: string;
  resumo: string;
}

export const listarFontes = () => invoke<FonteDeConhecimento[]>("rag_listar");
export const adicionarArquivos = (caminhos: string[]) => invoke<void>("rag_adicionar", { caminhos });
export const removerFonte = (id: number) => invoke<void>("rag_remover", { id });
export const buscarConhecimento = (consulta: string) => invoke<ResultadoDeBusca[]>("rag_buscar", { consulta });
export const claudeUsaABase = () => invoke<boolean>("rag_claude_ligado");
export const ligarBaseNoClaude = (ligado: boolean) => invoke<void>("rag_claude_ligar", { ligado });

export interface EstadoDaMemoria {
  ligada: boolean;
  notas: number;
}

export const estadoDaMemoria = () => invoke<EstadoDaMemoria>("rag_memoria_estado");
export const ligarMemoria = (ligada: boolean) => invoke<void>("rag_memoria_ligar", { ligada });

export function tamanhoLegivel(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
}
