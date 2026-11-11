import { Suspense, lazy, useEffect, useLayoutEffect, useRef, useState, type DragEvent } from "react";
import { AgentIcon } from "../components/ui/AgentIcon";
import { OmniLogo } from "../components/ui/OmniLogo";
import { Input } from "../components/ui/Input";
import { BlocksIcon, GearIcon, SearchIcon, MonitorIcon, NotificationIcon, ChatIcon, ClockIcon, CloseIcon, EyeIcon, FolderIcon, GlobeIcon, ReloadIcon, TerminalIcon } from "../components/ui/PixelIcon";
import { deslizarAba, moverIndicador } from "../lib/motion";
import { ExtensoesSettings } from "../features/extensoes/ExtensoesSettings";
import type { ExtensoesDaConta, FonteDeExtensoes } from "../features/extensoes/extensoesService";
import { chaveDoIcone } from "../features/extensoes/chaveDoIcone";
import { Panorama } from "../features/panorama/Panorama";
import type { TerminalSession } from "../features/terminal/terminalService";
import { EtiquetaDoStatus, statusDaConversa } from "../components/ConversaStatus";
import { TarefasNoTopo } from "../features/todo/TarefasNoTopo";
import type { WorkspaceState } from "../types/workspace";
import { PairingScreen } from "../mobile/Chat";
import { ConversationDetail, ConversationList, CriandoFork, filterConversations, haQuanto, Ocultas } from "../mobile/MobileApp";
import { useDados } from "../mobile/useDados";
import { usePoll } from "../mobile/usePoll";
import { buscarIconeDeExtensao, NOME_DO_AGENTE, request, temConversa, type Conversation, type Projects } from "../mobile/api";
import { UsoNoTopo } from "./UsoDasContas";
import { PreviasLocais } from "./PreviasLocais";
import { AprovacoesDeFluxo } from "../mobile/AprovacoesDeFluxo";
import { IconeDoProjeto } from "../mobile/IconeDoProjeto";
import { AjustesDoAparelho } from "../mobile/AjustesDoAparelho";
import { NovaConversa } from "./NovaConversa";
import { pedirPermissao, permissao, suporte, useNotificacoes, usePrefsDeAviso } from "../mobile/notificacoes";
import { Select } from "../components/ui/Select";
import { LayoutPresetPicker } from "../features/workspace/LayoutPresetPicker";
import { celulas, LAYOUT_PRESETS, quantosPaineis, type Molde } from "../features/workspace/layoutPresets";
import type { LayoutPreset } from "../types/workspace";

/** O xterm só baixa quando alguém abre a aba Terminal: quem só conversa não paga por ele. */
const TerminalEspelho = lazy(() => import("./TerminalEspelho"));

const ESTADO: Record<string, string> = {
  working: "Trabalhando", answered: "Esperando você", approval_required: "Aprovação pendente",
  stopped: "Encerrado", orphan: "Sessão anterior", crashed: "Interrompido",
};

type Aba = "conversa" | "terminal";

/** Terminal sem agente aberto no PC (`GET /terminais`): o lugar de rodar um `npm run dev`. */
interface Shell { id: string; name: string; project_id: string; cwd: string; state: string; updated_at_ms: number }

/** Quantas conversas cabem lado a lado sem layout escolhido. */
const LADO_A_LADO = 3;
/** O maior layout pronto (grade 3×2). */
const MAXIMO_DE_PAINEIS = 6;
const CHAVE_LAYOUT = "omni-web-layout";
/** Tipo do arrasto de conversa (lateral → centro, painel → painel). */
const ARRASTO = "application/x-omni-conversa";

function lerLayout(): LayoutPreset | null {
  try {
    const salvo = localStorage.getItem(CHAVE_LAYOUT);
    return LAYOUT_PRESETS.some((item) => item.id === salvo) ? (salvo as LayoutPreset) : null;
  } catch { return null; }
}

/** Sem layout escolhido: colunas iguais pela quantidade aberta (o comportamento de antes). */
function moldeDe(layout: LayoutPreset | null, abertas: number): Molde {
  const escolhido = LAYOUT_PRESETS.find((item) => item.id === layout)?.molde;
  if (escolhido) return escolhido;
  return abertas >= 3 ? LAYOUT_PRESETS.find((item) => item.id === "columns-3")!.molde
    : abertas === 2 ? LAYOUT_PRESETS.find((item) => item.id === "columns-2")!.molde : "p";
}

/** Põe a conversa na célula `indice`. Vinda de outra célula, troca de lugar com a que estava lá. */
export function colocarNaCelula(abertas: readonly string[], id: string, indice: number): string[] {
  const nova = [...abertas];
  const origem = nova.indexOf(id);
  if (origem === indice) return nova;
  if (origem >= 0) {
    if (indice < nova.length) [nova[origem], nova[indice]] = [nova[indice], nova[origem]];
    else { nova.splice(origem, 1); nova.push(id); }
    return nova;
  }
  if (indice < nova.length) nova[indice] = id; else nova.push(id);
  return nova;
}

const urlDaConversaWeb = (id: string) => `${location.pathname}${location.search}#/c/${encodeURIComponent(id)}`;

export function arrastarConversa(evento: DragEvent, id: string) {
  evento.dataTransfer.setData(ARRASTO, id);
  evento.dataTransfer.setData("text/plain", id);
  evento.dataTransfer.effectAllowed = "move";
}

/** Endereço da tela aberta: `#/c/<id>[,<id>…]` são conversas lado a lado, `#/t/<id>` um terminal sem
 *  agente, `#/panorama` o panorama e `#/extensoes` as extensões. */
function lerEndereco(): { conversas: string[]; terminal: string | null; extensoes: boolean; panorama: boolean; ajustes: boolean } {
  const conversa = /^#\/c\/([^/?#]+)$/.exec(location.hash);
  const terminal = /^#\/t\/([^/?#]+)$/.exec(location.hash);
  return {
    conversas: conversa ? conversa[1].split(",").map(decodeURIComponent).filter(Boolean).slice(-MAXIMO_DE_PAINEIS) : [],
    terminal: terminal ? decodeURIComponent(terminal[1]) : null,
    extensoes: location.hash === "#/extensoes",
    ajustes: location.hash === "#/ajustes",
    panorama: location.hash === "#/panorama",
  };
}
const irPara = (hash: string, trocar = false) =>
  history[trocar ? "replaceState" : "pushState"](null, "", `${location.pathname}${location.search}${hash}`);

/** A aba Extensões do app, pelas rotas do engine. O projeto vai por id; o caminho só serve para a
 *  tela marcar "não vale neste projeto". */
const fontesDaWeb = new Map<string, FonteDeExtensoes>();
/** Uma por projeto: a página re-renderiza a cada leitura do PC, e uma fonte nova a cada render
 *  faria a aba reler tudo a cada poucos segundos. */
function fonteDaWeb(projetoId: string | null): FonteDeExtensoes {
  const chave = projetoId ?? "";
  const pronta = fontesDaWeb.get(chave);
  if (pronta) return pronta;
  const fonte = criarFonteDaWeb(projetoId);
  fontesDaWeb.set(chave, fonte);
  return fonte;
}
function criarFonteDaWeb(projetoId: string | null): FonteDeExtensoes {
  const ler = () => request<{ contas: ExtensoesDaConta[]; compartilhar: boolean }>(
    `/extensoes${projetoId ? `?projeto=${encodeURIComponent(projetoId)}` : ""}`);
  return {
    listar: async () => (await ler()).contas ?? [],
    lerCompartilhamento: async () => Boolean((await ler()).compartilhar),
    definirCompartilhamento: async (ligado) => {
      await request("/extensoes/compartilhar", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ligado }),
      });
    },
    // Só o que o app do PC já buscou e salvou; a web não vai à rede atrás de ícone.
    icone: (destino, nome) => buscarIconeDeExtensao(chaveDoIcone(destino, nome)),
    definirPrincipal: async (provider, conta) => {
      await request("/extensoes/principal", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ provider, conta }),
      });
    },
    explorer: false,
  };
}
const CHAVE_ABA = "omni-web-aba";
const CHAVE_FILTRO_PROJETO = "omni-web-filtro-projeto";
/** Projeto sem conversa nova há mais que isso vai para "Mais N projetos". */
const PROJETO_PARADO_MS = 30 * 86_400_000;

