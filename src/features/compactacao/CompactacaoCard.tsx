import { useEffect, useState } from "react";
import { Card, SegmentedControl } from "../../components/ui";
import { ArchiveIcon } from "../../components/ui/PixelIcon";
import { Titulo } from "../relatorios/RelatoriosIa";
import { lerCompactacao, salvarCompactacao, type Compactacao } from "./compactacao";

/**
 * Configurações → Agentes → Compactação. Cada passo do agente relê a conversa inteira, então o
 * tamanho dela é o que mais gasta da cota; aqui fica quando o Claude resume a conversa sozinho e o
 * que o OMNI faz em volta da troca de conta.
 */
export function CompactacaoCard() {
  const [ajuste, setAjuste] = useState<Compactacao | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => { void lerCompactacao().then(setAjuste); }, []);

  async function mudar(parte: Partial<Compactacao>) {
    if (!ajuste) return;
    const novo = { ...ajuste, ...parte };
    setAjuste(novo);
    try { setErro(null); setAjuste(await salvarCompactacao(novo)); }
    catch (motivo) { setErro(motivo instanceof Error ? motivo.message : String(motivo)); setAjuste(ajuste); }
  }

  return (
    <Card title={<Titulo icone={ArchiveIcon}>Compactação do contexto (Claude)</Titulo>} className="ag-compactacao">
      <p className="text-xs text-text-secondary">
        Cada passo do agente relê a conversa inteira. Compactar troca as mensagens antigas por um resumo e deixa cada passo
        mais barato. A compactação automática fica sempre ligada; o tamanho vale para as conversas abertas ou reabertas
        depois de mudar.
      </p>
      {!ajuste ? <p className="text-xs text-text-muted">Lendo…</p> : (
        <>
          <SegmentedControl className="ag-ajuste" grow={false}
            label="Compactar sozinho ao chegar em"
            description="400 mil gasta bem menos da cota; 1 milhão guarda mais detalhe antes de resumir."
            options={[{ value: 400_000, label: "400 mil tokens" }, { value: 1_000_000, label: "1 milhão" }]}
            value={ajuste.janela}
            onChange={(janela) => void mudar({ janela })}
          />
          <SegmentedControl className="ag-ajuste" grow={false}
            label="Antes de acabar a cota"
            description="Quando o agente acaba de responder numa conversa aberta e a conta passou do limite abaixo, o OMNI compacta ainda nesta conta (que já tem a conversa em cache). Só conversas com mais da metade do tamanho acima; abrir uma conversa parada nunca compacta nada."
            options={[{ value: "sim", label: "Compactar" }, { value: "nao", label: "Não" }]}
            value={ajuste.antes_do_limite ? "sim" : "nao"}
            onChange={(v) => void mudar({ antes_do_limite: v === "sim" })}
          />
          {ajuste.antes_do_limite && (
            <SegmentedControl className="ag-ajuste" grow={false}
              label="Uso das 5 horas que dispara"
              options={[75, 80, 85, 90, 95].map((n) => ({ value: n, label: `${n}%` }))}
              value={ajuste.limiar}
              onChange={(limiar) => void mudar({ limiar })}
            />
          )}
          <SegmentedControl className="ag-ajuste" grow={false}
            label="Depois de trocar de conta"
            description="Só quando o limite chega no meio de uma tarefa e a conversa passa de 150 mil tokens: a conta nova resume uma vez e depois continua. Conversa parada que trocou de conta fica como está."
            options={[{ value: "sim", label: "Compactar e continuar" }, { value: "nao", label: "Só continuar" }]}
            value={ajuste.depois_da_troca ? "sim" : "nao"}
            onChange={(v) => void mudar({ depois_da_troca: v === "sim" })}
          />
        </>
      )}
      {erro && <p role="alert" className="border-l-2 border-danger pl-3 text-xs text-danger">{erro}</p>}
    </Card>
  );
}
