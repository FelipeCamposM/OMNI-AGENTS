import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Button } from "../../components/ui";

interface UsageWindow { used_percent: number; resets_at: number | null; reset_label: string | null }
interface Usage { status: string; observed_at_ms: number | null; primary: UsageWindow | null; secondary: UsageWindow | null; reason: string | null }

function WindowUsage({ label, window }: { label: string; window: UsageWindow | null }) {
  return <div className="min-w-0">
    <span className="text-text-secondary">{label}: </span>
    <span>{window ? `${window.used_percent.toLocaleString("pt-BR")}% consumido` : "indisponível"}</span>
    {window && <p className="text-text-muted">{window.resets_at ? `Reseta em ${new Date(window.resets_at * 1000).toLocaleString("pt-BR")}` : window.reset_label}</p>}
  </div>;
}

export function AccountUsage({ profileId, provider }: { profileId: string; provider: string }) {
  const [usage, setUsage] = useState<Usage | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    setUsage(null); setError(null);
    invoke<Usage>("account_usage", { profileId, refresh: false }).then(value => {
      if (!cancelled) setUsage(value);
    }).catch(reason => { if (!cancelled) setError(String(reason)); });
    return () => { cancelled = true; };
  }, [profileId, provider]);
  async function refresh() {
    setBusy(true); setError(null);
    try { setUsage(await invoke<Usage>("account_usage", { profileId, refresh: true })); }
    catch (reason) { setError(String(reason)); }
    finally { setBusy(false); }
  }
  const stale = usage?.status === "stale" || [usage?.primary, usage?.secondary].some(w => w?.resets_at && w.resets_at * 1000 <= Date.now());
  return <div className="w-full border-l-2 border-border-subtle pl-3 text-[11px] space-y-1" aria-label={`Uso ${profileId}`}>
    <p className="text-text-muted">{provider === "codex" ? "Medido no registro do Codex" : "Lido da tela · melhor esforço"}</p>
    <div className="grid gap-2 sm:grid-cols-2"><WindowUsage label="5 horas" window={usage?.primary ?? null} /><WindowUsage label="Semana" window={usage?.secondary ?? null} /></div>
    {usage?.observed_at_ms && <p className="text-text-muted">Observado em {new Date(usage.observed_at_ms).toLocaleString("pt-BR")}{stale ? " · desatualizado" : ""}</p>}
    {(error || usage?.reason) && <p role={error ? "alert" : undefined} className="text-text-muted">{error ? `Indisponível: ${error}` : usage?.reason}</p>}
    <Button size="sm" variant="ghost" disabled={busy} onClick={() => void refresh()}>{busy ? "Consultando…" : provider === "claude" ? "Consultar /usage" : "Atualizar uso"}</Button>
  </div>;
}
