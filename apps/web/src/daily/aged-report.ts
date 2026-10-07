import { spreadsheetCell } from "@nzosa/core";
import { redraw } from "../app.js";
import {
  asCsvText,
  booksStartKnown,
  record,
  billEntities,
  controlAccountFor,
  datedInvoicePayments,
  invoicesInPlay,
  postedJournals,
} from "../books.js";
import { state } from "../state.js";
import { save } from "../store.js";
import { amountCell, nameCell, note } from "../ui.js";
import {
  AGE_BUCKETS,
  agedReport,
  dayAfter,
  emptyEntityModel,
  formatAmount,
  openingDocumentsTotal,
  readAgedDetail,
} from "@nzosa/core";
import type { Cents } from "@nzosa/core";
import type { AgedReport, Invoice, InvoiceKind } from "@nzosa/core";
import { taxYearEnd } from "../tax-year.js";
import { booksLocale, moneyPlaces } from "../country.js";

/**
 * Aged payables and aged receivables.
 *
 * What was owed on a day, by supplier or customer, and how late. The figure
 * that matters most is the one at the bottom: it has to be the Accounts
 * Payable (or Receivable) balance on the balance sheet for the same day. When
 * it is not, the report says by how much and why that usually is, because a
 * payables list that does not agree to the ledger is the first thing an
 * accountant asks about.
 */

/** The day chosen, or null for the year end (or today, if sooner). */
let asAtChosen: string | null = null;

function defaultAsAt(year: number): string {
  const end = taxYearEnd(year);
  const today = new Date().toISOString().slice(0, 10);
  return today < end ? today : end;
}

/** Whether a document is this entity's: said on it, or by the accounts its lines use. */
function belongsTo(invoice: Invoice, entityId: string): boolean {
  if (invoice.entityId !== undefined) return invoice.entityId === entityId;
  const model = state.ledger.entities ?? emptyEntityModel();
  return invoice.lines.some((l) => model.accounts[l.accountCode.trim()] === entityId);
}

function build(kind: InvoiceKind, asAt: string): AgedReport {
  const chosen = state.entityFilter;
  return agedReport({
    invoices: invoicesInPlay(),
    kind,
    payments: datedInvoicePayments(),
    credits: state.ledger.creditNotes ?? {},
    asAt,
    ...(chosen !== "" ? { include: (i: Invoice) => belongsTo(i, chosen) } : {}),
  });
}

/**
 * The control accounts the report should agree with, and their balance on the day.
 *
 * Each entity's own where it has one; otherwise the usual 800 or 610. The
 * balance is the opening balance, when the books opened on or before the day,
 * plus every posting since. Payables are a credit, so they are turned round to
 * read as an amount owed.
 */
function ledgerBalance(kind: InvoiceKind, asAt: string): { codes: string[]; owed: number } {
  const chosen = state.entityFilter;
  const entities = chosen === ""
    ? (state.ledger.entities ?? emptyEntityModel()).entities
    : (state.ledger.entities ?? emptyEntityModel()).entities.filter((e) => e.id === chosen);
  const own = entities
    .map((e) => controlAccountFor(e.id, kind)?.code)
    .filter((c): c is string => c !== undefined);
  const codes = own.length > 0 ? [...new Set(own)] : [kind === "purchase" ? "800" : "610"];

  const opening = state.ledger.openingBalances;
  const openedBy = opening !== undefined && opening.asAt <= asAt ? opening : undefined;
  let balance = 0;
  for (const code of codes) balance += openedBy?.accounts[code] ?? 0;
  for (const journal of postedJournals()) {
    if (journal.date > asAt) continue;
    if (openedBy !== undefined && journal.date <= openedBy.asAt) continue;
    for (const line of journal.lines) {
      if (codes.includes(line.accountCode.trim())) balance += line.amount;
    }
  }
  return { codes, owed: kind === "purchase" ? -balance : balance };
}

const money = (cents: number): string =>
  (cents / 100).toLocaleString(booksLocale(), { minimumFractionDigits: moneyPlaces(), maximumFractionDigits: moneyPlaces() });

