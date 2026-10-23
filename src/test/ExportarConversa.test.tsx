import { expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ExportarConversa } from "../mobile/ExportarConversa";

const catalogo = { published_at_ms: 1, projects: [], theme: null,
  agents: [{ id: "claude", label: "Claude", command: "claude", resume: null }, { id: "codex", label: "Codex", command: "codex", resume: null }],
  profiles: [] };

it("exporta para outro agente (sugere um diferente do atual) e vai para a conversa nova", async () => {
  const fetch = vi.fn(async (url: string, init?: RequestInit) => new Response(JSON.stringify(
    url === "/projetos" ? catalogo : init?.method === "POST" ? { id: "conv-nova", arquivo: ".omni/exports/x.md" } : { markdown: "# x" })));
  vi.stubGlobal("fetch", fetch);
  const abrir = vi.fn();
  render(<ExportarConversa conversaId="c1" provider="claude" abrir={abrir} />);
  await act(async () => { await userEvent.click(screen.getByRole("button", { name: "Exportar para outro agente" })); });
  await screen.findByRole("dialog", { name: "Exportar para outro agente" });
  await act(async () => { await userEvent.click(screen.getByRole("button", { name: "Exportar" })); });
  const post = fetch.mock.calls.find(([url, init]) => url === "/conversas/c1/exportar" && init?.method === "POST");
  expect(JSON.parse(String(post?.[1]?.body))).toEqual({ provider: "codex", profile_id: null });
  expect(abrir).toHaveBeenCalledWith("conv-nova");
});
