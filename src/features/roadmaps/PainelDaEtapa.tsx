// Fork (Roadmaps): a etapa clicada — resumo para estudar ali, fontes, tarefa, cards e exercícios.
import { StarFilledIcon } from "../../components/ui/PixelIcon";
import ReactMarkdown from "react-markdown";
import rehypeSanitize from "rehype-sanitize";
import remarkGfm from "remark-gfm";
import { useEffect, useRef, useState } from "react";
import { Button, Input, Textarea } from "../../components/ui";
import {
  chaves, comecarEtapa, concluir, criarCard, gerarCardsDaEtapa, gerarTarefasDaEtapa, lerResumoDaEtapa, marcarTarefa, prepararEtapa, reabrir,
} from "./acoes";
import { animarEntrada } from "./animacoes";
import { PedidoEmAndamento, linksNoRoadmap, textoDoErro } from "./comuns";
import { estrelas, xpDaEtapa } from "./jogo";
import { foiCancelado } from "./ia";
import { tarefaEmAndamento, useLoja } from "./loja";
import { etapasEmOrdem } from "./progresso";
import type { RoadmapAberto } from "./armazenamento";
import type { EstadoDaEtapa, Fonte } from "./tipos";

const TIPO: Record<Fonte["tipo"], string> = { artigo: "Artigo", video: "Vídeo", curso: "Curso", livro: "Livro", podcast: "Podcast", ferramenta: "Ferramenta", outro: "Link" };

/** Texto para colar no NotebookLM ("Adicionar fonte" → "Site" / "YouTube"): um link por linha. */
export function fontesParaNotebookLm(fontes: Fonte[]): string {
  return fontes.map((f) => f.url).join("\n");
}

