import { useState } from "react";
import { useSettings } from "./hooks/useSettings";
import { Sidebar } from "./components/Sidebar";
import { SettingsView } from "./components/SettingsView";
import { AppBackground } from "./components/backgrounds/AppBackground";
import type { SettingsSection } from "./hooks/useNotifications";

type View = "workspace" | "settings";

export function App() {
  const [view, setView] = useState<View>("workspace");
  const [settingsSection, setSettingsSection] = useState<SettingsSection | undefined>();
  /* Lista local só pra provar que o seletor de diretório funciona (checklist
     da Fase 0). Persistência real de Project vem no domínio Workspace →
     Project → Pane → Session da Fase 1 — não adiantar aqui. */
  const [projects, setProjects] = useState<string[]>([]);

  const { settings, updateSettings, resetSettings } = useSettings();

  return (
    <div className="flex h-screen overflow-hidden">
      <AppBackground settings={settings} />

      <Sidebar
        projects={projects}
        showSettings={view === "settings"}
        onHome={() => setView("workspace")}
        onAddProject={(path) => setProjects((prev) => (prev.includes(path) ? prev : [...prev, path]))}
        onOpenSettings={(secao) => {
          setSettingsSection(secao);
          setView("settings");
        }}
      />

      <div className="flex-1 flex flex-col min-w-0 overflow-y-auto [scrollbar-gutter:stable]">
        <main className="flex-1 px-6 py-6 w-full mx-auto max-w-3xl">
          {view === "settings" ? (
            <SettingsView
              settings={settings}
              onChange={updateSettings}
              onReset={resetSettings}
              initialSection={settingsSection}
            />
          ) : (
            <div className="h-full flex items-center justify-center text-center">
              <div className="space-y-2">
                <p className="text-text-primary text-sm font-medium">Nenhuma pane aberta</p>
                <p className="text-text-muted text-xs">
                  Adicione um projeto na barra lateral para começar.
                </p>
              </div>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