export function renderAged(body: HTMLElement, kind: InvoiceKind, year: number): void {
  const asAt = asAtChosen ?? defaultAsAt(year);
  const who = kind === "purchase" ? "supplier" : "customer";

  const controls = document.createElement("div");
  controls.className = "aged-controls";
  const label = document.createElement("label");
  label.textContent = "As at ";
  const date = document.createElement("input");
  date.type = "date";
  date.value = asAt;
  date.addEventListener("change", () => {
    asAtChosen = date.value === "" ? null : date.value;
    redraw("reports");
  });
  label.append(date);
  controls.append(label);
  body.append(controls);

  if (kind === "purchase" && billEntities().length === 0 && !(state.ledger.invoices ?? []).some((i) => i.kind === "purchase")) {
    body.append(note("There are no bills in these books."));
    return;
  }

  const report = build(kind, asAt);
  if (report.contacts.length === 0) {
    body.append(note(`Nothing was owing on ${asAt}.`));
  } else {
    const table = document.createElement("table");
    table.className = "report-table aged-table";
    const head = document.createElement("thead");
    const headRow = document.createElement("tr");
    for (const text of [who === "supplier" ? "Supplier" : "Customer", ...AGE_BUCKETS.map((b) => b.label), "Total"]) {
      const th = document.createElement("th");
      th.textContent = text;
      headRow.append(th);
    }
    head.append(headRow);
    const tbody = document.createElement("tbody");
    for (const row of report.contacts) {
      const tr = document.createElement("tr");
      tr.append(nameCell(row.contact));
      for (const { bucket } of AGE_BUCKETS) {
        const cell = amountCell(row.buckets[bucket] === 0 ? "" : money(row.buckets[bucket]));
        if (bucket !== "current" && row.buckets[bucket] > 0) cell.classList.add("match-off");
        tr.append(cell);
      }
      tr.append(amountCell(money(row.total)));
      tbody.append(tr);
      // Each document under its contact, so a figure can be traced to paper.
      for (const item of row.items) {
        const detail = document.createElement("tr");
        detail.className = "aged-detail";
        const what = nameCell(
          `${item.invoice.number}${item.invoice.reference ? ` (${item.invoice.reference})` : ""} · ` +
            `${item.invoice.issued}${item.invoice.due ? `, due ${item.invoice.due}` : ""}` +
            (item.daysOverdue > 0 ? ` · ${item.daysOverdue} days overdue` : ""),
        );
        detail.append(what);
        for (const { bucket } of AGE_BUCKETS) detail.append(amountCell(bucket === item.bucket ? money(item.owing) : ""));
        detail.append(amountCell(""));
        tbody.append(detail);
      }
    }
    const foot = document.createElement("tfoot");
    const total = document.createElement("tr");
    total.append(nameCell("Total"));
    for (const { bucket } of AGE_BUCKETS) total.append(amountCell(money(report.totals[bucket])));
    total.append(amountCell(money(report.total)));
    foot.append(total);
    table.append(head, tbody, foot);
    body.append(table);
  }

  // The tie to the ledger.
  const ledger = ledgerBalance(kind, asAt);
  const difference = ledger.owed - report.total;
  const account = kind === "purchase" ? "Accounts Payable" : "Accounts Receivable";
  const tie = document.createElement("div");
  tie.className = difference === 0 ? "aged-tie" : "provisional-note aged-tie";
  const line = document.createElement("p");
  line.textContent =
    `${account} (${ledger.codes.join(", ")}) in the ledger on ${asAt}: ${money(ledger.owed)}. ` +
    (difference === 0
      ? "The report agrees with it."
      : `The report is ${money(Math.abs(difference))} ${difference > 0 ? "less" : "more"} than the ledger.`);
  tie.append(line);
  if (difference !== 0) {
    const why = document.createElement("p");
    why.textContent =
      kind === "purchase"
        ? "Usually one of these: bills from before these books started, held in the opening balance but " +
          "not entered as bills yet; a bank line coded straight to Accounts Payable instead of matched to " +
          "its bill; or a manual journal to the account."
        : "Usually one of these: invoices from before these books started, held in the opening balance but " +
          "not loaded as invoices; a receipt coded straight to Accounts Receivable instead of matched to " +
          "its invoice; or a manual journal to the account.";
    tie.append(why);
  }
  body.append(tie);
}

