import {
  BookIcon,
  BoxIcon,
  ChatIcon,
  FolderPlusIcon as FolderPlus,
  GitBranchIcon,
  KanbanIcon,
  ListIcon,
  SlidersIcon as Sliders,
  TerminalIcon,
} from "./ui/PixelIcon";
import { useEffect, useRef, useState } from "react";
import gsap from "gsap";
import { open } from "@tauri-apps/plugin-dialog";
import { useStagger } from "../lib/motion";
import { NotificationBell } from "./NotificationBell";
import type { SettingsSection } from "../hooks/useNotifications";
import type { KanbanState } from "../types/kanban";
import type { Project, WorkspaceState } from "../types/workspace";
import type { TerminalSession } from "../features/terminal/terminalService";
import { WorkspaceSwitcher } from "./WorkspaceSwitcher";
import { FileTree } from "./FileTree";
import { GitPanel } from "./GitPanel";
import { KanbanPanel } from "./KanbanPanel";
import { SkillsList } from "./SkillsList";
/* O mesmo arquivo que o Tauri usa como ícone do app (tauri.conf.json →
   bundle.icon). Importado em vez de copiado para src/assets: uma cópia
   dessincronizaria do ícone real na próxima troca de marca. */
import appIcon from "../../src-tauri/icons/128x128.png";

/** Seções do spec 7.3. Vazias por enquanto — Workspace/Project/Pane/Session
 * (Fase 1) é quem vai preencher cada uma com dados de verdade. */
const SECTIONS = ["AGENTS", "TERMINALS", "COMMANDS", "DOCKER", "FILES", "SKILLS", "GIT", "KANBAN"] as const;

const SECTION_ICON: Record<(typeof SECTIONS)[number], React.ComponentType<{ className?: string; "aria-hidden"?: boolean }>> = {
  AGENTS: ChatIcon,
  TERMINALS: TerminalIcon,
  COMMANDS: ListIcon,
  DOCKER: BoxIcon,
  FILES: FolderPlus,
  SKILLS: BookIcon,
  GIT: GitBranchIcon,
  KANBAN: KanbanIcon,
};

interface SidebarProps {
  workspaces: WorkspaceState[];
  activeWorkspaceId: string | null;
  onSelectWorkspace: (workspaceId: string) => void;
  onCreateWorkspace: () => void;
  onCloseWorkspace: (workspaceId: string) => void;
  onRenameWorkspace: (workspaceId: string, name: string) => void;
  projects: Project[];
  activeProjectId: string | null;
  activeProjectPath: string | null;
  onOpenFile: (path: string, kind: "file" | "markdown") => void;
  onFileRenamed: (fromPath: string, toPath: string, title: string) => void;
  onPathDeleted: (path: string) => void;
  terminalSessions: TerminalSession[];
  showSettings: boolean;
  onHome: () => void;
  onAddProject: (path: string) => void;
  onSelectProject: (projectId: string) => void;
  onCloseProject: (projectId: string) => void;
  onAttachTerminal: (sessionId: string, title: string) => void;
  onCloseTerminal: (sessionId: string) => void;
  onDuplicateTerminal: (sessionId: string) => void;
  onRestartTerminal: (sessionId: string) => void;
  onOpenSettings: (secao?: SettingsSection) => void;
  onOpenGitDiff: (file: string, staged: boolean) => void;
  onOpenGitGraph: () => void;
  kanban: KanbanState;
  onOpenKanban: () => void;
}

