import type { Invoice } from "@nzosa/core";
import { booksLocale, moneyPlaces } from "./country.js";

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

/**
 * Ask on the page, and wait for the answer: true for the first button.
 *
 * The browser's own confirm box is not asked everywhere -- an embedded
 * browser can answer it "Cancel" at once without showing it, and a trial
 * balance loaded there was refused without a word. This is drawn in the page,
 * so it is shown wherever the page is. Escape, or the second button, is no.
 */
export function askOnPage(message: string, yes = "OK", no = "Cancel"): Promise<boolean> {
  return new Promise((resolve) => {
    const box = document.createElement("dialog");
    box.className = "ask-on-page";
    const text = document.createElement("p");
    text.className = "ask-on-page-text";
    text.textContent = message;
    const ok = document.createElement("button");
    ok.type = "button";
    ok.className = "primary";
    ok.textContent = yes;
    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.textContent = no;
    const actions = document.createElement("div");
    actions.className = "ask-on-page-actions";
    actions.append(cancel, ok);
    box.append(text, actions);
    let answered = false;
    const finish = (answer: boolean): void => {
      if (answered) return;
      answered = true;
      box.close();
      box.remove();
      resolve(answer);
    };
    ok.addEventListener("click", () => finish(true));
    cancel.addEventListener("click", () => finish(false));
    box.addEventListener("cancel", (event) => {
      event.preventDefault();
      finish(false);
    });
    document.body.append(box);
    box.showModal();
    ok.focus();
  });
}

/**
 * Ask for a line of text on the page, and wait for it: the typed text, or null
 * when it is dismissed. The same box as askOnPage, for what prompt() was used
 * for -- which an embedded browser also answers without showing.
 *
 * Enter is the first button, Escape the second. The field starts holding
 * `initial`, selected, so typing replaces it.
 */
export function askTextOnPage(
  message: string,
  initial = "",
  yes = "OK",
  no = "Cancel",
): Promise<string | null> {
  return new Promise((resolve) => {
    const box = document.createElement("dialog");
    box.className = "ask-on-page";
    const text = document.createElement("p");
    text.className = "ask-on-page-text";
    text.textContent = message;
    const field = document.createElement("input");
    field.type = "text";
    field.className = "ask-on-page-input";
    field.value = initial;
    const ok = document.createElement("button");
    ok.type = "button";
    ok.className = "primary";
    ok.textContent = yes;
    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.textContent = no;
    const actions = document.createElement("div");
    actions.className = "ask-on-page-actions";
    actions.append(cancel, ok);
    box.append(text, field, actions);
    let answered = false;
    const finish = (answer: string | null): void => {
      if (answered) return;
      answered = true;
      box.close();
      box.remove();
      resolve(answer);
    };
    ok.addEventListener("click", () => finish(field.value));
    cancel.addEventListener("click", () => finish(null));
    field.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        finish(field.value);
      }
    });
    box.addEventListener("cancel", (event) => {
      event.preventDefault();
      finish(null);
    });
    document.body.append(box);
    box.showModal();
    field.focus();
    field.select();
  });
}

/**
 * A name and a choice, asked on the page: a new set of books' name and the
 * country it is kept in. Null when cancelled.
 */
export function askNameAndChoiceOnPage(
  message: string,
  choiceLabel: string,
  options: readonly (readonly [string, string])[],
  initialChoice: string,
  yes = "OK",
  no = "Cancel",
): Promise<{ name: string; choice: string } | null> {
  return new Promise((resolve) => {
    const box = document.createElement("dialog");
    box.className = "ask-on-page";
    const text = document.createElement("p");
    text.className = "ask-on-page-text";
    text.textContent = message;
    const field = document.createElement("input");
    field.type = "text";
    field.className = "ask-on-page-input";
    const label = document.createElement("label");
    label.className = "ask-on-page-choice";
    const select = document.createElement("select");
    for (const [value, words] of options) {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = words;
      option.selected = value === initialChoice;
      select.append(option);
    }
    label.append(document.createTextNode(`${choiceLabel} `), select);
    const ok = document.createElement("button");
    ok.type = "button";
    ok.className = "primary";
    ok.textContent = yes;
    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.textContent = no;
    const actions = document.createElement("div");
    actions.className = "ask-on-page-actions";
    actions.append(cancel, ok);
    box.append(text, field, label, actions);
    let answered = false;
    const finish = (answer: { name: string; choice: string } | null): void => {
      if (answered) return;
      answered = true;
      box.close();
      box.remove();
      resolve(answer);
    };
    ok.addEventListener("click", () => finish({ name: field.value, choice: select.value }));
    cancel.addEventListener("click", () => finish(null));
    field.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        finish({ name: field.value, choice: select.value });
      }
    });
    box.addEventListener("cancel", (event) => {
      event.preventDefault();
      finish(null);
    });
    document.body.append(box);
    box.showModal();
    field.focus();
  });
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

/** Dollars as a person reads them: $1,234.50, or -$1,234.50. */
export function dollars(cents: number): string {
  return (
    (cents < 0 ? "-$" : "$") +
    (Math.abs(cents) / 100).toLocaleString(booksLocale(), { minimumFractionDigits: moneyPlaces(), maximumFractionDigits: moneyPlaces() })
  );
}
