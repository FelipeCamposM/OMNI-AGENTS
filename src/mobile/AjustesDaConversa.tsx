import { useCallback, useEffect, useState } from "react";
import { AgentIcon } from "../components/ui/AgentIcon";
import { ChartIcon, LoaderIcon, PlayIcon, ReloadIcon, SparkleIcon } from "../components/ui/PixelIcon";
import { Select } from "../components/ui/Select";
import { ApiError, request } from "./api";
import { tokensCurtos } from "../features/compactacao/compactacao";

/** `GET /conversas/{id}/opcoes`: o que dá para escolher nesta conversa e o que está valendo agora. */
export interface Opcoes {
  provider: string;
  profile_id: string | null;
  /** Modelo e esforço que a sessão usou por último (lidos do transcript). */
  model: string | null;
  effort: string | null;
  profiles: { id: string; name: string }[];
  /** `section` agrupa no menu (o "Mais modelos" do Claude); `hint` é a linha de baixo. */
  models: { id: string; label: string; efforts: string[]; hint?: string; section?: string }[];
  /** Sem id de sessão ainda (nenhuma mensagem), não há o que retomar com outros ajustes. */
  can_resume: boolean;
  /** Tokens que a última resposta leu (o tamanho da conversa agora); `null` logo após compactar. */
  context_tokens?: number | null;
  /** Onde o Claude compacta sozinho (Configurações → Compactação). Só Claude; engine antigo não manda. */
  context_window?: number | null;
}
export interface Ajustes { profile_id: string | null; model: string | null; effort: string | null }

const ESFORCO: Record<string, string> = {
  low: "Baixo", medium: "Médio", high: "Alto", xhigh: "Muito alto", max: "Máximo", ultra: "Ultra",
};

/** `claude-opus-5-5` → `opus`: o transcript grava o id completo, a lista oferece o apelido. */
function modeloDaLista(opcoes: Opcoes): string {
  const atual = opcoes.model?.toLowerCase();
  if (!atual) return "";
  return opcoes.models.find((m) => m.id.toLowerCase() === atual)?.id
    ?? opcoes.models.find((m) => atual.includes(m.id.toLowerCase()))?.id
    ?? "";
}

/**
 * Conta, modelo e esforço da conversa aberta, na faixa acima do campo de texto. Trocar qualquer um
 * reabre a conversa (`--resume`) com o ajuste novo: leva alguns segundos e nada se perde. Só com o
 * agente parado — no meio de um turno isso mataria o trabalho.
 */
/**
 * Trocar conta/modelo reabre a sessão: vale com o campo livre **e** com o agente parado sem campo
 * reconhecido (tela nova da CLI, limite de uso). Só o agente trabalhando bloqueia — reabrir mataria o
 * turno. Antes exigia o campo livre, e uma tela de limite não reconhecida impedia justo a troca de conta.
 */
export function podeReabrir(conversa: { state: string | null; capabilities?: { prompt: boolean } | null; notice?: string | null }): boolean {
  return Boolean(conversa.capabilities?.prompt) || conversa.notice === "usage_limit" || (conversa.state !== null && conversa.state !== "working");
}

