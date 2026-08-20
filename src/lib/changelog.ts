/**
 * Novidades de cada versão, na língua do usuário.
 *
 * **Regra do conteúdo: nada técnico.** Quem lê isto quer saber o que passou a
 * conseguir fazer, não o que mudou no código. Nome de biblioteca, nome de
 * arquivo, sigla de formato interno e "refatoração" ficam no roadmap e no git.
 * Se um item não puder ser dito como "agora dá para…" ou "isto parou de
 * atrapalhar", ele provavelmente não é novidade para o usuário.
 *
 * Como manter: ao subir a versão (`package.json`, `tauri.conf.json`,
 * `Cargo.toml` — ver CLAUDE.md), acrescente a entrada aqui **no topo**. Versão
 * sem entrada simplesmente não mostra o aviso; nada quebra.
 */

export interface Novidade {
  /** Igual ao `version` do `tauri.conf.json` — é por ele que o aviso casa. */
  versao: string;
  /** Data de publicação, já formatada em pt-BR (só aparece na lista). */
  data: string;
  /** Uma frase por novidade. Sem jargão, sem nome de biblioteca. */
  itens: string[];
}

/** Mais recente primeiro — a ordem da lista é a ordem daqui. */
export const NOVIDADES: Novidade[] = [
  {
    versao: "1.2.0",
    data: "18/08/2026",
    itens: [
      "Nova ferramenta Capturar site: varre um site inteiro (ou só a página que você indicar) e salva cada página em Markdown, HTML, texto e uma foto completa da tela, abrindo abas e menus escondidos e rolando a página sozinha pra não deixar nada de fora.",
      "No final da captura dá pra abrir a pasta com tudo ou baixar um ZIP com o site inteiro de uma vez.",
    ],
  },
  {
    versao: "1.1.0",
    data: "13/08/2026",
    itens: [
      "Nova ferramenta Vetorizar imagem: transforma um PNG ou JPG em um desenho que pode ser ampliado o quanto quiser sem ficar borrado.",
      "Nova ferramenta Aumentar qualidade: dobra ou quadruplica a resolução de uma foto usando a placa de vídeo.",
      "Nova ferramenta Remover fundo: deixa o fundo da imagem transparente sozinho, sem recorte manual.",
      "Agora dá para escolher a cor do aplicativo: são 8 cores, e ela vale para os ícones, o menu, a barra de rolagem e o fundo animado.",
      "O aviso de notificações não fica mais escondido atrás do conteúdo da tela.",
    ],
  },
  {
    versao: "1.0.1",
    data: "11/08/2026",
    itens: [
      "As prévias de imagem, vídeo e legenda voltaram a aparecer no aplicativo instalado.",
    ],
  },
  {
    versao: "1.0.0",
    data: "10/08/2026",
    itens: ["Primeira versão estável da suíte, com visual novo e todas as ferramentas reunidas."],
  },
  {
    versao: "0.2.0",
    data: "08/08/2026",
    itens: [
      "O aplicativo passou a se atualizar sozinho — não precisa mais baixar o instalador a cada versão.",
      "O instalador ficou bem menor: o pacote de vídeo e áudio só é baixado quando você usa uma ferramenta de mídia.",
    ],
  },
];

export function novidadesDaVersao(versao: string | null | undefined): Novidade | undefined {
  if (!versao) return undefined;
  return NOVIDADES.find((n) => n.versao === versao);
}

/**
 * Diz se o aviso de "o que há de novo" deve aparecer.
 *
 * Só aparece quando existe entrada para a versão instalada E ela ainda não foi
 * vista. Versão sem entrada não mostra nada: melhor silêncio que um aviso
 * vazio, e é o que garante que esquecer de escrever a novidade não vire bug.
 */
export function deveAvisar(
  versaoInstalada: string | null | undefined,
  ultimaVista: string | undefined
): boolean {
  return !!versaoInstalada && versaoInstalada !== ultimaVista && !!novidadesDaVersao(versaoInstalada);
}
