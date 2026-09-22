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
    version: "0.5.2",
    date: "2026-09-22",
    changes: [
      "O terminal responde na hora ao que você digita: o atraso entre a tecla e a letra na tela praticamente sumiu.",
      "A janela não trava mais de tempos em tempos enquanto o painel Git consulta o repositório — isso atrapalhava justamente quem estava digitando.",
      "Os avisos da seção Atenção param de reaparecer depois de lidos. Agora eles só voltam quando o agente termina algo novo, pede aprovação ou esbarra num limite.",
      "Renomear uma aba não reinicia mais o terminal dela.",
    ],
  },
  {
    version: "0.5.1",
    date: "2026-09-21",
    changes: [
      "As abas de agente mostram o nome da conversa em vez de “Claude · agent”: assim que você manda a primeira mensagem, a aba passa a exibir do que ela trata.",
      "Renomeie uma conversa com duplo clique na aba, na lista lateral, no Histórico ou pelo celular. O nome que você escrever vale em todos os lugares e não é trocado depois.",
      "Pelo celular e pelo navegador, alterne o agente entre modo plano e automático — o mesmo que o Shift+Tab faz no terminal. O modo em uso aparece ao lado do modelo.",
      "Nova página para computador em /pc: abra pelo navegador do notebook e acompanhe projetos, conversas e pendências lado a lado, com o mesmo código de acesso do celular.",
      "Instale o Claude, o Codex, o Cursor ou o Tailscale direto do app quando faltar, com o comando oficial de cada um à mão.",
      "O app encontra as CLIs recém-instaladas sem precisar reiniciar o computador nem editar o PATH.",
    ],
  },
  {
    version: "0.5.0",
    date: "2026-09-18",
    changes: [
      "Nova seção Docker na barra lateral: veja seus containers agrupados por projeto e inicie, pare, reinicie ou remova com um clique. Os logs e o shell do container abrem num terminal do app.",
      "Abra projetos que estão no WSL ou num servidor por SSH. O agente continua sendo o do seu PC, mas os comandos e o Git rodam onde o código está.",
      "A tela de abrir projeto mostra os projetos recentes.",
      "A branch atual aparece no rodapé: troque de branch, crie uma nova (Ctrl+Shift+B) ou puxe as mudanças com um clique.",
      "Nova seção Atalhos nas configurações: troque qualquer atalho do teclado, inclusive o Ctrl+P.",
      "As configurações ganharam um botão Fechar (ou Esc) que volta exatamente para onde você estava.",
      "Os avisos da seção Atenção podem ser dispensados pelo X, sem precisar abrir o agente.",
      "Mensagens com anexo mandadas pelo celular agora são enviadas de verdade, em vez de ficarem só digitadas no PC.",
    ],
  },
  {
    version: "0.4.5",
    date: "2026-09-17",
    changes: [
      "No celular, anexe qualquer arquivo pelo clipe ou cole prints e imagens direto na mensagem para o agente.",
      "O app do celular ganhou a mesma cara do PC, com a cor e o tema claro ou escuro que você escolheu aqui.",
      "Atualizar a página no celular mantém você na conversa aberta, e o gesto de voltar anda entre as telas.",
      "As conversas longas no celular abrem já nas mensagens mais recentes.",
      "O código QR do celular volta a abrir: o endereço seguro não some mais do Tailscale.",
      "O Git Graph foi redesenhado: ramos coloridos, etiquetas de branch e tag, autor, data e cópia do hash com um clique.",
      "A logo do app e o ícone na barra de tarefas acompanham a cor escolhida.",
      "Feche abas clicando com o botão do meio do mouse.",
      "O painel Git se atualiza sozinho quando o agente muda arquivos e permite commitar tudo de uma vez.",
      "Em Novo agente, escolha qual conversa antiga retomar em vez de só a última.",
      "Terminais que ficavam pretos depois de reabrir o app voltam para a sessão sozinhos.",
    ],
  },
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
