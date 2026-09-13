import { $ } from "./state.js";
import { THEME_KEY, currentTheme } from "./ui.js";
import type { Theme } from "./ui.js";
import { writesToFolder } from "./store.js";

/**
 * The frame around the pages: theme, sidebar width, and the loading screen.
 *
 * None of it is about accounting and none of it touches the ledger. It is here
 * rather than in `ui.ts` because each of these remembers a choice -- which
 * theme, how wide -- and reading that back from the browser's own storage is
 * state, even when it is nobody's books.
 *
 * Both are applied before anything is drawn rather than after. A page that
 * renders light and then turns dark, or renders wide and then narrows, looks
 * like a fault even though it settles correctly.
 */

export function dismissLoading(): void {
  const el = document.getElementById("app-loading");
  if (!el) return;
  el.classList.add("dismissed");
  setTimeout(() => el.remove(), 400);
}

/**
 * Whether the menu is narrowed to icons.
 *
 * Beside the theme in localStorage rather than with the books: how wide
 * somebody likes their menu is a fact about them and this screen, and has no
 * business travelling in a folder that gets copied to a colleague.
 */
export const NARROW_KEY = "nzosa:narrow";

export function applyNarrow(narrow: boolean): void {
  document.querySelector(".shell")?.classList.toggle("narrow", narrow);
  const button = $("sidebar-toggle");
  button.setAttribute("aria-expanded", String(!narrow));
  button.title = narrow ? "Show the menu names" : "Narrow the menu to icons";
}

export function toggleNarrow(): void {
  const narrow = !document.querySelector(".shell")?.classList.contains("narrow");
  try {
    localStorage.setItem(NARROW_KEY, narrow ? "yes" : "no");
  } catch {
    // Not remembered, but still applied for this session.
  }
  applyNarrow(narrow);
}

export function applyTheme(theme: Theme): void {
  const root = document.documentElement;
  if (theme === "system") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", theme);

  // The button says what pressing it does next, not what the theme is now.
  const dark = theme === "dark" || (theme === "system" && matchMedia("(prefers-color-scheme: dark)").matches);
  const button = $("theme-toggle");
  button.textContent = dark ? "☀" : "☽";
  button.title =
    theme === "system"
      ? `Following this computer (${dark ? "dark" : "light"}). Click for ${dark ? "light" : "dark"}.`
      : `${theme[0]?.toUpperCase()}${theme.slice(1)}. Click to cycle light, dark, follow the computer.`;
}

export function cycleTheme(): void {
  const order: Theme[] = ["system", "light", "dark"];
  const next = order[(order.indexOf(currentTheme()) + 1) % order.length] as Theme;
  try {
    localStorage.setItem(THEME_KEY, next);
  } catch {
    // Not remembered, but still applied for this session.
  }
  applyTheme(next);
}

/** The frame: theme, sidebar width, and the demo banner. */
export function wireChrome(): void {
  const demoBanner = document.getElementById("demo-banner");
  if (demoBanner) {
    demoBanner.hidden = writesToFolder();
    $("demo-banner-close")?.addEventListener("click", () => {
      demoBanner.hidden = true;
    });
  }

  const demoNotice = document.getElementById("demo-import-privacy-notice");
  if (demoNotice) {
    demoNotice.hidden = writesToFolder();
  }
  $("sidebar-toggle").addEventListener("click", () => toggleNarrow());
  try {
    applyNarrow(localStorage.getItem(NARROW_KEY) === "yes");
  } catch {
    applyNarrow(false);
  }
  $("theme-toggle").addEventListener("click", () => cycleTheme());
  applyTheme(currentTheme());
  // Following the computer means noticing when the computer changes its mind.
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
    if (currentTheme() === "system") applyTheme("system");
  });
}
