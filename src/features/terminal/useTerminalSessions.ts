import { useEffect, useState } from "react";
import { ensureEngine, listTerminalSessions, type TerminalSession } from "./terminalService";

export function useTerminalSessions() {
  const [sessions, setSessions] = useState<TerminalSession[]>([]);
  const [online, setOnline] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let timer: number | undefined;

    async function refresh() {
      try {
        await ensureEngine();
        const next = await listTerminalSessions();
        if (!cancelled) {
          setSessions(next);
          setOnline(true);
        }
      } catch {
        if (!cancelled) setOnline(false);
      }
      if (!cancelled) timer = window.setTimeout(refresh, 1_000);
    }

    void refresh();
    return () => {
      cancelled = true;
      if (timer) window.clearTimeout(timer);
    };
  }, []);

  return { sessions, online };
}
