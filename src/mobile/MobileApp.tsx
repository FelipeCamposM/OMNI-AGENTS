import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Button } from "../components/ui/Button";
import { SegmentedControl } from "../components/ui/SegmentedControl";
import { Select } from "../components/ui/Select";
import { AgentIcon } from "../components/ui/AgentIcon";
import { OmniLogo } from "../components/ui/OmniLogo";
import { ArrowLeftIcon, FolderIcon, PlayIcon, ReloadIcon, WarningIcon } from "../components/ui/PixelIcon";
import { request, actionKey, ApiError, salvarToken, type Conversation, type Projects, type Timeline } from "./api";
import { AgentWorking, MessageBubble, PairingScreen } from "./Chat";
import { Composer } from "./Composer";
import {
  ANEXO_MAX_BYTES,
  criarAnexo,
  descartarAnexo,
  enviarAnexo,
  montarPrompt,
  type Anexo,
} from "./anexos";
import { useRota, type Rota } from "./rota";
import { aplicarTema, guardarTema, temaGuardado, type TemaPublicado } from "./tema";
import { usePoll } from "./usePoll";

const STATES: Record<string,string> = { working: "Trabalhando", answered: "Resposta disponível", approval_required: "Aprovação pendente", stopped: "Encerrado", orphan: "Sessão anterior", crashed: "Interrompido" };
const NOME_DO_AGENTE: Record<string, string> = { claude: "Claude", codex: "Codex", cursor: "Cursor" };

/** Cor do ponto de estado, na mesma linguagem do PC: trabalhando pulsa no acento, pronto é verde. */
function tomDoEstado(state: string | null, approve: boolean): string {
  if (approve || state === "approval_required") return "m-dot-alerta";
  if (state === "working") return "m-dot-ativo";
  if (state === "answered") return "m-dot-ok";
  if (state === "crashed") return "m-dot-erro";
  return "m-dot-parado";
}

/** Guarda uma preferência só desta aba. Navegador sem armazenamento segue sem ela. */
function lerSessao(chave: string): string | null {
  try { return sessionStorage.getItem(chave); } catch { return null; }
}
function gravarSessao(chave: string, valor: string | null) {
  try { if (valor === null) sessionStorage.removeItem(chave); else sessionStorage.setItem(chave, valor); } catch { /* nada */ }
}

/** Quanto tempo faz que o desktop publicou. O celular mostra a idade e quem julga se a lista ainda
 *  vale é quem está lendo — nada expira sozinho. */
function idadeDaLista(publishedAtMs: number): string | null {
  if (!publishedAtMs) return "Lista montada a partir das conversas: o desktop ainda não publicou.";
  const minutos = Math.floor((Date.now() - publishedAtMs) / 60_000);
  if (minutos < 5) return null;
  if (minutos < 60) return `Lista publicada há ${minutos} min.`;
  return `Lista publicada há ${Math.floor(minutos / 60)} h.`;
}

/* ─────────────────────────────────────────────────────────────── estrutura */

function TopBar({ titulo, subtitulo, onVoltar, onAtualizar }: {
  titulo: ReactNode; subtitulo?: ReactNode; onVoltar?: () => void; onAtualizar: () => Promise<void>;
}) {
  const [girando, setGirando] = useState(false);
  return (
    <header className="m-topo glass glass-strong">
      {onVoltar
        ? <button type="button" className="btn btn-ghost m-topo-icone" aria-label="Voltar" onClick={onVoltar}>
            <ArrowLeftIcon aria-hidden className="h-5 w-5" />
          </button>
        : <OmniLogo className="neon-glow m-topo-logo" />}
      <div className="m-topo-texto">
        <div className="m-topo-titulo">{titulo}</div>
        {subtitulo && <div className="m-topo-sub">{subtitulo}</div>}
      </div>
      <button type="button" className="btn btn-ghost m-topo-icone" aria-label="Atualizar" disabled={girando}
        onClick={() => { setGirando(true); void onAtualizar().finally(() => setGirando(false)); }}>
        <ReloadIcon aria-hidden className={`h-5 w-5${girando ? " anexo-girando" : ""}`} />
      </button>
    </header>
  );
}

