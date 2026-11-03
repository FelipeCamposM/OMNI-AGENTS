import { useEffect, useRef, useState } from "react";
import { AgentIcon } from "../components/ui/AgentIcon";
import { Button } from "../components/ui/Button";
import { Input } from "../components/ui/Input";
import { Select } from "../components/ui/Select";
import { ChatIcon, CloseIcon } from "../components/ui/PixelIcon";
import { actionKey, ApiError, request, type Conversation, type Projects } from "../mobile/api";
import { IconeDoProjeto } from "../mobile/IconeDoProjeto";

const CHAVE_AGENTE = "omni-web-ultimo-agente";
/** O PC leva alguns segundos para subir a CLI e registrar a conversa. */
const ESPERA_MS = 20_000;

function lerAgente(): string {
  try { return localStorage.getItem(CHAVE_AGENTE) ?? ""; } catch { return ""; }
}

/**
 * Nova conversa em poucos cliques: projeto, agente (e conta, se houver mais de uma) e Abrir. A
 * conversa nova abre no centro assim que o PC a registra. Abre pelo botão do topo, pelo "+" de um
 * projeto ou pela tecla N.
 */
export function NovaConversa({ catalog, projetoInicial, onFechar, onAberta }: {
  catalog: Projects;
  projetoInicial: string | null;
  onFechar: () => void;
  /** Chamada com a conversa nova já na lista (ou `null` se o PC demorou: ela aparece sozinha depois). */
  onAberta: (id: string | null) => void;
}) {
  const agentes = catalog.agents;
  const [projeto, setProjeto] = useState(projetoInicial ?? catalog.projects[0]?.id ?? "");
  const [provider, setProvider] = useState(() => {
    const ultimo = lerAgente();
    return agentes.some((a) => a.id === ultimo) ? ultimo : agentes[0]?.id ?? "";
  });
  const [conta, setConta] = useState("");
  const [nome, setNome] = useState("");
  const [abrindo, setAbrindo] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const chave = useRef<string | null>(null);
  const caixa = useRef<HTMLDivElement>(null);
  const contas = catalog.profiles.filter((p) => p.provider === provider);

  useEffect(() => {
    const tecla = (evento: KeyboardEvent) => { if (evento.key === "Escape" && !abrindo) onFechar(); };
    window.addEventListener("keydown", tecla);
    caixa.current?.querySelector<HTMLElement>("[aria-pressed='true']")?.focus();
    return () => window.removeEventListener("keydown", tecla);
  }, [abrindo, onFechar]);

  async function abrir() {
    if (!projeto || !provider || abrindo) return;
    // A chave sobrevive ao retry: um timeout tem resultado desconhecido, e sem isso um segundo
    // clique abriria uma PTY a mais no PC.
    chave.current ??= actionKey();
    setAbrindo(true); setErro(null);
    try { localStorage.setItem(CHAVE_AGENTE, provider); } catch { /* sem armazenamento, segue */ }
    try {
      const antes = new Set((await request<Conversation[]>("/conversas")).map((c) => c.id));
      await request("/sessoes", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": chave.current },
        body: JSON.stringify({ project_id: projeto, provider, profile_id: conta || null, titulo: nome.trim() || null }),
      });
      chave.current = null;
      // O spawn entra na fila e não devolve o id: espera a conversa nova aparecer na lista.
      const limite = Date.now() + ESPERA_MS;
      let nova: Conversation | undefined;
      while (!nova && Date.now() < limite) {
        await new Promise((r) => setTimeout(r, 700));
        nova = (await request<Conversation[]>("/conversas"))
          .find((c) => !antes.has(c.id) && c.live && c.project_id === projeto && c.provider === provider);
      }
      onAberta(nova?.id ?? null);
    } catch (motivo) {
      if (motivo instanceof ApiError && motivo.status >= 400 && motivo.status < 500) chave.current = null;
      setErro(motivo instanceof Error ? motivo.message : String(motivo));
      setAbrindo(false);
    }
  }

  return (
    <div className="w-modal-fundo" onPointerDown={(evento) => { if (evento.target === evento.currentTarget && !abrindo) onFechar(); }}>
      <div ref={caixa} className="w-modal glass glass-strong" role="dialog" aria-modal="true" aria-labelledby="nova-conversa-titulo">
        <header className="w-modal-cabeca">
          <span className="w-modal-icone"><ChatIcon aria-hidden className="h-4 w-4" /></span>
          <h2 id="nova-conversa-titulo" className="w-modal-titulo">Nova conversa</h2>
          <span className="w-topo-espaco" />
          <button type="button" className="w-modal-fechar" aria-label="Fechar" disabled={abrindo} onClick={onFechar}>
            <CloseIcon aria-hidden className="h-3.5 w-3.5" />
          </button>
        </header>
        <form className="w-modal-corpo" onSubmit={(evento) => { evento.preventDefault(); void abrir(); }}>
          <label className="m-rotulo" htmlFor="nova-projeto">Projeto</label>
          <Select id="nova-projeto" aria-label="Projeto" value={projeto} onChange={setProjeto} searchable={catalog.projects.length > 6}
            searchPlaceholder="Buscar projeto…"
            options={catalog.projects.map((p) => ({ value: p.id, label: p.name, hint: p.path,
              icon: <span className="w-historico-icone"><IconeDoProjeto projeto={p} className="h-3 w-3" /></span> }))} />

          <span className="m-rotulo" id="nova-agente">Agente</span>
          <div className="w-agentes" role="group" aria-labelledby="nova-agente">
            {agentes.map((a) => (
              <button key={a.id} type="button" aria-pressed={a.id === provider} className={`w-agente${a.id === provider ? " is-ativo" : ""}`}
                onClick={() => { setProvider(a.id); setConta(""); }} onDoubleClick={() => void abrir()}>
                <AgentIcon provider={a.id} size={22} />
                <span>{a.label}</span>
              </button>
            ))}
          </div>

          {contas.length > 1 && <>
            <span className="m-rotulo" id="nova-conta">Conta</span>
            <div className="w-contas" role="group" aria-labelledby="nova-conta">
              {[{ id: "", name: "Automática" }, ...contas].map((p) => (
                <button key={p.id} type="button" aria-pressed={p.id === conta} className={`w-conta${p.id === conta ? " is-ativo" : ""}`}
                  onClick={() => setConta(p.id)} title={p.id ? undefined : "A conta que o PC usa por padrão para este agente"}>{p.name}</button>
              ))}
            </div>
          </>}

          <label className="m-rotulo" htmlFor="nova-nome">Nome <span className="w-opcional">(opcional)</span></label>
          <Input id="nova-nome" size="sm" value={nome} maxLength={120} placeholder="Ex.: Corrigir o login" onChange={(evento) => setNome(evento.target.value)} />

          {erro && <p role="alert" className="m-alerta">{erro}</p>}
          <div className="w-modal-acoes">
            <span className="w-modal-dica">Enter abre · Esc fecha</span>
            <Button type="button" variant="ghost" disabled={abrindo} onClick={onFechar}>Cancelar</Button>
            <Button type="submit" variant="primary" disabled={abrindo || !projeto || !provider}>
              {abrindo ? "Abrindo no PC…" : "Abrir conversa"}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
