/**
 * The sets of invented books the online demo can be viewed as.
 *
 * The coffee roastery with two rentals is the demo. The others exist so a
 * visitor can see the parts of NZOSA it never shows -- a society's grants, a
 * trust's people and IR6, a person's own IR3 -- without having to know those
 * pages are there: each page only appears for books that use it.
 */

export interface DemoPersona {
  /** The folder under `demo/`; empty for the main demo. */
  id: string;
  label: string;
  /** What it shows, in a line. */
  shows: string;
  /** Who these books belong to, said at the start of the first lesson. */
  about: string;
  /** Where to land after loading: the page that is this one's own. */
  page: string;
  /** Offered to visitors. Books still being built are not. */
  ready?: boolean;
  /** The country the books are kept in, for its flag: New Zealand when not said. */
  country?: "nz" | "us" | "au";
}

/** A demo set's country and its name, for its flag. */
export function personaCountry(persona: DemoPersona | undefined): { id: string; name: string } {
  const id = persona?.country ?? "nz";
  return { id, name: id === "us" ? "United States" : id === "au" ? "Australia" : "New Zealand" };
}

export const DEMO_PERSONAS: readonly DemoPersona[] = [
  {
    id: "",
    label: "A coffee roastery with two rentals",
    shows: "Invoices, GST returns, a company's IR4, rental schedules and the owners' IR3s",
    about: "These demo books are invented: Kea Coffee Roasters in Nelson, and two rental properties owned by Ana and Tom Whitcombe.",
    page: "reconcile",
    ready: true,
  },
  {
    id: "payroll",
    label: "A bakery with three staff",
    shows: "Pay runs, PAYE and KiwiSaver, payday filing, GST and the company's IR4",
    about: "These demo books are invented: Māpua Bakehouse Limited, a bakery and café with three staff on fortnightly pay, registered for GST.",
    page: "payroll",
    ready: true,
  },
  {
    id: "society",
    label: "A sailing club (incorporated society)",
    shows: "Grants and what became of them, the society's statements and its IR9",
    about: "These demo books are invented: Harbourside Sailing Club, an incorporated society with 124 members, a clubroom bar and a grant to renew its training fleet.",
    page: "grants",
    ready: true,
  },
  {
    id: "trust",
    label: "A family trust",
    shows: "Settlor, beneficiaries and their accounts, income allocated, and the IR6",
    about: "These demo books are invented: the Whitcombe Family Trust, which owns a rental house and a term deposit, and allocates its income to two beneficiaries.",
    page: "ir6",
    ready: true,
  },
  {
    id: "personal",
    label: "A person with a rental flat",
    shows: "Salary, interest and dividends, a rental schedule, and the IR3",
    about: "These demo books are invented: Sam Taylor, a physiotherapist on a salary, with a home loan, some shares and a rental flat.",
    page: "personalyear",
    ready: true,
  },
  {
    id: "us",
    label: "A US freelancer with a rental (United States)",
    shows: "US books: Schedule C, Schedule E, 1099-NEC contractors, no sales tax",
    about:
      "These demo books are invented and kept as United States books: Ellis Design Studio, a sole proprietor " +
      "design business, and a rented duplex, for January to September 2026.",
    page: "reconcile",
    ready: true,
    country: "us",
  },
  {
    id: "au",
    label: "A photographer with a rental (Australia)",
    shows: "Australian books: the BAS (simpler or full, PAYG withheld and instalments), payroll with super, the rental property schedule and the tax estimate",
    about:
      "These demo books are invented and kept as Australian books: Wattle & Lens Photography, a sole trader " +
      "registered for GST in Brisbane with a part-time assistant on monthly pay, and a rental house in Newcastle, " +
      "for the year to 30 June 2026.",
    page: "reconcile",
    ready: true,
    country: "au",
  },
];

const KEY = "nzosa:demo-persona";

/** The persona last chosen in this browser; the main demo when none. */
export function currentDemoPersona(): string {
  try {
    const held = localStorage.getItem(KEY);
    if (held !== null) return DEMO_PERSONAS.some((p) => p.id === held) ? held : "";
  } catch {
    // Without storage, the visitor's own part of the world decides.
  }
  return firstDemoPersona();
}

/**
 * The books a first visit opens on: the United States set for somebody whose
 * computer keeps United States time, the Australian set for Australian time,
 * the New Zealand ones for everyone else.
 * Read from the browser's own time zone, so nothing about the visitor -- not
 * even their address -- is sent anywhere to find out.
 */
export function firstDemoPersona(): string {
  let zone = "";
  try {
    zone = Intl.DateTimeFormat().resolvedOptions().timeZone ?? "";
  } catch {
    return "";
  }
  const ready = (id: string): boolean => DEMO_PERSONAS.some((p) => p.id === id && p.ready === true);
  if (ready("us") && US_TIME_ZONE.test(zone)) return "us";
  if (ready("au") && /^Australia\//.test(zone)) return "au";
  return "";
}

/** The time zones of the fifty states and Washington, D.C. */
const US_TIME_ZONE =
  /^(America\/(New_York|Detroit|Chicago|Denver|Phoenix|Boise|Los_Angeles|Anchorage|Juneau|Sitka|Metlakatla|Yakutat|Nome|Adak|Menominee|Indiana\/.+|Kentucky\/.+|North_Dakota\/.+)|Pacific\/Honolulu|US\/.+)$/;

export function rememberDemoPersona(id: string): void {
  try {
    if (id === "") localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, id);
  } catch {
    // Without storage the demo simply opens on the main books next time.
  }
}

/** Where a persona's files are served from. */
export function demoFolder(id: string): string {
  return id === "" ? "demo" : `demo/${id}`;
}
