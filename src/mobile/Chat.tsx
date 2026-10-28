import { createContext, memo, useContext, useEffect, useRef, useState, type ComponentType, type FormEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import ReactMarkdown from "react-markdown";
import rehypeSanitize from "rehype-sanitize";
import remarkGfm from "remark-gfm";
import type { Element, ElementContent, Root } from "hast";
import { AgentIcon } from "../components/ui/AgentIcon";
import { OmniLogo } from "../components/ui/OmniLogo";
import {
  BookIcon, CheckIcon, CopyIcon, EditIcon, FileTextIcon, GlobeIcon, ListIcon, RobotIcon, SearchIcon, ToolsIcon,
  ReloadIcon,
} from "../components/ui/PixelIcon";
import { iconForPath, iconStyle } from "../features/files/fileIcons";
import { nomeDoCaminho, semMarcasDeImagem, separarAnexos } from "./anexos";
import { chaveDaFerramenta } from "../features/extensoes/chaveDoIcone";
import { abridorDeArquivo, buscarIconeDeExtensao, NOME_DO_AGENTE, pareceArquivo, request, type Mensagem } from "./api";

/** Os quadros do spinner do Claude Code, em vai-e-volta — é o que faz parecer que ele "respira". */
const QUADROS = ["·", "✢", "✳", "✶", "✻", "✽", "✻", "✶", "✳", "✢"];

/**
 * Frases de "trabalhando", no espírito das do Claude Code (Pondering…, Noodling…, Moonwalking…).
 * Propositalmente bobas: a graça é não dizer nada útil — o que está acontecendo de verdade não
 * chega ao celular enquanto o agente só usa ferramenta e pensa.
 */
export const FRASES_TRABALHANDO = [
  "Matutando",
  "Maquinando",
  "Ruminando",
  "Destrinchando",
  "Garimpando",
  "Alinhavando",
  "Fermentando ideias",
  "Tricotando código",
  "Consultando os astros",
  "Afinando a viola",
  "Desembaraçando os fios",
  "Lustrando os bits",
  "Polindo",
  "Cozinhando em fogo baixo",
  "Filosofando",
  "Rabiscando no guardanapo",
  "Pensando com calma",
  "Juntando as peças",
  "Passando um café",
];

function reduzirMovimento(): boolean {
  return typeof window !== "undefined" && Boolean(window.matchMedia?.("(prefers-reduced-motion: reduce)").matches);
}

function sortearOutra(atual: string): string {
  const opcoes = FRASES_TRABALHANDO.filter((frase) => frase !== atual);
  return opcoes[Math.floor(Math.random() * opcoes.length)];
}

/** "14:32" hoje, "17/09 14:32" em outro dia. Horário inválido some em vez de mostrar lixo. */
export function horarioCurto(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const data = new Date(iso);
  if (Number.isNaN(data.getTime())) return null;
  const hora = data.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  return data.toDateString() === new Date().toDateString()
    ? hora
    : `${data.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })} ${hora}`;
}


/** Anexo já no PC (caminho) ou ainda só no celular (com prévia local). */
interface AnexoVisivel { nome: string; previa?: string | null }

function CartoesDeAnexo({ anexos }: { anexos: AnexoVisivel[] }) {
  if (anexos.length === 0) return null;
  return (
    <ul className="bubble-anexos" aria-label="Anexos da mensagem">
      {anexos.map((anexo, i) => {
        const Icone = iconForPath(anexo.nome);
        return (
          <li key={`${anexo.nome}-${i}`} className="bubble-anexo">
            {anexo.previa
              ? <img src={anexo.previa} alt="" className="bubble-anexo-previa" />
              : <Icone aria-hidden className="h-4 w-4 shrink-0" style={iconStyle(anexo.nome)} />}
            <span className="truncate">{anexo.nome}</span>
          </li>
        );
      })}
    </ul>
  );
}

/** Imagem colada numa mensagem: o conteúdo mora no transcript e vem do engine uma vez por sessão. */
const imagensLidas = new Map<string, Promise<string>>();
function lerImagem(caminho: string): Promise<string> {
  let lida = imagensLidas.get(caminho);
  if (!lida) {
    lida = request<{ tipo: string; dados: string }>(caminho).then(({ tipo, dados }) => `data:${tipo};base64,${dados}`);
    lida.catch(() => imagensLidas.delete(caminho));
    imagensLidas.set(caminho, lida);
  }
  return lida;
}

function ImagemDaMensagem({ caminho, numero }: { caminho: string; numero: number }) {
  const [src, setSrc] = useState<string | null>(null);
  const [falhou, setFalhou] = useState(false);
  const [aberta, setAberta] = useState(false);
  useEffect(() => {
    let vivo = true;
    lerImagem(caminho).then((url) => { if (vivo) setSrc(url); }, () => { if (vivo) setFalhou(true); });
    return () => { vivo = false; };
  }, [caminho]);
  if (falhou) return <li className="bubble-imagem bubble-imagem-falhou">Imagem {numero} indisponível</li>;
  return (
    <li className="bubble-imagem">
      {src
        ? <button type="button" className="bubble-imagem-botao" aria-label={`Ampliar imagem ${numero}`} onClick={() => setAberta(true)}>
            <img src={src} alt={`Imagem ${numero}`} />
          </button>
        : <span className="bubble-imagem-carregando" role="status" aria-label={`Carregando imagem ${numero}`} />}
      {/* No `body`: dentro do painel, um ancestral com transform prendia o `fixed` na área do chat. */}
      {aberta && src && createPortal(
        <div className="imagem-ampliada" role="dialog" aria-label={`Imagem ${numero}`} onClick={() => setAberta(false)}
          onKeyDown={(evento) => { if (evento.key === "Escape") setAberta(false); }}>
          <img src={src} alt={`Imagem ${numero}`} />
          <button type="button" className="imagem-ampliada-fechar" autoFocus onClick={() => setAberta(false)}>Fechar</button>
        </div>,
        document.body,
      )}
    </li>
  );
}

/** As imagens coladas numa mensagem do usuário, na ordem em que foram coladas. */
export interface ImagensDaMensagem { conversa: string; n: number; total: number }

interface MessageBubbleProps {
  lado: "user" | "agent";
  /** Id da CLI que respondeu, quando houver: dá o nome e a marca do autor. */
  provider?: string | null;
  texto: string;
  horario?: string | null;
  /** Mensagem mandada daqui e ainda não confirmada no transcript. */
  /** `true` mostra "enviando…"; um texto troca o rótulo ("na fila"). */
  pendente?: boolean | string;
  /** Anexos com prévia local — só no balão otimista, antes de o transcript chegar. */
  anexosLocais?: AnexoVisivel[];
  /** Mais uma fala do agente no mesmo turno: sem cabeçalho, colada na anterior. */
  continua?: boolean;
  imagens?: ImagensDaMensagem;
  /** Chegou agora (não estava na tela ao abrir): entra animado e o texto do agente se revela. */
  entra?: boolean;
}

/**
 * Balão de uma mensagem: do usuário à direita, do agente à esquerda.
 *
 * Resposta do agente é markdown (listas, código, tabelas), renderizada igual ao Histórico do PC e
 * com o mesmo `rehype-sanitize`. Mensagem do usuário fica em texto puro — reinterpretar o que a
 * pessoa digitou mudaria o que ela vê do próprio prompt — e a lista de anexos vira cartões.
 */
export const MessageBubble = memo(function MessageBubble({ lado, provider, texto, horario, pendente, anexosLocais, continua, imagens, entra }: MessageBubbleProps) {
  const doUsuario = lado === "user";
  const separado = doUsuario ? separarAnexos(texto) : { texto, anexos: [] as string[] };
  const corpo = doUsuario ? semMarcasDeImagem(separado.texto) : separado.texto;
  const anexos = separado.anexos;
  const cartoes = anexosLocais ?? anexos.map((caminho) => ({ nome: nomeDoCaminho(caminho) }));
  const autor = doUsuario ? "Você" : NOME_DO_AGENTE[provider ?? ""] ?? provider ?? "Agente";
  const hora = horarioCurto(horario);
  // Só o texto com que o balão nasceu é "digitado": se o mesmo balão crescer depois, não recomeça.
  const textoInicial = useRef(corpo);
  const digita = entra && !doUsuario && corpo === textoInicial.current;
  return (
    // `selectable`: no desktop o body barra a seleção (app nativo); o texto da conversa tem de copiar.
    <article className={`bubble selectable ${doUsuario ? "bubble-user" : "bubble-agent"}${pendente ? " bubble-pending" : ""}${continua ? " bubble-continua" : ""}${entra || pendente ? " entra" : ""}`}>
      {/* Avatar só na primeira fala do turno; as seguintes alinham com ele. */}
      {!doUsuario && !continua && (
        <span className="bubble-avatar" aria-hidden><AgentIcon provider={provider} size={16} /></span>
      )}
      <header className="bubble-author">
        <span>{autor}</span>
        {pendente ? <span className="bubble-time">{typeof pendente === "string" ? pendente : "enviando…"}</span> : hora && <time className="bubble-time">{hora}</time>}
      </header>
      {corpo && (doUsuario
        ? <div className="mobile-message">{corpo}</div>
        : <div className="bubble-markdown prose prose-sm max-w-none">
            <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={digita ? [rehypeSanitize, rehypeDigitar] : [rehypeSanitize]} components={COMPONENTES_DO_MARKDOWN}>{corpo}</ReactMarkdown>
          </div>)}
      {imagens && imagens.total > 0 && (
        <ul className="bubble-imagens" aria-label="Imagens da mensagem">
          {Array.from({ length: imagens.total }, (_, k) => (
            <ImagemDaMensagem key={k} numero={k + 1}
              caminho={`/conversas/${encodeURIComponent(imagens.conversa)}/imagens/${imagens.n}/${k}`} />
          ))}
        </ul>
      )}
      <CartoesDeAnexo anexos={cartoes} />
      {!doUsuario && corpo && <BotaoCopiar texto={corpo} rotulo="Copiar resposta" className="bubble-copiar" />}
    </article>
  );
});

/**
 * Resposta "digitada": cada palavra vira um `<span class="palavra">` com atraso crescente e acende
 * desfocada → nítida, e um cursor pisca no fim até o texto terminar. Roda depois do sanitize (o
 * sanitize tiraria o `style`). Código (bloco ou solto) acende inteiro: quebrado em palavras, o
 * `código` solto deixaria de virar link de arquivo.
 */
const BLOCOS_COM_TEXTO = new Set(["p", "ul", "ol", "li", "blockquote", "h1", "h2", "h3", "h4", "h5", "h6", "table", "tbody", "tr", "td"]);

function rehypeDigitar() {
  return (arvore: Root) => {
    let total = 0;
    const contar = (no: Root | ElementContent): void => {
      if (no.type === "text") total += no.value.match(/\S+/g)?.length ?? 0;
      else if (no.type === "element" && (no.tagName === "pre" || no.tagName === "code")) total += 1;
      else if ("children" in no) no.children.forEach((filho) => contar(filho as ElementContent));
    };
    contar(arvore);
    // ~25ms por palavra, mas a resposta inteira acaba em ~1,6s: longa digita mais rápido.
    const passo = Math.min(25, 1600 / Math.max(total, 1));
    let i = 0;
    const atraso = (classe: string) => ({ className: [classe], style: `animation-delay:${Math.round(i++ * passo)}ms` });
    const envolver = (filho: ElementContent, tag: string): Element =>
      ({ type: "element", tagName: tag, properties: atraso(tag === "div" ? "palavra palavra-bloco" : "palavra"), children: [filho] });
    const andar = (no: Root | Element) => {
      no.children = (no.children as ElementContent[]).flatMap((filho): ElementContent[] => {
        if (filho.type === "text") {
          return filho.value.split(/(\s+)/).filter(Boolean).map((parte) => /^\s+$/.test(parte)
            ? { type: "text", value: parte }
            : envolver({ type: "text", value: parte }, "span"));
        }
        if (filho.type !== "element") return [filho];
        if (filho.tagName === "pre") return [envolver(filho, "div")];
        if (filho.tagName === "code") return [envolver(filho, "span")];
        andar(filho);
        return [filho];
      });
    };
    andar(arvore);
    // O cursor vai no fim do último texto: desce pela última lista/tabela até o parágrafo ou item.
    const ultimoBloco = (no: Root | Element) =>
      [...no.children].reverse().find((f): f is Element => f.type === "element" && BLOCOS_COM_TEXTO.has(f.tagName));
    let ultimo = ultimoBloco(arvore);
    for (let dentro = ultimo && ultimoBloco(ultimo); dentro; dentro = ultimoBloco(dentro)) ultimo = dentro;
    ultimo?.children.push({ type: "element", tagName: "span", properties: { className: ["digitando-cursor"], ariaHidden: "true",
      style: `animation-delay:0ms,${Math.round(i * passo + 200)}ms` }, children: [] });
  };
}

/** Copiar para a área de transferência. Some onde ela não existe (HTTP fora de localhost). */
function BotaoCopiar({ texto, rotulo, className }: { texto: string | (() => string); rotulo: string; className: string }) {
  const [copiado, setCopiado] = useState(false);
  if (typeof navigator === "undefined" || !navigator.clipboard) return null;
  return (
    <button type="button" className={className} aria-label={rotulo} title={copiado ? "Copiado" : rotulo}
      onClick={() => {
        void navigator.clipboard.writeText(typeof texto === "function" ? texto() : texto).then(() => {
          setCopiado(true);
          window.setTimeout(() => setCopiado(false), 1500);
        }).catch(() => undefined);
      }}>
      {copiado ? <CheckIcon aria-hidden className="h-3.5 w-3.5" /> : <CopyIcon aria-hidden className="h-3.5 w-3.5" />}
      <span>{copiado ? "Copiado" : "Copiar"}</span>
    </button>
  );
}

/** Arquivo citado pelo agente: no app do PC abre num painel; na web e no celular continua texto. */
function Arquivo({ caminho, children }: { caminho: string; children: ReactNode }) {
  const abrir = abridorDeArquivo();
  const [falta, setFalta] = useState<string | null>(null);
  useEffect(() => {
    if (!falta) return;
    const t = window.setTimeout(() => setFalta(null), 4000);
    return () => window.clearTimeout(t);
  }, [falta]);
  if (!abrir) return <>{children}</>;
  return (
    <>
      <button type="button" className="bubble-arquivo" title={`Abrir ${caminho}`}
        onClick={() => void Promise.resolve(abrir(caminho)).catch((motivo) => setFalta(motivo instanceof Error ? motivo.message : String(motivo)))}>
        {children}
      </button>
      {falta && <span role="status" className="bubble-arquivo-falta">{falta}</span>}
    </>
  );
}

/** Dentro de bloco de código nada vira link: ali o caminho é parte de um comando ou de um trecho. */
const DentroDeBloco = createContext(false);

/** `código` solto no texto: se parece arquivo (`src/App.tsx:42`), abre ao clicar. */
function CodigoNoTexto({ children, className }: { children?: ReactNode; className?: string }) {
  const emBloco = useContext(DentroDeBloco);
  const codigo = <code className={className}>{children}</code>;
  const texto = typeof children === "string" ? children : null;
  if (emBloco || !texto || !pareceArquivo(texto)) return codigo;
  return <Arquivo caminho={texto}>{codigo}</Arquivo>;
}

/** Link `[App.tsx](src/App.tsx#L42)`, como o Claude cita arquivo. Sem esquema é arquivo: abrir o
 *  link levaria a janela do app para fora da tela. */
function LinkNoTexto({ href, children }: { href?: string; children?: ReactNode }) {
  const caminho = href && !/^[a-z][\w+.-]+:/i.test(href) && !href.startsWith("#") ? decodeURI(href) : null;
  if (caminho && abridorDeArquivo()) return <Arquivo caminho={caminho}>{children}</Arquivo>;
  return <a href={href}>{children}</a>;
}

const COMPONENTES_DO_MARKDOWN = { pre: BlocoDeCodigo, code: CodigoNoTexto, a: LinkNoTexto };

/** Bloco de código do markdown com a linguagem no topo e um "Copiar", como num editor. */
function BlocoDeCodigo({ children }: { children?: ReactNode }) {
  const corpo = useRef<HTMLPreElement>(null);
  const filho = Array.isArray(children) ? children[0] : children;
  const classe = (filho as { props?: { className?: string } } | undefined)?.props?.className ?? "";
  const linguagem = /language-([\w+#-]+)/.exec(classe)?.[1];
  return (
    <div className="codigo">
      <div className="codigo-topo">
        <span className="codigo-linguagem">{linguagem ?? "código"}</span>
        <BotaoCopiar texto={() => corpo.current?.textContent ?? ""} rotulo="Copiar código" className="codigo-copiar" />
      </div>
      <pre ref={corpo}><DentroDeBloco.Provider value>{children}</DentroDeBloco.Provider></pre>
    </div>
  );
}

/** Verbo de cada ferramenta, para a ação ler como frase ("Rodou npm test") e não como JSON. */
const VERBO: Record<string, string> = {
  Bash: "Rodou", PowerShell: "Rodou", Shell: "Rodou",
  Read: "Leu", Edit: "Editou", MultiEdit: "Editou", Write: "Escreveu", NotebookEdit: "Editou",
  Grep: "Buscou", Glob: "Procurou", WebFetch: "Abriu", WebSearch: "Pesquisou",
  Task: "Delegou", Agent: "Delegou", TodoWrite: "Planejou", Skill: "Usou a skill", update_plan: "Planejou",
};

export function verboDaAcao(tool: string | undefined): string {
  return VERBO[tool ?? ""] ?? tool ?? "Ação";
}

/** Caminho longo vira `…/pasta/arquivo.ts`: numa linha de ação o nome do arquivo é o que importa. */
function encurtarCaminho(texto: string): string {
  if (!/^([a-zA-Z]:)?[\\/]/.test(texto) || texto.length < 48) return texto;
  const partes = texto.split(/[\\/]/).filter(Boolean);
  return partes.length > 2 ? `…/${partes.slice(-2).join("/")}` : texto;
}

/** Ícone de cada ferramenta: ler o tipo de ação de relance, sem precisar do verbo. */
const ICONE_DA_ACAO: Record<string, ComponentType<{ className?: string; "aria-hidden"?: boolean }>> = {
  Read: FileTextIcon, Edit: EditIcon, MultiEdit: EditIcon, Write: EditIcon, NotebookEdit: EditIcon, apply_patch: EditIcon,
  Grep: SearchIcon, Glob: SearchIcon, WebFetch: GlobeIcon, WebSearch: GlobeIcon,
  Task: RobotIcon, Agent: RobotIcon, TodoWrite: ListIcon, update_plan: ListIcon, Skill: BookIcon,
};

const DE_TERMINAL = new Set(["Bash", "PowerShell", "Shell"]);

/** Uma busca por extensão na sessão; falha (engine antigo, sem rede) vira "sem ícone". */
const iconesBuscados = new Map<string, Promise<string | null>>();

function useIconeDaExtensao(chave: string | null) {
  const [icone, setIcone] = useState<string | null>(null);
  useEffect(() => {
    setIcone(null);
    if (!chave) return;
    let vivo = true;
    let busca = iconesBuscados.get(chave);
    if (!busca) {
      busca = buscarIconeDeExtensao(chave).catch(() => null);
      iconesBuscados.set(chave, busca);
    }
    void busca.then((achado) => { if (vivo) setIcone(achado); });
    return () => { vivo = false; };
  }, [chave]);
  return icone;
}

function IconeDaAcao({ tool }: { tool?: string }) {
  // Ferramenta de MCP/plugin/conector mostra a marca de quem foi chamado (o ícone da aba Extensões).
  const marca = useIconeDaExtensao(chaveDaFerramenta(tool));
  if (marca) return <img aria-hidden alt="" src={marca} className="acao-icone acao-icone-marca" draggable={false} />;
  // Comando vira um `$`, como no terminal: o ícone de terminal, pequeno, parecia uma caixa de seleção.
  if (DE_TERMINAL.has(tool ?? "")) return <span aria-hidden className="acao-icone acao-prompt">$</span>;
  const Icone = ICONE_DA_ACAO[tool ?? ""] ?? ToolsIcon;
  return <Icone aria-hidden className="acao-icone h-3.5 w-3.5" />;
}

/** Ações cujo detalhe é o arquivo mexido: no PC, clicar abre. */
const DE_ARQUIVO = new Set(["Read", "Edit", "MultiEdit", "Write", "NotebookEdit"]);

function LinhaDeAcao({ acao }: { acao: Mensagem }) {
  const [verDiff, setVerDiff] = useState(false);
  const detalhe = acao.text && <code className="acao-detalhe">{encurtarCaminho(acao.text)}</code>;
  const diff = acao.diff;
  return (
    <li className="acao" title={acao.text}>
      <IconeDaAcao tool={acao.tool} />
      <span className="acao-verbo">{verboDaAcao(acao.tool)}</span>
      {detalhe && DE_ARQUIVO.has(acao.tool ?? "") ? <Arquivo caminho={acao.text}>{detalhe}</Arquivo> : detalhe}
      {diff && (
        <button type="button" className="acao-contagem" aria-expanded={verDiff} title={verDiff ? "Esconder alterações" : "Ver alterações"}
          onClick={() => setVerDiff((v) => !v)}>
          {diff.mais > 0 && <span className="diff-mais">+{diff.mais}</span>}
          {diff.menos > 0 && <span className="diff-menos">−{diff.menos}</span>}
          <span className="acoes-seta" aria-hidden>{verDiff ? "▾" : "▸"}</span>
        </button>
      )}
      {diff && verDiff && (
        <pre className="acao-diff" aria-label="Alterações">
          {diff.linhas.map((linha, i) => (
            <span key={i} className={linha[0] === "+" ? "diff-linha-mais" : linha[0] === "-" ? "diff-linha-menos" : undefined}>{linha || " "}</span>
          ))}
          {diff.cortado && <span className="diff-cortado">… mais linhas no arquivo</span>}
        </pre>
      )}
    </li>
  );
}

/**
 * As ações do agente entre duas falas, num bloco só: no terminal do PC cada passo aparece; aqui elas
 * ficam resumidas ("7 ações · Rodou npm test") e abrem num toque. O bloco do turno em andamento
 * nasce aberto — é o que mostra, ao vivo, o que o agente está fazendo agora.
 */
export const BlocoDeAcoes = memo(function BlocoDeAcoes({ acoes, aoVivo, entra }: {
  acoes: Mensagem[]; provider?: string | null; aoVivo?: boolean; entra?: boolean;
}) {
  const [aberto, setAberto] = useState(Boolean(aoVivo));
  useEffect(() => { if (aoVivo) setAberto(true); }, [aoVivo]);
  const ultima = acoes[acoes.length - 1];
  const visiveis = aberto ? acoes : [];
  return (
    <section className={`acoes${aoVivo ? " acoes-ao-vivo" : ""}${entra ? " entra" : ""}`} aria-label="Ações do agente">
      <button type="button" className="acoes-cabecalho" aria-expanded={aberto} onClick={() => setAberto((v) => !v)}>
        <span className="acoes-seta" aria-hidden>{aberto ? "▾" : "▸"}</span>
        {ultima && <IconeDaAcao tool={ultima.tool} />}
        <span className="acoes-contagem">{acoes.length === 1 ? "1 ação" : `${acoes.length} ações`}</span>
        {!aberto && ultima && (
          <span className="acoes-resumo">
            <span className="acao-verbo">{verboDaAcao(ultima.tool)}</span>{" "}
            <span className="acoes-resumo-detalhe">{encurtarCaminho(ultima.text)}</span>
          </span>
        )}
      </button>
      {aberto && <ul className="acoes-lista">{visiveis.map((acao) => <LinhaDeAcao key={acao.id} acao={acao} />)}</ul>}
    </section>
  );
});

/** `/comando` digitado na CLI: no terminal aparece como `> /model`; aqui, como um selo do seu lado. */
export function LinhaDeComando({ texto, entra }: { texto: string; entra?: boolean }) {
  return <p className={`comando${entra ? " entra" : ""}`}><span className="comando-sinal" aria-hidden>›</span><code>{texto}</code></p>;
}

/** Aviso da própria CLI (interrompido, compactado): linha discreta no meio da conversa. */
export function LinhaDeAviso({ texto, entra }: { texto: string; entra?: boolean }) {
  const classe = entra ? " entra" : "";
  // Troca de conta/IA (o engine escreve "Conta trocada: A → B"): destaque próprio, é o tipo de
  // aviso que explica por que a conversa mudou de dono no meio.
  if (/^(Conta|IA) trocada: /.test(texto)) {
    return <p className={`aviso-cli aviso-troca${classe}`} role="note"><ReloadIcon aria-hidden className="h-3 w-3" />{texto}</p>;
  }
  return <p className={`aviso-cli${classe}`} role="note">{texto}</p>;
}

interface AgentWorkingProps {
  /** Quando o trabalho começou (ms). Vira o contador "(12s)" igual ao do Claude Code. */
  desde: number;
  provider?: string | null;
  /** Tokens do turno lidos da linha de status da CLI ("113", "1.2k"). */
  tokens?: string | null;
}

/** "1min 05s" depois do primeiro minuto, como o Claude Code conta. */
function duracao(segundos: number): string {
  if (segundos < 60) return `${segundos}s`;
  return `${Math.floor(segundos / 60)}min ${String(segundos % 60).padStart(2, "0")}s`;
}

/**
 * O "trabalhando…" do agente, como balão de chat.
 *
 * O texto que muda fica `aria-hidden`: anunciar cada frase nova num leitor de tela seria barulho
 * a cada poucos segundos. Quem usa leitor recebe uma única mensagem estável.
 */
export function AgentWorking({ desde, provider, tokens }: AgentWorkingProps) {
  const [quadro, setQuadro] = useState(0);
  const [frase, setFrase] = useState(() => sortearOutra(""));
  const [agora, setAgora] = useState(() => Date.now());

  useEffect(() => {
    const parado = reduzirMovimento();
    const spinner = parado ? undefined : window.setInterval(() => setQuadro((q) => (q + 1) % QUADROS.length), 120);
    const troca = parado ? undefined : window.setInterval(() => setFrase(sortearOutra), 2800);
    const relogio = window.setInterval(() => setAgora(Date.now()), 1000);
    return () => { window.clearInterval(spinner); window.clearInterval(troca); window.clearInterval(relogio); };
  }, []);

  const segundos = Math.max(0, Math.floor((agora - desde) / 1000));
  return (
    <div className="bubble bubble-agent bubble-working" role="status">
      <span className="sr-only">O agente está trabalhando</span>
      <span className="working" aria-hidden>
        {provider && <AgentIcon provider={provider} size={12} className="shrink-0 self-center" />}
        <span className="working-glyph">{reduzirMovimento() ? "✻" : QUADROS[quadro]}</span>
        <span className="working-verb">{frase}…</span>
        <span className="working-time">({duracao(segundos)}{tokens ? <> · <span className="working-tokens">↓ {tokens} tokens</span></> : null})</span>
      </span>
    </div>
  );
}

interface PairingScreenProps {
  /** Troca o código do Authy pelo token. Lança com a mensagem do servidor quando recusa. */
  parear: (codigo: string) => Promise<void>;
}

/**
 * "Parear este aparelho" com o código de 6 dígitos do Authy.
 *
 * É a porta de entrada do app da tela inicial do iPhone: ele não enxerga o que o Safari guardou
 * (decisão da Apple), então o token do QR não chega nele. `autoComplete="one-time-code"` deixa o
 * iOS sugerir o código quando o Authy está no mesmo aparelho.
 */
export function PairingScreen({ parear }: PairingScreenProps) {
  const [codigo, setCodigo] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  async function enviar(event: FormEvent) {
    event.preventDefault();
    if (codigo.length !== 6 || enviando) return;
    setEnviando(true); setErro(null);
    try { await parear(codigo); }
    catch (reason) { setErro(reason instanceof Error ? reason.message : String(reason)); setCodigo(""); }
    finally { setEnviando(false); }
  }

  return (
    <section className="pairing">
      <OmniLogo className="neon-glow pairing-logo" />
      <h1 className="pixel-text text-lg text-text-primary">OMNI AGENTS</h1>
      <div className="glass pairing-card">
        <h2 className="text-sm font-semibold">Parear este aparelho</h2>
        <p className="text-xs text-text-secondary">
          Abra o <strong>Authy</strong> e digite o código de 6 dígitos do <strong>OMNI AGENTS</strong>.
        </p>
        <form onSubmit={(event) => void enviar(event)} className="pairing-form">
          <label htmlFor="codigo-authy" className="sr-only">Código do Authy</label>
          <input id="codigo-authy" className="field pairing-input" inputMode="numeric" autoComplete="one-time-code"
            pattern="[0-9]*" maxLength={6} value={codigo} placeholder="000000"
            onChange={(event) => setCodigo(event.target.value.replace(/\D/g, "").slice(0, 6))} />
          <button type="submit" className="btn btn-primary px-4 py-2.5 text-sm pairing-button" disabled={codigo.length !== 6 || enviando}>
            {enviando ? "Conferindo…" : "Parear"}
          </button>
        </form>
        {erro && <p role="alert" className="text-danger text-xs">{erro}</p>}
      </div>
      <p className="text-[11px] text-text-muted">
        Ainda não tem o OMNI no Authy? No PC, abra Configurações → Celular → Proteger com o Authy.
      </p>
    </section>
  );
}
