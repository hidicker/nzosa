import { redraw } from "../app.js";
import { attachmentsControl } from "./attachments-ui.js";
import { invoiceBalanceMap, record } from "../books.js";
import { supplierFor } from "./invoices.js";
import { booksLocale, booksMoney, documentOptions } from "../country.js";
import { $, state } from "../state.js";
import { save as saveLedger, savePart } from "../store.js";
import { askOnPage, askTextOnPage, download, note, tellOnPage } from "../ui.js";
import {
  collectionLetter,
  contactKey,
  customerStatement,
  isPosted,
  lateFee,
  mergeContacts,
  nextInvoiceNumber,
  parseAmount,
  reminderStageFor,
  emailForContact,
  lookalikeContact,
  fillWording,
  STANDARD_WORDING,
  unknownBlanks,
  WORDING_BLANKS,
  wordingFor,
} from "@nzosa/core";
import type { Contact, ContactKind, Invoice, PaidTo, Wording, WordingKind } from "@nzosa/core";
import { paidTo } from "@nzosa/core";
import { taxYearEnd, taxYearOf, taxYearStart } from "../tax-year.js";
import { booksCountry, booksCurrency, noSalesTax } from "../country.js";

/**
 * Customers and vendors: who the books deal with.
 *
 * A record is looked up by name from invoices and bills, so adding one posts
 * nothing and changes no figure. What it holds is for the person: an address
 * and email to send to, terms, and for a vendor whether a W-9 is on file and
 * whether they are to be sent a 1099.
 */

type Filter = "all" | "customer" | "vendor" | "inactive";

let filter: Filter = "all";
let query = "";
/** The id being edited, or "new" for a record not made yet. */
let editing: string | null = null;

const KIND_WORD: Record<ContactKind, string> = { customer: "Customer", vendor: "Vendor", both: "Customer and vendor" };

function held(): Contact[] {
  return state.ledger.contacts ?? [];
}

async function keep(next: Contact[], what: string): Promise<void> {
  const before = held();
  state.ledger = { ...state.ledger, contacts: next };
  state.persistent = await savePart(state.ledger);
  await record("contacts", what, before, next);
  redraw("contacts");
}

/** What each name is owed or owes, from the documents in play. */
interface Owing {
  owedToUs: number;
  weOwe: number;
  documents: number;
  /** What a customer owes on invoices past their due date. */
  pastDue: number;
  /** Days past due of the oldest of them. */
  lateDays: number;
}

// The day where the person is: these books are kept in their own country.
const today = (): string => new Date().toLocaleDateString("en-CA");

function owing(): Map<string, Owing> {
  const out = new Map<string, Owing>();
  const now = today();
  for (const balance of invoiceBalanceMap().values()) {
    // An estimate or a draft is not owed yet.
    if (!isPosted(balance.invoice)) continue;
    const key = contactKey(balance.invoice.contact);
    const one = out.get(key) ?? { owedToUs: 0, weOwe: 0, documents: 0, pastDue: 0, lateDays: 0 };
    one.documents += 1;
    if (balance.invoice.kind === "sales") {
      one.owedToUs += balance.remaining;
      const due = balance.invoice.due ?? balance.invoice.issued;
      if (balance.remaining > 0 && due < now) {
        one.pastDue += balance.remaining;
        const days = Math.round((Date.parse(`${now}T00:00:00Z`) - Date.parse(`${due}T00:00:00Z`)) / 86_400_000);
        one.lateDays = Math.max(one.lateDays, days);
      }
    } else one.weOwe += balance.remaining;
    out.set(key, one);
  }
  return out;
}

/** What a supplier has been paid, this financial year and in all. */
function paidToThem(name: string): PaidTo {
  const year = taxYearOf(today());
  return paidTo(name, state.ledger.transactions, state.ledger.overrides ?? {}, state.ledger.invoices ?? [], {
    from: taxYearStart(year),
    to: taxYearEnd(year),
  });
}

/** A customer's posted invoices and what is left on each. */
function salesFor(name: string): { invoice: Invoice; remaining: number }[] {
  return [...invoiceBalanceMap().values()].filter(
    (b) => b.invoice.kind === "sales" && isPosted(b.invoice) && contactKey(b.invoice.contact) === contactKey(name),
  );
}

