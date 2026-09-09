import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import gsap from "gsap";
import {
  baseName,
  copyIntoProject,
  createDir,
  createFile,
  dirName,
  joinPath,
  removePath,
  renamePath,
  writeBinaryFile,
  type FileEntry,
} from "../features/files/filesService";
import { useFileTree } from "../features/files/useFileTree";

interface FileTreeProps {
  projectPath: string | null;
  onOpenFile: (path: string, kind: "file" | "markdown") => void;
  /** Um arquivo aberto numa tab foi renomeado/movido — atualiza o `resourceId` da tab
   * em vez de deixá-la apontando pra um caminho que não existe mais. */
  onFileRenamed: (fromPath: string, toPath: string, title: string) => void;
  /** Um arquivo ou pasta foi excluído — fecha qualquer tab que apontava pra ele (ou pra
   * algo dentro dele). */
  onPathDeleted: (path: string) => void;
}

const TREE_ROOT_ATTR = "data-file-tree-root";
const TREE_NODE_PATH_ATTR = "data-tree-path";
const TREE_NODE_DIR_ATTR = "data-tree-is-directory";
/** Menor distância (px) pra um pointerdown virar "arrastando" de verdade — abaixo disso
 * é só um clique normal. */
const DRAG_THRESHOLD_PX = 4;

/** Acha em qual pasta um drop (externo, colagem ou arrasto interno) deveria cair, a partir
 * de um elemento do DOM: sobre um nó da árvore usa ele (ou o pai dele, se for arquivo); fora
 * de qualquer nó mas ainda dentro da árvore usa a raiz do projeto; fora da árvore inteira,
 * `null` (ignora — não é um drop endereçado ao painel de arquivos). */
function resolveDropTargetDir(element: Element | null, projectPath: string): string | null {
  if (!element) return null;
  if (!element.closest(`[${TREE_ROOT_ATTR}]`)) return null;
  const node = element.closest(`[${TREE_NODE_PATH_ATTR}]`);
  if (!node) return projectPath;
  const path = node.getAttribute(TREE_NODE_PATH_ATTR);
  if (!path) return projectPath;
  return node.getAttribute(TREE_NODE_DIR_ATTR) === "true" ? path : dirName(path);
}

interface ContextMenuState {
  path: string;
  isDirectory: boolean;
  x: number;
  y: number;
}

interface DragPayload {
  path: string;
  isDirectory: boolean;
}

function kindFor(name: string): "file" | "markdown" {
  return /\.(md|markdown)$/i.test(name) ? "markdown" : "file";
}

/** Mesma regra usada tanto pra decidir se um alvo aceita o drop quanto pra decidir se ele
 * acende o destaque durante o arrasto — nunca aceita a própria origem, a pasta onde o item já
 * está, ou (pra pastas) qualquer coisa dentro dela mesma. */
function isInvalidDropTarget(source: DragPayload, targetDirPath: string): boolean {
  if (source.path === targetDirPath) return true;
  if (dirName(source.path) === targetDirPath) return true;
  if (source.isDirectory && (targetDirPath === source.path || targetDirPath.startsWith(`${source.path}\\`) || targetDirPath.startsWith(`${source.path}/`))) {
    return true;
  }
  return false;
}

