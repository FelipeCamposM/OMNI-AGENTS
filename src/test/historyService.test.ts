import { describe, expect, it } from "vitest";
import { filterHistory, resumeCommand, samePath, type HistoryEntry } from "../features/history/historyService";

function entry(overrides: Partial<HistoryEntry>): HistoryEntry {
  return {
    provider: "claude",
    profile_id: "claude-padrao",
    profile_name: "Padrão",
    session_id: "abc",
    title: "Corrigir login",
    first_prompt: "o login quebra no safari",
    cwd: "D:\\dev\\api",
    started_at_ms: 1,
    updated_at_ms: 2,
    path: "C:/x/abc.jsonl",
    ...overrides,
  };
}

describe("historyService", () => {
  const entries = [
    entry({}),
    entry({ session_id: "def", title: "Home nova", first_prompt: "cria a home", cwd: "D:/dev/web", profile_id: "trabalho" }),
  ];

  it("busca por todas as palavras em título, prompt e pasta", () => {
    expect(filterHistory(entries, { query: "safari login", cwd: "", profileId: "" }).map((e) => e.session_id)).toEqual(["abc"]);
    expect(filterHistory(entries, { query: "web", cwd: "", profileId: "" }).map((e) => e.session_id)).toEqual(["def"]);
  });

  it("filtra por projeto ignorando caixa e barra, e por conta", () => {
    expect(filterHistory(entries, { query: "", cwd: "d:/DEV/api/", profileId: "" }).map((e) => e.session_id)).toEqual(["abc"]);
    expect(filterHistory(entries, { query: "", cwd: "", profileId: "trabalho" }).map((e) => e.session_id)).toEqual(["def"]);
    expect(samePath(null, "D:/dev")).toBe(false);
  });

  it("retoma a sessão exata em cada CLI", () => {
    expect(resumeCommand("claude", entry({}))).toBe("claude --resume abc");
    expect(resumeCommand("codex", entry({ provider: "codex", session_id: "019" }))).toBe("codex resume 019");
  });
});
