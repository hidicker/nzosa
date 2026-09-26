import { redraw } from "../app.js";
import { bankLabel, invoiceAssignments, invoiceBalanceMap, record } from "../books.js";
import { combobox } from "../combobox.js";
import type { Combobox } from "../combobox.js";
import { knownCodes } from "../reconcile.js";
import { $, state } from "../state.js";
import { savePart } from "../store.js";
import { amountCell, download, invoiceCell, nameCell, note } from "../ui.js";
import {
  accountEntityKey,
  canonicalCodeFor,
  emptyEntityModel,
  formatAmount,
  gstContent,
  invoiceDocument,
  matchInvoices,
  nextInvoiceNumber,
  splitAccountLabel,
  splitInvoiceNumber,
  splitPartId,
} from "@nzosa/core";
import type {
  Invoice,
  InvoiceBalance,
  InvoiceKind,
  InvoiceLine,
  InvoiceSupplier,
  Transaction,
} from "@nzosa/core";
import { loadInvoices } from "../migrate/file-intake.js";

/**
 * Writing an invoice by hand.
 *
 * Not everything is billed through an accounting system, and an invoice that
 * exists only on paper still has to be matched to the money and still belongs
 * in an accrual result. Without this the app could read invoices and never
 * record one, which meant a whole class of income had nowhere to live.
 *
 * `null` means the form is closed; a number means that invoice is being edited;
 * the empty string means a new one is being written.
 */
let editingInvoice: string | null = null;

/** The GST treatments an invoice line can carry, named as Xero names them. */
const INVOICE_TAX_TYPES = [
  { value: "15% GST on Income", label: "15% GST on Income", rate: 15 },
  { value: "Zero Rated", label: "Zero rated", rate: 0 },
  { value: "GST Exempt", label: "Exempt", rate: 0 },
  { value: "No GST", label: "No GST", rate: 0 },
] as const;

/**
 * Invoices: what has been billed, and what has been paid against it.
 *
 * A bank line says money arrived; an invoice says what it was for and when it
 * was earned. The two are different facts, and a set of books on the payments
 * basis still needs both -- the invoice to know what is owed, the payment to
 * know when it is taxable.
 *
 * Which is why an invoice here is never quietly settled by an amount that
 * happens to agree. Matching is proposed and accepted, and the acceptance is
 * recorded, so a debtors figure can be defended by pointing at the decision
 * rather than at a coincidence of numbers.
 */

function suggestInvoiceNumber(kind: InvoiceKind): string {
  return nextInvoiceNumber(kind, state.ledger.invoices ?? []);
}

function blankInvoice(): Invoice {
  const today = new Date().toISOString().slice(0, 10);
  return {
    number: suggestInvoiceNumber("sales"),
    kind: "sales",
    contact: "",
    reference: "",
    issued: today,
    due: null,
    total: 0,
    tax: 0,
    paid: 0,
    outstanding: 0,
    currency: "NZD",
    status: "Awaiting Payment",
    lines: [{ description: "", accountCode: "", taxType: "15% GST on Income", net: 0, tax: 0, gross: 0 }],
  };
}

/** Cents from what someone typed, tolerating commas, spaces and a $ sign. */
function parseMoney(text: string): number {
  const cleaned = text.replace(/[$,\s]/g, "");
  if (cleaned === "" || !/^-?\d*\.?\d*$/.test(cleaned)) return 0;
  return Math.round(Number(cleaned) * 100);
}

