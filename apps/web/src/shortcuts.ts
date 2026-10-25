/**
 * Keyboard shortcuts for starting the documents people write most: a new
 * invoice, a new bill, a new journal.
 *
 * Alt+Shift with a letter, because Ctrl with I, B or J is the browser's own
 * (italic, bookmarks, downloads) and taking those would surprise people. Read
 * by the key's place (`code`), not the letter it types, since Option on a Mac
 * turns Shift+I into a different character.
 *
 * What each does is handed in by main.ts: a page never reaches into another.
 */
export interface ShortcutActions {
  invoice: () => void;
  bill: () => void;
  journal: () => void;
}

export const SHORTCUTS: readonly { code: string; key: string; does: string; action: keyof ShortcutActions }[] = [
  { code: "KeyI", key: "Alt+Shift+I", does: "New invoice", action: "invoice" },
  { code: "KeyB", key: "Alt+Shift+B", does: "New bill", action: "bill" },
  { code: "KeyJ", key: "Alt+Shift+J", does: "New journal", action: "journal" },
];

export function wireShortcuts(actions: ShortcutActions): void {
  document.addEventListener("keydown", (event) => {
    if (!event.altKey || !event.shiftKey || event.ctrlKey || event.metaKey) return;
    const shortcut = SHORTCUTS.find((s) => s.code === event.code);
    if (shortcut === undefined) return;
    // A dialog waiting for an answer keeps the keyboard.
    if (document.querySelector("dialog[open]") !== null) return;
    event.preventDefault();
    actions[shortcut.action]();
  });
}