function statementLines(mine: readonly { invoice: Invoice; remaining: number }[]) {
  return mine.map((b) => ({
    number: b.invoice.number,
    issued: b.invoice.issued,
    due: b.invoice.due,
    total: b.invoice.total,
    owing: b.remaining,
    reference: b.invoice.reference === "QuickBooks" ? "" : b.invoice.reference,
  }));
}

/**
 * A customer's statement or reminder: the document saved, and -- where their
 * email is known -- a new message opened in the person's own mail program,
 * in the books' own wording, to attach it to. Nothing is sent from here.
 * True when an email was opened.
 */
function sendStatement(name: string, kind: "statement" | "reminder", email: string | undefined): boolean {
  const mine = salesFor(name);
  const first = mine[0]?.invoice;
  const supplier = first === undefined ? null : supplierFor(first);
  if (supplier === null) {
    void tellOnPage("Say which entity is sending it first: add an entity on Entities & accounts.");
    return false;
  }
  const sums = owing().get(contactKey(name));
  const lines = statementLines(mine);
  const html =
    kind === "reminder"
      ? collectionLetter(name, lines, today(), supplier, reminderStageFor(sums?.lateDays ?? 0), documentOptions())
      : customerStatement(name, lines, today(), supplier, documentOptions());
  download(html, `${kind}-${name.replace(/[^A-Za-z0-9]+/g, "-")}.html`, "text/html;charset=utf-8");
  const to = (email ?? emailForContact(state.ledger.invoices ?? [], name) ?? "").trim();
  if (to === "") return false;
  const words = fillWording(wordingFor(kind, state.ledger.emailWording), {
    customer: name,
    business: supplier.name,
    date: new Date().toLocaleDateString(booksLocale(), { day: "numeric", month: "short", year: "numeric" }),
    owing: booksMoney(sums?.owedToUs ?? 0),
    pastdue: booksMoney(sums?.pastDue ?? 0),
    payment: (supplier.payTo ?? "").trim(),
  });
  window.location.href = `mailto:${encodeURIComponent(to)}?subject=${encodeURIComponent(words.subject)}&body=${encodeURIComponent(words.body)}`;
  return true;
}

/** The wording of the three emails, each editable, with what each blank stands for. */
function openWordingEditor(): void {
  const box = document.createElement("dialog");
  box.className = "ask-on-page payment-file-view";
  const heading = document.createElement("h3");
  heading.textContent = "What the emails say";
  const intro = document.createElement("p");
  intro.className = "payment-file-said";
  intro.textContent =
    "Each opens in your own mail program, with the document saved to attach. A word in braces is filled in for each customer; " +
    "a line whose blank has nothing to fill it is left out.";
  box.append(heading, intro);
  const kinds: [WordingKind, string][] = [
    ["invoice", "Invoice"],
    ["statement", "Statement"],
    ["reminder", "Reminder"],
  ];
  const fields = new Map<WordingKind, { subject: HTMLInputElement; body: HTMLTextAreaElement }>();
  for (const [kind, word] of kinds) {
    const now = wordingFor(kind, state.ledger.emailWording);
    const section = document.createElement("details");
    section.className = "wording-section";
    section.open = kind === "invoice";
    const summary = document.createElement("summary");
    summary.textContent = word;
    const subject = document.createElement("input");
    subject.type = "text";
    subject.value = now.subject;
    subject.className = "wording-subject";
    subject.setAttribute("aria-label", `${word} email subject`);
    const body = document.createElement("textarea");
    body.rows = 9;
    body.value = now.body;
    body.className = "wording-body";
    body.setAttribute("aria-label", `${word} email`);
    const blanks = document.createElement("p");
    blanks.className = "payment-file-said";
    blanks.textContent = WORDING_BLANKS[kind].map((b) => `{${b.name}} ${b.means}`).join(" · ");
    const reset = document.createElement("button");
    reset.type = "button";
    reset.className = "small";
    reset.textContent = "Back to the standard wording";
    reset.addEventListener("click", () => {
      subject.value = STANDARD_WORDING[kind].subject;
      body.value = STANDARD_WORDING[kind].body;
    });
    section.append(summary, subject, body, blanks, reset);
    box.append(section);
    fields.set(kind, { subject, body });
  }
  const said = document.createElement("p");
  said.className = "cloud-said";
  said.setAttribute("role", "alert");
  const actions = document.createElement("div");
  actions.className = "ask-on-page-actions";
  const cancel = document.createElement("button");
  cancel.type = "button";
  cancel.textContent = "Cancel";
  const saveButton = document.createElement("button");
  saveButton.type = "button";
  saveButton.className = "primary";
  saveButton.textContent = "Save";
  actions.append(cancel, saveButton);
  box.append(said, actions);
  const finish = (): void => {
    box.close();
    box.remove();
  };
  cancel.addEventListener("click", finish);
  box.addEventListener("cancel", (event) => {
    event.preventDefault();
    finish();
  });
  saveButton.addEventListener("click", () => {
    const next: Partial<Record<WordingKind, Wording>> = {};
    for (const [kind, word] of kinds) {
      const f = fields.get(kind);
      if (f === undefined) continue;
      const wording = { subject: f.subject.value.trim(), body: f.body.value.trim() };
      const unknown = unknownBlanks(kind, wording);
      if (unknown.length > 0) {
        said.textContent = `The ${word.toLowerCase()} email has {${unknown.join("}, {")}}, which nothing fills in. The blanks are listed under it.`;
        return;
      }
      const standard = STANDARD_WORDING[kind];
      // The standard wording is not kept as a copy: it can then be improved.
      if (wording.subject !== standard.subject || wording.body !== standard.body) next[kind] = wording;
    }
    void (async () => {
      const before = state.ledger.emailWording ?? {};
      state.ledger = { ...state.ledger, emailWording: next };
      state.persistent = await saveLedger(state.ledger);
      await record("emailWording", "Changed what the emails say", before, next);
      finish();
    })();
  });
  document.body.append(box);
  box.showModal();
}

