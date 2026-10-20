import { useState } from "react";
import { AgentIcon } from "../components/ui/AgentIcon";
import { ReloadIcon } from "../components/ui/PixelIcon";
import { AGENTES_COM_USO, request } from "../mobile/api";
import { usePoll } from "../mobile/usePoll";
import { resetShort, usageTone, type UsageWindow } from "../lib/uso";
import "./uso.css";

interface Conta {
  id: string;
  provider: string;
  name: string;
  usage: { status: string; primary: UsageWindow | null; secondary: UsageWindow | null; reason: string | null } | null;
}

const AGENTE: Record<string, string> = { claude: "Claude", codex: "Codex", cursor: "Cursor" };

/** O uso muda devagar (o PC relê a cada poucos minutos): um minuto entre leituras basta. */
const INTERVALO_MS = 60_000;

function Janela({ rotulo, janela }: { rotulo: string; janela: UsageWindow | null }) {
  if (!janela) return <span className="w-uso-janela"><span>{rotulo}</span><span className="w-uso-pct">—</span></span>;
  const usado = Math.min(100, Math.max(0, janela.used_percent));
  const tom = usageTone(janela.used_percent);
  const reset = resetShort(janela);
  return (
    <span className="w-uso-janela" title={reset ? `${rotulo}: reseta ${reset}` : undefined}>
      <span>{rotulo}</span>
      <span role="progressbar" aria-label={`${rotulo} consumido`} aria-valuenow={Math.round(usado)} aria-valuemin={0} aria-valuemax={100}
        className="w-uso-barra">
        <span className={`w-uso-preenchido ${tom.bar}`} style={{ width: `${usado}%` }} />
      </span>
      <span className={`w-uso-pct ${tom.text}`}>{janela.used_percent.toLocaleString("pt-BR")}%</span>
    </span>
  );
}

/**
 * Uso de cada conta, como o rodapé do app do PC: janela de 5 h e semanal, com as mesmas cores (verde
 * até 60%, amarelo até 85%, vermelho acima). A conta da conversa aberta vem destacada.
 * Com `daConversa`, mostra só a conta que a conversa usa (sem conta escolhida, as do agente dela).
 */
export function UsoDasContas({ contaAtiva, daConversa }: {
  contaAtiva: string | null;
  daConversa?: { profileId: string | null; provider: string | null };
}) {
  const [contas, setContas] = useState<Conta[]>([]);
  const [atualizando, setAtualizando] = useState<Set<string>>(new Set());
  const [erros, setErros] = useState<Record<string, string>>({});

  /** Pede ao PC uma leitura nova. No Claude o PC consulta o `/usage` — leva alguns segundos. */
  async function atualizar(id: string) {
    setAtualizando((atual) => new Set(atual).add(id));
    setErros(({ [id]: _, ...resto }) => resto);
    try {
      const nova = await request<Conta>(`/contas/${encodeURIComponent(id)}/uso`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
        signal: AbortSignal.timeout(90_000),
      });
      setContas((lista) => lista.map((conta) => (conta.id === id ? { ...conta, usage: nova.usage } : conta)));
    } catch (motivo) {
      setErros((atual) => ({ ...atual, [id]: motivo instanceof Error ? motivo.message : String(motivo) }));
    } finally {
      setAtualizando((atual) => { const novo = new Set(atual); novo.delete(id); return novo; });
    }
  }
  usePoll(async () => {
    const lista = await request<Conta[]>("/contas");
    setContas(Array.isArray(lista) ? lista : []);
  }, () => undefined, [], INTERVALO_MS);

  const visiveis = !daConversa ? contas : contas.filter((conta) => daConversa.profileId
    ? conta.id === daConversa.profileId : conta.provider === daConversa.provider);
  if (visiveis.length === 0) return null;
  // Só Claude e Codex sabem reler o uso na hora; o Cursor não tem leitura.
  const atualizaveis = visiveis.filter((conta) => AGENTES_COM_USO.includes(conta.provider));
  const todasLendo = atualizaveis.length > 0 && atualizaveis.every((conta) => atualizando.has(conta.id));
  return (
    <>
      {!daConversa && <div className="w-uso-cabecalho">
        <h2 className="w-rotulo">Uso das contas</h2>
        {atualizaveis.length > 1 && (
          <button type="button" className="w-uso-atualizar" disabled={todasLendo} title="Buscar o uso de todas as contas de uma vez"
            onClick={() => atualizaveis.forEach((conta) => { if (!atualizando.has(conta.id)) void atualizar(conta.id); })}>
            <ReloadIcon aria-hidden className={`h-3 w-3${todasLendo ? " anexo-girando" : ""}`} />
            <span>{todasLendo ? "Lendo…" : "Atualizar todas"}</span>
          </button>
        )}
      </div>}
      <ul className="w-uso">
        {visiveis.map((conta) => (
          <li key={conta.id} className={`w-uso-conta${conta.id === contaAtiva ? " w-uso-conta-ativa" : ""}`}>
            <span className="w-uso-nome">
              <AgentIcon provider={conta.provider} size={12} className="shrink-0" />
              <span className="w-uso-texto">{conta.name}</span>
              <span className="w-uso-agente">{AGENTE[conta.provider] ?? conta.provider}</span>
            </span>
            {erros[conta.id] && <span className="w-uso-vazio w-uso-erro" role="alert">{erros[conta.id]}</span>}
            {conta.usage && conta.usage.status !== "unavailable" ? (
              <>
                <Janela rotulo="5H" janela={conta.usage.primary} />
                <Janela rotulo="Semana" janela={conta.usage.secondary} />
              </>
            ) : (
              <span className="w-uso-vazio">{conta.usage?.reason ?? "Sem leitura de uso ainda"}</span>
            )}
            {AGENTES_COM_USO.includes(conta.provider) && (
              <button type="button" className="w-uso-atualizar" disabled={atualizando.has(conta.id)}
                aria-label={`Atualizar uso de ${conta.name}`} title="Buscar o uso de novo"
                onClick={() => void atualizar(conta.id)}>
                <ReloadIcon aria-hidden className={`h-3 w-3${atualizando.has(conta.id) ? " anexo-girando" : ""}`} />
                <span>{atualizando.has(conta.id) ? "Lendo…" : "Atualizar"}</span>
              </button>
            )}
          </li>
        ))}
      </ul>
    </>
  );
}
