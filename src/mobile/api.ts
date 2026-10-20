import type { TemaPublicado } from "./tema";

export interface Conversation {
  id: string; title: string; project_id: string; provider: string | null; profile_id: string | null; state: string | null;
  /** Modo de permissão lido do rodapé do CLI: `plan`, `auto`, `acceptEdits` ou `null` (não visível). */
  mode?: string | null;
  capabilities: {
    prompt: boolean; approve: boolean; revision: string; approval_text: string | null; reason: string | null;
    /** Agente no meio do turno com o campo livre: mensagem mandada agora entra na fila da CLI. */
    enfileirar?: boolean;
    /** Menu da CLI ou pergunta do agente travando o campo: responde-se pelo número. */
    escolha?: Escolha | null;
  } | null;
  /** Há uma sessão aberta no PC ligada a esta conversa (dá para ver o terminal e mandar teclas). */
  live?: boolean;
  /** Última atividade (terminal ou transcript), em ms. Ordena a lista e vira o "há 5 min". */
  updated_at_ms?: number;
  /** Conversa achada só no histórico da CLI, sem sessão do OMNI. */
  historical?: boolean;
  /** Você tirou da lista (web/celular). Continua existindo e reabre pela seção Ocultas. */
  hidden?: boolean;
  /** Identidade do último evento de atenção (`sessão:contador`). Muda só quando o agente termina
   *  um turno ou pede aprovação — redesenho da tela não mexe. Engine antigo não manda. */
  attention?: string | null;
  /** Tokens do turno em andamento, como o terminal mostra ("113", "1.2k"). Só com o agente trabalhando. */
  tokens?: string | null;
  /** Por que a sessão parou sem terminar (`usage_limit`, `api_error`). Engine antigo não manda. */
  notice?: string | null;
}

/** `text` é fala; `tool` é uma ação do agente (ler, rodar, editar); `command` é um `/comando`
 *  digitado; `notice` é um aviso da CLI (interrompido, compactado). Engine antigo não manda: texto. */
export type TipoMensagem = "text" | "tool" | "command" | "notice";
export interface Mensagem {
  id: string; role: string; text: string; provider: string; timestamp?: string | null;
  kind?: TipoMensagem;
  /** Nome da ferramenta (`Bash`, `Read`, `Shell`…) quando `kind` é `tool`. */
  tool?: string;
  /** Imagens coladas na mensagem; cada uma vem por `GET /conversas/{id}/imagens/{n}/{k}`. */
  imagens?: number;
}
export interface Projects {
  /** 0 = o desktop nunca publicou; a lista veio só das conversas já registradas. */
  published_at_ms: number;
  projects: { id: string; name: string; path: string }[];
  agents: { id: string; label: string; command: string; resume: string | null }[];
  profiles: { id: string; provider: string; name: string }[];
  /** Aparência publicada pelo PC. `null` quando o PC é de uma versão que ainda não publicava. */
  theme: TemaPublicado | null;
}
export interface Timeline {
  timeline: {
    messages: Mensagem[];
    next_cursor: number | null;
    /** Onde começa a página anterior. Sem cursor o servidor devolve o fim da conversa. */
    prev_cursor?: number | null;
    unavailable_segments: number[];
  };
  actions: { id: string; state: string; error: string | null }[];
  /** Estado atual da conversa, mandado junto para o chat aberto não precisar recarregar a lista. */
  conversation?: Conversation;
}

/** Resposta do `/painel`: lista e catálogo numa chamada só. */
export interface Painel { conversations: Conversation[]; catalog: Projects }

/** Precisa de você: aprovação pendente ou agente parado esperando a próxima mensagem. Mesma regra
 *  que o servidor usava no `/atencao`. */
/** Agentes que a visão Conversa entende: o OMNI lê o transcript e reconhece a tela deles. O Cursor
 *  não grava transcript legível, então a aba dele fica no terminal (que funciona normalmente).
 *  O Antigravity grava num SQLite que o engine lê (`omni_core::antigravity`). */
