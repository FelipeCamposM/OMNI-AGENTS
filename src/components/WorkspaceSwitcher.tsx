import { ChevronDownIcon as ChevronDown, EditIcon } from "./ui/PixelIcon";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { WorkspaceState } from "../types/workspace";

interface WorkspaceSwitcherProps {
  workspaces: WorkspaceState[];
  activeWorkspaceId: string | null;
  onSelect: (workspaceId: string) => void;
  onCreate: () => void;
  onClose: (workspaceId: string) => void;
  onRename: (workspaceId: string, name: string) => void;
}

/** Troca de workspace, no lugar do rótulo estático "Workspace" sob o logo.
 * Mesmo padrão de portal/clique-fora do `NotificationBell` — necessário pelo
 * mesmo motivo: a `<aside>` é `.glass` (backdrop-filter cria contexto de
 * empilhamento próprio), então um popover filho dela nunca ganharia de irmãos
 * posteriores no DOM. */
export function WorkspaceSwitcher({ workspaces, activeWorkspaceId, onSelect, onCreate, onClose, onRename }: WorkspaceSwitcherProps) {
  const active = workspaces.find((workspace) => workspace.id === activeWorkspaceId) ?? workspaces[0];
  const [aberto, setAberto] = useState(false);
  const [editandoId, setEditandoId] = useState<string | null>(null);
  const caixaRef = useRef<HTMLDivElement>(null);
  const listaRef = useRef<HTMLDivElement>(null);
  const botaoRef = useRef<HTMLButtonElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number; width: number } | null>(null);

  function confirmarRename(workspaceId: string, valor: string) {
    setEditandoId(null);
    const nome = valor.trim();
    if (nome) onRename(workspaceId, nome);
  }

  const medir = useCallback(() => {
    const r = botaoRef.current?.getBoundingClientRect();
    if (r) setPos({ top: r.bottom + 4, left: r.left, width: r.width });
  }, []);

  useLayoutEffect(() => {
    if (aberto) medir();
  }, [aberto, medir]);

  useEffect(() => {
    if (!aberto) return;
    window.addEventListener("resize", medir);
    return () => window.removeEventListener("resize", medir);
  }, [aberto, medir]);

  useEffect(() => {
    if (!aberto) return;
    function onDown(e: PointerEvent) {
      const alvo = e.target as Node;
      if (caixaRef.current?.contains(alvo) || listaRef.current?.contains(alvo)) return;
      setAberto(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setAberto(false);
    }
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [aberto]);

  return (
    <div ref={caixaRef} className="relative min-w-0">
      <button
        ref={botaoRef}
        type="button"
        onClick={() => setAberto((v) => !v)}
        aria-haspopup="dialog"
        aria-expanded={aberto}
        className="flex items-center gap-1 min-w-0 text-left rounded-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
      >
        <span className="text-text-muted text-[10px] leading-tight truncate">{active?.name ?? "Workspace"}</span>
        <ChevronDown className="w-3 h-3 shrink-0 text-text-muted" aria-hidden="true" />
      </button>

      {aberto && pos && createPortal(
        <div
          ref={listaRef}
          role="dialog"
          aria-label="Workspaces"
          style={{ position: "fixed", top: pos.top, left: pos.left, minWidth: Math.max(pos.width, 200) }}
          className="popover z-50 p-1 space-y-0.5"
        >
          <div className="flex items-center justify-between px-2 py-1">
            <p className="text-text-muted text-[10px] font-medium uppercase tracking-wider">Workspaces</p>
            <button
              type="button"
              onClick={() => {
                onCreate();
                setAberto(false);
              }}
              aria-label="Criar workspace"
              className="text-text-muted hover:text-text-primary rounded-none w-4 h-4 flex items-center justify-center text-xs leading-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
            >
              +
            </button>
          </div>
          {workspaces.map((workspace) =>
            editandoId === workspace.id ? (
              <div key={workspace.id} className="flex items-stretch px-0.5">
                <input
                  type="text"
                  autoFocus
                  defaultValue={workspace.name}
                  onFocus={(e) => e.currentTarget.select()}
                  onBlur={(e) => confirmarRename(workspace.id, e.currentTarget.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.currentTarget.blur();
                    } else if (e.key === "Escape") {
                      e.stopPropagation();
                      setEditandoId(null);
                    }
                  }}
                  className="min-w-0 flex-1 bg-transparent px-2 py-1.5 text-xs text-text-primary outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
                />
              </div>
            ) : (
              <div key={workspace.id} className="group flex items-stretch">
                <button
                  type="button"
                  aria-current={workspace.id === activeWorkspaceId ? "true" : undefined}
                  onClick={() => {
                    onSelect(workspace.id);
                    setAberto(false);
                  }}
                  onDoubleClick={(e) => {
                    e.stopPropagation();
                    setEditandoId(workspace.id);
                  }}
                  title="Clique duplo para renomear"
                  className={[
                    "min-w-0 flex-1 px-2.5 py-1.5 text-left text-xs truncate focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent",
                    workspace.id === activeWorkspaceId ? "text-text-primary" : "text-text-secondary hover:text-text-primary",
                  ].join(" ")}
                >
                  {workspace.name}
                </button>
                <button
                  type="button"
                  aria-label={`Renomear workspace ${workspace.name}`}
                  title="Renomear"
                  onClick={(e) => {
                    e.stopPropagation();
                    setEditandoId(workspace.id);
                  }}
                  className="w-7 shrink-0 flex items-center justify-center text-text-muted opacity-60 hover:text-accent hover:opacity-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
                >
                  <EditIcon className="w-3 h-3" aria-hidden />
                </button>
                <button
                  type="button"
                  aria-label={`Fechar workspace ${workspace.name}`}
                  title="Fechar workspace"
                  onClick={() => onClose(workspace.id)}
                  className="w-7 shrink-0 text-text-muted opacity-60 hover:text-danger hover:opacity-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
                >
                  ×
                </button>
              </div>
            )
          )}
        </div>,
        document.body
      )}
    </div>
  );
}
