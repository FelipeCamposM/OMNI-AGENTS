import { EtiquetaDoStatus, statusDaConversa } from "../components/ConversaStatus";
import type { TerminalSession } from "../features/terminal/terminalService";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Button } from "../components/ui/Button";
import { Input } from "../components/ui/Input";
import { SegmentedControl } from "../components/ui/SegmentedControl";
import { Select } from "../components/ui/Select";
import { AgentIcon } from "../components/ui/AgentIcon";
import { OmniLogo } from "../components/ui/OmniLogo";
import { AlertIcon, ArchiveIcon, ArrowLeftIcon, AttachmentIcon, ChatIcon, EditIcon, FolderIcon, GitBranchIcon, NotesIcon, PlayIcon, ReloadIcon, SearchIcon, WarningIcon } from "../components/ui/PixelIcon";
import { NOME_DO_AGENTE, request, requestSeMudou, esquecerVersao, actionKey, ApiError, type Comando, type Conversation, type Mensagem, type Projects, type Timeline } from "./api";
import { AgentWorking, BlocoDeAcoes, LinhaDeAviso, LinhaDeComando, MessageBubble, PairingScreen } from "./Chat";
import { Composer } from "./Composer";
import { ExportarConversa } from "./ExportarConversa";
import { CartaoDePergunta } from "./CartaoDePergunta";
import { AjustesDaConversa, type Ajustes } from "./AjustesDaConversa";
import {
  ANEXO_MAX_BYTES,
  criarAnexo,
  descartarAnexo,
  enviarAnexo,
  montarPrompt,
  type Anexo, EVENTO_ANEXAR, EVENTO_ARRASTANDO } from "./anexos";
import { useRota, type Rota } from "./rota";
import { useDados } from "./useDados";
import { usePoll } from "./usePoll";
import { corrigir, transcrever, useVozInstalada } from "./voz";
import { UsoDasContas } from "../web/UsoDasContas";
import { AprovacoesDeFluxo } from "./AprovacoesDeFluxo";
import { PreviasLocais } from "../web/PreviasLocais";

const STATES: Record<string,string> = { working: "Trabalhando", answered: "Resposta disponível", approval_required: "Aprovação pendente", stopped: "Encerrado", orphan: "Sessão anterior", crashed: "Interrompido" };

/** Busca compartilhada pelo celular e pela web: todas as palavras precisam aparecer em algum dos
 * campos visíveis da conversa, da conta ou do projeto. */
export function filterConversations(
  conversations: Conversation[],
  query: string,
  perfis: Projects["profiles"] = [],
  projetos: Projects["projects"] = [],
): Conversation[] {
  const termos = query.toLocaleLowerCase("pt-BR").split(/\s+/).filter(Boolean);
  if (termos.length === 0) return conversations;
  const contas = new Map(perfis.map((perfil) => [perfil.id, perfil.name]));
  const pastas = new Map(projetos.map((projeto) => [projeto.id, `${projeto.name} ${projeto.path}`]));
  return conversations.filter((conversa) => {
    const texto = [
      conversa.title,
      conversa.provider,
      NOME_DO_AGENTE[conversa.provider ?? ""],
      conversa.profile_id ? contas.get(conversa.profile_id) : null,
      pastas.get(conversa.project_id),
    ].filter(Boolean).join(" ").toLocaleLowerCase("pt-BR");
    return termos.every((termo) => texto.includes(termo));
  });
}

/** Cor do ponto de estado, na mesma linguagem do PC: trabalhando pulsa no acento, pronto é verde. */
function tomDoEstado(state: string | null, approve: boolean): string {
  if (approve || state === "approval_required") return "m-dot-alerta";
  if (state === "working") return "m-dot-ativo";
  if (state === "answered") return "m-dot-ok";
  if (state === "crashed") return "m-dot-erro";
  return "m-dot-parado";
}

