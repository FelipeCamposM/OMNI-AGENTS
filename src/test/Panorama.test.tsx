import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Panorama } from "../features/panorama/Panorama";
import { montarPanorama } from "../features/panorama/panoramaModel";
import type { TerminalSession } from "../features/terminal/terminalService";
import type { WorkspaceState } from "../types/workspace";

const sessao = (id: string, extra: Partial<TerminalSession>): TerminalSession => ({
  id, project_id: "p1", name: id, cwd: "C:/app", shell: "pwsh", state: "answered", pid: 1, output_seq: 0, rows: 30, cols: 120, ...extra,
});

const workspaces: WorkspaceState[] = [{
  version: 1, id: "w1", name: "Trabalho", activeProjectId: "p1", updatedAt: "",
  projects: [{
    id: "p1", name: "app", path: "C:/app", gitRoot: null, branch: "main", composeFile: null, lastOpenedAt: "", activePaneId: "pane1", maximizedPaneId: null,
    layout: { type: "pane", id: "pane1", activeTabId: "t1", tabs: [
      { id: "t1", kind: "agent", title: "Claude", resourceId: "s1" },
      { id: "t2", kind: "file", title: "App.tsx", resourceId: "C:/app/src/App.tsx" },
      { id: "t3", kind: "agent", title: "Codex", resourceId: "s3" },
    ] },
  }],
}];

const sessions = [
  sessao("s1", { provider: "claude", state: "working", name: "Login" }),
  sessao("s2", { state: "answered", name: "npm run dev" }),
  sessao("s3", { provider: "codex", state: "stopped" }),
  sessao("s5", { provider: "claude", state: "stopped", name: "Velha" }),
  sessao("s4", { provider: "codex", project_id: "outro", state: "approval_required", name: "Solta" }),
];

describe("panorama", () => {
  it("agrupa por workspace/projeto, mostra toda conversa aberta em aba (mesmo parada) e ignora encerrada sem aba", () => {
    const p = montarPanorama(workspaces, "w1", sessions);
    const ilha = p.regioes[0].ilhas[0];
    expect(ilha.agentes.map((s) => s.id)).toEqual(["s1", "s3"]);
    expect(ilha.terminais.map((s) => s.id)).toEqual(["s2"]);
    expect(ilha.abas.map((a) => a.tab.title)).toEqual(["App.tsx"]);
    expect(p.soltas.map((s) => s.id)).toEqual(["s4"]);
    expect(p.totais).toMatchObject({ agentes: 3, trabalhando: 1, pedindo: 2, terminais: 1, projetos: 1, abas: 1 });
  });

  it("clicar leva até a sessão, a aba e o projeto; X fecha", async () => {
    const props = { onSessao: vi.fn(), onProjeto: vi.fn(), onAba: vi.fn(), onWorkspace: vi.fn(), onClose: vi.fn() };
    render(<Panorama workspaces={workspaces} activeWorkspaceId="w1" sessions={sessions} {...props} />);
    await userEvent.click(screen.getByTitle("Ir para Login"));
    expect(props.onSessao).toHaveBeenCalledWith(expect.objectContaining({ id: "s1" }), "w1", "p1");
    await userEvent.click(screen.getByTitle("C:/app/src/App.tsx"));
    expect(props.onAba).toHaveBeenCalledWith("w1", "p1", "pane1", "t2");
    await userEvent.click(screen.getByTitle("Abrir C:/app"));
    expect(props.onProjeto).toHaveBeenCalledWith("w1", "p1");
    await userEvent.click(screen.getByTitle("Ir para Solta"));
    expect(props.onSessao).toHaveBeenLastCalledWith(expect.objectContaining({ id: "s4" }), null, null);
    await userEvent.click(screen.getByRole("button", { name: "Fechar panorama" }));
    expect(props.onClose).toHaveBeenCalled();
  });
});
