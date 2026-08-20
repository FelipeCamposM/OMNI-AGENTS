import { Clock, House, Settings } from "lucide-react";
import { useEffect, useRef } from "react";
import gsap from "gsap";
import { CATEGORY_ORDER, CATEGORY_LABELS, toolsByCategory } from "../tools/registry";
import { useGlassSheen, useStagger } from "../lib/motion";
import { NotificationBell } from "./NotificationBell";
import type { SettingsSection } from "../hooks/useNotifications";
/* O mesmo arquivo que o Tauri usa como ícone do app (tauri.conf.json →
   bundle.icon). Importado em vez de copiado para src/assets: uma cópia
   dessincronizaria do ícone real na próxima troca de marca. */
import appIcon from "../../src-tauri/icons/128x128.png";

interface SidebarProps {
  activeToolId: string | null;
  showHistory: boolean;
  showSettings: boolean;
  onHome: () => void;
  onSelectTool: (id: string) => void;
  onOpenHistory: () => void;
  /** Sem argumento = seção padrão. O sino manda a seção da pendência. */
  onOpenSettings: (secao?: SettingsSection) => void;
}

export function Sidebar({
  activeToolId,
  showHistory,
  showSettings,
  onHome,
  onSelectTool,
  onOpenHistory,
  onOpenSettings,
}: SidebarProps) {
  const atHome = activeToolId === null && !showHistory && !showSettings;
  const sheenRef = useGlassSheen<HTMLElement>();
  const navRef = useStagger<HTMLElement>("[data-nav-item]");

  return (
    <aside
      ref={sheenRef}
      className="glass glass-strong glass-sheen w-56 shrink-0 flex flex-col h-screen sticky top-0 rounded-none border-y-0 border-l-0"
    >
      {/* Logo + sino. O sino é irmão do botão, não filho: <button> dentro de
          <button> é HTML inválido e o clique de um engole o do outro. */}
      <div className="px-4 py-5 border-b border-border-subtle/60 flex items-center gap-2">
        <button
          onClick={onHome}
          className="flex items-center gap-2.5 text-left min-w-0 flex-1 !rounded-lg focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
        >
          <img
            src={appIcon}
            alt=""
            aria-hidden="true"
            className="neon-glow w-7 h-7 rounded-lg shrink-0 object-contain"
          />
          <div className="min-w-0">
            <p className="text-text-primary text-xs font-semibold leading-tight truncate">CAMPS-UTILS</p>
            <p className="text-text-muted text-[10px] leading-tight truncate">Utilitários locais</p>
          </div>
        </button>

        <NotificationBell onOpenSettings={onOpenSettings} />
      </div>

      {/* Nav */}
      <nav ref={navRef} className="px-2 py-3 flex-1 min-h-0 overflow-y-auto space-y-3">
        <NavItem active={atHome} onClick={onHome} icon={<House className="w-4 h-4" aria-hidden="true" />} label="Início" />

        {CATEGORY_ORDER.map((category) => {
          const tools = toolsByCategory(category);
          if (tools.length === 0) return null;
          return (
            <div key={category} className="space-y-0.5">
              <p className="text-text-muted text-[10px] font-medium uppercase tracking-wider px-3 pt-1">
                {CATEGORY_LABELS[category]}
              </p>
              {tools.map((tool) => (
                <NavItem
                  key={tool.id}
                  active={activeToolId === tool.id}
                  onClick={() => onSelectTool(tool.id)}
                  icon={<span className="w-4 h-4 block">{tool.icon}</span>}
                  label={tool.name}
                />
              ))}
            </div>
          );
        })}
      </nav>

      {/* Footer */}
      <div className="px-2 py-3 border-t border-border-subtle/60 space-y-0.5">
        <NavItem active={showHistory} onClick={onOpenHistory} icon={<Clock className="w-4 h-4" aria-hidden="true" />} label="Histórico" />
        <NavItem
          active={showSettings}
          /* Seta explícita: passar `onOpenSettings` direto entregaria o
             MouseEvent como se fosse a seção de destino. */
          onClick={() => onOpenSettings()}
          icon={<Settings className="w-4 h-4" aria-hidden="true" />}
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
        "relative w-full flex items-center gap-2.5 px-3 py-2 !rounded-lg text-sm transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent",
        active
          ? "glass glass-sheen text-text-primary font-medium"
          : "text-text-secondary hover:text-text-primary hover:bg-overlay/[0.07]",
      ].join(" ")}
    >
      <span
        ref={barRef}
        aria-hidden="true"
        className={[
          "absolute left-0 top-1.5 bottom-1.5 w-0.5 rounded-full origin-center opacity-0 scale-y-0",
          active ? "neon-bar" : "bg-border",
        ].join(" ")}
      />
      <span className={active ? "neon" : ""}>{icon}</span>
      <span className="truncate">{label}</span>
    </button>
  );
}




