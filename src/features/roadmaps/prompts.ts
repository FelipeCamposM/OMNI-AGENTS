/**
 * Fork (Roadmaps): o que a IA recebe em cada momento e como a resposta é lida. Cada `ler*` devolve o
 * valor pronto ou uma string dizendo o que estava errado (vai de volta para a IA corrigir).
 */
import { normalizarFonte, normalizarPlano, normalizarTarefas } from "./normalizar";
import { estadosDasEtapas, etapasEmOrdem } from "./progresso";
import type { EntrevistaSalva, Etapa, Fonte, MensagemDoPainel, Plano, Progresso } from "./tipos";

/** Máximo de perguntas antes de montar o plano de qualquer jeito. */
export const PERGUNTAS_MAXIMAS = 12;

const BASE = `Você é um mentor de estudos experiente, direto e didático. Fala em português do Brasil.
Você ajuda a pessoa a montar e seguir um caminho de estudo dentro do app OMNI AGENTS, que mostra o caminho como uma trilha de fases (módulos com etapas de um dia).`;

export const SISTEMA_DA_ENTREVISTA = `${BASE}

Agora você está entrevistando a pessoa para montar o caminho. Faça UMA pergunta por vez, curta e concreta, até ter o suficiente para um plano completo e realista. Cubra, na ordem que fizer sentido e sem repetir o que já foi respondido:
- o que exatamente ela quer conseguir fazer (objetivo concreto e mensurável) e por quê;
- nível atual e experiência prévia no assunto;
- contexto específico (ex.: em vendas, B2B ou B2C, ticket, ciclo; numa matéria, a ementa ou a prova);
- prazo ou data importante;
- quantos minutos por dia e quantos dias por semana dá para estudar;
- como aprende melhor (ler, vídeo, prática, áudio, exercícios) e idioma dos conteúdos (só português ou também inglês);
- orçamento para conteúdo pago (nada, pouco, à vontade).
Ofereça 2 a 5 respostas rápidas em "opcoes" quando fizer sentido (a pessoa pode escrever outra).
Quando já tiver o suficiente (no máximo ${PERGUNTAS_MAXIMAS} perguntas), responda com "pronto".

Responda SÓ com um JSON, sem texto fora dele, num destes formatos:
{"tipo":"pergunta","pergunta":"...","opcoes":["...","..."]}
{"tipo":"pronto","resumo":"o que você entendeu, em 2 a 4 frases"}`;

const FORMATO_DO_PLANO = `{"objetivo":"...","visao":"para quem é e como o caminho funciona, 1 a 2 frases","prazo":"...","minutosPorDia":30,
 "modulos":[{"id":"m-...","titulo":"...","descricao":"...","etapas":[
   {"id":"e-...","titulo":"...","objetivo":"o que a pessoa sabe fazer ao fim da etapa","minutos":25,"tarefa":"tarefa prática concreta do dia",
    "fontes":[{"titulo":"...","url":"https://...","tipo":"artigo|video|curso|livro|podcast|ferramenta","gratis":true,"autor":"...","nota":"por que esta fonte"}]}]}]}`;

export const SISTEMA_DO_PLANO = `${BASE}

Monte (ou reajuste) o caminho completo. Regras:
- Do básico ao objetivo, em módulos com etapas de UM dia cada, cabendo no tempo diário da pessoa. Cada etapa tem objetivo claro e uma tarefa prática.
- Quantidade realista para o prazo e o tempo por dia (normalmente 3 a 8 módulos, 3 a 10 etapas cada).
- Fontes: use a busca na web para achar as MELHORES fontes reais e atuais (artigos, vídeos do YouTube, cursos, livros). Nunca invente link: só ponha URL que você viu na busca. Marque "gratis": false para conteúdo pago. Respeite o orçamento e o idioma pedidos. 1 a 3 fontes por etapa bastam; o resumo completo de cada etapa é feito depois.
- Ao reajustar, mantenha o "id" das etapas que continuam (o progresso está ligado a eles) e não remova etapas já concluídas ou começadas, a menos que a pessoa peça.
- Ids: letras minúsculas, números e hífen.

Responda SÓ com um JSON neste formato, sem texto fora dele:
${FORMATO_DO_PLANO}`;