export function PainelDaEtapa({ r, etapaId, estado, onPerguntar, onAbrirEtapa, onAbrirLink, onTelaCheia, emTelaCheia = false, semIa = false }: {
  r: RoadmapAberto; etapaId: string; estado: EstadoDaEtapa; onPerguntar: () => void; onAbrirEtapa: (id: string) => void;
  /** Link clicado (fonte ou no conteúdo): abre dentro do roadmap. */
  onAbrirLink: (url: string) => void;
  /** Abre a etapa em tela cheia (só na lateral da trilha). */
  onTelaCheia?: () => void;
  emTelaCheia?: boolean;
  /** Celular: a IA ainda roda só no computador (o resto funciona igual). */
  semIa?: boolean;
}) {
  useLoja();
  const id = r.meta.id;
  const etapas = r.plano ? etapasEmOrdem(r.plano) : [];
  const i = etapas.findIndex((e) => e.id === etapaId);
  const etapa = etapas[i];
  const modulo = r.plano?.modulos.find((m) => m.etapas.some((e) => e.id === etapaId));
  const [resumo, setResumo] = useState<string | null | undefined>(undefined);
  const [erro, setErro] = useState("");
  const [aviso, setAviso] = useState("");
  const [novoCard, setNovoCard] = useState<{ frente: string; verso: string } | null>(null);
  const raiz = useRef<HTMLDivElement>(null);
  const preparando = Boolean(tarefaEmAndamento(chaves.etapa(id, etapaId)));
  const gerandoCards = Boolean(tarefaEmAndamento(chaves.cards(id, etapaId)));
  const gerandoTarefas = Boolean(tarefaEmAndamento(chaves.tarefas(id, etapaId)));
  const cardsDaEtapa = r.cards.cards.filter((c) => c.etapaId === etapaId).length;

  useEffect(() => { const a = animarEntrada(raiz.current); return () => a?.cancel(); }, []);
  // Abrir a etapa disponível é começar ela.
  useEffect(() => {
    if (estado === "disponivel" && !r.somenteLeitura) void comecarEtapa(id, etapaId).catch(() => undefined);
  }, [estado, id, etapaId, r.somenteLeitura]);
  // O resumo mora no disco (`etapas/<id>.md`); relê quando a etapa fica pronta.
  useEffect(() => {
    let vivo = true;
    void lerResumoDaEtapa(id, etapaId).then((t) => { if (vivo) setResumo(t); }).catch(() => { if (vivo) setResumo(null); });
    return () => { vivo = false; };
  }, [id, etapaId, etapa?.preparada]);

  if (!etapa) return <p className="p-4 text-sm text-text-muted">Essa etapa não está mais no plano.</p>;

  const rodar = (acao: () => Promise<unknown>, depois?: (v: unknown) => void) => {
    setErro(""); setAviso("");
    void acao().then(depois).catch((e) => { if (!foiCancelado(e)) setErro(textoDoErro(e)); });
  };
  const comecar = () => { if (estado === "disponivel" || estado === "bloqueada") rodar(() => comecarEtapa(id, etapaId)); };
  const proxima = etapas[i + 1];

  return (
    <div ref={raiz} className={`roadmap-etapa-painel ${emTelaCheia ? "is-tela-cheia" : ""}`} data-links-proprios onClickCapture={linksNoRoadmap(onAbrirLink)}>
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-xs text-text-muted">{modulo?.titulo} · etapa {i + 1} de {etapas.length} · {etapa.minutos} min · {xpDaEtapa(etapa)} XP</p>
          <h2 className={`${emTelaCheia ? "text-xl" : "text-base"} font-semibold text-text-primary`}>{etapa.titulo}</h2>
          {etapa.objetivo && <p className="text-sm text-text-secondary">{etapa.objetivo}</p>}
          {estado === "concluida" && <p className="roadmap-estrelas" aria-label={`${estrelas(etapa, r.progresso, r.cards)} de 3 estrelas`}>{[1, 2, 3].map((n) => <StarFilledIcon key={n} size={14} className={n <= estrelas(etapa, r.progresso, r.cards) ? "is-ganha" : ""} />)}</p>}
        </div>
        {onTelaCheia && <Button size="sm" variant="glass" onClick={onTelaCheia} title="Estudar esta etapa em tela cheia, com a fonte aberta ao lado">⤢ Tela cheia</Button>}
      </div>

      {estado === "bloqueada" && (
        <div className="roadmap-aviso">
          <span className="flex-1">Esta etapa abre quando você concluir as anteriores.</span>
          <Button size="sm" variant="ghost" onClick={comecar}>Começar mesmo assim</Button>
        </div>
      )}
      {r.somenteLeitura && <p className="roadmap-aviso">Só leitura: salvo por uma versão mais nova do app.</p>}

      <PedidoEmAndamento chave={chaves.etapa(id, etapaId)} />
      <PedidoEmAndamento chave={chaves.cards(id, etapaId)} />
      <PedidoEmAndamento chave={chaves.tarefas(id, etapaId)} />
      {erro && <p role="alert" className="roadmap-erro">{erro}</p>}
      {aviso && <p role="status" className="text-xs text-success">{aviso}</p>}

      <section className="space-y-2">
        <h3 className="roadmap-subtitulo">Para estudar</h3>
        {resumo ? (
          <div className="roadmap-markdown"><ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeSanitize]}>{resumo}</ReactMarkdown></div>
        ) : resumo === undefined ? (
          <p className="text-xs text-text-muted">Abrindo…</p>
        ) : (
          <div className="roadmap-aviso">
            {semIa
              ? <span className="flex-1">O conteúdo desta etapa ainda não foi preparado. No computador, abra a etapa e toque em "Preparar etapa".</span>
              : <>
                <span className="flex-1">A IA pesquisa e escreve o conteúdo desta etapa para você estudar aqui.</span>
                <Button size="sm" variant="primary" disabled={preparando || r.somenteLeitura} onClick={() => { comecar(); rodar(() => prepararEtapa(id, etapaId)); }}>Preparar etapa</Button>
              </>}
          </div>
        )}
      </section>

      {etapa.fontes.length > 0 && (
        <section className="space-y-2">
          <h3 className="roadmap-subtitulo">Fontes</h3>
          <ul className="space-y-1.5">
            {etapa.fontes.map((f) => (
              <li key={f.url} className="roadmap-fonte">
                <a href={f.url} target="_blank" rel="noreferrer" className="font-medium text-accent hover:underline">{f.titulo}</a>
                <span className="roadmap-selo">{TIPO[f.tipo]}</span>
                <span className={`roadmap-selo ${f.gratis ? "is-gratis" : "is-pago"}`}>{f.gratis ? "Grátis" : "Pago"}</span>
                {(f.autor || f.nota) && <span className="block text-xs text-text-muted">{[f.autor, f.nota].filter(Boolean).join(" · ")}</span>}
              </li>
            ))}
          </ul>
          <Button size="sm" variant="ghost" onClick={() => {
            void navigator.clipboard?.writeText(fontesParaNotebookLm(etapa.fontes)).then(
              () => setAviso("Links copiados. No NotebookLM: Adicionar fonte → Site ou YouTube → colar."),
              () => setErro("Não consegui copiar os links."),
            );
          }}>Copiar links para o NotebookLM</Button>
        </section>
      )}

      <section className="space-y-2">
        <h3 className="roadmap-subtitulo">Prática</h3>
        {etapa.tarefa && <p className="text-sm text-text-primary">{etapa.tarefa}</p>}
        {etapa.tarefas.length > 0 && (
          <ul className="space-y-1">
            {etapa.tarefas.map((t) => (
              <li key={t.id}>
                <label className="flex items-start gap-2 text-sm text-text-secondary">
                  <input type="checkbox" checked={t.feita} disabled={r.somenteLeitura} onChange={(e) => rodar(() => marcarTarefa(id, etapaId, t.id, e.target.checked))} className="mt-1" />
                  <span className={t.feita ? "line-through opacity-70" : ""}>{t.texto}</span>
                </label>
              </li>
            ))}
          </ul>
        )}
      </section>

      <div className="flex flex-wrap gap-2">
        {!semIa && <Button size="sm" disabled={gerandoCards || r.somenteLeitura} onClick={() => rodar(() => gerarCardsDaEtapa(id, etapaId), (n) => setAviso(n ? `${String(n)} cards entraram na revisão de hoje.` : "Nenhum card novo (já existiam)."))}>
          Gerar cards de revisão{cardsDaEtapa ? ` (${cardsDaEtapa})` : ""}
        </Button>}
        {!semIa && <Button size="sm" disabled={gerandoTarefas || r.somenteLeitura} onClick={() => rodar(() => gerarTarefasDaEtapa(id, etapaId))}>Gerar tarefas</Button>}
        <Button size="sm" variant="ghost" disabled={r.somenteLeitura} onClick={() => setNovoCard(novoCard ? null : { frente: "", verso: "" })}>Escrever um card</Button>
        {!semIa && <Button size="sm" variant="ghost" onClick={onPerguntar}>Perguntar à IA</Button>}
      </div>
      {novoCard && (
        <form className="roadmap-proposta glass" aria-label="Novo card" onSubmit={(e) => {
          e.preventDefault();
          if (!novoCard.frente.trim() || !novoCard.verso.trim()) return;
          rodar(() => criarCard(id, etapaId, novoCard.frente, novoCard.verso), (entrou) => { setNovoCard(null); setAviso(entrou ? "Card entrou na revisão de hoje." : "Esse card já existia."); });
        }}>
          <Input aria-label="Frente do card" placeholder="Pergunta (frente)" value={novoCard.frente} onChange={(e) => setNovoCard({ ...novoCard, frente: e.target.value })} maxLength={2000} autoFocus />
          <Textarea aria-label="Verso do card" placeholder="Resposta (verso)" rows={2} value={novoCard.verso} onChange={(e) => setNovoCard({ ...novoCard, verso: e.target.value })} maxLength={4000} />
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="ghost" onClick={() => setNovoCard(null)}>Cancelar</Button>
            <Button size="sm" variant="primary" type="submit" disabled={!novoCard.frente.trim() || !novoCard.verso.trim()}>Guardar card</Button>
          </div>
        </form>
      )}

      <div className="roadmap-concluir">
        {estado === "concluida" ? (
          <>
            <span className="flex-1 text-sm text-success">Etapa concluída</span>
            <Button size="sm" variant="ghost" disabled={r.somenteLeitura} onClick={() => rodar(() => reabrir(id, etapaId))}>Reabrir</Button>
            {proxima && <Button size="sm" variant="primary" onClick={() => onAbrirEtapa(proxima.id)}>Próxima etapa →</Button>}
          </>
        ) : (
          <Button variant="primary" className="w-full" disabled={r.somenteLeitura} onClick={() => rodar(() => concluir(id, etapaId))}>Concluir etapa</Button>
        )}
      </div>
    </div>
  );
}