/** The report as CSV: one row per document, with its bucket. */
export function agedCsv(kind: InvoiceKind, year: number): { text: string; name: string } {
  const asAt = asAtChosen ?? defaultAsAt(year);
  const report = build(kind, asAt);
  const quote = spreadsheetCell;
  const rows = [
    ["Contact", "Number", "Reference", "Date", "Due", "Days overdue", ...AGE_BUCKETS.map((b) => b.label), "Owing"],
  ];
  for (const contact of report.contacts) {
    for (const item of contact.items) {
      rows.push([
        contact.contact,
        item.invoice.number,
        item.invoice.reference,
        item.invoice.issued,
        item.invoice.due ?? "",
        String(Math.max(0, item.daysOverdue)),
        ...AGE_BUCKETS.map((b) => (b.bucket === item.bucket ? (item.owing / 100).toFixed(2) : "")),
        (item.owing / 100).toFixed(2),
      ]);
    }
  }
  rows.push(["Total", "", "", "", "", "", ...AGE_BUCKETS.map((b) => (report.totals[b.bucket] / 100).toFixed(2)), (report.total / 100).toFixed(2)]);
  return {
    text: rows.map((r) => r.map(quote).join(",")).join("\n") + "\n",
    name: `aged-${kind === "purchase" ? "payables" : "receivables"}-${asAt}.csv`,
  };
}

/**
 * What the opening balances hold in the receivable or payable accounts, as an
 * amount owing: to these books for receivables, by them for payables.
 */
function openingControlOwing(kind: InvoiceKind): Cents | undefined {
  const opening = state.ledger.openingBalances;
  if (opening === undefined) return undefined;
  const wanted = kind === "purchase" ? /accounts\s+payable/i : /accounts\s+receivable/i;
  const codes = new Set(
    state.chart.filter((a) => wanted.test(a.type) || wanted.test(a.name)).map((a) => a.code),
  );
  if (codes.size === 0) codes.add(kind === "purchase" ? "800" : "610");
  let sum = 0;
  let found = false;
  for (const [code, amount] of Object.entries(opening.accounts)) {
    if (!codes.has(code)) continue;
    found = true;
    sum += amount;
  }
  if (!found) return undefined;
  return kind === "purchase" ? -sum : sum;
}

/**
 * Load the old system's aged receivables or payables detail, as at the day
 * before the books start.
 *
 * It says which of the invoices or bills dated before the start were still
 * open, and for how much. Those stay in play, owing that; the others were
 * paid before these books began and drop out of matching and balances. Its
 * total is checked against the opening balance it has to explain.
 */
export async function loadOpeningDocuments(file: File): Promise<string> {
  const text = await asCsvText(file.name, new Uint8Array(await file.arrayBuffer()));
  const { record: read, problem } = readAgedDetail(text);
  if (read === null) return `${file.name} could not be read: ${problem ?? "not an aged detail report"}.`;
  const list = { ...read, source: file.name };
  const what = list.kind === "purchase" ? "bills" : "invoices";
  const before = state.ledger.openingDocuments ?? null;
  const openingDocuments = [...(before ?? []).filter((d) => d.kind !== list.kind), list];
  state.ledger = { ...state.ledger, openingDocuments };
  state.persistent = await save(state.ledger);
  await record(
    "openingDocuments",
    `${list.items.length} ${what} open at ${list.asAt}, from ${file.name}`,
    before,
    openingDocuments,
  );
  redraw("invoices");
  redraw("bills");
  redraw("reconcile");

  const total = openingDocumentsTotal(list);
  const said = [`${list.items.length} ${what} open at ${list.asAt}, owing ${formatAmount(total)}.`];
  const start = booksStartKnown();
  if (start !== undefined && dayAfter(list.asAt) !== start) {
    said.push(
      `The report is as at ${list.asAt}, but these books start ${start}: it should be as at the day before, ` +
        "or it lists the wrong documents as open.",
    );
  }
  const control = openingControlOwing(list.kind);
  const account = list.kind === "purchase" ? "Accounts Payable" : "Accounts Receivable";
  if (control === undefined) {
    said.push(`There is no opening balance for ${account} to check it against yet.`);
  } else if (control === total) {
    said.push(`That agrees with the opening ${account}.`);
  } else {
    said.push(
      `The opening ${account} is ${formatAmount(control)}, which is ${formatAmount(total - control)} ` +
        "different: the report and the trial balance should be for the same day.",
    );
  }
  return said.join(" ");
}
