import { useEffect, useMemo, useState } from "react";
import { Button } from "../../components/ui/Button";
import { CheckIcon, CopyIcon, GitBranchIcon, LabelIcon, CloudIcon, ReloadIcon } from "../../components/ui/PixelIcon";
import { timeAgo } from "../terminal/AgentUsageStatus";
import { gitLogGraph, type GitCommit } from "./gitService";
import { layoutGraph, parseRefs, type CommitRef, type GraphEdge, type GraphRow } from "./graphLayout";

interface GitGraphPaneProps {
  projectPath: string;
}

/**
 * Cores das trilhas. A primeira é a cor da paleta do app, então o ramo principal acompanha o tema;
 * as demais são tons médios que leem bem tanto no fundo escuro quanto no claro.
 */
const CORES = [
  "rgb(var(--c-accent))",
  "#0ea5e9",
  "#22c55e",
  "#f59e0b",
  "#ec4899",
  "#8b5cf6",
  "#14b8a6",
  "#ef4444",
];
const cor = (indice: number) => CORES[indice % CORES.length];

/** Medidas da coluna do grafo, em px. */
const LINHA = 28;
const TRILHA = 16;
const MARGEM = 10;
const NO = 8;

// ponytail: sem virtualização — 500 linhas de SVG pequeno rendem bem. Paginar se um repositório
// grande travar a rolagem.
const MAX_COMMITS = 500;

const xDa = (trilha: number) => MARGEM + trilha * TRILHA;

/** Reto quando fica na trilha; curva suave quando muda de trilha. */
function caminho(x1: number, y1: number, x2: number, y2: number): string {
  if (x1 === x2) return `M${x1} ${y1}V${y2}`;
  const meio = (y1 + y2) / 2;
  return `M${x1} ${y1}C${x1} ${meio} ${x2} ${meio} ${x2} ${y2}`;
}

function Arestas({ arestas, y1, y2 }: { arestas: GraphEdge[]; y1: number; y2: number }) {
  return <>
    {arestas.map((aresta, i) => (
      <path key={i} d={caminho(xDa(aresta.from), y1, xDa(aresta.to), y2)}
        stroke={cor(aresta.color)} strokeWidth={2} fill="none" strokeLinecap="round" />
    ))}
  </>;
}

function Grafo({ row, largura, atual }: { row: GraphRow; largura: number; atual: boolean }) {
  const x = xDa(row.col);
  const meio = LINHA / 2;
  const merge = row.commit.parents.length > 1;
  const tamanho = atual ? NO + 2 : NO;
  return (
    <svg width={largura} height={LINHA} className="shrink-0" aria-hidden>
      <Arestas arestas={row.top} y1={0} y2={meio} />
      <Arestas arestas={row.bottom} y1={meio} y2={LINHA} />
      {atual && <rect x={x - tamanho / 2 - 3} y={meio - tamanho / 2 - 3} width={tamanho + 6} height={tamanho + 6}
        fill="none" stroke={cor(row.color)} strokeOpacity={0.45} strokeWidth={2} />}
      {/* Nó quadrado, na linguagem pixel do app. Merge fica vazado: dá para ver de longe onde
          os ramos se juntaram. */}
      <rect x={x - tamanho / 2} y={meio - tamanho / 2} width={tamanho} height={tamanho}
        fill={merge ? "rgb(var(--c-bg-surface))" : cor(row.color)}
        stroke={merge ? cor(row.color) : "rgb(var(--c-bg-surface))"} strokeWidth={2} />
    </svg>
  );
}

const ICONE_DA_REF = { head: GitBranchIcon, branch: GitBranchIcon, remote: CloudIcon, tag: LabelIcon } as const;

function Etiqueta({ etiqueta, corDoRamo }: { etiqueta: CommitRef; corDoRamo: string }) {
  const Icone = ICONE_DA_REF[etiqueta.kind];
  const atual = etiqueta.kind === "head";
  return (
    <span className={`gg-ref gg-ref-${etiqueta.kind}`} title={
      atual ? `${etiqueta.name} (branch atual)` : etiqueta.kind === "remote" ? `Remoto: ${etiqueta.name}`
        : etiqueta.kind === "tag" ? `Tag ${etiqueta.name}` : `Branch ${etiqueta.name}`}>
      <span className="gg-ref-cor" aria-hidden><span style={{ backgroundColor: corDoRamo }} /></span>
      <Icone aria-hidden className="h-3 w-3 shrink-0" />
      <span className="truncate">{etiqueta.name}</span>
      {atual && <span className="gg-ref-marca">HEAD</span>}
    </span>
  );
}

/** "há 5 min" na última semana; depois, a data — "há 40 d" não ajuda a situar nada. */
function quando(iso: string, agora: number): string {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return "";
  if (agora - ms < 7 * 86_400_000) return timeAgo(ms, agora);
  const data = new Date(ms);
  const mesmoAno = data.getFullYear() === new Date(agora).getFullYear();
  return data.toLocaleDateString("pt-BR", mesmoAno ? { day: "2-digit", month: "2-digit" } : { day: "2-digit", month: "2-digit", year: "2-digit" });
}

