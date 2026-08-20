// MVP: logs go to console only.
// Post-MVP: route to %APPDATA%/PDFToMarkdown/logs/app.log via Tauri fs plugin.

export type LogLevel = "info" | "warn" | "error";

interface LogEntry {
  timestamp: string;
  level: LogLevel;
  message: string;
  data?: Record<string, unknown>;
}

function formatEntry(entry: LogEntry): string {
  const base = `[${entry.timestamp}] [${entry.level.toUpperCase()}] ${entry.message}`;
  if (entry.data && Object.keys(entry.data).length > 0) {
    return `${base} ${JSON.stringify(entry.data)}`;
  }
  return base;
}

function write(level: LogLevel, message: string, data?: Record<string, unknown>): void {
  const entry: LogEntry = {
    timestamp: new Date().toISOString(),
    level,
    message,
    data,
  };
  const formatted = formatEntry(entry);
  if (level === "error") {
    console.error(formatted);
  } else if (level === "warn") {
    console.warn(formatted);
  } else {
    console.log(formatted);
  }
}

export const log = {
  info: (msg: string, data?: Record<string, unknown>) => write("info", msg, data),
  warn: (msg: string, data?: Record<string, unknown>) => write("warn", msg, data),
  error: (msg: string, data?: Record<string, unknown>) => write("error", msg, data),

  conversion: (fileName: string, status: "start" | "success" | "error", data?: Record<string, unknown>) => {
    write("info", `Conversion ${status}`, { fileName, ...data });
  },
};