/** Abas da lateral, como no app do PC: as conversas do projeto e as prévias de localhost. */
type AbaLateral = "conversas" | "historico" | "previas";
const ABAS_LATERAIS: { id: AbaLateral; rotulo: string; icone: typeof ChatIcon }[] = [
  { id: "conversas", rotulo: "Conversas", icone: ChatIcon },
  { id: "historico", rotulo: "Histórico", icone: ClockIcon },
  { id: "previas", rotulo: "Prévia", icone: GlobeIcon },
];
const CHAVE_ABA_LATERAL = "omni-web-aba-lateral";
function lerAbaLateral(): AbaLateral {
  try {
    const salva = sessionStorage.getItem(CHAVE_ABA_LATERAL);
    return ABAS_LATERAIS.some(({ id }) => id === salva) ? salva as AbaLateral : "conversas";
  } catch { return "conversas"; }
}
/** Quantas conversas recentes a aba Conversas mostra; o resto fica na aba Histórico. */
const ULTIMAS = 6;

const DIA = 86_400_000;
/** Histórico em faixas de tempo, da mais nova para a mais velha. */
function porPeriodo(lista: Conversation[], agora = Date.now()): [string, Conversation[]][] {
  const hoje = new Date(agora).setHours(0, 0, 0, 0);
  const faixas: [string, number][] = [["Hoje", hoje], ["Ontem", hoje - DIA], ["Últimos 7 dias", hoje - 7 * DIA], ["Últimos 30 dias", hoje - 30 * DIA], ["Mais antigas", -Infinity]];
  const grupos = faixas.map(([nome]) => [nome, [] as Conversation[]] as [string, Conversation[]]);
  for (const c of lista) grupos[faixas.findIndex(([, desde]) => (c.updated_at_ms ?? 0) >= desde)][1].push(c);
  return grupos.filter(([, itens]) => itens.length > 0);
}

function lerAba(): Aba {
  try { return sessionStorage.getItem(CHAVE_ABA) === "terminal" ? "terminal" : "conversa"; } catch { return "conversa"; }
}

function tomDoEstado(conversa: Conversation): string {
  if (conversa.capabilities?.approve || conversa.state === "approval_required") return "m-dot-alerta";
  if (conversa.state === "working") return "m-dot-ativo";
  if (conversa.state === "answered") return "m-dot-ok";
  if (conversa.state === "crashed") return "m-dot-erro";
  return "m-dot-parado";
}

/** As conversas abertas do projeto em três grupos, na ordem em que pedem olho. */
function porEstado(lista: Conversation[]): [string, string, Conversation[]][] {
  const pedindo = (c: Conversation) => Boolean(c.capabilities?.approve) || c.state === "approval_required" || c.state === "answered";
  return ([
    ["Pedindo você", "m-dot-alerta", lista.filter(pedindo)],
    ["Trabalhando", "m-dot-ativo", lista.filter((c) => !pedindo(c) && c.state === "working")],
    ["Paradas", "m-dot-parado", lista.filter((c) => !pedindo(c) && c.state !== "working")],
  ] as [string, string, Conversation[]][]).filter(([, , itens]) => itens.length > 0);
}

/** O panorama do app, montado com o que a web sabe: um workspace "PC" com os projetos que têm algo
 *  rodando, e cada conversa/terminal vivo como sessão. */
function dadosDoPanorama(projetos: Projects["projects"], conversas: Conversation[], shells: Shell[]): { workspace: WorkspaceState; sessions: TerminalSession[] } {
  const sessao = (id: string, project_id: string, name: string, state: string, provider: string | null, profile_id: string | null): TerminalSession => ({
    id, project_id, name, cwd: projetos.find((p) => p.id === project_id)?.path ?? "", shell: "", state: state as TerminalSession["state"],
    pid: null, output_seq: 0, rows: 0, cols: 0, provider, profile_id, conversation_id: provider ? id : null,
  });
  const sessions = [
    ...conversas.filter((c) => c.live).map((c) => sessao(c.id, c.project_id, c.title,
      c.capabilities?.approve ? "approval_required" : c.state ?? "stopped", c.provider ?? "claude", c.profile_id)),
    ...shells.map((s) => sessao(s.id, s.project_id, s.name, s.state, null, null)),
  ];
  const usados = new Set(sessions.map((s) => s.project_id));
  return {
    sessions,
    workspace: {
      version: 1, id: "pc", name: "PC", activeProjectId: null, updatedAt: "",
      projects: projetos.filter((p) => usados.has(p.id)).map((p) => ({
        id: p.id, name: p.name, path: p.path, gitRoot: null, branch: null, composeFile: null, lastOpenedAt: "",
        layout: { type: "pane", id: `pane-${p.id}`, tabs: [], activeTabId: null }, activePaneId: `pane-${p.id}`, maximizedPaneId: null,
      })),
    },
  };
}

/**
 * A mesma coisa que o celular faz, num layout de computador — e mais perto do app do PC: o que
 * precisa de você, projetos e conversas à esquerda, e no centro até três conversas do mesmo projeto
 * lado a lado (ou o terminal delas, ao vivo).
 *
 * Tudo vem das mesmas rotas do engine que o celular usa. Fora do escopo de propósito: editar
 * arquivo e painel de Git — isso continua sendo do app do PC.
 */
