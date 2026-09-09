import { Gitgraph, TemplateName, templateExtend } from "@gitgraph/react";
import { useEffect, useMemo, useState } from "react";
import { gitLogGraph, type GitCommit } from "./gitService";

interface GitGraphPaneProps {
  projectPath: string;
}

/** O template "metro" (default da lib) nunca define `commit.color` — o fallback interno da lib
 * pra isso é `undefined`, e um SVG sem `fill` explícito renderiza preto (default do SVG). Em cima
 * do nosso fundo escuro (`#0e0e14`) isso é texto e pontos de commit INVISÍVEIS — não travava,
 * simplesmente não aparecia nada. `commit.color` aqui alimenta o fallback de `dot.color` e
 * `message.color` (e de `branch.label.color`) ao mesmo tempo — ver `@gitgraph/core`'s
 * `template.js`. `branch.label.bgColor` também teria vindo "white" (outro default da lib) —
 * sobrescrito pra combinar com o tema. */
const DARK_TEMPLATE = templateExtend(TemplateName.Metro, {
  colors: ["#f97316", "#38bdf8", "#4ade80", "#facc15", "#c084fc", "#fb7185"],
  branch: {
    lineWidth: 3,
    spacing: 24,
    label: { bgColor: "#1a1a24", color: "#e2e2ec" },
  },
  commit: {
    color: "#e2e2ec",
    spacing: 34,
    dot: { size: 5 },
    message: { displayAuthor: false, displayHash: false },
  },
});

// ponytail: limita a janela pra manter o SVG leve em repositórios grandes; commits mais antigos
// que o corte aparecem como "raiz" do gráfico. Subir o limite (ou paginar) se isso incomodar.
const MAX_COMMITS = 200;

export function GitGraphPane({ projectPath }: GitGraphPaneProps) {
  const [commits, setCommits] = useState<GitCommit[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    gitLogGraph(projectPath)
      .then((all) => { if (!cancelled) setCommits(all.slice(0, MAX_COMMITS)); })
      .catch((reason) => { if (!cancelled) setError(reason instanceof Error ? reason.message : String(reason)); });
    return () => { cancelled = true; };
  }, [projectPath]);

  const render = useMemo(() => (commits ? buildRenderer(commits) : null), [commits]);

  if (error) return <div role="alert" className="p-4 text-xs text-danger">{error}</div>;
  if (!commits) return <div className="p-4 text-xs text-text-muted">Carregando…</div>;
  if (commits.length === 0) return <div className="p-4 text-xs text-text-muted">Sem commits ainda.</div>;

  return (
    <div className="h-full overflow-auto bg-[#0e0e14] p-4">
      {/* @gitgraph/react tipa `children` com sua própria `GitgraphUserApi` — usamos uma
          interface mínima (só os métodos que chamamos) pra não depender dos generics exatos
          da lib; o `as any` aqui é só pra casar as duas assinaturas. */}
      <Gitgraph options={{ template: DARK_TEMPLATE }}>{render as any}</Gitgraph>
    </div>
  );
}

interface GraphBranch {
  commit(options: { hash: string; subject: string; author: string }): GraphBranch;
  merge(options: {
    branch: GraphBranch;
    commitOptions: { subject: string; hash: string; author: string };
  }): GraphBranch;
  branch(name: string): GraphBranch;
}

interface GraphApi {
  branch(name: string): GraphBranch;
}

type GitgraphApi = GraphApi;

/** Reconstrói o DAG real (branches/merges) sobre a API imperativa branch()/commit()/merge() do
 * @gitgraph/react. Percorre os commits da raiz pra ponta: cada commit já sabe em que "lane"
 * (Branch) ele vai antes de ser processado — decidido pelo pai, em `advance()`, no momento em
 * que o próprio pai é colocado no grafo. Um commit com 2+ pais é um merge: consome a lane
 * pré-atribuída via o primeiro pai e recebe a segunda lane como argumento de `.merge()`. */
function buildRenderer(commitsNewestFirst: GitCommit[]) {
  const byHash = new Map(commitsNewestFirst.map((commit) => [commit.hash, commit]));
  const childrenOf = new Map<string, string[]>();
  for (const commit of commitsNewestFirst) {
    for (const parent of commit.parents) {
      if (!byHash.has(parent)) continue; // fora da janela (MAX_COMMITS) — tratado como raiz
      const list = childrenOf.get(parent);
      if (list) list.push(commit.hash);
      else childrenOf.set(parent, [commit.hash]);
    }
  }
  const oldestFirst = [...commitsNewestFirst].reverse();

  return function render(gitgraph: GitgraphApi) {
    const laneOf = new Map<string, ReturnType<GitgraphApi["branch"]>>();
    let laneCounter = 0;
    let rootCounter = 0;

    function advance(nodeHash: string, branch: ReturnType<GitgraphApi["branch"]>) {
      const kids = childrenOf.get(nodeHash) ?? [];
      const primaryKids = kids.filter((childHash) => byHash.get(childHash)!.parents[0] === nodeHash);
      primaryKids.forEach((childHash, index) => {
        laneOf.set(childHash, index === 0 ? branch : branch.branch(`lane-${laneCounter++}`));
      });
    }

    function branchNameFor(commit: GitCommit) {
      const ref = commit.refs.find((item) => !item.startsWith("tag:") && !item.includes("HEAD"));
      return ref ?? `root-${rootCounter++}`;
    }

    // Fallback pro caso de corte de janela (MAX_COMMITS) deixar um commit sem lane pré-atribuída
    // (pai "ours" ficou de fora, só o "theirs" está na janela) — abre uma raiz nova ali mesmo em
    // vez de quebrar o grafo inteiro.
    function laneFor(commit: GitCommit) {
      const existing = laneOf.get(commit.hash);
      if (existing) return existing;
      const branch = gitgraph.branch(branchNameFor(commit));
      laneOf.set(commit.hash, branch);
      return branch;
    }

    for (const commit of oldestFirst) {
      const inWindowParents = commit.parents.filter((parent) => byHash.has(parent));
      if (inWindowParents.length === 0) {
        const branch = laneFor(commit);
        branch.commit({ hash: commit.hash, subject: commit.message, author: commit.author });
        advance(commit.hash, branch);
      } else if (inWindowParents.length === 1) {
        const branch = laneFor(commit);
        branch.commit({ hash: commit.hash, subject: commit.message, author: commit.author });
        advance(commit.hash, branch);
      } else {
        const branch = laneFor(commit);
        const other = laneFor(byHash.get(inWindowParents[1])!);
        // Assinatura real da lib é merge(branch, subjectString) ou merge({branch, commitOptions})
        // — NÃO merge(branch, {subject, hash}) (isso faz o hash real ser descartado e o objeto
        // virar texto literal "[object Object]" na mensagem do commit de merge).
        branch.merge({ branch: other, commitOptions: { subject: commit.message, hash: commit.hash, author: commit.author } });
        advance(commit.hash, branch);
      }
    }
  };
}
