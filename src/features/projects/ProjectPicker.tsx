import { open } from "@tauri-apps/plugin-dialog";
import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Button } from "../../components/ui";
import { targetLabel } from "../../lib/paths";
import { wslDistros } from "../terminal/terminalService";
import {
  forgetProject,
  listRecentProjects,
  type RecentProject,
} from "../../services/recentProjectsService";
import { SshConnectionForm } from "./SshConnectionForm";
import { listSshConnections, sshMount, type SshConnection } from "./sshService";

interface ProjectPickerProps {
  onPick: (path: string) => void;
  onClose: () => void;
}

function texto(reason: unknown) {
  return reason instanceof Error ? reason.message : String(reason);
}

/** Abrir projeto: primeiro os últimos abertos (inclusive os que estão no WSL ou num servidor), e só
 *  depois o explorador do Windows. Reabrir um projeto conhecido é o caso comum; navegar é a exceção. */
export function ProjectPicker({ onPick, onClose }: ProjectPickerProps) {
  const [recentes, setRecentes] = useState<RecentProject[]>([]);
  const [distros, setDistros] = useState<string[]>([]);
  const [conexoes, setConexoes] = useState<SshConnection[]>([]);
  const [editando, setEditando] = useState<SshConnection | null>(null);
  const [formAberto, setFormAberto] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [montando, setMontando] = useState<string | null>(null);

  const recarregar = useCallback(() => {
    setRecentes(listRecentProjects());
    void listSshConnections().then(setConexoes).catch(() => setConexoes([]));
  }, []);

  useEffect(() => {
    recarregar();
    void wslDistros().then(setDistros).catch(() => setDistros([]));
  }, [recarregar]);

  /** Rótulo por unidade montada: `X:` → nome da conexão, para marcar os recentes que são remotos. */
  const unidades = Object.fromEntries(conexoes.map((item) => [item.drive.toUpperCase(), item.name]));

  async function procurar(defaultPath?: string) {
    const escolhido = await open({ directory: true, multiple: false, defaultPath });
    if (typeof escolhido === "string") onPick(escolhido);
  }

  /** Projeto recente que mora numa unidade SSH: montar antes de abrir, senão o caminho não existe
   *  e o projeto entra quebrado (árvore vazia, git mudo). */
  async function abrirRecente(path: string) {
    const letra = /^([a-z]):/i.exec(path)?.[1];
    const conexao = letra ? conexoes.find((item) => item.drive.toUpperCase() === `${letra.toUpperCase()}:`) : undefined;
    if (!conexao) {
      onPick(path);
      return;
    }
    setMontando(conexao.id);
    setErro(null);
    try {
      await sshMount(conexao.id);
      onPick(path);
    } catch (reason) {
      setErro(texto(reason));
    } finally {
      setMontando(null);
    }
  }

  /** Monta a máquina remota e abre a pasta do projeto que está cadastrada nela. */
  async function abrirSsh(connection: SshConnection) {
    setMontando(connection.id);
    setErro(null);
    try {
      const raiz = await sshMount(connection.id);
      onPick(raiz.endsWith(":") ? `${raiz}\\` : raiz);
    } catch (reason) {
      setErro(texto(reason));
    } finally {
      setMontando(null);
    }
  }

  // Portal para o `body`: a barra lateral é `sticky`, e `position: sticky` cria contexto de
  // empilhamento — dentro dela, `z-50` só compete com irmãos da própria barra, e a coluna do
  // workspace (irmã posterior no DOM) pinta por cima. Foi o que deixava este diálogo atrás dos
  // terminais. Mesmo caminho do NotificationBell e do LayoutPresetPicker.
  return createPortal(
    <div className="fixed inset-0 z-50 flex justify-center bg-black/30 px-4 pt-[12vh]" onPointerDown={onClose}>
      <div
        role="dialog"
        aria-label="Abrir projeto"
        className="popover flex h-fit max-h-[70vh] w-full max-w-xl flex-col gap-2 p-3"
        onPointerDown={(event) => event.stopPropagation()}
      >
        <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-accent">Abrir projeto</p>

        {erro && (
          <p role="alert" className="whitespace-pre-wrap border-l-2 border-danger pl-2 text-[11px] text-danger">
            {erro}
          </p>
        )}

        {recentes.length === 0 ? (
          <p className="px-1 py-2 text-xs text-text-muted">Nenhum projeto aberto ainda.</p>
        ) : (
          <ul className="min-h-0 flex-1 overflow-y-auto">
            {recentes.map((item) => {
              const alvo = targetLabel(item.path, unidades);
              return (
                <li key={item.path} className="group flex items-stretch">
                  <button
                    type="button"
                    onClick={() => void abrirRecente(item.path)}
                    className="min-w-0 flex-1 px-2 py-1.5 text-left hover:bg-overlay/[0.07]"
                  >
                    <span className="flex items-center gap-2">
                      <span className="truncate text-xs text-text-primary">{item.name}</span>
                      {alvo && (
                        <span className="shrink-0 border border-border-subtle px-1 text-[10px] uppercase text-accent">
                          {alvo}
                        </span>
                      )}
                    </span>
                    <span className="block truncate text-[11px] text-text-muted" title={item.path}>
                      {item.path}
                    </span>
                  </button>
                  <button
                    type="button"
                    aria-label={`Remover ${item.name} da lista`}
                    title="Remover da lista"
                    onClick={() => {
                      forgetProject(item.path);
                      setRecentes(listRecentProjects());
                    }}
                    className="w-7 shrink-0 text-text-muted opacity-0 hover:text-danger focus-visible:opacity-100 group-hover:opacity-100"
                  >
                    ×
                  </button>
                </li>
              );
            })}
          </ul>
        )}

        {conexoes.length > 0 && (
          <div className="border-t border-border-subtle/60 pt-2">
            <p className="px-1 text-[10px] uppercase tracking-wider text-text-muted">Máquinas por SSH</p>
            <ul>
              {conexoes.map((item) => (
                <li key={item.id} className="group flex items-stretch">
                  <button
                    type="button"
                    disabled={montando !== null}
                    onClick={() => void abrirSsh(item)}
                    className="min-w-0 flex-1 px-2 py-1.5 text-left hover:bg-overlay/[0.07] disabled:opacity-40"
                  >
                    <span className="truncate text-xs text-text-primary">
                      {montando === item.id ? "Montando…" : item.name}
                    </span>
                    <span className="block truncate text-[11px] text-text-muted">
                      {item.user}@{item.host}:{item.remote_path} → {item.drive}
                    </span>
                  </button>
                  <button
                    type="button"
                    aria-label={`Editar ${item.name}`}
                    title="Editar conexão"
                    onClick={() => {
                      setEditando(item);
                      setFormAberto(true);
                    }}
                    className="w-7 shrink-0 text-text-muted opacity-0 hover:text-text-primary focus-visible:opacity-100 group-hover:opacity-100"
                  >
                    ⚙
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}

        {formAberto && (
          <SshConnectionForm
            connection={editando}
            onCancel={() => {
              setFormAberto(false);
              setEditando(null);
              recarregar();
            }}
            onSaved={() => {
              setFormAberto(false);
              setEditando(null);
              recarregar();
            }}
          />
        )}

        <div className="flex flex-wrap gap-2 border-t border-border-subtle/60 pt-2">
          <Button size="sm" onClick={() => void procurar()}>
            Procurar no computador…
          </Button>
          {distros.map((distro) => (
            <Button
              key={distro}
              size="sm"
              variant="ghost"
              title={`Abrir uma pasta dentro do WSL (${distro})`}
              onClick={() => void procurar(`\\\\wsl.localhost\\${distro}\\home`)}
            >
              Procurar no WSL · {distro}
            </Button>
          ))}
          {!formAberto && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setEditando(null);
                setFormAberto(true);
              }}
            >
              Conectar por SSH…
            </Button>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}