export function renderInvoiceEditor(): void {
  const host = $("invoice-editor");
  host.textContent = "";
  if (editingInvoice === null) return;

  const existing =
    editingInvoice === ""
      ? undefined
      : (state.ledger.invoices ?? []).find((i) => i.number === editingInvoice);
  // A working copy: nothing reaches the ledger until Save, so closing the form
  // leaves the invoice exactly as it was.
  const draft: Invoice = existing
    ? { ...existing, lines: existing.lines.map((l) => ({ ...l })) }
    : blankInvoice();

  const box = document.createElement("div");
  box.className = "invoice-editor";

  const heading = document.createElement("h3");
  heading.textContent = existing ? `Edit ${existing.number}` : "New invoice";
  box.append(heading);

  const grid = document.createElement("div");
  grid.className = "invoice-fields";

  const field = (
    label: string,
    control: HTMLElement,
    hint?: string,
  ): HTMLLabelElement => {
    const wrap = document.createElement("label");
    const name = document.createElement("span");
    name.textContent = label;
    wrap.append(name, control);
    if (hint !== undefined) {
      const small = document.createElement("small");
      small.textContent = hint;
      wrap.append(small);
    }
    grid.append(wrap);
    return wrap;
  };

  const text = (value: string, placeholder = ""): HTMLInputElement => {
    const input = document.createElement("input");
    input.type = "text";
    input.value = value;
    input.placeholder = placeholder;
    return input;
  };

  const number = text(draft.number);
  field("Invoice number", number);

  const kind = document.createElement("select");
  for (const [value, label] of [
    ["sales", "Sales invoice (money in)"],
    ["purchase", "Bill (money out)"],
  ] as const) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = label;
    option.selected = draft.kind === value;
    kind.append(option);
  }
  field("Type", kind);

  // Changing what the document is changes what it is called, but only while the
  // number is still the one offered: a number typed by hand is a decision, and
  // an invoice already raised keeps the number it was issued under.
  let offered = number.value;
  kind.addEventListener("change", () => {
    if (existing !== undefined || number.value !== offered) return;
    offered = suggestInvoiceNumber(kind.value as InvoiceKind);
    number.value = offered;
  });

  const contact = text(draft.contact, "Who it is to, or from");
  field("Contact", contact);

  const reference = text(draft.reference);
  field("Reference", reference);

  const issued = document.createElement("input");
  issued.type = "date";
  issued.value = draft.issued;
  field("Issued", issued);

  const due = document.createElement("input");
  due.type = "date";
  due.value = draft.due ?? "";
  field("Due", due, "Optional.");

  const status = text(draft.status);
  field("Status", status);

  const paid = text((draft.paid / 100).toFixed(2));
  field("Already paid", paid, "Leave at 0.00 for a new invoice.");

  box.append(grid);

  // --- lines ---------------------------------------------------------------
  const linesHead = document.createElement("h4");
  linesHead.textContent = "Lines";
  box.append(linesHead);

  const lineHost = document.createElement("div");
  lineHost.className = "invoice-lines";
  box.append(lineHost);

  const totals = document.createElement("p");
  totals.className = "invoice-totals";

  const accounts = knownCodes(state.rules, state.ledger.overrides ?? {}, state.chart);
  const lineAccounts = new Map<HTMLElement, Combobox>();

  function readLines(): InvoiceLine[] {
    return [...lineHost.querySelectorAll<HTMLElement>(".invoice-line")].map((row) => {
      const description = row.querySelector<HTMLInputElement>(".line-description")?.value ?? "";
      const account = lineAccounts.get(row)?.value ?? "";
      const taxType = row.querySelector<HTMLSelectElement>(".line-tax")?.value ?? "No GST";
      const gross = parseMoney(row.querySelector<HTMLInputElement>(".line-gross")?.value ?? "");
      // Store the bare chart code, the way an imported invoice holds it. The
      // picker shows "NB Sales - 200"; keeping that label here would leave two
      // spellings of the same account in one field.
      const code = splitAccountLabel(account).code || account.trim();
      // The gross is what the customer pays, so the tax is taken out of it
      // rather than added on -- the same 3/23 the returns use.
      const rate = INVOICE_TAX_TYPES.find((t) => t.value === taxType)?.rate ?? 0;
      const tax = rate === 15 ? gstContent(gross) : 0;
      return { description, accountCode: code, taxType, net: gross - tax, tax, gross };
    });
  }

  function refreshTotals(): void {
    const lines = readLines();
    const total = lines.reduce((sum, l) => sum + l.gross, 0);
    const tax = lines.reduce((sum, l) => sum + l.tax, 0);
    totals.textContent =
      `Total ${formatAmount(total)} · GST ${formatAmount(tax)} · ` +
      `excluding GST ${formatAmount(total - tax)}`;
  }

  function addLine(line: InvoiceLine): void {
    const row = document.createElement("div");
    row.className = "invoice-line";

    const description = text(line.description, "What it is for");
    description.className = "line-description";

    const account = combobox(
      accounts,
      line.accountCode === "" ? null : accountLabelFor(line.accountCode),
      "Account",
    );
    account.element.querySelector("input")?.classList.add("line-account");
    lineAccounts.set(row, account);

    const tax = document.createElement("select");
    tax.className = "line-tax";
    for (const option of INVOICE_TAX_TYPES) {
      const item = document.createElement("option");
      item.value = option.value;
      item.textContent = option.label;
      item.selected = option.value === line.taxType;
      tax.append(item);
    }

    const gross = text((line.gross / 100).toFixed(2));
    gross.className = "line-gross invoice-amount";
    gross.placeholder = "0.00";

    const drop = document.createElement("button");
    drop.type = "button";
    drop.className = "line-drop";
    drop.textContent = "×";
    drop.title = "Remove this line";
    drop.addEventListener("click", () => {
      lineAccounts.delete(row);
      row.remove();
      refreshTotals();
    });

    row.append(description, account.element, tax, gross, drop);
    lineHost.append(row);
    for (const control of [description, tax, gross]) {
      control.addEventListener("input", refreshTotals);
      control.addEventListener("change", refreshTotals);
    }
  }

  for (const line of draft.lines) addLine(line);
  refreshTotals();

  const addRow = document.createElement("button");
  addRow.type = "button";
  addRow.textContent = "Add line";
  addRow.addEventListener("click", () => {
    addLine({ description: "", accountCode: "", taxType: "15% GST on Income", net: 0, tax: 0, gross: 0 });
    refreshTotals();
  });
  box.append(addRow, totals);

  // --- actions -------------------------------------------------------------
  const actions = document.createElement("div");
  actions.className = "invoice-actions";

  const save = document.createElement("button");
  save.type = "button";
  save.className = "primary";
  save.textContent = "Save invoice";
  save.addEventListener("click", () => {
    const lines = readLines().filter((l) => l.gross !== 0 || l.description.trim() !== "");
    const total = lines.reduce((sum, l) => sum + l.gross, 0);
    const tax = lines.reduce((sum, l) => sum + l.tax, 0);
    const paidCents = parseMoney(paid.value);

    const built: Invoice = {
      number: number.value.trim(),
      kind: kind.value as InvoiceKind,
      contact: contact.value.trim(),
      reference: reference.value.trim(),
      issued: issued.value,
      due: due.value === "" ? null : due.value,
      total,
      tax,
      paid: paidCents,
      // Derived, never typed: an outstanding figure that disagreed with the
      // total less what was paid would quietly break every match proposal.
      outstanding: total - paidCents,
      currency: draft.currency,
      status: status.value.trim(),
      lines,
    };
    void saveInvoice(built, existing);
  });

  const cancel = document.createElement("button");
  cancel.type = "button";
  cancel.textContent = "Cancel";
  cancel.addEventListener("click", () => {
    editingInvoice = null;
    renderInvoiceEditor();
  });

  actions.append(save, cancel);

  if (existing) {
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "danger";
    remove.textContent = "Delete";
    remove.addEventListener("click", () => {
      if (!confirm(`Delete ${existing.number}? The change log can undo it.`)) return;
      void deleteInvoice(existing);
    });
    actions.append(remove);
  }

  box.append(actions);
  host.append(box);
}