export const SISTEMA_DA_ETAPA = `${BASE}

Prepare uma etapa para a pessoa estudar ali mesmo. Use a busca na web para conferir fatos e achar as melhores fontes reais (nunca invente link). Responda SÓ com um JSON:
{"resumo":"markdown com a explicação completa e didática da etapa: conceitos, exemplos, passo a passo, erros comuns e um mini-exercício; títulos com ##","tarefa":"tarefa prática concreta","fontes":[{"titulo":"...","url":"https://...","tipo":"artigo|video|curso|livro|podcast|ferramenta","gratis":true,"autor":"...","nota":"..."}]}`;

export const SISTEMA_DOS_CARDS = `${BASE}

Crie cards de revisão espaçada sobre a etapa: perguntas curtas e específicas na frente, resposta objetiva no verso (uma ideia por card, nada de "explique tudo sobre"). Entre 6 e 15 cards. Responda SÓ com um JSON:
{"cards":[{"frente":"...","verso":"..."}]}`;

export const SISTEMA_DAS_TAREFAS = `${BASE}

Crie exercícios práticos extras para a etapa, do mais simples ao mais desafiador, cada um feito em 5 a 20 minutos e com critério claro de "feito". Entre 3 e 6. Responda SÓ com um JSON:
{"tarefas":[{"texto":"..."}]}`;

export const SISTEMA_DO_PAINEL = `${BASE}

Você está no painel ao lado da trilha: tire dúvidas, aprofunde a etapa, dê exemplos e exercícios, e ajude a reajustar o caminho. Responda em markdown, curto e útil.
Se a pessoa pedir para mudar o caminho (atraso, ficou fácil, mudou o objetivo), proponha o plano inteiro novo num bloco assim, no fim da resposta (o app pede confirmação antes de aplicar):
\`\`\`plano
${FORMATO_DO_PLANO}
\`\`\`
Mantenha os ids das etapas que continuam. Se a pessoa pedir exercícios para guardar na etapa, ponha num bloco:
\`\`\`tarefas
{"tarefas":[{"texto":"..."}]}
\`\`\`
Use a busca na web quando precisar de fontes ou fatos atuais; nunca invente link.`;

function transcricao(e: EntrevistaSalva): string {
  return e.mensagens.map((m) => `${m.de === "ia" ? "Mentor" : "Pessoa"}: ${m.texto}`).join("\n");
}

export function pedidoDaEntrevista(e: EntrevistaSalva): string {
  const perguntas = e.mensagens.filter((m) => m.de === "ia").length;
  const limite = perguntas >= PERGUNTAS_MAXIMAS ? "\n\nVocê já fez o máximo de perguntas: responda com \"pronto\" agora." : "";
  return `O que a pessoa quer estudar: ${e.pedido}\n\nConversa até agora:\n${transcricao(e) || "(nenhuma pergunta ainda)"}${limite}`;
}

export type TurnoDaEntrevista = { tipo: "pergunta"; pergunta: string; opcoes: string[] } | { tipo: "pronto"; resumo: string };

export function lerTurno(v: unknown): TurnoDaEntrevista | string {
  const o = (v && typeof v === "object" ? v : {}) as Record<string, unknown>;
  if (o.tipo === "pronto") return { tipo: "pronto", resumo: typeof o.resumo === "string" ? o.resumo.trim().slice(0, 2000) : "" };
  const pergunta = typeof o.pergunta === "string" ? o.pergunta.trim() : "";
  if (o.tipo === "pergunta" && pergunta) {
    const opcoes = Array.isArray(o.opcoes) ? o.opcoes.filter((x): x is string => typeof x === "string" && x.trim() !== "").map((x) => x.trim().slice(0, 120)).slice(0, 5) : [];
    return { tipo: "pergunta", pergunta: pergunta.slice(0, 1200), opcoes };
  }
  return "esperava {\"tipo\":\"pergunta\",...} ou {\"tipo\":\"pronto\",...}";
}

