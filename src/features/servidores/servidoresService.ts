import { invoke } from "@tauri-apps/api/core";

/** Projeto com servidor local de pé (`src-tauri/src/servidores.rs`), agrupado por pasta. */
export interface ServidorLocal {
  pasta: string;
  nome: string;
  /** "Vite", "Next", "Django"… ou o programa ("node") quando não reconhece. */
  tipo: string;
  portas: number[];
  pids: number[];
  comando: string;
  /** O próprio OMNI em `npm run dev`: sem botão de derrubar. */
  proprio: boolean;
}

export const servidoresLocais = () => invoke<ServidorLocal[]>("servidores_locais");
export const matarServidor = (pasta: string) => invoke<void>("servidor_matar", { pasta });

/** Apelidos por pasta (a porta muda de um `npm run dev` para outro; a pasta não). */
const CHAVE = "omni-servidores-apelidos";

export function lerApelidos(): Record<string, string> {
  try {
    return JSON.parse(localStorage.getItem(CHAVE) ?? "{}") as Record<string, string>;
  } catch {
    return {};
  }
}

export function salvarApelido(pasta: string, apelido: string) {
  const apelidos = lerApelidos();
  if (apelido.trim()) apelidos[pasta] = apelido.trim();
  else delete apelidos[pasta];
  try { localStorage.setItem(CHAVE, JSON.stringify(apelidos)); } catch { /* sem armazenamento: vale só nesta sessão */ }
  return apelidos;
}
