import type { Lesson } from "./engine.js";

/**
 * The lessons, written for the demo books.
 *
 * Each one points at real parts of the screen by the same selectors the app
 * draws them with. A step whose target is not there -- a page the visitor's
 * books do not have -- shows its card without a ring rather than failing.
 */

const q = (selector: string) => (): Element | null => document.querySelector(selector);
const visible = (selector: string) => (): Element | null =>
  [...document.querySelectorAll(selector)].find((e) => e instanceof HTMLElement && e.offsetParent !== null) ?? null;

/** The bank line a lesson is about: the first one waiting on Reconcile. */
const firstLine = (): HTMLElement | null => document.querySelector<HTMLElement>("#reconcile-body .code-row");
let watchedLine = "";

export const LESSONS: readonly Lesson[] = [
  {
    id: "welcome",
    title: "Get to know NZOSA",
    summary: "What NZOSA does, how the menu is arranged, and where your books live.",
    minutes: 2,
    steps: [
      {
        title: "Welcome",
        body:
          "NZOSA turns your bank files into a coded, double-entry set of books, and from those your GST returns, " +
          "financial statements and tax returns. These demo books are invented: Kea Coffee Roasters in Nelson, " +
          "and two rental properties owned by Ana and Tom Whitcombe.",
        page: "reconcile",
      },
      {
        title: "Daily",
        body:
          "The work you come back to: bank lines waiting for an account, anything that needs your attention, " +
          "and the invoices you send and the bills you pay.",
        target: q('.sidebar-group[data-group="daily"]'),
      },
      {
        title: "Actions required",
        body:
          "What needs you, in the order it matters: lines left to code, a GST return coming due, an invoice " +
          "overdue. The number beside it is how many.",
        target: visible('.sidebar-nav [data-page="actions"]'),
      },
      {
        title: "Reporting",
        body:
          "Profit and loss, balance sheet, cash flow, aged receivables and the rest. Every figure opens to the " +
          "lines behind it.",
        target: q('.sidebar-group[data-group="reporting"]'),
      },
      {
        title: "Year end",
        body: "The year-end work: rental schedules, the IR3, IR4 or IR10, and a pack your accountant can check.",
        target: q('.sidebar-group[data-group="yearend"]'),
      },
      {
        title: "Set up",
        body:
          "Done once and then rarely: your entities, chart of accounts, GST settings, opening balances and coding " +
          "rules. Pages only appear for what your books use, so a sole trader never sees a trust's.",
        target: q('.sidebar-group[data-group="setup"]'),
      },
      {
        title: "Search",
        body: "Any page or report, by name. Press Ctrl+K from anywhere.",
        target: q("#menu-search"),
      },
      {
        title: "Where your books live",
        body:
          "Installed on your own computer, your books are plain files in a folder you choose, and nothing is " +
          "uploaded. In this demo they are kept in this browser, so try anything: Start the demo again puts them back.",
      },
    ],
  },
  {
    id: "code-a-line",
    title: "Code a bank line",
    summary: "Give a bank line its account and GST, confirm it, and see what NZOSA learns from it.",
    minutes: 3,
    steps: [
      {
        title: "Bank lines to code",
        body:
          "Every line from your bank files and feeds lands here until it has an account. Coding is most of " +
          "bookkeeping, so this is where the time goes, and where NZOSA saves the most of it.",
        page: "reconcile",
        target: firstLine,
      },
      {
        title: "What the bank said",
        body: "The date, who the money went to or came from, the bank's description, and which of your accounts it was on.",
        target: () => firstLine()?.querySelector(".code-bank") ?? null,
      },
      {
        title: "The account",
        body:
          "NZOSA has already suggested one, from how lines like this were coded before. Type in the box to " +
          "choose a different account.",
        target: () => firstLine()?.querySelector(".combo") ?? null,
      },
      {
        title: "Why it was suggested",
        body: "The GST treatment, and the reason for the suggestion, so you can tell a good guess from a lucky one.",
        target: () => firstLine()?.querySelector(".code-reason") ?? null,
      },
      {
        title: "GST",
        body:
          "15% for an ordinary purchase or sale, 0% for anything with no GST in it, such as bank fees or wages. " +
          "The GST return adds these up for you.",
        target: () => firstLine()?.querySelector(".gst-select") ?? null,
      },
      {
        title: "Confirm it",
        body: "Confirming puts the line in the books: it now counts in the reports and the GST return.",
        task: "Press ✓ on this line.",
        target: () => firstLine()?.querySelector(".code-tick") ?? null,
        before: () => {
          watchedLine = firstLine()?.dataset["id"] ?? "";
        },
        done: () => {
          if (watchedLine === "") return false;
          const row = document.querySelector<HTMLElement>(`#reconcile-body .code-row[data-id="${watchedLine}"]`);
          return row === null || row.querySelector(".code-tick.tick-live") === null;
        },
      },
      {
        title: "Done",
        body:
          "That line is in the books. The next line from the same payee will be suggested the same way. When the " +
          "suggestions on a page all look right, Accept all confirms them in one go.",
        target: q("#accept-all"),
      },
    ],
  },
];
