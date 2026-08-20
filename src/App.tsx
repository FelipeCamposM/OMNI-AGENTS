import { useState } from "react";
import { useSettings } from "./hooks/useSettings";
import { useHistory } from "./hooks/useHistory";
import { Sidebar } from "./components/Sidebar";
import { Home } from "./components/Home";
import { HistoryView } from "./components/HistoryView";
import { SettingsView } from "./components/SettingsView";
import { AppBackground } from "./components/backgrounds/AppBackground";
import { ModuleGate } from "./components/ModuleGate";
import type { SettingsSection } from "./hooks/useNotifications";
import { getTool } from "./tools/registry";
import { useViewTransition } from "./lib/motion";

type View = "home" | "tool" | "history" | "settings";

export function App() {
  const [view, setView] = useState<View>("home");
  const [activeToolId, setActiveToolId] = useState<string | null>(null);
  const [selectedHistoryId, setSelectedHistoryId] = useState<string | null>(null);
  /** Seção inicial das Configurações — o sino aponta para a pendência. */
  const [settingsSection, setSettingsSection] = useState<SettingsSection | undefined>();

  const { settings, updateSettings, resetSettings } = useSettings();
  const { history, addEntry, deleteEntry, clearHistory } = useHistory(settings.historyLimit);

  const activeTool = activeToolId ? getTool(activeToolId) : null;
  const ToolComponent = view === "tool" ? activeTool?.component ?? null : null;

  const viewRef = useViewTransition<HTMLDivElement>(`${view}:${activeToolId ?? ""}`);

  function openTool(id: string) {
    setActiveToolId(id);
    setView("tool");
  }

  return (
    <div className="flex h-screen overflow-hidden">
      <AppBackground settings={settings} />

      <Sidebar
        activeToolId={view === "tool" ? activeToolId : null}
        showHistory={view === "history"}
        showSettings={view === "settings"}
        onHome={() => { setActiveToolId(null); setView("home"); }}
        onSelectTool={openTool}
        onOpenHistory={() => setView("history")}
        onOpenSettings={(secao) => { setSettingsSection(secao); setView("settings"); }}
      />

      {/* scrollbar-gutter: barra some/aparece sem empurrar o layout ao trocar de tool. */}
      <div className="flex-1 flex flex-col min-w-0 overflow-y-auto [scrollbar-gutter:stable]">
        <main
          className={[
            "flex-1 px-6 py-6 w-full mx-auto",
            activeTool?.wide && view === "tool" ? "max-w-6xl" : "max-w-3xl",
          ].join(" ")}
        >
          <div ref={viewRef}>
            {view === "history" ? (
              <HistoryView
                history={history}
                selectedId={selectedHistoryId}
                onSelect={setSelectedHistoryId}
                onDelete={deleteEntry}
                onClear={clearHistory}
              />
            ) : view === "settings" ? (
              <SettingsView
                settings={settings}
                onChange={updateSettings}
                onReset={resetSettings}
                historyCount={history.length}
                onClearHistory={clearHistory}
                initialSection={settingsSection}
              />
            ) : ToolComponent ? (
              <div className="space-y-4">
                <div>
                  <h1 className="text-text-primary text-lg font-semibold">{activeTool?.name}</h1>
                  <p className="text-text-muted text-xs">{activeTool?.description}</p>
                </div>
                {activeTool?.module ? (
                  <ModuleGate id={activeTool.module}>
                    <ToolComponent settings={settings} addHistory={addEntry} />
                  </ModuleGate>
                ) : (
                  <ToolComponent settings={settings} addHistory={addEntry} />
                )}
              </div>
            ) : (
              <Home
                onSelect={openTool}
                ultimaVersaoVista={settings.lastSeenVersion}
                onNovidadesVistas={(versao) => updateSettings({ lastSeenVersion: versao })}
              />
            )}
          </div>
        </main>
      </div>
    </div>
  );
}
