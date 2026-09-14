import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useWorkspace } from "../features/workspace/useWorkspace";

const publishWorkspace = vi.fn();
vi.mock("../features/terminal/terminalService", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../features/terminal/terminalService")>()),
  publishWorkspace: (...args: unknown[]) => publishWorkspace(...args),
}));

beforeEach(() => {
  localStorage.clear();
  publishWorkspace.mockReset().mockResolvedValue(undefined);
});

describe("publicação do workspace para o celular", () => {
  it("publica na montagem e ao abrir projeto, mas não a cada mexida de layout", async () => {
    const { result } = renderHook(() => useWorkspace());
    expect(publishWorkspace).toHaveBeenCalledTimes(1);

    await act(async () => { result.current.dispatch({ type: "ADD_PROJECT", path: "C:\\dev\\projeto" }); });
    expect(publishWorkspace).toHaveBeenCalledTimes(2);
    const [projetos] = publishWorkspace.mock.calls[1] as [{ id: string; name: string; path: string }[]];
    expect(projetos.some((projeto) => projeto.path === "C:\\dev\\projeto")).toBe(true);

    // Layout muda o `collection` inteiro, mas não a projeção: sem o guard, cada arrasto de split
    // viraria um IPC.
    const paneId = result.current.activeProject?.activePaneId ?? "";
    await act(async () => { result.current.dispatch({ type: "SPLIT_PANE", paneId, direction: "horizontal" }); });
    expect(publishWorkspace).toHaveBeenCalledTimes(2);
  });

  it("não deixa engine fora do ar derrubar a UI", async () => {
    publishWorkspace.mockRejectedValue(new Error("ENGINE_OFFLINE"));
    expect(() => renderHook(() => useWorkspace())).not.toThrow();
  });
});
