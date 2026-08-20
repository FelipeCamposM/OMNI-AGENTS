import type { HistoryEntry } from "../types/conversion";

const STORAGE_KEY = "pdf-to-markdown-history";
const DEFAULT_MAX_ENTRIES = 50;

export function loadHistory(): HistoryEntry[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as HistoryEntry[];
  } catch {
    return [];
  }
}

export function saveHistory(entries: HistoryEntry[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
  } catch {
    // Silently fail
  }
}

export function addHistoryEntry(
  entries: HistoryEntry[],
  entry: HistoryEntry,
  maxEntries = DEFAULT_MAX_ENTRIES
): HistoryEntry[] {
  const updated = [entry, ...entries];
  return updated.slice(0, Math.max(1, maxEntries));
}

export function removeHistoryEntry(
  entries: HistoryEntry[],
  id: string
): HistoryEntry[] {
  return entries.filter((e) => e.id !== id);
}
