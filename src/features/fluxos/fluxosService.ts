import { invoke } from "@tauri-apps/api/core";
import { engineApi } from "../terminal/terminalService";

export type TipoDeNo = "entrada" | "agente" | "condicao" | "aprovacao" | "sala" | "pr" | "comando" | "fim";

export interface NoDoFluxo {
  id: string;
  tipo: TipoDeNo;
  titulo: string;
  agente?: string;
  config: Record<string, unknown>;
  x: number;
  y: number;
}
export interface Conexao { de: string; para: string; saida?: string }
export interface Fluxo {
  id: string; nome: string; descricao: string; nos: NoDoFluxo[]; conexoes: Conexao[];
  /** Roda direto na pasta do projeto, sem worktree (leva o que não foi commitado; mexe nos seus arquivos). */
  na_pasta_do_projeto?: boolean;
}
export interface FluxoSalvo extends Fluxo { escopo: "global" | "projeto"; caminho: string }

export type StatusDoNo = "pendente" | "rodando" | "concluido" | "falhou" | "pausado" | "aguardando";
export interface EstadoDoNo {
  status: StatusDoNo; voltas: number; inicio_ms: number; fim_ms: number; saida: string;
  session_id: string | null; custo_usd: number; erro: string | null; cli: string | null; conta: string | null; caminho: string | null;
  /** O que o agente está fazendo agora (última ação ou fala). */
  atividade?: string; modelo?: string | null; esforco?: string | null;
}
export type StatusDaExecucao = "rodando" | "pausado" | "aguardando" | "concluido" | "falhou" | "cancelado";
export interface Execucao {
  id: string; fluxo: Fluxo; projeto: string; projeto_id: string; entrada: string; pasta: string;
  branch: string | null; base: string | null; status: StatusDaExecucao; erro: string | null;
  criado_ms: number; atualizado_ms: number; nos: Record<string, EstadoDoNo>; pr_url: string | null; custo_usd: number;
}
export interface ResumoDaExecucao {
  id: string; fluxo: string; fluxo_id: string; projeto: string; projeto_id: string; entrada: string;
  status: StatusDaExecucao; criado_ms: number; atualizado_ms: number; pr_url: string | null; custo_usd: number; erro: string | null;
}
export interface ItemDoHistorico { kind: "text" | "tool" | "command" | "notice"; role: string; text: string; tool?: string }

/** Saídas de cada tipo, na ordem em que aparecem no nó ("" = a saída normal). */
export const SAIDAS: Record<TipoDeNo, string[]> = {
  entrada: [""], agente: [""], sala: [""], pr: [""], fim: [],
  condicao: ["sim", "nao", "esgotado"], comando: ["sim", "nao", "esgotado"], aprovacao: ["sim", "nao"],
};

export const TIPOS: { tipo: TipoDeNo; nome: string; dica: string }[] = [
  { tipo: "agente", nome: "Agente", dica: "Um modelo de agente trabalhando sem tela" },
  { tipo: "condicao", nome: "Condição", dica: "Desvia pelo veredito da etapa anterior (aprovado/reprovado), com limite de voltas" },
  { tipo: "aprovacao", nome: "Aprovação", dica: "Para e espera você aprovar — no PC, na web ou no celular" },
  { tipo: "sala", nome: "Time", dica: "Agentes conversando em rodadas até o consenso; sai uma ata" },
  { tipo: "pr", nome: "Pull request", dica: "Commit, push e gh pr create no branch da execução" },
  { tipo: "comando", nome: "Comando", dica: "Roda um comando (testes, build, script): deu certo → sim; falhou → não" },
  { tipo: "fim", nome: "Fim", dica: "Termina o fluxo" },
];

export const listarFluxos = (projectPath: string | null) => invoke<FluxoSalvo[]>("fluxos_listar", { projectPath });
export const salvarFluxo = (escopo: "global" | "projeto", projectPath: string | null, fluxo: Fluxo, idAnterior?: string) =>
  invoke<string>("fluxos_salvar", { escopo, projectPath, fluxo, idAnterior: idAnterior ?? null });
export const apagarFluxo = (escopo: "global" | "projeto", projectPath: string | null, id: string) => invoke<void>("fluxos_apagar", { escopo, projectPath, id });
export const validarFluxo = (fluxo: Fluxo) => invoke<void>("fluxos_validar", { fluxo });