export function Sidebar({
  workspaces,
  activeWorkspaceId,
  onSelectWorkspace,
  onCreateWorkspace,
  onCloseWorkspace,
  onRenameWorkspace,
  projects,
  activeProjectId,
  activeProjectPath,
  onOpenFile,
  onFileRenamed,
  onPathDeleted,
  terminalSessions,
  showSettings,
  onHome,
  onAddProject,
  onSelectProject,
  onCloseProject,
  onAttachTerminal,
  onCloseTerminal,
  onDuplicateTerminal,
  onRestartTerminal,
  onOpenSettings,
  onOpenGitDiff,
  onOpenGitGraph,
  kanban,
  onOpenKanban,
}: SidebarProps) {
  const navRef = useStagger<HTMLElement>("[data-nav-item]");

  async function pickProject() {
    const result = await open({ directory: true, multiple: false });
    if (typeof result === "string") onAddProject(result);
  }

  return (
    <aside className="glass glass-strong w-64 shrink-0 flex flex-col h-screen sticky top-0 rounded-none border-y-0 border-l-0">
      {/* Logo + sino. O sino é irmão do botão, não filho: <button> dentro de
          <button> é HTML inválido e o clique de um engole o do outro. */}
      <div className="px-4 py-5 border-b border-border-subtle/60 flex items-center gap-2">
        <button
          onClick={onHome}
          className="flex items-center gap-2.5 text-left min-w-0 flex-1 rounded-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
        >
          <img
            src={appIcon}
            alt=""
            aria-hidden="true"
            className="neon-glow w-7 h-7 rounded-none shrink-0 object-contain"
          />
          <div className="min-w-0">
            <p className="pixel-text text-text-primary text-xs leading-tight truncate">OMNI AGENTS</p>
          </div>
        </button>

        <NotificationBell onOpenSettings={onOpenSettings} />
      </div>

      <div className="px-4 py-2 border-b border-border-subtle/60">
        <WorkspaceSwitcher
          workspaces={workspaces}
          activeWorkspaceId={activeWorkspaceId}
          onSelect={onSelectWorkspace}
          onCreate={onCreateWorkspace}
          onClose={onCloseWorkspace}
          onRename={onRenameWorkspace}
        />
      </div>

      {/* Nav */}
      <nav ref={navRef} className="px-2 py-3 flex-1 min-h-0 overflow-y-auto space-y-3">
        <div className="space-y-0.5">
          <div className="flex items-center justify-between px-3 pt-1">
            <p className="text-text-muted text-[10px] font-medium uppercase tracking-wider">Projects</p>
            <button
              data-nav-item
              onClick={pickProject}
              aria-label="Adicionar projeto"
              className="text-text-muted hover:text-text-primary rounded-none p-0.5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
            >
              <FolderPlus className="w-3.5 h-3.5" aria-hidden="true" />
            </button>
          </div>
          {projects.length === 0 ? (
            <p data-nav-item className="text-text-muted text-xs px-3 py-1.5">
              Nenhum projeto ainda.
            </p>
          ) : (
            projects.map((project) => (
              <div key={project.id} className="group flex items-stretch">
                <button
                  type="button"
                  data-nav-item
                  aria-current={project.id === activeProjectId ? "page" : undefined}
                  onClick={() => onSelectProject(project.id)}
                  className={[
                    "min-w-0 flex-1 px-3 py-2 text-left text-xs truncate border-l-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent",
                    project.id === activeProjectId
                      ? "border-accent bg-accent-muted text-text-primary"
                      : "border-transparent text-text-secondary hover:text-text-primary hover:bg-overlay/[0.07]",
                  ].join(" ")}
                  title={project.path}
                >
                  <FolderPlus className="mr-2 inline w-3 h-3 shrink-0 text-accent" aria-hidden />
                  {project.name}
                </button>
                <button
                  type="button"
                  aria-label={`Fechar projeto ${project.name}`}
                  title="Fechar projeto"
                  onClick={() => onCloseProject(project.id)}
                  className="w-8 shrink-0 text-text-muted opacity-60 hover:text-danger hover:opacity-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
                >
                  ×
                </button>
              </div>
            ))
          )}
        </div>

        {SECTIONS.map((section) => (
          <SidebarSection key={section} label={section} icon={SECTION_ICON[section]} disabled={!activeProjectId}>
            {section === "TERMINALS" && terminalSessions.length > 0
              ? terminalSessions.map((session) => (
                  <div key={session.id} className="group flex items-stretch pl-6">
                    <button
                      type="button"
                      onClick={() => onAttachTerminal(session.id, session.name)}
                      className="min-w-0 flex-1 py-1.5 text-left text-xs text-text-secondary hover:text-text-primary truncate"
                      title={`${session.name} · ${session.state}`}
                    >
                      <span className="mr-2" aria-hidden="true">{sessionGlyph(session.state)}</span>
                      {session.name}
                    </button>
                    <button
                      type="button"
                      aria-label={`Duplicar agente ${session.name}`}
                      title="Duplicar sessão"
                      onClick={() => onDuplicateTerminal(session.id)}
                      className="w-8 shrink-0 text-text-muted opacity-60 hover:text-text-primary hover:opacity-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
                    >
                      ⧉
                    </button>
                    <button
                      type="button"
                      aria-label={`Reiniciar agente ${session.name}`}
                      title="Reiniciar sessão"
                      onClick={() => onRestartTerminal(session.id)}
                      className="w-8 shrink-0 text-text-muted opacity-60 hover:text-text-primary hover:opacity-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
                    >
                      ↻
                    </button>
                    <button
                      type="button"
                      aria-label={`Fechar agente ${session.name}`}
                      title="Encerrar e remover agente"
                      onClick={() => onCloseTerminal(session.id)}
                      className="w-8 shrink-0 text-text-muted opacity-60 hover:text-danger hover:opacity-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
                    >
                      ×
                    </button>
                  </div>
                ))
              : section === "FILES"
              ? (
                  <FileTree
                    projectPath={activeProjectPath}
                    onOpenFile={onOpenFile}
                    onFileRenamed={onFileRenamed}
                    onPathDeleted={onPathDeleted}
                  />
                )
              : section === "SKILLS"
              ? <SkillsList projectPath={activeProjectPath} onOpenFile={onOpenFile} />
              : section === "GIT"
              ? <GitPanel projectPath={activeProjectPath} onOpenDiff={onOpenGitDiff} onOpenGraph={onOpenGitGraph} />
              : section === "KANBAN"
              ? <KanbanPanel projectId={activeProjectId} kanban={kanban} onOpenBoard={onOpenKanban} />
              : undefined}
          </SidebarSection>
        ))}
      </nav>

      {/* Footer */}
      <div className="px-2 py-3 border-t border-border-subtle/60 space-y-0.5">
        <NavItem
          active={showSettings}
          onClick={() => onOpenSettings()}
          icon={<Sliders className="w-4 h-4" aria-hidden="true" />}
          label="Configurações"
        />
      </div>
    </aside>
  );
}

