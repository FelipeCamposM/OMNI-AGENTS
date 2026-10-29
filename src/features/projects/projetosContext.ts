import { createContext, useContext } from "react";
import { samePath } from "../../lib/paths";
import type { Project } from "../../types/workspace";

/** Projetos de todos os workspaces, para quem está longe do estado (a aba de conversa, a lateral)
 *  achar o projeto de uma pasta — com o ícone escolhido nele. */
export const ProjetosContext = createContext<readonly Project[]>([]);

export function useProjetoDaPasta(pasta: string | null | undefined): Project | null {
  const projetos = useContext(ProjetosContext);
  return pasta ? projetos.find((projeto) => samePath(projeto.path, pasta)) ?? null : null;
}
