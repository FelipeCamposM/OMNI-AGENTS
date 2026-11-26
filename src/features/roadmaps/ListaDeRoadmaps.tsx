// Fork (Roadmaps): a lista de roadmaps, como pastas (criar, renomear, arquivar, reordenar).
import { useState, type DragEvent, type FormEvent } from "react";
import { SegmentedControl } from "../../components/ui";
import { ArchiveIcon, EditIcon, FireIcon, LoaderIcon, MapIcon } from "../../components/ui/PixelIcon";
import { novoRoadmap } from "./acoes";
import { EscolhaDaIa, EscolhaDeCorEIcone, IconeDoRoadmap, textoDoErro } from "./comuns";
import { mudarMeta, reordenar } from "./loja";
import { CORES, type IaEscolhida, type MetaDoRoadmap } from "./tipos";

const FASE: Record<MetaDoRoadmap["fase"], string> = { entrevista: "Entrevista em andamento", plano: "Plano para revisar", ativo: "" };

export function ListaDeRoadmaps({ lista, onAbrir }: { lista: MetaDoRoadmap[]; onAbrir: (id: string) => void }) {
  const [filtro, setFiltro] = useState<"ativos" | "arquivados">("ativos");
  const [criando, setCriando] = useState(false);
  const [editando, setEditando] = useState<string | null>(null);
  const [arrastando, setArrastando] = useState<string | null>(null);
  const [erro, setErro] = useState("");
  const visiveis = lista.filter((m) => (filtro === "ativos" ? !m.arquivado : m.arquivado));
  const ativos = lista.filter((m) => !m.arquivado);

  const mover = (id: string, destino: string) => {
    if (id === destino) return;
    const ids = ativos.map((m) => m.id).filter((i) => i !== id);
    const pos = ids.indexOf(destino);
    const de = ativos.findIndex((m) => m.id === id), para = ativos.findIndex((m) => m.id === destino);
    ids.splice(de < para ? pos + 1 : pos, 0, id);
    void reordenar([...ids, ...lista.filter((m) => m.arquivado).map((m) => m.id)]).catch((e) => setErro(textoDoErro(e)));
  };
  const deslocar = (id: string, passo: -1 | 1) => {
    const i = ativos.findIndex((m) => m.id === id);
    const alvo = ativos[i + passo];
    if (alvo) mover(id, alvo.id);
  };

  return (
    <div className="roadmaps-lista es-rolagem h-full">
      <div className="es-miolo">
        <div className="es-barra-de-ferramentas">
          <SegmentedControl value={filtro} onChange={setFiltro} grow={false}
            options={[{ value: "ativos", label: `Ativos (${ativos.length})` }, { value: "arquivados", label: `Arquivados (${lista.length - ativos.length})` }]} />
          <span className="es-espaco" />
          <button type="button" className="es-botao" onClick={() => setCriando(true)}>Novo roadmap</button>
        </div>
        {erro && <p role="alert" className="es-erro">{erro}</p>}
        {criando && <NovoRoadmap onCancelar={() => setCriando(false)} onCriado={(id) => { setCriando(false); onAbrir(id); }} />}
        {visiveis.length === 0 && !criando && (
          <div className="es-vazio">
            <span className="es-vazio-icone" aria-hidden="true"><MapIcon size={28} /></span>
            {filtro === "ativos"
              ? <><p className="es-vazio-titulo">Nenhum roadmap ainda</p><p className="es-dica">A IA faz algumas perguntas e monta um caminho de etapas diárias.</p>
                  <button type="button" className="es-botao" onClick={() => setCriando(true)}>Criar o primeiro</button></>
              : <p className="es-dica">Nada arquivado.</p>}
          </div>
        )}
        <ul className="roadmaps-grade" aria-label="Roadmaps">
          {visiveis.map((m) => (
            <li key={m.id}
              draggable={filtro === "ativos" && editando !== m.id}
              onDragStart={(e: DragEvent) => { setArrastando(m.id); e.dataTransfer.effectAllowed = "move"; }}
              onDragOver={(e: DragEvent) => { if (arrastando) e.preventDefault(); }}
              onDrop={(e: DragEvent) => { e.preventDefault(); if (arrastando) mover(arrastando, m.id); setArrastando(null); }}
              onDragEnd={() => setArrastando(null)}
              className={`roadmap-pasta glass ${arrastando === m.id ? "is-arrastando" : ""}`}>
              {editando === m.id
                ? <EditarRoadmap meta={m} onPronto={() => setEditando(null)} />
                : <CartaoDoRoadmap meta={m} onAbrir={() => onAbrir(m.id)} onEditar={() => setEditando(m.id)}
                    onMover={filtro === "ativos" ? (passo) => deslocar(m.id, passo) : undefined}
                    onArquivar={() => void mudarMeta(m.id, { arquivado: !m.arquivado }).catch((e) => setErro(textoDoErro(e)))} />}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function CartaoDoRoadmap({ meta, onAbrir, onEditar, onArquivar, onMover }: { meta: MetaDoRoadmap; onAbrir: () => void; onEditar: () => void; onArquivar: () => void; onMover?: (passo: -1 | 1) => void }) {
  const { resumo } = meta;
  const pct = resumo.etapas ? Math.round((resumo.concluidas / resumo.etapas) * 100) : 0;
  return (
    <>
      <button className="roadmap-pasta-abrir" onClick={onAbrir} aria-label={`Abrir ${meta.nome}`}>
        <IconeDoRoadmap icone={meta.icone} cor={meta.cor} />
        <span className="min-w-0 flex-1 text-left">
          <span className="block truncate font-medium text-text-primary">{meta.nome}</span>
          <span className="block truncate text-xs text-text-muted">
            {FASE[meta.fase] || (resumo.proximaEtapa ? `Próxima: ${resumo.proximaEtapa}` : resumo.etapas ? "Caminho concluído" : "")}
          </span>
        </span>
      </button>
      {meta.fase === "ativo" && (
        <div className="space-y-1.5 px-3 pb-1">
          <div className="roadmap-barra" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="Progresso">
            <span style={{ width: `${pct}%`, background: meta.cor }} />
          </div>
          <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-text-secondary">
            <span>{resumo.concluidas} de {resumo.etapas} etapas</span>
            <span className="inline-flex items-center gap-1" title="Dias seguidos estudando">{resumo.sequencia > 0 ? <><FireIcon size={12} className="es-fogo" aria-hidden="true" />{resumo.sequencia} {resumo.sequencia === 1 ? "dia" : "dias"}</> : "Sem sequência"}</span>
            {resumo.cardsParaHoje > 0 && <span className="text-accent">{resumo.cardsParaHoje} para revisar</span>}
          </div>
        </div>
      )}
      <div className="roadmap-pasta-acoes">
        {onMover && <>
          <button className="roadmap-mini" aria-label={`Mover ${meta.nome} para antes`} onClick={() => onMover(-1)}>↑</button>
          <button className="roadmap-mini" aria-label={`Mover ${meta.nome} para depois`} onClick={() => onMover(1)}>↓</button>
        </>}
        <button className="roadmap-mini" aria-label={`Editar ${meta.nome}`} onClick={onEditar}><EditIcon size={14} /></button>
        <button className="roadmap-mini" aria-label={meta.arquivado ? `Desarquivar ${meta.nome}` : `Arquivar ${meta.nome}`} onClick={onArquivar}><ArchiveIcon size={14} /></button>
      </div>
    </>
  );
}

function EditarRoadmap({ meta, onPronto }: { meta: MetaDoRoadmap; onPronto: () => void }) {
  const [nome, setNome] = useState(meta.nome);
  const [cor, setCor] = useState(meta.cor);
  const [icone, setIcone] = useState(meta.icone);
  const [ia, setIa] = useState<IaEscolhida>(meta.ia);
  const [erro, setErro] = useState("");
  const salvar = (e: FormEvent) => {
    e.preventDefault();
    void mudarMeta(meta.id, { nome: nome.trim().slice(0, 80) || meta.nome, cor, icone, ia }).then(onPronto).catch((x) => setErro(textoDoErro(x)));
  };
  return (
    <form className="es-form p-3" onSubmit={salvar} onKeyDown={(e) => { if (e.key === "Escape") onPronto(); }}>
      <input className="es-campo" aria-label="Nome do roadmap" value={nome} onChange={(e) => setNome(e.target.value)} autoFocus maxLength={80} />
      <EscolhaDeCorEIcone cor={cor} icone={icone} onCor={setCor} onIcone={setIcone} />
      <EscolhaDaIa valor={ia} onChange={setIa} />
      {erro && <p role="alert" className="es-erro">{erro}</p>}
      <div className="es-form-acoes">
        <button type="button" className="es-botao is-discreto" onClick={onPronto}>Cancelar</button>
        <button type="submit" className="es-botao">Salvar</button>
      </div>
    </form>
  );
}

function NovoRoadmap({ onCancelar, onCriado }: { onCancelar: () => void; onCriado: (id: string) => void }) {
  const [pedido, setPedido] = useState("");
  const [nome, setNome] = useState("");
  const [cor, setCor] = useState<string>(CORES[0]);
  const [icone, setIcone] = useState("livro");
  const [ia, setIa] = useState<IaEscolhida>({ cli: "claude" });
  const [criando, setCriando] = useState(false);
  const [erro, setErro] = useState("");
  const criar = async (e: FormEvent) => {
    e.preventDefault();
    if (pedido.trim().length < 3 || criando) return;
    setCriando(true); setErro("");
    try {
      // A entrevista faz a primeira pergunta ao abrir.
      const meta = await novoRoadmap({ nome: nome.trim() || pedido.trim().slice(0, 60), cor, icone, ia, pedido });
      onCriado(meta.id);
    } catch (x) { setErro(textoDoErro(x)); setCriando(false); }
  };
  return (
    <form className="es-painel is-destaque es-form" onSubmit={(e) => void criar(e)} aria-label="Novo roadmap" onKeyDown={(e) => { if (e.key === "Escape") onCancelar(); }}>
      <p className="es-rotulo"><MapIcon size={14} aria-hidden="true" />Novo roadmap</p>
      <label className="es-etiqueta">
        O que você quer estudar?
        <textarea className="es-campo" value={pedido} onChange={(e) => setPedido(e.target.value)} rows={2} autoFocus maxLength={2000}
          placeholder="Ex.: melhorar em vendas B2B; passar em Cálculo II; inglês para reuniões" />
      </label>
      <label className="es-etiqueta">
        Nome (opcional)
        <input className="es-campo" value={nome} onChange={(e) => setNome(e.target.value)} maxLength={80} placeholder="Vendas" />
      </label>
      <EscolhaDeCorEIcone cor={cor} icone={icone} onCor={setCor} onIcone={setIcone} />
      <EscolhaDaIa valor={ia} onChange={setIa} />
      {erro && <p role="alert" className="es-erro">{erro}</p>}
      <div className="es-form-acoes">
        <button type="button" className="es-botao is-discreto" onClick={onCancelar}>Cancelar</button>
        <button type="submit" className="es-botao" disabled={criando || pedido.trim().length < 3}>
          {criando && <LoaderIcon size={14} className="animate-spin" aria-hidden="true" />}Começar entrevista
        </button>
      </div>
    </form>
  );
}
