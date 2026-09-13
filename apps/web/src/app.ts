import { $, state } from "./state.js";

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
  | "books"
  | "check"
  | "entities"
  | "entityFilter"
  | "feed"
  | "history"
  | "importRows"
  | "invoiceEditor"
  | "invoices"
  | "openBooks"
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

/**
 * Going to a page.
 *
 * The sections are one scrolling document with all but one hidden, so this is
 * what "navigation" means here: show the section, mark the sidebar, put the
 * name in the topbar, and ask the page to draw itself.
 *
 * It sits beside the registry because it is the registry's only real caller:
 * showing a page and knowing who draws it are the same question, and keeping
 * them apart meant the router had to import every page in the app.
 */
export function showPage(page: string, scrollTo?: "top" | "bottom" | number): void {
  // Arriving at a page half way down it is disorienting: the sections are all
  // one scrolling document, so the position simply carried over from wherever
  // you were on the last one. Only on an actual change of page, because this
  // is also how a page redraws itself -- jumping to the top every time
  // somebody codes a line would be worse than the thing it fixes.
  // The bank feed used to be a page of its own and is now a section of the
  // import page. A ledger saved before that still names it.
  if (page === "feed") page = "import";
  const moved = state.page !== page;
  state.page = page;
  for (const section of document.querySelectorAll<HTMLElement>("section.page")) {
    section.hidden = section.id !== `page-${page}`;
  }
  for (const button of document.querySelectorAll<HTMLButtonElement>(".sidebar-nav button[data-page]")) {
    button.classList.toggle("active", button.dataset["page"] === page);
  }
  const sidebarSublinks = document.getElementById("sidebar-import-sublinks");
  if (sidebarSublinks) {
    const isImport = page === "import";
    sidebarSublinks.classList.toggle("open", isImport);
    sidebarSublinks.hidden = !isImport;
  }
  // The page name lives in the topbar now rather than inside each section, so
  // it is read off the sidebar rather than repeated in a second list that
  // could drift from it.
  const chosen = document.querySelector<HTMLButtonElement>(
    `.sidebar-nav button[data-page="${page}"]`,
  );
  $("page-title").textContent = chosen?.querySelector("span")?.textContent ?? "";

  const status = $("startup-status");
  status.textContent = state.startupMessage;
  status.hidden = state.startupMessage === "";

  redraw("entityFilter");
  redraw("openBooks");
  if (page === "reconcile") redraw("reconcile");
  if (page === "check") redraw("check");
  if (page === "rules") redraw("rules");
  if (page === "entities") redraw("entities");
  if (page === "reports") redraw("reports");
  if (page === "invoices") {
    redraw("invoiceEditor");
    redraw("invoices");
  }
  if (page === "history") redraw("history");
  if (page === "books") redraw("books");
  if (page === "assets") redraw("assets");
  if (page === "setup") redraw("setup");
  if (page === "import") redraw("feed");
  if (page === "opening") redraw("openingBalances");
  if (page === "gst") redraw("variance");

  if (scrollTo === "bottom") {
    let scrolled = false;
    const doScrollBottom = () => {
      const unlinkedSelect = Array.from(
        document.querySelectorAll<HTMLSelectElement>("table.accounts-table select.bank-link"),
      ).find((sel) => sel.value === "");
      const bankRow =
        unlinkedSelect?.closest("tr") ??
        document.querySelectorAll<HTMLSelectElement>("table.accounts-table select.bank-link")[0]?.closest("tr");
      if (bankRow) {
        bankRow.scrollIntoView({ behavior: "smooth", block: "center" });
        if (!scrolled) {
          bankRow.classList.add("highlight-flash");
          setTimeout(() => bankRow.classList.remove("highlight-flash"), 2200);
          scrolled = true;
        }
      } else {
        const b = Math.max(
          document.documentElement.scrollHeight,
          document.body.scrollHeight,
          document.getElementById("page-entities")?.scrollHeight ?? 0,
          999999,
        );
        window.scrollTo(0, b);
        document.documentElement.scrollTop = b;
        document.body.scrollTop = b;
      }
    };
    doScrollBottom();
    requestAnimationFrame(doScrollBottom);
    setTimeout(doScrollBottom, 60);
    setTimeout(doScrollBottom, 200);
    setTimeout(doScrollBottom, 450);
  } else if (typeof scrollTo === "number") {
    window.scrollTo({ top: scrollTo, behavior: "instant" });
  } else if (moved) {
    window.scrollTo({ top: 0, behavior: "instant" as ScrollBehavior });
  }
}