function Vazio({ children }: { children: ReactNode }) {
  return <p className="m-vazio">{children}</p>;
}

function Secao({ titulo, children, acao }: { titulo: string; children: ReactNode; acao?: ReactNode }) {
  return (
    <section className="m-secao">
      <div className="m-secao-cabecalho">
        <h2 className="m-secao-titulo">{titulo}</h2>
        {acao}
      </div>
      {children}
    </section>
  );
}

/* ─────────────────────────────────────────────────────────────── listas */

function ProjectList({ projects, conversations, abrir }: {
  projects: Projects["projects"]; conversations: Conversation[]; abrir: (id: string) => void;
}) {
  if (projects.length === 0) return <Vazio>Nenhum projeto conhecido ainda. Abra um projeto no OMNI do PC.</Vazio>;
  return <ul className="m-lista">{projects.map(project => {
    const doProjeto = conversations.filter(c => c.project_id === project.id);
    const aguardando = doProjeto.filter(c => c.capabilities?.approve).length;
    const trabalhando = doProjeto.filter(c => c.state === "working").length;
    return <li key={project.id}>
      <button type="button" className="m-card glass glass-hover" onClick={() => abrir(project.id)}
        aria-label={`Abrir projeto ${project.name}, ${doProjeto.length} conversa(s)`}>
        <span className="m-card-icone"><FolderIcon aria-hidden className="h-5 w-5" /></span>
        <span className="m-card-corpo">
          <span className="m-card-titulo">{project.name}</span>
          <span className="m-card-sub">{project.path}</span>
        </span>
        <span className="m-card-lado">
          {aguardando > 0 && <span className="m-badge m-badge-alerta">{aguardando} aprovar</span>}
          {trabalhando > 0 && <span className="m-badge m-badge-ativo">{trabalhando} ativo</span>}
          <span className="m-badge">{doProjeto.length}</span>
        </span>
      </button>
    </li>;
  })}</ul>;
}

function ConversationList({ conversations, perfis, abrir, vazio }: {
  conversations: Conversation[]; perfis: Projects["profiles"]; abrir: (id: string) => void; vazio: string;
}) {
  if (conversations.length === 0) return <Vazio>{vazio}</Vazio>;
  return <ul className="m-lista">{conversations.map(c => {
    const aprovar = Boolean(c.capabilities?.approve);
    const conta = perfis.find(p => p.id === c.profile_id)?.name;
    const detalhe = [STATES[c.state ?? ""] ?? "Sem sessão ativa", NOME_DO_AGENTE[c.provider ?? ""] ?? c.provider, conta]
      .filter(Boolean).join(" · ");
    return <li key={c.id}>
      <button type="button" className="m-card glass glass-hover" onClick={() => abrir(c.id)} aria-label={`Abrir conversa ${c.title}`}>
        <span className="m-card-icone">
          {c.provider ? <AgentIcon provider={c.provider} size={20} /> : <PlayIcon aria-hidden className="h-5 w-5" />}
        </span>
        <span className="m-card-corpo">
          <span className="m-card-titulo">{c.title}</span>
          <span className="m-card-sub">
            <span className={`m-dot ${tomDoEstado(c.state, aprovar)}`} aria-hidden />
            {detalhe}
          </span>
        </span>
        {aprovar && <span className="m-card-lado"><span className="m-badge m-badge-alerta">Aprovar</span></span>}
      </button>
    </li>;
  })}</ul>;
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
    return <p className="m-dica">Abra o OMNI no PC uma vez para liberar a criação de sessões daqui.</p>;
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

  if (!aberto) return <Button variant="primary" className="w-full" onClick={() => setAberto(true)}>Nova sessão</Button>;
  return <div className="glass m-painel">
    <h3 className="m-secao-titulo">Nova sessão em {project.name}</h3>
    <label htmlFor="agente" className="m-rotulo">Agente</label>
    <Select id="agente" value={provider} placeholder="Escolha o agente…"
      options={catalog.agents.map(a => ({ value: a.id, label: a.label, icon: <AgentIcon provider={a.id} size={14} className="shrink-0" /> }))}
      onChange={value => { setProvider(value); setProfileId(""); }} />
    {contas.length > 1 && <>
      <label htmlFor="conta" className="m-rotulo">Conta</label>
      <Select id="conta" value={profileId}
        options={[{ value: "", label: "Padrão" }, ...contas.map(p => ({ value: p.id, label: p.name }))]}
        onChange={setProfileId} />
    </>}
    <div className="m-acoes">
      <Button variant="primary" disabled={busy || !provider} onClick={() => void criar()}>{busy ? "Abrindo…" : "Abrir"}</Button>
      <Button variant="ghost" disabled={busy} onClick={() => setAberto(false)}>Cancelar</Button>
    </div>
    {error && <p role="alert" className="m-alerta">{error}</p>}
  </div>;
}

