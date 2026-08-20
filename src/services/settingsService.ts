import type { AppSettings } from "../types/settings";
import { DEFAULT_SETTINGS } from "../types/settings";

const STORAGE_KEY = "camps-utils-settings";
const LEGACY_KEY = "pdf-to-markdown-settings";

export function loadSettings(): AppSettings {
  try {
    const raw =
      localStorage.getItem(STORAGE_KEY) ?? localStorage.getItem(LEGACY_KEY);
    const parsed = raw ? (JSON.parse(raw) as Partial<AppSettings>) : {};
    return { ...DEFAULT_SETTINGS, ...parsed };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(settings: AppSettings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Silently fail — settings are not critical
  }
}

/** Bytes ocupados pelas chaves do app no localStorage (aproximado). */
export function storageUsedBytes(): number {
  try {
    let total = 0;
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key) continue;
      total += key.length + (localStorage.getItem(key)?.length ?? 0);
    }
    return total * 2; // UTF-16
  } catch {
    return 0;
  }
}