function planoEmTexto(plano: Plano, progresso?: Progresso): string {
  const estados = progresso ? estadosDasEtapas(plano, progresso) : {};
  const copia = {
    ...plano,
    modulos: plano.modulos.map((m) => ({ ...m, etapas: m.etapas.map((e) => ({ ...e, ...(estados[e.id] && progresso?.etapas[e.id] ? { estado: estados[e.id] } : {}) })) })),
  };
  return JSON.stringify(copia);
}

export function pedidoDoPlano(e: EntrevistaSalva, ajuste?: { pedido: string; atual: Plano; progresso?: Progresso }): string {
  const base = `O que a pessoa quer estudar: ${e.pedido}\n\nEntrevista:\n${transcricao(e)}`;
  if (!ajuste) return `${base}\n\nMonte o caminho completo.`;
  return `${base}\n\nPlano atual (com o estado das etapas já começadas):\n${planoEmTexto(ajuste.atual, ajuste.progresso)}\n\nAjuste pedido: ${ajuste.pedido}\n\nDevolva o plano inteiro reajustado.`;
}

export function lerPlano(v: unknown): Plano | string {
  const plano = normalizarPlano(v);
  if (!plano) return "o plano precisa de \"modulos\" com \"titulo\" e \"etapas\" (cada etapa com \"titulo\")";
  return plano;
}

function contextoDaEtapa(plano: Plano, etapa: Etapa): string {
  const modulo = plano.modulos.find((m) => m.etapas.some((e) => e.id === etapa.id));
  const anteriores = etapasEmOrdem(plano);
  const i = anteriores.findIndex((e) => e.id === etapa.id);
  return [
    `Objetivo do caminho: ${plano.objetivo}`,
    plano.visao && `Visão: ${plano.visao}`,
    modulo && `Módulo: ${modulo.titulo}${modulo.descricao ? ` — ${modulo.descricao}` : ""}`,
    `Etapa: ${etapa.titulo}`,
    etapa.objetivo && `Objetivo da etapa: ${etapa.objetivo}`,
    `Tempo: ${etapa.minutos} minutos`,
    i > 0 && `Etapas anteriores: ${anteriores.slice(Math.max(0, i - 5), i).map((e) => e.titulo).join("; ")}`,
    etapa.fontes.length > 0 && `Fontes já escolhidas: ${etapa.fontes.map((f) => `${f.titulo} (${f.url})`).join("; ")}`,
  ].filter(Boolean).join("\n");
}

export function pedidoDaEtapa(plano: Plano, etapa: Etapa, perfil: string): string {
  return `${contextoDaEtapa(plano, etapa)}\n\nSobre a pessoa (da entrevista):\n${perfil}\n\nPrepare esta etapa.`;
}

export interface EtapaPreparada { resumo: string; tarefa: string; fontes: Fonte[] }

export function lerEtapaPreparada(v: unknown): EtapaPreparada | string {
  const o = (v && typeof v === "object" ? v : {}) as Record<string, unknown>;
  const resumo = typeof o.resumo === "string" ? o.resumo.trim() : "";
  if (resumo.length < 40) return "faltou o \"resumo\" em markdown";
  const fontes = Array.isArray(o.fontes) ? o.fontes.map(normalizarFonte).filter((f): f is Fonte => f !== null).slice(0, 12) : [];
  return { resumo: resumo.slice(0, 60_000), tarefa: typeof o.tarefa === "string" ? o.tarefa.trim().slice(0, 1200) : "", fontes };
}

export function pedidoDeCards(plano: Plano, etapa: Etapa, resumo: string | null): string {
  return `${contextoDaEtapa(plano, etapa)}\n\n${resumo ? `Conteúdo da etapa:\n${resumo.slice(0, 30_000)}` : "A etapa ainda não tem resumo; baseie-se no objetivo."}\n\nCrie os cards.`;
}

export function lerCards(v: unknown): { frente: string; verso: string }[] | string {
  const o = (v && typeof v === "object" ? v : {}) as Record<string, unknown>;
  const cards = (Array.isArray(o.cards) ? o.cards : []).map((c) => {
    const co = (c && typeof c === "object" ? c : {}) as Record<string, unknown>;
    const frente = typeof co.frente === "string" ? co.frente.trim().slice(0, 2000) : "";
    const verso = typeof co.verso === "string" ? co.verso.trim().slice(0, 4000) : "";
    return frente && verso ? { frente, verso } : null;
  }).filter((c): c is { frente: string; verso: string } => c !== null).slice(0, 40);
  return cards.length ? cards : "esperava {\"cards\":[{\"frente\":\"...\",\"verso\":\"...\"}]}";
}

