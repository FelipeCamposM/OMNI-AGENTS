import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Button, Card, Input } from "../../components/ui";
import { AgentIcon } from "../../components/ui/AgentIcon";
import { ChartIcon, CheckIcon, ClockIcon, GlobeIcon, KeyIcon, ReloadIcon, RobotIcon, StarFilledIcon, StarIcon, TrashIcon, WarningIcon } from "../../components/ui/PixelIcon";
import { Titulo } from "../relatorios/RelatoriosIa";
import { InstalarFerramenta } from "./InstalarFerramenta";
import { AccountUsage, type Usage, type UsageWindow } from "./AccountUsage";
import {
  MULTI_ACCOUNT_PROVIDERS,
  connectAgentCli,
  contasMestras,
  createProfile,
  definirMestra,
  deleteProfile,
  listAgentClis,
  listProfiles,
  type AgentCliId,
  type AgentCliStatus,
  type Profile,
} from "./terminalService";
import "./agentes.css";

const DESCRIPTIONS: Record<AgentCliId, string> = {
  cursor: "Cursor Agent CLI",
  claude: "Claude Code · Claude ou Anthropic Console",
  codex: "OpenAI Codex CLI",
  antigravity: "Google Antigravity CLI (agy) · só a conta do computador",
};

type Connection = "connected" | "installed" | "missing";

function connectionOf(agent: AgentCliStatus): Connection {
  if (!agent.available) return "missing";
  return agent.authenticated ? "connected" : "installed";
}

const SELO: Record<Connection, string> = { connected: "conectado", installed: "sem login", missing: "não instalado" };
const ACTION: Record<Connection, string> = { connected: "Reautenticar", installed: "Entrar", missing: "Não instalado" };

type Janela = { rotulo: string; w: UsageWindow };
type Medida = { p: Profile; janelas: Janela[]; pico: Janela };

function medir(p: Profile, u: Usage | null | undefined): Medida | null {
  if (!p.authenticated || !u) return null;
  const janelas = [{ rotulo: "5 horas", w: u.primary }, { rotulo: "semana", w: u.secondary }]
    .filter((j): j is Janela => j.w !== null);
  if (!janelas.length) return null;
  return { p, janelas, pico: janelas.reduce((a, j) => (j.w.used_percent > a.w.used_percent ? j : a)) };
}

/** "2h 05min", "3d 4h": quanto falta até `ms`. */
function daqui(ms: number) {
  const min = Math.max(1, Math.round((ms - Date.now()) / 60000));
  const d = Math.floor(min / 1440), h = Math.floor((min % 1440) / 60), m = min % 60;
  return d ? `${d}d ${h}h` : h ? `${h}h ${String(m).padStart(2, "0")}min` : `${m}min`;
}

const tomDe = (pct: number) => (pct >= 90 ? "danger" : pct >= 70 ? "warning" : "success");

function AgKpi({ tom, icone: Icone, rotulo, valor, sub, barra, children }: {
  tom: string; icone: typeof RobotIcon; rotulo: string; valor: string; sub: string; barra?: number; children?: ReactNode;
}) {
  return (
    <div className="ag-kpi" data-tom={tom}>
      <span className="ag-kpi-topo">{rotulo}<span className="ag-kpi-icone"><Icone className="h-3.5 w-3.5" aria-hidden /></span></span>
      <strong className="ag-kpi-valor">{valor}</strong>
      {barra !== undefined && <span className="ag-kpi-barra" aria-hidden><span style={{ width: `${Math.min(100, Math.max(0, barra))}%` }} /></span>}
      {children}
      <span className="ag-kpi-sub" title={sub}>{sub}</span>
    </div>
  );
}

/**
 * Configurações → Agentes: um cartão por CLI com as contas dela. Em quem tem várias contas (Claude,
 * Codex), a estrela marca a mestra das conversas — o arquivo mora nela e as outras contas usam o
 * mesmo (`omni_core::mestra`).
 */
