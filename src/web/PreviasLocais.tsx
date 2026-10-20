import { useState } from "react";
import { GlobeIcon } from "../components/ui/PixelIcon";
import { ApiError, request } from "../mobile/api";
import { usePoll } from "../mobile/usePoll";
import "./previas.css";

interface Previas { abertas: number[]; ativas: { alvo: number; url: string }[] }

/** Portas abertas mudam quando alguém roda ou para o `npm run dev`: 10 s basta. */
const INTERVALO_MS = 10_000;

/**
 * Servidores locais do PC (`localhost:3000`…) abertos neste aparelho. O engine repassa a porta
 * pelo mesmo caminho do celular (IP do Tailscale ou HTTPS do Serve); o link já traz o acesso.
 * Vale na página web e na home do celular.
 */
export function PreviasLocais() {
  const [dados, setDados] = useState<Previas | null>(null);
  const [porta, setPorta] = useState("");
  const [abrindo, setAbrindo] = useState<number | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [semSuporte, setSemSuporte] = useState(false);

  async function ler() {
    const lidos = await request<Partial<Previas>>("/previas");
    // Engine mais antigo que a tela responde outra coisa (ou nada): sem a checagem, a lista quebrava.
    setSemSuporte(false);
    setDados({ abertas: Array.isArray(lidos?.abertas) ? lidos.abertas : [], ativas: Array.isArray(lidos?.ativas) ? lidos.ativas : [] });
  }
  // 404: o engine do PC é de antes da prévia — dizer isso, em vez de "procurando" para sempre.
  usePoll(ler, (motivo) => setSemSuporte(motivo instanceof ApiError && motivo.status === 404), [], INTERVALO_MS);

  async function abrir(alvo: number) {
    // A janela sai antes do `await`: aberta depois dele, o Safari e o Chrome do celular a bloqueiam.
    const janela = window.open("about:blank", "_blank");
    setAbrindo(alvo);
    setErro(null);
    try {
      const { url } = await request<{ url: string }>("/previas", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ porta: alvo }),
        signal: AbortSignal.timeout(30_000),
      });
      if (janela) janela.location.href = url; else window.location.href = url;
      await ler();
    } catch (motivo) {
      janela?.close();
      setErro(motivo instanceof Error ? motivo.message : String(motivo));
    } finally {
      setAbrindo(null);
    }
  }

  async function parar(alvo: number) {
    await request(`/previas/${alvo}/fechar`, { method: "POST" }).catch(() => undefined);
    await ler().catch(() => undefined);
  }

  const ativas = new Set(dados?.ativas.map((item) => item.alvo));
  const portas = [...new Set([...(dados?.ativas.map((item) => item.alvo) ?? []), ...(dados?.abertas ?? [])])].sort((a, b) => a - b);
  const digitada = Number(porta);
  const portaValida = Number.isInteger(digitada) && digitada > 0 && digitada < 65536;

  return (
    <div className="previas">
      <h2 className="w-rotulo">Prévia no navegador</h2>
      {semSuporte && <p className="previas-vazio">Atualize o OMNI no PC para usar a prévia.</p>}
      {!semSuporte && portas.length === 0 && <p className="previas-vazio">{dados ? "Nenhum servidor local rodando nas portas comuns." : "Procurando servidores…"}</p>}
      <ul className="previas-lista">
        {portas.map((alvo) => (
          <li key={alvo} className="previas-item">
            <GlobeIcon aria-hidden className={`h-3.5 w-3.5 shrink-0${ativas.has(alvo) ? " text-success" : ""}`} />
            <span className="previas-nome">localhost:{alvo}</span>
            {ativas.has(alvo) && (
              <button type="button" className="previas-botao" onClick={() => void parar(alvo)} aria-label={`Parar prévia de localhost:${alvo}`}>
                Parar
              </button>
            )}
            <button type="button" className="previas-botao previas-abrir" disabled={abrindo !== null} onClick={() => void abrir(alvo)}>
              {abrindo === alvo ? "Abrindo…" : "Abrir"}
            </button>
          </li>
        ))}
      </ul>
      <form className="previas-outra" onSubmit={(evento) => { evento.preventDefault(); if (portaValida) void abrir(digitada); }}>
        <input type="number" inputMode="numeric" min={1} max={65535} placeholder="Outra porta" aria-label="Outra porta"
          value={porta} onChange={(evento) => setPorta(evento.target.value)} className="previas-campo" />
        <button type="submit" className="previas-botao" disabled={!portaValida || abrindo !== null}>Abrir</button>
      </form>
      {erro && <p className="previas-erro" role="alert">{erro}</p>}
    </div>
  );
}