export function WebApp() {
  const [abertas, setAbertas] = useState<string[]>([]);
  const [focada, setFocada] = useState<string | null>(null);
  const [terminalId, setTerminalId] = useState<string | null>(null);
  const [verExtensoes, setVerExtensoes] = useState(false);
  const [verAjustes, setVerAjustes] = useState(false);
  const [verPanorama, setVerPanorama] = useState(false);
  const [fluxosParados, setFluxosParados] = useState(0);
  const [shells, setShells] = useState<Shell[]>([]);
  const [abrindoTerminal, setAbrindoTerminal] = useState(false);
  const [erroTerminal, setErroTerminal] = useState<string | null>(null);
  const { conversations, attention, catalog, carregado, error, semAcesso, refresh, atualizar, parear } = useDados(focada);
  const [projetoId, setProjetoId] = useState<string | null>(null);
  /** Filtro da lateral: clicar num projeto mostra só as conversas dele; "Todos" volta. */
  // Um filtro só para as abas Conversas e Histórico; sobrevive a recarregar a página.
  const [filtroProjeto, setFiltroProjeto] = useState<string | null>(() => {
    try { return sessionStorage.getItem(CHAVE_FILTRO_PROJETO); } catch { return null; }
  });
  useEffect(() => {
    try {
      if (filtroProjeto) sessionStorage.setItem(CHAVE_FILTRO_PROJETO, filtroProjeto);
      else sessionStorage.removeItem(CHAVE_FILTRO_PROJETO);
    } catch { /* sem armazenamento: vale só agora */ }
  }, [filtroProjeto]);
  const [verProjetosParados, setVerProjetosParados] = useState(false);
  const [query, setQuery] = useState("");
  const [buscaHistorico, setBuscaHistorico] = useState("");
  const [atualizando, setAtualizando] = useState(false);
  const [layout, setLayout] = useState<LayoutPreset | null>(lerLayout);
  const [alvoDoArrasto, setAlvoDoArrasto] = useState<number | null>(null);
  const busca = useRef<HTMLInputElement>(null);
  const [bifurcando, setBifurcando] = useState<string | null>(null);
  /** Modal de nova conversa aberto, com o projeto já escolhido (o do "+" ou o selecionado). */
  const [novaConversa, setNovaConversa] = useState<{ projeto: string | null } | null>(null);
  const [erroBifurcar, setErroBifurcar] = useState<string | null>(null);
  /** Renomear direto na lista. Conversa só do histórico da CLI entra no índice do PC ao ganhar nome. */
  async function renomearConversa(id: string, nome: string) {
    setErroBifurcar(null);
    try {
      await request(`/conversas/${encodeURIComponent(id)}/nome`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ nome }) });
      await refresh();
    } catch (motivo) {
      setErroBifurcar(motivo instanceof Error ? motivo.message : String(motivo));
    }
  }
  /** Bifurcar da lateral: conversa nova com todo o histórico, aberta no centro. */
  async function bifurcarConversa(id: string) {
    setBifurcando(id);
    setErroBifurcar(null);
    try {
      const nova = await request<{ id: string | null }>(`/conversas/${encodeURIComponent(id)}/bifurcar`, { method: "POST" });
      await refresh();
      if (nova.id) abrirConversa(nova.id);
    } catch (motivo) {
      setErroBifurcar(motivo instanceof Error ? motivo.message : String(motivo));
    } finally { setBifurcando(null); }
  }
  const capacidade = layout ? quantosPaineis(moldeDe(layout, 0)) : LADO_A_LADO;
  useNotificacoes(attention, carregado, urlDaConversaWeb);
  const [avisos, mudarAvisos] = usePrefsDeAviso();
  // Lateral em abas: a que sai fica na tela até terminar de deslizar.
  const [abaLateral, setAbaLateral] = useState<AbaLateral>(lerAbaLateral);
  const [saindo, setSaindo] = useState<AbaLateral | null>(null);
  const direcao = useRef<1 | -1>(1);
  const paineis = useRef<Partial<Record<AbaLateral, HTMLElement | null>>>({});
  const botoesAba = useRef<Partial<Record<AbaLateral, HTMLButtonElement | null>>>({});
  const marcador = useRef<HTMLSpanElement>(null);
  function trocarAbaLateral(nova: AbaLateral) {
    if (nova === abaLateral) return;
    const ordem = ABAS_LATERAIS.map(({ id }) => id);
    direcao.current = ordem.indexOf(nova) > ordem.indexOf(abaLateral) ? 1 : -1;
    setSaindo(abaLateral);
    setAbaLateral(nova);
    try { sessionStorage.setItem(CHAVE_ABA_LATERAL, nova); } catch { /* sem armazenamento: vale só agora */ }
  }
  useLayoutEffect(() => {
    moverIndicador(marcador.current, botoesAba.current[abaLateral] ?? null);
    if (!saindo) return;
    const quem = saindo;
    deslizarAba(paineis.current[abaLateral] ?? null, paineis.current[quem] ?? null, direcao.current,
      () => setSaindo((atual) => (atual === quem ? null : atual)));
  }, [abaLateral]); // eslint-disable-line react-hooks/exhaustive-deps

  // Endereço guarda as conversas abertas: atualizar a página (ou deixar aberta o dia todo) volta para
  // onde estava, como no celular.
  useEffect(() => {
    const ler = () => {
      const endereco = lerEndereco();
      setAbertas(endereco.conversas);
      setFocada((atual) => (atual && endereco.conversas.includes(atual) ? atual : endereco.conversas[endereco.conversas.length - 1] ?? null));
      setTerminalId(endereco.terminal);
      setVerExtensoes(endereco.extensoes);
      setVerAjustes(endereco.ajustes);
      setVerPanorama(endereco.panorama);
    };
    ler();
    window.addEventListener("hashchange", ler);
    window.addEventListener("popstate", ler);
    return () => {
      window.removeEventListener("hashchange", ler);
      window.removeEventListener("popstate", ler);
    };
  }, []);

  // Contador no título da aba do navegador: com a página atrás de outras, dá para ver que algo
  // está esperando por você sem voltar a ela.
  useEffect(() => {
    document.title = attention.length > 0 ? `(${attention.length}) OMNI AGENTS` : "OMNI AGENTS";
  }, [attention.length]);

  // `/` ou Ctrl+K: vai para a busca, como nos apps de chat. Não rouba a tecla de quem está digitando.
  useEffect(() => {
    function tecla(evento: KeyboardEvent) {
      const alvo = evento.target as HTMLElement | null;
      const digitando = alvo?.closest?.("input, textarea, [contenteditable], .xterm");
      // N: nova conversa, de qualquer lugar da página.
      if (evento.key.toLowerCase() === "n" && !digitando && !evento.ctrlKey && !evento.metaKey && !evento.altKey && !document.querySelector("[aria-modal='true']")) {
        evento.preventDefault();
        setNovaConversa({ projeto: null });
        return;
      }
      if ((evento.key === "/" && !digitando) || (evento.key.toLowerCase() === "k" && (evento.ctrlKey || evento.metaKey))) {
        evento.preventDefault();
        // Na aba das prévias a busca não está na tela: volta para as conversas e foca depois do render.
        setAbaLateral("conversas");
        requestAnimationFrame(() => { busca.current?.focus(); busca.current?.select(); });
      }
    }
    window.addEventListener("keydown", tecla);
    return () => window.removeEventListener("keydown", tecla);
  }, []);

  // Terminais sem agente: lista curta e barata, lida no mesmo ritmo da lista de conversas.
  const lerShells = async () => {
    const lista = await request<Shell[]>("/terminais");
    setShells(Array.isArray(lista) ? lista : []);
  };
  usePoll(lerShells, () => undefined, []);

  function limparCentro() {
    setAbertas([]);
    setFocada(null);
    setTerminalId(null);
    setVerExtensoes(false);
    setVerAjustes(false);
    setVerPanorama(false);
  }

  function abrirTerminal(id: string) {
    irPara(`#/t/${encodeURIComponent(id)}`);
    limparCentro();
    setTerminalId(id);
  }

  async function novoTerminal(projectId: string) {
    setAbrindoTerminal(true);
    setErroTerminal(null);
    try {
      const criado = await request<{ id: string }>("/terminais", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ project_id: projectId }),
      });
      await lerShells().catch(() => undefined);
      abrirTerminal(criado.id);
    } catch (motivo) {
      setErroTerminal(motivo instanceof Error ? motivo.message : String(motivo));
    } finally {
      setAbrindoTerminal(false);
    }
  }

  async function fecharTerminal(id: string) {
    try {
      await request(`/terminais/${encodeURIComponent(id)}/fechar`, { method: "POST" });
    } catch (motivo) {
      setErroTerminal(motivo instanceof Error ? motivo.message : String(motivo));
    }
    await lerShells().catch(() => undefined);
    irPara("", true);
    limparCentro();
  }

  function mostrar(lista: string[], foco: string | null, trocar = false) {
    irPara(lista.length ? `#/c/${lista.map(encodeURIComponent).join(",")}` : "", trocar);
    limparCentro();
    setAbertas(lista);
    setFocada(foco);
  }

  /** Clicar troca o que está no centro; `aoLado` soma à divisão — se for do mesmo projeto. Já aberta,
   *  só ganha o foco. */
  function abrirConversa(id: string, aoLado = false) {
    const escolhida = conversations.find((item) => item.id === id);
    if (escolhida) setProjetoId(escolhida.project_id);
    if (abertas.includes(id) && !verExtensoes && !verAjustes && !verPanorama && !terminalId) { setFocada(id); return; }
    const projetoDaDivisao = conversations.find((item) => item.id === abertas[0])?.project_id;
    const junta = aoLado && abertas.length > 0 && projetoDaDivisao === escolhida?.project_id;
    mostrar(junta ? [...abertas.filter((item) => item !== id), id].slice(-capacidade) : [id], id);
  }

  function escolherLayout(novo: LayoutPreset | null) {
    setLayout(novo);
    try { if (novo) localStorage.setItem(CHAVE_LAYOUT, novo); else localStorage.removeItem(CHAVE_LAYOUT); } catch { /* vale só agora */ }
    const cabe = novo ? quantosPaineis(moldeDe(novo, 0)) : LADO_A_LADO;
    if (abertas.length > cabe) mostrar(abertas.slice(0, cabe), focada && abertas.slice(0, cabe).includes(focada) ? focada : abertas[0], true);
  }

  /** Soltar uma conversa (da lateral ou de outro painel) numa célula do centro. */
  function soltar(evento: DragEvent, indice: number) {
    const id = evento.dataTransfer.getData(ARRASTO);
    setAlvoDoArrasto(null);
    if (!id) return;
    evento.preventDefault();
    const escolhida = conversations.find((item) => item.id === id);
    if (escolhida) setProjetoId(escolhida.project_id);
    mostrar(colocarNaCelula(verExtensoes || verAjustes || verPanorama || terminalId ? [] : abertas, id, indice).slice(0, Math.max(capacidade, 1)), id);
  }

  const aceitarArrasto = (indice: number) => (evento: DragEvent) => {
    if (!evento.dataTransfer.types.includes(ARRASTO)) return;
    evento.preventDefault();
    evento.dataTransfer.dropEffect = "move";
    if (alvoDoArrasto !== indice) setAlvoDoArrasto(indice);
  };

  function fecharConversa(id: string) {
    const restantes = abertas.filter((item) => item !== id);
    mostrar(restantes, focada === id ? restantes[restantes.length - 1] ?? null : focada, true);
  }

  function selecionarProjeto(id: string | null) {
    setFiltroProjeto((atual) => (atual === id ? null : id));
    if (id) setProjetoId(id);
    setQuery("");
  }

  if (semAcesso) {
    return (
      <main className="w-pareamento">
        <PairingScreen parear={parear} />
      </main>
    );
  }

  const conversaFocada: Conversation | null = conversations.find((item) => item.id === focada) ?? null;
  const naDivisao = abertas.map((id) => conversations.find((item) => item.id === id)).filter((item): item is Conversation => Boolean(item));
  const perfis = catalog?.profiles ?? [];
  const projetos = catalog?.projects ?? [];
  // Uma escolha explícita na lateral vence a conversa aberta: assim é possível consultar outro
  // projeto sem precisar fechar antes o chat que está no centro. Sem escolha, abre no projeto da
  // conversa mais recente — a lista vem ordenada por atividade.
  const projetoAtivo =
    projetos.find((item) => item.id === projetoId)
    ?? projetos.find((item) => item.id === conversaFocada?.project_id)
    ?? projetos.find((item) => item.id === conversations[0]?.project_id)
    ?? projetos[0]
    ?? null;
  // Ocultas saem da lista e da busca; ficam numa seção recolhida no fim.
  const visiveis = conversations.filter((item) => !item.hidden);
  // Projeto filtrado sumiu do catálogo? Volta a mostrar todos em vez de uma lista vazia.
  const filtro = projetos.find((item) => item.id === filtroProjeto) ?? null;
  const filtradas = filtro ? visiveis.filter((item) => item.project_id === filtro.id) : visiveis;
  const daLista = filterConversations(filtradas, query, perfis, projetos);
  // Sem filtro, as do projeto da conversa aberta vêm antes (o cartão diz de qual projeto é cada uma).
  const abertasNoPc = filtradas.filter((item) => item.live)
    .sort((a, b) => Number(b.project_id === projetoAtivo?.id) - Number(a.project_id === projetoAtivo?.id) || (b.updated_at_ms ?? 0) - (a.updated_at_ms ?? 0));
  // Sem filtro, só as recentes (o resto mora no Histórico); com filtro, todas as do projeto.
  const ultimas = filtradas.filter((item) => !item.live).sort((a, b) => (b.updated_at_ms ?? 0) - (a.updated_at_ms ?? 0))
    .slice(0, filtro ? undefined : ULTIMAS);
  const escopo = filtro ? filtro.name : "todos os projetos";
  // Lateral: projetos pelo uso mais recente; os parados há mais de 30 dias ficam recolhidos
  // (o PC guarda toda pasta que um agente já abriu). Filtrado ou com sessão aberta nunca recolhe.
  const ultimaAtividade = new Map<string, number>();
  for (const item of conversations) ultimaAtividade.set(item.project_id, Math.max(ultimaAtividade.get(item.project_id) ?? 0, item.updated_at_ms ?? 0));
  const projetosPorUso = [...projetos].sort((a, b) => (ultimaAtividade.get(b.id) ?? 0) - (ultimaAtividade.get(a.id) ?? 0) || a.name.localeCompare(b.name));
  const agora = Date.now();
  // Sem data conhecida (projeto novo, conversa sem horário) não conta como parado.
  const projetoAtivoNaLista = (projeto: (typeof projetos)[number]) => {
    const ultima = ultimaAtividade.get(projeto.id) ?? 0;
    return projeto.id === filtro?.id || !ultima || agora - ultima < PROJETO_PARADO_MS
      || conversations.some((item) => item.project_id === projeto.id && item.live);
  };
  const projetosAtivos = projetosPorUso.filter(projetoAtivoNaLista);
  const projetosParados = projetosPorUso.length - projetosAtivos.length;
  const projetosNaLista = verProjetosParados ? projetosPorUso : projetosAtivos;
  const historico = filterConversations(filtradas, buscaHistorico, perfis, projetos)
    .sort((a, b) => (b.updated_at_ms ?? 0) - (a.updated_at_ms ?? 0));
  // Filtro do histórico: só projetos que têm conversa, os mais usados primeiro.
  const projetosDoHistorico = projetos.map((projeto) => ({ projeto, total: visiveis.filter((item) => item.project_id === projeto.id).length }))
    .filter(({ total }) => total > 0).sort((a, b) => b.total - a.total || a.projeto.name.localeCompare(b.projeto.name));
  const trabalhando = visiveis.filter((item) => item.state === "working" && !item.capabilities?.approve)
    .sort((a, b) => (b.updated_at_ms ?? 0) - (a.updated_at_ms ?? 0));
  const naoVistas = new Set(attention.map((item) => item.id));
  const shell = shells.find((item) => item.id === terminalId) ?? null;
  const shellsDoProjeto = shells.filter((item) => item.project_id === projetoAtivo?.id);
  const pendencias = attention.length + fluxosParados;
  const temCentro = Boolean(verExtensoes || verAjustes || verPanorama || terminalId || naDivisao.length);

  return (
    <div className={`w-tela${temCentro ? " tem-centro" : ""}`}>
      <header className="w-topo glass glass-strong">
        <OmniLogo className="neon-glow w-logo" />
        <span className="w-marca">
          <span className="pixel-text">OMNI AGENTS</span>
          <span className="w-versao">v{__APP_VERSION__}</span>
        </span>
        {temCentro && (
          <button type="button" className="btn btn-ghost w-voltar w-so-celular" aria-label="Voltar para a lista" title="Voltar para a lista"
            onClick={() => mostrar([], null, true)}>←</button>
        )}
        <span className="w-topo-espaco" />
        {error && <span className="w-erro" role="alert">Sem conexão com o PC: {error}</span>}
        {catalog && catalog.agents.length > 0 && (
          <button type="button" className="btn btn-primary w-nova-conversa" title="Nova conversa (N)" onClick={() => setNovaConversa({ projeto: null })}>
            <ChatIcon aria-hidden className="h-4 w-4" /><span className="w-so-computador">Nova conversa</span><kbd className="w-nova-atalho" aria-hidden>N</kbd>
          </button>
        )}
        <UsoNoTopo profileId={conversaFocada?.profile_id ?? null} provider={conversaFocada?.provider ?? null} />
        <button type="button" className={`btn btn-ghost w-atualizar${avisos.ligadas ? " is-ativo" : ""}`} aria-pressed={avisos.ligadas}
          aria-label="Avisos do navegador" disabled={suporte() !== "ok" || permissao() === "denied"}
          title={suporte() === "inseguro" ? "Avisos precisam de HTTPS (Acesso remoto → Seguro com HTTPS)"
            : permissao() === "denied" ? "Avisos bloqueados nas permissões do site"
            : avisos.ligadas ? "Avisos ligados: notifica quando uma conversa precisar de você" : "Ligar avisos do navegador"}
          onClick={() => {
            if (avisos.ligadas) { mudarAvisos({ ligadas: false }); return; }
            void pedirPermissao().then((resposta) => mudarAvisos({ ligadas: resposta === "granted" }));
          }}>
          <NotificationIcon aria-hidden className="h-4 w-4" />
        </button>
        <span className="w-so-computador"><LayoutPresetPicker atual={layout} onEscolher={escolherLayout} onAutomatico={() => escolherLayout(null)} /></span>
        <TarefasNoTopo />
        <button type="button" className={`btn btn-ghost w-atualizar w-topo-acao${verPanorama ? " is-ativo" : ""}`} aria-pressed={verPanorama}
          title="Panorama: tudo o que está rodando no PC" onClick={() => {
            if (verPanorama) { mostrar([], null, true); return; }
            irPara("#/panorama");
            limparCentro();
            setVerPanorama(true);
          }}>
          <EyeIcon aria-hidden className="h-4 w-4" /><span className="w-topo-acao-nome">Panorama</span>
        </button>
        <button type="button" className={`btn btn-ghost w-atualizar${verExtensoes ? " is-ativo" : ""}`} aria-label="Extensões"
          title="MCPs, plugins e conectores de cada IA" onClick={() => {
            irPara("#/extensoes");
            limparCentro();
            setVerExtensoes(true);
          }}>
          <BlocksIcon aria-hidden className="h-4 w-4" />
        </button>
        <button type="button" className={`btn btn-ghost w-atualizar${verAjustes ? " is-ativo" : ""}`} aria-label="Configurações"
          aria-pressed={verAjustes} title="Configurações: avisos, layout e conexão" onClick={() => {
            if (verAjustes) { mostrar([], null, true); return; }
            irPara("#/ajustes");
            limparCentro();
            setVerAjustes(true);
          }}>
          <GearIcon aria-hidden className="h-4 w-4" />
        </button>
        <button type="button" className="btn btn-ghost w-atualizar" aria-label="Atualizar" title="Atualizar" disabled={atualizando}
          onClick={() => { setAtualizando(true); void Promise.resolve(atualizar()).finally(() => setAtualizando(false)); }}>
          <ReloadIcon aria-hidden className={`h-4 w-4${atualizando ? " anexo-girando" : ""}`} />
        </button>
      </header>

      <div className="w-colunas">
        <aside className="w-coluna w-lateral" aria-label="Projetos e conversas">
          <div role="tablist" aria-label="Seções da lateral" className="lateral-abas w-lateral-abas">
            <span ref={marcador} aria-hidden className="lateral-abas-marcador" />
            {ABAS_LATERAIS.map(({ id, rotulo, icone: Icone }) => (
              <button key={id} ref={(el) => { botoesAba.current[id] = el; }} type="button" role="tab"
                aria-selected={abaLateral === id} aria-controls={`w-aba-${id}`} onClick={() => trocarAbaLateral(id)}
                className={`lateral-aba w-lateral-aba${abaLateral === id ? " is-ativa" : ""}`}>
                <Icone className="h-3.5 w-3.5" aria-hidden />
                <span>{rotulo}</span>
                {id === "conversas" && trabalhando.length > 0 && <span aria-hidden className="lateral-aba-vivo" />}
              </button>
            ))}
          </div>

          <div className="w-lateral-paineis">
            {ABAS_LATERAIS.filter(({ id }) => id === abaLateral || id === saindo).map(({ id, rotulo }) => (
              <div key={id} id={`w-aba-${id}`} role="tabpanel" aria-label={rotulo} ref={(el) => { paineis.current[id] = el; }}
                aria-hidden={id !== abaLateral || undefined} className={`w-lateral-painel${id !== abaLateral ? " is-saindo" : ""}`}>
                {id === "previas" ? <PreviasLocais /> : id === "historico" ? (
                  <>
                    <div className="w-historico-filtros">
                      <div className={`w-busca-caixa${buscaHistorico ? " is-cheia" : ""}`}>
                        <SearchIcon aria-hidden className="w-busca-icone h-3.5 w-3.5" />
                        <Input type="search" size="sm" value={buscaHistorico} onChange={(event) => setBuscaHistorico(event.target.value)}
                          onKeyDown={(evento) => { if (evento.key === "Escape") setBuscaHistorico(""); }}
                          placeholder="Buscar por título, agente ou conta" aria-label="Buscar no histórico" className="w-busca-campo" />
                        {buscaHistorico && <button type="button" className="w-busca-limpar" aria-label="Limpar busca do histórico" onClick={() => setBuscaHistorico("")}>
                          <CloseIcon aria-hidden className="h-3 w-3" /></button>}
                      </div>
                      <Select size="sm" aria-label="Projeto do histórico" value={filtro?.id ?? ""} onChange={(valor) => setFiltroProjeto(valor || null)}
                        className="w-historico-projeto" searchable={projetosDoHistorico.length > 5} searchPlaceholder="Buscar projeto…"
                        options={[{ value: "", label: "Todos os projetos", hint: `${visiveis.length} ${visiveis.length === 1 ? "conversa" : "conversas"}`,
                          icon: <span className="w-historico-todos"><FolderIcon aria-hidden className="h-3 w-3" /></span> },
                          ...projetosDoHistorico.map(({ projeto, total }) => ({ value: projeto.id, label: projeto.name,
                            hint: `${total} ${total === 1 ? "conversa" : "conversas"}`, section: "Projetos",
                            icon: <span className="w-historico-icone"><IconeDoProjeto projeto={projeto} className="h-3 w-3" /></span> }))]} />
                      {(buscaHistorico || filtro) && (
                        <p className="w-historico-resumo" aria-live="polite">{historico.length} {historico.length === 1 ? "conversa encontrada" : "conversas encontradas"}</p>
                      )}
                    </div>
                    {historico.length === 0 && <p className="w-vazio">{carregado ? "Nada no histórico com esse filtro." : "Carregando…"}</p>}
                    {porPeriodo(historico).map(([periodo, itens]) => (
                      <section key={`${periodo}|${filtro?.id ?? ""}`} className="w-secao w-secao-periodo">
                        <h2 className="w-rotulo"><span className="w-rotulo-texto">{periodo}</span><span className="w-rotulo-conta">{itens.length}</span></h2>
                        <div className="w-conversas">
                          <ConversationList conversations={itens} perfis={perfis} projetos={projetos} mostrarProjeto abrir={abrirConversa}
                            ativa={focada} naoVistas={naoVistas} aoArrastar={arrastarConversa} aoBifurcar={(id) => void bifurcarConversa(id)} bifurcando={bifurcando} aoRenomear={renomearConversa} vazio="" />
                        </div>
                      </section>
                    ))}
                    <Ocultas conversas={conversations.filter((item) => item.hidden && (!filtro || item.project_id === filtro.id))}
                      perfis={perfis} projetos={projetos} mostrarProjeto abrir={abrirConversa} ativa={focada} />
                  </>
                ) : (
                  <>
                    <div className={`w-busca w-busca-caixa${query ? " is-cheia" : ""}`}>
                      <SearchIcon aria-hidden className="w-busca-icone h-3.5 w-3.5" />
                      <Input ref={busca} type="search" size="sm" value={query} onChange={event => setQuery(event.target.value)}
                        onKeyDown={(evento) => { if (evento.key === "Escape") { setQuery(""); evento.currentTarget.blur(); } }}
                        placeholder="Pesquisar conversas" aria-label="Pesquisar conversas" className="w-busca-campo" />
                      {query ? <button type="button" className="w-busca-limpar" aria-label="Limpar pesquisa" onClick={() => { setQuery(""); busca.current?.focus(); }}>
                        <CloseIcon aria-hidden className="h-3 w-3" /></button>
                        : <kbd className="w-busca-atalho" aria-hidden>/</kbd>}
                    </div>
                    {erroBifurcar && <p className="w-erro" role="alert">{erroBifurcar}</p>}
                    {bifurcando && <CriandoFork />}

                    {/* Primeiro o que está parado esperando você, de qualquer projeto. */}
                    <section className={`w-secao w-pendencias${pendencias > 0 ? " is-alerta" : ""}`} aria-label="Precisa de você" hidden={Boolean(query)}>
                      <h2 className="w-rotulo"><span className={`m-dot ${pendencias > 0 ? "m-dot-alerta" : "m-dot-parado"}`} aria-hidden />
                        <span className="w-rotulo-texto">Precisa de você</span>
                        {pendencias > 0 && <span className="w-rotulo-conta is-alerta">{pendencias}</span>}</h2>
                      <AprovacoesDeFluxo aoMudar={setFluxosParados} />
                      {attention.length === 0 ? (fluxosParados > 0 ? null : <p className="w-pendencias-vazio">Nada pendente agora.</p>) : (
                        <ul className="w-atencao">
                          {attention.map((item) => (
                            <li key={item.id}>
                              <ItemLateral conversa={item} ativa={abertas.includes(item.id)} abrir={abrirConversa}
                                projeto={projetos.find((p) => p.id === item.project_id)?.name} />
                            </li>
                          ))}
                        </ul>
                      )}
                    </section>

                    {!query && (
                      <section className="w-secao">
                        <h2 className="w-rotulo"><FolderIcon aria-hidden className="h-3 w-3" />Projetos<span className="w-rotulo-conta">{projetos.length}</span></h2>
                        {catalog && projetos.length === 0 && (
                          <p className="w-vazio">Nenhum projeto conhecido. Abra um projeto no OMNI do PC.</p>
                        )}
                        <ul className="w-projetos">
                          {projetos.length > 0 && (
                            <li>
                              <button type="button" onClick={() => selecionarProjeto(null)} aria-pressed={!filtro}
                                className={`w-projeto${!filtro ? " w-projeto-ativo" : ""}`}>
                                <span className="w-projeto-icone"><FolderIcon aria-hidden className="h-3.5 w-3.5" /></span>
                                <span className="w-projeto-nome">Todos</span>
                                <span className="w-projeto-total" aria-hidden>{visiveis.length}</span>
                              </button>
                            </li>
                          )}
                          {projetosNaLista.map((project) => {
                            const lista = conversations.filter((item) => item.project_id === project.id);
                            const aguardando = lista.filter((item) => item.capabilities?.approve).length;
                            const ativos = lista.filter((item) => item.state === "working").length;
                            return (
                              <li key={project.id}>
                                <button
                                  type="button"
                                  onClick={() => selecionarProjeto(project.id)}
                                  aria-pressed={project.id === filtro?.id}
                                  className={`w-projeto${project.id === filtro?.id ? " w-projeto-ativo" : ""}`}
                                  title={`${project.path}\nClique para ver só as conversas deste projeto`}
                                  aria-label={project.name}
                                >
                                  <span className="w-projeto-icone"><IconeDoProjeto projeto={project} className="h-3.5 w-3.5" /></span>
                                  <span className="w-projeto-nome">{project.name}</span>
                                  {ativos > 0 && <span className="m-dot m-dot-ativo" aria-label={`${ativos} trabalhando`} />}
                                  {aguardando > 0 && <span className="m-badge m-badge-alerta">{aguardando}</span>}
                                  <span className="w-projeto-total" aria-hidden>{lista.length}</span>
                                </button>
                                {catalog && catalog.agents.length > 0 && (
                                  <button type="button" className="w-projeto-nova" aria-label={`Nova conversa em ${project.name}`} title="Nova conversa neste projeto"
                                    onClick={() => setNovaConversa({ projeto: project.id })}>+</button>
                                )}
                              </li>
                            );
                          })}
                        </ul>
                        {projetosParados > 0 && (
                          <button type="button" className="w-ver-historico" aria-expanded={verProjetosParados}
                            onClick={() => setVerProjetosParados((valor) => !valor)}>
                            <FolderIcon aria-hidden className="h-3.5 w-3.5" />
                            {verProjetosParados ? "Esconder os parados" : `Mais ${projetosParados} ${projetosParados === 1 ? "projeto parado" : "projetos parados"}`}
                            <span aria-hidden>{verProjetosParados ? "↑" : "↓"}</span>
                          </button>
                        )}
                      </section>
                    )}

                    {query ? (
                      <section className="w-secao">
                        <h2 className="w-rotulo"><ChatIcon aria-hidden className="h-3 w-3" />Resultados{filtro && <span className="w-rotulo-dica">{filtro.name}</span>}<span className="w-rotulo-conta">{daLista.length}</span></h2>
                        <div className="w-conversas">
                          <ConversationList conversations={daLista} perfis={perfis} projetos={projetos} mostrarProjeto abrir={abrirConversa}
                            ativa={focada} naoVistas={naoVistas} aoArrastar={arrastarConversa} aoBifurcar={(id) => void bifurcarConversa(id)} bifurcando={bifurcando} aoRenomear={renomearConversa} vazio="Nenhuma conversa encontrada." />
                        </div>
                      </section>
                    ) : (
                      <>
                        <section className="w-secao" aria-label="Abertas no PC">
                          <h2 className="w-rotulo"><span className="m-dot m-dot-ativo" aria-hidden />
                            <span className="w-rotulo-texto">Abertas no PC</span>
                            <span className="w-rotulo-dica">{escopo}</span>
                            <span className="w-rotulo-conta">{abertasNoPc.length}</span></h2>
                          {abertasNoPc.length === 0 && (
                            <p className="w-vazio">{carregado ? "Nenhuma conversa aberta no PC agora." : "Carregando…"}</p>
                          )}
                          {porEstado(abertasNoPc).map(([grupo, tom, itens]) => (
                            <div key={grupo} className="w-grupo">
                              <h3 className="w-grupo-titulo"><span className={`m-dot ${tom}`} aria-hidden />{grupo}<span className="w-grupo-conta">{itens.length}</span></h3>
                              <div className="w-conversas">
                                <ConversationList conversations={itens} perfis={perfis} projetos={projetos} mostrarProjeto abrir={abrirConversa}
                                  ativa={focada} naoVistas={naoVistas} aoArrastar={arrastarConversa} aoBifurcar={(id) => void bifurcarConversa(id)} bifurcando={bifurcando} aoRenomear={renomearConversa} vazio="" abertas={abertas}
                                  aoLado={naDivisao.length > 0 ? (id) => abrirConversa(id, true) : undefined} />
                              </div>
                            </div>
                          ))}
                        </section>
                        <section className="w-secao">
                          <h2 className="w-rotulo"><ClockIcon aria-hidden className="h-3 w-3" /><span className="w-rotulo-texto">{filtro ? "Conversas" : "Últimas conversas"}</span>
                            <span className="w-rotulo-dica">{escopo}</span></h2>
                          <div className="w-conversas">
                            <ConversationList conversations={ultimas} perfis={perfis} projetos={projetos} mostrarProjeto abrir={abrirConversa}
                              ativa={focada} naoVistas={naoVistas} aoArrastar={arrastarConversa} aoBifurcar={(id) => void bifurcarConversa(id)} bifurcando={bifurcando} aoRenomear={renomearConversa} vazio={carregado ? "Nenhuma conversa ainda." : "Carregando…"} />
                          </div>
                          <button type="button" className="w-ver-historico" onClick={() => trocarAbaLateral("historico")}>
                            <ClockIcon aria-hidden className="h-3.5 w-3.5" />Ver todo o histórico<span aria-hidden>→</span>
                          </button>
                        </section>
                        {projetoAtivo?.path && shellsDoProjeto.length > 0 && (
                          <section className="w-secao">
                            <h2 className="w-rotulo"><TerminalIcon aria-hidden className="h-3 w-3" />Terminais<span className="w-rotulo-conta">{shellsDoProjeto.length}</span></h2>
                            <ul className="w-atencao">
                              {shellsDoProjeto.map((item) => (
                                <li key={item.id}>
                                  <button type="button" title={item.cwd} onClick={() => abrirTerminal(item.id)}
                                    className={`w-atencao-item w-terminal-item${item.id === terminalId ? " w-atencao-item-ativa" : ""}`}>
                                    <span className={`m-dot ${item.state === "working" ? "m-dot-ativo" : "m-dot-parado"}`} aria-hidden />
                                    <TerminalIcon aria-hidden className="h-3.5 w-3.5 shrink-0" />
                                    <span className="w-atencao-texto">{item.name}</span>
                                    {haQuanto(item.updated_at_ms) && <time className="w-atencao-tempo">{haQuanto(item.updated_at_ms)}</time>}
                                  </button>
                                </li>
                              ))}
                            </ul>
                          </section>
                        )}
                      </>
                    )}
                  </>
                )}
              </div>
            ))}
          </div>

          {/* Fixo embaixo, em qualquer aba: as duas ações do projeto. */}
          {projetoAtivo?.path && (
            <div className="w-rodape-lateral">
              {catalog && catalog.agents.length > 0 && (
                <button type="button" className="btn btn-primary w-rodape-botao" onClick={() => setNovaConversa({ projeto: projetoAtivo.id })}>
                  <ChatIcon aria-hidden className="h-4 w-4" />Nova conversa
                </button>
              )}
              <button type="button" className="btn btn-ghost w-rodape-botao" disabled={abrindoTerminal}
                title="Abre um terminal sem agente na pasta do projeto (npm run dev, git…)"
                onClick={() => void novoTerminal(projetoAtivo.id)}>
                <TerminalIcon aria-hidden className="h-4 w-4" />{abrindoTerminal ? "Abrindo…" : "Novo terminal"}
              </button>
              {erroTerminal && <p className="w-erro w-rodape-erro" role="alert">{erroTerminal}</p>}
            </div>
          )}
        </aside>

        {novaConversa && catalog && (
          <NovaConversa catalog={catalog} projetoInicial={novaConversa.projeto ?? projetoAtivo?.id ?? null} onFechar={() => setNovaConversa(null)}
            onAberta={(id) => { setNovaConversa(null); void refresh().then(() => { if (id) abrirConversa(id); }); }} />
        )}

        <main className="w-coluna w-centro" aria-label="Conversa">
          {verPanorama ? (() => {
            const { workspace, sessions } = dadosDoPanorama(projetos, conversations, shells);
            return (
              <div className="w-panorama">
                <Panorama workspaces={[workspace]} activeWorkspaceId={workspace.id} sessions={sessions}
                  onSessao={(sessao) => (sessao.provider ? abrirConversa(sessao.id) : abrirTerminal(sessao.id))}
                  onProjeto={(_, projectId) => { selecionarProjeto(projectId); mostrar([], null, true); }}
                  onAba={() => undefined} onWorkspace={() => undefined} onClose={() => mostrar([], null, true)} />
              </div>
            );
          })() : verAjustes ? (
            <div className="w-painel-central w-ajustes">
              <div className="w-abas">
                <span className="w-aba w-aba-ativa"><GearIcon aria-hidden className="h-3.5 w-3.5" />Configurações</span>
                <span className="w-topo-espaco" />
                <button type="button" className="btn btn-ghost w-fechar-terminal" onClick={() => mostrar([], null, true)}>Fechar</button>
              </div>
              <div className="w-ajustes-corpo">
                <AjustesDoAparelho pagina="computador">
                  <section className="m-ajustes-grupo glass" aria-labelledby="ajustes-tela">
                    <header className="m-ajustes-cabeca">
                      <h3 id="ajustes-tela" className="m-ajustes-titulo"><MonitorIcon aria-hidden className="h-3.5 w-3.5" />Tela</h3>
                    </header>
                    <label className="m-ajuste" htmlFor="ajustes-layout">
                      <span className="m-ajuste-texto">
                        <span className="m-ajuste-rotulo">Layout das conversas</span>
                        <span className="m-ajuste-descricao">Como o centro divide as conversas abertas. O mesmo seletor fica no topo.</span>
                      </span>
                    </label>
                    <Select id="ajustes-layout" size="sm" value={layout ?? ""} onChange={(valor) => escolherLayout(valor ? valor as LayoutPreset : null)}
                      options={[{ value: "", label: "Automático (pela quantidade aberta)" },
                        ...LAYOUT_PRESETS.map((item) => ({ value: item.id, label: item.label, hint: `${quantosPaineis(item.molde)} painéis` }))]} />
                  </section>
                </AjustesDoAparelho>
              </div>
            </div>
          ) : verExtensoes ? (
            <div className="w-painel-central w-extensoes">
              <div className="w-abas">
                <span className="w-aba w-aba-ativa"><BlocksIcon aria-hidden className="h-3.5 w-3.5" />Extensões</span>
                <span className="w-topo-espaco" />
                <button type="button" className="btn btn-ghost w-fechar-terminal" onClick={() => mostrar([], null, true)}>Fechar</button>
              </div>
              <ExtensoesSettings key={projetoAtivo?.id ?? "-"} projectPath={projetoAtivo?.path ?? null} fonte={fonteDaWeb(projetoAtivo?.id ?? null)} />
            </div>
          ) : terminalId ? (
            <>
              <div className="w-abas">
                <span className="w-aba w-aba-ativa"><TerminalIcon aria-hidden className="h-3.5 w-3.5" />{shell?.name ?? "Terminal"}</span>
                <span className="w-topo-espaco" />
                <button type="button" className="btn btn-ghost w-fechar-terminal" onClick={() => void fecharTerminal(terminalId)}>
                  Fechar terminal
                </button>
              </div>
              <div className="w-painel-central">
                <Suspense fallback={<p className="w-vazio">Abrindo o terminal…</p>}>
                  <TerminalEspelho key={terminalId} saida={`/terminais/${encodeURIComponent(terminalId)}/saida`}
                    teclas={`/terminais/${encodeURIComponent(terminalId)}/teclas`}
                    rotulo="Terminal ao vivo — clique e digite como no PC (Ctrl+C para o comando)" />
                </Suspense>
              </div>
            </>
          ) : naDivisao.length > 0 ? (
            // Cada painel é uma célula do layout (o mesmo molde dos layouts do PC). Célula vazia é um
            // alvo: arraste uma conversa da lateral até ela.
            <div className={`w-divisao w-layout is-${Math.min(naDivisao.length, 3)}`} onDragLeave={(evento) => {
              if (!evento.currentTarget.contains(evento.relatedTarget as Node | null)) setAlvoDoArrasto(null);
            }}>
              {celulas(moldeDe(layout, naDivisao.length), { x: 0, y: 0, w: 1000, h: 1000 }, 0).map((celula, indice) => {
                const item = naDivisao[indice];
                return (
                  <div key={item?.id ?? `vazia-${indice}`} className={`w-celula${alvoDoArrasto === indice ? " is-alvo" : ""}${item ? "" : " is-vazia"}`}
                    style={{ "--x": `${celula.x / 10}%`, "--y": `${celula.y / 10}%`, "--w": `${celula.w / 10}%`, "--h": `${celula.h / 10}%` } as React.CSSProperties}
                    onDragOver={aceitarArrasto(indice)} onDrop={(evento) => soltar(evento, indice)}>
                    {item ? (
                      <PainelDaConversa conversa={item} perfis={perfis} projetos={projetos}
                        focada={item.id === focada} varias={naDivisao.length > 1} focar={() => setFocada(item.id)}
                        fechar={() => fecharConversa(item.id)} refresh={refresh} abrirConversa={abrirConversa} />
                    ) : (
                      <p className="w-celula-dica">Arraste uma conversa da lateral para cá</p>
                    )}
                  </div>
                );
              })}
            </div>
          ) : (
            <div className={`w-boas-vindas${alvoDoArrasto === 0 ? " is-alvo" : ""}`} onDragOver={aceitarArrasto(0)}
              onDragLeave={() => setAlvoDoArrasto(null)} onDrop={(evento) => soltar(evento, 0)}>
              <OmniLogo className="neon-glow w-boas-vindas-logo" />
              <p className="w-vazio">
                {abertas.length && carregado ? "Essa conversa não existe mais no PC." : "Escolha uma conversa à esquerda para acompanhar e responder."}
              </p>
              <p className="w-dica">Dica: <kbd>/</kbd> busca conversas · arraste uma conversa para cá ou use <kbd>+</kbd> para abrir ao lado · <kbd>Layouts</kbd> no topo divide a tela · <kbd>Enter</kbd> envia</p>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}

/** Uma conversa no centro, com o próprio cabeçalho: dá para ter até três lado a lado. */
function PainelDaConversa({ conversa, perfis, projetos, focada, varias, focar, fechar, refresh, abrirConversa }: {
  conversa: Conversation; perfis: Projects["profiles"]; projetos: Projects["projects"];
  focada: boolean; varias: boolean; focar: () => void; fechar: () => void;
  refresh: () => Promise<void>; abrirConversa: (id: string) => void;
}) {
  const [aba, setAba] = useState<Aba>(lerAba);
  useEffect(() => {
    try { sessionStorage.setItem(CHAVE_ABA, aba); } catch { /* sem armazenamento: vale só agora */ }
  }, [aba]);
  // Agente sem visão de conversa (Cursor) abre direto no terminal ao vivo.
  const soTerminal = !temConversa(conversa.provider);
  const abaVisivel: Aba = (aba === "terminal" || soTerminal) && conversa.live ? "terminal" : "conversa";
  const conta = conversa.profile_id ? perfis.find((perfil) => perfil.id === conversa.profile_id)?.name : null;
  const projeto = projetos.find((item) => item.id === conversa.project_id);
  return (
    <section className={`w-painel${focada && varias ? " is-focada" : ""}`} aria-label={conversa.title} onPointerDownCapture={focar}>
      <div className="w-painel-topo" draggable onDragStart={(evento) => arrastarConversa(evento, conversa.id)}
        title="Arraste para trocar de lugar com outro painel">
        {conversa.provider && <span className="w-painel-avatar"><AgentIcon provider={conversa.provider} size={16} /></span>}
        <div className="w-topo-texto">
          <span className="w-topo-titulo" title={conversa.title}>{conversa.title}</span>
          <span className="w-topo-sub">
            <span className={`m-dot ${tomDoEstado(conversa)}`} aria-hidden />
            {[ESTADO[conversa.state ?? ""] ?? (conversa.historical ? "Histórico" : "Sem sessão aberta"),
              NOME_DO_AGENTE[conversa.provider ?? ""] ?? conversa.provider, conta]
              .filter(Boolean).join(" · ")}
            {projeto && <span className="w-topo-projeto" title={projeto.path}>
              <IconeDoProjeto projeto={projeto} className="h-3 w-3" />{projeto.name}</span>}
          </span>
        </div>
        <div className="w-painel-abas" role="tablist" aria-label="Visualização">
          <button type="button" role="tab" aria-selected={abaVisivel === "conversa"} disabled={soTerminal}
            title={soTerminal ? "O OMNI ainda não lê as conversas deste agente — use o terminal" : "Conversa"}
            className={`w-aba${abaVisivel === "conversa" ? " w-aba-ativa" : ""}`} onClick={() => setAba("conversa")}>
            <ChatIcon aria-hidden className="h-3.5 w-3.5" /><span className="w-aba-nome">Conversa</span>
          </button>
          <button type="button" role="tab" aria-selected={abaVisivel === "terminal"} disabled={!conversa.live}
            title={conversa.live ? "O terminal desta conversa, ao vivo" : "Sem terminal aberto no PC para esta conversa"}
            className={`w-aba${abaVisivel === "terminal" ? " w-aba-ativa" : ""}`} onClick={() => setAba("terminal")}>
            <TerminalIcon aria-hidden className="h-3.5 w-3.5" /><span className="w-aba-nome">Terminal</span>
          </button>
        </div>
        <button type="button" className="btn btn-ghost w-voltar" aria-label="Fechar conversa" title="Fechar conversa" onClick={fechar}>
          <CloseIcon aria-hidden className="h-3.5 w-3.5" />
        </button>
      </div>
      <div className="w-painel-central">
        {abaVisivel === "terminal" ? (
          <Suspense fallback={<p className="w-vazio">Abrindo o terminal…</p>}>
            <TerminalEspelho key={conversa.id} saida={`/conversas/${encodeURIComponent(conversa.id)}/terminal`}
              teclas={`/conversas/${encodeURIComponent(conversa.id)}/teclas`} />
          </Suspense>
        ) : (
          <ConversationDetail key={conversa.id} conversation={conversa} refresh={refresh} abrirConversa={abrirConversa} />
        )}
      </div>
    </section>
  );
}

function ItemLateral({ conversa, ativa, abrir, projeto }: { conversa: Conversation; ativa: boolean; abrir: (id: string) => void; projeto?: string }) {
  const aprovar = Boolean(conversa.capabilities?.approve);
  // Está em "Precisa de você" = aviso ainda não visto: pronta aparece como "finalizado", igual ao app.
  const status = statusDaConversa({ state: (aprovar ? "approval_required" : conversa.state) as TerminalSession["state"],
    notice: (conversa.notice ?? undefined) as TerminalSession["notice"] }, true);
  return (
    <button type="button" data-status={status} className={`w-atencao-item${ativa ? " w-atencao-item-ativa" : ""}${aprovar ? " w-atencao-item-alerta" : ""}`}
      onClick={() => abrir(conversa.id)} title={conversa.title} draggable onDragStart={(evento) => arrastarConversa(evento, conversa.id)}>
      <span className="w-atencao-avatar">
        {conversa.provider && <AgentIcon provider={conversa.provider} size={14} />}
        <span className={`m-dot ${tomDoEstado(conversa)}`} aria-hidden />
      </span>
      <span className="w-atencao-corpo">
        <span className="w-atencao-texto">{conversa.title}</span>
        {projeto && <span className="w-atencao-projeto">{projeto}</span>}
      </span>
      <span className="w-atencao-lado">
        <EtiquetaDoStatus status={status} />
        {haQuanto(conversa.updated_at_ms) && <time className="w-atencao-tempo">{haQuanto(conversa.updated_at_ms)}</time>}
      </span>
    </button>
  );
}