/**
 * Every customer with something past due, to send each their statement in
 * turn: one press each opens their email with the statement saved beside it.
 */
function openOverdueStatements(): void {
  const late = [...owing().entries()]
    .filter(([, sums]) => sums.pastDue > 0)
    .map(([key, sums]) => {
      const named = [...invoiceBalanceMap().values()].find((b) => contactKey(b.invoice.contact) === key)?.invoice.contact ?? key;
      const contact = held().find((c) => contactKey(c.name) === key);
      const email = contact?.email ?? emailForContact(state.ledger.invoices ?? [], named) ?? "";
      return { name: contact?.name ?? named, email, sums };
    })
    .sort((a, b) => b.sums.lateDays - a.sums.lateDays);
  if (late.length === 0) {
    void tellOnPage("No customer has anything past due.");
    return;
  }
  const box = document.createElement("dialog");
  box.className = "ask-on-page payment-file-view";
  const heading = document.createElement("h3");
  heading.textContent = `${late.length} ${late.length === 1 ? "customer has" : "customers have"} something past due`;
  const intro = document.createElement("p");
  intro.className = "payment-file-said";
  intro.textContent = "Each opens a message in your own mail program and saves the statement to attach to it; one at a time, so each goes with its own statement.";
  const table = document.createElement("table");
  table.className = "report-table payment-file-table";
  table.innerHTML = '<thead><tr><th>Customer</th><th>Email</th><th style="text-align:right">Past due</th><th style="text-align:right">Days</th><th></th></tr></thead>';
  const tbody = document.createElement("tbody");
  for (const one of late) {
    const tr = document.createElement("tr");
    for (const [text, right] of [[one.name, false], [one.email || "none on file", false], [booksMoney(one.sums.pastDue), true], [String(one.sums.lateDays), true]] as const) {
      const td = document.createElement("td");
      td.textContent = text;
      if (right) td.className = "report-amount";
      tr.append(td);
    }
    const cell = document.createElement("td");
    const send = document.createElement("button");
    send.type = "button";
    send.className = "small";
    send.textContent = one.email === "" ? "Save statement" : "Email statement";
    send.addEventListener("click", () => {
      sendStatement(one.name, "statement", one.email || undefined);
      send.textContent = one.email === "" ? "Saved" : "Opened";
      tr.classList.add("statement-done");
    });
    cell.append(send);
    tr.append(cell);
    tbody.append(tr);
  }
  table.append(tbody);
  const actions = document.createElement("div");
  actions.className = "ask-on-page-actions";
  const all = document.createElement("button");
  all.type = "button";
  all.textContent = "Save every statement";
  all.addEventListener("click", () => {
    for (const one of late) sendStatement(one.name, "statement", "");
  });
  const close = document.createElement("button");
  close.type = "button";
  close.className = "primary";
  close.textContent = "Done";
  actions.append(all, close);
  box.append(heading, intro, table, actions);
  const finish = (): void => {
    box.close();
    box.remove();
  };
  close.addEventListener("click", finish);
  box.addEventListener("cancel", (event) => {
    event.preventDefault();
    finish();
  });
  document.body.append(box);
  box.showModal();
}

