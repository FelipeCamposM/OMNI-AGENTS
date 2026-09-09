import { useCallback, useEffect, useState } from "react";
import { Button } from "../../components/ui";
import { connectAgentCli, listAgentClis, type AgentCliId, type AgentCliStatus } from "./terminalService";

const DESCRIPTIONS: Record<AgentCliId, string> = {
  cursor: "Cursor Agent CLI",
  gemini: "Gemini CLI · Google, API key ou Vertex AI",
  claude: "Claude Code · Claude ou Anthropic Console",
  codex: "OpenAI Codex CLI",
};

export function AgentConnections() {
  const [agents, setAgents] = useState<AgentCliStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [connecting, setConnecting] = useState<AgentCliId | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setAgents(await listAgentClis());
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  async function connect(id: AgentCliId) {
    setConnecting(id);
    setError(null);
    try {
      await connectAgentCli(id);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setConnecting(null);
    }
  }

  return (
    <section className="glass rounded-none p-5 space-y-4">
      <div>
        <h2 className="pixel-text text-text-primary text-sm">Conexões de agentes</h2>
        <p className="mt-1 text-[11px] text-text-muted">
          O login acontece diretamente no provider. O OMNI não lê nem armazena credenciais.
        </p>
      </div>
      <div className="divide-y divide-border-subtle border-y border-border-subtle">
        {agents.map((agent) => (
          <div key={agent.id} className="flex items-center gap-4 py-3">
            <span className={`h-2 w-2 shrink-0 ${agent.available ? "bg-success" : "bg-text-muted"}`} />
            <div className="min-w-0 flex-1">
              <p className="text-xs font-medium text-text-primary">{agent.label}</p>
              <p className="truncate text-[10px] text-text-muted">
                {agent.available ? `${DESCRIPTIONS[agent.id]} · ${agent.command}` : "CLI não encontrada no PATH"}
              </p>
            </div>
            <Button
              size="sm"
              variant={agent.available ? "primary" : "ghost"}
              disabled={!agent.available || connecting !== null}
              onClick={() => void connect(agent.id)}
            >
              {connecting === agent.id ? "Abrindo…" : agent.available ? "Conectar" : "Não instalado"}
            </Button>
          </div>
        ))}
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
