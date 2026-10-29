import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { escolherRecentes, RecentesConversas } from "../features/history/RecentesConversas";
import { ProjetosContext } from "../features/projects/projetosContext";
import { createProject } from "../features/workspace/workspaceReducer";
import type { HistoryEntry } from "../features/history/historyService";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

const entrada = (session_id: string, updated_at_ms: number, extra: Partial<HistoryEntry> = {}): HistoryEntry => ({
  provider: "claude", profile_id: "p", profile_name: "Pessoal", session_id, title: `Conversa ${session_id}`,
  first_prompt: null, cwd: "C:/proj/omni", started_at_ms: null, updated_at_ms, path: `C:/h/${session_id}.jsonl`, ...extra,
});

describe("Recentes na lateral", () => {
  it("as mais novas primeiro, sem as abertas e sem as que não sabem a pasta", () => {
    const lista = escolherRecentes([entrada("a", 1), entrada("b", 3), entrada("c", 2), entrada("d", 9, { cwd: null })], new Set(["c"]));
    expect(lista.map((item) => item.session_id)).toEqual(["b", "a"]);
  });

  /** "Ver as principais conversas para poder usar as mesmas, um mini histórico, com os ícones dos projetos." */
  it("mostra o projeto de cada uma e retoma no clique", async () => {
    vi.mocked(invoke).mockImplementation(async (comando: string, args?: unknown) =>
      comando === "agent_history" && (args as { provider: string }).provider === "claude"
        ? [entrada("a", Date.now() - 60_000), entrada("b", Date.now() - 120_000, { cwd: "C:/proj/site" })] : []);
    const onRetomar = vi.fn(async () => undefined);
    render(
      <ProjetosContext.Provider value={[{ ...createProject("C:/proj/omni", "p1"), name: "OMNI" }]}>
        <RecentesConversas abertas={[]} agora={Date.now()} onRetomar={onRetomar} onVerTodas={vi.fn()} />
      </ProjetosContext.Provider>,
    );
    const regiao = await screen.findByRole("region", { name: "Conversas recentes" });
    const linha = await within(regiao).findByRole("button", { name: "Retomar Conversa a (OMNI)" });
    expect(within(regiao).getByRole("button", { name: "Retomar Conversa b (site)" })).toBeInTheDocument();
    fireEvent.click(linha);
    expect(onRetomar).toHaveBeenCalledWith(expect.objectContaining({ session_id: "a" }));

    // Busca ali mesmo, sem abrir o histórico completo.
    fireEvent.change(within(regiao).getByRole("searchbox", { name: "Buscar nas conversas recentes" }), { target: { value: "site" } });
    expect(within(regiao).queryByRole("button", { name: "Retomar Conversa a (OMNI)" })).toBeNull();
    expect(within(regiao).getByRole("button", { name: "Retomar Conversa b (site)" })).toBeInTheDocument();
  });
});
