import { useEffect, useState } from "react";
import { Button } from "../../components/ui";
import {
  listAgentClis,
  listProfiles,
  planSwitch,
  type AgentCliId,
  type AgentCliStatus,
  type LaunchPlan,
  type Profile,
} from "./terminalService";

interface AgentSwitcherProps {
  conversationId: string;
  currentProvider: AgentCliId;
  currentProfileId: string | null;
  onCancel: () => void;
  onSwitch: (plan: LaunchPlan, agent: AgentCliStatus, profile: Profile | null) => void;
}

/** Troca a conta ou a IA de uma conversa em andamento, sem abrir chat novo.
 *
 *  Duas operações bem diferentes por trás dos dois botões: trocar de conta no mesmo provider é
 *  continuação de verdade (o transcript vai junto e a sessão é retomada pelo mesmo id); trocar de
 *  IA é handoff — o agente novo começa do zero lendo um briefing. A UI diz qual é qual. */
export function AgentSwitcher({
  conversationId,
  currentProvider,
  currentProfileId,
  onCancel,
  onSwitch,
}: AgentSwitcherProps) {
  const [agents, setAgents] = useState<AgentCliStatus[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void Promise.all([listAgentClis(), listProfiles()])
      .then(([statuses, accounts]) => {
        if (cancelled) return;
        setAgents(statuses);
        setProfiles(accounts);
      })
      .catch((reason) => {
        if (!cancelled) setError(reason instanceof Error ? reason.message : String(reason));
      });
    return () => { cancelled = true; };
  }, []);

  async function apply(provider: AgentCliId, profile: Profile | null, key: string) {
    const agent = agents.find((item) => item.id === provider);
    if (!agent) return;
    setBusy(key);
    setError(null);
    try {
      const plan = await planSwitch({
        conversationId,
        targetProvider: provider,
        targetProfileId: profile?.id,
        targetCommand: agent.command,
      });
      onSwitch(plan, agent, profile);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
      setBusy(null);
    }
  }

  const otherAccounts = profiles.filter(
    (profile) => profile.provider === currentProvider && profile.id !== currentProfileId
  );
  const otherProviders = agents.filter((agent) => agent.id !== currentProvider && agent.available);

  return (
    <div className="absolute inset-0 z-20 grid place-items-center bg-[#0e0e14]/90 p-6">
      <section className="w-full max-w-md border-2 border-border-subtle bg-bg-elevated p-5 shadow-2xl">
        <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-accent">Mesma conversa</p>
        <h2 className="mt-2 text-lg font-semibold text-text-primary">Continuar com outra conta ou IA</h2>

        <div className="mt-5">
          <p className="font-mono text-[10px] uppercase text-text-secondary">Trocar de conta</p>
          <p className="mt-1 text-[11px] text-text-muted">
            Mesma IA: a conversa vai junto e continua de onde parou.
          </p>
          {otherAccounts.length === 0 ? (
            <p className="mt-2 text-[11px] text-text-muted">
              Nenhuma outra conta cadastrada para este provider. Crie uma em Configurações → Agentes.
            </p>
          ) : (
            <ul className="mt-2 space-y-1">
              {otherAccounts.map((profile) => (
                <li key={profile.id} className="flex items-center gap-3">
                  <span
                    className={`h-1.5 w-1.5 shrink-0 ${profile.authenticated ? "bg-success" : "bg-text-muted"}`}
                  />
                  <span className="min-w-0 flex-1 truncate text-[11px] text-text-secondary">
                    {profile.name}
                    <span className="ml-2 text-[10px] text-text-muted">
                      {profile.authenticated ? "conectado" : "sem login"}
                    </span>
                  </span>
                  <Button
                    size="sm"
                    disabled={busy !== null}
                    onClick={() => void apply(currentProvider, profile, profile.id)}
                  >
                    {busy === profile.id ? "Trocando…" : "Continuar aqui"}
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="mt-5 border-t border-border-subtle pt-4">
          <p className="font-mono text-[10px] uppercase text-text-secondary">Trocar de IA</p>
          <p className="mt-1 text-[11px] text-warning">
            Recomeço com briefing, não continuação: não existe formato de conversa comum entre os
            CLIs. Cache de prompt, estado interno e aprovações não transferem.
          </p>
          <ul className="mt-2 space-y-1">
            {otherProviders.map((agent) => (
              <li key={agent.id} className="flex items-center gap-3">
                <span className="min-w-0 flex-1 truncate text-[11px] text-text-secondary">{agent.label}</span>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={busy !== null}
                  onClick={() => void apply(agent.id, null, agent.id)}
                >
                  {busy === agent.id ? "Preparando…" : "Passar o bastão"}
                </Button>
              </li>
            ))}
          </ul>
        </div>

        {error && <p role="alert" className="mt-3 text-xs text-danger">{error}</p>}

        <div className="mt-5 flex justify-end">
          <Button size="sm" variant="ghost" disabled={busy !== null} onClick={onCancel}>
            Cancelar
          </Button>
        </div>
      </section>
    </div>
  );
}
