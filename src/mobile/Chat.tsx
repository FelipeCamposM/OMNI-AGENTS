import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { AgentIcon } from "../components/ui/AgentIcon";

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

interface MessageBubbleProps {
  lado: "user" | "agent";
  autor: string;
  /** Id da CLI que respondeu, quando houver: põe a marca do provider ao lado do autor. */
  provider?: string;
  /** Mensagem mandada daqui e ainda não confirmada no transcript. */
  pendente?: boolean;
  children: ReactNode;
}

/** Balão de uma mensagem: do usuário à direita, do agente à esquerda. */
export function MessageBubble({ lado, autor, provider, pendente, children }: MessageBubbleProps) {
  return (
    <article className={`bubble ${lado === "user" ? "bubble-user" : "bubble-agent"}${pendente ? " bubble-pending" : ""}`}>
      <p className="bubble-author">
        {provider && <AgentIcon provider={provider} size={11} className="mr-1 inline-block align-[-1px]" />}
        {autor}
      </p>
      <div className="mobile-message">{children}</div>
    </article>
  );
}

interface AgentWorkingProps {
  /** Quando o trabalho começou (ms). Vira o contador "(12s)" igual ao do Claude Code. */
  desde: number;
}

/**
 * O "trabalhando…" do agente, como balão de chat.
 *
 * O texto que muda fica `aria-hidden`: anunciar cada frase nova num leitor de tela seria barulho
 * a cada poucos segundos. Quem usa leitor recebe uma única mensagem estável.
 */
export function AgentWorking({ desde }: AgentWorkingProps) {
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
    <div className="bubble bubble-agent" role="status">
      <span className="sr-only">O agente está trabalhando</span>
      <span className="working" aria-hidden>
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
      <img src="/apple-touch-icon.png" alt="" width={72} height={72} className="pairing-icon" />
      <h2 className="text-lg font-semibold">Parear este aparelho</h2>
      <p className="text-sm text-text-secondary">
        Abra o <strong>Authy</strong> e digite o código de 6 dígitos do <strong>OMNI AGENTS</strong>.
      </p>
      <form onSubmit={(event) => void enviar(event)} className="pairing-form">
        <label htmlFor="codigo-authy" className="sr-only">Código do Authy</label>
        <input id="codigo-authy" className="pairing-input" inputMode="numeric" autoComplete="one-time-code"
          pattern="[0-9]*" maxLength={6} value={codigo} placeholder="000000"
          onChange={(event) => setCodigo(event.target.value.replace(/\D/g, "").slice(0, 6))} />
        <button type="submit" className="btn btn-glass px-4 py-2.5 text-sm pairing-button" disabled={codigo.length !== 6 || enviando}>
          {enviando ? "Conferindo…" : "Parear"}
        </button>
      </form>
      {erro && <p role="alert" className="text-danger text-sm">{erro}</p>}
      <p className="text-xs text-text-muted">
        Ainda não tem o OMNI no Authy? No PC, abra Configurações → Celular → Proteger com o Authy.
      </p>
    </section>
  );
}
