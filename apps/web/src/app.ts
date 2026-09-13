/**
 * Asking another page to redraw itself.
 *
 * A page is drawn from the state, so anything that changes the state has to
 * say which pages are now out of date. Saying it by calling the other page's
 * render function directly is what kept every page in one file: entering an
 * entity redraws the entity list, which means the function that saves an
 * entity has to be able to see the function that draws one, and so the two
 * cannot be in separate modules without each importing the other.
 *
 * The dependency is real and the direct call is not. What a save actually
 * needs to say is "the entity list is stale", and that is what this is. Pages
 * register themselves once; everything else names the page and knows nothing
 * else about it.
 *
 * The names are checked, not strings in the loose sense: `PageName` is a
 * union, so a page that is asked for and never registered is a compile error
 * rather than a screen that quietly stops updating.
 */

export type PageName =
  | "assets"
  | "check"
  | "entities"
  | "history"
  | "importRows"
  | "invoiceEditor"
  | "invoices"
  | "openingBalances"
  | "reconcile"
  | "reports"
  | "rules"
  | "setup"
  | "setupBody"
  | "variance";

export type Pages = Record<PageName, () => void>;

/**
 * Empty until the app has started.
 *
 * Loading a ledger changes the state before there is anything on screen to
 * redraw, so a redraw before registration is a no-op rather than a fault. It
 * cannot hide a page that was forgotten: `registerPages` takes the whole set
 * at once, so leaving one out does not compile.
 */
let pages: Partial<Pages> = {};

export function registerPages(all: Pages): void {
  pages = all;
}

export function redraw(page: PageName): void {
  pages[page]?.();
}