function SidebarSection({
  label,
  icon: Icon,
  disabled,
  children,
}: {
  label: string;
  icon?: React.ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
  disabled: boolean;
  children?: React.ReactNode;
}) {
  const [open, setOpen] = useState(true);
  return (
    <div className="space-y-0.5">
      <button
        type="button"
        data-nav-item
        aria-expanded={open}
        disabled={disabled}
        onClick={() => setOpen((value) => !value)}
        className="w-full flex items-center gap-2 text-text-muted text-[10px] font-medium uppercase tracking-wider px-3 pt-1 disabled:opacity-40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
      >
        <span aria-hidden="true">{open ? "▾" : "▸"}</span>
        {Icon && <Icon className="w-3 h-3 shrink-0" aria-hidden />}
        {label}
      </button>
      {open && !disabled && (children ?? <p data-nav-item className="text-text-muted text-xs px-6 py-1.5">Vazio</p>)}
    </div>
  );
}

function sessionGlyph(state: TerminalSession["state"]) {
  if (state === "working") return "▸";
  if (state === "approval_required") return "⏵";
  if (state === "crashed") return "✖";
  if (state === "orphan") return "⚠";
  if (state === "answered") return "●";
  return "○";
}

function NavItem({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
}) {
  const barRef = useRef<HTMLSpanElement>(null);

  // Barra de acento cresce ao virar ativo; some ao sair.
  useEffect(() => {
    const bar = barRef.current;
    if (!bar) return;
    gsap.to(bar, {
      scaleY: active ? 1 : 0,
      opacity: active ? 1 : 0,
      duration: 0.32,
      ease: active ? "back.out(2)" : "power2.in",
    });
  }, [active]);

  return (
    <button
      data-nav-item
      onClick={onClick}
      className={[
        "relative w-full flex items-center gap-2.5 px-3 py-2 rounded-none text-sm transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent",
        active
          ? "glass text-text-primary font-medium"
          : "text-text-secondary hover:text-text-primary hover:bg-overlay/[0.07]",
      ].join(" ")}
    >
      <span
        ref={barRef}
        aria-hidden="true"
        className={[
          "absolute left-0 top-1.5 bottom-1.5 w-0.5 rounded-none origin-center opacity-0 scale-y-0",
          active ? "neon-bar" : "bg-border",
        ].join(" ")}
      />
      <span className={active ? "neon" : ""}>{icon}</span>
      <span className="truncate">{label}</span>
    </button>
  );
}
