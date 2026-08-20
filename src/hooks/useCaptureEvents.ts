import { useCallback, useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import type { CapturePageResult } from "../services/conversionService";

export type CrawlPageEvent = CapturePageResult & { index: number; total: number };

/**
 * Acumula os eventos `capture-page-event` (uma página concluída por evento)
 * em ordem de chegada, para alimentar a lista ao vivo do crawl.
 */
export function useCaptureEvents() {
  const [paginas, setPaginas] = useState<CrawlPageEvent[]>([]);

  useEffect(() => {
    const un = listen<CrawlPageEvent>("capture-page-event", (e) => {
      setPaginas((prev) => [...prev, e.payload]);
    });
    return () => {
      un.then((fn) => fn());
    };
  }, []);

  const zerar = useCallback(() => setPaginas([]), []);

  return { paginas, zerar };
}
