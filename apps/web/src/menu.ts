import { showPage } from "./app.js";
import { toggleNarrow } from "./chrome.js";
import { $, state } from "./state.js";

/**
 * The menu: which item is lit, which groups are open, and finding a page by
 * name.
 *
 * A flat list stopped being findable once it passed a dozen items, and it
 * mixed the one-off (loading a trial balance) with the every-day (coding a
 * line). So it is grouped by what somebody is doing, the groups fold, and
 * anything in it -- or any report -- can be found by typing.
 *
 * Three items are reports rather than pages: things typed in, or looked at
 * every period, that were only reachable through the report picker. They open
 * the Reports page on that report, and are lit instead of Reports while it
 * shows, so the menu never claims two places at once.
 */

const GROUPS_KEY = "nzosa:menu-groups";

type GroupChoice = Partial<Record<string, "open" | "closed">>;

// Beside the narrow-menu setting, and for the same reason: which groups
// somebody keeps open is about them and this screen, not about the books.
function storedGroups(): GroupChoice {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(GROUPS_KEY) ?? "{}");
    return typeof parsed === "object" && parsed !== null ? (parsed as GroupChoice) : {};
  } catch {
    return {};
  }
}

function storeGroup(name: string, choice: "open" | "closed"): void {
  try {
    localStorage.setItem(GROUPS_KEY, JSON.stringify({ ...storedGroups(), [name]: choice }));
  } catch {
    // Not remembered, but still applied until the next page.
  }
}

function menuItems(): HTMLButtonElement[] {
  return [
    ...document.querySelectorAll<HTMLButtonElement>(
      ".sidebar-nav button[data-page], .sidebar-nav button[data-report]",
    ),
    // The set of books at the foot of the menu is the way to the Books page,
    // so it is lit, titled and searched like any other item on it.
    ...document.querySelectorAll<HTMLButtonElement>(".sidebar-foot button[data-page]"),
  ];
}

function isMenuReport(kind: string): boolean {
  return menuItems().some((button) => button.dataset["report"] === kind);
}

/** Open a report, from the menu or from a search. */
export function openReport(kind: string): void {
  const select = document.querySelector<HTMLSelectElement>("#report-kind");
  if (select) select.value = kind;
  showPage("reports", "top");
}

/**
 * Reports, from the menu, is the list of reports -- unless what is showing is
 * a report with no item of its own, which is left where it was, as it always
 * has been. Otherwise pressing Reports while Manual journals shows would light
 * Manual journals and appear to do nothing.
 */
export function reportsFromMenu(): void {
  const select = document.querySelector<HTMLSelectElement>("#report-kind");
  if (select && isMenuReport(select.value)) select.value = "home";
}

function setCollapsed(group: HTMLElement, collapsed: boolean): void {
  group.classList.toggle("collapsed", collapsed);
  group.querySelector(".sidebar-heading")?.setAttribute("aria-expanded", String(!collapsed));
}

/**
 * Light the item for this page, name the page in the topbar, and open or fold
 * the groups.
 *
 * Run after the set-up progress is marked, because Set up folds itself away
 * once nothing is left to do there -- until somebody opens it, which is then
 * remembered. The group holding the page on screen is always open: a lit item
 * inside a folded group is a menu hiding where you are.
 */
export function markSidebar(page: string): void {
  const kind = page === "reports"
    ? (document.querySelector<HTMLSelectElement>("#report-kind")?.value ?? "")
    : "";
  const onMenuReport = page === "reports" && isMenuReport(kind);

  let active: HTMLButtonElement | undefined;
  for (const button of menuItems()) {
    const report = button.dataset["report"];
    const on = report !== undefined
      ? onMenuReport && report === kind
      : button.dataset["page"] === page && !onMenuReport;
    button.classList.toggle("active", on);
    if (on) active = button;
  }
  // The page name lives in the topbar rather than inside each section, so it
  // is read off the lit item rather than kept in a second list that could
  // drift from it.
  $("page-title").textContent = active?.querySelector("span")?.textContent ?? "";

  const stored = storedGroups();
  const setupLeft =
    document.querySelector('.sidebar-nav button[data-page="setup"]')?.classList.contains("needs-doing") === true;
  for (const group of document.querySelectorAll<HTMLElement>(".sidebar-group")) {
    const name = group.dataset["group"] ?? "";
    const choice = stored[name];
    let collapsed = choice !== undefined ? choice === "closed" : name === "setup" && !setupLeft;
    if (active !== undefined && group.contains(active)) collapsed = false;
    setCollapsed(group, collapsed);
  }
}

