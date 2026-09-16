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
    version: "0.4.4",
    date: "2026-09-16",
    changes: [
      "Nova tela de Skills nas configurações: instale, ative, desative e remova skills por conta ou por projeto.",
      "As abas agora mostram o ícone do agente, e o terminal identifica o modelo e o nível de esforço em uso na conversa.",
      "O painel de uso reconhece melhor cada agente e atualiza os limites da conta sem deixar processos ocultos abertos.",
      "O painel Git diferencia corretamente arquivos preparados e não preparados e explica quando ainda não há nada para commitar.",
      "Melhorias de legibilidade e identificação dos agentes no desktop e no celular.",
    ],
  },
  {
    version: "0.4.3",
    date: "2026-09-15",
    changes: [
      "Arraste qualquer aba para outro painel ou para a borda de um painel: uma prévia mostra onde ela vai ficar antes de soltar.",
      "Reiniciar uma sessão parada do Claude volta para a mesma conversa, sem precisar abrir o histórico.",
      "O uso da conta do Claude no rodapé carrega de forma confiável e mostra o horário exato em que o limite renova.",
      "A transparência do fundo dos terminais passa a deixar ver o fundo do app de verdade.",
    ],
  },
  {
    version: "0.4.2",
    date: "2026-09-15",
    changes: [
      "A conversa no celular virou um chat: suas mensagens e as do agente em balões, e um aviso animado enquanto ele trabalha.",
      "Adicionar o OMNI à tela inicial do celular agora mostra o ícone do app.",
      "O app da tela inicial do iPhone pode ser liberado com o código de 6 dígitos do Authy, em Configurações → Celular.",
      "Sessões abertas pelo celular começam a funcionar na hora, sem ficar travadas.",
      "O endereço do celular usa o Tailscale automaticamente e o botão de liberar o acesso seguro volta a abrir o navegador.",
      "Nova tela de Histórico: encontre e retome conversas antigas do Claude e do Codex.",
      "Ctrl+P abre a busca rápida de arquivos do projeto.",
      "A árvore de arquivos se atualiza sozinha e permite criar arquivos e pastas direto nela.",
      "Os avisos só aparecem quando o agente termina ou pede aprovação.",
      "Ajuste de transparência do fundo dos terminais em Configurações.",
      "Rodar o OMNI em modo de desenvolvimento dentro de um terminal do app instalado não mistura mais os dois.",
    ],
  },
  {
    version: "0.4.0",
    date: "2026-09-14",
    changes: [
      "Acesso pelo celular com configuração guiada e conexão pelo Tailscale.",
      "Melhorias no carregamento das conversas e na reconexão pelo celular.",
      "Novos ícones para identificar arquivos e pastas com mais facilidade.",
      "Correções na criação de terminais e na troca de abas do workspace.",
      "O ambiente de desenvolvimento deixa de interromper as sessões do app instalado.",
      "O instalador atualiza corretamente o serviço que mantém os terminais e o acesso pelo celular.",
    ],
  },
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
