import { useEffect, useRef, useState } from "react";
import { AgentIcon } from "../components/ui/AgentIcon";
import { Button } from "../components/ui/Button";
import { ChatIcon, CheckIcon, SendIcon } from "../components/ui/PixelIcon";
import type { Escolha } from "./api";

/** Textos fixos da CLI (o que o agente escreve fica como veio). */
const TRADUCAO: Record<string, string> = {
  "Chat about this": "Responder com minhas palavras",
  "Review your answers": "Revise suas respostas",
  "Submit answers": "Enviar respostas",
  "Cancel": "Cancelar",
  "Ready to submit your answers?": "Tudo certo para enviar?",
};
const t = (texto: string) => TRADUCAO[texto] ?? texto;
const LIVRE = "Chat about this";

/** Revisão no fim de várias perguntas: "● pergunta" / "→ resposta" viram pares. */
function respostasDaRevisao(detalhe: string | null): { pergunta: string; resposta: string }[] {
  const pares: { pergunta: string; resposta: string }[] = [];
  for (const linha of (detalhe ?? "").split("\n")) {
    if (linha.startsWith("●")) pares.push({ pergunta: linha.slice(1).trim(), resposta: "" });
    else if (linha.startsWith("→") && pares.length) pares[pares.length - 1].resposta = linha.slice(1).trim();
  }
  return pares;
}

interface Props {
  escolha: Escolha;
  provider?: string | null;
  busy: boolean;
  /** Número da opção (escolhe, ou marca/desmarca no marcar-várias); `null` fecha (Esc). */
  onEscolher: (opcao: number | null) => void;
  /** Marcar-várias: segue para a próxima pergunta ou para a revisão (Tab). */
  onAvancar: () => void;
  /** Várias perguntas seguidas: volta para a anterior, para trocar a resposta (← no terminal). */
  onVoltar?: () => void;
}

/**
 * Pergunta que o agente (ou a própria CLI) fez no terminal, respondida pela conversa: uma opção por
 * linha com a explicação embaixo, caixas de marcar quando dá para escolher várias, as etapas de
 * várias perguntas seguidas e a revisão final em lista.
 */
export function CartaoDePergunta({ escolha, provider, busy, onEscolher, onAvancar, onVoltar }: Props) {
  const revisao = escolha.pergunta === "Review your answers";
  const respostas = revisao ? respostasDaRevisao(escolha.detalhe) : [];
  const detalhe = revisao ? null : escolha.detalhe;
  // A tela do terminal só confirma a marca depois da ida e volta ao PC; o cartão marca na hora e,
  // no marcar-várias, enfileira os toques feitos enquanto o anterior ainda está a caminho.
  const [desejo, setDesejo] = useState<Record<number, boolean>>({});
  const fila = useRef<number[]>([]);
  useEffect(() => {
    if (!busy && fila.current.length) onEscolher(fila.current.shift()!);
  }, [busy, onEscolher]);
  const marcada = (o: Escolha["opcoes"][number]) => desejo[o.numero] ?? Boolean(o.marcada);
  function tocar(o: Escolha["opcoes"][number]) {
    setDesejo((d) => ({ ...d, [o.numero]: escolha.multipla ? !(d[o.numero] ?? Boolean(o.marcada)) : true }));
    if (busy) fila.current.push(o.numero);
    else onEscolher(o.numero);
  }
  const comuns = escolha.opcoes.filter((o) => o.rotulo !== LIVRE);
  const livre = escolha.opcoes.find((o) => o.rotulo === LIVRE);
  const marcadas = comuns.filter(marcada).length;

  return (
    <section className="pergunta" role="group" aria-label={t(escolha.pergunta)} aria-busy={busy}>
      <header className="pergunta-topo">
        <span className="pergunta-avatar" aria-hidden><AgentIcon provider={provider} size={14} /></span>
        <span className="pergunta-quem">{revisao ? "Antes de enviar" : "O agente quer saber"}</span>
        {escolha.etapas && escolha.etapas.length > 1 && (
          <ol className="pergunta-etapas" aria-label="Perguntas">
            {escolha.etapas.map((etapa) => (
              <li key={etapa.titulo} className={etapa.respondida ? "is-feita" : undefined}>
                {etapa.respondida && <CheckIcon aria-hidden className="h-3 w-3" />}{etapa.titulo}
              </li>
            ))}
          </ol>
        )}
      </header>

      <h3 className="pergunta-titulo">{t(escolha.pergunta)}</h3>
      {detalhe && <p className="pergunta-detalhe">{detalhe}</p>}
      {escolha.multipla && <p className="pergunta-dica">Marque quantas quiser{marcadas ? ` · ${marcadas} marcada${marcadas > 1 ? "s" : ""}` : ""}</p>}

      {revisao && respostas.length > 0 && (
        <dl className="pergunta-revisao">
          {respostas.map((par) => <div key={par.pergunta}><dt>{par.pergunta}</dt><dd>{par.resposta || "—"}</dd></div>)}
        </dl>
      )}

      {revisao ? (
        <div className="pergunta-acoes">
          {comuns.map((opcao) => (
            <Button key={opcao.numero} variant={opcao.numero === 1 ? "primary" : "ghost"} disabled={busy} onClick={() => onEscolher(opcao.numero)}>
              {opcao.numero === 1 && <SendIcon aria-hidden className="h-3.5 w-3.5" />}{t(opcao.rotulo)}
            </Button>
          ))}
        </div>
      ) : (
        <ul className="pergunta-opcoes">
          {comuns.map((opcao) => (
            <li key={opcao.numero}>
              <button type="button" disabled={busy && !escolha.multipla} onClick={() => tocar(opcao)}
                className={`pergunta-opcao${marcada(opcao) ? " is-marcada" : ""}`}
                {...(escolha.multipla ? { role: "checkbox", "aria-checked": marcada(opcao) } : {})}>
                <span className="pergunta-marca" aria-hidden>
                  {escolha.multipla ? (marcada(opcao) ? <CheckIcon className="h-3 w-3" /> : null) : opcao.numero}
                </span>
                <span className="pergunta-opcao-texto">
                  <b>{t(opcao.rotulo)}</b>
                  {opcao.descricao && <small>{opcao.descricao}</small>}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      <footer className="pergunta-rodape">
        {livre && !revisao && (
          <button type="button" className="pergunta-livre" disabled={busy} onClick={() => onEscolher(livre.numero)}>
            <ChatIcon aria-hidden className="h-3.5 w-3.5" />{t(livre.rotulo)}
          </button>
        )}
        <span className="flex-1" />
        {/* Só depois de alguma respondida: na primeira não há para onde voltar. */}
        {onVoltar && escolha.etapas?.some((e) => e.respondida) && (
          <Button variant="ghost" size="sm" disabled={busy} onClick={onVoltar}>← Voltar</Button>
        )}
        <Button variant="ghost" size="sm" disabled={busy} onClick={() => onEscolher(null)}>Fechar</Button>
        {escolha.multipla && (
          <Button variant="primary" size="sm" disabled={busy || marcadas === 0} onClick={onAvancar}>Continuar →</Button>
        )}
      </footer>
    </section>
  );
}
