import { useState } from "react";
import { BoxIcon, ChevronDownIcon, FolderIcon, TrashIcon } from "./ui/PixelIcon";
import { Button } from "./ui/Button";
import { Modal } from "./ui/Modal";
import type { TerminalSession } from "../features/terminal/terminalService";
import type { WorkspaceState } from "../types/workspace";

const conversasDe = (workspace: WorkspaceState, sessoes: TerminalSession[]) =>
  sessoes.filter((sessao) => workspace.projects.some((projeto) => projeto.id === sessao.project_id)).length;

const plural = (n: number, um: string, varios: string) => `${n} ${n === 1 ? um : varios}`;

/** "+" da lateral: reabrir um workspace fechado (que só ficou escondido) ou criar um novo. */
export function AbrirWorkspace({ workspaces, onNovo, onReabrir, onFechar }: {
  workspaces: WorkspaceState[];
  onNovo: (nome: string) => void;
  onReabrir: (workspaceId: string) => void;
  onFechar: () => void;
}) {
  const [nome, setNome] = useState("");
  const escondidos = workspaces.filter((workspace) => workspace.hidden);
  return (
    <Modal titulo="Abrir workspace" onFechar={onFechar}>
      <form className="modal-secao" onSubmit={(evento) => { evento.preventDefault(); onNovo(nome); }}>
        <h3 className="modal-rotulo">Novo workspace</h3>
        <div className="modal-linha">
          <input autoFocus value={nome} onChange={(evento) => setNome(evento.target.value)}
            placeholder={`Workspace ${workspaces.length + 1}`} aria-label="Nome do workspace novo" className="modal-campo" />
          <Button type="submit" variant="primary" size="sm">Criar</Button>
        </div>
      </form>
      <section className="modal-secao">
        <h3 className="modal-rotulo">Reabrir um existente</h3>
        {escondidos.length === 0 ? (
          <p className="modal-vazio">Nenhum workspace fechado. Ao fechar um na lateral, ele fica guardado aqui.</p>
        ) : (
          <ul className="modal-lista">
            {escondidos.map((workspace) => (
              <li key={workspace.id}>
                <button type="button" className="modal-item" onClick={() => onReabrir(workspace.id)}>
                  <BoxIcon className="h-3.5 w-3.5 shrink-0 text-accent" aria-hidden />
                  <span className="min-w-0 flex-1 truncate">{workspace.name}</span>
                  <span className="modal-detalhe">{plural(workspace.projects.length, "projeto", "projetos")}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </Modal>
  );
}

/** Todos os workspaces, abertos e fechados: abrir, ver/remover projetos de cada um e excluir. */
export function GerenciarWorkspaces({ workspaces, activeWorkspaceId, agentSessions, onAbrir, onExcluir, onRemoverProjeto, onFechar }: {
  workspaces: WorkspaceState[];
  activeWorkspaceId: string | null;
  agentSessions: TerminalSession[];
  onAbrir: (workspaceId: string) => void;
  onExcluir: (workspaceId: string) => void;
  onRemoverProjeto: (workspaceId: string, projectId: string) => void;
  onFechar: () => void;
}) {
  const [aberto, setAberto] = useState<string | null>(activeWorkspaceId);
  const [excluindo, setExcluindo] = useState<WorkspaceState | null>(null);

  return (
    <Modal titulo="Gerenciar workspaces" onFechar={onFechar}>
      <ul className="modal-lista">
        {workspaces.map((workspace) => {
          const expandido = aberto === workspace.id;
          return (
            <li key={workspace.id} className="modal-cartao">
              <div className="modal-linha">
                <button type="button" className="modal-item flex-1" aria-expanded={expandido}
                  onClick={() => setAberto(expandido ? null : workspace.id)}>
                  <ChevronDownIcon className={`h-3 w-3 shrink-0 transition-transform ${expandido ? "" : "-rotate-90"}`} aria-hidden />
                  <BoxIcon className="h-3.5 w-3.5 shrink-0 text-accent" aria-hidden />
                  <span className="min-w-0 flex-1 truncate">{workspace.name}</span>
                  <span className="modal-detalhe">
                    {workspace.id === activeWorkspaceId ? "atual" : workspace.hidden ? "fechado" : "aberto"}
                    {" · "}{plural(workspace.projects.length, "projeto", "projetos")}
                  </span>
                </button>
                {workspace.id !== activeWorkspaceId && (
                  <Button size="sm" variant="ghost" onClick={() => onAbrir(workspace.id)}>Abrir</Button>
                )}
                <button type="button" className="modal-perigo" aria-label={`Excluir workspace ${workspace.name}`} title="Excluir workspace"
                  onClick={() => setExcluindo(workspace)}>
                  <TrashIcon className="h-3.5 w-3.5" aria-hidden />
                </button>
              </div>
              {expandido && (
                workspace.projects.length === 0 ? (
                  <p className="modal-vazio modal-recuo">Nenhum projeto neste workspace.</p>
                ) : (
                  <ul className="modal-recuo">
                    {workspace.projects.map((projeto) => {
                      const conversas = agentSessions.filter((sessao) => sessao.project_id === projeto.id).length;
                      return (
                        <li key={projeto.id} className="modal-linha">
                          <FolderIcon className="h-3.5 w-3.5 shrink-0 text-accent" aria-hidden />
                          <span className="min-w-0 flex-1 truncate text-xs" title={projeto.path}>{projeto.name}</span>
                          {conversas > 0 && <span className="modal-detalhe">{plural(conversas, "conversa", "conversas")}</span>}
                          <Button size="sm" variant="ghost" onClick={() => onRemoverProjeto(workspace.id, projeto.id)}
                            title="Tira o projeto deste workspace e encerra os agentes e terminais dele aqui. Os arquivos não são tocados.">
                            Remover
                          </Button>
                        </li>
                      );
                    })}
                  </ul>
                )
              )}
            </li>
          );
        })}
      </ul>

      {excluindo && (
        <Modal titulo="Excluir workspace?" largura="sm" onFechar={() => setExcluindo(null)}>
          <div className="modal-secao">
            <p className="text-sm text-text-primary">
              O workspace <b>{excluindo.name}</b> será excluído de vez. Isto não dá para desfazer.
            </p>
            <ul className="modal-explica">
              <li>{plural(excluindo.projects.length, "projeto sai", "projetos saem")} dele, com o layout das abas.</li>
              <li>
                {conversasDe(excluindo, agentSessions) > 0
                  ? `${plural(conversasDe(excluindo, agentSessions), "conversa de agente aberta", "conversas de agente abertas")} e os terminais dele são encerrados.`
                  : "Os terminais abertos nele são encerrados."}
              </li>
              <li>As conversas continuam no Histórico, e nenhum arquivo dos projetos é apagado.</li>
            </ul>
            <div className="modal-acoes">
              <Button size="sm" variant="ghost" onClick={() => setExcluindo(null)}>Cancelar</Button>
              <Button size="sm" variant="danger" onClick={() => { onExcluir(excluindo.id); setExcluindo(null); }}>
                Excluir workspace
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </Modal>
  );
}
