import { useCallback, useEffect, useState } from "react";
import { Button, Input } from "../../components/ui";
import {
  MULTI_ACCOUNT_PROVIDERS,
  connectAgentCli,
  createProfile,
  deleteProfile,
  listAgentClis,
  listProfiles,
  type AgentCliId,
  type AgentCliStatus,
  type Profile,
} from "./terminalService";

const DESCRIPTIONS: Record<AgentCliId, string> = {
  cursor: "Cursor Agent CLI",
  gemini: "Gemini CLI · Google, API key ou Vertex AI",
  claude: "Claude Code · Claude ou Anthropic Console",
  codex: "OpenAI Codex CLI",
};

type Connection = "connected" | "installed" | "missing";

function connectionOf(agent: AgentCliStatus): Connection {
  if (!agent.available) return "missing";
  return agent.authenticated ? "connected" : "installed";
}

const DOT: Record<Connection, string> = {
  connected: "bg-success",
  installed: "bg-warning",
  missing: "bg-text-muted",
};

const ACTION: Record<Connection, string> = {
  connected: "Reautenticar",
  installed: "Entrar",
  missing: "Não instalado",
};

export function AgentConnections() {
  const [agents, setAgents] = useState<AgentCliStatus[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState<AgentCliId | null>(null);
  const [newName, setNewName] = useState("");

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [statuses, accounts] = await Promise.all([listAgentClis(), listProfiles()]);
      setAgents(statuses);
      setProfiles(accounts);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  /** Toda ação daqui muda estado em disco (login, config dir), então relê tudo depois. */
  async function run(key: string, action: () => Promise<unknown>) {
    setBusy(key);
    setError(null);
    try {
      await action();
      await refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(null);
    }
  }

  async function addAccount(provider: AgentCliId) {
    const name = newName.trim();
    if (!name) return;
    setAdding(null);
    setNewName("");
    await run("new-" + provider, async () => {
      const profile = await createProfile(provider, name);
      // Conta nova nasce sem credencial; abrir o login na sequência é o passo seguinte óbvio.
      await connectAgentCli(provider, profile.id);
    });
  }

  return (
    <section className="glass rounded-none p-5 space-y-4">
      <div>
        <h2 className="pixel-text text-text-primary text-sm">Conexões de agentes</h2>
        <p className="mt-1 text-[11px] text-text-muted">
          O login acontece diretamente no provider. O OMNI não lê nem armazena credenciais — só o
          nome da conta e a pasta de configuração dela.
        </p>
      </div>

      <div className="divide-y divide-border-subtle border-y border-border-subtle">
        {agents.map((agent) => {
          const connection = connectionOf(agent);
          const accounts = profiles.filter((profile) => profile.provider === agent.id);
          const multiAccount = MULTI_ACCOUNT_PROVIDERS.includes(agent.id);

          return (
            <div key={agent.id} className="py-3">
              <div className="flex items-center gap-4">
                <span className={`h-2 w-2 shrink-0 ${DOT[connection]}`} />
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-medium text-text-primary">
                    {agent.label}
                    {connection === "connected" && <span className="ml-2 text-[10px] text-success">conectado</span>}
                    {connection === "installed" && <span className="ml-2 text-[10px] text-warning">sem login</span>}
                  </p>
                  <p className="truncate text-[10px] text-text-muted" title={agent.path ?? undefined}>
                    {connection === "missing"
                      ? "CLI não encontrada no PATH"
                      : `${DESCRIPTIONS[agent.id]} · ${agent.path ?? agent.command}`}
                  </p>
                </div>
                {multiAccount ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={connection === "missing" || busy !== null}
                    onClick={() => { setAdding(adding === agent.id ? null : agent.id); setNewName(""); }}
                  >
                    + Conta
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    variant={connection === "installed" ? "primary" : "ghost"}
                    disabled={connection === "missing" || busy !== null}
                    onClick={() => void run(agent.id, () => connectAgentCli(agent.id))}
                  >
                    {busy === agent.id ? "Abrindo…" : ACTION[connection]}
                  </Button>
                )}
              </div>

              {adding === agent.id && (
                <div className="mt-3 flex gap-2 pl-6">
                  <Input
                    autoFocus
                    value={newName}
                    placeholder="Nome da conta (ex.: Trabalho)"
                    onChange={(event) => setNewName(event.target.value)}
                    onKeyDown={(event) => { if (event.key === "Enter") void addAccount(agent.id); }}
                  />
                  <Button size="sm" disabled={!newName.trim()} onClick={() => void addAccount(agent.id)}>
                    Criar e entrar
                  </Button>
                </div>
              )}

              {multiAccount && connection !== "missing" && accounts.length > 0 && (
                <ul className="mt-2 space-y-1 pl-6">
                  {accounts.map((profile) => (
                    <li key={profile.id} className="flex items-center gap-3">
                      <span
                        className={`h-1.5 w-1.5 shrink-0 ${profile.authenticated ? "bg-success" : "bg-text-muted"}`}
                      />
                      <span
                        className="min-w-0 flex-1 truncate text-[11px] text-text-secondary"
                        title={profile.config_dir}
                      >
                        {profile.name}
                        <span className="ml-2 text-[10px] text-text-muted">
                          {profile.authenticated ? "conectado" : "sem login"}
                        </span>
                      </span>
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={busy !== null}
                        onClick={() => void run(profile.id, () => connectAgentCli(agent.id, profile.id))}
                      >
                        {busy === profile.id ? "Abrindo…" : profile.authenticated ? "Reautenticar" : "Entrar"}
                      </Button>
                      {!profile.builtin && (
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={busy !== null}
                          title="Remove a conta e apaga a pasta de configuração dela"
                          onClick={() => void run("del-" + profile.id, () => deleteProfile(profile.id))}
                        >
                          Remover
                        </Button>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          );
        })}
        {!loading && agents.length === 0 && (
          <p className="py-4 text-xs text-text-muted">Não foi possível consultar as CLIs instaladas.</p>
        )}
      </div>

      {error && <p role="alert" className="text-xs text-danger">{error}</p>}
      <Button size="sm" variant="ghost" disabled={loading} onClick={() => void refresh()}>
        {loading ? "Verificando…" : "Verificar novamente"}
      </Button>
    </section>
  );
}
