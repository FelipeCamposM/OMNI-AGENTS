import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { ReloadIcon } from "../../components/ui/PixelIcon";
import { AgentIcon } from "../../components/ui/AgentIcon";
import { nomeCurtoDoModelo, rotuloDoEsforco, type AgentRuntime } from "./AgentRuntimeBadge";
import type { Usage, UsageWindow } from "./AccountUsage";
import { useSession } from "./sessionProviders";
import { listProfiles, type Profile } from "./terminalService";

export function timeAgo(ms: number, now: number) {
  const seconds = Math.max(0, Math.round((now - ms) / 1000));
  if (seconds < 60) return "agora";
  if (seconds < 3600) return `há ${Math.floor(seconds / 60)} min`;
  if (seconds < 86_400) return `há ${Math.floor(seconds / 3600)} h`;
  return `há ${Math.floor(seconds / 86_400)} d`;
}

const percent = (window: UsageWindow | null) => (window ? `${window.used_percent.toLocaleString("pt-BR")}%` : "—");

/**
 * Faixas de consumo pedidas: verde até 60%, amarelo até 85%, vermelho de 86% em diante.
 * O corte é por valor, não por arredondamento — 85,4% já é vermelho.
 */
export function usageTone(used: number): { bar: string; text: string } {
  if (used <= 60) return { bar: "bg-success", text: "text-success" };
  if (used <= 85) return { bar: "bg-warning", text: "text-warning" };
  return { bar: "bg-danger", text: "text-danger" };
}

function UsageBar({ used, label }: { used: number; label: string }) {
  const preenchido = Math.min(100, Math.max(0, used));
  return (
    <span
      role="progressbar"
      aria-label={label}
      aria-valuenow={Math.round(used)}
      aria-valuemin={0}
      aria-valuemax={100}
      className="relative block h-1.5 w-8 shrink-0 bg-overlay/[0.16] lg:w-12"
    >
      <span className={`absolute inset-y-0 left-0 ${usageTone(used).bar}`} style={{ width: `${preenchido}%` }} />
    </span>
  );
}

/** Reset curto para o rodapé: data do Codex formatada, ou o texto da TUI sem "Resets" e sem o fuso. */
export const resetShort = (window: UsageWindow | null) =>
  !window ? null
    : window.resets_at ? shortDate(window.resets_at * 1000)
    : window.reset_label?.replace(/^Resets\s+/, "").replace(/\s*\(.*\)\s*$/, "") ?? null;
/** Hoje: só a hora ("11:40"). Outro dia: "17/09 14:00". */
function shortDate(ms: number) {
  const date = new Date(ms);
  const time = date.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  return date.toDateString() === new Date().toDateString()
    ? time
    : `${date.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })} ${time}`;
}

const resets = (label: string, window: UsageWindow | null) =>
  window && `${label}: ${window.resets_at ? new Date(window.resets_at * 1000).toLocaleString("pt-BR") : window.reset_label}`;

function Window({ label, window }: { label: string; window: UsageWindow | null }) {
  const reset = resetShort(window);
  const tone = window ? usageTone(window.used_percent).text : "text-accent";
  return <span className="flex items-center gap-1.5 whitespace-nowrap">
    {label}
    {window && <UsageBar used={window.used_percent} label={`${label} consumido`} />}
    <span className={`font-bold ${tone}`}>{percent(window)}</span>
    {reset && <span className="hidden xl:inline text-text-secondary font-normal"> · reseta {reset}</span>}
  </span>;
}

const PROVIDER_LABEL: Record<string, string> = { claude: "CLAUDE", codex: "CODEX", cursor: "CURSOR" };

interface AgentUsageStatusProps {
  engineOnline: boolean;
  /** Sessão da aba em foco. É ela que decide de quem é o uso mostrado. */
  activeSessionId?: string | null;
}

/**
 * Uso da conta do agente em foco, fixo no rodapé, com barra colorida por faixa de consumo e o
 * modelo/esforço que está atendendo aquela aba.
 *
 * Quem manda é a aba ativa: com o Claude na frente sai o uso do Claude, com o Codex sai o do Codex.
 * Aba que não é de agente (terminal puro, arquivo, kanban) cai na conta usada mais recentemente —
 * esvaziar o rodapé a cada clique num arquivo seria pior que mostrar o último agente conhecido.
 *
 * Abrir só lê o cache do engine; digitar `/usage` num agente acontece apenas no clique do botão.
 */