export const AGENTES_COM_CONVERSA = ["claude", "codex", "antigravity"];
/** Agentes com uso de conta (5 h e semana) que o OMNI consegue ler. */
export const AGENTES_COM_USO = ["claude", "codex", "antigravity"];
/** Nome de cada agente para a tela, na ordem em que aparecem nas listas. */
export const NOME_DO_AGENTE: Record<string, string> = { claude: "Claude", codex: "Codex", antigravity: "Antigravity", cursor: "Cursor" };
export function temConversa(provider: string | null | undefined): boolean {
  return !provider || AGENTES_COM_CONVERSA.includes(provider);
}

export function precisaDeVoce(conversa: Conversation): boolean {
  return Boolean(conversa.capabilities?.approve || conversa.capabilities?.prompt || conversa.state === "approval_required");
}
/**
 * O que identifica o pedido de atenção atual: abrir a conversa marca **este** pedido como visto, e
 * ela só volta para "Precisa de você" quando a chave mudar — fim de turno novo ou aprovação. Sem
 * `attention` (engine antigo), vale só o tipo do pedido: vista uma vez, fica vista até virar
 * aprovação.
 */
export function chaveDeAtencao(conversa: Conversation): string {
  const tipo = conversa.capabilities?.approve || conversa.state === "approval_required" ? "aprovar" : "responder";
  return `${conversa.attention ?? ""}|${tipo}`;
}
export class ApiError extends Error {
  constructor(message: string, public readonly status: number) { super(message); }
}
const TOKEN_KEY = "omni-token";

/**
 * Token de dispositivo. Chega pelo **fragmento** da URL (`#t=…`), que o QR do desktop embute: o
 * fragmento não é enviado ao servidor nem entra em log ou `Referer`, ao contrário de uma query.
 *
 * Lido dentro do `request()`, não no topo do módulo, para o teste conseguir trocar `location.hash`
 * sem precisar reimportar o módulo.
 */
function token(): string {
  try {
    const doFragmento = new URLSearchParams(location.hash.slice(1)).get("t");
    if (doFragmento) {
      localStorage.setItem(TOKEN_KEY, doFragmento);
      history.replaceState(null, "", location.pathname);
    }
    return localStorage.getItem(TOKEN_KEY) ?? "";
  } catch {
    // Navegador com armazenamento bloqueado: segue sem token e o servidor responde 401.
    return "";
  }
}

export function esquecerToken() {
  try { localStorage.removeItem(TOKEN_KEY); } catch { /* nada a fazer */ }
}

/** Grava o token recebido no pareamento pelo Authy — o caminho do app da tela inicial do iPhone,
 *  que não enxerga o token que o QR gravou no Safari. */
export function salvarToken(valor: string) {
  try { localStorage.setItem(TOKEN_KEY, valor); } catch { /* sem armazenamento: vale só nesta aba */ }
}

/** Quem leva a requisição até o engine. No celular e na web é o `fetch` HTTP; no app do PC é o
 *  protocolo local do engine (`usarTransporte` em `src/main.tsx`) — mesmas rotas, sem servidor HTTP. */
type Transporte = (path: string, init: RequestInit) => Promise<Response>;
let transporte: Transporte = (path, init) => fetch(path, init);
export function usarTransporte(novo: Transporte) {
  transporte = novo;
}

/** Um comando `/` do agente (`GET /conversas/{id}/comandos`). `origem`: `cli`, `seu`, `projeto`,
 *  `skill` ou `plugin`. */
export interface Comando { nome: string; descricao: string; origem: string }

/** Quem abre um arquivo citado na conversa. Só o app do PC tem onde abrir (`usarAbrirArquivo` em
 *  `src/main.tsx`); na web e no celular fica `null` e o caminho continua texto. */
let abridor: ((caminho: string) => void) | null = null;
export function usarAbrirArquivo(novo: ((caminho: string) => void) | null) {
  abridor = novo;
}
export function abridorDeArquivo() {
  return abridor;
}

/** Sem barra, só extensão conhecida: `console.log` e `i.e` não são arquivo. */
const EXTENSOES = /\.(tsx?|jsx?|mjs|cjs|json|mdx?|css|scss|html?|rs|toml|ya?ml|py|go|java|kt|swift|cs|cpp|hpp|c|h|rb|php|sh|ps1|sql|txt|lock|xml|svg|vue|svelte|ini)$/i;

