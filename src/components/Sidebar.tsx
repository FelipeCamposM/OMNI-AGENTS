import { FolderPlusIcon as FolderPlus, SlidersIcon as Sliders } from "./ui/PixelIcon";
import { useEffect, useRef } from "react";
import gsap from "gsap";
import { open } from "@tauri-apps/plugin-dialog";
import { useStagger } from "../lib/motion";
import { NotificationBell } from "./NotificationBell";
import type { SettingsSection } from "../hooks/useNotifications";
/* O mesmo arquivo que o Tauri usa como ícone do app (tauri.conf.json →
   bundle.icon). Importado em vez de copiado para src/assets: uma cópia
   dessincronizaria do ícone real na próxima troca de marca. */
import appIcon from "../../src-tauri/icons/128x128.png";

/** Seções do spec 7.3. Vazias por enquanto — Workspace/Project/Pane/Session
 * (Fase 1) é quem vai preencher cada uma com dados de verdade. */
const SECTIONS = ["AGENTS", "TERMINALS", "COMMANDS", "DOCKER", "FILES", "GIT"] as const;

interface SidebarProps {
  projects: string[];
  showSettings: boolean;
  onHome: () => void;
  onAddProject: (path: string) => void;
  onOpenSettings: (secao?: SettingsSection) => void;
}

export function Sidebar({ projects, showSettings, onHome, onAddProject, onOpenSettings }: SidebarProps) {
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
            <p className="text-text-muted text-[10px] leading-tight truncate">Workspace</p>
          </div>
        </button>

        <NotificationBell onOpenSettings={onOpenSettings} />
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
            projects.map((path) => (
              <div key={path} data-nav-item className="px-3 py-1.5 text-text-secondary text-xs truncate" title={path}>
                {path.split(/[\\/]/).filter(Boolean).pop() ?? path}
              </div>
            ))
          )}
        </div>

        {SECTIONS.map((section) => (
          <div key={section} className="space-y-0.5">
            <p className="text-text-muted text-[10px] font-medium uppercase tracking-wider px-3 pt-1">
              {section}
            </p>
            <p data-nav-item className="text-text-muted text-xs px-3 py-1.5">
              Vazio
            </p>
          </div>
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
