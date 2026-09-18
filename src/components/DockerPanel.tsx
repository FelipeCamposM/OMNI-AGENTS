import { useCallback, useEffect, useState } from "react";
import {
  dockerContainerAction,
  dockerContainers,
  groupByCompose,
  type DockerAction,
  type DockerContainer,
} from "../features/docker/dockerService";
import { CircleIcon, FileTextIcon, PlayIcon, ReloadIcon, StopIcon, TerminalIcon, TrashIcon } from "./ui/PixelIcon";

interface DockerPanelProps {
  /** Abre um terminal do projeto rodando o comando (logs, shell dentro do container). */
  onRunInTerminal: (title: string, command: string) => void;
}

const STATE_COLOR: Record<string, string> = {
  running: "text-success",
  restarting: "text-warning",
  paused: "text-warning",
  dead: "text-danger",
};

/** Containers do Docker local, no molde da extensão Containers do VS Code: agrupados por projeto
 *  do Compose, com iniciar/parar, reiniciar, logs, shell e remover. */
export function DockerPanel({ onRunInTerminal }: DockerPanelProps) {
  // undefined = carregando.
  const [containers, setContainers] = useState<DockerContainer[] | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);

  const refresh = useCallback(() => {
    dockerContainers()
      .then((list) => {
        setContainers(list);
        setError(null);
      })
      .catch((reason) => {
        setContainers([]);
        setError(reason instanceof Error ? reason.message : String(reason));
      });
  }, []);

  // ponytail: poll de 5s; trocar por `docker events` em stream se o painel precisar ser instantâneo.
  useEffect(() => {
    refresh();
    const timer = window.setInterval(refresh, 5_000);
    return () => window.clearInterval(timer);
  }, [refresh]);

  async function act(container: DockerContainer, action: DockerAction) {
    setBusy(container.id);
    setConfirmRemove(null);
    try {
      await dockerContainerAction(container.id, action);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(null);
      refresh();
    }
  }

  if (containers === undefined) return <p className="px-6 py-1.5 text-xs text-text-muted">Carregando…</p>;

  return (
    <div className="space-y-1">
      {error && (
        <p role="alert" className="mx-3 border-l-2 border-danger pl-2 text-[11px] text-danger" title={error}>
          {error.length > 160 ? `${error.slice(0, 160)}…` : error}
        </p>
      )}
      {!error && containers.length === 0 && <p className="px-6 py-1.5 text-xs text-text-muted">Nenhum container</p>}
      {groupByCompose(containers).map((group) => (
        <div key={group.project || "_soltos"}>
          {group.project && (
            <p className="truncate px-6 pt-1 text-[10px] uppercase tracking-wider text-text-muted" title="Projeto do Compose">
              {group.project}
            </p>
          )}
          {group.containers.map((container) => {
            const running = container.state === "running";
            const disabled = busy === container.id;
            return (
              <div key={container.id}>
                <div className="group flex items-center pl-6 pr-1">
                  <span
                    className="flex min-w-0 flex-1 items-center gap-1.5 py-1.5 text-xs text-text-secondary"
                    title={`${container.name}\n${container.image}\n${container.status}${container.ports ? `\n${container.ports}` : ""}`}
                  >
                    <CircleIcon className={`h-3 w-3 shrink-0 ${STATE_COLOR[container.state] ?? "text-text-muted"}`} aria-hidden />
                    <span className="truncate">{container.name}</span>
                  </span>
                  <IconButton
                    label={running ? `Parar ${container.name}` : `Iniciar ${container.name}`}
                    onClick={() => void act(container, running ? "stop" : "start")}
                    disabled={disabled}
                  >
                    {running ? <StopIcon className="h-3.5 w-3.5" aria-hidden /> : <PlayIcon className="h-3.5 w-3.5" aria-hidden />}
                  </IconButton>
                  <IconButton label={`Reiniciar ${container.name}`} onClick={() => void act(container, "restart")} disabled={disabled}>
                    <ReloadIcon className="h-3.5 w-3.5" aria-hidden />
                  </IconButton>
                  <IconButton
                    label={`Ver logs de ${container.name}`}
                    onClick={() => onRunInTerminal(`logs · ${container.name}`, `docker logs -f --tail 200 ${container.name}`)}
                  >
                    <FileTextIcon className="h-3.5 w-3.5" aria-hidden />
                  </IconButton>
                  {running && (
                    <IconButton
                      label={`Abrir shell em ${container.name}`}
                      onClick={() => onRunInTerminal(`shell · ${container.name}`, `docker exec -it ${container.name} sh`)}
                    >
                      <TerminalIcon className="h-3.5 w-3.5" aria-hidden />
                    </IconButton>
                  )}
                  <IconButton
                    label={`Remover ${container.name}`}
                    danger
                    onClick={() => setConfirmRemove(container.id)}
                    disabled={disabled}
                  >
                    <TrashIcon className="h-3.5 w-3.5" aria-hidden />
                  </IconButton>
                </div>
                {confirmRemove === container.id && (
                  <div className="flex items-center gap-2 pb-1 pl-11 text-[11px]">
                    <span className="text-danger">Remover{running ? " (está rodando)" : ""}?</span>
                    <button type="button" className="text-danger underline" onClick={() => void act(container, "remove")}>
                      Sim
                    </button>
                    <button type="button" className="text-text-muted underline" onClick={() => setConfirmRemove(null)}>
                      Não
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}

function IconButton({
  label,
  onClick,
  disabled,
  danger,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      disabled={disabled}
      className={`grid h-6 w-6 shrink-0 place-items-center text-text-muted opacity-60 hover:opacity-100 disabled:opacity-30 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent ${danger ? "hover:text-danger" : "hover:text-text-primary"}`}
    >
      {children}
    </button>
  );
}
