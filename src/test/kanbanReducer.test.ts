import { describe, expect, it } from "vitest";
import { emptyKanban, kanbanReducer } from "../features/kanban/kanbanReducer";

describe("kanbanReducer", () => {
  it("cria task em backlog", () => {
    const state = kanbanReducer(emptyKanban(), {
      type: "CREATE_TASK",
      projectId: "p1",
      title: "Corrigir bug",
      description: "Descrição",
    });
    expect(state.tasks).toHaveLength(1);
    expect(state.tasks[0]).toMatchObject({ status: "backlog", projectId: "p1", title: "Corrigir bug" });
    expect(state.tasks[0].loopTotal).toBeNull();
  });

  it("MOVE_TASK muda o status", () => {
    let state = kanbanReducer(emptyKanban(), {
      type: "CREATE_TASK",
      projectId: "p1",
      title: "T",
      description: "",
    });
    const id = state.tasks[0].id;
    state = kanbanReducer(state, { type: "MOVE_TASK", id, status: "ready" });
    expect(state.tasks[0].status).toBe("ready");
  });

  it("TASK_FINISHED com loop pendente volta pra ready e decrementa, não fecha done", () => {
    let state = kanbanReducer(emptyKanban(), {
      type: "CREATE_TASK",
      projectId: "p1",
      title: "T",
      description: "",
      loopTotal: 3,
    });
    const id = state.tasks[0].id;
    expect(state.tasks[0].loopRemaining).toBe(3);

    state = kanbanReducer(state, { type: "TASK_STARTED", id });
    state = kanbanReducer(state, { type: "TASK_FINISHED", id, outcome: "done", resultNote: "ok" });

    expect(state.tasks[0].status).toBe("ready");
    expect(state.tasks[0].loopRemaining).toBe(2);
  });

  it("TASK_FINISHED na última rodada do loop fecha done", () => {
    let state = kanbanReducer(emptyKanban(), {
      type: "CREATE_TASK",
      projectId: "p1",
      title: "T",
      description: "",
      loopTotal: 2,
    });
    const id = state.tasks[0].id;
    state = kanbanReducer(state, { type: "TASK_FINISHED", id, outcome: "done", resultNote: "1" });
    expect(state.tasks[0].status).toBe("ready");
    state = kanbanReducer(state, { type: "TASK_FINISHED", id, outcome: "done", resultNote: "2" });
    expect(state.tasks[0].status).toBe("done");
    expect(state.tasks[0].loopRemaining).toBe(1);
  });

  it("TASK_FINISHED com falha nunca reprocessa o loop", () => {
    let state = kanbanReducer(emptyKanban(), {
      type: "CREATE_TASK",
      projectId: "p1",
      title: "T",
      description: "",
      loopTotal: 5,
    });
    const id = state.tasks[0].id;
    state = kanbanReducer(state, { type: "TASK_FINISHED", id, outcome: "failed", resultNote: "erro" });
    expect(state.tasks[0].status).toBe("failed");
    expect(state.tasks[0].loopRemaining).toBe(5);
  });

  it("circuit-breaker: 2 falhas não pausa, 3ª falha em 5min pausa por 30min", () => {
    let state = emptyKanban();
    state = kanbanReducer(state, { type: "RECORD_FAILURE" });
    state = kanbanReducer(state, { type: "RECORD_FAILURE" });
    expect(state.pausedUntil).toBeNull();
    expect(state.failureTimestamps).toHaveLength(2);

    state = kanbanReducer(state, { type: "RECORD_FAILURE" });
    expect(state.pausedUntil).not.toBeNull();
    const pausedMs = new Date(state.pausedUntil!).getTime() - Date.now();
    expect(pausedMs).toBeGreaterThan(29 * 60_000);
    expect(pausedMs).toBeLessThan(31 * 60_000);
    expect(state.failureTimestamps).toHaveLength(0);
  });

  it("CLEAR_PAUSE reseta pausa e janela de falhas", () => {
    let state = emptyKanban();
    for (let i = 0; i < 3; i += 1) state = kanbanReducer(state, { type: "RECORD_FAILURE" });
    expect(state.pausedUntil).not.toBeNull();

    state = kanbanReducer(state, { type: "CLEAR_PAUSE" });
    expect(state.pausedUntil).toBeNull();
    expect(state.failureTimestamps).toHaveLength(0);
  });

  it("SET_DISPATCHER_ENABLED e SET_AGENT_FOR_PROJECT", () => {
    let state = emptyKanban();
    state = kanbanReducer(state, { type: "SET_DISPATCHER_ENABLED", enabled: true });
    expect(state.dispatcherEnabled).toBe(true);
    state = kanbanReducer(state, { type: "SET_AGENT_FOR_PROJECT", projectId: "p1", agentId: "claude" });
    expect(state.agentByProject.p1).toBe("claude");
  });

  it("REMOVE_TASK remove a task", () => {
    let state = kanbanReducer(emptyKanban(), {
      type: "CREATE_TASK",
      projectId: "p1",
      title: "T",
      description: "",
    });
    const id = state.tasks[0].id;
    state = kanbanReducer(state, { type: "REMOVE_TASK", id });
    expect(state.tasks).toHaveLength(0);
  });
});