/**
 * A late fee, drafted as an invoice: a percentage of what is past due, coded
 * to a late fee or finance charge account where the chart has one. A draft
 * posts nothing until it is approved on Invoices.
 */
async function draftLateFee(customer: string, pastDue: number): Promise<void> {
  const said = await askTextOnPage(
    `Late fee for ${customer}, as a percentage of the ${booksMoney(pastDue)} past due:`,
    "1.5",
  );
  if (said === null) return;
  const percent = Number(said.replace("%", "").trim());
  if (!Number.isFinite(percent) || percent <= 0) {
    await tellOnPage("A percentage, such as 1.5.");
    return;
  }
  const amount = lateFee(pastDue, percent);
  const income = state.chart.filter((a) => /revenue|income|sales/i.test(a.type));
  const account =
    income.find((a) => /late fee|finance charge|interest/i.test(a.name)) ??
    income.find((a) => /other income/i.test(a.type)) ??
    income[0];
  const late = salesFor(customer).filter((b) => b.remaining > 0 && (b.invoice.due ?? b.invoice.issued) < today());
  const issued = today();
  const draft: Invoice = {
    number: nextInvoiceNumber("sales", state.ledger.invoices ?? []),
    kind: "sales",
    contact: customer,
    reference: "Late fee",
    issued,
    due: issued,
    total: amount,
    tax: 0,
    paid: 0,
    outstanding: amount,
    currency: booksCurrency(),
    status: "Draft",
    lines: [
      {
        description: `Late fee, ${percent}% of ${booksMoney(pastDue)} past due on ${late.map((b) => b.invoice.number).join(", ")}`,
        accountCode: account?.code.trim() ?? "",
        // A percentage of what is overdue is interest: exempt from GST.
        taxType: noSalesTax() ? "No GST" : "GST Exempt",
        net: amount,
        tax: 0,
        gross: amount,
      },
    ],
  };
  state.ledger = { ...state.ledger, invoices: [...(state.ledger.invoices ?? []), draft] };
  state.persistent = await savePart(state.ledger, "invoices");
  await record("invoice", `Created ${draft.number} — ${customer} late fee ${booksMoney(amount)}`, null, draft, draft.number);
  await tellOnPage(`${draft.number} for ${booksMoney(amount)} is drafted on Invoices. Approve it there to post it.`);
  redraw("contacts");
  redraw("invoices");
}

/**
 * Small balances left on customers' invoices -- a few cents short, a bank fee
 * the customer took off -- written off in one go to a bad debts account. Each
 * is recorded on its invoice as settled outside the bank, so it posts bad
 * debts against receivables on today's date, and each can be undone on its own
 * in History.
 */
