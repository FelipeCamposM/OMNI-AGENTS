import { afterEach, describe, expect, it } from "vitest";
import { comboFromEvent, matchesShortcut, setRecordingShortcut, setShortcutOverrides } from "../lib/shortcuts";

const key = (init: KeyboardEventInit) => new KeyboardEvent("keydown", init);

describe("shortcuts", () => {
  afterEach(() => {
    setShortcutOverrides({});
    setRecordingShortcut(false);
  });

  it("monta o combo pelo code em letras e ignora modificador sozinho", () => {
    expect(comboFromEvent(key({ key: "P", code: "KeyP", ctrlKey: true, shiftKey: true }))).toBe("Ctrl+Shift+P");
    expect(comboFromEvent(key({ key: " ", code: "Space", ctrlKey: true, shiftKey: true }))).toBe("Ctrl+Shift+Space");
    expect(comboFromEvent(key({ key: "Control", ctrlKey: true }))).toBeNull();
  });

  it("usa o padrão, respeita a troca do usuário e silencia durante a gravação", () => {
    expect(matchesShortcut(key({ key: "p", ctrlKey: true }), "quickOpen")).toBe(true);
    setShortcutOverrides({ quickOpen: "Ctrl+K" });
    expect(matchesShortcut(key({ key: "p", ctrlKey: true }), "quickOpen")).toBe(false);
    expect(matchesShortcut(key({ key: "k", ctrlKey: true }), "quickOpen")).toBe(true);
    setRecordingShortcut(true);
    expect(matchesShortcut(key({ key: "k", ctrlKey: true }), "quickOpen")).toBe(false);
  });
});