/** O texto parece um arquivo (`src/App.tsx:42`, `Cargo.toml`, `D:\proj\a.rs`) e não uma URL. */
export function pareceArquivo(texto: string): boolean {
  const caminho = semLocal(texto.trim());
  if (!caminho || /\s/.test(caminho) || caminho.includes("://") || !/^[\w@~.\\/:+-]+$/.test(caminho)) return false;
  return /[\\/]/.test(caminho) ? /\.[A-Za-z]\w{0,9}$/.test(caminho) : EXTENSOES.test(caminho);
}

/** Tira a posição que o agente cola no caminho: `:42`, `:42:7`, `#L42`, `#L42-L50`. */
export function semLocal(caminho: string): string {
  return caminho.replace(/(?::\d+(?::\d+)?|#L\d+(?:-L?\d+)?)$/, "");
}

export async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await transporte(path, {
    ...init,
    headers: { ...init?.headers, "X-Omni-Token": token() },
    signal: init?.signal ?? AbortSignal.timeout(15_000),
  });
  if (!response.ok) {
    // Token inválido ou rotacionado no PC: descarta, senão o celular insiste com o segredo velho.
    if (response.status === 401) esquecerToken();
    // Rota que não existe (engine mais antigo que a tela) responde sem JSON: sem o `catch`, virava
    // erro de parse e quem chamou não conseguia distinguir o 404.
    const result = await response.json().catch(() => ({}));
    throw new ApiError(result.error ?? `Falha HTTP ${response.status}`, response.status);
  }
  return (await response.json()) as T;
}
/** ETag da última resposta de cada endereço consultado com `requestSeMudou`. */
const etags = new Map<string, string>();

/**
 * GET que só devolve dado quando algo mudou. Manda o `ETag` da última resposta; se o servidor diz
 * `304`, volta `null` e quem chamou mantém o que já tem na tela — sem parsear, sem re-renderizar.
 * A lista e a conversa aberta são consultadas a cada poucos segundos e, quase sempre, nada mudou.
 */
export async function requestSeMudou<T>(path: string, init?: RequestInit): Promise<T | null> {
  const anterior = etags.get(path);
  const response = await transporte(path, {
    ...init,
    cache: "no-store",
    headers: { ...init?.headers, "X-Omni-Token": token(), ...(anterior ? { "If-None-Match": anterior } : {}) },
    signal: init?.signal ?? AbortSignal.timeout(15_000),
  });
  if (response.status === 304) return null;
  if (!response.ok) {
    if (response.status === 401) esquecerToken();
    // Rota que não existe num engine antigo cai na página de erro em texto, não em JSON.
    const result = await response.json().catch(() => ({}));
    throw new ApiError(result.error ?? `Falha HTTP ${response.status}`, response.status);
  }
  const result = await response.json();
  const etag = response.headers.get("etag");
  if (etag) etags.set(path, etag); else etags.delete(path);
  return result as T;
}

/** Esquece o ETag de um endereço: a próxima leitura vem inteira (ex.: o componente remontou). */
export function esquecerVersao(path: string) {
  etags.delete(path);
}

/** Teclas para o terminal da conversa no PC — `` é o Esc que interrompe o agente. */
export async function enviarTeclas(conversa: string, dados: string) {
  await request(`/conversas/${encodeURIComponent(conversa)}/teclas`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ dados }),
  });
}

// HTTP on a Tailscale IP is not a secure context: crypto.randomUUID may be unavailable.
export function actionKey(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), byte => byte.toString(16).padStart(2,"0")).join("");
}

/** Pergunta na tela do terminal (menu da CLI ou AskUserQuestion do agente). */
export interface Escolha {
  pergunta: string;
  /** Texto entre a pergunta e as opções, uma linha da tela por linha. */
  detalhe: string | null;
  opcoes: { numero: number; rotulo: string; descricao?: string; marcada?: boolean }[];
  /** Marcar várias: o número marca/desmarca e "avançar" (Tab) segue. */
  multipla?: boolean;
  /** Várias perguntas seguidas: as abas e quais já têm resposta. */
  etapas?: { titulo: string; respondida: boolean }[];
}
