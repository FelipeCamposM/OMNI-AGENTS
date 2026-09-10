import { useEffect, useMemo, useState } from "react";
import { Button, Select } from "../../components/ui";
import {
  AGENT_RESUME_FLAG,
  listAgentClis,
  listProfiles,
  type AgentCliId,
  type AgentCliStatus,
  type AgentLaunch,
  type Profile,
} from "./terminalService";

interface AgentLauncherProps {
  projectName: string;
  onLaunch: (launch: AgentLaunch) => void;
}

const FALLBACK_AGENTS: AgentCliStatus[] = [
  { id: "claude", label: "Claude", command: "claude", path: null, available: false, authenticated: false },
  { id: "codex", label: "Codex", command: "codex", path: null, available: false, authenticated: false },
  { id: "gemini", label: "Gemini", command: "gemini", path: null, available: false, authenticated: false },
  { id: "cursor", label: "Cursor", command: "cursor-agent", path: null, available: false, authenticated: false },
];

export function AgentLauncher({ projectName, onLaunch }: AgentLauncherProps) {
  const [agents, setAgents] = useState(FALLBACK_AGENTS);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [selected, setSelected] = useState<AgentCliId>(FALLBACK_AGENTS[0].id);
  const [selectedProfile, setSelectedProfile] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void Promise.all([listAgentClis(), listProfiles()])
      .then(([statuses, accounts]) => {
        if (cancelled) return;
        setProfiles(accounts);
        if (statuses.length === 0) return;
        setAgents(statuses);
        const firstAvailable = statuses.find((item) => item.available);
        if (firstAvailable) setSelected(firstAvailable.id);
      })
      // Engolir esta falha em silêncio deixava os quatro providers em `available: false` sem
      // nenhum sinal — metade do sintoma de "nenhum agente aparece conectado".
      .catch((reason) => {
        if (!cancelled) setError(reason instanceof Error ? reason.message : String(reason));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, []);

  const agent = agents.find((item) => item.id === selected) ?? agents[0];

  const accounts = useMemo(
    () => profiles.filter((profile) => profile.provider === selected),
    [profiles, selected]
  );

  // Prefere uma conta já autenticada: abrir no perfil sem login só porque veio primeiro na lista
  // joga o usuário numa tela de autenticação que ele não pediu.
  useEffect(() => {
    const preferred = accounts.find((item) => item.authenticated) ?? accounts[0];
    setSelectedProfile(preferred?.id ?? "");
  }, [accounts]);

  const profile = accounts.find((item) => item.id === selectedProfile) ?? null;

  const profileOptions = accounts.map((item) => ({
    value: item.id,
    label: item.name,
    hint: item.authenticated ? "conectado" : "sem login",
  }));

  function launch(command?: string) {
    if (!agent) return;
    onLaunch({ agent: command ? { ...agent, command } : agent, profile });
  }

  const options = agents.map((item) => ({
    value: item.id,
    label: item.label,
    hint: !item.available
      ? `${item.command} · não encontrado`
      : item.authenticated
        ? `${item.command} · conectado`
        : `${item.command} · instalado, sem login`,
    disabled: !item.available,
  }));

  return (
    <div className="grid h-full place-items-center bg-bg-surface p-6">
      <section className="w-full max-w-md border-2 border-border-subtle bg-bg-elevated p-5 shadow-2xl">
        <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-accent">Novo agente</p>
        <h2 className="mt-2 text-lg font-semibold text-text-primary">Escolha a CLI para {projectName}</h2>
        <p className="mt-1 text-xs leading-5 text-text-muted">
          O agente será iniciado no diretório do projeto e continuará ativo mesmo se esta janela fechar.
        </p>
        <div className="mt-5">
          <label htmlFor="agent-cli" className="mb-2 block font-mono text-[10px] uppercase text-text-secondary">
            CLI do agente
          </label>
          <Select id="agent-cli" value={selected} options={options} onChange={setSelected} disabled={loading} />
        </div>
        {profileOptions.length > 1 && (
          <div className="mt-4">
            <label htmlFor="agent-profile" className="mb-2 block font-mono text-[10px] uppercase text-text-secondary">
              Conta
            </label>
            <Select
              id="agent-profile"
              value={selectedProfile}
              options={profileOptions}
              onChange={setSelectedProfile}
              disabled={loading}
            />
          </div>
        )}
        {profile && !profile.authenticated && (
          <p className="mt-3 border-l-2 border-warning pl-3 text-xs text-warning">
            A conta “{profile.name}” ainda não tem login. O CLI vai pedir autenticação ao abrir.
          </p>
        )}
        {error && (
          <p role="alert" className="mt-3 border-l-2 border-danger pl-3 text-xs text-danger">
            Falha ao consultar as CLIs instaladas: {error}
          </p>
        )}
        {!loading && !error && !agents.some((item) => item.available) && (
          <p role="alert" className="mt-3 border-l-2 border-warning pl-3 text-xs text-warning">
            Nenhuma CLI compatível foi encontrada no PATH. Instale uma delas e reinicie o OMNI Agents.
          </p>
        )}
        <div className="mt-5 flex gap-2">
          <Button className="flex-1" disabled={loading || !agent?.available} onClick={() => launch()}>
            {loading ? "Detectando CLIs…" : `Abrir ${agent?.label ?? "agente"}`}
          </Button>
          {agent && AGENT_RESUME_FLAG[agent.id] && (
            <Button
              variant="ghost"
              className="flex-1"
              disabled={loading || !agent.available}
              title="Continua a última conversa deste projeto, já com as mensagens anteriores"
              onClick={() => launch(`${agent.command} ${AGENT_RESUME_FLAG[agent.id]}`)}
            >
              Retomar conversa
            </Button>
          )}
        </div>
      </section>
    </div>
  );
}
