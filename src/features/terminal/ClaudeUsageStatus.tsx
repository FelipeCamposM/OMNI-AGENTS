import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { ReloadIcon } from "../../components/ui/PixelIcon";
import type { Usage, UsageWindow } from "./AccountUsage";
import { listProfiles } from "./terminalService";

export function timeAgo(ms: number, now: number) {
  const seconds = Math.max(0, Math.round((now - ms) / 1000));
  if (seconds < 60) return "agora";
  if (seconds < 3600) return `há ${Math.floor(seconds / 60)} min`;
  if (seconds < 86_400) return `há ${Math.floor(seconds / 3600)} h`;
  return `há ${Math.floor(seconds / 86_400)} d`;
}

const percent = (window: UsageWindow | null) => (window ? `${window.used_percent.toLocaleString("pt-BR")}%` : "—");
/** Reset curto para o rodapé: data do Codex formatada, ou o texto da TUI sem "Resets" e sem o fuso. */
export const resetShort = (window: UsageWindow | null) =>
  !window ? null
    : window.resets_at ? new Date(window.resets_at * 1000).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })
    : window.reset_label?.replace(/^Resets\s+/, "").replace(/\s*\(.*\)\s*$/, "") ?? null;
const resets = (label: string, window: UsageWindow | null) =>
  window && `${label}: ${window.resets_at ? new Date(window.resets_at * 1000).toLocaleString("pt-BR") : window.reset_label}`;

function Window({ label, window }: { label: string; window: UsageWindow | null }) {
  const reset = resetShort(window);
  return <span className="whitespace-nowrap">
    {label} <span className="text-accent font-bold">{percent(window)}</span>
    {reset && <span className="hidden xl:inline text-text-secondary"> · reseta {reset}</span>}
  </span>;
}

/** Uso da conta Claude usada por último, fixo no rodapé. Abrir só lê o cache do engine; digitar
 *  `/usage` num agente acontece apenas no clique do botão. */
export function ClaudeUsageStatus({ engineOnline }: { engineOnline: boolean }) {
  const [profileId, setProfileId] = useState<string | null>(null);
  const [usage, setUsage] = useState<Usage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(Date.now());
  const [attemptedAt, setAttemptedAt] = useState<number | null>(null);

  useEffect(() => {
    if (!engineOnline) return;
    let cancelled = false;
    void listProfiles().then(async profiles => {
      const profile = profiles.filter(p => p.provider === "claude")
        .sort((a, b) => (b.last_used_at_ms ?? 0) - (a.last_used_at_ms ?? 0))[0];
      if (!profile || cancelled) return;
      setProfileId(profile.id);
      const value = await invoke<Usage>("account_usage", { profileId: profile.id, refresh: false });
      if (!cancelled) setUsage(value);
    }).catch(reason => { if (!cancelled) setError(String(reason)); });
    return () => { cancelled = true; };
  }, [engineOnline]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  async function refresh() {
    if (!profileId) return;
    setBusy(true); setError(null);
    try { setUsage(await invoke<Usage>("account_usage", { profileId, refresh: true })); }
    catch (reason) { setError(String(reason)); }
    finally { setBusy(false); setNow(Date.now()); setAttemptedAt(Date.now()); }
  }

  if (!profileId) return null;
  const reason = error ?? usage?.reason;
  const checkedAt = usage?.observed_at_ms ?? attemptedAt;
  const checked = checkedAt ? `consultado ${timeAgo(checkedAt, now)}` : "sem consulta";
  const title = [resets("5 horas", usage?.primary ?? null), resets("Semana", usage?.secondary ?? null), checked, reason]
    .filter(Boolean).join("\n");
  return (
    <span className="flex min-w-0 items-center gap-2 lg:gap-3 text-[11px] font-semibold text-text-primary" title={title || undefined} aria-label="Uso do Claude">
      <span className="hidden md:inline text-accent">CLAUDE</span>
      <Window label="5H" window={usage?.primary ?? null} />
      <Window label="SEMANA" window={usage?.secondary ?? null} />
      <span className="hidden lg:inline whitespace-nowrap text-text-secondary font-normal">{checked}</span>
      {reason && <span className="text-warning">!</span>}
      <button
        type="button"
        aria-label="Consultar uso do Claude"
        title="Consultar /usage"
        disabled={busy || !engineOnline}
        onClick={() => void refresh()}
        className="shrink-0 text-text-secondary hover:text-accent disabled:opacity-50"
      >
        <ReloadIcon aria-hidden="true" className={`w-3.5 h-3.5${busy ? " animate-spin" : ""}`} />
      </button>
    </span>
  );
}
