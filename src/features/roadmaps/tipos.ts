/**
 * Fork (Roadmaps de estudo): formato dos arquivos de cada roadmap (`<dados>/roadmaps/<id>/`).
 * Cada arquivo leva `versao`; subir a versão exige migração em `migracao.ts` (com cópia antes em
 * `~/omni-backups/roadmaps/`). Datas em ISO; dias em `AAAA-MM-DD` no fuso do PC.
 */
import type { CardInput } from "ts-fsrs";

export const VERSAO_DOS_ARQUIVOS = 1;

export type CliDaIa = "claude" | "codex";

export interface IaEscolhida {
  cli: CliDaIa;
  /** Id da conta (perfil); vazio = primeira conta com login dessa CLI. */
  conta?: string;
  /** Vazio = padrão da conta. */
  modelo?: string;
}

/** O que se faz num bloco de estudo (Mentor e Pomodoro). */
export const ATIVIDADES = ["aula", "questoes", "leitura", "revisao", "pratica", "outro"] as const;
export type TipoDeAtividade = (typeof ATIVIDADES)[number];
export const ROTULO_DA_ATIVIDADE: Record<TipoDeAtividade, string> = {
  aula: "Aula", questoes: "Questões", leitura: "Leitura", revisao: "Revisão", pratica: "Prática", outro: "Outro",
};

/** Em que ponto está a criação: entrevista → plano proposto → trilha. */
export type FaseDoRoadmap = "entrevista" | "plano" | "ativo";

export interface ResumoDoRoadmap {
  etapas: number;
  concluidas: number;
  sequencia: number;
  ultimoDia?: string;
  cardsParaHoje: number;
  proximaEtapa?: string;
}

export interface MetaDoRoadmap {
  versao: number;
  id: string;
  nome: string;
  cor: string;
  icone: string;
  arquivado: boolean;
  fase: FaseDoRoadmap;
  criadoEm: string;
  atualizadoEm: string;
  ia: IaEscolhida;
  resumo: ResumoDoRoadmap;
}

export interface MensagemDaEntrevista {
  de: "ia" | "eu";
  texto: string;
  /** Respostas rápidas sugeridas pela IA (o usuário pode escrever outra). */
  opcoes?: string[];
  em: string;
}

export interface EntrevistaSalva {
  versao: number;
  pedido: string;
  mensagens: MensagemDaEntrevista[];
  /** Plano proposto ainda não aceito. */
  proposta?: Plano;
}

export type TipoDeFonte = "artigo" | "video" | "curso" | "livro" | "podcast" | "ferramenta" | "outro";

export interface Fonte {
  titulo: string;
  url: string;
  tipo: TipoDeFonte;
  gratis: boolean;
  autor?: string;
  nota?: string;
}

export interface TarefaExtra {
  id: string;
  texto: string;
  feita: boolean;
}

export interface Etapa {
  id: string;
  titulo: string;
  objetivo: string;
  minutos: number;
  /** Tarefa prática principal. */
  tarefa: string;
  fontes: Fonte[];
  tarefas: TarefaExtra[];
  /** O resumo já foi escrito em `etapas/<id>.md`. */
  preparada?: boolean;
}

export interface Modulo {
  id: string;
  titulo: string;
  descricao: string;
  etapas: Etapa[];
}

export interface Plano {
  versao: number;
  objetivo: string;
  /** Uma ou duas frases: para quem é e como o caminho funciona. */
  visao: string;
  prazo?: string;
  minutosPorDia?: number;
  modulos: Modulo[];
}

export type EstadoGravado = "andamento" | "concluida";
export type EstadoDaEtapa = "bloqueada" | "disponivel" | EstadoGravado;

export interface Progresso {
  versao: number;
  etapas: Record<string, { estado: EstadoGravado; inicio?: string; fim?: string }>;
  /** Dias com estudo (etapa concluída ou revisão feita), sem repetição, em ordem. */
  dias: string[];
}

/** Card de revisão: o estado FSRS vai como o `ts-fsrs` serializa (datas em ISO). */
export interface CardDeRevisao {
  id: string;
  etapaId: string;
  frente: string;
  verso: string;
  criadoEm: string;
  fsrs: CardInput & { due: string; last_review?: string | null };
}

export interface RevisaoFeita { cardId: string; nota: 1 | 2 | 3 | 4; em: string }

export interface Cards {
  versao: number;
  cards: CardDeRevisao[];
  /** Registro das revisões (as mais recentes; o estado de cada card já guarda o necessário). */
  revisoes: RevisaoFeita[];
}

export interface MensagemDoPainel {
  de: "ia" | "eu";
  texto: string;
  em: string;
  /** Etapa aberta quando a mensagem foi escrita. */
  etapaId?: string;
}

export const CORES = ["#3d7bff", "#00c46a", "#ffb000", "#ff3b4f", "#a24bff", "#00c2d6", "#ff4fa3", "#ff7a1a"] as const;
/** Paleta antiga (pálida): roadmaps salvos com ela passam para a cor viva da mesma posição. */
export const CORES_ANTIGAS = ["#5b8def", "#22a06b", "#e2a03f", "#d65b5b", "#9b6bdf", "#2fb3b3", "#e0679a", "#7d8a99"] as const;
export const ICONES = ["livro", "dinheiro", "grafico", "codigo", "globo", "musica", "pincel", "calculadora", "estrela", "frasco", "apresentacao", "bandeira"] as const;
export type IconeDoRoadmap = (typeof ICONES)[number];
