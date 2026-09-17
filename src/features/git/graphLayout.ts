import type { GitCommit } from "./gitService";

/** Trecho de linha dentro de uma linha da tabela: sai da trilha `from` e chega na trilha `to`. */
export interface GraphEdge {
  from: number;
  to: number;
  /** Índice de cor da trilha (estável ao longo de um mesmo ramo). */
  color: number;
}

export interface GraphRow {
  commit: GitCommit;
  /** Trilha onde fica o nó deste commit. */
  col: number;
  color: number;
  /** Metade de cima: do topo da linha até a altura do nó. */
  top: GraphEdge[];
  /** Metade de baixo: da altura do nó até o pé da linha. */
  bottom: GraphEdge[];
  /** Quantas trilhas esta linha ocupa. */
  width: number;
}

type Lane = { hash: string; color: number } | null;

function trilhaLivre(lanes: Lane[]): number {
  const livre = lanes.indexOf(null);
  return livre === -1 ? lanes.length : livre;
}

/**
 * Distribui os commits em trilhas, como o Git Graph do VS Code.
 *
 * Recebe a lista do `git log --topo-order` (mais novo primeiro, filho sempre antes do pai). Cada
 * trilha "espera" um hash: quando o commit esperado chega, o nó cai na primeira trilha que o
 * esperava e as outras convergem para ele (é assim que um fork aparece). O primeiro pai herda a
 * trilha e a cor; os demais pais de um merge abrem trilha nova, ou desembocam na trilha que já
 * esperava por eles.
 *
 * Trilhas não trocam de coluna enquanto vivem: uma linha só anda na diagonal quando converge ou
 * abre ramo. Isso deixa o desenho sem cruzamentos à toa e o algoritmo linear.
 *
 * Pai fora da janela (histórico cortado) é tratado como inexistente: a trilha termina ali.
 */
export function layoutGraph(commits: GitCommit[]): GraphRow[] {
  const naJanela = new Set(commits.map((commit) => commit.hash));
  let lanes: Lane[] = [];
  let proximaCor = 0;
  const rows: GraphRow[] = [];

  for (const commit of commits) {
    let col = lanes.findIndex((lane) => lane?.hash === commit.hash);
    const color = col === -1 ? proximaCor++ : lanes[col]!.color;
    if (col === -1) col = trilhaLivre(lanes);

    const top: GraphEdge[] = [];
    lanes.forEach((lane, j) => {
      if (!lane) return;
      top.push({ from: j, to: lane.hash === commit.hash ? col : j, color: lane.color });
    });
    // Quem esperava este commit chegou: as trilhas convergentes se fecham aqui.
    lanes = lanes.map((lane) => (lane?.hash === commit.hash ? null : lane));

    const bottom: GraphEdge[] = [];
    lanes.forEach((lane, j) => {
      if (lane) bottom.push({ from: j, to: j, color: lane.color });
    });

    commit.parents.filter((pai) => naJanela.has(pai)).forEach((pai, i) => {
      if (i === 0) {
        while (lanes.length < col) lanes.push(null);
        lanes[col] = { hash: pai, color };
        bottom.push({ from: col, to: col, color });
        return;
      }
      const existente = lanes.findIndex((lane) => lane?.hash === pai);
      if (existente !== -1) {
        bottom.push({ from: col, to: existente, color: lanes[existente]!.color });
        return;
      }
      const nova = trilhaLivre(lanes);
      const corNova = proximaCor++;
      lanes[nova] = { hash: pai, color: corNova };
      bottom.push({ from: col, to: nova, color: corNova });
    });

    while (lanes.length > 0 && lanes[lanes.length - 1] === null) lanes.pop();

    const colunas = [col, ...top.flatMap((e) => [e.from, e.to]), ...bottom.flatMap((e) => [e.from, e.to])];
    rows.push({ commit, col, color, top, bottom, width: Math.max(...colunas) + 1 });
  }
  return rows;
}

export type RefKind = "head" | "branch" | "remote" | "tag";

export interface CommitRef {
  kind: RefKind;
  name: string;
}

/**
 * `%D` do git (`HEAD -> main, tag: v0.4.4, origin/main`) em etiquetas.
 *
 * `HEAD -> main` vira uma só etiqueta "main" marcada como atual. `origin/HEAD` sai: é só o
 * ponteiro do remoto para a branch padrão e repetiria a etiqueta ao lado.
 */
export function parseRefs(refs: string[], remotos = ["origin", "upstream"]): CommitRef[] {
  const saida: CommitRef[] = [];
  for (const bruto of refs) {
    const ref = bruto.trim();
    if (!ref || ref.endsWith("/HEAD")) continue;
    if (ref.startsWith("HEAD -> ")) { saida.push({ kind: "head", name: ref.slice(8) }); continue; }
    if (ref === "HEAD") { saida.push({ kind: "head", name: "HEAD" }); continue; }
    if (ref.startsWith("tag: ")) { saida.push({ kind: "tag", name: ref.slice(5) }); continue; }
    const remoto = remotos.some((nome) => ref.startsWith(`${nome}/`));
    saida.push({ kind: remoto ? "remote" : "branch", name: ref });
  }
  const ordem: Record<RefKind, number> = { head: 0, branch: 1, remote: 2, tag: 3 };
  return saida.sort((a, b) => ordem[a.kind] - ordem[b.kind]);
}