async function writeOffSmall(): Promise<void> {
  const said = await askTextOnPage("Write off what customers still owe on an invoice when it is no more than:", "5.00");
  if (said === null) return;
  const limit = parseAmount(said, booksCurrency());
  if (limit === null || limit <= 0) {
    await tellOnPage("An amount, such as 5.00.");
    return;
  }
  const expense = state.chart.filter((a) => /expense|overhead/i.test(a.type));
  const account = expense.find((a) => /bad debt|write.?off|uncollect/i.test(a.name));
  if (account === undefined) {
    await tellOnPage("Add an expense account for bad debts on Entities & accounts first, such as Bad debts.");
    return;
  }
  const small = [...invoiceBalanceMap().values()].filter(
    (b) => b.invoice.kind === "sales" && isPosted(b.invoice) && b.remaining > 0 && b.remaining <= limit,
  );
  if (small.length === 0) {
    await tellOnPage(`No invoice has ${booksMoney(limit)} or less left to pay.`);
    return;
  }
  const total = small.reduce((sum, b) => sum + b.remaining, 0);
  if (
    !await askOnPage(
      `Write off ${small.length} balance${small.length === 1 ? "" : "s"}, ${booksMoney(total)} in all, ` +
        `to ${account.code} ${account.name}?\n\n` +
        small.map((b) => `${b.invoice.number} ${b.invoice.contact}: ${booksMoney(b.remaining)}`).join("\n"),
    )
  ) {
    return;
  }
  const on = today();
  const label = `${account.name} - ${account.code.trim()}`;
  const changed = new Map<Invoice, Invoice>();
  for (const b of small) {
    changed.set(b.invoice, {
      ...b.invoice,
      paidOutside: [
        ...(b.invoice.paidOutside ?? []),
        { date: on, amount: b.remaining, accountCode: label, note: "Written off", writeOff: true },
      ],
      paid: b.invoice.paid + b.remaining,
      outstanding: Math.max(0, b.invoice.outstanding - b.remaining),
    });
  }
  state.ledger = { ...state.ledger, invoices: (state.ledger.invoices ?? []).map((i) => changed.get(i) ?? i) };
  state.persistent = await savePart(state.ledger, "invoices");
  for (const [before, after] of changed) {
    const amount = (after.paidOutside ?? []).at(-1)?.amount ?? 0;
    await record("invoice", `${after.number} — ${after.contact}: ${booksMoney(amount)} written off`, before, after, after.number);
  }
  redraw("contacts");
  redraw("invoices");
}

function field(label: string, control: HTMLElement): HTMLElement {
  const wrap = document.createElement("label");
  wrap.className = "contact-field";
  const text = document.createElement("span");
  text.textContent = label;
  wrap.append(text, control);
  return wrap;
}

function input(value: string | undefined, type = "text"): HTMLInputElement {
  const el = document.createElement("input");
  el.type = type;
  el.value = value ?? "";
  return el;
}