/** The picker label for a chart code, so an editor shows what a coder sees. */
function accountLabelFor(code: string): string {
  const codes = knownCodes(state.rules, state.ledger.overrides ?? {}, state.chart);
  return canonicalCodeFor(code, codes) ?? code;
}

async function saveInvoice(built: Invoice, existing: Invoice | undefined): Promise<void> {
  if (built.number === "") {
    alert("Give the invoice a number.");
    return;
  }
  const invoices = [...(state.ledger.invoices ?? [])];
  const clash = invoices.findIndex((i) => i.number === built.number);
  if (clash >= 0 && invoices[clash] !== existing) {
    alert(`There is already an invoice numbered ${built.number}.`);
    return;
  }

  // The same number under a different prefix -- CN-0155 beside INV-0155 -- is
  // two documents that sound like one. Worth stopping to check, not worth
  // forbidding, so it asks.
  const mine = splitInvoiceNumber(built.number);
  if (mine !== null) {
    const twin = invoices.find(
      (i) => i !== existing && splitInvoiceNumber(i.number)?.value === mine.value,
    );
    if (
      twin !== undefined &&
      !confirm(
        `${twin.number} already uses number ${mine.value}.\n\n` +
          `Save ${built.number} as well? ${suggestInvoiceNumber(built.kind)} is free.`,
      )
    ) {
      return;
    }
  }

  const at = existing ? invoices.indexOf(existing) : -1;
  if (at >= 0) invoices[at] = built;
  else invoices.push(built);

  state.ledger = { ...state.ledger, invoices };
  state.persistent = await savePart(state.ledger, "invoices");
  await record(
    "invoice",
    `${existing ? "Edited" : "Created"} ${built.number} — ${built.contact} ${formatAmount(built.total)}`,
    existing ?? null,
    built,
    built.number,
  );
  editingInvoice = null;
  redraw("invoiceEditor");
  redraw("invoices");
}

