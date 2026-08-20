import "@testing-library/jest-dom";

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
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn().mockResolvedValue(() => {}),
}));
vi.mock("@tauri-apps/api/app", () => ({
  getVersion: vi.fn().mockResolvedValue("0.1.0"),
}));
