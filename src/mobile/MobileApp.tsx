import { useCallback, useRef, useState } from "react";
import { Button } from "../components/ui/Button";
import { request, actionKey, ApiError, type Conversation, type Projects, type Timeline } from "./api";
import { usePoll } from "./usePoll";

const STATES: Record<string,string> = { working: "Trabalhando", answered: "Resposta disponível", approval_required: "Possível aprovação pendente", stopped: "Encerrado", orphan: "Sessão anterior", crashed: "Interrompido" };

/** Quanto tempo faz que o desktop publicou. O celular mostra a idade e quem julga se a lista ainda
 *  vale é quem está lendo — nada expira sozinho. */
function idadeDaLista(publishedAtMs: number): string | null {
  if (!publishedAtMs) return "Lista montada a partir das conversas: o desktop ainda não publicou.";
  const minutos = Math.floor((Date.now() - publishedAtMs) / 60_000);
  if (minutos < 5) return null;
  if (minutos < 60) return `Lista publicada há ${minutos} min.`;
  return `Lista publicada há ${Math.floor(minutos / 60)} h.`;
}

function ProjectList({ projects, conversations, select }: {
  projects: Projects["projects"]; conversations: Conversation[]; select: (id: string) => void;
}) {
  if (projects.length === 0) return <p className="text-text-secondary">Nenhum projeto conhecido ainda.</p>;
  return <div>{projects.map(project => {
    const doProjeto = conversations.filter(c => c.project_id === project.id);
    const aguardando = doProjeto.filter(c => c.capabilities?.approve).length;
    return <article key={project.id} className="mobile-card">
      <h2 className="font-semibold">{project.name}</h2>
      <p className="text-sm text-text-secondary break-all">{project.path}</p>
      <p className="text-sm text-text-secondary">{doProjeto.length} conversa(s){aguardando > 0 ? ` · ${aguardando} aguardando aprovação` : ""}</p>
      <Button className="mt-3" onClick={() => select(project.id)}>Abrir projeto</Button>
    </article>;
  })}</div>;
}