async function deleteInvoice(invoice: Invoice): Promise<void> {
  const invoices = (state.ledger.invoices ?? []).filter((i) => i.number !== invoice.number);
  state.ledger = { ...state.ledger, invoices };
  state.persistent = await savePart(state.ledger, "invoices");
  await record(
    "invoice",
    `Deleted ${invoice.number} — ${invoice.contact} ${formatAmount(invoice.total)}`,
    invoice,
    null,
    invoice.number,
  );
  editingInvoice = null;
  redraw("invoiceEditor");
  redraw("invoices");
}

/**
 * Which entity is sending this invoice.
 *
 * The accounts its lines are coded to say so: a sale coded to an account
 * belonging to the rental is the rental invoicing, whatever else is in the
 * ledger. With one entity there is nothing to work out, and with none the
 * books have no name to put at the top -- which is what the button says.
 */
function supplierFor(invoice: Invoice): InvoiceSupplier | null {
  const model = state.ledger.entities ?? emptyEntityModel();
  if (model.entities.length === 0) return null;

  const counts = new Map<string, number>();
  for (const line of invoice.lines) {
    const account = state.chart.find((a) => a.code.trim() === line.accountCode.trim());
    const id = account === undefined ? undefined : model.accounts[accountEntityKey(account)];
    if (id !== undefined) counts.set(id, (counts.get(id) ?? 0) + 1);
  }

  const best = [...counts].sort((a, b) => b[1] - a[1])[0];
  const entity =
    (best === undefined ? undefined : model.entities.find((e) => e.id === best[0])) ??
    (model.entities.length === 1 ? model.entities[0] : undefined);
  if (entity === undefined) return null;

  return {
    name: entity.name,
    ...(entity.address === undefined ? {} : { address: entity.address }),
    ...(entity.gstNumber === undefined ? {} : { gstNumber: entity.gstNumber }),
    ...(entity.payTo === undefined ? {} : { payTo: entity.payTo }),
  };
}

/** Edit, and for a sales invoice the document to send. */
function editInvoiceCell(invoice: Invoice): HTMLTableCellElement {
  const td = document.createElement("td");
  td.className = "report-amount";

  const edit = document.createElement("button");
  edit.type = "button";
  edit.textContent = "edit";
  edit.addEventListener("click", () => {
    editingInvoice = invoice.number;
    redraw("invoiceEditor");
    $("invoice-editor").scrollIntoView({ block: "nearest" });
  });
  td.append(edit);

  // Only a sales invoice: a bill somebody sent you is not yours to issue.
  if (invoice.kind === "sales") {
    const send = document.createElement("button");
    send.type = "button";
    send.className = "invoice-send";
    send.textContent = "document";
    const supplier = supplierFor(invoice);
    if (supplier === null) {
      send.disabled = true;
      send.title =
        "These books have no entity yet, so there is no name to put at the top. " +
        "Name one on the Entities page first.";
    } else {
      send.title =
        `A tax invoice for ${invoice.contact}, as an HTML file: open it to print ` +
        "or save as PDF, or open it in Word to change the wording.";
      send.addEventListener("click", () => {
        download(
          invoiceDocument(invoice, supplier),
          `${invoice.number || "invoice"}.html`,
          "text/html;charset=utf-8",
        );
      });
    }
    td.append(send);
  }

  return td;
}

