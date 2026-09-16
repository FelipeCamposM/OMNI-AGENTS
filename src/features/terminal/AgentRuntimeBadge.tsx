import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

export interface AgentRuntime {
  model: string | null;
  effort: string | null;
  cli_version: string | null;
  /** `sessao` = foi isto que respondeu; `config` = é o que está configurado, a sessão ainda não
   *  respondeu nada. A diferença muda o que a etiqueta pode afirmar. */
  source?: "sessao" | "config";
}

/** Quanto tempo entre leituras. É um `tail` de arquivo local, mas o dado só muda quando o usuário
 *  roda `/model` — checar a cada segundo, como o poll do terminal, seria desperdício. */
const INTERVALO_MS = 5_000;

const ESFORCO_PT: Record<string, string> = {
  none: "sem esforço extra",
  minimal: "esforço mínimo",
  low: "esforço baixo",
  medium: "esforço médio",
  high: "esforço alto",
  max: "esforço máximo",
};

/**
 * `claude-opus-5` → `Opus 5`; `claude-sonnet-4-5-20250929` → `Sonnet 4.5`; `gpt-6-astra` → `GPT-6 Astra`.
 *
 * Números seguidos viram versão com ponto (`4-5` → `4.5`) porque é assim que a Anthropic nomeia o
 * modelo em texto corrido; o carimbo de data (8 dígitos) sai fora — ele identifica o build, não o
 * modelo, e não cabe num canto de tela.
 */
export function nomeCurtoDoModelo(id: string): string {
  const partes = id
    .split("-")
    .filter((parte) => parte.length > 0 && !/^\d{8}$/.test(parte))
    .filter((parte) => !["claude", "anthropic", "openai", "latest"].includes(parte.toLowerCase()));

  const saida: string[] = [];
  for (const parte of partes) {
    const anterior = saida[saida.length - 1];
    if (/^\d+$/.test(parte) && anterior && /\d$/.test(anterior)) {
      saida[saida.length - 1] = `${anterior}.${parte}`;
      continue;
    }
    saida.push(/^gpt$/i.test(parte) ? "GPT" : parte.charAt(0).toUpperCase() + parte.slice(1));
  }
  return saida.join(" ") || id;
}

export function rotuloDoEsforco(effort: string): string {
  return ESFORCO_PT[effort.toLowerCase()] ?? `esforço ${effort}`;
}

/**
 * Etiqueta discreta no canto inferior direito da pane: qual modelo está atendendo aquela aba e com
 * qual esforço.
 *
 * O OMNI não escolhe o modelo — a CLI escolhe, e pode trocar no meio da conversa. Por isso o dado é
 * lido do registro que a própria CLI grava a cada turno, e não de configuração: configuração diz o
 * que foi pedido um dia, o registro diz o que respondeu agora.
 *
 * Some por completo quando não há o que dizer (CLI sem registro, sessão ainda sem turno). Uma
 * etiqueta escrita "modelo desconhecido" ocuparia o mesmo espaço sem informar nada.
 */
export function AgentRuntimeBadge({
  provider,
  profileId,
  cwd,
  externalSessionId,
  className,
}: {
  provider: string;
  profileId?: string;
  cwd: string;
  externalSessionId?: string;
  className?: string;
}) {
  const [runtime, setRuntime] = useState<AgentRuntime | null>(null);

  useEffect(() => {
    let cancelado = false;
    let timer: number | undefined;

    async function ler() {
      try {
        const valor = await invoke<AgentRuntime | null>("agent_runtime", {
          provider,
          profileId: profileId ?? null,
          cwd,
          externalSessionId: externalSessionId ?? null,
        });
        if (!cancelado) setRuntime(valor);
      } catch {
        // Fora do Tauri, perfil sumido, arquivo ilegível: a etiqueta é enfeite informativo, nunca
        // pode virar erro na tela de quem só quer usar o terminal.
        if (!cancelado) setRuntime(null);
      }
      if (!cancelado) timer = window.setTimeout(ler, INTERVALO_MS);
    }

    void ler();
    return () => {
      cancelado = true;
      if (timer) window.clearTimeout(timer);
    };
  }, [provider, profileId, cwd, externalSessionId]);

  // Cinto e suspensório: o Rust já descarta `<synthetic>` (mensagem que a CLI fabrica ao ser
  // interrompida), mas qualquer marcador entre `<>` que apareça no futuro não pode virar nome de
  // modelo na tela — foi assim que "<SYNTHETIC>" chegou ao canto da pane uma vez.
  if (!runtime) return null;
  const modeloCru = runtime.model?.startsWith("<") ? null : runtime.model;
  if (!modeloCru && !runtime.effort) return null;

  const modelo = modeloCru ? nomeCurtoDoModelo(modeloCru) : null;
  const esforco = runtime.effort ? rotuloDoEsforco(runtime.effort) : null;
  const configurado = runtime.source === "config";
  const detalhe = [
    modeloCru,
    runtime.cli_version && `CLI ${runtime.cli_version}`,
    configurado ? "configurado — esta sessão ainda não respondeu" : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div
      className={[
        // Sem `pointer-events-none`: o tooltip (id cru do modelo, versão da CLI, aviso de
        // "configurado") só aparece no hover, e bloquear o ponteiro o tornaria inalcançável.
        "cursor-default select-none bg-[#0e0e14]/90 px-2 py-1 text-[10px] uppercase text-text-muted",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
      title={detalhe}
      aria-label={`${configurado ? "Modelo configurado" : "Modelo em uso"}: ${modelo ?? "desconhecido"}${
        esforco ? `, ${esforco}` : ""
      }`}
    >
      {/* Ponto de interrogação em vez de texto extra: a etiqueta tem que caber num canto, e a
          explicação inteira já vive no tooltip. */}
      {configurado && <span aria-hidden="true">? </span>}
      {modelo && <span className="text-text-secondary">{modelo}</span>}
      {modelo && esforco && <span aria-hidden="true"> · </span>}
      {esforco}
    </div>
  );
}
