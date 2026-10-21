import { memo } from "react";
import { Handle, NodeToolbar, Position, type Node, type NodeProps } from "@xyflow/react";
import { AgentIcon } from "../../components/ui/AgentIcon";
import { CheckIcon, ChatIcon, CopyIcon, FlagIcon, GitBranchIcon, PlayIcon, RobotIcon, ShieldIcon, TerminalIcon, TrashIcon } from "../../components/ui/PixelIcon";
import { ROTULO_ESFORCO } from "../agentes/agentesService";
import { SAIDAS, type EstadoDoNo, type NoDoFluxo } from "./fluxosService";

export type DadosDoNo = {
  no: NoDoFluxo;
  estado?: EstadoDoNo;
  cli?: string;
  /** Modelo/esforço efetivos (o do nó por cima do do agente), para o rótulo. */
  modelo?: string;
  esforco?: string;
  /** Só no editor: ações da barrinha que aparece com o nó selecionado. */
  onDuplicar?: (id: string) => void;
  onApagar?: (id: string) => void;
};
export type NoOmni = Node<DadosDoNo, "omni">;

const ICONE = { entrada: PlayIcon, agente: RobotIcon, condicao: ShieldIcon, aprovacao: CheckIcon, sala: ChatIcon, pr: GitBranchIcon, comando: TerminalIcon, fim: FlagIcon } as const;
const NOME = { entrada: "Entrada", agente: "Agente", condicao: "Condição", aprovacao: "Aprovação", sala: "Time", pr: "Pull request", comando: "Comando", fim: "Fim" } as const;
const ROTULO_SAIDA: Record<string, string> = { sim: "sim", nao: "não", esgotado: "esgotou" };
const STATUS: Record<string, string> = { pendente: "", rodando: "rodando", concluido: "feito", falhou: "falhou", pausado: "pausado", aguardando: "sua vez" };

/** Uma etapa do fluxo no canvas. No editor ganha a barrinha de duplicar/apagar; na execução, a cor
 *  do estado, o que o agente está fazendo agora e tempo/custo. */
export const NoDoFluxoView = memo(function NoDoFluxoView({ data, selected }: NodeProps<NoOmni>) {
  const { no, estado, cli, modelo, esforco } = data;
  const Icone = ICONE[no.tipo];
  const saidas = SAIDAS[no.tipo];
  const subtitulo = no.tipo === "agente" ? [no.agente || "escolha um agente", modelo, esforco && (ROTULO_ESFORCO[esforco] ?? esforco).toLowerCase()].filter(Boolean).join(" · ")
    : no.tipo === "sala" ? (Array.isArray(no.config.participantes) ? (no.config.participantes as string[]).join(", ") : "")
    : no.tipo === "condicao" ? `lê o veredito · até ${String(no.config.max_voltas ?? 3)} voltas`
    : no.tipo === "aprovacao" ? "espera você aprovar"
    : no.tipo === "entrada" ? "a tarefa que você digita"
    : no.tipo === "pr" ? "commit, push e gh pr create"
    : no.tipo === "comando" ? String(no.config.comando || "escreva o comando") : "";
  const duracao = estado?.inicio_ms && estado.fim_ms ? Math.max(1, Math.round((estado.fim_ms - estado.inicio_ms) / 1000)) : null;

  return (
    <div className={`fx-no is-${no.tipo}${estado ? ` st-${estado.status}` : ""}`}>
      {data.onDuplicar && no.tipo !== "entrada" && (
        <NodeToolbar isVisible={selected} position={Position.Top} offset={10} className="fx-no-barra">
          <button type="button" onClick={() => data.onDuplicar?.(no.id)} title="Duplicar etapa"><CopyIcon aria-hidden className="h-3.5 w-3.5" />Duplicar</button>
          <button type="button" className="is-perigo" onClick={() => data.onApagar?.(no.id)} title="Apagar etapa (Delete)"><TrashIcon aria-hidden className="h-3.5 w-3.5" />Apagar</button>
        </NodeToolbar>
      )}
      {no.tipo !== "entrada" && <Handle type="target" position={Position.Left} className="fx-porta fx-porta-entrada" />}
      <div className="fx-no-topo">
        <span className="fx-no-icone">{no.tipo === "agente" && cli ? <AgentIcon provider={cli} size={14} /> : <Icone aria-hidden className="h-3.5 w-3.5" />}</span>
        <span className="fx-no-tipo">{NOME[no.tipo]}</span>
        {estado && STATUS[estado.status] && <span className="fx-no-status">{STATUS[estado.status]}</span>}
      </div>
      <div className="fx-no-titulo">{no.titulo || NOME[no.tipo]}</div>
      {subtitulo && <div className="fx-no-sub">{subtitulo}</div>}
      {estado?.status === "rodando" && estado.atividade && <div className="fx-no-atividade" title={estado.atividade}>{estado.atividade}</div>}
      {estado && (estado.voltas > 0 || estado.custo_usd > 0 || duracao) && (
        <div className="fx-no-metricas">
          {estado.voltas > 1 && no.tipo !== "condicao" && no.tipo !== "comando" && <span>{estado.voltas}ª vez</span>}
          {no.tipo === "comando" && estado.voltas > 0 && <span>{estado.voltas} falha(s)</span>}
          {no.tipo === "condicao" && estado.voltas > 0 && <span>{estado.voltas} reprovação(ões)</span>}
          {duracao && <span>{duracao < 60 ? `${duracao}s` : `${Math.floor(duracao / 60)}min ${duracao % 60}s`}</span>}
          {estado.custo_usd > 0 && <span>US$ {estado.custo_usd.toFixed(2)}</span>}
        </div>
      )}
      {saidas.length === 1 && <Handle type="source" position={Position.Right} id="out" className="fx-porta" title="Arraste para ligar à próxima etapa" />}
      {saidas.length > 1 && (
        <div className="fx-saidas">
          {saidas.map((s) => (
            <div key={s} className={`fx-saida is-${s}`}>
              <span>{ROTULO_SAIDA[s] ?? s}</span>
              <Handle type="source" position={Position.Right} id={s} className={`fx-porta is-${s}`} title={`Arraste para onde ir quando for “${ROTULO_SAIDA[s] ?? s}”`} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
});