/** The bank line, named the way it appears on a statement. */
function bankCell(transaction: Transaction | undefined): HTMLTableCellElement {
  const td = document.createElement("td");
  td.className = "report-name match-cell";
  if (transaction === undefined) {
    td.textContent = "line not found";
    return td;
  }
  const who = document.createElement("strong");
  who.textContent = transaction.otherParty || transaction.particulars || "(no payee)";
  td.append(who);

  const when = document.createElement("div");
  when.className = "match-sub";
  when.textContent = `${transaction.date} · ${bankLabel(transaction.account)}`;
  td.append(when);

  const extra = [transaction.particulars, transaction.reference]
    .filter((p) => p !== undefined && p !== "" && p !== transaction.otherParty)
    .join(" · ");
  if (extra !== "") {
    const line = document.createElement("div");
    line.className = "match-sub";
    line.textContent = extra;
    td.append(line);
  }
  return td;
}

export function renderInvoices(): void {
  const body = $("invoices-body");
  body.textContent = "";

  if (state.invoiceMessage !== "") body.append(note(state.invoiceMessage));

  const invoices = state.ledger.invoices ?? [];
  if (invoices.length === 0) {
    body.append(
      note(
        "No invoices loaded. Export them from Xero: Business > Invoices > Export. Optionally " +
          "add an Account Transactions CSV for payment allocations, which show exactly which " +
          "receipts settled which invoice.",
      ),
    );
    return;
  }

  const byNumber = new Map(invoices.map((i) => [i.number, i]));
  const byTransaction = new Map(state.ledger.transactions.map((t) => [t.id, t]));
  // Split parts too, so a payment that settled several invoices can be shown
  // against each of them. A part is addressed by the id `expandSplits` gives
  // it, and carries the amount that actually went to that invoice.
  for (const [id, parts] of Object.entries(state.ledger.splits ?? {})) {
    const parent = byTransaction.get(id);
    if (parent === undefined) continue;
    parts.forEach((part, index) => {
      byTransaction.set(splitPartId(id, index), {
        ...parent,
        id: splitPartId(id, index),
        amount: part.amount,
      });
    });
  }

  const accepted = state.ledger.invoiceMatches ?? {};
  const result = matchInvoices({
    invoices,
    transactions: state.ledger.transactions,
    ...(state.ledger.allocations ? { allocations: state.ledger.allocations } : {}),
  });

  const money = (cents: number): string =>
    (cents / 100).toLocaleString("en-NZ", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const summary = document.createElement("div");
  summary.className = "check-summary";
  // Counted by what is owed rather than by how a match was arrived at. How a
  // receipt was found is interesting once; what is still owed is the question
  // the page exists to answer.
  const summaryBalances = [...invoiceBalanceMap().values()];
  const count = (status: string) => summaryBalances.filter((b) => b.status === status).length;
  const totalOwing = summaryBalances.reduce((sum, b) => sum + Math.max(0, b.remaining), 0);

  for (const [value, label] of [
    [String(count("paid")), "settled in full"],
    [String(count("part paid")), "part paid"],
    [String(count("unpaid")), "nothing assigned"],
    [money(totalOwing), "still owing"],
    [String(result.proposals.length), "proposed, needs a decision"],
  ] as const) {
    const cell = document.createElement("div");
    cell.className = "check-stat";
    const big = document.createElement("span");
    big.className = "check-value";
    big.textContent = value;
    const small = document.createElement("span");
    small.className = "check-label";
    small.textContent = label;
    cell.append(big, small);
    summary.append(cell);
  }
  body.append(summary);

  const needle = $<HTMLInputElement>("invoice-search").value.trim().toLowerCase();
  const hit = (text: string) => needle === "" || text.toLowerCase().includes(needle);

  // --- proposals first: they are the only rows asking for anything ---
  if (result.proposals.length > 0) {
    const heading = document.createElement("h3");
    heading.textContent = `Proposed (${result.proposals.length})`;
    body.append(heading);
    body.append(
      note(
        "The amounts differ. Accepting records the match; code the difference yourself as a " +
          "write-off.",
      ),
    );

    const table = document.createElement("table");
    table.className = "report-table owner-table match-table";
    const head = document.createElement("thead");
    head.innerHTML =
      "<tr><th>Invoice</th><th>Invoice total</th><th>Outstanding</th>" +
      "<th>Bank line</th><th>Received</th><th>Difference</th><th>Why</th><th></th></tr>";
    const tbody = document.createElement("tbody");

    for (const proposal of result.proposals) {
      const invoice = byNumber.get(proposal.invoiceNumber);
      const bank = byTransaction.get(proposal.transactionId);
      const searchable =
        `${proposal.invoiceNumber} ${proposal.source} ${invoice?.contact ?? ""} ` +
        `${invoice?.reference ?? ""} ${bank?.otherParty ?? ""}`;
      if (!hit(searchable)) continue;

      const tr = document.createElement("tr");
      tr.append(invoiceCell(invoice, proposal.invoiceNumber));
      tr.append(amountCell(money(invoice?.total ?? proposal.invoiceAmount)));
      tr.append(amountCell(money(proposal.invoiceAmount)));
      tr.append(bankCell(bank));
      tr.append(amountCell(money(proposal.bankAmount)));

      // The difference is the whole reason this is a proposal rather than a
      // match, so it is called out rather than merely listed.
      const diff = amountCell(money(proposal.adjustment));
      diff.classList.add(proposal.adjustment === 0 ? "match-ok" : "match-off");
      tr.append(diff);
      const why = nameCell(proposal.source);
      why.classList.add("match-why");
      tr.append(why);

      const actions = document.createElement("td");
      actions.className = "report-amount";
      const accept = document.createElement("button");
      accept.type = "button";
      accept.className = "primary";
      accept.textContent = accepted[proposal.transactionId] ? "accepted" : "accept";
      accept.disabled = accepted[proposal.transactionId] !== undefined;
      accept.addEventListener("click", () => void acceptMatch(proposal.transactionId, proposal.invoiceNumber));
      actions.append(accept);
      tr.append(actions);
      tbody.append(tr);
    }
    table.append(head, tbody);
    body.append(table);
  }

  // --- what is still owing ---
  //
  // Driven by the receipts assigned to each invoice rather than by the
  // matcher's own list: an invoice half settled is neither matched nor
  // unmatched, and the question being asked here is "what is still owed",
  // which only the balance can answer.
  const balances = invoiceBalanceMap();
  creditNoteSection(body, balances, money);
  const owing = [...balances.values()]
    .filter((b) => b.remaining > 0)
    .sort((a, b) => b.remaining - a.remaining);

  if (owing.length > 0) {
    const heading = document.createElement("h3");
    heading.textContent = `Owing (${owing.length})`;
    body.append(heading);
    body.append(
      note(
        "Owing is the invoice less the payments assigned to it. Where the imported file differs, " +
          "its figure is shown too: usually a receipt not yet found, one paid through a processor " +
          "net of its fee, or one banked elsewhere.",
      ),
    );
    const table = document.createElement("table");
    const head = document.createElement("thead");
    table.className = "report-table owner-table match-table";
    head.innerHTML =
      "<tr><th>Invoice</th><th>Due</th><th>Total</th><th>Assigned</th>" +
      "<th>Owing</th><th>File says</th><th>Status</th><th></th></tr>";
    const tbody = document.createElement("tbody");

    for (const balance of owing) {
      const invoice = balance.invoice;
      if (!hit(`${invoice.number} ${invoice.contact} ${invoice.reference}`)) continue;
      const tr = document.createElement("tr");
      tr.append(invoiceCell(invoice, invoice.number));
      tr.append(nameCell(invoice.due ?? ""));
      tr.append(amountCell(money(invoice.total)));
      tr.append(amountCell(balance.assigned === 0 ? "" : money(balance.assigned)));

      const left = amountCell(money(balance.remaining));
      left.classList.add("match-off");
      tr.append(left);

      // Only when it differs, and only when the file said anything: a column
      // repeating our own figure back at us is noise on every row.
      const differs =
        balance.fileRemaining !== null && balance.fileRemaining !== balance.remaining;
      const fileCell = amountCell(differs ? money(balance.fileRemaining ?? 0) : "");
      if (differs) fileCell.classList.add("match-why");
      tr.append(fileCell);

      tr.append(nameCell(balance.status));
      tr.append(editInvoiceCell(invoice));
      tbody.append(tr);
    }
    table.append(head, tbody);
    body.append(table);
  }

  // --- matched ---
  const heading = document.createElement("h3");
  heading.textContent = `Matched (${result.matched.length})`;
  body.append(heading);
  const table = document.createElement("table");
  table.className = "report-table owner-table";
  const head = document.createElement("thead");
  table.className = "report-table owner-table match-table";
  head.innerHTML =
    "<tr><th>Invoice</th><th>Total</th><th>Settled by</th><th>Received</th><th>How</th><th></th></tr>";
  const tbody = document.createElement("tbody");
  for (const match of result.matched) {
    if (!hit(`${match.invoice.number} ${match.invoice.contact} ${match.invoice.reference}`)) continue;
    const tr = document.createElement("tr");
    tr.append(invoiceCell(match.invoice, match.invoice.number));
    tr.append(amountCell(money(match.invoice.total)));

    // One settling line per row inside the cell. Several instalments run
    // together on a single line was the unreadable part.
    const lines = document.createElement("td");
    lines.className = "report-name match-lines";
    for (const t of match.transactions) {
      const line = document.createElement("div");
      line.textContent =
        `${t.date} · ${money(t.amount)} · ${bankLabel(t.account)} · ` +
        `${t.otherParty || t.particulars || ""}`;
      lines.append(line);
    }
    tr.append(lines);

    const received = match.transactions.reduce((sum, t) => sum + t.amount, 0);
    const total = amountCell(money(received));
    // Instalments that do not add up to the invoice are worth seeing.
    if (received !== match.invoice.total) total.classList.add("match-off");
    tr.append(total);
    tr.append(nameCell(match.how));
    tr.append(editInvoiceCell(match.invoice));
    tbody.append(tr);
  }

  // Invoices settled by hand, which the matcher never proposed and so never
  // reports. Without these a payment split across two invoices cleared them
  // both out of "still owing" and then appeared nowhere at all -- money that
  // had gone somewhere the page could not say.
  const shownAlready = new Set(result.matched.map((m) => m.invoice.number));
  const byInvoice = new Map<string, Transaction[]>();
  for (const [transactionId, number] of invoiceAssignments()) {
    if (number === "" || shownAlready.has(number)) continue;
    const t = byTransaction.get(transactionId);
    if (t === undefined) continue;
    const list = byInvoice.get(number);
    if (list) list.push(t);
    else byInvoice.set(number, [t]);
  }
  for (const [number, lines] of byInvoice) {
    const invoice = byNumber.get(number);
    if (invoice === undefined) continue;
    if (!hit(`${invoice.number} ${invoice.contact} ${invoice.reference}`)) continue;
    const tr = document.createElement("tr");
    tr.append(invoiceCell(invoice, invoice.number));
    tr.append(amountCell(money(invoice.total)));
    const cell = document.createElement("td");
    cell.className = "report-name match-lines";
    for (const t of lines) {
      const line = document.createElement("div");
      line.textContent =
        `${t.date} · ${money(t.amount)} · ${bankLabel(t.account)} · ` +
        `${t.otherParty || t.particulars || ""}` +
        (t.id.includes(":") ? " · part of a split payment" : "");
      cell.append(line);
    }
    tr.append(cell);
    const received = lines.reduce((sum, t) => sum + t.amount, 0);
    const total = amountCell(money(received));
    if (received !== invoice.total) total.classList.add("match-off");
    tr.append(total);
    tr.append(nameCell("chosen here"));
    tr.append(editInvoiceCell(invoice));
    tbody.append(tr);
  }

  heading.textContent = `Matched (${result.matched.length + byInvoice.size})`;
  table.append(head, tbody);
  body.append(table);
}

/** Record an accepted match, so it is not guessed again. */
async function acceptMatch(transactionId: string, invoiceNumber: string): Promise<void> {
  const invoiceMatches = { ...(state.ledger.invoiceMatches ?? {}), [transactionId]: invoiceNumber };
  state.ledger = { ...state.ledger, invoiceMatches };
  state.persistent = await savePart(state.ledger, "invoiceMatches");
  state.invoiceMessage = `Matched ${invoiceNumber}. The difference is still yours to code.`;
  redraw("invoices");
}

/**
 * Begin a fresh invoice.
 *
 * Which invoice is being edited is this page's business and nobody else's, so
 * the sidebar button asks for a new one rather than reaching in and clearing
 * the variable itself.
 */
export function startNewInvoice(): void {
  editingInvoice = "";
  redraw("invoiceEditor");
}

/** Starting an invoice, loading a batch of them, and searching what is there. */
export function wireInvoices(): void {
  $("invoice-new").addEventListener("click", () => startNewInvoice());

  $("invoices-pick").addEventListener("click", () => $<HTMLInputElement>("invoices-input").click());
  $<HTMLInputElement>("invoices-input").addEventListener("change", (e) => {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (file) void loadInvoices(file);
    (e.target as HTMLInputElement).value = "";
  });
  $<HTMLInputElement>("invoice-search").addEventListener("input", () => redraw("invoices"));
}

/**
 * Credit notes, and the invoice each one credits.
 *
 * A credit note reverses a sale that was billed. It is not a payment and it is
 * not a second invoice, and treating it as either gets the debtors figure
 * wrong in a way nobody notices: measured as an invoice it read as overpaid
 * the moment it arrived, and left unapplied it leaves the original sale
 * showing as owing for ever, uncollectable.
 *
 * The link is made here by hand because the accounting system's export does
 * not carry it. On these books one credit note's reference reads "write off
 * bad debt as per the accountant" -- free text, naming no invoice. Matching on
 * the contact and the amount would settle the wrong one silently, and a
 * debtors ledger that is quietly wrong is worse than one that is visibly
 * incomplete.
 *
 * The date is the credit note's own. On the payments basis the GST on a
 * reversal belongs to the period the credit was raised in, not the period of
 * the sale it reverses.
 */
function creditNoteSection(
  body: HTMLElement,
  balances: Map<string, InvoiceBalance>,
  money: (cents: number) => string,
): void {
  const notes = [...balances.values()].filter((b) => b.status === "credit note");
  if (notes.length === 0) return;

  const links = state.ledger.creditNotes ?? {};
  const heading = document.createElement("h3");
  heading.textContent = `Credit notes (${notes.length})`;
  body.append(heading);
  body.append(
    note(
      "Choose the invoice each credit note applies to; it then reduces what that invoice " +
        "owes, dated on the credit note.",
    ),
  );

  const table = document.createElement("table");
  table.className = "report-table owner-table match-table";
  const head = document.createElement("thead");
  head.innerHTML =
    "<tr><th>Credit note</th><th>Date</th><th>Contact</th><th>Amount</th>" +
    "<th>Reference</th><th>Credits</th></tr>";
  const tbody = document.createElement("tbody");

  // Only invoices that could still take a credit: one already settled by money
  // would be pushed into a negative balance, which is a different mistake.
  const open = [...balances.values()]
    .filter((b) => b.status !== "credit note" && b.invoice.total > 0)
    .sort((a, b) => (a.invoice.issued < b.invoice.issued ? 1 : -1));

  for (const balance of notes) {
    const cn = balance.invoice;
    const tr = document.createElement("tr");
    tr.append(invoiceCell(cn, cn.number));
    tr.append(nameCell(cn.issued));
    tr.append(nameCell(cn.contact));
    tr.append(amountCell(money(Math.abs(cn.total))));
    tr.append(nameCell(cn.reference));

    const cell = document.createElement("td");
    const pick = document.createElement("select");
    pick.className = "bank-link";
    const none = document.createElement("option");
    none.value = "";
    none.textContent = "not yet said";
    pick.append(none);
    for (const other of open) {
      const option = document.createElement("option");
      option.value = other.invoice.number;
      option.textContent =
        `${other.invoice.number} · ${other.invoice.issued} · ${other.invoice.contact} · ` +
        `${money(other.invoice.total)} (${money(other.remaining)} owing)`;
      pick.append(option);
    }
    pick.value = links[cn.number] ?? "";
    pick.addEventListener("change", () => {
      void saveCreditNote(cn.number, pick.value);
    });
    cell.append(pick);
    tr.append(cell);
    tbody.append(tr);
  }

  table.append(head, tbody);
  body.append(table);
}

/** Record which invoice a credit note credits, or take the link away. */
async function saveCreditNote(note: string, invoice: string): Promise<void> {
  const before = state.ledger.creditNotes ?? {};
  const after = { ...before };
  if (invoice === "") delete after[note];
  else after[note] = invoice;

  state.ledger = { ...state.ledger, creditNotes: after };
  state.persistent = await savePart(state.ledger);
  await record(
    "invoice",
    invoice === "" ? `${note} credits nothing` : `${note} credits ${invoice}`,
    before,
    after,
    note,
  );
  redraw("invoices");
}