function form(existing: Contact | null): HTMLElement {
  const box = document.createElement("div");
  box.className = "contact-form";
  const name = input(existing?.name);
  const kind = document.createElement("select");
  for (const [value, text] of Object.entries(KIND_WORD)) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = text;
    option.selected = (existing?.kind ?? "customer") === value;
    kind.append(option);
  }
  const company = input(existing?.company);
  const email = input(existing?.email, "email");
  const phone = input(existing?.phone, "tel");
  const address = document.createElement("textarea");
  address.rows = 3;
  address.value = existing?.address ?? "";
  const terms = input(existing?.terms);
  terms.placeholder = "Net 30";
  const taxId = input(existing?.taxId);
  const w9 = input(undefined, "checkbox");
  w9.checked = existing?.w9 === true;
  const is1099 = input(undefined, "checkbox");
  is1099.checked = existing?.is1099 === true;
  const exempt = input(undefined, "checkbox");
  exempt.checked = existing?.taxExempt === true;
  const limit = input(existing?.creditLimit === undefined ? "" : (existing.creditLimit / 100).toFixed(2));
  limit.inputMode = "decimal";
  limit.placeholder = "None";
  const usual = document.createElement("select");
  const noAccount = document.createElement("option");
  noAccount.value = "";
  noAccount.textContent = "None";
  usual.append(noAccount);
  for (const a of state.chart.filter((one) => /expense|overhead|direct|cost|asset/i.test(one.type))) {
    const option = document.createElement("option");
    option.value = a.code.trim();
    option.textContent = `${a.code} ${a.name}`.trim();
    option.selected = existing?.defaultAccount === a.code.trim();
    usual.append(option);
  }
  const bank = input(existing?.bankAccount);
  bank.placeholder = booksCountry().id === "au" ? "062-000 12345678" : "12-3456-0123456-00";
  bank.autocomplete = "off";
  const notes = document.createElement("textarea");
  notes.rows = 2;
  notes.value = existing?.notes ?? "";

  const ticks = document.createElement("div");
  ticks.className = "contact-ticks";
  const w9Label = document.createElement("label");
  w9Label.append(w9, document.createTextNode(" W-9 on file"));
  const tenLabel = document.createElement("label");
  tenLabel.append(is1099, document.createTextNode(" Send a 1099-NEC"));
  const exemptLabel = document.createElement("label");
  exemptLabel.append(exempt, document.createTextNode(" Tax exempt: no sales tax on their invoices"));
  ticks.append(w9Label, tenLabel, exemptLabel);

  const problem = document.createElement("p");
  problem.className = "cloud-said";

  const save = document.createElement("button");
  save.type = "button";
  save.className = "primary";
  save.textContent = existing === null ? "Add" : "Save";
  save.addEventListener("click", async () => {
    const said = name.value.trim();
    if (said === "") {
      problem.textContent = "A name, as it appears on invoices and bills.";
      return;
    }
    const limitCents = limit.value.trim() === "" ? null : parseAmount(limit.value, booksCurrency());
    if (limit.value.trim() !== "" && (limitCents === null || limitCents < 0)) {
      problem.textContent = "A credit limit as an amount, such as 5000, or nothing.";
      return;
    }
    const clash = held().find((c) => contactKey(c.name) === contactKey(said) && c.id !== existing?.id);
    if (clash !== undefined) {
      problem.textContent = `${clash.name} is already here.`;
      return;
    }
    // A second card for one supplier splits their history in two: asked
    // about when a new name is the same as one already here but for
    // punctuation and words like Ltd.
    const alike = existing !== null && contactKey(existing.name) === contactKey(said) ? undefined : lookalikeContact(held(), said, existing?.id);
    if (alike !== undefined && !(await askOnPage(`${alike.name} is already here, and looks like the same ${alike.kind === "vendor" ? "supplier" : "customer"}. Keep ${said} as well?`, `Keep ${said}`))) {
      return;
    }
    const fields = {
      name: said,
      kind: kind.value as ContactKind,
      ...(company.value.trim() !== "" ? { company: company.value.trim() } : {}),
      ...(email.value.trim() !== "" ? { email: email.value.trim() } : {}),
      ...(phone.value.trim() !== "" ? { phone: phone.value.trim() } : {}),
      ...(address.value.trim() !== "" ? { address: address.value.trim() } : {}),
      ...(terms.value.trim() !== "" ? { terms: terms.value.trim() } : {}),
      ...(taxId.value.trim() !== "" ? { taxId: taxId.value.trim() } : {}),
      ...(notes.value.trim() !== "" ? { notes: notes.value.trim() } : {}),
      ...(w9.checked ? { w9: true } : {}),
      ...(is1099.checked ? { is1099: true } : {}),
      ...(exempt.checked ? { taxExempt: true } : {}),
      ...(limitCents !== null && limitCents > 0 ? { creditLimit: limitCents } : {}),
      ...(usual.value !== "" ? { defaultAccount: usual.value } : {}),
      ...(bank.value.trim() !== "" ? { bankAccount: bank.value.trim() } : {}),
    };
    editing = null;
    if (existing === null) {
      void keep(mergeContacts(held(), [fields]), `Added ${said}`);
    } else {
      const next = held().map((c) =>
        c.id === existing.id
          ? { id: c.id, ...(c.active === false ? { active: false } : {}), ...(c.source !== undefined ? { source: c.source } : {}), ...fields }
          : c,
      );
      void keep(next as Contact[], `Changed ${said}`);
    }
  });
  const cancel = document.createElement("button");
  cancel.type = "button";
  cancel.textContent = "Cancel";
  cancel.addEventListener("click", () => {
    editing = null;
    redraw("contacts");
  });

  box.append(
    field("Name", name),
    field("Customer or vendor", kind),
    field("Company", company),
    field("Email", email),
    field("Phone", phone),
    field("Address", address),
    field("Payment terms", terms),
    field(booksCountry().id === "us" ? "Tax ID (EIN or SSN)" : booksCountry().id === "nz" ? "IRD or GST number" : "Tax ID", taxId),
    field("Credit limit (customers)", limit),
    field("Bills usually coded to (vendors)", usual),
    // Bank payment files are New Zealand's and Australia's.
    ...(booksCountry().id === "nz" || booksCountry().id === "au"
      ? [field(booksCountry().id === "au" ? "BSB and account, to pay them (vendors)" : "Bank account, to pay them (vendors)", bank)]
      : []),
    // The W-9 and the 1099-NEC are the United States' own.
    ...(booksCountry().id === "us" ? [ticks] : []),
    field("Notes", notes),
    problem,
  );
  const row = document.createElement("div");
  row.className = "migration-actions";
  row.append(save, cancel);
  box.append(row);
  // A supplier's payments, said where their details are.
  if (existing !== null && existing.kind !== "customer") {
    const paid = paidToThem(existing.name);
    if (paid.payments > 0) {
      box.append(
        note(
          `Paid ${booksMoney(paid.period)} this financial year and ${booksMoney(paid.allTime)} in all, ` +
            `over ${paid.payments} ${paid.payments === 1 ? "payment" : "payments"}; the last on ${paid.last ?? ""}.`,
        ),
      );
    }
  }
  // A contract, a W-9, a signed form: kept with them once they are saved.
  if (existing !== null) box.append(attachmentsControl({ kind: "contact", id: existing.id }, existing.name));
  return box;
}

