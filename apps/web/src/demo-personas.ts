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
  /** Where to land after loading: the page that is this one's own. */
  page: string;
  /** Offered to visitors. Books still being built are not. */
  ready?: boolean;
}

export const DEMO_PERSONAS: readonly DemoPersona[] = [
  {
    id: "",
    label: "A coffee roastery with two rentals",
    shows: "Invoices, GST returns, rental schedules, bank feeds",
    page: "reconcile",
    ready: true,
  },
  {
    id: "society",
    label: "A sailing club (incorporated society)",
    shows: "Grants and what became of them, donations, society reports",
    page: "grants",
  },
  {
    id: "trust",
    label: "A family trust",
    shows: "Settlors, trustees and beneficiaries, and the IR6",
    page: "ir6",
  },
  {
    id: "personal",
    label: "A person: salary, interest and dividends",
    shows: "Their own IR3, with PAYE and RWT credits",
    page: "personalyear",
  },
];

const KEY = "nzosa:demo-persona";

/** The persona last chosen in this browser; the main demo when none. */
export function currentDemoPersona(): string {
  try {
    const held = localStorage.getItem(KEY) ?? "";
    return DEMO_PERSONAS.some((p) => p.id === held) ? held : "";
  } catch {
    return "";
  }
}

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