// --- search ---------------------------------------------------------------

/**
 * Other words for the same place. Somebody looking for depreciation types
 * "depreciation", not "Fixed assets", and an accountant types "trial balance".
 */
const KEYWORDS: Readonly<Record<string, string>> = {
  reconcile: "code coding categorise transactions review",
  import: "bank feed akahu csv statements balances upload",
  invoices: "sales customers receivables owed allocations",
  payroll: "wages salaries paye kiwisaver payday filing ird employee employer esct student loan",
  manual: "journal entries adjustments year end accountant",
  assets: "depreciation register disposals purchases",
  agents: "rental property management fees rent",
  yearend: "vehicle logbook private use prepayments balance date adjustments",
  reports: "all reports",
  gstreturn: "gst return box refund pay ird",
  migration: "start begin setup migration xero convert move new first",
  setup: "start files load",
  opening: "trial balance conversion year end",
  gst: "filed returns mark as filed variance",
  check: "xero coding compare account transactions",
  entities: "chart of accounts owners company rental gst registered bank links",
  rules: "coding rules automatic",
  ai: "ai gemini suggestions unknown unrecognised model key",
  books: "ledger switch open new set clear archive",
  history: "undo changes log who",
  pl: "profit and loss income statement p&l",
  balancesheet: "assets liabilities equity",
  depreciation: "fixed assets",
  shareholders: "current account drawings",
  ir10: "ird financial statements summary",
  journal: "trial balance",
  general: "general ledger",
  extract: "account transactions",
  rentals: "rental schedules ir3r",
  ir3: "individual tax return income tax",
  owner: "owners shares",
  charts: "analytics graphs",
};

interface Destination {
  label: string;
  where: string;
  words: string;
  go: () => void;
}

/** Everything the menu and the report picker hold, read off them rather than listed twice. */
function destinations(): Destination[] {
  const found: Destination[] = [];
  const names = new Set<string>();
  for (const button of menuItems()) {
    const label = button.querySelector("span")?.textContent?.trim() ?? "";
    const key = button.dataset["report"] ?? button.dataset["page"] ?? "";
    found.push({
      label,
      where: button.closest(".sidebar-group")?.querySelector(".sidebar-heading")?.textContent?.trim() ?? "",
      words: KEYWORDS[key] ?? "",
      go: () => button.click(),
    });
    names.add(label.toLowerCase());
  }
  for (const link of document.querySelectorAll<HTMLAnchorElement>("#sidebar-import-sublinks a")) {
    const target = link.getAttribute("href") ?? "";
    found.push({
      label: link.textContent?.trim() ?? "",
      where: "Bank import",
      words: "",
      go: () => {
        showPage("import");
        if (target.startsWith("#")) document.querySelector(target)?.scrollIntoView({ block: "start" });
      },
    });
  }
  for (const option of document.querySelectorAll<HTMLOptionElement>("#report-kind option")) {
    const label = option.textContent?.trim() ?? "";
    if (option.value === "home" || names.has(label.toLowerCase())) continue;
    const group = option.closest("optgroup")?.label ?? "";
    found.push({
      label,
      where: group === "" ? "Reports" : `Reports · ${group}`,
      words: KEYWORDS[option.value] ?? "",
      go: () => openReport(option.value),
    });
  }
  return found;
}

