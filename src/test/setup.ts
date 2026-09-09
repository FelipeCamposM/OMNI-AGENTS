import "@testing-library/jest-dom";
import React from "react";

// Mock Tauri APIs unavailable in jsdom
const mockTauri = {
  invoke: vi.fn().mockResolvedValue("{}"),
  convertFileSrc: (path: string) => path,
};

vi.mock("@tauri-apps/api/core", () => mockTauri);
vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: vi.fn().mockResolvedValue(null),
  save: vi.fn().mockResolvedValue(null),
}));
vi.mock("@tauri-apps/api/webviewWindow", () => ({
  getCurrentWebviewWindow: () => ({
    onDragDropEvent: vi.fn().mockResolvedValue(() => {}),
  }),
}));
vi.mock("@tauri-apps/plugin-opener", () => ({
  openPath: vi.fn().mockResolvedValue(undefined),
  revealItemInDir: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn().mockResolvedValue(() => {}),
}));
vi.mock("@tauri-apps/api/app", () => ({
  getVersion: vi.fn().mockResolvedValue("0.1.0"),
}));
vi.mock("@xterm/xterm", () => ({
  Terminal: class TerminalMock {
    rows = 24;
    cols = 80;
    loadAddon() {}
    open() {}
    write() {}
    dispose() {}
    onData() { return { dispose() {} }; }
    attachCustomKeyEventHandler() {}
    hasSelection() { return false; }
    getSelection() { return ""; }
  },
}));
vi.mock("@xterm/addon-fit", () => ({
  FitAddon: class FitAddonMock { fit() {} },
}));
vi.mock("@tauri-apps/plugin-fs", () => ({
  readDir: vi.fn().mockResolvedValue([]),
  readTextFile: vi.fn().mockResolvedValue(""),
  writeTextFile: vi.fn().mockResolvedValue(undefined),
  exists: vi.fn().mockResolvedValue(false),
  stat: vi.fn().mockResolvedValue({ mtime: null }),
  mkdir: vi.fn().mockResolvedValue(undefined),
  remove: vi.fn().mockResolvedValue(undefined),
  rename: vi.fn().mockResolvedValue(undefined),
  copyFile: vi.fn().mockResolvedValue(undefined),
  writeFile: vi.fn().mockResolvedValue(undefined),
}));
// Monaco não roda de verdade em jsdom (contenteditable/workers reais). O stand-in é um
// <textarea> ligado a onChange — testa a lógica do nosso FilePane, não o Monaco em si.
// `monacoSetup.ts` importa os workers do Monaco com o sufixo `?worker` do Vite, que o
// pipeline de transform do Vitest não resolve fora do client build — mockado inteiro.
vi.mock("../features/files/monacoSetup", () => ({}));
vi.mock("monaco-editor", () => ({}));
vi.mock("@monaco-editor/react", () => ({
  loader: { config: vi.fn() },
  default: ({
    defaultValue,
    onChange,
  }: {
    defaultValue?: string;
    onChange?: (value: string | undefined) => void;
  }) => {
    return React.createElement("textarea", {
      "aria-label": "editor de código",
      defaultValue,
      onChange: (event: React.ChangeEvent<HTMLTextAreaElement>) => onChange?.(event.target.value),
    });
  },
}));
