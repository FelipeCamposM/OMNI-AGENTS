import { describe, expect, it, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { useAttentionNotifier, testarAviso } from "../features/terminal/useAttentionNotifier";
import type { AttentionItem } from "../features/terminal/useAttention";

const janela = vi.hoisted(() => ({
  isFocused: vi.fn().mockResolvedValue(false),
  requestUserAttention: vi.fn().mockResolvedValue(undefined),
}));
const toast = vi.hoisted(() => ({
  sendNotification: vi.fn(),
  isPermissionGranted: vi.fn().mockResolvedValue(true),
  requestPermission: vi.fn().mockResolvedValue("granted"),
}));

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => janela,
  UserAttentionType: { Critical: 1, Informational: 2 },
}));
vi.mock("@tauri-apps/plugin-notification", () => toast);

function item(overrides: Partial<AttentionItem> = {}): AttentionItem {
  return {
    sessionId: "s1",
    sessionName: "Claude · api",
    reason: "answered",
    state: "answered",
    attentionSeq: 1,
    projectId: "api",
    projectName: "api",
    workspaceId: "ws-a",
    workspaceName: "Cliente X",
    ...overrides,
  };
}

/** Primeira leitura só registra o que já estava pendente; o evento chega no poll seguinte. */
function renderAfterStartup(items: AttentionItem[], enabled = true) {
  const hook = renderHook(({ items, enabled }) => useAttentionNotifier(items, enabled), {
    initialProps: { items: [] as AttentionItem[], enabled },
  });
  hook.rerender({ items, enabled });
  return hook;
}

beforeEach(() => {
  vi.clearAllMocks();
  janela.isFocused.mockResolvedValue(false);
  toast.isPermissionGranted.mockResolvedValue(true);
});

describe("useAttentionNotifier", () => {
  it("notifica e pisca a barra quando o app está fora de foco", async () => {
    renderAfterStartup([item()]);

    await waitFor(() => expect(toast.sendNotification).toHaveBeenCalledTimes(1));
    expect(toast.sendNotification).toHaveBeenCalledWith({
      title: "Cliente X · api",
      body: "Claude · api — terminou",
    });
    expect(janela.requestUserAttention).toHaveBeenCalled();
  });

  it("um aviso por evento do engine: repetir o estado não notifica, evento novo sim", async () => {
    const { rerender } = renderAfterStartup([item()]);
    await waitFor(() => expect(toast.sendNotification).toHaveBeenCalledTimes(1));

    rerender({ items: [item()], enabled: true });
    rerender({ items: [], enabled: true });
    rerender({ items: [item()], enabled: true });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(toast.sendNotification).toHaveBeenCalledTimes(1);

    rerender({ items: [item({ reason: "approval_required", state: "approval_required", attentionSeq: 2 })], enabled: true });
    await waitFor(() => expect(toast.sendNotification).toHaveBeenCalledTimes(2));
  });

  it("só terminou/aprovação notificam — nunca silêncio, shell, travado ou o que já estava pendente", async () => {
    const { rerender } = renderHook(({ items }) => useAttentionNotifier(items, true), {
      initialProps: { items: [item({ sessionId: "antigo" })] },
    });
    rerender({
      items: [
        item({ sessionId: "antigo" }),
        item({ sessionId: "shell", attentionSeq: 0 }),
        item({ sessionId: "travou", reason: "crashed", state: "crashed" }),
        item({ sessionId: "parado", reason: "stopped", state: "stopped" }),
      ],
    });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(toast.sendNotification).not.toHaveBeenCalled();
  });

  it("cala a boca com a janela em foco ou com o aviso desligado", async () => {
    janela.isFocused.mockResolvedValue(true);
    const { unmount } = renderAfterStartup([item()]);
    await waitFor(() => expect(janela.isFocused).toHaveBeenCalled());
    expect(toast.sendNotification).not.toHaveBeenCalled();
    unmount();

    janela.isFocused.mockResolvedValue(false);
    renderAfterStartup([item()], false);
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(toast.sendNotification).not.toHaveBeenCalled();
  });

  it("resume num aviso só quando são muitos agentes de uma vez", async () => {
    const muitos = ["a", "b", "c", "d"].map((id) => item({ sessionId: id }));
    renderAfterStartup(muitos);

    await waitFor(() => expect(toast.sendNotification).toHaveBeenCalledTimes(1));
    expect(toast.sendNotification).toHaveBeenCalledWith({
      title: "OMNI AGENTS",
      body: "4 agentes precisam de você",
    });
  });

  it("testarAviso ignora o foco e devolve o erro real em vez de engolir", async () => {
    janela.isFocused.mockResolvedValue(true);

    await expect(testarAviso()).resolves.toBeNull();
    expect(toast.sendNotification).toHaveBeenCalledTimes(1);

    toast.isPermissionGranted.mockResolvedValue(false);
    toast.requestPermission.mockResolvedValue("denied");
    await expect(testarAviso()).resolves.toMatch(/negou permissão/i);

    toast.isPermissionGranted.mockRejectedValue(new Error("plugin notification not found"));
    await expect(testarAviso()).resolves.toBe("plugin notification not found");
  });
});