function matches(query: string): Destination[] {
  const words = query.toLowerCase().split(/\s+/).filter((word) => word !== "");
  if (words.length === 0) return [];
  const phrase = words.join(" ");
  return destinations()
    .flatMap((destination) => {
      const label = destination.label.toLowerCase();
      const haystack = `${label} ${destination.where.toLowerCase()} ${destination.words}`;
      if (!words.every((word) => haystack.includes(word))) return [];
      // Names before other words for them, so "gst" finds the GST pages
      // ahead of a report that merely mentions GST among its keywords.
      const score = label.startsWith(phrase) ? 0 : label.includes(phrase) ? 1 : 2;
      return [{ destination, score }];
    })
    .sort((a, b) => a.score - b.score)
    .slice(0, 8)
    .map((scored) => scored.destination);
}

function wireSearch(): void {
  const input = $<HTMLInputElement>("menu-search");
  const results = $("menu-search-results");
  let shown: Destination[] = [];
  let selected = 0;

  const close = (): void => {
    input.value = "";
    results.textContent = "";
    results.hidden = true;
    shown = [];
    selected = 0;
  };
  const go = (destination: Destination | undefined): void => {
    if (destination === undefined) return;
    close();
    input.blur();
    destination.go();
  };
  const draw = (): void => {
    shown = matches(input.value);
    selected = Math.min(selected, Math.max(shown.length - 1, 0));
    results.textContent = "";
    results.hidden = input.value.trim() === "";
    if (shown.length === 0) {
      const none = document.createElement("div");
      none.className = "menu-search-empty";
      none.textContent = "Nothing called that.";
      results.append(none);
      return;
    }
    shown.forEach((destination, index) => {
      const option = document.createElement("button");
      option.type = "button";
      option.setAttribute("role", "option");
      option.setAttribute("aria-selected", String(index === selected));
      if (index === selected) option.className = "selected";
      const name = document.createElement("span");
      name.textContent = destination.label;
      const where = document.createElement("small");
      where.textContent = destination.where;
      option.append(name, where);
      // Pressed rather than clicked would blur the input first, which hides
      // the list before the click lands on it.
      option.addEventListener("pointerdown", (event) => event.preventDefault());
      option.addEventListener("click", () => go(destination));
      results.append(option);
    });
  };

  input.addEventListener("input", () => {
    selected = 0;
    draw();
  });
  input.addEventListener("focus", () => {
    if (input.value.trim() !== "") draw();
  });
  input.addEventListener("blur", () => {
    results.hidden = true;
  });
  input.addEventListener("keydown", (event) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (shown.length === 0) return;
      selected = (selected + (event.key === "ArrowDown" ? 1 : shown.length - 1)) % shown.length;
      draw();
    } else if (event.key === "Enter") {
      event.preventDefault();
      go(shown[selected]);
    } else if (event.key === "Escape") {
      close();
      input.blur();
    }
  });

  // Ctrl+K, as most apps have it now. A menu narrowed to icons has no room for
  // the box, so it is widened first.
  document.addEventListener("keydown", (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
      event.preventDefault();
      if (document.querySelector(".shell")?.classList.contains("narrow")) toggleNarrow();
      input.focus();
      input.select();
    }
  });
}

export function wireMenu(): void {
  for (const button of document.querySelectorAll<HTMLButtonElement>(".sidebar-nav button[data-report]")) {
    button.addEventListener("click", () => openReport(button.dataset["report"] ?? "home"));
  }
  for (const heading of document.querySelectorAll<HTMLButtonElement>(".sidebar-nav .sidebar-heading")) {
    heading.addEventListener("click", () => {
      const group = heading.closest<HTMLElement>(".sidebar-group");
      if (!group) return;
      const collapse = !group.classList.contains("collapsed");
      setCollapsed(group, collapse);
      storeGroup(group.dataset["group"] ?? "", collapse ? "closed" : "open");
    });
  }
  // Choosing a report from the picker can move the light between Reports and
  // one of the report items.
  $("report-kind").addEventListener("change", () => markSidebar(state.page));
  wireSearch();
}
