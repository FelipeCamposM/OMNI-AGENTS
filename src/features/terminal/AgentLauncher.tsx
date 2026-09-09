import { useEffect, useState } from "react";
import { Button, Select } from "../../components/ui";
import { AGENT_RESUME_FLAG, listAgentClis, type AgentCliId, type AgentCliStatus } from "./terminalService";

interface AgentLauncherProps {
  projectName: string;
  onLaunch: (agent: AgentCliStatus) => void;
}

const FALLBACK_AGENTS: AgentCliStatus[] = [
  { id: "claude", label: "Claude", command: "claude", available: false },
  { id: "codex", label: "Codex", command: "codex", available: false },
  { id: "gemini", label: "Gemini", command: "gemini", available: false },
  { id: "cursor", label: "Cursor", command: "cursor-agent", available: false },
];

export function AgentLauncher({ projectName, onLaunch }: AgentLauncherProps) {
  const [agents, setAgents] = useState(FALLBACK_AGENTS);
  const [selected, setSelected] = useState<AgentCliId>(FALLBACK_AGENTS[0].id);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    void listAgentClis()
      .then((statuses) => {
        if (cancelled || statuses.length === 0) return;
        setAgents(statuses);
        const firstAvailable = statuses.find((item) => item.available);
        if (firstAvailable) setSelected(firstAvailable.id);
      })
      .catch(() => undefined)
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, []);

  const agent = agents.find((item) => item.id === selected) ?? agents[0];
  const options = agents.map((item) => ({
    value: item.id,
    label: item.label,
    hint: item.available ? `${item.command} · instalado` : `${item.command} · não encontrado`,
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
        {!loading && !agents.some((item) => item.available) && (
          <p role="alert" className="mt-3 border-l-2 border-warning pl-3 text-xs text-warning">
            Nenhuma CLI compatível foi encontrada no PATH. Instale uma delas e reinicie o OMNI Agents.
          </p>
        )}
        <div className="mt-5 flex gap-2">
          <Button className="flex-1" disabled={loading || !agent?.available} onClick={() => agent && onLaunch(agent)}>
            {loading ? "Detectando CLIs…" : `Abrir ${agent?.label ?? "agente"}`}
          </Button>
          {agent && AGENT_RESUME_FLAG[agent.id] && (
            <Button
              variant="ghost"
              className="flex-1"
              disabled={loading || !agent.available}
              title="Continua a última conversa deste projeto, já com as mensagens anteriores"
              onClick={() => onLaunch({ ...agent, command: `${agent.command} ${AGENT_RESUME_FLAG[agent.id]}` })}
            >
              Retomar conversa
            </Button>
          )}
        </div>
      </section>
    </div>
  );
}