/** "agora", "5 min", "3 h", "2 d": quanto faz desde a última atividade da conversa. */
export function haQuanto(ms: number | undefined, agora = Date.now()): string | null {
  if (!ms) return null;
  const minutos = Math.floor(Math.max(0, agora - ms) / 60_000);
  if (minutos < 1) return "agora";
  if (minutos < 60) return `${minutos} min`;
  if (minutos < 24 * 60) return `${Math.floor(minutos / 60)} h`;
  return `${Math.floor(minutos / (24 * 60))} d`;
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

function TopBar({ titulo, subtitulo, onVoltar, onAtualizar, marca }: {
  titulo: ReactNode; subtitulo?: ReactNode; onVoltar?: () => void; onAtualizar: () => Promise<void>;
  /** Avatar ao lado do título (a IA da conversa, com o anel do estado). */
  marca?: ReactNode;
}) {
  const [girando, setGirando] = useState(false);
  return (
    <header className="m-topo glass glass-strong">
      {onVoltar
        ? <button type="button" className="btn btn-ghost m-topo-icone" aria-label="Voltar" onClick={onVoltar}>
            <ArrowLeftIcon aria-hidden className="h-5 w-5" />
          </button>
        : <OmniLogo className="neon-glow m-topo-logo" />}
      {marca}
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

/** Topo do início: saudação pela hora, a data e uma frase do que está acontecendo agora. */
function Saudacao({ trabalhando, aguardando, aviso, children }: { trabalhando: number; aguardando: number; aviso: string | null; children: ReactNode }) {
  const agora = new Date();
  const hora = agora.getHours();
  const ola = hora < 5 ? "Boa madrugada" : hora < 12 ? "Bom dia" : hora < 18 ? "Boa tarde" : "Boa noite";
  const data = agora.toLocaleDateString("pt-BR", { weekday: "long", day: "numeric", month: "long" });
  const frase = aguardando > 0
    ? `${aguardando} ${aguardando === 1 ? "conversa espera" : "conversas esperam"} por você`
    : trabalhando > 0
    ? `${trabalhando} ${trabalhando === 1 ? "agente trabalhando" : "agentes trabalhando"} agora`
    : "Tudo em dia por aqui";
  return (
    <section className="m-ola" aria-label="Resumo">
      <span className="m-ola-brilho" aria-hidden />
      <p className="m-ola-data">{data}</p>
      <h1 className="m-ola-titulo">{ola}</h1>
      <p className="m-ola-frase" data-tom={aguardando > 0 ? "alerta" : trabalhando > 0 ? "ativo" : "neutro"}>
        <span className="m-ola-ponto" aria-hidden />{frase}
      </p>
      {aviso && <p className="m-ola-aviso">{aviso}</p>}
      {children}
    </section>
  );
}

function Vazio({ children }: { children: ReactNode }) {
  return <p className="m-vazio">{children}</p>;
}

export function Secao({ titulo, children, acao, icone, total }: {
  titulo: string; children: ReactNode; acao?: ReactNode; icone?: ReactNode; total?: number;
}) {
  return (
    <section className="m-secao">
      <div className="m-secao-cabecalho">
        {icone && <span className="m-secao-icone" aria-hidden>{icone}</span>}
        <h2 className="m-secao-titulo">{titulo}</h2>
        {total !== undefined && total > 0 && <span className="m-secao-total">{total}</span>}
        <span className="m-secao-linha" aria-hidden />
        {acao}
      </div>
      {children}
    </section>
  );
}

/* ─────────────────────────────────────────────────────────────── listas */

/** Pasta oculta (`.worker-data`), temporária (`AppData/Local/Temp`) ou worktree de execução: agente
 *  rodado por outro programa, teste ou fluxo, não projeto de alguém. Só aparece em "Mostrar todos" e na busca. */
export const PASTA_TEMPORARIA = /[\\/](\.[^\\/]+|Temp|tmp|worktrees)([\\/]|$)/i;

/** Um dos 8 tons de `.m-monograma[data-cor]`, sempre o mesmo para o mesmo nome. */
function corDoNome(nome: string): number {
  let soma = 0;
  for (const letra of nome) soma = (soma * 31 + letra.charCodeAt(0)) >>> 0;
  return soma % 8;
}

/** `D:\a\b\PROJETO` → `a/b`: a pasta de onde o projeto vem, curta o bastante para caber no card. */
function pastaCurta(caminho: string): string {
  const partes = caminho.split(/[\\/]/).filter(Boolean);
  return partes.slice(-3, -1).join("/") || caminho;
}

export function ProjectList({ projects, conversations, abrir, limite = Infinity, vazio = "Nenhum projeto conhecido ainda. Abra um projeto no OMNI do PC." }: {
  projects: Projects["projects"]; conversations: Conversation[]; abrir: (id: string) => void;
  /** Quantos mostrar antes do "Mostrar todos": o PC guarda toda pasta que um agente já abriu. */
  limite?: number; vazio?: string;
}) {
  const [verTodos, setVerTodos] = useState(false);
  if (projects.length === 0) return <Vazio>{vazio}</Vazio>;
  // Projeto mexido por último primeiro, como a lista de conversas.
  const ultimaAtividade = (id: string) => Math.max(0, ...conversations.filter(c => c.project_id === id).map(c => c.updated_at_ms ?? 0));
  const ordenados = [...projects].sort((a, b) => ultimaAtividade(b.id) - ultimaAtividade(a.id));
  // Projeto sem conversa é só uma pasta que o PC já abriu um dia: fica recolhido junto com os antigos.
  // Sem limite (a busca) mostra tudo o que bateu.
  const principais = limite === Infinity ? ordenados
    : ordenados.filter(p => conversations.some(c => c.project_id === p.id) && !PASTA_TEMPORARIA.test(p.path)).slice(0, limite);
  const resto = ordenados.length - (principais.length || ordenados.length);
  const visiveis = verTodos || principais.length === 0 ? ordenados : principais;
  return <>
    <ul className="m-lista">{visiveis.map(project => {
    const doProjeto = conversations.filter(c => c.project_id === project.id);
    const aguardando = doProjeto.filter(c => c.capabilities?.approve).length;
    const trabalhando = doProjeto.filter(c => c.state === "working").length;
    const ultima = haQuanto(Math.max(0, ...doProjeto.map(c => c.updated_at_ms ?? 0)) || undefined);
    const agentes = [...new Set(doProjeto.map(c => c.provider).filter((p): p is string => Boolean(p)))];
    return <li key={project.id}>
      <button type="button" className="m-card glass glass-hover" onClick={() => abrir(project.id)} title={project.path}
        aria-label={`Abrir projeto ${project.name}, ${doProjeto.length} conversa(s)`}>
        <span className="m-card-icone m-monograma" data-cor={corDoNome(project.name)} aria-hidden>
          {project.name.replace(/[^\p{L}\p{N}]/gu, "").slice(0, 2).toUpperCase() || <FolderIcon className="h-5 w-5" />}
          {trabalhando > 0 && <span className="m-monograma-vivo" />}
        </span>
        <span className="m-card-corpo">
          <span className="m-card-titulo">{project.name}</span>
          <span className="m-card-sub">
            {agentes.map(p => <AgentIcon key={p} provider={p} size={11} className="shrink-0" />)}
            <span className="truncate">{doProjeto.length === 0 ? "Sem conversas" : doProjeto.length === 1 ? "1 conversa" : `${doProjeto.length} conversas`}{ultima ? ` · ${ultima}` : ""}</span>
          </span>
          <span className="m-card-caminho">{pastaCurta(project.path)}</span>
        </span>
        <span className="m-card-lado">
          {aguardando > 0 && <span className="m-badge m-badge-alerta">{aguardando} aprovar</span>}
          {trabalhando > 0 && <span className="m-badge m-badge-ativo">{trabalhando} ativo</span>}
        </span>
      </button>
    </li>;
  })}</ul>
    {resto > 0 && (
      <button type="button" className="m-ocultas-botao" aria-expanded={verTodos} onClick={() => setVerTodos(v => !v)}>
        <FolderIcon aria-hidden className="h-3.5 w-3.5" />
        {verTodos ? "Mostrar só os recentes" : `Mostrar todos os projetos (mais ${resto})`}
      </button>
    )}
  </>;
}

export function ConversationList({ conversations, perfis, projetos = [], mostrarProjeto = false, abrir, vazio, ativa = null, naoVistas, aoLado, abertas }: {
  conversations: Conversation[]; perfis: Projects["profiles"]; projetos?: Projects["projects"];
  mostrarProjeto?: boolean; abrir: (id: string) => void; vazio: string;
  /** Conversa aberta ao lado (web): fica marcada na lista. */
  ativa?: string | null;
  /** Conversas com aviso que você ainda não viu — o que separa "finalizado" do neutro, como no PC. */
  naoVistas?: ReadonlySet<string>;
  /** Web: abre a conversa ao lado das que já estão abertas. */
  aoLado?: (id: string) => void;
  abertas?: readonly string[];
}) {
  if (conversations.length === 0) return <Vazio>{vazio}</Vazio>;
  return <ul className="m-lista">{conversations.map(c => {
    const aprovar = Boolean(c.capabilities?.approve);
    // Mesmo status da lateral do PC (trabalhando, aprovar, interrompido, finalizado) e mesmo selo.
    const status = statusDaConversa(
      { state: (aprovar ? "approval_required" : c.state) as TerminalSession["state"], notice: (c.notice ?? undefined) as TerminalSession["notice"] },
      Boolean(naoVistas?.has(c.id)),
    );
    const conta = perfis.find(p => p.id === c.profile_id)?.name;
    const projeto = mostrarProjeto ? projetos.find(p => p.id === c.project_id)?.name : null;
    const detalhe = [STATES[c.state ?? ""] ?? "Histórico", NOME_DO_AGENTE[c.provider ?? ""] ?? c.provider, conta]
      .filter(Boolean).join(" · ");
    return <li key={c.id}>
      <button type="button" className={`m-card glass glass-hover${c.id === ativa ? " m-card-ativo" : ""}`} data-status={status} onClick={() => abrir(c.id)}
        aria-label={`Abrir conversa ${c.title}`} aria-current={c.id === ativa ? "true" : undefined}>
        <span className="m-card-icone">
          {c.provider ? <AgentIcon provider={c.provider} size={20} /> : <PlayIcon aria-hidden className="h-5 w-5" />}
        </span>
        <span className="m-card-corpo">
          {projeto && <span className="m-card-projeto"><FolderIcon aria-hidden className="h-3 w-3 shrink-0" /><span className="truncate">{projeto}</span></span>}
          <span className="m-card-titulo">{c.title}</span>
          <span className="m-card-sub">
            <span className={`m-dot ${tomDoEstado(c.state, aprovar)}`} aria-hidden />
            {detalhe}
          </span>
        </span>
        <span className="m-card-lado">
          <EtiquetaDoStatus status={status} />
          {haQuanto(c.updated_at_ms) && <time className="m-card-tempo">{haQuanto(c.updated_at_ms)}</time>}
        </span>
      </button>
      {aoLado && !abertas?.includes(c.id) && <button type="button" className="m-card-aolado" onClick={() => aoLado(c.id)}
        aria-label={`Abrir ${c.title} ao lado`} title="Abrir ao lado">+</button>}
    </li>;
  })}</ul>;
}

/** A lista em duas partes: o que tem sessão aberta no PC agora (dá para responder na hora) e o
 *  histórico (fechadas — abrir uma permite retomar). Antes vinha tudo misturado, ordenado só por data. */
export function ConversasPorEstado(props: Parameters<typeof ConversationList>[0]) {
  if (props.conversations.length === 0) return <ConversationList {...props} />;
  const abertas = props.conversations.filter(c => c.live);
  const fechadas = props.conversations.filter(c => !c.live);
  return <>
    <h3 className="m-subtitulo"><span className="m-dot m-dot-ativo" aria-hidden />Abertas no PC<span className="m-subtitulo-total">{abertas.length}</span></h3>
    <ConversationList {...props} conversations={abertas} vazio="Nenhuma conversa aberta no PC agora." />
    {fechadas.length > 0 && <>
      <h3 className="m-subtitulo"><span className="m-dot m-dot-parado" aria-hidden />Histórico<span className="m-subtitulo-total">{fechadas.length}</span></h3>
      <ConversationList {...props} conversations={fechadas} vazio="" />
    </>}
  </>;
}

/** Conversas que você ocultou: recolhidas no fim da lista. Abrir uma mostra o botão de reabrir. */
export function Ocultas({ conversas, perfis, projetos, mostrarProjeto = false, abrir, ativa = null }: {
  conversas: Conversation[]; perfis: Projects["profiles"]; projetos?: Projects["projects"];
  mostrarProjeto?: boolean; abrir: (id: string) => void; ativa?: string | null;
}) {
  const [aberto, setAberto] = useState(false);
  if (conversas.length === 0) return null;
  return <div className="m-ocultas">
    <button type="button" className="m-ocultas-botao" aria-expanded={aberto} onClick={() => setAberto(valor => !valor)}>
      <ArchiveIcon aria-hidden className="h-3.5 w-3.5" />
      <span>Ocultas ({conversas.length})</span>
      <span className="m-ocultas-acao">{aberto ? "esconder" : "ver"}</span>
    </button>
    {aberto && <>
      <p className="m-dica">Abra uma conversa e toque em <ArchiveIcon aria-hidden className="inline h-3 w-3" /> para ela voltar à lista.</p>
      <ConversationList conversations={conversas} perfis={perfis} projetos={projetos} mostrarProjeto={mostrarProjeto}
        abrir={abrir} ativa={ativa} vazio="" />
    </>}
  </div>;
}

export function NovaSessao({ project, catalog, onCriada, classeBotao = "w-full" }: {
  project: { id: string; name: string }; catalog: Projects; onCriada: () => Promise<void>;
  /** Classe do botão fechado: no celular ocupa a largura toda; na lateral da web divide a linha. */
  classeBotao?: string;
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

  if (!aberto) return <Button variant="primary" className={classeBotao} onClick={() => setAberto(true)}>
    <ChatIcon aria-hidden className="h-4 w-4" />Nova sessão
  </Button>;
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

/** Ritmo do polling com o agente ativo. 5 s faz a conversa parecer travada; 1,2 s parece ao vivo.
 *  Barato: com o `ETag`, consulta sem novidade volta 304 sem corpo. */
const POLL_ATIVO_MS = 1_200;
/** Parado, ainda curto: uma resposta digitada no PC aparece aqui em poucos segundos. */
const POLL_PARADO_MS = 3_000;

/** Quanto esperar a mensagem enviada aparecer no transcript antes de desistir do balão otimista.
 *  Sem isto, uma mensagem que a CLI não aceitou deixava o "trabalhando" girando para sempre. */
const LIMITE_DE_CONFIRMACAO_MS = 120_000;

/** Distância do fim (px) que ainda conta como "lendo o fim": a tela acompanha o que chega. */
const PERTO_DO_FIM_PX = 120;

/** O servidor numera as mensagens (`<conversa>:<n>`) na ordem do transcript. */
function indiceDaMensagem(id: string): number {
  const n = Number(id.slice(id.lastIndexOf(":") + 1));
  return Number.isFinite(n) ? n : -1;
}

/** Junta páginas da conversa pela numeração do servidor: sem repetir e na ordem do transcript. */
export function juntarPaginas(...paginas: Mensagem[][]): Mensagem[] {
  const porIndice = new Map<number, Mensagem>();
  for (const pagina of paginas) for (const mensagem of pagina) porIndice.set(indiceDaMensagem(mensagem.id), mensagem);
  return [...porIndice.entries()].sort((a, b) => a[0] - b[0]).map(([, mensagem]) => mensagem);
}

/** Distância do topo (px) em que rolar para cima já busca as mensagens anteriores. */
const PERTO_DO_TOPO_PX = 160;

/** O que a conversa desenha, já agrupado: ações seguidas viram um bloco só. */
type Bloco =
  | { tipo: "fala"; mensagem: Mensagem }
  | { tipo: "acoes"; id: string; acoes: Mensagem[] }
  | { tipo: "comando"; mensagem: Mensagem }
  | { tipo: "aviso"; mensagem: Mensagem };

export function agruparMensagens(mensagens: Mensagem[]): Bloco[] {
  const blocos: Bloco[] = [];
  for (const mensagem of mensagens) {
    const tipo = mensagem.kind ?? "text";
    if (tipo === "tool") {
      const anterior = blocos[blocos.length - 1];
      if (anterior?.tipo === "acoes") anterior.acoes.push(mensagem);
      else blocos.push({ tipo: "acoes", id: mensagem.id, acoes: [mensagem] });
    } else if (tipo === "command") blocos.push({ tipo: "comando", mensagem });
    else if (tipo === "notice") blocos.push({ tipo: "aviso", mensagem });
    else blocos.push({ tipo: "fala", mensagem });
  }
  return blocos;
}

const chaveDoBloco = (bloco: Bloco) => bloco.tipo === "acoes" ? bloco.id : bloco.mensagem.id;

/** Quem rola a conversa: a lista de mensagens (web) ou a página inteira (celular). */
function rolagemDe(elemento: HTMLElement | null): HTMLElement | null {
  for (let atual = elemento?.parentElement ?? null; atual; atual = atual.parentElement) {
    const { overflowY } = getComputedStyle(atual);
    if (overflowY === "auto" || overflowY === "scroll") return atual;
  }
  return (document.scrollingElement as HTMLElement | null) ?? null;
}

function pertoDoFim(rolagem: HTMLElement | null): boolean {
  if (!rolagem) return true;
  return rolagem.scrollHeight - rolagem.scrollTop - rolagem.clientHeight < PERTO_DO_FIM_PX;
}

export function ConversationDetail({ conversation: daLista, refresh, abrirConversa }: {
  conversation: Conversation;
  refresh: () => Promise<void>;
  /** Retomar uma conversa do histórico cria a conversa do OMNI com outro id: a tela vai para ela. */
  abrirConversa?: (id: string) => void;
}) {
  const chaveRascunho = `omni-rascunho:${daLista.id}`;
  const [data, setData] = useState<Timeline | null>(null);
  // O rascunho sobrevive ao refresh da página: atualizar no meio da digitação não apaga nada.
  const [text, setText] = useState(() => lerSessao(chaveRascunho) ?? "");
  const [anexos, setAnexos] = useState<Anexo[]>([]);
  const [arrastando, setArrastando] = useState(false);
  const telaRef = useRef<HTMLElement>(null);
  const [error, setError] = useState<string | null>(null);
  // Separado de `error`: o polling limpa `error` a cada ciclo bem-sucedido, e uma recusa da fila
  // aparecia e sumia no mesmo instante. Este só limpa no próximo envio.
  const [falhaEnvio, setFalhaEnvio] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [editandoNome, setEditandoNome] = useState(false);
  const [parando, setParando] = useState(false);
  const [bifurcando, setBifurcando] = useState(false);
  const vozInstalada = useVozInstalada();
  // Páginas antigas buscadas por quem rola para cima. Ficam acima das recentes, na mesma rolagem:
  // antes "Mensagens anteriores" trocava a tela por outra página e era preciso paginar de volta.
  const [antigas, setAntigas] = useState<Mensagem[]>([]);
  // `undefined` = ainda não buscou nenhuma (vale o `prev_cursor` da página ao vivo); `null` = chegou ao início.
  const [cursorAntigas, setCursorAntigas] = useState<number | null | undefined>(undefined);
  const [buscandoAntigas, setBuscandoAntigas] = useState(false);
  const buscandoAntigasRef = useRef(false);
  // Altura da conversa antes de pôr as antigas em cima: a tela fica onde quem lia estava.
  const ancora = useRef<{ altura: number; topo: number } | null>(null);
  const [enviado, setEnviado] = useState<Enviado | null>(null);
  // Mensagens mandadas com o agente trabalhando: estão na fila da CLI e entram quando o turno acabar.
  const [fila, setFila] = useState<Enviado[]>([]);
  /** O último texto mandado, para voltar ao campo quando o "parar" o tira do campo da CLI. */
  const ultimoTexto = useRef("");
  const [novidades, setNovidades] = useState(false);
  const pending = useRef<{ signature: string; key: string; revision: string } | null>(null);
  const trabalhandoDesde = useRef<number | null>(null);
  const fim = useRef<HTMLDivElement>(null);
  const grudado = useRef(true);
  const urlCarregada = useRef<string | null>(null);
  const anexosVivos = useRef<Anexo[]>([]);
  anexosVivos.current = anexos;
  const enviadoVivo = useRef<Enviado | null>(null);
  enviadoVivo.current = enviado;

  // O estado que veio com a timeline é mais novo que o da lista (que anda a cada 5 s). Conversa só
  // do histórico não tem estado vivo; fica o da lista.
  const conversation = data?.conversation && data.conversation.id === daLista.id ? { ...daLista, ...data.conversation } : daLista;

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
  const url = base;

  /** Lê a timeline. Página nova (ou componente recém-montado) vem inteira; depois só se mudou. */
  const ler = useCallback(async () => {
    if (urlCarregada.current !== url) esquecerVersao(url);
    const resultado = await requestSeMudou<Timeline>(url);
    urlCarregada.current = url;
    if (resultado) setData(resultado);
  }, [url]);

  usePoll(async () => { await ler(); setError(null); }, reason => setError(String(reason)), [ler],
    ativo ? POLL_ATIVO_MS : POLL_PARADO_MS);

  // O agente terminou (ou começou): a lista ao lado também precisa saber, sem esperar o ciclo dela.
  const estadoAnterior = useRef(conversation.state);
  useEffect(() => {
    if (estadoAnterior.current !== conversation.state) {
      estadoAnterior.current = conversation.state;
      void refresh().catch(() => undefined);
    }
  }, [conversation.state, refresh]);

  const recentes = useMemo(() => data?.timeline.messages ?? [], [data]);
  const mensagens = useMemo(() => antigas.length ? juntarPaginas(antigas, recentes) : recentes, [antigas, recentes]);
  // Com antigas na tela, o que sai da janela ao vivo (a conversa andou) entra nelas: não abre buraco.
  useEffect(() => {
    if (antigas.length && recentes.length) setAntigas(atual => juntarPaginas(atual, recentes));
  }, [recentes]); // eslint-disable-line react-hooks/exhaustive-deps
  const anteriorA = antigas.length ? cursorAntigas ?? null : data?.timeline.prev_cursor ?? null;

  const buscarAntigas = useCallback(async () => {
    if (anteriorA === null || buscandoAntigasRef.current) return;
    buscandoAntigasRef.current = true;
    setBuscandoAntigas(true);
    try {
      const pagina = await request<Timeline>(`${base}?cursor=${anteriorA}`);
      const rolagem = rolagemDe(fim.current);
      if (rolagem) ancora.current = { altura: rolagem.scrollHeight, topo: rolagem.scrollTop };
      setAntigas(atual => juntarPaginas(pagina.timeline.messages, atual, recentes));
      setCursorAntigas(pagina.timeline.prev_cursor ?? null);
    } catch (motivo) {
      setError(String(motivo));
    } finally {
      buscandoAntigasRef.current = false;
      setBuscandoAntigas(false);
    }
  }, [anteriorA, base, recentes]);
  const buscarAntigasRef = useRef(buscarAntigas);
  buscarAntigasRef.current = buscarAntigas;

  // As antigas entraram em cima: compensa a altura nova para o que estava na tela não sair do lugar.
  useLayoutEffect(() => {
    const antes = ancora.current;
    const rolagem = rolagemDe(fim.current);
    if (!antes || !rolagem) return;
    ancora.current = null;
    rolagem.scrollTop = antes.topo + (rolagem.scrollHeight - antes.altura);
  }, [antigas]);
  const blocos = useMemo(() => agruparMensagens(mensagens), [mensagens]);
  // Blocos que chegaram depois da primeira leitura entram animados; o que já estava na tela ao abrir
  // não. Fala do usuário não: ela substitui o balão otimista, que já entrou animado.
  const conhecidos = useRef<Set<string> | null>(null);
  const entraram = useRef(new Set<string>());
  if (data) {
    if (!conhecidos.current) conhecidos.current = new Set(blocos.map(chaveDoBloco));
    else {
      // As anteriores, buscadas ao rolar, entram antes de todas as conhecidas: essas não animam.
      let depois = conhecidos.current.size === 0;
      for (const bloco of blocos) {
        const chave = chaveDoBloco(bloco);
        if (conhecidos.current.has(chave)) { depois = true; continue; }
        conhecidos.current.add(chave);
        if (depois && (bloco.tipo !== "fala" || bloco.mensagem.role !== "user")) entraram.current.add(chave);
      }
    }
  }
  // Só a primeira fala do agente em cada turno leva "Claude · 17:54"; as seguintes (falas curtas
  // entre ações) seguem coladas, sem repetir o cabeçalho.
  // "Hoje", "Ontem" ou a data entre mensagens de dias diferentes — numa conversa longa é o que dá
  // noção de tempo sem olhar hora por hora.
  const separadores = useMemo(() => {
    const mapa = new Map<number, string>();
    let anterior = "";
    blocos.forEach((bloco, indice) => {
      const quando = bloco.tipo === "acoes" ? bloco.acoes[0]?.timestamp : bloco.mensagem.timestamp;
      const data = quando ? new Date(quando) : null;
      if (!data || Number.isNaN(data.getTime())) return;
      const chave = data.toDateString();
      if (chave === anterior) return;
      anterior = chave;
      const hoje = new Date();
      const ontem = new Date(hoje.getTime() - 86_400_000);
      mapa.set(indice, chave === hoje.toDateString() ? "Hoje" : chave === ontem.toDateString() ? "Ontem"
        : data.toLocaleDateString("pt-BR", { day: "2-digit", month: "long", year: data.getFullYear() === hoje.getFullYear() ? undefined : "numeric" }));
    });
    return mapa;
  }, [blocos]);

  const continuacoes = useMemo(() => {
    const indices = new Set<number>();
    let jaFalou = false;
    blocos.forEach((bloco, indice) => {
      if (bloco.tipo !== "fala") return;
      if (bloco.mensagem.role === "user") { jaFalou = false; return; }
      if (jaFalou) indices.add(indice);
      jaFalou = true;
    });
    return indices;
  }, [blocos]);
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
    const chegou = mensagens.some(m => m.role === "user" && (m.kind ?? "text") === "text"
      && (m.text.trim() === enviado.texto.trim() || indiceDaMensagem(m.id) > enviado.base));
    const acao = data?.actions.find(a => a.id === enviado.acao);
    if (chegou) { descartarEnviado(null); return; }
    if (acao?.state === "rejected") descartarEnviado(`Não foi enviado: ${acao.error ?? "o agente recusou a entrada"}`);
  }, [data, enviado, mensagens, descartarEnviado]);

  // Item da fila sai quando a mensagem aparece no transcript (a CLI a consumiu) ou é recusado.
  useEffect(() => {
    if (fila.length === 0) return;
    const restantes = fila.filter((item) => {
      const chegou = mensagens.some(m => m.role === "user" && (m.kind ?? "text") === "text"
        && indiceDaMensagem(m.id) > item.base && m.text.trim() === item.texto.trim());
      const acao = data?.actions.find(a => a.id === item.acao);
      if (acao?.state === "rejected") setFalhaEnvio(`Não entrou na fila: ${acao.error ?? "o agente recusou a entrada"}`);
      // Fila parada há muito tempo (o turno caiu, a sessão fechou): some em vez de mentir.
      return !chegou && acao?.state !== "rejected" && Date.now() - item.em < 30 * 60_000;
    });
    if (restantes.length !== fila.length) setFila(restantes);
  }, [data, fila, mensagens]);

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

  // Saber se quem lê está no fim. Lendo mensagens antigas, a tela não pode pular sozinha para baixo
  // a cada novidade — antes pulava, e era impossível ler o começo de uma resposta longa.
  useEffect(() => {
    const rolagem = rolagemDe(fim.current);
    const alvo: HTMLElement | Window | null = rolagem === document.scrollingElement ? window : rolagem;
    if (!alvo) return;
    const aoRolar = () => {
      grudado.current = pertoDoFim(rolagem);
      if (grudado.current) setNovidades(false);
      // Chegou ao topo: as anteriores entram sozinhas, como num chat.
      else if (rolagem && rolagem.scrollTop < PERTO_DO_TOPO_PX) void buscarAntigasRef.current();
    };
    alvo.addEventListener("scroll", aoRolar, { passive: true });
    return () => alvo.removeEventListener("scroll", aoRolar);
  }, [data !== null]);

  // Rola só quem rola a conversa: o `scrollIntoView` também mexia na página e, com o teclado aberto,
  // empurrava a barra de cima para fora da tela.
  const irParaOFim = useCallback((suave = false) => {
    const rolagem = rolagemDe(fim.current);
    rolagem?.scrollTo?.({ top: rolagem.scrollHeight, behavior: suave ? "smooth" : "auto" });
    grudado.current = true;
    setNovidades(false);
  }, []);

  // Chegou coisa nova: acompanha se estava no fim; senão avisa com o botão "novas mensagens".
  useEffect(() => {
    if (grudado.current) irParaOFim();
    else if (ultimaId) setNovidades(true);
  }, [ultimaId, ativo, irParaOFim]);

  // Resposta crescendo na mesma mensagem, ações entrando no mesmo bloco, imagem carregando, teclado
  // abrindo: nada disso troca o `ultimaId`. Quem estava no fim continua no fim.
  useEffect(() => {
    const lista = fim.current?.parentElement;
    const rolagem = rolagemDe(fim.current);
    if (!lista || !rolagem) return;
    const seguir = () => { if (grudado.current) irParaOFim(); };
    const mudancas = new MutationObserver(seguir);
    mudancas.observe(lista, { childList: true, subtree: true, characterData: true });
    const tamanho = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(seguir);
    tamanho?.observe(rolagem === document.scrollingElement ? lista : rolagem);
    lista.addEventListener("load", seguir, true);
    return () => { mudancas.disconnect(); tamanho?.disconnect(); lista.removeEventListener("load", seguir, true); };
  }, [data !== null, irParaOFim]); // eslint-disable-line react-hooks/exhaustive-deps

  function adicionar(arquivos: File[]) {
    if (arquivos.length === 0) return;
    setFalhaEnvio(null);
    setAnexos(lista => [...lista, ...arquivos.map(criarAnexo)]);
  }

  // Arquivos entregues por fora dos eventos do navegador (o arrastar do app do PC) e o colar sem foco
  // em lugar nenhum (Ctrl+V com a conversa na tela).
  const adicionarRef = useRef(adicionar);
  adicionarRef.current = adicionar;
  useEffect(() => {
    const tela = telaRef.current;
    if (!tela) return;
    const anexar = (evento: Event) => adicionarRef.current((evento as CustomEvent<File[]>).detail ?? []);
    const arrastar = (evento: Event) => setArrastando(Boolean((evento as CustomEvent<boolean>).detail));
    const colarSolto = (evento: ClipboardEvent) => {
      // Já tratado (o campo de texto ou a própria conversa colaram): não anexa duas vezes.
      if (evento.defaultPrevented) return;
      const alvo = evento.target as HTMLElement | null;
      if (alvo && alvo !== document.body && alvo.closest("input, textarea, [contenteditable], .xterm")) return;
      if (!tela.isConnected || tela.closest(".invisible")) return;
      const arquivos = Array.from(evento.clipboardData?.files ?? []);
      if (arquivos.length === 0) return;
      evento.preventDefault();
      adicionarRef.current(arquivos);
    };
    tela.addEventListener(EVENTO_ANEXAR, anexar);
    tela.addEventListener(EVENTO_ARRASTANDO, arrastar);
    document.addEventListener("paste", colarSolto);
    return () => {
      tela.removeEventListener(EVENTO_ANEXAR, anexar);
      tela.removeEventListener(EVENTO_ARRASTANDO, arrastar);
      document.removeEventListener("paste", colarSolto);
    };
  }, []);

  function remover(id: string) {
    setAnexos(lista => {
      const saindo = lista.find(a => a.id === id);
      if (saindo) descartarAnexo(saindo);
      return lista.filter(a => a.id !== id);
    });
  }

  const marcar = (id: string, mudanca: Partial<Anexo>) =>
    setAnexos(lista => lista.map(a => (a.id === id ? { ...a, ...mudanca } : a)));

  async function post(kind: "prompt" | "aprovar" | "escolher" | "modo" | "ajustes", body: Record<string, unknown>) {
    const capability = conversation.capabilities!;
    const signature = JSON.stringify([kind, body]);
    if (pending.current?.signature !== signature) pending.current = { signature, key: actionKey(), revision: capability.revision };
    const enviar = () => request<{ id?: string }>(`/conversas/${encodeURIComponent(conversation.id)}/${kind}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Idempotency-Key": pending.current!.key, "If-Match": pending.current!.revision },
      body: JSON.stringify(body),
    });
    let acao: { id?: string };
    try {
      acao = await enviar();
    } catch (reason) {
      // Modo e ajustes levam a um estado absoluto ("fique em plano"), não respondem a um diálogo:
      // tela redesenhada desde a última leitura (o próprio rodapé do modo muda a cada troca) não
      // os torna perigosos. Relê a versão da tela e tenta uma vez — antes isso virava erro e
      // exigia um segundo clique. Prompt e aprovação continuam recusando: ali o If-Match protege.
      // Escolha também, desde que a pergunta na tela seja a mesma: marcar uma caixa redesenha o menu
      // e o clique seguinte chegava com a versão velha e sumia. Pergunta trocada continua recusando.
      // Na escolha, 409 (menu não lido naquele quadro, a TUI no meio de um redesenho) também relê.
      const relerEscolha = kind === "escolher" && (reason instanceof ApiError && reason.status === 409);
      if (!relerEscolha && !(reason instanceof ApiError && reason.status === 412 && (kind === "modo" || kind === "ajustes" || kind === "escolher"))) throw reason;
      if (relerEscolha) await new Promise((r) => setTimeout(r, 400));
      const atual = await request<Timeline>(`/conversas/${encodeURIComponent(conversation.id)}/timeline`);
      const revisao = atual.conversation?.capabilities?.revision;
      if (!revisao) throw reason;
      if (kind === "escolher" && atual.conversation?.capabilities?.escolha?.pergunta !== capability.escolha?.pergunta) throw reason;
      pending.current = { signature, key: actionKey(), revision: revisao };
      acao = await enviar();
    }
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
    try { await post("aprovar", { permitir }); await Promise.all([ler(), refresh()]); }
    catch (reason) { falhou(reason); }
    finally { setBusy(false); }
  }

  /** Responde um menu da CLI pelo número da opção; `null` fecha o menu (Esc); `"avancar"` é o Tab
   *  do marcar-várias. */
  async function escolher(opcao: number | null | "avancar" | "voltar") {
    const antes = conversation.capabilities?.escolha;
    if (!antes || busy) return;
    setBusy(true); setError(null); setFalhaEnvio(null);
    try {
      await post("escolher", opcao === "avancar" ? { avancar: true } : opcao === "voltar" ? { voltar: true } : { opcao });
      // A resposta vai por fila e a tela do PC redesenha logo depois: relê em passos curtos até a
      // pergunta mudar. Esperar o ciclo normal (3 s com a pergunta aberta) era o atraso do clique.
      const assinatura = JSON.stringify(antes);
      for (let tentativa = 0; tentativa < 15; tentativa += 1) {
        await new Promise((r) => setTimeout(r, 100));
        const lido = await request<Timeline>(url);
        setData(lido);
        if (JSON.stringify(lido.conversation?.capabilities?.escolha ?? null) !== assinatura) break;
      }
      void refresh().catch(() => undefined);
    }
    catch (reason) { falhou(reason); }
    finally { setBusy(false); }
  }

  /** Alterna entre plano e automático — o que o shift+tab faz no terminal do PC. */
  async function trocarModo(alvo: "plan" | "auto") {
    if (!conversation.capabilities?.prompt || busy) return;
    setBusy(true); setError(null); setFalhaEnvio(null);
    try { await post("modo", { modo: alvo }); await Promise.all([ler(), refresh()]); }
    catch (reason) { falhou(reason); }
    finally { setBusy(false); }
  }

  /** Conta, modelo e esforço: o engine reabre a conversa com `--resume` e os ajustes novos. */
  async function ajustar(ajustes: Ajustes) {
    if (!conversation.capabilities?.prompt || busy) return;
    setBusy(true); setError(null); setFalhaEnvio(null);
    try { await post("ajustes", { ...ajustes }); await Promise.all([ler(), refresh()]); }
    catch (reason) { falhou(reason); throw reason; }
    finally { setBusy(false); }
  }

  /** Conversa sem sessão: abre uma no PC com `--resume`, já com conta, modelo e esforço. A fila
   *  abre em segundo plano, então espera a sessão aparecer antes de trocar de tela. */
  async function retomar(ajustes: Ajustes) {
    setBusy(true); setError(null); setFalhaEnvio(null);
    try {
      const acao = await request<{ conversation_id?: string }>(`/conversas/${encodeURIComponent(conversation.id)}/retomar`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": actionKey() },
        body: JSON.stringify({ ...ajustes }),
      });
      const destino = acao.conversation_id || conversation.id;
      for (let tentativa = 0; tentativa < 30; tentativa += 1) {
        await new Promise((resolve) => setTimeout(resolve, 700));
        const lido = await request<Timeline>(`/conversas/${encodeURIComponent(destino)}/timeline`).catch(() => null);
        if (lido?.conversation?.capabilities) break;
      }
      await refresh();
      if (destino !== conversation.id && abrirConversa) abrirConversa(destino);
      else await ler();
    } catch (reason) { setError(String(reason)); throw reason; }
    finally { setBusy(false); }
  }

  // `@` no campo: arquivos da pasta do projeto, filtrados pelo engine.
  const buscarArquivos = useCallback(async (busca: string) => {
    const resposta = await request<{ arquivos: string[] }>(
      `/conversas/${encodeURIComponent(conversation.id)}/arquivos?q=${encodeURIComponent(busca)}`);
    return Array.isArray(resposta?.arquivos) ? resposta.arquivos : [];
  }, [conversation.id]);

  const listarComandos = useCallback(
    () => request<Comando[]>(`/conversas/${encodeURIComponent(conversation.id)}/comandos`),
    [conversation.id]);

  /** O Esc do terminal: para o agente no meio do turno, como no PC. */
  async function interromper() {
    setError(null);
    try {
      const parou = await request<{ limpou?: boolean }>(`/conversas/${encodeURIComponent(conversation.id)}/parar`, { method: "POST" });
      // A CLI devolveu o prompt ao campo dela e o engine o apagou lá: ele volta para este campo.
      if (parou?.limpou && ultimoTexto.current) {
        const texto = ultimoTexto.current;
        setText((atual) => atual.trim() ? atual : texto);
        descartarEnviado(null);
      }
      await ler();
    }
    catch (reason) { setError(String(reason)); }
  }

  /** O "Bifurcar" da lateral do PC: conversa nova com todo o histórico desta, e a tela vai para ela. */
  async function bifurcar() {
    setBifurcando(true);
    try {
      const nova = await request<{ id: string | null }>(`/conversas/${encodeURIComponent(conversation.id)}/bifurcar`, { method: "POST" });
      await refresh();
      if (nova.id) abrirConversa?.(nova.id);
    } catch (reason) { falhou(reason); } finally { setBifurcando(false); }
  }

  /** Tira da lista (ou devolve). Não apaga nada: a conversa vai para a seção Ocultas. */
  async function ocultar(oculta: boolean) {
    try {
      await request(`/conversas/${encodeURIComponent(conversation.id)}/ocultar`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ oculta }),
      });
      await refresh();
    } catch (reason) { falhou(reason); }
  }

  async function renomear(nome: string) {
    const limpo = nome.trim();
    if (!limpo || limpo === conversation.title) return;
    try {
      await request(`/conversas/${encodeURIComponent(conversation.id)}/nome`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nome: limpo }),
      });
      await Promise.all([ler(), refresh()]);
    } catch (reason) { falhou(reason); }
  }

  async function enviarPrompt() {
    if (!conversation.capabilities || busy) return;
    // Agente no meio do turno: a mensagem vai para a fila da CLI, como digitar no terminal.
    const paraFila = !conversation.capabilities.prompt && Boolean(conversation.capabilities.enfileirar);
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
      const acao = await post("prompt", paraFila ? { texto, fila: true } : { texto });
      const item: Enviado = {
        texto, em: Date.now(), acao: acao?.id ?? null,
        base: Math.max(-1, ...mensagens.map(m => indiceDaMensagem(m.id))),
        // As prévias passam para o balão otimista; quem revoga é ele, quando o transcript chegar.
        anexos: lista.map(a => ({ nome: a.arquivo.name || "anexo", previa: a.previa })),
      };
      if (paraFila) setFila((atual) => [...atual, item]); else setEnviado(item);
      ultimoTexto.current = text;
      setText("");
      setAnexos([]);
      grudado.current = true;
      await Promise.all([ler(), refresh()]);
    } catch (reason) {
      falhou(reason);
    } finally { setBusy(false); }
  }

  const capability = conversation.capabilities;
  const temConteudo = text.trim().length > 0 || anexos.length > 0;
  const anexoGrande = anexos.some(a => a.arquivo.size > ANEXO_MAX_BYTES);
  const podeEnviar = Boolean(capability?.prompt || capability?.enfileirar) && !busy && temConteudo && !anexoGrande;
  const timeline = data?.timeline;
  const ultimoBloco = blocos[blocos.length - 1];

  function renderizarBloco(bloco: Bloco, indice: number) {
    const entra = entraram.current.has(chaveDoBloco(bloco));
    if (bloco.tipo === "acoes") {
      return <BlocoDeAcoes key={bloco.id} acoes={bloco.acoes} provider={bloco.acoes[0]?.provider}
        aoVivo={ativo && bloco === ultimoBloco} entra={entra} />;
    }
    if (bloco.tipo === "comando") return <LinhaDeComando key={bloco.mensagem.id} texto={bloco.mensagem.text} entra={entra} />;
    if (bloco.tipo === "aviso") return <LinhaDeAviso key={bloco.mensagem.id} texto={bloco.mensagem.text} entra={entra} />;
    const message = bloco.mensagem;
    return <MessageBubble key={message.id} entra={entra} lado={message.role === "user" ? "user" : "agent"}
      provider={message.provider} texto={message.text} horario={message.timestamp} continua={continuacoes.has(indice)}
      imagens={message.imagens ? { conversa: conversation.id, n: indiceDaMensagem(message.id), total: message.imagens } : undefined} />;
  }

  return <section className="chat-tela" ref={telaRef}
    onDragEnter={(evento) => { if (temArquivos(evento.dataTransfer)) { evento.preventDefault(); setArrastando(true); } }}
    onDragOver={(evento) => { if (temArquivos(evento.dataTransfer)) { evento.preventDefault(); evento.dataTransfer.dropEffect = "copy"; } }}
    onDragLeave={(evento) => { if (!evento.currentTarget.contains(evento.relatedTarget as Node | null)) setArrastando(false); }}
    onDrop={(evento) => {
      const arquivos = Array.from(evento.dataTransfer?.files ?? []);
      setArrastando(false);
      if (arquivos.length === 0) return;
      evento.preventDefault();
      adicionar(arquivos);
    }}
    onPaste={(evento) => {
      // O campo de texto já trata o próprio colar; aqui é o colar com o foco em outro ponto da conversa.
      if ((evento.target as HTMLElement).id === "reply") return;
      const arquivos = Array.from(evento.clipboardData?.files ?? []);
      if (arquivos.length === 0) return;
      evento.preventDefault();
      adicionar(arquivos);
    }}>
    {arrastando && (
      <div className="chat-soltar" aria-hidden>
        <span><AttachmentIcon className="h-5 w-5" />Solte para anexar à conversa</span>
      </div>
    )}
    {anteriorA !== null && (
      <Button variant="ghost" size="sm" className="m-paginar" disabled={buscandoAntigas} onClick={() => void buscarAntigas()}>
        {buscandoAntigas ? "Carregando…" : "Mensagens anteriores"}
      </Button>
    )}
    {!!timeline?.unavailable_segments.length && <p className="m-aviso">Parte do histórico está indisponível; nenhum transcript foi associado por aproximação.</p>}

    <div className="chat" aria-label="Mensagens">
      {!data && <Vazio>Carregando conversa…</Vazio>}
      {data && mensagens.length === 0 && !enviado && !ativo && !timeline?.unavailable_segments.length &&
        <Vazio>Nenhuma mensagem ainda. Mande o primeiro prompt abaixo.</Vazio>}
      {blocos.map((bloco, indice) => {
        const dia = separadores.get(indice);
        const conteudo = renderizarBloco(bloco, indice);
        // Chave pelo bloco, não pela posição: com as antigas entrando em cima, a posição muda.
        const chave = chaveDoBloco(bloco);
        return dia ? <div key={`dia-${chave}`} className="chat-grupo"><p className="chat-dia"><span>{dia}</span></p>{conteudo}</div> : conteudo;
      })}
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
      {capability?.escolha && <CartaoDePergunta key={capability.escolha.pergunta} escolha={capability.escolha} provider={conversation.provider} busy={busy}
        onEscolher={(opcao) => void escolher(opcao)} onAvancar={() => void escolher("avancar")} onVoltar={() => void escolher("voltar")} />}
      {ativo && !capability?.approve &&
        <AgentWorking desde={trabalhandoDesde.current ?? Date.now()} provider={conversation.provider} tokens={conversation.tokens ?? null} />}
      {fila.length > 0 && (
        <div className="chat-fila" aria-label="Mensagens na fila">
          <p className="chat-fila-rotulo">Na fila · entram quando o agente terminar</p>
          {fila.map((item) => (
            <MessageBubble key={item.em} lado="user" pendente="na fila" texto={item.texto}
              anexosLocais={item.anexos.length ? item.anexos : undefined} />
          ))}
        </div>
      )}
      <div ref={fim} />
    </div>

    {novidades && (
      <button type="button" className="chat-novidades" onClick={() => irParaOFim(true)}>Novas mensagens ↓</button>
    )}

    {(falhaEnvio || error) && <p role="alert" className="m-alerta">{falhaEnvio ?? error}</p>}
    {anexoGrande && <p className="m-aviso">Tire o anexo acima de 25 MB para enviar.</p>}
    {/* O motivo genérico só aparece com o agente parado: trabalhando, o "ocupado" é esperado e o
        indicador acima já explica. */}
    {!ativo && capability?.reason && <p className="m-dica">{capability.reason}</p>}

    <Composer texto={text} onTexto={setText} anexos={anexos} onAdicionar={adicionar} onRemover={remover}
      onEnviar={() => void enviarPrompt()} podeEnviar={podeEnviar} ocupado={busy}
      placeholder={!capability?.prompt ? (capability?.escolha ? "Responda a pergunta acima para continuar"
        : capability?.enfileirar ? "Agente trabalhando… sua mensagem entra na fila"
        : trabalhando ? "Agente trabalhando… escreva a próxima mensagem"
        : conversation.capabilities ? "Sem sessão ativa" : "Conversa fechada — escolha conta, modelo e esforço e retome abaixo") : "Mensagem para o agente…"}
      toolbar={editandoNome ? <RenomearConversa nome={conversation.title} onFechar={() => setEditandoNome(false)}
        onSalvar={(nome) => { setEditandoNome(false); void renomear(nome); }} /> : null}
      chips={<>
        {(conversation.live || conversation.capabilities) ? (
          <AjustesDaConversa conversaId={conversation.id} pronto={Boolean(conversation.capabilities?.prompt) && !busy}
            onAplicar={ajustar} />
        ) : (
          <AjustesDaConversa key="retomar" conversaId={conversation.id} pronto={!busy} onAplicar={ajustar} onRetomar={retomar} />
        )}
        <button type="button" className="composer-botao" title="Renomear conversa" aria-label="Renomear conversa"
          onClick={() => setEditandoNome(true)}>
          <EditIcon aria-hidden className="h-4 w-4" />
        </button>
        <ExportarConversa conversaId={conversation.id} provider={conversation.provider}
          abrir={abrirConversa && ((id) => { void refresh().then(() => abrirConversa(id)); })} />
        {/* Bifurcar e ocultar só na web e no celular (quem passa `abrirConversa`): no PC a lateral já faz. */}
        {abrirConversa && conversation.live && (conversation.provider === "claude" || conversation.provider === "codex") && (
          <button type="button" className="composer-botao" disabled={bifurcando}
            title="Bifurcar: abre uma conversa nova com todo o histórico desta, que segue independente" aria-label="Bifurcar conversa"
            onClick={() => void bifurcar()}>
            <GitBranchIcon aria-hidden className={`h-4 w-4${bifurcando ? " anexo-girando" : ""}`} />
          </button>
        )}
        {abrirConversa && (
          <button type="button" className={`composer-botao${conversation.hidden ? " is-ativo" : ""}`}
            title={conversation.hidden ? "Reabrir: a conversa volta para a lista" : "Ocultar da lista — fica em Ocultas, nada é apagado"}
            aria-label={conversation.hidden ? "Reabrir conversa na lista" : "Ocultar conversa da lista"}
            onClick={() => void ocultar(!conversation.hidden)}>
            <ArchiveIcon aria-hidden className="h-4 w-4" />
          </button>
        )}
      </>}
      // Sessão ligada = há `capabilities` (engine antigo não manda `live`).
      direita={conversation.capabilities && <ModoDoAgente provider={conversation.provider} modo={conversation.mode} pronto={Boolean(conversation.capabilities?.prompt) && !busy} onModo={trocarModo} />}
      onParar={trabalhando && conversation.live ? () => { setParando(true); void interromper().finally(() => setParando(false)); } : undefined}
      parando={parando}
      buscarArquivos={buscarArquivos}
      comandos={listarComandos}
      voz={vozInstalada ? { transcrever: (audio) => transcrever(conversation.id, audio), corrigir: (texto) => corrigir(conversation.id, texto) } : undefined} />
  </section>;
}

/** Arrasto que traz arquivos (e não texto ou uma aba sendo movida). */
function temArquivos(dados: DataTransfer | null): boolean {
  return Boolean(dados && Array.from(dados.types ?? []).includes("Files"));
}

/** Plano e automático — o que o `shift+tab` alterna no terminal; os dois do dia a dia. Travado sem
 *  tela reconhecida: tecla no meio de um turno não é para o agente. */
export function ModoDoAgente({ provider, modo, pronto, onModo }: { provider?: string | null; modo?: string | null; pronto: boolean; onModo: (alvo: "plan" | "auto") => Promise<void> }) {
  // Auto do Codex é o "Approve for me" do `/permissions`: um revisor só pergunta o que for arriscado.
  const codex = provider === "codex";
  // O terminal leva um instante para confirmar a troca: o botão escolhido acende na hora (e pulsa
  // até a confirmação), em vez de o clique parecer ignorado.
  const [pedido, setPedido] = useState<"plan" | "auto" | null>(null);
  const ativo = pedido ?? modo;
  return <div className="composer-modos" role="group" aria-label="Modo do agente" data-ativo={ativo ?? undefined}>
    {(["plan", "auto"] as const).map((alvo) => (
      <button key={alvo} type="button" className={`composer-modo${ativo === alvo ? " is-ativo" : ""}${pedido === alvo ? " is-pedido" : ""}`}
        aria-pressed={ativo === alvo}
        disabled={!pronto && pedido === null}
        onClick={() => {
          if (pedido || alvo === modo) return;
          setPedido(alvo);
          void onModo(alvo).finally(() => setPedido(null));
        }}
        title={alvo === "plan" ? "Plano: o agente planeja e pergunta antes de mexer" : codex ? "Auto: o Codex só pede aprovação do que for arriscado (Approve for me)" : "Auto: o agente executa sem pedir aprovação"}>
        {alvo === "plan" ? <NotesIcon aria-hidden className="h-3.5 w-3.5" /> : <PlayIcon aria-hidden className="h-3.5 w-3.5" />}
        <span>{alvo === "plan" ? "Plano" : "Auto"}</span>
      </button>
    ))}
  </div>;
}

function RenomearConversa({ nome, onSalvar, onFechar }: { nome: string; onSalvar: (nome: string) => void; onFechar: () => void }) {
  return <form className="m-barra-conversa" onSubmit={(evento) => {
    evento.preventDefault();
    const campo = evento.currentTarget.elements.namedItem("nome") as HTMLInputElement | null;
    if (campo) onSalvar(campo.value);
  }}>
    <input name="nome" defaultValue={nome} aria-label="Nome da conversa" className="m-campo-nome"
      autoFocus onKeyDown={(evento) => { if (evento.key === "Escape") onFechar(); }} />
    <Button size="sm" type="submit">Salvar</Button>
    <Button size="sm" variant="ghost" type="button" onClick={onFechar}>Cancelar</Button>
  </form>;
}


/* ─────────────────────────────────────────────────────────────── app */

const CHAVE_FILTRO = "omni-filtro";

/**
 * Publica a área que sobra acima do teclado em `--vv-topo`/`--vv-altura`. A conversa (`.m-shell-chat`)
 * se prende nela: com o teclado aberto o iOS e o Chrome só encolhem a área *visível* e rolam a página
 * por baixo — a barra de cima sumia e a de digitação andava junto com o que o agente escrevia.
 */
function useAreaVisivel() {
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const raiz = document.documentElement;
    const aplicar = () => {
      raiz.style.setProperty("--vv-topo", `${vv.offsetTop}px`);
      raiz.style.setProperty("--vv-altura", `${vv.height}px`);
    };
    aplicar();
    vv.addEventListener("resize", aplicar);
    vv.addEventListener("scroll", aplicar);
    return () => { vv.removeEventListener("resize", aplicar); vv.removeEventListener("scroll", aplicar); };
  }, []);
}

export function MobileApp() {
  const { rota, ir, voltar } = useRota();
  const { conversations, attention, catalog, carregado, error, semAcesso, refresh, atualizar, parear } = useDados(rota.tela === "conversa" ? rota.conversa : null);
  const naoVistas = useMemo(() => new Set(attention.map((item) => item.id)), [attention]);
  const [onlyAttention, setOnlyAttention] = useState(() => lerSessao(CHAVE_FILTRO) === "atencao");
  const [query, setQuery] = useState("");

  useEffect(() => { gravarSessao(CHAVE_FILTRO, onlyAttention ? "atencao" : null); }, [onlyAttention]);
  useAreaVisivel();


  if (semAcesso) return <main className="m-shell"><PairingScreen parear={parear} /></main>;

  const conversa = rota.tela === "conversa" ? conversations.find(c => c.id === rota.conversa) ?? null : null;
  // As ocultas saem das listas; continuam em `conversations` para abrir pela seção Ocultas.
  const visiveis = conversations.filter(c => !c.hidden);
  const projetoId = rota.tela === "projeto" ? rota.projeto : conversa?.project_id ?? null;
  const projeto = catalog?.projects.find(p => p.id === projetoId) ?? null;
  const perfis = catalog?.profiles ?? [];
  const aviso = catalog ? idadeDaLista(catalog.published_at_ms) : null;

  const pai: Rota = rota.tela === "conversa" && conversa ? { tela: "projeto", projeto: conversa.project_id } : { tela: "inicio" };
  const abrirConversa = (id: string) => ir({ tela: "conversa", conversa: id });

  let titulo: ReactNode = <span className="pixel-text">OMNI AGENTS</span>;
  let subtitulo: ReactNode = null;
  let marca: ReactNode = null;
  let conteudo: ReactNode;

  if (rota.tela === "conversa") {
    if (conversa) {
      const aprovar = Boolean(conversa.capabilities?.approve);
      titulo = conversa.title;
      marca = <span className="m-topo-marca" data-estado={aprovar ? "aprovacao" : conversa.state ?? "parado"} aria-hidden>
        {conversa.provider ? <AgentIcon provider={conversa.provider} size={18} /> : <ChatIcon className="h-4 w-4" />}
      </span>;
      subtitulo = <>
        <span className={`m-dot ${tomDoEstado(conversa.state, aprovar)}`} aria-hidden />
        {conversa.provider && <AgentIcon provider={conversa.provider} size={12} className="shrink-0" />}
        <span className="truncate">
          {[NOME_DO_AGENTE[conversa.provider ?? ""] ?? conversa.provider, STATES[conversa.state ?? ""] ?? "Sem sessão ativa", projeto?.name]
            .filter(Boolean).join(" · ")}
        </span>
      </>;
      // Só no celular: o PC e a web já mostram o uso de todas as contas ao lado.
      conteudo = <>
        <section className="m-uso m-uso-conversa" aria-label="Uso da IA desta conversa">
          <UsoDasContas contaAtiva={null} daConversa={{ profileId: conversa.profile_id, provider: conversa.provider }} />
        </section>
        <ConversationDetail key={conversa.id} conversation={conversa} refresh={refresh} abrirConversa={abrirConversa} />
      </>;
    } else {
      titulo = "Conversa";
      conteudo = <Vazio>{carregado ? "Essa conversa não existe mais no PC." : "Carregando conversa…"}</Vazio>;
    }
  } else if (rota.tela === "projeto") {
    if (projeto) {
      const doProjeto = (onlyAttention ? attention : visiveis).filter(c => c.project_id === projeto.id);
      const daLista = filterConversations(doProjeto, query, perfis, catalog?.projects);
      const aguardando = attention.filter(c => c.project_id === projeto.id).length;
      titulo = projeto.name;
      subtitulo = <span className="truncate">{projeto.path}</span>;
      conteudo = <>
        {catalog && projeto.path && <NovaSessao project={projeto} catalog={catalog} onCriada={refresh} />}
        <Secao titulo="Conversas" icone={<ChatIcon className="h-3.5 w-3.5" />} total={doProjeto.length}>
          <SegmentedControl<"todas" | "atencao"> value={onlyAttention ? "atencao" : "todas"}
            onChange={valor => setOnlyAttention(valor === "atencao")}
            options={[{ value: "todas", label: "Todas" }, { value: "atencao", label: `Atenção (${aguardando})` }]} />
          <Input type="search" value={query} onChange={event => setQuery(event.target.value)}
            placeholder="Pesquisar conversas" aria-label="Pesquisar conversas" className="m-busca" />
          {onlyAttention
            ? <ConversationList conversations={daLista} perfis={perfis} abrir={abrirConversa} naoVistas={naoVistas}
                vazio="Nada esperando por você neste projeto." />
            : <ConversasPorEstado conversations={daLista} perfis={perfis} abrir={abrirConversa} naoVistas={naoVistas}
                vazio={query ? "Nenhuma conversa encontrada neste projeto." : "Nenhuma conversa neste projeto ainda."} />}
          {!query && !onlyAttention && (
            <Ocultas conversas={conversations.filter(c => c.hidden && c.project_id === projeto.id)} perfis={perfis} abrir={abrirConversa} />
          )}
        </Secao>
      </>;
    } else {
      titulo = "Projeto";
      conteudo = <Vazio>{carregado ? "Esse projeto não está mais aberto no PC." : "Carregando projeto…"}</Vazio>;
    }
  } else {
    const baseDaBusca = onlyAttention ? attention : visiveis;
    const resultadoDaBusca = filterConversations(baseDaBusca, query, perfis, catalog?.projects);
    const trabalhandoAgora = visiveis.filter(c => c.state === "working").length;
    const projetos = catalog?.projects ?? [];
    const termo = query.trim().toLocaleLowerCase("pt-BR");
    const projetosDaBusca = projetos.filter(p => `${p.name} ${p.path}`.toLocaleLowerCase("pt-BR").includes(termo));
    conteudo = <>
      <Saudacao trabalhando={trabalhandoAgora} aguardando={attention.length} aviso={aviso}>
      {/* Painel do início: o que está acontecendo agora, em três números. "Precisa de você" filtra. */}
      <div className="m-resumo">
        <button type="button" className="m-resumo-item glass" data-tom="ativo" onClick={() => setOnlyAttention(false)}>
          <PlayIcon aria-hidden className="m-resumo-icone" />
          <span className="m-resumo-num">{trabalhandoAgora}</span>
          <span className="m-resumo-rotulo">Trabalhando</span>
        </button>
        <button type="button" className="m-resumo-item glass" data-tom="alerta" aria-pressed={onlyAttention}
          onClick={() => setOnlyAttention(valor => !valor)}>
          <AlertIcon aria-hidden className="m-resumo-icone" />
          <span className="m-resumo-num">{attention.length}</span>
          <span className="m-resumo-rotulo">Aguardando</span>
        </button>
        <button type="button" className="m-resumo-item glass" data-tom="neutro" onClick={() => setOnlyAttention(false)}>
          <FolderIcon aria-hidden className="m-resumo-icone" />
          <span className="m-resumo-num">{projetos.length}</span>
          <span className="m-resumo-rotulo">Projetos</span>
        </button>
      </div>
      </Saudacao>
      <AprovacoesDeFluxo />
      <section className="m-uso glass" aria-label="Uso das IAs"><UsoDasContas contaAtiva={null} /></section>
      <section className="m-uso glass" aria-label="Prévia no navegador"><PreviasLocais /></section>
      <label className="m-busca-caixa">
        <SearchIcon aria-hidden className="m-busca-lupa" />
        <Input type="search" value={query} onChange={event => setQuery(event.target.value)}
          placeholder="Pesquisar projetos e conversas" aria-label="Pesquisar projetos e conversas" className="m-busca" />
      </label>
      {query
        ? <>
            <Secao titulo="Projetos" icone={<FolderIcon className="h-3.5 w-3.5" />} total={projetosDaBusca.length}>
              <ProjectList projects={projetosDaBusca} conversations={visiveis} vazio="Nenhum projeto encontrado."
                abrir={id => ir({ tela: "projeto", projeto: id })} />
            </Secao>
            <Secao titulo="Conversas" icone={<ChatIcon className="h-3.5 w-3.5" />} total={resultadoDaBusca.length}>
              <ConversationList conversations={resultadoDaBusca} perfis={perfis} projetos={projetos}
                mostrarProjeto abrir={abrirConversa} naoVistas={naoVistas} vazio="Nenhuma conversa encontrada." />
            </Secao>
          </>
        : onlyAttention
        ? <Secao titulo="Precisa de você" icone={<AlertIcon className="h-3.5 w-3.5" />} total={attention.length}>
            <ConversationList conversations={attention} perfis={perfis} projetos={projetos} mostrarProjeto abrir={abrirConversa}
              naoVistas={naoVistas} vazio="Nada esperando por você agora." />
          </Secao>
        : <>
            {visiveis.length > 0 && (
              <Secao titulo="Recentes" icone={<ChatIcon className="h-3.5 w-3.5" />}>
                <ConversationList conversations={visiveis.slice(0, 3)} perfis={perfis} projetos={projetos} mostrarProjeto
                  abrir={abrirConversa} naoVistas={naoVistas} vazio="" />
              </Secao>
            )}
            <Secao titulo="Projetos" icone={<FolderIcon className="h-3.5 w-3.5" />} total={projetos.length}>
              <ProjectList projects={projetos} conversations={visiveis} limite={6} abrir={id => ir({ tela: "projeto", projeto: id })} />
            </Secao>
          </>}
    </>;
  }

  return <div className={rota.tela === "conversa" ? "m-shell m-shell-chat" : "m-shell"}>
    <TopBar titulo={titulo} subtitulo={subtitulo} marca={marca} onAtualizar={atualizar}
      onVoltar={rota.tela === "inicio" ? undefined : () => voltar(pai)} />
    <main className="m-conteudo">
      {error && <p role="alert" className="m-alerta">Não foi possível conectar: {error}</p>}
      {conteudo}
    </main>
  </div>;
}
