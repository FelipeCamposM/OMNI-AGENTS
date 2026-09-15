import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Button } from "../../components/ui";
import { ChatIcon, KanbanIcon, ListIcon, TerminalIcon, GitBranchIcon } from "../../components/ui/PixelIcon";
import { iconForPath } from "../files/fileIcons";
import type { PaneKind, PaneNode, WorkspaceAction } from "../../types/workspace";
import { startTabDrag } from "./tabPointerDrag";

interface WorkspaceTabBarProps {
  pane: PaneNode;
  dispatch: React.Dispatch<WorkspaceAction>;
  onCloseTab: (tab: PaneNode["tabs"][number]) => void;
  dirtyTabIds?: Set<string>;
}

export function WorkspaceTabBar({ pane, dispatch, onCloseTab, dirtyTabIds }: WorkspaceTabBarProps) {
  return (
    <div
      className="flex-1 min-w-0 flex overflow-x-auto"
      role="tablist"
      aria-label="Tabs do painel"
    >
      {pane.tabs.map((item) => (
        <div
          key={item.id}
          onPointerDown={(event) => {
            if ((event.target as HTMLElement).closest("button[aria-label]")) return;
            startTabDrag(event, { paneId: pane.id, tabId: item.id, title: item.title }, dispatch);
          }}
          className={[
            "group flex shrink-0 items-stretch border-r-2 border-border-subtle max-w-64 select-none touch-none cursor-grab active:cursor-grabbing",
            item.id === pane.activeTabId ? "bg-bg-surface" : "hover:bg-overlay/[0.04]",
          ].join(" ")}
        >
          <button
            type="button"
            role="tab"
            title={`${item.title} — arraste para outro painel ou para uma borda`}
            aria-selected={item.id === pane.activeTabId}
            onClick={() => dispatch({ type: "SELECT_TAB", paneId: pane.id, tabId: item.id })}
            className={[
              "min-w-0 px-3 text-[11px] truncate focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent",
              item.id === pane.activeTabId
                ? "text-text-primary"
                : "text-text-muted hover:text-text-secondary",
            ].join(" ")}
          >
            {/* Ícone no lugar do rótulo do kind: "MARKDOWN" comia 8 caracteres de uma aba que já
                é estreita, e o tipo do ARQUIVO diz mais do que o tipo do painel. */}
            <TabIcon
              item={item}
              className="mr-1.5 inline-block h-3 w-3 shrink-0 align-[-2px] text-accent"
            />
            {item.title}
            {dirtyTabIds?.has(item.id) && (
              <span className="ml-1.5 text-accent" title="Alterações não salvas" aria-label="Alterações não salvas">•</span>
            )}
          </button>
          <button
            type="button"
            aria-label={`Fechar tab ${item.title}`}
            title="Fechar tab"
            onClick={() => onCloseTab(item)}
            className="w-7 text-text-muted hover:text-danger focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
          >
            ×
          </button>
        </div>
      ))}
      <NewTabMenu
        onCreate={(kind, title) => dispatch({ type: "CREATE_TAB", paneId: pane.id, kind, title })}
      />
    </div>
  );
}

export const NEW_TAB_OPTIONS: { kind: PaneKind; title: string; hint: string }[] = [
  { kind: "agent", title: "Novo agente", hint: "Abre o seletor de CLI (Claude, Codex, Cursor…)" },
  { kind: "terminal", title: "Novo terminal", hint: "Shell do sistema, sem agente" },
];

/** O "+" abre um menu em vez de criar agente direto — terminal puro e agente são as duas coisas
 *  que uma aba nova pode ser. Portal com posição medida pelo mesmo motivo do `WorkspaceSwitcher`:
 *  a tablist é `overflow-x-auto` e recortaria um popover absoluto. */
function NewTabMenu({ onCreate }: { onCreate: (kind: PaneKind, title: string) => void }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: PointerEvent) {
      const target = event.target as Node;
      if (buttonRef.current?.contains(target) || menuRef.current?.contains(target)) return;
      setOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <>
      <Button
        ref={buttonRef}
        variant="ghost"
        size="sm"
        className="!px-2 !py-1 shrink-0"
        aria-label="Nova tab"
        aria-haspopup="menu"
        aria-expanded={open}
        title="Nova tab"
        onClick={() => {
          // Mede na hora de abrir, não num layout effect: a posição do "+" só interessa neste
          // instante e o menu fecha em qualquer clique fora.
          const rect = buttonRef.current?.getBoundingClientRect();
          if (rect) setPos({ top: rect.bottom + 4, left: rect.left });
          setOpen((value) => !value);
        }}
      >
        +
      </Button>
      {open && pos && createPortal(
        <div
          ref={menuRef}
          role="menu"
          aria-label="Nova tab"
          style={{ position: "fixed", top: pos.top, left: pos.left, minWidth: 200 }}
          className="popover z-50 p-1"
        >
          {NEW_TAB_OPTIONS.map((option) => (
            <button
              key={option.kind}
              type="button"
              role="menuitem"
              title={option.hint}
              onClick={() => {
                setOpen(false);
                onCreate(option.kind, option.title);
              }}
              className="block w-full px-2.5 py-1.5 text-left text-xs text-text-secondary hover:text-text-primary hover:bg-overlay/[0.07] focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
            >
              {option.title}
              <span className="block text-[10px] text-text-muted">{option.hint}</span>
            </button>
          ))}
        </div>,
        document.body
      )}
    </>
  );
}

/** Aba de arquivo mostra o ícone do arquivo; aba sem caminho (agente, terminal, kanban) mostra o
 *  do tipo de painel. */
const ICONE_POR_KIND: Partial<Record<PaneNode["tabs"][number]["kind"], React.ComponentType<{ className?: string }>>> = {
  agent: ChatIcon,
  terminal: TerminalIcon,
  command: ListIcon,
  kanban: KanbanIcon,
  "git-graph": GitBranchIcon,
  "git-diff": GitBranchIcon,
};

function TabIcon({ item, className }: { item: PaneNode["tabs"][number]; className?: string }) {
  const doKind = ICONE_POR_KIND[item.kind];
  // git-diff carrega `staged::<caminho>` no resourceId, e não um caminho puro — usar o ícone do
  // kind nesses casos evita inventar extensão a partir de um prefixo.
  const Icone = doKind ?? iconForPath(item.resourceId ?? item.title);
  return <Icone className={className} aria-hidden />;
}
