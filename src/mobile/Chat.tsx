import { useEffect, useState, type FormEvent } from "react";
import ReactMarkdown from "react-markdown";
import rehypeSanitize from "rehype-sanitize";
import remarkGfm from "remark-gfm";
import { AgentIcon } from "../components/ui/AgentIcon";
import { OmniLogo } from "../components/ui/OmniLogo";
import { iconForPath } from "../features/files/fileIcons";
import { nomeDoCaminho, separarAnexos } from "./anexos";

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

const NOME_DO_AGENTE: Record<string, string> = { claude: "Claude", codex: "Codex", cursor: "Cursor" };

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
              : <Icone aria-hidden className="h-4 w-4 shrink-0" />}
            <span className="truncate">{anexo.nome}</span>
          </li>
        );
      })}
    </ul>
  );
}

interface MessageBubbleProps {
  lado: "user" | "agent";
  /** Id da CLI que respondeu, quando houver: dá o nome e a marca do autor. */
  provider?: string | null;
  texto: string;
  horario?: string | null;
  /** Mensagem mandada daqui e ainda não confirmada no transcript. */
  pendente?: boolean;
  /** Anexos com prévia local — só no balão otimista, antes de o transcript chegar. */
  anexosLocais?: AnexoVisivel[];
}

/**
 * Balão de uma mensagem: do usuário à direita, do agente à esquerda.
 *
 * Resposta do agente é markdown (listas, código, tabelas), renderizada igual ao Histórico do PC e
 * com o mesmo `rehype-sanitize`. Mensagem do usuário fica em texto puro — reinterpretar o que a
 * pessoa digitou mudaria o que ela vê do próprio prompt — e a lista de anexos vira cartões.
 */
export function MessageBubble({ lado, provider, texto, horario, pendente, anexosLocais }: MessageBubbleProps) {
  const doUsuario = lado === "user";
  const { texto: corpo, anexos } = doUsuario ? separarAnexos(texto) : { texto, anexos: [] as string[] };
  const cartoes = anexosLocais ?? anexos.map((caminho) => ({ nome: nomeDoCaminho(caminho) }));
  const autor = doUsuario ? "Você" : NOME_DO_AGENTE[provider ?? ""] ?? provider ?? "Agente";
  const hora = horarioCurto(horario);
  return (
    <article className={`bubble ${doUsuario ? "bubble-user" : "bubble-agent"}${pendente ? " bubble-pending" : ""}`}>
      <header className="bubble-author">
        {!doUsuario && <AgentIcon provider={provider} size={12} className="shrink-0" />}
        <span>{autor}</span>
        {pendente ? <span className="bubble-time">enviando…</span> : hora && <time className="bubble-time">{hora}</time>}
      </header>
      {corpo && (doUsuario
        ? <div className="mobile-message">{corpo}</div>
        : <div className="bubble-markdown prose prose-sm max-w-none">
            <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeSanitize]}>{corpo}</ReactMarkdown>
          </div>)}
      <CartoesDeAnexo anexos={cartoes} />
    </article>
  );
}

interface AgentWorkingProps {
  /** Quando o trabalho começou (ms). Vira o contador "(12s)" igual ao do Claude Code. */
  desde: number;
  provider?: string | null;
}

/**
 * O "trabalhando…" do agente, como balão de chat.
 *
 * O texto que muda fica `aria-hidden`: anunciar cada frase nova num leitor de tela seria barulho
 * a cada poucos segundos. Quem usa leitor recebe uma única mensagem estável.
 */
export function AgentWorking({ desde, provider }: AgentWorkingProps) {
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
        <span className="working-time">({segundos}s)</span>
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
