import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { ReloadIcon } from "../../components/ui/PixelIcon";

export interface UsageWindow { used_percent: number; resets_at: number | null; reset_label: string | null }
export interface Usage { status: string; observed_at_ms: number | null; primary: UsageWindow | null; secondary: UsageWindow | null; reason: string | null }

/** Uma janela de uso como medidor: a barra esquenta perto do limite. */
function WindowUsage({ label, window }: { label: string; window: UsageWindow | null }) {
  const pct = window ? Math.min(100, Math.max(0, window.used_percent)) : 0;
  const tom = pct >= 90 ? "danger" : pct >= 70 ? "warning" : "accent";
  return <div className="ag-medidor" data-tom={tom}>
    <span className="ag-medidor-topo">
      <span className="text-text-secondary">{label}</span>
      <span className="ag-medidor-valor">{window ? `${window.used_percent.toLocaleString("pt-BR")}% consumido` : "indisponível"}</span>
    </span>
    <span className="ag-medidor-trilho" aria-hidden><span style={{ width: `${pct}%` }} /></span>
    {window && <span className="ag-medidor-sub">{window.resets_at ? `Reseta em ${new Date(window.resets_at * 1000).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}` : window.reset_label}</span>}
  </div>;
}

export function AccountUsage({ profileId, provider, onUsage }: { profileId: string; provider: string; onUsage?: (usage: Usage | null) => void }) {
  const [usage, setUsage] = useState<Usage | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Os KPIs de Agentes leem daqui; quem chama guarda por id, então só o valor importa.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { onUsage?.(usage); }, [usage]);
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
  return <div className="ag-uso" aria-label={`Uso ${profileId}`}>
    <div className="ag-medidores"><WindowUsage label="5 horas" window={usage?.primary ?? null} /><WindowUsage label="Semana" window={usage?.secondary ?? null} /></div>
    <div className="ag-uso-rodape">
      <span className="min-w-0">
        {provider === "codex" ? "Medido no registro do Codex" : provider === "antigravity" ? "Última consulta do Antigravity (quanto já foi usado)" : "Última consulta do Claude Code"}
        {usage?.observed_at_ms && <> · {new Date(usage.observed_at_ms).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}{stale ? " · desatualizado" : ""}</>}
      </span>
      <button type="button" className="ag-acao" disabled={busy} onClick={() => void refresh()}>
        <ReloadIcon aria-hidden className={`h-3 w-3${busy ? " anexo-girando" : ""}`} />{busy ? "Consultando…" : provider === "claude" || provider === "antigravity" ? "Consultar /usage" : "Atualizar uso"}
      </button>
    </div>
    {(error || usage?.reason) && <p role={error ? "alert" : undefined} className="ag-uso-motivo">{error ? `Indisponível: ${error}` : usage?.reason}</p>}
  </div>;
}
