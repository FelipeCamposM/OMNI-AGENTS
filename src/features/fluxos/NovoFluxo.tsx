import { useState } from "react";
import { Button, Input } from "../../components/ui";
import { ClipboardNoteIcon, SparkleIcon } from "../../components/ui/PixelIcon";
import { ICONE } from "./NoDoFluxo";
import { etapasDoFluxo, fluxoVazio, MODELOS_DE_FLUXO, type Fluxo } from "./fluxosService";

const OPCOES = [{ id: "", nome: "Em branco", dica: "Só a Entrada e o Fim: você monta etapa por etapa.", fluxo: fluxoVazio }, ...MODELOS_DE_FLUXO];

/** Criar fluxo: nome, onde salvar e de onde começar (em branco, um modelo pronto, a IA ou um JSON). */
export function NovoFluxo({ temProjeto, onCriar, onIa, onJson, onCancelar }: {
  temProjeto: boolean;
  onCriar: (fluxo: Fluxo, escopo: "global" | "projeto") => void;
  onIa: () => void;
  onJson: () => void;
  onCancelar: () => void;
}) {
  const [escolha, setEscolha] = useState("");
  const [nome, setNome] = useState("");
  const [escopo, setEscopo] = useState<"global" | "projeto">("global");
  const opcao = OPCOES.find((o) => o.id === escolha) ?? OPCOES[0];

  function criar() {
    const fluxo = opcao.fluxo();
    onCriar({ ...fluxo, nome: nome.trim() || (opcao.id ? fluxo.nome : "Novo fluxo") }, escopo);
  }

  return (
    <div className="fx-dialogo-fundo" onMouseDown={(e) => { if (e.target === e.currentTarget) onCancelar(); }}>
      <form className="fx-dialogo is-largo fx-novo" role="dialog" aria-modal="true" aria-label="Novo fluxo"
        onSubmit={(e) => { e.preventDefault(); criar(); }} onKeyDown={(e) => { if (e.key === "Escape") onCancelar(); }}>
        <h3 className="pixel-text">Novo fluxo</h3>
        <Input autoFocus size="sm" value={nome} maxLength={80} onChange={(e) => setNome(e.target.value)} aria-label="Nome do fluxo"
          placeholder={opcao.id ? opcao.nome : "Nome do fluxo (ex.: Corrigir bug com QA)"} />

        <p className="fx-rotulo">Começar de</p>
        <div className="fx-novo-grade" role="group" aria-label="Começar de">
          {OPCOES.map((o) => (
            <button key={o.id || "branco"} type="button" aria-pressed={o.id === escolha} className="fx-novo-cartao"
              onClick={() => setEscolha(o.id)} onDoubleClick={() => { setEscolha(o.id); onCriar({ ...o.fluxo(), nome: nome.trim() || (o.id ? o.nome : "Novo fluxo") }, escopo); }}>
              <span className="fx-novo-etapas" aria-hidden>
                {etapasDoFluxo(o.fluxo()).map((n) => { const Icone = ICONE[n.tipo]; return <span key={n.id} className={`fx-etapa-num is-${n.tipo}`}><Icone className="h-3 w-3" /></span>; })}
              </span>
              <b>{o.nome}</b>
              <small>{o.dica}</small>
            </button>
          ))}
          <button type="button" className="fx-novo-cartao is-atalho" onClick={onIa}>
            <span className="fx-novo-etapas" aria-hidden><span className="fx-etapa-num"><SparkleIcon className="h-3 w-3" /></span></span>
            <b>Descrever para a IA</b><small>Conte o processo; a IA monta as etapas e cria os agentes que faltarem.</small>
          </button>
          <button type="button" className="fx-novo-cartao is-atalho" onClick={onJson}>
            <span className="fx-novo-etapas" aria-hidden><span className="fx-etapa-num is-pr"><ClipboardNoteIcon className="h-3 w-3" /></span></span>
            <b>Importar JSON</b><small>Colar um fluxo copiado de outro PC ou do “Copiar JSON”.</small>
          </button>
        </div>

        <div className="fx-novo-rodape">
          <div className="fx-suspenso-segmento" role="group" aria-label="Onde salvar">
            {(["global", "projeto"] as const).map((e) => (
              <button key={e} type="button" aria-pressed={escopo === e} disabled={e === "projeto" && !temProjeto}
                title={e === "global" ? "Vale para todos os projetos" : temProjeto ? "Só neste projeto" : "Abra um projeto"}
                onClick={() => setEscopo(e)}>{e === "global" ? "Global" : "Só neste projeto"}</button>
            ))}
          </div>
          <span className="flex-1" />
          <Button type="button" variant="ghost" onClick={onCancelar}>Cancelar</Button>
          <Button type="submit" variant="primary">Criar fluxo</Button>
        </div>
      </form>
    </div>
  );
}
