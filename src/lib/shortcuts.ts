/**
 * Atalhos de teclado configuráveis. Combo = string tipo "Ctrl+Shift+P".
 * Estado de módulo (igual `motion.ts`): `useSettings` injeta as trocas do usuário e os listeners
 * leem na hora do evento — nada de prop descendo até cada `keydown`.
 */

export type ShortcutId =
  | "quickOpen"
  | "splitHorizontal"
  | "splitVertical"
  | "closePane"
  | "maximizePane"
  | "nextAttention"
  | "newBranch"
  | "returnToApp"
  | "closeSettings";

export const SHORTCUTS: { id: ShortcutId; label: string; default: string }[] = [
  { id: "quickOpen", label: "Buscar arquivo", default: "Ctrl+P" },
  { id: "splitHorizontal", label: "Dividir painel lado a lado", default: "Ctrl+\\" },
  { id: "splitVertical", label: "Dividir painel em cima/embaixo", default: "Ctrl+Shift+|" },
  { id: "closePane", label: "Fechar painel", default: "Ctrl+W" },
  { id: "maximizePane", label: "Maximizar painel", default: "Ctrl+M" },
  { id: "nextAttention", label: "Ir pro agente pedindo atenção", default: "Ctrl+Tab" },
  { id: "newBranch", label: "Criar branch a partir da atual", default: "Ctrl+Shift+B" },
  { id: "returnToApp", label: "Sair do terminal (devolve o teclado ao app)", default: "Ctrl+Shift+Space" },
  { id: "closeSettings", label: "Fechar configurações", default: "Escape" },
];

export type ShortcutOverrides = Partial<Record<ShortcutId, string>>;

let overrides: ShortcutOverrides = {};
let recording = false;

/** Chamado por useSettings sempre que a preferência muda. */
export function setShortcutOverrides(next: ShortcutOverrides) {
  overrides = next;
}

/** Enquanto o usuário grava um atalho nas Configurações, nenhum atalho dispara. */
export function setRecordingShortcut(value: boolean) {
  recording = value;
}

export function shortcutFor(id: ShortcutId): string {
  return overrides[id] ?? SHORTCUTS.find((s) => s.id === id)!.default;
}

const MODIFIERS = new Set(["Control", "Shift", "Alt", "Meta"]);

/** Combo do evento, ou `null` se só tem modificador. Letra/dígito vêm do `code` pra Shift/layout
 * não mudarem o nome; o resto usa o `key` (Shift+\ vira "|" em qualquer layout). */
export function comboFromEvent(event: KeyboardEvent | React.KeyboardEvent): string | null {
  if (MODIFIERS.has(event.key)) return null;
  const code = /^(Key|Digit)(\w)$/.exec(event.code ?? "");
  const key = code ? code[2] : event.key === " " ? "Space" : event.key.length === 1 ? event.key.toUpperCase() : event.key;
  const parts = [event.ctrlKey && "Ctrl", event.altKey && "Alt", event.shiftKey && "Shift", event.metaKey && "Meta"];
  return [...parts.filter(Boolean), key].join("+");
}

export function matchesShortcut(event: KeyboardEvent, id: ShortcutId): boolean {
  return !recording && comboFromEvent(event) === shortcutFor(id);
}
