import { showPage, redraw } from "./app.js";
import { bankLabel } from "./books.js";
import { showContactNamed } from "./daily/contacts-page.js";
import { editBill, editInvoice } from "./daily/invoices.js";
import { setRecordSearch } from "./menu.js";
import { state } from "./state.js";
import { searchBooks } from "@nzosa/core";
import type { SearchHit } from "@nzosa/core";

/**
 * The menu's search, reaching into the books: a contact opens the contacts
 * list at that name, a document opens in its editor, and a bank line opens
 * Reconcile showing every line from the same payee.
 */

const KIND: Readonly<Record<SearchHit["kind"], string>> = {
  contact: "Contact",
  invoice: "Invoices",
  bill: "Bills",
  line: "Bank line",
};

function open(hit: SearchHit): void {
  if (hit.kind === "contact") {
    const contact = (state.ledger.contacts ?? []).find((c) => c.id === hit.key);
    showContactNamed(contact?.name ?? hit.title);
    showPage("contacts", "top");
    redraw("contacts");
    return;
  }
  if (hit.kind === "invoice") {
    showPage("invoices", "top");
    editInvoice(hit.key);
    return;
  }
  if (hit.kind === "bill") {
    showPage("bills", "top");
    editBill(hit.key);
    return;
  }
  const line = state.ledger.transactions.find((t) => t.id === hit.key);
  state.reconcileFilter = "all";
  state.reconcileSearch = line?.otherParty || line?.particulars || hit.title;
  const filter = document.getElementById("reconcile-filter");
  if (filter instanceof HTMLSelectElement) filter.value = "all";
  const box = document.getElementById("reconcile-search");
  if (box instanceof HTMLInputElement) box.value = state.reconcileSearch;
  showPage("reconcile", "top");
  redraw("reconcile");
}

export function wireRecordSearch(): void {
  setRecordSearch((query) =>
    searchBooks(query, {
      contacts: state.ledger.contacts ?? [],
      invoices: state.ledger.invoices ?? [],
      transactions: state.ledger.transactions,
      accountName: bankLabel,
    }).map((hit) => ({
      label: hit.title,
      where: `${KIND[hit.kind]} · ${hit.date === undefined ? "" : `${hit.date} · `}${hit.detail}`,
      go: () => open(hit),
    })),
  );
}