function LinhaDoCommit({ row, largura, agora }: { row: GraphRow; largura: number; agora: number }) {
  const [copiado, setCopiado] = useState(false);
  const { commit } = row;
  const etiquetas = parseRefs(commit.refs);
  const atual = commit.refs.some((ref) => ref === "HEAD" || ref.startsWith("HEAD -> "));
  const curto = commit.hash.slice(0, 7);
  const dataCompleta = Number.isNaN(Date.parse(commit.date)) ? commit.date : new Date(commit.date).toLocaleString("pt-BR");

  function copiar() {
    void navigator.clipboard?.writeText(commit.hash).then(() => {
      setCopiado(true);
      window.setTimeout(() => setCopiado(false), 1200);
    }).catch(() => undefined);
  }

  return (
    <li className={`gg-linha group${atual ? " gg-linha-atual" : ""}`}
      title={`${commit.message}\n${commit.author} · ${dataCompleta}\n${commit.hash}`}>
      <Grafo row={row} largura={largura} atual={atual} />
      <div className="gg-mensagem">
        {etiquetas.map((etiqueta) => (
          <Etiqueta key={`${etiqueta.kind}:${etiqueta.name}`} etiqueta={etiqueta} corDoRamo={cor(row.color)} />
        ))}
        <span className={`truncate ${commit.parents.length > 1 ? "text-text-secondary" : "text-text-primary"}`}>
          {commit.message}
        </span>
      </div>
      <span className="gg-autor">{commit.author}</span>
      <time className="gg-data" dateTime={commit.date}>{quando(commit.date, agora)}</time>
      <button type="button" className="gg-hash" onClick={copiar} aria-label={`Copiar hash ${curto}`}>
        {copiado ? <CheckIcon aria-hidden className="h-3 w-3 text-success" /> : <CopyIcon aria-hidden className="gg-hash-icone h-3 w-3" />}
        {curto}
      </button>
    </li>
  );
}

export function GitGraphPane({ projectPath }: GitGraphPaneProps) {
  const [commits, setCommits] = useState<GitCommit[] | null>(null);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [recarga, setRecarga] = useState(0);
  const [carregando, setCarregando] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setCarregando(true);
    setError(null);
    gitLogGraph(projectPath)
      .then((all) => {
        if (cancelled) return;
        setTotal(all.length);
        setCommits(all.slice(0, MAX_COMMITS));
      })
      .catch((reason) => { if (!cancelled) setError(reason instanceof Error ? reason.message : String(reason)); })
      .finally(() => { if (!cancelled) setCarregando(false); });
    return () => { cancelled = true; };
  }, [projectPath, recarga]);

  const rows = useMemo(() => (commits ? layoutGraph(commits) : []), [commits]);
  // Mesma largura em todas as linhas: é o que mantém as mensagens alinhadas numa coluna só.
  const largura = xDa(Math.max(1, ...rows.map((row) => row.width)) - 1) + MARGEM;
  const branches = useMemo(() => new Set((commits ?? []).flatMap((c) =>
    parseRefs(c.refs).filter((r) => r.kind === "head" || r.kind === "branch").map((r) => r.name))).size, [commits]);
  const agora = Date.now();

  if (error) return <div role="alert" className="p-4 text-xs text-danger">{error}</div>;
  if (!commits) return <div className="p-4 text-xs text-text-muted">Carregando histórico…</div>;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex items-center gap-2 border-b-2 border-border-subtle px-3 py-2">
        <GitBranchIcon aria-hidden className="h-4 w-4 text-accent" />
        <h2 className="pixel-text text-xs text-text-primary">Git Graph</h2>
        <span className="truncate text-[11px] text-text-muted">
          {commits.length} commit{commits.length === 1 ? "" : "s"} · {branches} branch{branches === 1 ? "" : "es"}
          {total > commits.length && ` · mostrando os ${commits.length} mais recentes de ${total}`}
        </span>
        <Button variant="ghost" size="sm" className="ml-auto !px-2" aria-label="Atualizar grafo" title="Atualizar"
          disabled={carregando} onClick={() => setRecarga((n) => n + 1)}>
          <ReloadIcon aria-hidden className={`h-3.5 w-3.5${carregando ? " animate-spin" : ""}`} />
        </Button>
      </header>
      {commits.length === 0
        ? <p className="p-4 text-xs text-text-muted">Sem commits ainda.</p>
        : <ol className="gg-lista selectable" aria-label="Commits">
            {rows.map((row) => <LinhaDoCommit key={row.commit.hash} row={row} largura={largura} agora={agora} />)}
          </ol>}
    </div>
  );
}
