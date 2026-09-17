import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
import { GitGraphPane } from "../features/git/GitGraphPane";
import { layoutGraph, parseRefs } from "../features/git/graphLayout";
import type { GitCommit } from "../features/git/gitService";

function c(hash: string, parents: string[], refs: string[] = []): GitCommit {
  return { hash, parents, refs, author: "Ana", date: "2026-09-16T10:00:00-03:00", message: `commit ${hash}` };
}

describe("layoutGraph", () => {
  it("histórico linear fica numa trilha só, com linha contínua", () => {
    const rows = layoutGraph([c("c", ["b"]), c("b", ["a"]), c("a", [])]);
    expect(rows.map((r) => r.col)).toEqual([0, 0, 0]);
    expect(rows.map((r) => r.width)).toEqual([1, 1, 1]);
    // A ponta não tem nada acima; a raiz não tem nada abaixo.
    expect(rows[0].top).toEqual([]);
    expect(rows[0].bottom).toEqual([{ from: 0, to: 0, color: 0 }]);
    expect(rows[2].bottom).toEqual([]);
    expect(new Set(rows.map((r) => r.color))).toEqual(new Set([0]));
  });

  it("merge abre a segunda trilha e o fork converge de volta no ancestral comum", () => {
    //   m        (merge de main com feature)
    //   |\
    //   | f      (feature)
    //   x |      (main)
    //   |/
    //   a
    const rows = layoutGraph([c("m", ["x", "f"]), c("f", ["a"]), c("x", ["a"]), c("a", [])]);
    const [m, f, x, a] = rows;
    expect(m.col).toBe(0);
    expect(m.bottom).toContainEqual({ from: 0, to: 1, color: f.color });
    expect(f.col).toBe(1);
    expect(f.color).not.toBe(m.color);
    expect(x.col).toBe(0);
    expect(x.color).toBe(m.color);
    // Linha da feature passa ao lado de x sem mudar de trilha.
    expect(x.top).toContainEqual({ from: 1, to: 1, color: f.color });
    // Em `a`, as duas trilhas se encontram: a da feature desce na diagonal para a coluna 0.
    expect(a.col).toBe(0);
    expect(a.top).toContainEqual({ from: 1, to: 0, color: f.color });
    expect(a.width).toBe(2);
  });

  it("duas pontas do mesmo pai viram duas trilhas que se juntam no pai", () => {
    const rows = layoutGraph([c("p1", ["base"]), c("p2", ["base"]), c("base", [])]);
    expect(rows[0].col).toBe(0);
    expect(rows[1].col).toBe(1);
    expect(rows[1].top).toContainEqual({ from: 0, to: 0, color: rows[0].color });
    expect(rows[2].top).toEqual([
      { from: 0, to: 0, color: rows[0].color },
      { from: 1, to: 0, color: rows[1].color },
    ]);
  });

  it("ramo paralelo usa a trilha ao lado e o grafo não cresce sem fim", () => {
    const rows = layoutGraph([
      c("t1", ["b1"]), c("b1", ["root"]),
      c("t2", ["b2"]), c("b2", ["root"]),
      c("root", []),
    ]);
    // t2 nasce enquanto a trilha 0 ainda espera `root`: vai para a 1.
    expect(rows[2].col).toBe(1);
    expect(Math.max(...rows.map((r) => r.width))).toBe(2);
  });

  it("pai fora da janela encerra a trilha em vez de quebrar", () => {
    const rows = layoutGraph([c("novo", ["velho-fora-da-janela"]), c("outro", [])]);
    expect(rows[0].bottom).toEqual([]);
    expect(rows[1].col).toBe(0);
  });
});

describe("parseRefs", () => {
  it("separa branch atual, locais, remotos e tags, sem o origin/HEAD repetido", () => {
    expect(parseRefs(["HEAD -> main", "tag: v0.4.4", "origin/main", "origin/HEAD", "feature/x"])).toEqual([
      { kind: "head", name: "main" },
      { kind: "branch", name: "feature/x" },
      { kind: "remote", name: "origin/main" },
      { kind: "tag", name: "v0.4.4" },
    ]);
    expect(parseRefs(["HEAD"])).toEqual([{ kind: "head", name: "HEAD" }]);
    expect(parseRefs([])).toEqual([]);
  });
});

describe("GitGraphPane", () => {
  it("mostra uma linha por commit com etiquetas reais, sem nomes internos de trilha", async () => {
    vi.mocked(invoke).mockResolvedValueOnce([
      c("aaaaaaa1", ["bbbbbbb2", "ccccccc3"], ["HEAD -> main", "tag: v1.0.0", "origin/main"]),
      c("ccccccc3", ["ddddddd4"], ["feature/login"]),
      c("bbbbbbb2", ["ddddddd4"]),
      c("ddddddd4", []),
    ]);
    render(<GitGraphPane projectPath="C:/repo" />);

    const lista = await screen.findByRole("list", { name: "Commits" });
    const linhas = within(lista).getAllByRole("listitem");
    expect(linhas).toHaveLength(4);
    expect(within(linhas[0]).getByTitle("main (branch atual)")).toHaveTextContent("HEAD");
    expect(within(linhas[0]).getByTitle("Tag v1.0.0")).toBeInTheDocument();
    expect(within(linhas[0]).getByTitle("Remoto: origin/main")).toBeInTheDocument();
    expect(within(linhas[1]).getByTitle("Branch feature/login")).toBeInTheDocument();
    expect(within(linhas[0]).getByRole("button", { name: "Copiar hash aaaaaaa" })).toBeInTheDocument();
    // O que a lib antiga desenhava como etiqueta de ramo não pode vazar para a tela.
    expect(screen.queryByText(/lane-|root-/)).not.toBeInTheDocument();
    expect(screen.getByText(/4 commits · 2 branches/)).toBeInTheDocument();
  });

  it("repositório sem commits diz isso", async () => {
    vi.mocked(invoke).mockResolvedValueOnce([]);
    render(<GitGraphPane projectPath="C:/repo" />);
    expect(await screen.findByText("Sem commits ainda.")).toBeInTheDocument();
  });
});
