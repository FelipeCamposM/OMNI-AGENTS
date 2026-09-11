import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, act } from "@testing-library/react";
import { usePoll } from "../mobile/usePoll";

function Probe({ run, onError }: { run: () => Promise<void>; onError?: (reason: unknown) => void }) {
  usePoll(run, onError ?? (() => undefined), []);
  return null;
}

/** jsdom expõe document.hidden como getter só-leitura; trocar visibilityState não basta. */
function setHidden(hidden: boolean) {
  Object.defineProperty(document, "hidden", { configurable: true, get: () => hidden });
}

/** Deixa microtasks pendentes resolverem antes de avançar o relógio falso. */
async function settle() {
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });
}

beforeEach(() => { vi.useFakeTimers(); setHidden(false); });
afterEach(() => { vi.useRealTimers(); });

describe("usePoll", () => {
  it("com a aba oculta não busca nada, e busca assim que ela volta", async () => {
    // É o caso normal do celular: a aba volta de background. Antes, a primeira carga era pulada
    // e a tela ficava vazia sem erro até o próximo tick — com backoff, até 60s.
    setHidden(true);
    const run = vi.fn().mockResolvedValue(undefined);
    render(<Probe run={run} />);
    await settle();
    expect(run).not.toHaveBeenCalled();

    setHidden(false);
    await act(async () => { document.dispatchEvent(new Event("visibilitychange")); });
    await settle();
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("acordar não deixa duas cadeias de timer vivas", async () => {
    const run = vi.fn().mockResolvedValue(undefined);
    render(<Probe run={run} />);
    await settle();
    expect(run).toHaveBeenCalledTimes(1);

    // Acorda enquanto já existe um timer agendado: a cadeia antiga tem que morrer.
    await act(async () => { document.dispatchEvent(new Event("visibilitychange")); });
    await settle();
    expect(run).toHaveBeenCalledTimes(2);

    await act(async () => { await vi.advanceTimersByTimeAsync(5_000); });
    await settle();
    // Uma cadeia só: 3, não 4.
    expect(run).toHaveBeenCalledTimes(3);
  });

  it("erro aciona backoff, e voltar para a aba recomeça sem esperar por ele", async () => {
    const onError = vi.fn();
    const run = vi.fn().mockRejectedValue(new Error("offline"));
    render(<Probe run={run} onError={onError} />);
    await settle();
    expect(onError).toHaveBeenCalledTimes(1);

    // 5s era o intervalo normal; após falhar, o próximo só viria em 10s.
    await act(async () => { await vi.advanceTimersByTimeAsync(5_000); });
    await settle();
    expect(run).toHaveBeenCalledTimes(1);

    await act(async () => { document.dispatchEvent(new Event("visibilitychange")); });
    await settle();
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("desmontar para de agendar", async () => {
    const run = vi.fn().mockResolvedValue(undefined);
    const view = render(<Probe run={run} />);
    await settle();
    view.unmount();
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
    expect(run).toHaveBeenCalledTimes(1);
  });
});
