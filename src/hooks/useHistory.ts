import { useState, useCallback } from "react";
import type { HistoryEntry } from "../types/conversion";
import {
  loadHistory,
  saveHistory,
  addHistoryEntry,
  removeHistoryEntry,
} from "../services/historyService";

export function useHistory(maxEntries?: number) {
  const [history, setHistory] = useState<HistoryEntry[]>(() => loadHistory());

  const addEntry = useCallback((entry: HistoryEntry) => {
    setHistory((prev) => {
      const updated = addHistoryEntry(prev, entry, maxEntries);
      saveHistory(updated);
      return updated;
    });
  }, [maxEntries]);

  const deleteEntry = useCallback((id: string) => {
    setHistory((prev) => {
      const updated = removeHistoryEntry(prev, id);
      saveHistory(updated);
      return updated;
    });
  }, []);

  const clearHistory = useCallback(() => {
    setHistory([]);
    saveHistory([]);
  }, []);

  return { history, addEntry, deleteEntry, clearHistory };
}
