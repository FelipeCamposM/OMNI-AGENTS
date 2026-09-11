/**
 * Notas de versão mostradas em Configurações → Sobre.
 *
 * Entrada nova sempre no topo, escrita em linguagem de usuário — quem lê isso
 * é quem usa o app, não quem escreve o código.
 */
export interface EntradaChangelog {
  version: string;
  date: string;
  /** Marca a versão como beta e explica o que ainda não está pronto. */
  beta?: string;
  changes: string[];
}

export const CHANGELOG: EntradaChangelog[] = [
  {
    version: "0.3.1",
    date: "2026-09-10",
    beta: "Versão beta. A conexão com o celular ainda não está funcionando — a tela existe e você consegue ativar, mas o acesso pelo telefone não vai abrir. Não conte com ela ainda.",
    changes: [
      "Troca de agente direto no terminal, sem fechar a aba.",
      "Perfis de agente: cada agente guarda a própria configuração.",
      "Arraste as abas de arquivo para reorganizar ou abrir lado a lado.",
      "Painel de uso da conta mostra quanto você já consumiu.",
      "Novos fundos animados e ícones novos na barra lateral.",
      "A tela do celular volta a carregar sozinha quando você retorna para ela.",
    ],
  },
  {
    version: "0.2.0",
    date: "2026-09-09",
    changes: [
      "O app passa a se atualizar sozinho.",
      "Painel de arquivos com editor embutido.",
      "Vários workspaces, com troca rápida entre eles.",
    ],
  },
];