export function pedidoDeTarefas(plano: Plano, etapa: Etapa, resumo: string | null): string {
  const feitas = etapa.tarefas.map((t) => `- ${t.texto}`).join("\n");
  return `${contextoDaEtapa(plano, etapa)}\nTarefa principal: ${etapa.tarefa}\n${feitas ? `Exercícios que já existem (não repita):\n${feitas}\n` : ""}\n${resumo ? `Conteúdo da etapa:\n${resumo.slice(0, 20_000)}\n\n` : ""}Crie os exercícios.`;
}

export function lerTarefas(v: unknown): string[] | string {
  const o = (v && typeof v === "object" ? v : {}) as Record<string, unknown>;
  const tarefas = normalizarTarefas(o.tarefas).map((t) => t.texto);
  return tarefas.length ? tarefas : "esperava {\"tarefas\":[{\"texto\":\"...\"}]}";
}

export function pedidoDoPainel(plano: Plano | null, progresso: Progresso, etapa: Etapa | undefined, historico: MensagemDoPainel[], mensagem: string): string {
  const conversa = historico.slice(-16).map((m) => `${m.de === "ia" ? "Mentor" : "Pessoa"}: ${m.texto.slice(0, 4000)}`).join("\n\n");
  const feitas = plano ? etapasEmOrdem(plano).filter((e) => progresso.etapas[e.id]?.estado === "concluida").length : 0;
  const total = plano ? etapasEmOrdem(plano).length : 0;
  return [
    plano ? `Plano atual:\n${planoEmTexto(plano, progresso)}` : "Ainda não há plano.",
    `Progresso: ${feitas} de ${total} etapas concluídas; ${progresso.dias.length} dias com estudo.`,
    plano && etapa ? `Etapa aberta agora:\n${contextoDaEtapa(plano, etapa)}` : "",
    conversa ? `Conversa até agora:\n${conversa}` : "",
    `Pessoa: ${mensagem}`,
  ].filter(Boolean).join("\n\n");
}

export interface RespostaDoPainel { texto: string; plano?: Plano; tarefas?: string[] }

/** Separa o texto dos blocos ```plano``` e ```tarefas```; bloco inválido fica fora, sem quebrar a resposta. */
export function lerRespostaDoPainel(resposta: string): RespostaDoPainel {
  const r: RespostaDoPainel = { texto: resposta };
  r.texto = resposta.replace(/```(plano|tarefas)\s*([\s\S]*?)```/gi, (_, tipo: string, corpo: string) => {
    try {
      const valor: unknown = JSON.parse(corpo);
      if (tipo.toLowerCase() === "plano") { const plano = normalizarPlano(valor); if (plano) r.plano = plano; }
      else { const tarefas = lerTarefas(valor); if (typeof tarefas !== "string") r.tarefas = tarefas; }
    } catch { /* bloco quebrado: ignora */ }
    return "";
  }).trim();
  if (!r.texto) r.texto = r.plano ? "Preparei um caminho reajustado. Confira antes de aplicar." : r.tarefas ? "Separei alguns exercícios para esta etapa." : "(sem resposta)";
  return r;
}

/** O que a entrevista apurou, para a etapa e o painel saberem com quem falam. */
export function perfilDaEntrevista(e: EntrevistaSalva): string {
  return `Pedido: ${e.pedido}\n${transcricao(e)}`.slice(0, 6000);
}

export const SISTEMA_DOS_CARDS_DE_TUDO = `${BASE}

Crie cards de revisão espaçada cobrindo TODO o conteúdo que a pessoa já estudou (as etapas abaixo). Frente com pergunta curta e específica, verso com resposta objetiva, uma ideia por card. Priorize o que é mais importante e o que costuma ser esquecido; não repita cards que já existem. Entre 10 e 30 cards. Diga de qual etapa é cada card pelo id. Responda SÓ com um JSON:
{"cards":[{"etapa":"id-da-etapa","frente":"...","verso":"..."}]}`;