/** As rotas do executor, pelo protocolo local do engine (as mesmas que a web e o celular usam). */
async function api<T>(method: string, path: string, body?: unknown): Promise<T> {
  const r = await engineApi(method, path, body === undefined ? null : JSON.stringify(body), { headers: [["Content-Type", "application/json"]] });
  const dados = r.body ? JSON.parse(r.body) : null;
  if (r.status >= 400) throw new Error(dados?.error ?? `Falha HTTP ${r.status}`);
  return dados as T;
}
const e = encodeURIComponent;
export const listarExecucoes = () => api<ResumoDaExecucao[]>("GET", "/fluxos/execucoes");
export const iniciarExecucao = (fluxo: Fluxo, projetoId: string, entrada: string) => api<Execucao>("POST", "/fluxos/execucoes", { fluxo, projeto_id: projetoId, entrada });
export const obterExecucao = (id: string) => api<Execucao>("GET", `/fluxos/execucoes/${e(id)}`);
export const acaoNaExecucao = (id: string, acao: "pausar" | "retomar" | "cancelar") => api<{ ok: boolean }>("POST", `/fluxos/execucoes/${e(id)}/${acao}`);
export const historicoDoNo = (id: string, no: string) => api<ItemDoHistorico[]>("GET", `/fluxos/execucoes/${e(id)}/nos/${e(no)}/historico`);
export const aprovarNo = (id: string, no: string, sim: boolean) => api<{ ok: boolean }>("POST", `/fluxos/execucoes/${e(id)}/nos/${e(no)}/aprovar`, { sim });
export const abrirConversaDoNo = (id: string, no: string) => api<{ session_id: string; name: string }>("POST", `/fluxos/execucoes/${e(id)}/nos/${e(no)}/conversa`);

/** O que a IA devolve ao montar um fluxo: o grafo e, se faltou algum papel, agentes novos. */
export interface FluxoGerado { fluxo: Fluxo; agentes_novos: import("../agentes/agentesService").ModeloDeAgente[] }
/** Leva uns 30–90 s: o Claude monta o fluxo inteiro (e corrige uma vez se o JSON vier errado). */
export const criarFluxoComIa = (descricao: string, projectPath: string | null) => invoke<FluxoGerado>("fluxos_criar_com_ia", { descricao, projectPath });

/** Aceita o JSON de um fluxo (`{id, nome, nos, conexoes}`) ou o formato da IA (`{fluxo, agentes_novos}`). */
export function lerJsonDeFluxo(texto: string): FluxoGerado {
  const limpo = texto.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "");
  const valor = JSON.parse(limpo);
  const fluxo = valor?.fluxo ?? valor;
  if (!fluxo || !Array.isArray(fluxo.nos) || !Array.isArray(fluxo.conexoes)) throw new Error("O JSON não tem nos e conexoes de um fluxo");
  const nos = fluxo.nos.map((n: Partial<NoDoFluxo>) => ({ titulo: "", config: {}, x: 0, y: 0, ...n }));
  return { fluxo: { id: String(fluxo.id ?? ""), nome: String(fluxo.nome ?? "Fluxo importado"), descricao: String(fluxo.descricao ?? ""), nos, conexoes: fluxo.conexoes }, agentes_novos: Array.isArray(valor?.agentes_novos) ? valor.agentes_novos : [] };
}

/** A ordem em que as etapas acontecem no caminho feliz (sai pela saída normal ou por "sim"), para
 *  o cartão "o que vai acontecer". */
export function etapasDoFluxo(f: Fluxo): NoDoFluxo[] {
  const ordem: NoDoFluxo[] = [];
  const vistos = new Set<string>();
  let atual = f.nos.find((n) => n.tipo === "entrada");
  while (atual && !vistos.has(atual.id)) {
    vistos.add(atual.id);
    ordem.push(atual);
    const saida = f.conexoes.find((c) => c.de === atual!.id && (!c.saida || c.saida === "sim"));
    atual = saida ? f.nos.find((n) => n.id === saida.para) : undefined;
  }
  return ordem;
}

export const fluxoVazio = (): Fluxo => ({
  id: "", nome: "Novo fluxo", descricao: "",
  nos: [{ id: "entrada", tipo: "entrada", titulo: "Tarefa", config: {}, x: 0, y: 120 }, { id: "fim", tipo: "fim", titulo: "Fim", config: {}, x: 560, y: 120 }],
  conexoes: [],
});
