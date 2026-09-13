import { describe, expect, it, vi } from "vitest";
import { handleTerminalKey } from "../features/terminal/keyBindings";

function press(init: KeyboardEventInit & { key: string }, hasSelection = false) {
  const event = new KeyboardEvent("keydown", { cancelable: true, ...init });
  const ctx = {
    hasSelection: () => hasSelection,
    copySelection: vi.fn(),
    write: vi.fn(),
  };
  const handled = handleTerminalKey(event, ctx);
  return { handled, ctx, prevented: event.defaultPrevented };
}

describe("atalhos do terminal", () => {
  it("Ctrl+V só tira a tecla do xterm — o paste nativo tem que seguir", () => {
    const { handled, ctx, prevented } = press({ key: "v", ctrlKey: true });
    expect(handled).toBe(false);
    // Cancelar o evento mataria o paste nativo; escrever na PTY aqui colaria duas vezes.
    expect(prevented).toBe(false);
    expect(ctx.write).not.toHaveBeenCalled();
  });

  it("Shift+Enter manda ESC+CR e cancela o evento", () => {
    const { handled, ctx, prevented } = press({ key: "Enter", shiftKey: true });
    expect(handled).toBe(false);
    // Sem isso o "\n" nativo vaza pro xterm e a CLI envia a mensagem.
    expect(prevented).toBe(true);
    expect(ctx.write).toHaveBeenCalledWith("\x1b\r");
  });

  it("Ctrl+C copia só quando há seleção; sem seleção continua sendo SIGINT", () => {
    const comSelecao = press({ key: "c", ctrlKey: true }, true);
    expect(comSelecao.handled).toBe(false);
    expect(comSelecao.ctx.copySelection).toHaveBeenCalled();

    const semSelecao = press({ key: "c", ctrlKey: true }, false);
    expect(semSelecao.handled).toBe(true);
    expect(semSelecao.ctx.copySelection).not.toHaveBeenCalled();
  });

  it("Enter puro e teclas normais seguem pro xterm", () => {
    expect(press({ key: "Enter" }).handled).toBe(true);
    expect(press({ key: "a" }).handled).toBe(true);
  });
});