export const SISTEMA_DA_REVISAO_DO_CADERNO = `${BASE}

A pessoa escreve um caderno com o que está aprendendo. Revise como um bom professor: diga o que ela entendeu bem, o que está errado ou impreciso (corrija com clareza), o que está faltando em relação às etapas que ela já estudou, e 2 ou 3 próximos passos concretos. Seja específico (cite trechos do caderno), gentil e direto. Responda em markdown curto, com as seções: **Está no caminho certo**, **Ajustes**, **Faltou**, **Próximos passos**.`;

export const PEDIDO_DO_QUIZ = "Faça um quiz de revisão comigo sobre o que eu já estudei (etapas concluídas e em andamento): uma pergunta por vez, espere minha resposta, corrija, explique o que eu errei e só então faça a próxima.";

export interface EtapaEstudada { etapa: Etapa; resumo: string | null }

/** Etapas concluídas ou em andamento, com o resumo (cortado para caber). */
export function pedidoDeCardsDeTudo(plano: Plano, estudadas: EtapaEstudada[], existentes: { frente: string }[]): string {
  let espaco = 40_000;
  const blocos = estudadas.map(({ etapa, resumo }) => {
    const corpo = (resumo ?? etapa.objetivo).slice(0, Math.max(500, Math.min(4000, espaco)));
    espaco -= corpo.length;
    return `### ${etapa.id} — ${etapa.titulo}\n${etapa.objetivo ? `Objetivo: ${etapa.objetivo}\n` : ""}${corpo}`;
  });
  const ja = existentes.slice(-80).map((c) => `- ${c.frente.slice(0, 160)}`).join("\n");
  return `Objetivo do caminho: ${plano.objetivo}\n\nEtapas estudadas:\n\n${blocos.join("\n\n")}${ja ? `\n\nCards que já existem (não repita):\n${ja}` : ""}\n\nCrie os cards.`;
}

export function lerCardsComEtapa(validos: Set<string>) {
  return (v: unknown): { etapa: string; frente: string; verso: string }[] | string => {
    const o = (v && typeof v === "object" ? v : {}) as Record<string, unknown>;
    const cards = (Array.isArray(o.cards) ? o.cards : []).map((c) => {
      const co = (c && typeof c === "object" ? c : {}) as Record<string, unknown>;
      const frente = typeof co.frente === "string" ? co.frente.trim().slice(0, 2000) : "";
      const verso = typeof co.verso === "string" ? co.verso.trim().slice(0, 4000) : "";
      const etapa = typeof co.etapa === "string" && validos.has(co.etapa) ? co.etapa : "";
      return frente && verso ? { etapa, frente, verso } : null;
    }).filter((c): c is { etapa: string; frente: string; verso: string } => c !== null).slice(0, 60);
    return cards.length ? cards : "esperava {\"cards\":[{\"etapa\":\"...\",\"frente\":\"...\",\"verso\":\"...\"}]}";
  };
}

export function pedidoDaRevisaoDoCaderno(plano: Plano | null, progresso: Progresso, caderno: string, perfil: string): string {
  const estados = plano ? estadosDasEtapas(plano, progresso) : {};
  const estudadas = plano ? etapasEmOrdem(plano).filter((e) => estados[e.id] === "concluida" || estados[e.id] === "andamento") : [];
  return [
    `Sobre a pessoa (da entrevista):\n${perfil}`,
    plano ? `Objetivo do caminho: ${plano.objetivo}` : "",
    estudadas.length ? `Etapas que ela já estudou:\n${estudadas.map((e) => `- ${e.titulo}${e.objetivo ? `: ${e.objetivo}` : ""} (${estados[e.id] === "concluida" ? "concluída" : "em andamento"})`).join("\n")}` : "Ainda não concluiu etapas.",
    `Caderno da pessoa:\n"""\n${caderno.slice(0, 40_000)}\n"""`,
    "Revise o caderno.",
  ].filter(Boolean).join("\n\n");
}
