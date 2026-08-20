export interface SelectedFile {
  name: string;
  path: string;
  size: number;
}

export interface ConversionRequest {
  inputPath: string;
  outputPath?: string;
}

export interface ConversionSuccess {
  success: true;
  outputPath: string;
  markdown: string;
  durationMs: number;
}

export interface ConversionFailure {
  success: false;
  errorCode: ErrorCode;
  message: string;
}

export type ConversionResult = ConversionSuccess | ConversionFailure;

export type ErrorCode =
  | "INVALID_INPUT"
  | "FILE_NOT_FOUND"
  | "INVALID_EXTENSION"
  | "OUTPUT_ERROR"
  | "MODEL_ERROR"
  | "CONVERSION_FAILED"
  | "UNKNOWN_ERROR"
  | "SIDECAR_ERROR";

export type FileItemStatus = "pending" | "converting" | "success" | "error";

export interface FileItem {
  id: string;
  file: SelectedFile;
  status: FileItemStatus;
  progressStep: number;
  markdown?: string;
  savedPath?: string | null;
  durationMs?: number;
  errorMessage?: string;
  errorCode?: string;
}

export interface HistoryEntry {
  id: string;
  tool: string;
  filename: string;
  inputPath: string;
  outputPath?: string;
  durationMs: number;
  timestamp: number;
  success: boolean;
  markdown?: string;
}

export type AppView = "converter" | "history";

export interface AppState {
  view: AppView;
  files: FileItem[];
  activeFileId: string | null;
  selectedHistoryId: string | null;
}

export type AppAction =
  | { type: "SET_VIEW"; view: AppView }
  | { type: "ADD_FILES"; files: FileItem[] }
  | { type: "REMOVE_FILE"; id: string }
  | { type: "SET_ACTIVE_FILE"; id: string | null }
  | { type: "UPDATE_FILE"; id: string; updates: Partial<FileItem> }
  | { type: "SET_HISTORY_SELECTION"; id: string | null }
  | { type: "RESET_QUEUE" };

export const INITIAL_STATE: AppState = {
  view: "converter",
  files: [],
  activeFileId: null,
  selectedHistoryId: null,
};

export function appReducer(state: AppState, action: AppAction): AppState {
  switch (action.type) {
    case "SET_VIEW":
      return { ...state, view: action.view };

    case "ADD_FILES":
      return { ...state, files: [...state.files, ...action.files] };

    case "REMOVE_FILE": {
      const newFiles = state.files.filter((f) => f.id !== action.id);
      const newActiveId =
        state.activeFileId === action.id
          ? (newFiles.find((f) => f.status === "success")?.id ?? null)
          : state.activeFileId;
      return { ...state, files: newFiles, activeFileId: newActiveId };
    }

    case "SET_ACTIVE_FILE":
      return { ...state, activeFileId: action.id };

    case "UPDATE_FILE":
      return {
        ...state,
        files: state.files.map((f) =>
          f.id === action.id ? { ...f, ...action.updates } : f
        ),
      };

    case "SET_HISTORY_SELECTION":
      return { ...state, selectedHistoryId: action.id };

    case "RESET_QUEUE":
      return { ...state, files: [], activeFileId: null };

    default:
      return state;
  }
}