/* ─────────────────────────────────────────────────────────────── chat */

/** Prompt mandado daqui que ainda não apareceu no transcript. Some quando chega. */
interface Enviado {
  texto: string;
  em: number;
  acao: string | null;
  /** Índice da última mensagem já vista no envio. Qualquer mensagem do usuário depois dela é esta. */
  base: number;
  anexos: { nome: string; previa: string | null }[];
}

/** Ritmo do polling com o agente ativo. 5 s faz a conversa parecer travada; 1,5 s parece ao vivo. */
const POLL_ATIVO_MS = 1_500;

/** Quanto esperar a mensagem enviada aparecer no transcript antes de desistir do balão otimista.
 *  Sem isto, uma mensagem que a CLI não aceitou deixava o "trabalhando" girando para sempre. */
const LIMITE_DE_CONFIRMACAO_MS = 120_000;

/** O servidor numera as mensagens (`<conversa>:<n>`) na ordem do transcript. */
function indiceDaMensagem(id: string): number {
  const n = Number(id.slice(id.lastIndexOf(":") + 1));
  return Number.isFinite(n) ? n : -1;
}

function ConversationDetail({ conversation, refresh }: { conversation: Conversation; refresh: () => Promise<void> }) {
  const chaveRascunho = `omni-rascunho:${conversation.id}`;
  const [data, setData] = useState<Timeline | null>(null);
  // O rascunho sobrevive ao refresh da página: atualizar no meio da digitação não apaga nada.
  const [text, setText] = useState(() => lerSessao(chaveRascunho) ?? "");
  const [anexos, setAnexos] = useState<Anexo[]>([]);
  const [error, setError] = useState<string | null>(null);
  // Separado de `error`: o polling limpa `error` a cada ciclo bem-sucedido, e uma recusa da fila
  // aparecia e sumia no mesmo instante. Este só limpa no próximo envio.
  const [falhaEnvio, setFalhaEnvio] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // `null` = fim da conversa, como um chat abre. Número = lendo uma página antiga.
  const [cursor, setCursor] = useState<number | null>(null);
  const [enviado, setEnviado] = useState<Enviado | null>(null);
  const pending = useRef<{ signature: string; key: string; revision: string } | null>(null);
  const trabalhandoDesde = useRef<number | null>(null);
  const fim = useRef<HTMLDivElement>(null);
  const anexosVivos = useRef<Anexo[]>([]);
  anexosVivos.current = anexos;
  const enviadoVivo = useRef<Enviado | null>(null);
  enviadoVivo.current = enviado;

  useEffect(() => { gravarSessao(chaveRascunho, text || null); }, [chaveRascunho, text]);
  // Prévia local não pode vazar memória ao sair da conversa.
  useEffect(() => () => {
    anexosVivos.current.forEach(descartarAnexo);
    enviadoVivo.current?.anexos.forEach(a => a.previa && URL.revokeObjectURL(a.previa));
  }, []);

  const trabalhando = conversation.state === "working";
  const ativo = trabalhando || enviado !== null;
  if (ativo && trabalhandoDesde.current === null) trabalhandoDesde.current = enviado?.em ?? Date.now();
  if (!ativo) trabalhandoDesde.current = null;

  const base = `/conversas/${encodeURIComponent(conversation.id)}/timeline`;
  const url = cursor === null ? base : `${base}?cursor=${cursor}`;
  const load = useCallback(async () => { setData(await request<Timeline>(url)); }, [url]);
  usePoll(async () => {
    const result = await request<Timeline>(url);
    setData(result); setError(null);
    // Com o agente ativo o estado da conversa também precisa andar rápido, senão o "trabalhando"
    // fica na tela até o próximo ciclo lento da lista.
    if (ativo) await refresh();
  }, reason => setError(String(reason)), [url, ativo], ativo ? POLL_ATIVO_MS : undefined);

  const mensagens = data?.timeline.messages ?? [];
  const ultimaId = mensagens[mensagens.length - 1]?.id ?? "";

  /** Tira o balão otimista da tela, devolvendo as prévias locais que ele segurava. */
  const descartarEnviado = useCallback((motivo: string | null) => {
    setEnviado(atual => {
      atual?.anexos.forEach(a => a.previa && URL.revokeObjectURL(a.previa));
      return null;
    });
    if (motivo) setFalhaEnvio(motivo);
  }, []);

  // O prompt otimista sai quando chega de verdade no transcript, ou quando a fila o recusa.
  useEffect(() => {
    if (!enviado) return;
    const chegou = mensagens.some(m => m.role === "user"
      && (m.text.trim() === enviado.texto.trim() || indiceDaMensagem(m.id) > enviado.base));
    const acao = data?.actions.find(a => a.id === enviado.acao);
    if (chegou) { descartarEnviado(null); return; }
    if (acao?.state === "rejected") descartarEnviado(`Não foi enviado: ${acao.error ?? "o agente recusou a entrada"}`);
  }, [data, enviado, mensagens, descartarEnviado]);

  // Rede de segurança com relógio próprio: sem rede não há polling, e era justamente aí que o
  // "trabalhando" ficava girando para sempre.
  useEffect(() => {
    if (!enviado) return;
    const restante = Math.max(0, enviado.em + LIMITE_DE_CONFIRMACAO_MS - Date.now());
    const timer = window.setTimeout(
      () => descartarEnviado("Não consegui confirmar o envio desta mensagem. Veja no PC se ela chegou ao agente."),
      restante,
    );
    return () => window.clearTimeout(timer);
  }, [enviado, descartarEnviado]);

  // Chat rola para a mensagem mais nova; lendo página antiga, começa do topo dela.
  useEffect(() => {
    if (cursor === null) fim.current?.scrollIntoView?.({ block: "end" });
    else window.scrollTo?.({ top: 0 });
  }, [ultimaId, ativo, cursor]);

  function adicionar(arquivos: File[]) {
    if (arquivos.length === 0) return;
    setFalhaEnvio(null);
    setAnexos(lista => [...lista, ...arquivos.map(criarAnexo)]);
  }

  function remover(id: string) {
    setAnexos(lista => {
      const saindo = lista.find(a => a.id === id);
      if (saindo) descartarAnexo(saindo);
      return lista.filter(a => a.id !== id);
    });
  }

  const marcar = (id: string, mudanca: Partial<Anexo>) =>
    setAnexos(lista => lista.map(a => (a.id === id ? { ...a, ...mudanca } : a)));

  async function post(kind: "prompt" | "aprovar", body: Record<string, unknown>) {
    const capability = conversation.capabilities!;
    const signature = JSON.stringify([kind, body]);
    if (pending.current?.signature !== signature) pending.current = { signature, key: actionKey(), revision: capability.revision };
    const acao = await request<{ id?: string }>(`/conversas/${encodeURIComponent(conversation.id)}/${kind}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Idempotency-Key": pending.current.key, "If-Match": pending.current.revision },
      body: JSON.stringify(body),
    });
    pending.current = null;
    return acao;
  }

  function falhou(reason: unknown) {
    // A network timeout has an unknown outcome: reuse the key on retry, even after refresh.
    if (reason instanceof ApiError && reason.status >= 400 && reason.status < 500) pending.current = null;
    setError(String(reason));
  }

  async function aprovar(permitir: boolean) {
    if (!conversation.capabilities || busy) return;
    setBusy(true); setError(null); setFalhaEnvio(null);
    try { await post("aprovar", { permitir }); await Promise.all([load(), refresh()]); }
    catch (reason) { falhou(reason); }
    finally { setBusy(false); }
  }

  async function enviarPrompt() {
    if (!conversation.capabilities || busy) return;
    setBusy(true); setError(null); setFalhaEnvio(null);
    const lista = anexosVivos.current;
    try {
      // Sobe o que ainda não subiu. O caminho fica guardado no anexo: se o prompt der timeout, o
      // reenvio monta o mesmo texto — e a mesma chave de idempotência — sem duplicar arquivo.
      const caminhos: string[] = [];
      for (const anexo of lista) {
        if (anexo.caminho) { caminhos.push(anexo.caminho); continue; }
        marcar(anexo.id, { estado: "enviando", erro: undefined });
        try {
          const caminho = await enviarAnexo(conversation.id, anexo.arquivo);
          // Um reenvio lê a lista do render seguinte, que já traz o caminho.
          marcar(anexo.id, { estado: "enviado", caminho });
          caminhos.push(caminho);
        } catch (reason) {
          marcar(anexo.id, { estado: "erro", erro: reason instanceof Error ? reason.message : String(reason) });
          throw new Error(`Não consegui mandar "${anexo.arquivo.name}" para o PC.`);
        }
      }
      const texto = montarPrompt(text, caminhos);
      const acao = await post("prompt", { texto });
      setEnviado({
        texto, em: Date.now(), acao: acao?.id ?? null,
        base: Math.max(-1, ...mensagens.map(m => indiceDaMensagem(m.id))),
        // As prévias passam para o balão otimista; quem revoga é ele, quando o transcript chegar.
        anexos: lista.map(a => ({ nome: a.arquivo.name || "anexo", previa: a.previa })),
      });
      setText("");
      setAnexos([]);
      setCursor(null);
      await Promise.all([load(), refresh()]);
    } catch (reason) {
      falhou(reason);
    } finally { setBusy(false); }
  }

  const capability = conversation.capabilities;
  const temConteudo = text.trim().length > 0 || anexos.length > 0;
  const anexoGrande = anexos.some(a => a.arquivo.size > ANEXO_MAX_BYTES);
  const podeEnviar = Boolean(capability?.prompt) && !busy && temConteudo && !anexoGrande;
  const timeline = data?.timeline;

  return <section className="chat-tela">
    {timeline?.prev_cursor != null && (
      <Button variant="ghost" size="sm" className="m-paginar" onClick={() => setCursor(timeline.prev_cursor!)}>
        Mensagens anteriores
      </Button>
    )}
    {!!timeline?.unavailable_segments.length && <p className="m-aviso">Parte do histórico está indisponível; nenhum transcript foi associado por aproximação.</p>}

    <div className="chat" aria-label="Mensagens">
      {data && mensagens.length === 0 && !enviado && !ativo && !timeline?.unavailable_segments.length && cursor === null &&
        <Vazio>Nenhuma mensagem ainda. Mande o primeiro prompt abaixo.</Vazio>}
      {mensagens.map(message => <MessageBubble key={message.id} lado={message.role === "user" ? "user" : "agent"}
        provider={message.provider} texto={message.text} horario={message.timestamp} />)}
      {enviado && <MessageBubble lado="user" pendente texto={enviado.texto}
        anexosLocais={enviado.anexos.length ? enviado.anexos : undefined} />}
      {capability?.approve && <div className="bubble bubble-agent bubble-aprovacao glass">
        <p className="bubble-author"><WarningIcon aria-hidden className="h-3.5 w-3.5 text-warning" />Aprovação pendente</p>
        <p className="mobile-message">{capability.approval_text}</p>
        <div className="m-acoes">
          <Button variant="primary" disabled={busy} onClick={() => void aprovar(true)}>Permitir</Button>
          <Button variant="danger" disabled={busy} onClick={() => void aprovar(false)}>Negar</Button>
        </div>
      </div>}
      {ativo && !capability?.approve && cursor === null &&
        <AgentWorking desde={trabalhandoDesde.current ?? Date.now()} provider={conversation.provider} />}
      <div ref={fim} />
    </div>

    {cursor !== null && (
      <div className="m-acoes m-acoes-centro">
        {timeline?.next_cursor != null && <Button variant="ghost" size="sm" onClick={() => setCursor(timeline.next_cursor!)}>Próximas mensagens</Button>}
        <Button size="sm" onClick={() => setCursor(null)}>Ir para as mais recentes</Button>
      </div>
    )}

    {(falhaEnvio || error) && <p role="alert" className="m-alerta">{falhaEnvio ?? error}</p>}
    {anexoGrande && <p className="m-aviso">Tire o anexo acima de 25 MB para enviar.</p>}
    {/* O motivo genérico só aparece com o agente parado: trabalhando, o "ocupado" é esperado e o
        indicador acima já explica. */}
    {!ativo && capability?.reason && <p className="m-dica">{capability.reason}</p>}

    <Composer texto={text} onTexto={setText} anexos={anexos} onAdicionar={adicionar} onRemover={remover}
      onEnviar={() => void enviarPrompt()} podeEnviar={podeEnviar} ocupado={busy}
      placeholder={!capability?.prompt ? (trabalhando ? "Agente trabalhando…" : "Sem sessão ativa") : "Mensagem para o agente…"} />
  </section>;
}

/* ─────────────────────────────────────────────────────────────── app */

const CHAVE_FILTRO = "omni-filtro";

export function MobileApp() {
  const { rota, ir, voltar } = useRota();
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [attention, setAttention] = useState<Conversation[]>([]);
  const [catalog, setCatalog] = useState<Projects | null>(null);
  const [carregado, setCarregado] = useState(false);
  const [onlyAttention, setOnlyAttention] = useState(() => lerSessao(CHAVE_FILTRO) === "atencao");
  const [error, setError] = useState<string | null>(null);
  // Sem acesso = o servidor respondeu 401. Acontece sempre na primeira abertura do app da tela
  // inicial do iPhone, que não enxerga o token que o QR gravou no Safari.
  const [semAcesso, setSemAcesso] = useState(false);
  // Começa pelo último tema recebido: a tela de pareamento e o primeiro quadro já saem com a cara do PC.
  const [tema, setTema] = useState<TemaPublicado | null>(() => temaGuardado());

  useEffect(() => aplicarTema(tema), [tema]);
  useEffect(() => { gravarSessao(CHAVE_FILTRO, onlyAttention ? "atencao" : null); }, [onlyAttention]);

  const refresh = useCallback(async () => {
    const [all,waiting,projetos] = await Promise.all([
      request<Conversation[]>("/conversas"),
      request<Conversation[]>("/atencao"),
      request<Projects>("/projetos"),
    ]);
    // Normaliza na entrada: um engine mais antigo (sem `/projetos`) ou uma resposta truncada
    // deixava `projects` indefinido, e o `.find` logo abaixo derrubava a tela inteira — sem lista,
    // sem conversa, sem mensagem de erro. Confiar no formato aqui é o que deixa o resto simples.
    const novoTema = projetos?.theme && typeof projetos.theme === "object" ? projetos.theme : null;
    setCatalog({
      published_at_ms: Number(projetos?.published_at_ms) || 0,
      projects: Array.isArray(projetos?.projects) ? projetos.projects : [],
      agents: Array.isArray(projetos?.agents) ? projetos.agents : [],
      profiles: Array.isArray(projetos?.profiles) ? projetos.profiles : [],
      theme: novoTema,
    });
    if (novoTema) {
      guardarTema(novoTema);
      // Compara por valor: objeto novo a cada poll reaplicaria o tema (e o `matchMedia`) à toa.
      setTema(atual => (JSON.stringify(atual) === JSON.stringify(novoTema) ? atual : novoTema));
    }
    setConversations(Array.isArray(all) ? all : []);
    setAttention(Array.isArray(waiting) ? waiting : []);
    setCarregado(true);
    setError(null);
  },[]);
  usePoll(refresh, reason => {
    if (reason instanceof ApiError && reason.status === 401) { setSemAcesso(true); return; }
    setError(String(reason));
  }, [refresh]);

  async function parear(codigo: string) {
    const { token } = await request<{ token: string }>("/parear", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ codigo }),
    });
    salvarToken(token);
    setSemAcesso(false); setError(null);
    await refresh();
  }

  const atualizar = () => refresh().catch(reason => setError(String(reason)));

  if (semAcesso) return <main className="m-shell"><PairingScreen parear={parear} /></main>;

  const conversa = rota.tela === "conversa" ? conversations.find(c => c.id === rota.conversa) ?? null : null;
  const projetoId = rota.tela === "projeto" ? rota.projeto : conversa?.project_id ?? null;
  const projeto = catalog?.projects.find(p => p.id === projetoId) ?? null;
  const perfis = catalog?.profiles ?? [];
  const aviso = catalog ? idadeDaLista(catalog.published_at_ms) : null;

  const pai: Rota = rota.tela === "conversa" && conversa ? { tela: "projeto", projeto: conversa.project_id } : { tela: "inicio" };
  const abrirConversa = (id: string) => ir({ tela: "conversa", conversa: id });

  let titulo: ReactNode = <span className="pixel-text">OMNI AGENTS</span>;
  let subtitulo: ReactNode = null;
  let conteudo: ReactNode;

  if (rota.tela === "conversa") {
    if (conversa) {
      const aprovar = Boolean(conversa.capabilities?.approve);
      titulo = conversa.title;
      subtitulo = <>
        <span className={`m-dot ${tomDoEstado(conversa.state, aprovar)}`} aria-hidden />
        {conversa.provider && <AgentIcon provider={conversa.provider} size={12} className="shrink-0" />}
        <span className="truncate">
          {[NOME_DO_AGENTE[conversa.provider ?? ""] ?? conversa.provider, STATES[conversa.state ?? ""] ?? "Sem sessão ativa", projeto?.name]
            .filter(Boolean).join(" · ")}
        </span>
      </>;
      conteudo = <ConversationDetail key={conversa.id} conversation={conversa} refresh={refresh} />;
    } else {
      titulo = "Conversa";
      conteudo = <Vazio>{carregado ? "Essa conversa não existe mais no PC." : "Carregando conversa…"}</Vazio>;
    }
  } else if (rota.tela === "projeto") {
    if (projeto) {
      const daLista = (onlyAttention ? attention : conversations).filter(c => c.project_id === projeto.id);
      const aguardando = attention.filter(c => c.project_id === projeto.id).length;
      titulo = projeto.name;
      subtitulo = <span className="truncate">{projeto.path}</span>;
      conteudo = <>
        {catalog && <NovaSessao project={projeto} catalog={catalog} onCriada={refresh} />}
        <Secao titulo="Conversas">
          <SegmentedControl<"todas" | "atencao"> value={onlyAttention ? "atencao" : "todas"}
            onChange={valor => setOnlyAttention(valor === "atencao")}
            options={[{ value: "todas", label: "Todas" }, { value: "atencao", label: `Atenção (${aguardando})` }]} />
          <ConversationList conversations={daLista} perfis={perfis} abrir={abrirConversa}
            vazio={onlyAttention ? "Nada esperando por você neste projeto." : "Nenhuma conversa neste projeto ainda."} />
        </Secao>
      </>;
    } else {
      titulo = "Projeto";
      conteudo = <Vazio>{carregado ? "Esse projeto não está mais aberto no PC." : "Carregando projeto…"}</Vazio>;
    }
  } else {
    conteudo = <>
      {aviso && <p className="m-aviso">{aviso}</p>}
      <SegmentedControl<"projetos" | "atencao"> value={onlyAttention ? "atencao" : "projetos"}
        onChange={valor => setOnlyAttention(valor === "atencao")}
        options={[{ value: "projetos", label: "Projetos" }, { value: "atencao", label: `Atenção (${attention.length})` }]} />
      {onlyAttention
        ? <ConversationList conversations={attention} perfis={perfis} abrir={abrirConversa} vazio="Nada esperando por você agora." />
        : <ProjectList projects={catalog?.projects ?? []} conversations={conversations} abrir={id => ir({ tela: "projeto", projeto: id })} />}
    </>;
  }

  return <div className="m-shell">
    <TopBar titulo={titulo} subtitulo={subtitulo} onAtualizar={atualizar}
      onVoltar={rota.tela === "inicio" ? undefined : () => voltar(pai)} />
    <main className="m-conteudo">
      {error && <p role="alert" className="m-alerta">Não foi possível conectar: {error}</p>}
      {conteudo}
    </main>
  </div>;
}
