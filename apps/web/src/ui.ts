import type { Invoice } from "@nzosa/core";

/**
 * Presentation primitives, with no opinion about what is being presented.
 *
 * Everything here takes what it needs as an argument and returns an element.
 * Nothing reads the ledger, the page, or any module state, which is what makes
 * it safe for both halves of the app to share: a change here cannot alter what
 * a figure is, only how it looks.
 *
 * That is the test for belonging in this file. A helper that reaches for
 * `state` is not a primitive -- it is a piece of one of the pages wearing a
 * general-sounding name, and it belongs with that page.
 */

/** The theme a person chose, or that they want the system's. */
export type Theme = "system" | "light" | "dark";

export const THEME_KEY = "nzosa:theme";

/** A line of explanation under a heading. */
export function note(text: string): HTMLElement {
  const p = document.createElement("p");
  p.className = "page-hint";
  p.textContent = text;
  return p;
}

/** A left-aligned label in a report. */
export function nameCell(text: string): HTMLTableCellElement {
  const td = document.createElement("td");
  td.className = "report-name";
  td.textContent = text;
  return td;
}

/** A right-aligned figure. */
export function amountCell(text: string): HTMLTableCellElement {
  const td = document.createElement("td");
  td.className = "report-amount";
  td.textContent = text;
  return td;
}

/**
 * The invoice, with enough on screen to recognise it.
 *
 * A number alone is not evidence: deciding whether a receipt settles INV-0121
 * means knowing who it was to, what it was for and when it was raised. Showing
 * only the number made the page ask a question it had not given you the means
 * to answer.
 */
export function invoiceCell(
  invoice: Invoice | undefined,
  fallback: string,
): HTMLTableCellElement {
  const td = document.createElement("td");
  td.className = "report-name match-cell";
  const number = document.createElement("strong");
  number.textContent = invoice?.number ?? fallback;
  td.append(number);
  if (invoice === undefined) return td;

  const who = document.createElement("div");
  who.className = "match-sub";
  who.textContent = invoice.contact;
  td.append(who);

  const detail = [invoice.reference, invoice.issued].filter((p) => p !== "").join(" · ");
  if (detail !== "") {
    const line = document.createElement("div");
    line.className = "match-sub";
    line.textContent = detail;
    td.append(line);
  }
  return td;
}

/**
 * Escape before inserting into HTML.
 *
 * Payee and particulars fields are attacker-influenced in the sense that
 * anyone who can pay you can choose what appears in them, and a ledger is
 * exactly the kind of file people forward to an accountant.
 */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Hand the browser a file to save. */
export function download(text: string, filename: string, type: string): void {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

/** What the splash says while the books are being read. */
export function setLoadingStatus(message: string): void {
  const el = document.getElementById("loading-msg");
  if (el) el.textContent = message;
}

/** The theme held for this browser, defaulting to following the system. */
export function currentTheme(): Theme {
  try {
    const held = localStorage.getItem(THEME_KEY);
    if (held === "light" || held === "dark" || held === "system") return held;
  } catch {
    // A browser refusing storage is not a reason to render nothing.
  }
  return "system";
}