export function AjustesDaConversa({ conversaId, pronto, onAplicar, onRetomar }: {
  conversaId: string;
  pronto: boolean;
  onAplicar: (ajustes: Ajustes) => Promise<void>;
  /** Conversa sem sessão aberta: em vez de "Aplicar", um "Retomar conversa" que abre a sessão já
   *  com a conta, o modelo e o esforço escolhidos. */
  onRetomar?: (ajustes: Ajustes) => Promise<void>;
}) {
  const [opcoes, setOpcoes] = useState<Opcoes | null>(null);
  const [conta, setConta] = useState("");
  const [modelo, setModelo] = useState("");
  const [esforco, setEsforco] = useState("");
  const [aplicando, setAplicando] = useState(false);
  // Engine que ainda não tem a rota (o front atualiza sozinho em dev; o engine só ao reiniciar).
  const [engineAntigo, setEngineAntigo] = useState(false);

  const carregar = useCallback(async () => {
    try {
      const lidas = await request<Opcoes>(`/conversas/${encodeURIComponent(conversaId)}/opcoes`);
      // Resposta fora do formato (engine antigo, proxy) some com a faixa — nunca derruba a conversa.
      if (!Array.isArray(lidas?.models) || !Array.isArray(lidas?.profiles)) { setOpcoes(null); return; }
      setOpcoes(lidas);
      setEngineAntigo(false);
      setConta(lidas.profile_id ?? "");
      setModelo(modeloDaLista(lidas));
      setEsforco(lidas.effort ?? "");
    } catch (motivo) {
      setOpcoes(null);
      setEngineAntigo(motivo instanceof ApiError && motivo.status === 404);
    }
  }, [conversaId]);
  // Relida a cada fim de turno: a primeira mensagem é que dá à conversa um id para retomar (o
  // Antigravity só cria a conversa nela), e o modelo em uso pode ter mudado pelo terminal.
  useEffect(() => { void carregar(); }, [carregar, pronto]);

  if (engineAntigo) {
    return <span className="m-chip-aviso" title="O engine em execução é anterior a esta tela">Reinicie o OMNI para trocar conta e modelo</span>;
  }
  if (!opcoes || opcoes.models.length === 0 && opcoes.profiles.length < 2) return null;

  const esforcos = opcoes.models.find((m) => m.id === modelo)?.efforts
    ?? opcoes.models[0]?.efforts ?? [];
  const mudou = conta !== (opcoes.profile_id ?? "") || modelo !== modeloDaLista(opcoes) || esforco !== (opcoes.effort ?? "");
  const bloqueado = onRetomar ? !opcoes.can_resume || aplicando : !pronto || !opcoes.can_resume || aplicando;
  const motivo = !opcoes.can_resume ? "Mande a primeira mensagem antes de trocar."
    : !pronto ? "Espere o agente terminar para trocar." : undefined;

  async function aplicar() {
    setAplicando(true);
    try {
      // O erro já aparece no chat (quem chama mostra); aqui só não marca como aplicado.
      try { await (onRetomar ?? onAplicar)({ profile_id: conta || null, model: modelo || null, effort: esforco || null }); } catch { return; }
      // A sessão reabre em segundo plano; o modelo novo só aparece no transcript depois da próxima
      // resposta, então a escolha fica como está até lá.
      setOpcoes((atual) => atual && { ...atual, profile_id: conta || null, model: modelo || null, effort: esforco || null });
    } finally {
      setAplicando(false);
    }
  }

  const iconeConta = <AgentIcon provider={opcoes.provider} size={12} className="shrink-0" />;
  const iconeModelo = <SparkleIcon aria-hidden className="h-3.5 w-3.5 shrink-0 text-text-muted" />;
  const iconeEsforco = <ChartIcon aria-hidden className="h-3.5 w-3.5 shrink-0 text-text-muted" />;

  return (
    <>
      {opcoes.context_window ? <ChipDeContexto usados={opcoes.context_tokens ?? null} janela={opcoes.context_window} /> : null}
      {opcoes.profiles.length > 1 && (
        <span className="m-chip" title={motivo ?? "Conta usada nesta conversa"}>
          <Select size="sm" value={conta} disabled={bloqueado} onChange={setConta} placeholder="Conta"
            options={opcoes.profiles.map((p) => ({ value: p.id, label: p.name, icon: iconeConta }))} />
        </span>
      )}
      {opcoes.models.length > 0 && (
        <span className="m-chip" title={motivo ?? "Modelo"}>
          <Select size="sm" value={modelo} disabled={bloqueado} onChange={setModelo}
            options={[{ value: "", label: "Modelo padrão", icon: iconeModelo },
              ...opcoes.models.map((m) => ({ value: m.id, label: m.label, hint: m.hint || undefined, section: m.section || undefined, icon: iconeModelo }))]} />
        </span>
      )}
      {esforcos.length > 0 && (
        <span className="m-chip" title={motivo ?? "Esforço do raciocínio"}>
          <Select size="sm" value={esforco} disabled={bloqueado} onChange={setEsforco}
            options={[{ value: "", label: "Esforço padrão", icon: iconeEsforco },
              ...esforcos.map((e) => ({ value: e, label: ESFORCO[e] ?? e, icon: iconeEsforco }))]} />
        </span>
      )}
      {onRetomar ? (
        <button type="button" className="m-chip-aplicar m-chip-retomar" disabled={bloqueado} onClick={() => void aplicar()}
          title={motivo ?? "Abre esta conversa de novo no PC, de onde parou, com a conta, o modelo e o esforço escolhidos"}>
          {aplicando ? <LoaderIcon aria-hidden className="anexo-girando h-3.5 w-3.5" /> : <PlayIcon aria-hidden className="h-3.5 w-3.5" />}
          {aplicando ? "Retomando…" : "Retomar conversa"}
        </button>
      ) : mudou && (
        <button type="button" className="m-chip-aplicar" disabled={bloqueado} onClick={() => void aplicar()}
          title="Reabre a conversa com estes ajustes — leva alguns segundos e nada se perde">
          {aplicando ? <LoaderIcon aria-hidden className="anexo-girando h-3.5 w-3.5" /> : <ReloadIcon aria-hidden className="h-3.5 w-3.5" />}
          {aplicando ? "Reabrindo…" : "Aplicar"}
        </button>
      )}
    </>
  );
}

/** Quanto da conversa já foi usado até a compactação automática. Atualiza a cada fim de turno. */
function ChipDeContexto({ usados, janela }: { usados: number | null; janela: number }) {
  const fracao = usados === null ? 0 : Math.min(1, usados / janela);
  const nivel = fracao >= 0.85 ? "alto" : fracao >= 0.6 ? "medio" : "baixo";
  const texto = usados === null ? "Contexto compactado" : `Contexto ${tokensCurtos(usados)} / ${tokensCurtos(janela)}`;
  return (
    <span className="m-chip m-contexto" data-nivel={nivel}
      title={usados === null
        ? `A conversa acabou de ser resumida; o tamanho novo aparece na próxima resposta. Compacta sozinha perto de ${tokensCurtos(janela)} tokens.`
        : `${usados.toLocaleString("pt-BR")} tokens nesta conversa. Cada passo do agente relê tudo isso; perto de ${tokensCurtos(janela)} o Claude resume a conversa sozinho.`}>
      <span className="m-contexto-texto">{texto}</span>
      <span className="m-contexto-barra" aria-hidden><span style={{ width: `${fracao * 100}%` }} /></span>
    </span>
  );
}