export function AgentUsageStatus({ engineOnline, activeSessionId }: AgentUsageStatusProps) {
  const session = useSession(activeSessionId);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [usage, setUsage] = useState<Usage | null>(null);
  const [runtime, setRuntime] = useState<AgentRuntime | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(Date.now());
  const [attemptedAt, setAttemptedAt] = useState<number | null>(null);

  useEffect(() => {
    if (!engineOnline) return;
    let cancelled = false;
    void listProfiles()
      .then(lista => { if (!cancelled) setProfiles(lista); })
      .catch(reason => { if (!cancelled) setError(String(reason)); });
    return () => { cancelled = true; };
  }, [engineOnline]);

  // Sem aba de agente em foco, o rodapé cai na conta usada mais recentemente entre os providers que
  // têm consulta de uso. Sessão de agente sem `profile_id` (spawn antigo) cai na conta mais recente
  // *daquele* provider — melhor que sumir com o número.
  const recente = (lista: Profile[]) =>
    [...lista].sort((a, b) => (b.last_used_at_ms ?? 0) - (a.last_used_at_ms ?? 0))[0] ?? null;
  const provider =
    session?.provider ?? recente(profiles.filter(p => p.provider === "claude" || p.provider === "codex"))?.provider ?? null;
  const profileId =
    session?.profile_id ?? (provider ? recente(profiles.filter(p => p.provider === provider))?.id ?? null : null);

  const leitura = useCallback(async (refresh: boolean) => {
    if (!profileId) return null;
    return invoke<Usage>("account_usage", { profileId, refresh });
  }, [profileId]);

  // Troca de aba zera o que era da anterior: manter o número antigo durante a releitura mostraria
  // o uso de um agente com o nome de outro.
  useEffect(() => {
    let cancelled = false;
    setUsage(null);
    setError(null);
    setAttemptedAt(null);
    if (!engineOnline || !profileId) return;
    void leitura(false).then(value => { if (!cancelled && value) setUsage(value); })
      .catch(reason => { if (!cancelled) setError(String(reason)); });
    return () => { cancelled = true; };
  }, [engineOnline, profileId, leitura]);

  // Modelo e esforço saem do registro que a própria CLI grava — mesma fonte da etiqueta da pane.
  // Relê periodicamente porque um `/model` no meio da conversa troca os dois.
  // Deps são os campos, não o objeto: o poll de sessões devolve objetos novos a cada segundo e
  // depender dele reiniciaria a leitura (e piscaria o texto) o tempo todo.
  const sessionProvider = session?.provider ?? null;
  const sessionProfile = session?.profile_id ?? null;
  const sessionCwd = session?.cwd ?? null;
  const sessionExternal = session?.external_session_id ?? null;
  useEffect(() => {
    let cancelled = false;
    let timer: number | undefined;
    setRuntime(null);
    if (!sessionProvider || !sessionCwd) return;
    async function ler() {
      try {
        const valor = await invoke<AgentRuntime | null>("agent_runtime", {
          provider: sessionProvider,
          profileId: sessionProfile,
          cwd: sessionCwd,
          externalSessionId: sessionExternal,
        });
        if (!cancelled) setRuntime(valor);
      } catch {
        // Enfeite informativo: perfil sumido ou arquivo ilegível some com o texto, nunca vira erro.
        if (!cancelled) setRuntime(null);
      }
      if (!cancelled) timer = window.setTimeout(ler, 30_000);
    }
    void ler();
    return () => { cancelled = true; if (timer) window.clearTimeout(timer); };
  }, [sessionProvider, sessionProfile, sessionCwd, sessionExternal]);

  // Relê o que a CLI gravou (não digita nada): pega também um /usage feito à mão no agente.
  useEffect(() => {
    const timer = window.setInterval(() => {
      setNow(Date.now());
      if (profileId && engineOnline && !busy) {
        void leitura(false).then(value => { if (value) setUsage(value); }).catch(() => undefined);
      }
    }, 30_000);
    return () => window.clearInterval(timer);
  }, [profileId, engineOnline, busy, leitura]);

  async function refresh() {
    if (!profileId) return;
    setBusy(true); setError(null);
    try {
      const value = await leitura(true);
      if (value) setUsage(value);
    }
    catch (reason) { setError(String(reason)); }
    finally { setBusy(false); setNow(Date.now()); setAttemptedAt(Date.now()); }
  }

  if (!provider) return null;
  const rotulo = PROVIDER_LABEL[provider] ?? provider.toUpperCase();
  const reason = error ?? usage?.reason;
  const checkedAt = usage?.observed_at_ms ?? attemptedAt;
  const checked = checkedAt ? `consultado ${timeAgo(checkedAt, now)}` : "sem consulta";
  // O `<...>` é marcador que a CLI fabrica ao ser interrompida, nunca nome de modelo.
  const modeloCru = runtime?.model?.startsWith("<") ? null : runtime?.model ?? null;
  const modelo = modeloCru ? nomeCurtoDoModelo(modeloCru) : null;
  const esforco = runtime?.effort ? rotuloDoEsforco(runtime.effort) : null;
  const title = [
    modeloCru && `Modelo: ${modeloCru}${esforco ? ` · ${esforco}` : ""}`,
    runtime?.cli_version && `CLI ${runtime.cli_version}`,
    resets("5 horas", usage?.primary ?? null),
    resets("Semana", usage?.secondary ?? null),
    checked,
    reason,
  ].filter(Boolean).join("\n");
  return (
    <span className="flex min-w-0 items-center gap-2 lg:gap-3 text-[11px] font-semibold text-text-primary" title={title || undefined} aria-label={`Uso do ${rotulo}`}>
      <AgentIcon provider={provider} size={12} className="shrink-0" />
      <span className="hidden md:inline text-accent">{rotulo}</span>
      {modelo && (
        <span className="hidden lg:inline max-w-40 truncate font-normal text-text-secondary">
          {modelo}{esforco ? ` · ${esforco}` : ""}
        </span>
      )}
      <Window label="5H" window={usage?.primary ?? null} />
      <Window label="SEMANA" window={usage?.secondary ?? null} />
      <span className="hidden lg:inline whitespace-nowrap text-text-secondary font-normal">{checked}</span>
      {reason && <span className="text-warning">!</span>}
      <button
        type="button"
        aria-label={`Consultar uso do ${rotulo}`}
        title="Consultar /usage"
        disabled={busy || !engineOnline || !profileId}
        onClick={() => void refresh()}
        className="shrink-0 text-text-secondary hover:text-accent disabled:opacity-50"
      >
        <ReloadIcon aria-hidden="true" className={`w-3.5 h-3.5${busy ? " animate-spin" : ""}`} />
      </button>
    </span>
  );
}