export function FileTree({ projectPath, onOpenFile, onFileRenamed, onPathDeleted }: FileTreeProps) {
  const { root, children, expanded, toggle, refreshDir } = useFileTree(projectPath);
  const [menu, setMenu] = useState<ContextMenuState | null>(null);
  const [renamingPath, setRenamingPath] = useState<string | null>(null);
  const [dragOverPath, setDragOverPath] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // `true` durante e logo depois de um arrasto de verdade (moveu além do limiar) — o botão
  // de abrir/expandir consulta isso pra não disparar no soltar do mouse que terminou o drag.
  const justDraggedRef = useRef(false);

  // Arquivos arrastados de FORA do app (Explorer do Windows) chegam pelo evento nativo do
  // Tauri, não pelo HTML5 drag-and-drop — `dataTransfer` de um drop de arquivo do SO não
  // carrega o caminho real no navegador, só o Tauri expõe isso. Esse listener nativo é o
  // motivo de o arrasto INTERNO (abaixo) não poder usar a API HTML5 de drag-and-drop: com
  // `dragDropEnabled` ligado (padrão do Tauri, necessário pra este evento existir), o
  // WebView2 intercepta QUALQUER gesto de arrastar nativo da página, arquivo externo ou não —
  // por isso o move entre pastas é feito com pointerdown/pointermove/pointerup, que nunca
  // passa pelo sistema nativo de drag.
  useEffect(() => {
    if (!projectPath) return;
    let disposed = false;
    let unlisten: (() => void) | undefined;

    void getCurrentWebviewWindow()
      .onDragDropEvent((event) => {
        if (event.payload.type !== "drop") return;
        const scale = window.devicePixelRatio || 1;
        const element = document.elementFromPoint(event.payload.position.x / scale, event.payload.position.y / scale);
        const targetDir = resolveDropTargetDir(element, projectPath);
        if (!targetDir) return;
        void copyExternalPaths(event.payload.paths, targetDir);
      })
      .then((fn) => {
        if (disposed) fn();
        else unlisten = fn;
      });

    return () => {
      disposed = true;
      unlisten?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectPath]);

  if (!projectPath) return null;

  async function copyExternalPaths(paths: string[], targetDir: string) {
    for (const source of paths) {
      try {
        await copyIntoProject(projectPath!, source, targetDir);
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : String(reason));
      }
    }
    await refreshDir(targetDir);
  }

  async function handlePaste(event: React.ClipboardEvent) {
    const files = event.clipboardData?.files;
    if (!files || files.length === 0) return;
    event.preventDefault();
    const targetDir = resolveDropTargetDir(document.activeElement, projectPath!) ?? projectPath!;
    for (const file of Array.from(files)) {
      try {
        const buffer = new Uint8Array(await file.arrayBuffer());
        await writeBinaryFile(projectPath!, joinPath(targetDir, file.name), buffer);
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : String(reason));
      }
    }
    await refreshDir(targetDir);
  }

  function openMenu(event: React.MouseEvent, path: string, isDirectory: boolean) {
    event.preventDefault();
    event.stopPropagation();
    setMenu({ path, isDirectory, x: event.clientX, y: event.clientY });
  }

  async function handleCreateFile(dirPath: string) {
    setMenu(null);
    const name = window.prompt("Nome do arquivo:");
    if (!name) return;
    try {
      await createFile(projectPath!, joinPath(dirPath, name));
      await refreshDir(dirPath);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  }

  async function handleCreateDir(dirPath: string) {
    setMenu(null);
    const name = window.prompt("Nome da pasta:");
    if (!name) return;
    try {
      await createDir(projectPath!, joinPath(dirPath, name));
      await refreshDir(dirPath);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  }

  async function handleDelete(path: string, isDirectory: boolean) {
    setMenu(null);
    if (!window.confirm(`Excluir "${baseName(path)}"? Essa ação não pode ser desfeita.`)) return;
    try {
      await removePath(projectPath!, path, isDirectory);
      await refreshDir(dirName(path));
      onPathDeleted(path);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  }

  async function handleRevealInFolder(path: string) {
    setMenu(null);
    try {
      await revealItemInDir(path);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  }

  async function handleCopyPath(path: string) {
    setMenu(null);
    try {
      await navigator.clipboard.writeText(path);
    } catch {
      // clipboard falhar não é grave o bastante pra mostrar erro
    }
  }

  async function commitRename(path: string, isDirectory: boolean, newName: string) {
    setRenamingPath(null);
    const trimmed = newName.trim();
    if (!trimmed || trimmed === baseName(path)) return;
    const parent = dirName(path);
    const nextPath = joinPath(parent, trimmed);
    try {
      await renamePath(projectPath!, path, nextPath);
      await refreshDir(parent);
      if (!isDirectory) onFileRenamed(path, nextPath, trimmed);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  }

  async function moveEntry(source: DragPayload, targetDirPath: string) {
    if (isInvalidDropTarget(source, targetDirPath)) return;
    const nextPath = joinPath(targetDirPath, baseName(source.path));
    try {
      await renamePath(projectPath!, source.path, nextPath);
      await refreshDir(dirName(source.path));
      await refreshDir(targetDirPath);
      if (!source.isDirectory) onFileRenamed(source.path, nextPath, baseName(nextPath));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  }

  /** Início do arrasto interno de um arquivo/pasta — rastreado por ponteiro (ver o
   * comentário grande acima sobre por que não dá pra usar a API HTML5 de drag-and-drop). */
  function startNodeDrag(entry: FileEntry, event: React.PointerEvent) {
    if (event.button !== 0) return;
    const source: DragPayload = { path: entry.path, isDirectory: entry.isDirectory };
    const startX = event.clientX;
    const startY = event.clientY;
    let moved = false;

    function onMove(moveEvent: PointerEvent) {
      if (!moved) {
        if (Math.hypot(moveEvent.clientX - startX, moveEvent.clientY - startY) < DRAG_THRESHOLD_PX) return;
        moved = true;
        justDraggedRef.current = true;
      }
      const element = document.elementFromPoint(moveEvent.clientX, moveEvent.clientY);
      const target = resolveDropTargetDir(element, projectPath!);
      setDragOverPath(target && !isInvalidDropTarget(source, target) ? target : null);
    }

    function onUp(upEvent: PointerEvent) {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      if (moved) {
        const element = document.elementFromPoint(upEvent.clientX, upEvent.clientY);
        const target = resolveDropTargetDir(element, projectPath!);
        if (target) void moveEntry(source, target);
        // O `click` sintético do navegador dispara logo depois do pointerup — a supressão
        // precisa sobreviver até lá, por isso libera só no próximo tick, não aqui.
        window.setTimeout(() => {
          justDraggedRef.current = false;
        }, 0);
      }
      setDragOverPath(null);
    }

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }

  return (
    <div
      {...{ [TREE_ROOT_ATTR]: "true" }}
      tabIndex={-1}
      className={[
        "space-y-0.5 min-h-8 outline-none transition-colors duration-150",
        dragOverPath === projectPath ? "drop-target-active" : "",
      ].join(" ")}
      onContextMenu={(event) => openMenu(event, projectPath!, true)}
      onPaste={(event) => void handlePaste(event)}
    >
      {error && (
        <p role="alert" className="text-danger text-[11px] px-3 py-1">
          {error}
        </p>
      )}
      {root.length === 0 ? (
        <p className="text-text-muted text-xs px-6 py-1.5">Vazio</p>
      ) : (
        root.map((entry) => (
          <FileTreeNode
            key={entry.path}
            entry={entry}
            depth={0}
            childrenByPath={children}
            expanded={expanded}
            onToggle={toggle}
            onOpenFile={onOpenFile}
            onContextMenu={openMenu}
            renamingPath={renamingPath}
            onCommitRename={commitRename}
            onCancelRename={() => setRenamingPath(null)}
            dragOverPath={dragOverPath}
            onStartDrag={startNodeDrag}
            justDraggedRef={justDraggedRef}
          />
        ))
      )}

      {menu &&
        createPortal(
          <FileTreeContextMenu
            menu={menu}
            onClose={() => setMenu(null)}
            onRevealInFolder={() => void handleRevealInFolder(menu.path)}
            onCopyPath={() => void handleCopyPath(menu.path)}
            onNewFile={() => void handleCreateFile(menu.isDirectory ? menu.path : dirName(menu.path))}
            onNewFolder={() => void handleCreateDir(menu.isDirectory ? menu.path : dirName(menu.path))}
            onRename={
              menu.path === projectPath
                ? undefined
                : () => {
                    setRenamingPath(menu.path);
                    setMenu(null);
                  }
            }
            onDelete={menu.path === projectPath ? undefined : () => void handleDelete(menu.path, menu.isDirectory)}
          />,
          document.body
        )}
    </div>
  );
}

interface FileTreeNodeProps {
  entry: FileEntry;
  depth: number;
  childrenByPath: Map<string, FileEntry[]>;
  expanded: Set<string>;
  onToggle: (entry: FileEntry) => void;
  onOpenFile: (path: string, kind: "file" | "markdown") => void;
  onContextMenu: (event: React.MouseEvent, path: string, isDirectory: boolean) => void;
  renamingPath: string | null;
  onCommitRename: (path: string, isDirectory: boolean, newName: string) => void;
  onCancelRename: () => void;
  dragOverPath: string | null;
  onStartDrag: (entry: FileEntry, event: React.PointerEvent) => void;
  justDraggedRef: React.MutableRefObject<boolean>;
}

function FileTreeNode({
  entry,
  depth,
  childrenByPath,
  expanded,
  onToggle,
  onOpenFile,
  onContextMenu,
  renamingPath,
  onCommitRename,
  onCancelRename,
  dragOverPath,
  onStartDrag,
  justDraggedRef,
}: FileTreeNodeProps) {
  const isOpen = expanded.has(entry.path);
  const nested = childrenByPath.get(entry.path) ?? [];
  const isRenaming = renamingPath === entry.path;
  const [draftName, setDraftName] = useState(entry.name);
  const isDropTarget = entry.isDirectory && dragOverPath === entry.path;
  const iconRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (isRenaming) setDraftName(entry.name);
  }, [isRenaming, entry.name]);

  // "Gulp" do glifo da pasta: um bounce só de ida-e-volta no instante em que ela vira alvo
  // do arrasto — fecha o golfo de execução (fica óbvio que soltar aqui move o item pra
  // dentro). O anel pulsante em `.drop-target-active` (CSS, contínuo) é quem fecha o golfo
  // de avaliação: confirma sem parar, durante todo o arrasto, que o alvo continua sendo
  // este.
  useEffect(() => {
    const icon = iconRef.current;
    if (!icon || !isDropTarget) return;
    gsap.fromTo(icon, { scale: 1 }, { scale: 1.35, duration: 0.12, ease: "back.out(3)", yoyo: true, repeat: 1 });
  }, [isDropTarget]);

  return (
    <div>
      <div
        {...{ [TREE_NODE_PATH_ATTR]: entry.path, [TREE_NODE_DIR_ATTR]: String(entry.isDirectory) }}
        onPointerDown={isRenaming ? undefined : (event) => onStartDrag(entry, event)}
        onContextMenu={(event) => onContextMenu(event, entry.path, entry.isDirectory)}
        className={["transition-colors duration-150", isDropTarget ? "drop-target-active" : ""].join(" ")}
      >
        {isRenaming ? (
          <input
            autoFocus
            value={draftName}
            onChange={(event) => setDraftName(event.target.value)}
            onBlur={() => onCommitRename(entry.path, entry.isDirectory, draftName)}
            onKeyDown={(event) => {
              if (event.key === "Enter") onCommitRename(entry.path, entry.isDirectory, draftName);
              if (event.key === "Escape") onCancelRename();
            }}
            style={{ paddingLeft: `${depth * 14 + 24}px` }}
            className="field w-full !py-1 pr-3 text-xs"
          />
        ) : (
          <button
            type="button"
            onClick={() => {
              if (justDraggedRef.current) return;
              if (entry.isDirectory) onToggle(entry);
              else onOpenFile(entry.path, kindFor(entry.name));
            }}
            style={{ paddingLeft: `${depth * 14 + 24}px` }}
            className="w-full py-1 pr-3 text-left text-xs text-text-secondary hover:text-text-primary truncate cursor-default"
            title={entry.path}
          >
            <span ref={iconRef} className="mr-1.5 inline-block" aria-hidden="true">
              {entry.isDirectory ? (isOpen ? "▾" : "▸") : "·"}
            </span>
            {entry.name}
          </button>
        )}
      </div>
      {entry.isDirectory && isOpen && (
        <div>
          {nested.map((child) => (
            <FileTreeNode
              key={child.path}
              entry={child}
              depth={depth + 1}
              childrenByPath={childrenByPath}
              expanded={expanded}
              onToggle={onToggle}
              onOpenFile={onOpenFile}
              onContextMenu={onContextMenu}
              renamingPath={renamingPath}
              onCommitRename={onCommitRename}
              onCancelRename={onCancelRename}
              dragOverPath={dragOverPath}
              onStartDrag={onStartDrag}
              justDraggedRef={justDraggedRef}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function FileTreeContextMenu({
  menu,
  onClose,
  onRevealInFolder,
  onCopyPath,
  onNewFile,
  onNewFolder,
  onRename,
  onDelete,
}: {
  menu: ContextMenuState;
  onClose: () => void;
  onRevealInFolder: () => void;
  onCopyPath: () => void;
  onNewFile: () => void;
  onNewFolder: () => void;
  onRename?: () => void;
  onDelete?: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onDown(event: PointerEvent) {
      if (!ref.current?.contains(event.target as Node)) onClose();
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  return (
    <div ref={ref} role="menu" style={{ position: "fixed", top: menu.y, left: menu.x }} className="popover z-50 p-1 min-w-40">
      <MenuItem label="Abrir local do arquivo" onClick={onRevealInFolder} />
      <MenuItem label="Copiar caminho" onClick={onCopyPath} />
      <MenuItem label="Novo arquivo" onClick={onNewFile} />
      <MenuItem label="Nova pasta" onClick={onNewFolder} />
      {onRename && <MenuItem label="Renomear" onClick={onRename} />}
      {onDelete && <MenuItem label="Excluir" onClick={onDelete} danger />}
    </div>
  );
}

function MenuItem({ label, onClick, danger }: { label: string; onClick: () => void; danger?: boolean }) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className={[
        "w-full text-left px-2.5 py-1.5 text-xs rounded-none",
        danger ? "text-danger hover:bg-danger/10" : "text-text-secondary hover:text-text-primary hover:bg-overlay/[0.07]",
      ].join(" ")}
    >
      {label}
    </button>
  );
}