function NovaSessao({ project, catalog, onCriada }: {
  project: { id: string; name: string }; catalog: Projects; onCriada: () => Promise<void>;
}) {
  const [aberto, setAberto] = useState(false);
  const [provider, setProvider] = useState("");
  const [profileId, setProfileId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const chave = useRef<string | null>(null);

  const contas = catalog.profiles.filter(p => p.provider === provider);
  if (catalog.agents.length === 0) {
    return <p className="text-sm text-text-secondary">Abra o OMNI no PC uma vez para liberar a criação de sessões daqui.</p>;
  }

  async function criar() {
    if (!provider || busy) return;
    // A chave sobrevive ao retry: um timeout tem resultado desconhecido, e sem isso um segundo
    // toque abriria uma PTY a mais no PC.
    chave.current ??= actionKey();
    setBusy(true); setError(null);
    try {
      await request("/sessoes", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": chave.current },
        body: JSON.stringify({ project_id: project.id, provider, profile_id: profileId || null }),
      });
      chave.current = null; setAberto(false); setProvider(""); setProfileId("");
      await onCriada();
    } catch (reason) {
      if (reason instanceof ApiError && reason.status >= 400 && reason.status < 500) chave.current = null;
      setError(String(reason));
    } finally { setBusy(false); }
  }

  if (!aberto) return <Button className="mb-4" onClick={() => setAberto(true)}>Nova sessão</Button>;
  return <div className="mobile-card mb-4">
    <h3 className="font-semibold mb-3">Nova sessão em {project.name}</h3>
    <label htmlFor="agente">Agente</label>
    <select id="agente" className="mobile-composer" value={provider}
      onChange={event => { setProvider(event.target.value); setProfileId(""); }}>
      <option value="">Escolha…</option>
      {catalog.agents.map(a => <option key={a.id} value={a.id}>{a.label}</option>)}
    </select>
    {contas.length > 1 && <>
      <label htmlFor="conta">Conta</label>
      <select id="conta" className="mobile-composer" value={profileId} onChange={event => setProfileId(event.target.value)}>
        <option value="">Padrão</option>
        {contas.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
      </select>
    </>}
    <div className="flex gap-3 mt-3">
      <Button disabled={busy || !provider} onClick={() => void criar()}>Abrir</Button>
      <Button variant="ghost" disabled={busy} onClick={() => setAberto(false)}>Cancelar</Button>
    </div>
    {error && <p role="alert" className="text-danger mt-3">{error}</p>}
  </div>;
}

function ConversationList({ conversations, select }: { conversations: Conversation[]; select: (id: string) => void }) {
  return <div>{conversations.length === 0 ? <p className="text-text-secondary">Nenhuma conversa registrada.</p> : conversations.map(c =>
    <article key={c.id} className="mobile-card"><h2 className="font-semibold">{c.title}</h2>
      <p className="text-sm text-text-secondary">{[c.provider, c.profile_id, STATES[c.state ?? ""] ?? "Sem sessão ativa"].filter(Boolean).join(" · ")}</p>
      {c.capabilities?.approve && <p className="text-warning">Aguardando aprovação</p>}
      <Button className="mt-3" onClick={() => select(c.id)}>Abrir conversa</Button>
    </article>)}</div>;
}

function ConversationDetail({ conversation, refresh }: { conversation: Conversation; refresh: () => Promise<void> }) {
  const [data, setData] = useState<Timeline | null>(null);
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [cursor, setCursor] = useState(0);
  const pending = useRef<{ signature: string; key: string; revision: string } | null>(null);
  const load = useCallback(async () => { setData(await request<Timeline>(`/conversas/${encodeURIComponent(conversation.id)}/timeline?cursor=${cursor}`)); }, [conversation.id, cursor]);
  usePoll(async () => {
    const result = await request<Timeline>(`/conversas/${encodeURIComponent(conversation.id)}/timeline?cursor=${cursor}`);
    setData(result); setError(null);
  }, reason => setError(String(reason)), [conversation.id,cursor]);
  async function send(kind: "prompt" | "aprovar", permitir?: boolean) {
    const capability = conversation.capabilities;
    if (!capability || busy) return;
    const body = kind === "prompt" ? { texto: text } : { permitir };
    const signature = JSON.stringify([kind,body]);
    if (pending.current?.signature !== signature) pending.current = { signature,key:actionKey(),revision:capability.revision };
    setBusy(true); setError(null); setNotice(null);
    try {
      await request(`/conversas/${encodeURIComponent(conversation.id)}/${kind}`, { method:"POST",headers:{"Content-Type":"application/json","Idempotency-Key":pending.current.key,"If-Match":pending.current.revision},body:JSON.stringify(body) });
      pending.current = null;
      if (kind === "prompt") setText("");
      setNotice("Ação enfileirada. Acompanhe a confirmação abaixo.");
      await Promise.all([load(),refresh()]);
    } catch (reason) {
      // A network timeout has an unknown outcome: reuse the key on retry, even after refresh.
      if (reason instanceof ApiError && reason.status >= 400 && reason.status < 500) pending.current = null;
      setError(String(reason));
    }
    finally { setBusy(false); }
  }
  return <section>
    <h2 className="text-lg font-semibold">{conversation.title}</h2>
    <p className="text-sm text-text-secondary">{[conversation.provider, STATES[conversation.state ?? ""] ?? "Sem sessão ativa"].filter(Boolean).join(" · ")}</p>
    <div aria-label="Mensagens">{data?.timeline.messages.map(message => <article className="mobile-card" key={message.id}>
      <p className="text-xs text-accent mb-2">{message.role === "user" ? "Você" : message.provider}</p><p className="mobile-message">{message.text}</p>
    </article>)}</div>
    {!!data?.timeline.unavailable_segments.length && <p className="text-warning text-sm">Parte do histórico está indisponível; nenhum transcript foi associado por aproximação.</p>}
    <div className="flex gap-2 my-3">{cursor > 0 && <Button onClick={() => setCursor(Math.max(0,cursor - 100))}>Anteriores</Button>}{data?.timeline.next_cursor != null && <Button onClick={() => setCursor(data.timeline.next_cursor!)}>Próximas mensagens</Button>}</div>
    {conversation.capabilities?.approve && <div className="mobile-card"><h3 className="font-semibold">Aprovação pendente</h3><p className="mobile-message my-3">{conversation.capabilities.approval_text}</p><div className="flex gap-3"><Button disabled={busy} onClick={() => void send("aprovar",true)}>Permitir</Button><Button variant="danger" disabled={busy} onClick={() => void send("aprovar",false)}>Negar</Button></div></div>}
    <form onSubmit={event => { event.preventDefault(); void send("prompt"); }} className="space-y-3">
      <label htmlFor="reply">Sua resposta</label><textarea id="reply" className="mobile-composer" value={text} onChange={event => setText(event.target.value)} maxLength={16000} placeholder="Responda ao agente…" />
      <Button type="submit" disabled={busy || !text.trim() || !conversation.capabilities?.prompt}>Enviar resposta</Button>
    </form>
    {conversation.capabilities?.reason && <p className="text-sm text-text-secondary mt-3">{conversation.capabilities.reason}</p>}
    {notice && <p role="status" className="text-sm mt-3">{notice}</p>}
    {error && <p role="alert" className="text-danger mt-3">{error}</p>}
    {data?.actions.slice(-5).map(action => <p key={action.id} className="text-sm text-text-secondary mt-2">{({ queued:"Na fila", executing:"Enviando", sent:"Enviado ao CLI", rejected:"Não enviado" } as Record<string,string>)[action.state] ?? action.state}{action.error ? `: ${action.error}` : ""}</p>)}
  </section>;
}

export function MobileApp() {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [attention, setAttention] = useState<Conversation[]>([]);
  const [catalog, setCatalog] = useState<Projects | null>(null);
  const [project, setProject] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [onlyAttention, setOnlyAttention] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const [all,waiting,projetos] = await Promise.all([
      request<Conversation[]>("/conversas"),
      request<Conversation[]>("/atencao"),
      request<Projects>("/projetos"),
    ]);
    // Normaliza na entrada: um engine mais antigo (sem `/projetos`) ou uma resposta truncada
    // deixava `projects` indefinido, e o `.find` logo abaixo derrubava a tela inteira — sem lista,
    // sem conversa, sem mensagem de erro. Confiar no formato aqui é o que deixa o resto simples.
    setCatalog({
      published_at_ms: Number(projetos?.published_at_ms) || 0,
      projects: Array.isArray(projetos?.projects) ? projetos.projects : [],
      agents: Array.isArray(projetos?.agents) ? projetos.agents : [],
      profiles: Array.isArray(projetos?.profiles) ? projetos.profiles : [],
    });
    setConversations(Array.isArray(all) ? all : []);
    setAttention(Array.isArray(waiting) ? waiting : []);
    setError(null);
  },[]);
  usePoll(refresh, reason => setError(String(reason)), [refresh]);

  const conversation = conversations.find(c => c.id === selected);
  const aberto = catalog?.projects.find(p => p.id === project) ?? null;
  const daLista = onlyAttention ? attention : conversations;
  const doProjeto = aberto ? daLista.filter(c => c.project_id === aberto.id) : daLista;
  const aviso = catalog ? idadeDaLista(catalog.published_at_ms) : null;

  function voltar() {
    if (selected) { setSelected(null); return; }
    setProject(null);
  }

  return <main className="mobile-shell">
    <header className="flex items-center justify-between gap-3 mb-5">
      <h1 className="font-bold text-lg">OMNI AGENTS</h1>
      <Button variant="ghost" onClick={() => void refresh().catch(reason => setError(String(reason)))}>Atualizar</Button>
    </header>
    {error && <p role="alert" className="text-danger">Não foi possível conectar: {error}</p>}
    {(selected || project) && <Button className="mb-4" onClick={voltar}>← {selected ? "Conversas" : "Projetos"}</Button>}

    {conversation ? <ConversationDetail key={conversation.id} conversation={conversation} refresh={refresh} />
      : aberto ? <>
        <h2 className="text-lg font-semibold mb-1">{aberto.name}</h2>
        <p className="text-sm text-text-secondary break-all mb-4">{aberto.path}</p>
        {catalog && <NovaSessao project={aberto} catalog={catalog} onCriada={refresh} />}
        <nav className="flex gap-3 mb-3" aria-label="Filtrar conversas">
          <Button aria-pressed={!onlyAttention} onClick={() => setOnlyAttention(false)}>Todas</Button>
          <Button aria-pressed={onlyAttention} onClick={() => setOnlyAttention(true)}>Atenção ({attention.filter(c => c.project_id === aberto.id).length})</Button>
        </nav>
        <ConversationList conversations={doProjeto} select={setSelected} />
      </> : <>
        {aviso && <p className="text-sm text-text-secondary mb-3">{aviso}</p>}
        <nav className="flex gap-3 mb-3" aria-label="Filtrar conversas">
          <Button aria-pressed={!onlyAttention} onClick={() => setOnlyAttention(false)}>Projetos</Button>
          <Button aria-pressed={onlyAttention} onClick={() => setOnlyAttention(true)}>Atenção ({attention.length})</Button>
        </nav>
        {onlyAttention
          ? <ConversationList conversations={attention} select={setSelected} />
          : <ProjectList projects={catalog?.projects ?? []} conversations={conversations} select={setProject} />}
      </>}
  </main>;
}