export function renderContacts(): void {
  const body = $("contacts-body");
  body.textContent = "";
  const all = held();

  const controls = document.createElement("div");
  controls.className = "contacts-controls";
  const choose = document.createElement("select");
  choose.id = "contacts-filter";
  for (const [value, text] of [
    ["all", "Everyone"],
    ["customer", "Customers"],
    ["vendor", "Vendors"],
    ["inactive", "Inactive"],
  ] as const) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = text;
    option.selected = filter === value;
    choose.append(option);
  }
  choose.addEventListener("change", () => {
    filter = choose.value as Filter;
    redraw("contacts");
  });
  const search = input(query, "search");
  search.id = "contacts-search";
  search.placeholder = "Search by name, company or email";
  search.addEventListener("input", () => {
    query = search.value;
    redraw("contacts");
    document.getElementById("contacts-search")?.focus();
  });
  const add = document.createElement("button");
  add.type = "button";
  add.className = "primary";
  add.textContent = "New customer or vendor";
  add.addEventListener("click", () => {
    editing = "new";
    redraw("contacts");
  });
  const writeOff = document.createElement("button");
  writeOff.type = "button";
  writeOff.textContent = "Write off small balances";
  writeOff.title = "Clear what is left on invoices under an amount you choose, to a bad debts account.";
  writeOff.addEventListener("click", () => void writeOffSmall());
  const overdue = document.createElement("button");
  overdue.type = "button";
  overdue.textContent = "Statements to overdue customers";
  overdue.addEventListener("click", () => openOverdueStatements());
  const wording = document.createElement("button");
  wording.type = "button";
  wording.textContent = "Email wording";
  wording.title = "What the invoice, statement and reminder emails say";
  wording.addEventListener("click", () => openWordingEditor());
  controls.append(choose, search, add, writeOff, overdue, wording);
  body.append(controls);

  if (editing === "new") body.append(form(null));

  if (all.length === 0 && editing !== "new") {
    body.append(
      note(
        "No customers or vendors yet. Add one, or drop a list exported from your other system on Setup: " +
          "invoices and bills name them already, and bringing in a QuickBooks ledger adds them by name.",
      ),
    );
    return;
  }

  const money = owing();
  const needle = query.trim().toLowerCase();
  const shown = all
    .filter((c) =>
      filter === "inactive"
        ? c.active === false
        : c.active !== false && (filter === "all" || c.kind === filter || c.kind === "both"),
    )
    .filter(
      (c) =>
        needle === "" ||
        [c.name, c.company, c.email].some((text) => (text ?? "").toLowerCase().includes(needle)),
    )
    .sort((a, b) => a.name.localeCompare(b.name));

  const table = document.createElement("table");
  table.className = "report-table owner-table contacts-table";
  const head = document.createElement("thead");
  // Suppliers shown alone: what each has been paid, this year and in all.
  const vendors = filter === "vendor";
  head.innerHTML =
    "<tr><th>Name</th><th>Is</th><th>Email</th><th>Phone</th><th>Owes you</th><th>You owe</th>" +
    (vendors ? "<th>Paid this year</th><th>Paid in all</th>" : "") +
    "<th></th></tr>";
  const tbody = document.createElement("tbody");
  for (const contact of shown) {
    const sums = money.get(contactKey(contact.name));
    const tr = document.createElement("tr");
    if (contact.active === false) tr.className = "event-reverted";
    const cells: [string, string][] = [
      [contact.name + (contact.company !== undefined ? ` — ${contact.company}` : ""), "report-name"],
      [KIND_WORD[contact.kind] + (contact.is1099 === true ? ", 1099" : ""), "report-name"],
      [contact.email ?? "", "report-name"],
      [contact.phone ?? "", "report-name"],
      [sums !== undefined && sums.owedToUs !== 0 ? booksMoney(sums.owedToUs) : "", "report-amount"],
      [sums !== undefined && sums.weOwe !== 0 ? booksMoney(sums.weOwe) : "", "report-amount"],
      ...(vendors
        ? ((): [string, string][] => {
            const paid = paidToThem(contact.name);
            return [
              [paid.period === 0 ? "" : booksMoney(paid.period), "report-amount"],
              [paid.allTime === 0 ? "" : booksMoney(paid.allTime), "report-amount"],
            ];
          })()
        : []),
    ];
    for (const [text, cls] of cells) {
      const td = document.createElement("td");
      td.className = cls;
      td.textContent = text;
      tr.append(td);
    }
    const actions = document.createElement("td");
    const edit = document.createElement("button");
    edit.type = "button";
    edit.className = "small";
    edit.textContent = "Edit";
    edit.addEventListener("click", () => {
      editing = contact.id;
      redraw("contacts");
    });
    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "small";
    toggle.textContent = contact.active === false ? "Make active" : "Make inactive";
    toggle.addEventListener("click", () => {
      const next = held().map((c) => (c.id === contact.id ? { ...c, active: c.active === false } : c));
      void keep(next, `${contact.name} made ${contact.active === false ? "active" : "inactive"}`);
    });
    actions.append(edit, toggle);
    if (contact.kind !== "vendor" && sums !== undefined && sums.pastDue > 0) {
      const remind = document.createElement("button");
      remind.type = "button";
      remind.className = "small";
      remind.textContent = "Reminder";
      const stage = reminderStageFor(sums.lateDays);
      remind.title =
        stage === 1 ? "A first, friendly reminder" : stage === 2 ? "A second notice" : "A final notice";
      remind.addEventListener("click", () => {
        sendStatement(contact.name, "reminder", contact.email);
      });
      const fee = document.createElement("button");
      fee.type = "button";
      fee.className = "small";
      fee.textContent = "Late fee";
      fee.title = "Draft an invoice for a late fee on what is past due, to check and approve on Invoices.";
      const pastDue = sums.pastDue;
      fee.addEventListener("click", () => void draftLateFee(contact.name, pastDue));
      actions.append(remind, fee);
    }
    if (contact.kind !== "vendor" && sums !== undefined && sums.owedToUs !== 0) {
      const statement = document.createElement("button");
      statement.type = "button";
      statement.className = "small";
      statement.textContent = "Statement";
      statement.title = "Saves their statement, and opens an email to them to attach it to where their email is known";
      statement.addEventListener("click", () => {
        sendStatement(contact.name, "statement", contact.email);
      });
      actions.append(statement);
    }
    tr.append(actions);
    tbody.append(tr);
    if (editing === contact.id) {
      const editor = document.createElement("tr");
      const cell = document.createElement("td");
      cell.colSpan = vendors ? 9 : 7;
      cell.append(form(contact));
      editor.append(cell);
      tbody.append(editor);
    }
  }
  table.append(head, tbody);
  const scroller = document.createElement("div");
  scroller.className = "table-scroll";
  scroller.append(table);
  body.append(scroller);

  const count = document.createElement("p");
  count.className = "page-hint";
  count.textContent = `${shown.length} of ${all.length}.`;
  body.append(count);
}