export function AgentConnections() {
  const [agents, setAgents] = useState<AgentCliStatus[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [mestras, setMestras] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState<AgentCliId | null>(null);
  const [newName, setNewName] = useState("");
  const [removendo, setRemovendo] = useState<string | null>(null);
  const [usos, setUsos] = useState<Record<string, Usage | null>>({});
  const guardarUso = useCallback((id: string, uso: Usage | null) => setUsos((m) => (m[id] === uso ? m : { ...m, [id]: uso })), []);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [statuses, accounts] = await Promise.all([listAgentClis(), listProfiles()]);
      setAgents(statuses);
      setProfiles(accounts);
      // Sem o Tauri (ou numa versão sem o comando) a tela segue sem estrela.
      setMestras(await contasMestras().catch(() => ({})));
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

  const prontos = agents.filter((a) => connectionOf(a) === "connected");
  const faltam = agents.filter((a) => connectionOf(a) !== "connected").map((a) => a.label);
  const nomeConta = (p: Profile) => `${agents.find((a) => a.id === p.provider)?.label ?? p.provider} · ${p.name}`;
  const medidas = profiles.map((p) => medir(p, usos[p.id])).filter((m): m is Medida => m !== null);
  const folga = medidas.reduce<Medida | null>((a, m) => (!a || m.pico.w.used_percent < a.pico.w.used_percent ? m : a), null);
  const aperto = medidas.reduce<Medida | null>((a, m) => (!a || m.pico.w.used_percent > a.pico.w.used_percent ? m : a), null);
  const reset = medidas
    .flatMap((m) => m.janelas.map((j) => ({ m, j, em: (j.w.resets_at ?? 0) * 1000 })))
    .filter((r) => r.em > Date.now())
    .sort((a, b) => a.em - b.em)[0];
  const semUso = "consulte o uso nas contas abaixo";

  return (
    <>
      <Card title={<Titulo icone={RobotIcon}>Contas dos agentes</Titulo>} className="settings-largo"
        aside={
          <Button size="sm" variant="ghost" disabled={loading} onClick={() => void refresh()}>
            <ReloadIcon aria-hidden className={`h-3.5 w-3.5${loading ? " anexo-girando" : ""}`} />
            {loading ? "Verificando…" : "Verificar novamente"}
          </Button>
        }>
        <p className="text-[11px] text-text-muted">
          O login acontece diretamente no provider. O OMNI não lê nem armazena credenciais — só o nome da conta e a pasta de
          configuração dela.
        </p>
        {agents.length > 0 && (
          <div className="ag-kpis">
            <AgKpi tom="accent" icone={RobotIcon} rotulo="Agentes prontos" valor={`${prontos.length}/${agents.length}`}
              sub={faltam.length ? `falta: ${faltam.join(", ")}` : "todos instalados e com login"}>
              <span className="ag-kpi-logos">
                {agents.map((a) => (
                  <span key={a.id} className="ag-kpi-logo" data-estado={connectionOf(a)} title={`${a.label}: ${SELO[connectionOf(a)]}`}>
                    <AgentIcon provider={a.id} size={14} />
                  </span>
                ))}
              </span>
            </AgKpi>
            <AgKpi tom="success" icone={CheckIcon} rotulo="Mais folga agora"
              valor={folga ? `${Math.round(100 - folga.pico.w.used_percent)}% livre` : "—"} barra={folga ? 100 - folga.pico.w.used_percent : undefined}
              sub={folga ? `${nomeConta(folga.p)} · boa para a próxima tarefa` : semUso} />
            <AgKpi tom={aperto ? tomDe(aperto.pico.w.used_percent) : "accent"} icone={ChartIcon} rotulo="Mais perto do limite"
              valor={aperto ? `${Math.round(aperto.pico.w.used_percent)}%` : "—"} barra={aperto?.pico.w.used_percent}
              sub={aperto ? `${nomeConta(aperto.p)} · ${aperto.pico.rotulo}${aperto.pico.w.resets_at ? ` · libera em ${daqui(aperto.pico.w.resets_at * 1000)}` : ""}` : semUso} />
            <AgKpi tom="accent" icone={ClockIcon} rotulo="Próximo reset" valor={reset ? daqui(reset.em) : "—"}
              sub={reset ? `${nomeConta(reset.m.p)} · ${reset.j.rotulo}` : semUso} />
          </div>
        )}
        {error && <p role="alert" className="border-l-2 border-danger pl-3 text-xs text-danger">{error}</p>}
        {!loading && agents.length === 0 && !error && (
          <p className="text-xs text-text-muted">Não foi possível consultar as CLIs instaladas.</p>
        )}
      </Card>

      {/* Colunas (não grade): cartão alto do Claude ao lado dos outros empilhados, sem buraco. */}
      <div className="settings-largo ag-colunas">
      {agents.map((agent) => {
        const connection = connectionOf(agent);
        const accounts = profiles.filter((profile) => profile.provider === agent.id);
        const multiAccount = MULTI_ACCOUNT_PROVIDERS.includes(agent.id);

        return (
          <section key={agent.id} className="glass rounded-none ag-cartao" data-estado={connection} aria-label={agent.label}>
            <header className="ag-topo">
              <span className="ag-logo" aria-hidden><AgentIcon provider={agent.id} size={18} /></span>
              <span className="min-w-0 flex-1">
                <span className="ag-nome">
                  {agent.label}
                  <span className="ag-selo" data-estado={connection}>{SELO[connection]}</span>
                </span>
                <span className="ag-caminho" title={agent.path ?? undefined}>
                  {connection === "missing" ? "CLI não encontrada no PATH" : `${DESCRIPTIONS[agent.id]} · ${agent.path ?? agent.command}`}
                </span>
              </span>
              {multiAccount ? (
                <button type="button" className="ag-acao" disabled={connection === "missing" || busy !== null}
                  onClick={() => { setAdding(adding === agent.id ? null : agent.id); setNewName(""); }}>
                  + Conta
                </button>
              ) : (
                <button type="button" className="ag-acao" data-forte={connection === "installed" || undefined} disabled={connection === "missing" || busy !== null}
                  onClick={() => void run(agent.id, () => connectAgentCli(agent.id))}>
                  <KeyIcon className="h-3 w-3" aria-hidden />{busy === agent.id ? "Abrindo…" : ACTION[connection]}
                </button>
              )}
            </header>

            {connection === "missing" && (
              <InstalarFerramenta id={agent.id} nome={agent.label} motivo={`O OMNI não encontrou a CLI do ${agent.label} neste computador.`} />
            )}

            {adding === agent.id && (
              <div className="ag-nova">
                <Input autoFocus value={newName} placeholder="Nome da conta (ex.: Trabalho)"
                  onChange={(event) => setNewName(event.target.value)}
                  onKeyDown={(event) => { if (event.key === "Enter") void addAccount(agent.id); if (event.key === "Escape") setAdding(null); }} />
                <Button size="sm" disabled={!newName.trim()} onClick={() => void addAccount(agent.id)}>Criar e entrar</Button>
              </div>
            )}

            {connection !== "missing" && accounts.length > 0 && (
              <ul className="ag-contas">
                {accounts.map((profile) => {
                  const mestra = multiAccount && accounts.length > 1 && mestras[agent.id] === profile.id;
                  return (
                    <li key={profile.id} className="ag-conta" data-mestra={mestra || undefined}>
                      <div className="ag-conta-linha">
                        <span className="ag-ponto" data-ok={profile.authenticated || undefined} aria-hidden />
                        <span className="ag-conta-nome" title={profile.config_dir}>
                          {profile.name}
                          {mestra && <span className="ag-mestra-rotulo">mestra</span>}
                        </span>
                        {multiAccount && accounts.length > 1 && (
                          <button type="button" className="ag-estrela" aria-pressed={mestra}
                            aria-label={mestra ? `${profile.name} é a mestra das conversas` : `Tornar ${profile.name} a mestra das conversas`}
                            title={mestra ? "Mestra das conversas: o arquivo de cada conversa mora nesta conta" : "Tornar a mestra das conversas"}
                            disabled={mestra || busy !== null}
                            onClick={() => void run("mestra-" + profile.id, () => definirMestra(profile.id))}>
                            {mestra ? <StarFilledIcon className="h-3.5 w-3.5" aria-hidden /> : <StarIcon className="h-3.5 w-3.5" aria-hidden />}
                          </button>
                        )}
                        {multiAccount && (
                          <button type="button" className="ag-acao" data-forte={!profile.authenticated || undefined} disabled={busy !== null}
                            onClick={() => void run(profile.id, () => connectAgentCli(agent.id, profile.id))}>
                            <KeyIcon className="h-3 w-3" aria-hidden />
                            {busy === profile.id ? "Abrindo…" : profile.authenticated ? "Reautenticar" : "Entrar"}
                          </button>
                        )}
                        {!profile.builtin && removendo !== profile.id && (
                          <button type="button" className="ag-remover" aria-label="Remover" title="Remove a conta e apaga a pasta de configuração dela"
                            disabled={busy !== null} onClick={() => setRemovendo(profile.id)}>
                            <TrashIcon className="h-3.5 w-3.5" aria-hidden />
                          </button>
                        )}
                      </div>
                      <span className="ag-conta-sub">
                        {profile.email && <span className="ag-conta-email" title={profile.email}>{profile.email}</span>}
                        <span className="shrink-0">{profile.authenticated ? "conectado" : "sem login"}</span>
                      </span>
                      {removendo === profile.id && (
                        <div className="ag-confirmar" role="group" aria-label={`Remover ${profile.name}`}>
                          <WarningIcon className="h-3.5 w-3.5 shrink-0" aria-hidden />
                          <span className="flex-1">Remover {profile.name}? A pasta de configuração da conta (e o login dela) é apagada.</span>
                          <Button size="sm" variant="danger" disabled={busy !== null}
                            onClick={() => { setRemovendo(null); void run("del-" + profile.id, () => deleteProfile(profile.id)); }}>
                            Remover conta
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => setRemovendo(null)}>Cancelar</Button>
                        </div>
                      )}
                      <AccountUsage profileId={profile.id} provider={profile.provider} onUsage={(uso) => guardarUso(profile.id, uso)} />
                    </li>
                  );
                })}
              </ul>
            )}
            {multiAccount && accounts.length > 1 && connection !== "missing" && (
              <p className="ag-nota">
                <StarFilledIcon className="h-3 w-3 text-warning" aria-hidden />
                A mestra guarda as conversas desta IA. Ao trocar de conta a conversa não é copiada: a outra conta usa o mesmo
                arquivo. Cópias antigas se juntam em Armazenamento.
              </p>
            )}
          </section>
        );
      })}
      </div>

      <Card title={<Titulo icone={GlobeIcon}>Acesso pelo celular</Titulo>} className="settings-largo">
        <p className="text-[11px] text-text-muted">
          Para responder aos agentes do telefone, o PC e o celular precisam do Tailscale, na mesma conta. Ele liga os dois
          direto, sem expor nada na internet.
        </p>
        <InstalarFerramenta id="tailscale" nome="Tailscale" motivo="Instale nos dois aparelhos e entre com a mesma conta." />
      </Card>
    </>
  );
}
