import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "../components/ui/Button";
import { request, actionKey, ApiError, type Conversation, type Timeline } from "./api";

const STATES: Record<string,string> = { working: "Trabalhando", answered: "Resposta disponível", approval_required: "Possível aprovação pendente", stopped: "Encerrado", orphan: "Sessão anterior", crashed: "Interrompido" };

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
  useEffect(() => {
    let cancelled = false; let timer: number; let delay = 5000;
    async function poll() {
      if (!document.hidden) {
        try { const result = await request<Timeline>(`/conversas/${encodeURIComponent(conversation.id)}/timeline?cursor=${cursor}`); if (!cancelled) { setData(result); setError(null); } delay = 5000; }
        catch (reason) { if (!cancelled) setError(String(reason)); delay = Math.min(delay * 2,60000); }
      }
      if (!cancelled) timer = window.setTimeout(poll,delay);
    }
    void poll(); return () => { cancelled = true; window.clearTimeout(timer); };
  }, [conversation.id,cursor]);
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
  const [selected, setSelected] = useState<string | null>(null);
  const [onlyAttention, setOnlyAttention] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const refresh = useCallback(async () => {
    const [all,waiting] = await Promise.all([request<Conversation[]>("/conversas"),request<Conversation[]>("/atencao")]);
    setConversations(all); setAttention(waiting); setError(null);
  },[]);
  useEffect(() => {
    let cancelled = false; let timer: number; let delay = 5000;
    async function poll() { if (!document.hidden) { try { await refresh(); delay = 5000; } catch (reason) { if (!cancelled) setError(String(reason)); delay = Math.min(delay * 2,60000); } }
      if (!cancelled) timer = window.setTimeout(poll,delay);
    }
    void poll(); return () => { cancelled = true; window.clearTimeout(timer); };
  },[refresh]);
  const conversation = conversations.find(c => c.id === selected);
  return <main className="mobile-shell"><header className="flex items-center justify-between gap-3 mb-5"><h1 className="font-bold text-lg">OMNI AGENTS</h1><Button variant="ghost" onClick={() => void refresh().catch(reason => setError(String(reason)))}>Atualizar</Button></header>
    {error && <p role="alert" className="text-danger">Não foi possível conectar: {error}</p>}
    {selected && <Button className="mb-4" onClick={() => setSelected(null)}>← Conversas</Button>}
    {conversation ? <ConversationDetail key={conversation.id} conversation={conversation} refresh={refresh} /> : <>
      <nav className="flex gap-3" aria-label="Filtrar conversas"><Button aria-pressed={!onlyAttention} onClick={() => setOnlyAttention(false)}>Todas</Button><Button aria-pressed={onlyAttention} onClick={() => setOnlyAttention(true)}>Atenção ({attention.length})</Button></nav>
      <ConversationList conversations={onlyAttention ? attention : conversations} select={setSelected} />
    </>}
  </main>;
}
