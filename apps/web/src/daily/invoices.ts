import { moduleOn } from "../modules.js";
import { redraw } from "../app.js";
import {
  bankLabel,
  billEntities,
  billsAvailable,
  controlAccountFor,
  invoiceAssignments,
  invoiceBalanceMap,
  record,
  invoicesInPlay,
  proposalOpen,
  proposalState,
  stockAccounts,
} from "../books.js";
import { combobox } from "../combobox.js";
import { renderRecurring } from "./recurring.js";
import type { Combobox } from "../combobox.js";
import { knownCodes } from "../reconcile.js";
import { $, state } from "../state.js";
import { save as saveLedger, savePart } from "../store.js";
import { amountCell, askOnPage, download, invoiceCell, nameCell, note } from "../ui.js";
import {
  accountEntityKey,
  applySalesTax,
  billWarnings,
  canonicalCodeFor,
  emptyEntityModel,
  formatAmount,
  gstContent,
  invoiceDocument,
  invoiceEmail,
  cleanDocumentLink,
  emailForContact,
  findContact,
  findItem,
  isPosted,
  isEstimate,
  linesWithoutAccount,
  matchInvoices,
  nextInvoiceNumber,
  splitAccountLabel,
  splitInvoiceNumber,
  splitPartId,
  NOT_TAXABLE,
  TAXABLE,
} from "@nzosa/core";
import type {
  SalesTaxRate,
  Account,
  Invoice,
  InvoiceBalance,
  InvoiceKind,
  InvoiceLine,
  InvoiceSupplier,
  Item,
  Transaction,
} from "@nzosa/core";
import { loadInvoices } from "../migrate/file-intake.js";
import { booksCountry, booksCurrency, booksMoney, documentOptions, noSalesTax, gstPercent, taxTypeLabel } from "../country.js";

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

/**
 * Which page the editor is open on.
 *
 * One editor for both, because a bill and an invoice are the same document
 * pointed the other way; but a bill is written on the Bills page, where it
 * opens already a bill, belonging to an entity, as a draft until approved.
 */
let editorOn: "invoices" | "bills" = "invoices";

/** The GST treatments an invoice line can carry, named as Xero names them. */
const INVOICE_TAX_TYPES = [
  { value: "15% GST on Income", label: "15% GST on Income", rate: 15 },
  { value: "Zero Rated", label: "Zero rated", rate: 0 },
  { value: "GST Exempt", label: "Exempt", rate: 0 },
  { value: "No GST", label: "No GST", rate: 0 },
] as const;

/** And a bill's, which Xero names for the side of the return they claim on. */
const BILL_TAX_TYPES = [
  { value: "15% GST on Expenses", label: "15% GST on Expenses", rate: 15 },
  { value: "Zero Rated Expenses", label: "Zero rated", rate: 0 },
  { value: "GST Exempt", label: "Exempt", rate: 0 },
  { value: "No GST", label: "No GST", rate: 0 },
] as const;

/** The treatments offered for a document of this kind, keeping one it already has. */
function taxTypesFor(kind: InvoiceKind): readonly { value: string; label: string; rate: number }[] {
  return kind === "purchase" ? BILL_TAX_TYPES : INVOICE_TAX_TYPES;
}

/** The rate a treatment charges, whichever list it came from. */
function rateOf(taxType: string): number {
  // Xero New Zealand writes the rate ("15% GST on Income"); Xero Australia
  // does not ("GST on Income", "GST on Capital"). Both charge the books' rate.
  return /15%|10%/.test(taxType) || /^\s*gst on (income|expenses|capital)\b/i.test(taxType) ? 15 : 0;
}

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
  if (editorOn === "bills") {
    // The entity chosen at the top, when it keeps bills; the only one that
    // does, when there is one.
    const keepers = billEntities();
    const entity = keepers.find((e) => e.id === state.entityFilter) ?? (keepers.length === 1 ? keepers[0] : undefined);
    const registered = entity?.gstRegistered !== false;
    return {
      number: suggestInvoiceNumber("purchase"),
      kind: "purchase",
      contact: "",
      reference: "",
      issued: today,
      due: null,
      total: 0,
      tax: 0,
      paid: 0,
      outstanding: 0,
      currency: booksCurrency(),
      status: "Draft",
      lines: [{
        description: "", accountCode: "", taxType: registered && !noSalesTax() ? "15% GST on Expenses" : "No GST",
        net: 0, tax: 0, gross: 0,
      }],
      ...(entity !== undefined ? { entityId: entity.id } : {}),
    };
  }
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
    currency: booksCurrency(),
    status: "Awaiting Payment",
    lines: [{ description: "", accountCode: "", taxType: noSalesTax() ? "No GST" : "15% GST on Income", net: 0, tax: 0, gross: 0 }],
  };
}

/** Cents from what someone typed, tolerating commas, spaces and a $ sign. */
function parseMoney(text: string): number {
  const cleaned = text.replace(/[$,\s]/g, "");
  if (cleaned === "" || !/^-?\d*\.?\d*$/.test(cleaned)) return 0;
  return Math.round(Number(cleaned) * 100);
}

export function renderInvoiceEditor(): void {
  // Both pages have a place for the editor; only the one it is open on shows it.
  const invoiceHost = document.getElementById("invoice-editor");
  const billHost = document.getElementById("bill-editor");
  if (invoiceHost) invoiceHost.textContent = "";
  if (billHost) billHost.textContent = "";
  const host = editorOn === "bills" ? billHost : invoiceHost;
  if (host === null || editingInvoice === null) return;
  const asBill = editorOn === "bills";

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
  heading.textContent = existing ? `Edit ${existing.number}` : asBill ? "New bill" : "New invoice";
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
  field(asBill ? "Bill number" : "Invoice number", number, asBill ? "Ours, for finding it again." : undefined);

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
  // A bill written on the Bills page is a bill; the choice is only offered
  // where either could be meant.
  const typeField = field("Type", kind);
  typeField.hidden = asBill;

  // Changing what the document is changes what it is called, but only while the
  // number is still the one offered: a number typed by hand is a decision, and
  // an invoice already raised keeps the number it was issued under.
  let offered = number.value;
  kind.addEventListener("change", () => {
    if (existing !== undefined || number.value !== offered) return;
    offered = suggestInvoiceNumber(kind.value as InvoiceKind);
    number.value = offered;
  });

  const contact = text(draft.contact, asBill ? "Who sent the bill" : "Who it is to, or from");
  field(asBill ? "Supplier" : "Contact", contact);
  // The customers or vendors on record, offered as the name is typed.
  const known = (state.ledger.contacts ?? []).filter(
    (c) => c.active !== false && (c.kind === "both" || c.kind === (asBill ? "vendor" : "customer")),
  );
  if (known.length > 0) {
    const list = document.createElement("datalist");
    list.id = "invoice-contacts";
    for (const one of known) {
      const option = document.createElement("option");
      option.value = one.name;
      list.append(option);
    }
    contact.setAttribute("list", list.id);
    contact.after(list);
  }

  // Where the "email" button sends it. Sales only: a bill's sender is not
  // somebody these books write to.
  const email = text(draft.email ?? "", "customer@example.com");
  email.type = "email";
  if (!asBill) field("Email", email, "Optional. Used to address the message when you email the invoice.");
  // A customer already written to keeps the address used last time. Only an
  // empty box is filled: one typed by hand is a decision.
  contact.addEventListener("change", () => {
    // A vendor's usual account, on a first line that has none yet.
    if (asBill) {
      const usual = findContact(state.ledger.contacts ?? [], contact.value)?.defaultAccount;
      const first = lineHost.querySelector<HTMLElement>(".invoice-line");
      const picker = first === null ? undefined : lineAccounts.get(first);
      if (usual !== undefined && picker !== undefined && picker.value === "") picker.choose(accountLabelFor(usual));
    }
    if (asBill || email.value.trim() !== "") return;
    const remembered =
      emailForContact(state.ledger.invoices ?? [], contact.value) ??
      findContact(state.ledger.contacts ?? [], contact.value)?.email ??
      null;
    if (remembered !== null) email.value = remembered;
  });

  // Only the link is kept: the file stays in the owner's own Drive or Dropbox.
  const documentLink = text(draft.documentLink ?? "", "https://drive.google.com/…");
  documentLink.type = "url";
  field(
    "Document link",
    documentLink,
    "Optional. A share link to the PDF or receipt in your own Google Drive or Dropbox. " +
      "The books keep the link, not the file.",
  );

  const reference = text(draft.reference, asBill ? "e.g. INV-2041" : "");
  field(
    asBill ? "Supplier's invoice number" : "Reference",
    reference,
    asBill ? "As it appears on the bill, so it can be found on their statement." : undefined,
  );

  // Whose debt this is. Only the entities that keep bills are offered, and a
  // bill already belonging to another keeps it rather than losing it here.
  const entity = document.createElement("select");
  const keepers = billEntities();
  const allEntities = (state.ledger.entities ?? emptyEntityModel()).entities;
  const entityChoices = [
    ...keepers,
    ...allEntities.filter((e) => e.id === draft.entityId && !keepers.includes(e)),
  ];
  if (draft.entityId === undefined || !entityChoices.some((e) => e.id === draft.entityId)) {
    const none = document.createElement("option");
    none.value = "";
    none.textContent = "Choose the entity";
    entity.append(none);
  }
  for (const one of entityChoices) {
    const option = document.createElement("option");
    option.value = one.id;
    option.textContent = one.name;
    option.selected = one.id === draft.entityId;
    entity.append(option);
  }
  const entityField = field("Entity", entity, "Whose bill it is: its costs, its GST and its payables.");
  entityField.hidden = !asBill || (entityChoices.length <= 1 && draft.entityId !== undefined);

  const issued = document.createElement("input");
  issued.type = "date";
  issued.value = draft.issued;
  field(asBill ? "Bill date" : "Issued", issued, asBill ? "The date on the bill: when the cost and its GST fall." : undefined);

  const due = document.createElement("input");
  due.type = "date";
  due.value = draft.due ?? "";
  field("Due", due, "Optional.");

  // A bill's status is one of three decisions, not free text: the rest --
  // part paid, paid, overdue -- are worked out from the money.
  const statusChoice = document.createElement("select");
  for (const [value, label] of [
    ["Draft", "Draft: not in the books yet"],
    // An order placed with a supplier: not owed until the bill comes.
    ...(booksCountry().id === "nz" ? [] : ([["Purchase order", "Purchase order: ordered, not owed yet"]] as const)),
    ["Awaiting Payment", "Approved: in the books"],
    ["Voided", "Voided: taken back out"],
  ] as const) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = label;
    statusChoice.append(option);
  }
  const said = draft.status.trim().toLowerCase();
  statusChoice.value =
    said === "purchase order"
      ? "Purchase order"
      : said === "draft" || said === "submitted" || said === "awaiting approval"
      ? "Draft"
      : said === "voided" || said === "deleted"
        ? "Voided"
        : "Awaiting Payment";
  const statusText = text(draft.status);
  const status = asBill ? statusChoice : statusText;
  field("Status", status);

  const paid = text((draft.paid / 100).toFixed(2));
  const paidField = field("Already paid", paid, "Leave at 0.00 for a new invoice.");
  // A bill's payments are bank lines matched on Reconcile, or a payment
  // recorded on the Bills page with its date and account. A bare figure here
  // would have neither.
  paidField.hidden = asBill && draft.paid === 0;

  // United States sales tax: one rate for the invoice, the place the sale is
  // made, added on top of the taxable lines and owed in the rate's account.
  const usTax = !asBill && booksCountry().id === "us";
  const rates = (): SalesTaxRate[] => state.ledger.salesTaxRates ?? [];
  const taxRate = document.createElement("select");
  const fillRates = (chosen: string): void => {
    taxRate.textContent = "";
    const add = (value: string, label: string): void => {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = label;
      taxRate.append(option);
    };
    add("", "No sales tax");
    for (const rate of rates()) {
      if (rate.active === false && rate.id !== chosen) continue;
      add(rate.id, `${rate.name} ${rate.percent}%`);
    }
    add("new", "Add a rate…");
    taxRate.value = rates().some((r) => r.id === chosen) ? chosen : "";
  };
  const exemptOf = (name: string): boolean => findContact(state.ledger.contacts ?? [], name)?.taxExempt === true;
  // A new invoice takes the rate the last one was charged at, unless its
  // customer is exempt.
  const lastRate =
    [...(state.ledger.invoices ?? [])].reverse().find((i) => i.kind === "sales" && i.salesTaxRateId !== undefined)
      ?.salesTaxRateId ?? "";
  fillRates(existing !== undefined ? (draft.salesTaxRateId ?? "") : exemptOf(draft.contact) ? "" : lastRate);
  const rateField = field("Sales tax", taxRate, "The rate where the sale is made: state, county and city together.");
  const exemptNote = document.createElement("small");
  exemptNote.textContent = "This customer is tax exempt.";
  rateField.append(exemptNote);

  // A rate added from here: its name, its percentage, and the account it is owed in.
  const owedIn = state.chart.filter((a) => /liab/i.test(a.type));
  const newRate = document.createElement("div");
  newRate.className = "invoice-new-rate";
  const rateName = text("", "e.g. Seattle, WA");
  rateName.setAttribute("aria-label", "Rate name");
  const ratePercent = text("", "10.35");
  ratePercent.inputMode = "decimal";
  ratePercent.setAttribute("aria-label", "Rate percent");
  const rateAccount = document.createElement("select");
  rateAccount.setAttribute("aria-label", "Owed in account");
  for (const account of owedIn) {
    const option = document.createElement("option");
    option.value = account.code;
    option.textContent = account.code === "" ? account.name : `${account.code} ${account.name}`;
    rateAccount.append(option);
  }
  const salesTaxAccount = owedIn.find((a) => /sales tax/i.test(a.name));
  if (salesTaxAccount !== undefined) rateAccount.value = salesTaxAccount.code;
  else {
    // Books brought from elsewhere may have nowhere to owe it: one is made.
    const make = document.createElement("option");
    make.value = "new";
    make.textContent = "Sales tax payable (a new account)";
    rateAccount.prepend(make);
    rateAccount.value = "new";
  }
  const keepRate = document.createElement("button");
  keepRate.type = "button";
  keepRate.className = "small";
  keepRate.textContent = "Add rate";
  const rateProblem = document.createElement("small");
  keepRate.addEventListener("click", () => {
    const percent = Number(ratePercent.value.replace("%", "").trim());
    const name = rateName.value.trim();
    if (name === "" || !Number.isFinite(percent) || percent <= 0 || percent >= 100 || rateAccount.value === "") {
      rateProblem.textContent = "Give the rate a name, a percentage between 0 and 100, and the account it is owed in.";
      return;
    }
    let accountCode = rateAccount.value;
    if (accountCode === "new") {
      let n = 2200;
      while (state.chart.some((a) => a.code.trim() === String(n))) n += 10;
      accountCode = String(n);
      const made = { code: accountCode, name: "Sales tax payable", type: "Current Liability", taxCode: "Tax Exempt", description: "" } as Account;
      state.chart = [...state.chart, made];
      const model = state.ledger.entities;
      const owner = model?.entities.find((e) => e.kind !== "personal" && e.kind !== "residential")?.id ?? model?.entities[0]?.id;
      state.ledger = {
        ...state.ledger,
        chart: state.chart,
        ...(model !== undefined && owner !== undefined
          ? { entities: { ...model, accounts: { ...model.accounts, [accountCode]: owner } } }
          : {}),
      };
      const option = rateAccount.querySelector<HTMLOptionElement>('option[value="new"]');
      if (option !== null) {
        option.value = accountCode;
        option.textContent = `${accountCode} Sales tax payable`;
      }
    }
    const rate: SalesTaxRate = { id: `rate-${Date.now().toString(36)}`, name, percent, accountCode };
    state.ledger = { ...state.ledger, salesTaxRates: [...rates(), rate] };
    void saveLedger(state.ledger).then((saved) => {
      state.persistent = saved;
    });
    rateName.value = "";
    ratePercent.value = "";
    rateProblem.textContent = "";
    fillRates(rate.id);
    showTax();
  });
  newRate.append(rateName, ratePercent, rateAccount, keepRate, rateProblem);
  const newRateField = field(
    "New sales tax rate",
    newRate,
    "Owed in a liability account of its own for each authority you file with.",
  );

  const salesTaxOn = (): boolean => usTax && kind.value === "sales";
  const chosenRate = (): SalesTaxRate | null =>
    salesTaxOn() ? (rates().find((r) => r.id === taxRate.value) ?? null) : null;
  function showTax(): void {
    rateField.hidden = !salesTaxOn();
    newRateField.hidden = !salesTaxOn() || taxRate.value !== "new";
    exemptNote.hidden = !exemptOf(contact.value);
    for (const select of lineHost.querySelectorAll<HTMLSelectElement>(".line-tax")) {
      if (usTax) select.hidden = chosenRate() === null;
    }
    refreshTotals();
  }
  taxRate.addEventListener("change", showTax);
  kind.addEventListener("change", showTax);
  if (usTax) {
    contact.addEventListener("change", () => {
      if (exemptOf(contact.value)) fillRates("");
      else if (existing === undefined && taxRate.value === "") fillRates(lastRate);
      showTax();
    });
  }

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

  // Products kept in stock, whose lines carry a quantity.
  const stockedItems: Item[] = (state.ledger.items ?? []).filter(
    (i) => i.kind === "product" && i.unitCost !== undefined && i.active !== false,
  );

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
      const rate = rateOf(taxType);
      const tax = rate === 15 && !usTax ? gstContent(gross) : 0;
      // A stocked product's line says which, and how many.
      const item = row.dataset["item"];
      const quantity = Number(row.querySelector<HTMLInputElement>(".line-qty")?.value ?? "");
      return {
        description, accountCode: code, taxType, net: gross - tax, tax, gross,
        ...(item !== undefined ? { itemCode: item, quantity: Number.isFinite(quantity) && quantity > 0 ? quantity : 1 } : {}),
      };
    });
  }

  /** The lines with their sales tax on, where the invoice is charged it. */
  function taxedLines(): InvoiceLine[] {
    const lines = readLines();
    if (!usTax) return lines;
    // A bill, or an invoice turned into one, has no sales tax of its own to add.
    if (!salesTaxOn()) return lines.map((l) => ({ ...l, taxType: "No GST" }));
    return applySalesTax(lines, chosenRate());
  }

  function refreshTotals(): void {
    const lines = taxedLines();
    const total = lines.reduce((sum, l) => sum + l.gross, 0);
    const tax = lines.reduce((sum, l) => sum + l.tax, 0);
    const rate = usTax ? chosenRate() : null;
    totals.textContent =
      rate !== null
        ? `Subtotal ${formatAmount(total - tax)} · Sales tax ${formatAmount(tax)} (${rate.name} ${rate.percent}%) · ` +
          `Total ${formatAmount(total)}`
        : noSalesTax()
          ? `Total ${formatAmount(total)}`
          : `Total ${formatAmount(total)} · GST ${formatAmount(tax)} · ` +
            `excluding GST ${formatAmount(total - tax)}`;
  }

  function addLine(line: InvoiceLine): void {
    const row = document.createElement("div");
    row.className = "invoice-line";

    const description = text(line.description, "What it is for");
    description.className = "line-description";
    // The products and services on record, offered as the line is written;
    // on a bill, the products kept in stock.
    if ((!asBill || stockedItems.length > 0) && (state.ledger.items ?? []).length > 0) {
      const list = document.createElement("datalist");
      list.id = "invoice-items";
      for (const one of asBill ? stockedItems : (state.ledger.items ?? [])) {
        if (one.active === false) continue;
        const option = document.createElement("option");
        option.value = one.name;
        list.append(option);
      }
      description.setAttribute("list", list.id);
      row.append(list);
    }

    const account = combobox(
      accounts,
      line.accountCode === "" ? null : accountLabelFor(line.accountCode),
      "Account",
    );
    account.element.querySelector("input")?.classList.add("line-account");
    lineAccounts.set(row, account);

    const tax = document.createElement("select");
    tax.className = "line-tax";
    const choices = usTax
      ? [
          { value: TAXABLE, label: "Taxable", rate: 0 },
          { value: NOT_TAXABLE, label: "Not taxable", rate: 0 },
        ]
      : taxTypesFor(asBill ? "purchase" : draft.kind);
    // A treatment the document already carries stays offered, so opening an
    // imported bill does not quietly change its GST.
    const treatments = usTax || choices.some((o) => o.value === line.taxType) || line.taxType === ""
      ? choices
      : [{ value: line.taxType, label: line.taxType, rate: rateOf(line.taxType) }, ...choices];
    // The names are Xero New Zealand's; the rate shown is the books' country's.
    for (const option of treatments) {
      const item = document.createElement("option");
      item.value = option.value;
      item.textContent = usTax ? option.label : taxTypeLabel(option.label);
      item.selected = usTax
        ? option.value === (line.taxType === NOT_TAXABLE ? NOT_TAXABLE : TAXABLE)
        : option.value === line.taxType;
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

    // How many, for a product kept in stock: shown only on such a line.
    const qty = document.createElement("input");
    qty.type = "text";
    qty.inputMode = "decimal";
    qty.className = "line-qty invoice-amount";
    qty.title = "How many";
    qty.placeholder = "Qty";
    qty.hidden = true;
    const stockedLine = (item: Item | undefined, quantity: number): void => {
      if (item === undefined) {
        delete row.dataset["item"];
        qty.hidden = true;
        return;
      }
      row.dataset["item"] = item.id;
      qty.hidden = false;
      qty.value = String(quantity);
    };
    const already = stockedItems.find((i) => i.id === line.itemCode || i.name === line.itemCode);
    if (already !== undefined) stockedLine(already, line.quantity ?? 1);
    // The unit a quantity is multiplied by: the price on an invoice, which is
    // what the customer pays; on a bill the cost, which is before GST, with the
    // line's GST added on.
    const unitOf = (item: Item): number | undefined =>
      asBill
        ? item.unitCost === undefined
          ? undefined
          : Math.round(item.unitCost * (1 + (rateOf(tax.value) === 15 ? gstPercent() : 0) / 100))
        : item.price;
    qty.addEventListener("input", () => {
      const item = stockedItems.find((i) => i.id === row.dataset["item"]);
      const unit = item === undefined ? undefined : unitOf(item);
      const n = Number(qty.value.replace(",", "."));
      if (unit !== undefined && Number.isFinite(n) && n > 0) gross.value = ((Math.round(unit * n)) / 100).toFixed(2);
      refreshTotals();
    });

    // Where there is no sales tax there is no treatment to choose; in the
    // United States, only once the invoice has a rate.
    tax.hidden = usTax ? chosenRate() === null : noSalesTax();
    row.append(description, qty, account.element, tax, gross, drop);
    lineHost.append(row);
    // A name that is an item's fills in what is still empty: its account, its
    // price, and the words the line should say.
    description.addEventListener("change", () => {
      const found = findItem(state.ledger.items ?? [], description.value);
      const stocked = found === undefined ? undefined : stockedItems.find((i) => i.id === found.id);
      if (found === undefined || stocked !== undefined || row.dataset["item"] !== undefined) {
        stockedLine(stocked, 1);
      }
      if (found === undefined) return;
      // A stocked product bought goes into the inventory account.
      const into = asBill ? (stocked !== undefined ? stockAccounts().inventory?.code : undefined) : found.accountCode;
      if (asBill && stocked !== undefined && stocked.unitCost !== undefined && parseMoney(gross.value) === 0) {
        gross.value = ((unitOf(stocked) ?? 0) / 100).toFixed(2);
        gross.dispatchEvent(new Event("input", { bubbles: true }));
      }
      if (into !== undefined && account.value === "") account.choose(accountLabelFor(into));
      if (!asBill && found.price !== undefined && parseMoney(gross.value) === 0) {
        gross.value = (found.price / 100).toFixed(2);
        gross.dispatchEvent(new Event("input", { bubbles: true }));
      }
      if (found.description !== undefined) description.value = found.description;
      if (usTax) tax.value = found.taxable === false ? NOT_TAXABLE : TAXABLE;
      refreshTotals();
    });
    for (const control of [description, tax, gross]) {
      control.addEventListener("input", refreshTotals);
      control.addEventListener("change", refreshTotals);
    }
  }

  for (const line of draft.lines) addLine(line);
  showTax();

  const addRow = document.createElement("button");
  addRow.type = "button";
  addRow.textContent = "Add line";
  addRow.addEventListener("click", () => {
    const first = readLines()[0]?.taxType;
    addLine({
      description: "", accountCode: "",
      taxType: usTax ? TAXABLE : noSalesTax() ? "No GST" : (first ?? (asBill ? "15% GST on Expenses" : "15% GST on Income")),
      net: 0, tax: 0, gross: 0,
    });
    refreshTotals();
  });
  box.append(addRow, totals);

  // --- actions -------------------------------------------------------------
  const actions = document.createElement("div");
  actions.className = "invoice-actions";

  const build = (statusValue: string): Invoice => {
    const lines = taxedLines().filter((l) => l.gross !== 0 || l.description.trim() !== "");
    const rate = usTax ? chosenRate() : null;
    const total = lines.reduce((sum, l) => sum + l.gross, 0);
    const tax = lines.reduce((sum, l) => sum + l.tax, 0);
    const paidCents = parseMoney(paid.value);
    const { entityId: _was, email: _email, documentLink: _link, salesTaxRateId: _rate, ...rest } = draft;
    const linkValue = cleanDocumentLink(documentLink.value);
    const emailValue = asBill ? "" : email.value.trim();
    return {
      ...rest,
      number: number.value.trim(),
      kind: asBill ? "purchase" : (kind.value as InvoiceKind),
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
      status: statusValue,
      lines,
      ...(rate !== null ? { salesTaxRateId: rate.id } : {}),
      ...(emailValue !== "" ? { email: emailValue } : {}),
      ...(linkValue !== null ? { documentLink: linkValue } : {}),
      ...(asBill && entity.value !== ""
        ? { entityId: entity.value }
        : draft.entityId !== undefined
          ? { entityId: draft.entityId }
          : {}),
    };
  };

  const save = document.createElement("button");
  save.type = "button";
  save.className = "primary";
  save.textContent = asBill
    ? existing === undefined || statusChoice.value === "Draft" ? "Save as draft" : "Save"
    : "Save invoice";
  save.addEventListener("click", () => {
    void saveInvoice(build(asBill ? statusChoice.value : statusText.value.trim()), existing);
  });

  // Approving is what puts a bill in the books, so it is its own button
  // rather than a status somebody has to know to change.
  const approve = document.createElement("button");
  approve.type = "button";
  approve.className = "primary";
  approve.textContent = "Approve";
  approve.title = "Post it: the cost and GST on the bill date, the amount owing in Accounts Payable.";
  approve.hidden = !asBill || (statusChoice.value !== "Draft" && statusChoice.value !== "Purchase order");
  approve.addEventListener("click", () => {
    void saveInvoice(build("Awaiting Payment"), existing);
  });
  statusChoice.addEventListener("change", () => {
    approve.hidden = !asBill || (statusChoice.value !== "Draft" && statusChoice.value !== "Purchase order");
  });

  const cancel = document.createElement("button");
  cancel.type = "button";
  cancel.textContent = "Cancel";
  cancel.addEventListener("click", () => {
    editingInvoice = null;
    renderInvoiceEditor();
  });

  // A quote: kept, printed and emailed like an invoice, and posting nothing
  // until it is made into one.
  const estimate = document.createElement("button");
  estimate.type = "button";
  estimate.textContent = "Save as estimate";
  estimate.title = "Keep it as an estimate: it is not in the books until you make it an invoice.";
  // Not offered to New Zealand books yet; the rest of the app is the same.
  estimate.hidden = asBill || booksCountry().id === "nz";
  estimate.addEventListener("click", () => {
    const built = build("Estimate");
    const stem = built.number.replace(/^INV/i, "EST");
    void saveInvoice({ ...built, number: stem === built.number && existing === undefined ? `EST-${built.number}` : stem }, existing);
  });

  actions.append(...(asBill ? [approve] : []), save, ...(asBill ? [] : [estimate]), cancel);

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

/** What an invoice's sales tax row says: the rate it was charged at, by name. */
function salesTaxWords(invoice: Invoice): { salesTaxLabel?: string } {
  const rate = (state.ledger.salesTaxRates ?? []).find((r) => r.id === invoice.salesTaxRateId);
  return rate === undefined ? {} : { salesTaxLabel: `Sales tax (${rate.name} ${rate.percent}%)` };
}

/** The picker label for a chart code, so an editor shows what a coder sees. */
function accountLabelFor(code: string): string {
  const codes = knownCodes(state.rules, state.ledger.overrides ?? {}, state.chart);
  return canonicalCodeFor(code, codes) ?? code;
}

/**
 * Whether every line of a document going into the books says where it goes.
 * A line with no account would be owed but count in no income or expense, so
 * it is refused, as Xero refuses it. A draft is not in the books yet and is
 * saved without asking.
 */
function accountsChosen(built: Invoice): boolean {
  if (!isPosted(built)) return true;
  const missing = linesWithoutAccount(built);
  if (missing.length === 0) return true;
  const noun = built.kind === "purchase" ? "bill" : "invoice";
  const said = missing
    .map((line) => `- ${line.description.trim() || "A line"}: ${formatAmount(line.gross)}`)
    .join("\n");
  // As Xero: a line with an amount needs an account before the document is in
  // the books. A draft may wait; a line with no amount is a note.
  alert(
    `${missing.length === 1 ? "A line" : `${missing.length} lines`} of this ${noun} ${missing.length === 1 ? "has" : "have"} no account:\n\n` +
      `${said}\n\n` +
      "Choose an account for each line with an amount before approving it, or save it as a draft to finish later.",
  );
  return false;
}

/**
 * Whether a customer's credit limit, where one is set, lets this invoice go
 * in: over it, the person is asked. A limit is a warning, not a refusal.
 */
function creditLimitAllows(built: Invoice, existing: Invoice | undefined): boolean {
  if (built.kind !== "sales" || !isPosted(built)) return true;
  const limit = findContact(state.ledger.contacts ?? [], built.contact)?.creditLimit;
  if (limit === undefined) return true;
  let owed = 0;
  for (const balance of invoiceBalanceMap().values()) {
    const other = balance.invoice;
    if (other === existing || other.kind !== "sales" || !isPosted(other)) continue;
    if (other.contact.trim().toLowerCase() === built.contact.trim().toLowerCase()) owed += balance.remaining;
  }
  const after = owed + built.total - built.paid;
  if (after <= limit) return true;
  return confirm(
    `${built.contact} would owe ${booksMoney(after)}, over their credit limit of ${booksMoney(limit)}.\n\nSave it anyway?`,
  );
}

async function saveInvoice(built: Invoice, existing: Invoice | undefined): Promise<void> {
  const noun = built.kind === "purchase" ? "bill" : "invoice";
  if (built.number === "") {
    alert(`Give the ${noun} a number.`);
    return;
  }
  if (!(await billReady(built))) return;
  if (!creditLimitAllows(built, existing)) return;
  if (!accountsChosen(built)) return;
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
  redraw("bills");
}

/**
 * What stops a bill being saved, and what only needs a second look.
 *
 * An approved bill needs an entity and that entity's Accounts Payable, or it
 * would post into somebody else's. The rest are warnings: saying yes keeps
 * the bill as the supplier wrote it.
 */
async function billReady(bill: Invoice): Promise<boolean> {
  if (bill.kind !== "purchase" || !billsAvailable()) return true;
  const approved = !["draft", "voided"].includes(bill.status.trim().toLowerCase());
  if (approved) {
    if (bill.entityId === undefined) {
      alert("Choose whose bill this is before approving it.");
      return false;
    }
    if (controlAccountFor(bill.entityId, "purchase") === undefined) {
      const entity = (state.ledger.entities ?? emptyEntityModel()).entities.find((e) => e.id === bill.entityId);
      alert(
        `${entity?.name ?? "This entity"} has no Accounts Payable account for the bill to sit in until it ` +
          "is paid. Add one from the Bills page, then approve it.",
      );
      return false;
    }
  }
  const warnings = billWarnings(bill, state.ledger.invoices ?? []);
  if (warnings.length === 0) return true;
  return confirm(
    `Before saving ${bill.number}:\n\n` +
      warnings.map((w) => `- ${w.message}`).join("\n") +
      "\n\nSave it as it is?",
  );
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
  redraw("bills");
}

/**
 * Which entity is sending this invoice.
 *
 * The accounts its lines are coded to say so: a sale coded to an account
 * belonging to the rental is the rental invoicing, whatever else is in the
 * ledger. With one entity there is nothing to work out, and with none the
 * books have no name to put at the top -- which is what the button says.
 */
export function supplierFor(invoice: Invoice): InvoiceSupplier | null {
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
    ...(entity.logo === undefined ? {} : { logo: entity.logo }),
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
    editorOn = "invoices";
    editingInvoice = invoice.number;
    redraw("invoiceEditor");
    $("invoice-editor").scrollIntoView({ block: "nearest" });
  });
  td.append(edit);

  const link = cleanDocumentLink(invoice.documentLink);
  if (link !== null) {
    const open = document.createElement("a");
    open.href = link;
    open.target = "_blank";
    open.rel = "noopener noreferrer";
    open.className = "invoice-send";
    open.textContent = "file";
    open.title = "Open the saved document in your own Drive or Dropbox.";
    td.append(open);
  }

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
          invoiceDocument(invoice, supplier, { ...documentOptions(), ...salesTaxWords(invoice), ...(isEstimate(invoice) ? { title: "Estimate" } : {}) }),
          `${invoice.number || "invoice"}.html`,
          "text/html;charset=utf-8",
        );
      });
    }
    td.append(send);

    if (isEstimate(invoice)) {
      const make = document.createElement("button");
      make.type = "button";
      make.className = "invoice-send";
      make.textContent = "make invoice";
      make.title = "Turn this estimate into an invoice: it takes the next invoice number and goes into the books.";
      make.addEventListener("click", () => {
        void askOnPage(
          `Make ${invoice.number} for ${invoice.contact} an invoice?

` +
            "It takes the next invoice number and is posted to the books on its date.",
          "Make the invoice",
        ).then(async (yes) => {
          if (!yes) return;
          const number = suggestInvoiceNumber("sales");
          const made: Invoice = { ...invoice, number, status: "Awaiting Payment", outstanding: invoice.total - invoice.paid };
          const all = (state.ledger.invoices ?? []).map((i) => (i === invoice ? made : i));
          state.ledger = { ...state.ledger, invoices: all };
          state.persistent = await savePart(state.ledger, "invoices");
          await record("invoice", `${invoice.number} made invoice ${number} — ${invoice.contact}`, invoice, made, number);
          redraw("invoices");
        });
      });
      td.append(make);
    }

    const mail = document.createElement("button");
    mail.type = "button";
    mail.className = "invoice-send";
    mail.textContent = "email";
    if (supplier === null) {
      mail.disabled = true;
      mail.title = send.title;
    } else {
      mail.title =
        "Opens a new message in your own mail program and saves the invoice " +
        "file to attach to it. Nothing is sent from here.";
      mail.addEventListener("click", () => {
        download(
          invoiceDocument(invoice, supplier, { ...documentOptions(), ...salesTaxWords(invoice), ...(isEstimate(invoice) ? { title: "Estimate" } : {}) }),
          `${invoice.number || "invoice"}.html`,
          "text/html;charset=utf-8",
        );
        // An invoice raised before addresses were kept borrows its
        // customer's most recent one.
        const known =
          emailForContact(state.ledger.invoices ?? [], invoice.contact) ??
          findContact(state.ledger.contacts ?? [], invoice.contact)?.email ??
          null;
        const message = invoiceEmail(
          invoice.email === undefined && known !== null ? { ...invoice, email: known } : invoice,
          supplier,
          { ...documentOptions(), ...(isEstimate(invoice) ? { title: "Estimate" } : {}) },
        );
        window.location.href =
          `mailto:${message.to}?subject=${encodeURIComponent(message.subject)}` +
          `&body=${encodeURIComponent(message.body)}`;
      });
    }
    td.append(mail);
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
  renderRecurring();
  const body = $("invoices-body");
  body.textContent = "";

  if (state.invoiceMessage !== "") body.append(note(state.invoiceMessage));

  // Where the books have a Bills page, bills live there and this page is the
  // sales side. Elsewhere -- books whose bills arrived in a Xero export --
  // they stay here, as the only place they can be seen.
  const shows = (invoice: Invoice): boolean => !billsAvailable() || invoice.kind === "sales";
  if (billsAvailable() && (state.ledger.invoices ?? []).some((i) => i.kind === "purchase")) {
    body.append(note("Bills are on the Bills page."));
  }
  const invoices = invoicesInPlay().filter(shows);
  const settledBefore = (state.ledger.invoices ?? []).filter(shows).length - invoices.length;
  if (settledBefore > 0) {
    body.append(
      note(
        `${settledBefore} dated before these books start ${settledBefore === 1 ? "is" : "are"} not shown: ` +
          "the opening aged receivables say they were paid before then.",
      ),
    );
  }
  if (invoices.length === 0) {
    body.append(
      note(
        moduleOn("xero")
          ? "No invoices loaded. Export them from Xero: Business > Invoices > Export, and bills from " +
              "Business > Bills to pay > Export. Optionally " +
              "add an Account Transactions CSV for payment allocations, which show exactly which " +
              "receipts settled which invoice."
          : "No invoices yet: create one above, or load your invoices from a file.",
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

  // Drafts are listed, and never matched: nothing is owed on one yet.
  const result = matchInvoices({
    invoices: invoices.filter(isPosted),
    transactions: state.ledger.transactions,
    ...(state.ledger.allocations ? { allocations: state.ledger.allocations } : {}),
  });

  const money = (cents: number): string =>
    booksMoney(cents);

  const summary = document.createElement("div");
  summary.className = "check-summary";
  // Counted by what is owed rather than by how a match was arrived at. How a
  // receipt was found is interesting once; what is still owed is the question
  // the page exists to answer.
  const owed = invoiceBalanceMap();
  const summaryBalances = [...owed.values()].filter((b) => shows(b.invoice));
  const count = (status: string) => summaryBalances.filter((b) => b.status === status).length;
  const totalOwing = summaryBalances.reduce((sum, b) => sum + Math.max(0, b.remaining), 0);

  for (const [value, label] of [
    [String(count("paid")), "settled in full"],
    [String(count("part paid")), "part paid"],
    [String(count("unpaid")), "nothing assigned"],
    [money(totalOwing), "still owing"],
    [String(result.proposals.filter((p) => proposalOpen(p, owed)).length), "proposed, needs a decision"],
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
  // Accepted ones leave: they are answered, and sit below Matched as
  // accepted differences, where the difference is still visible.
  const proposed = result.proposals.filter((p) => proposalOpen(p, owed));
  const acceptedDifferences = result.proposals.filter((p) => proposalState(p) === "accepted");
  if (proposed.length > 0) {
    const heading = document.createElement("h3");
    heading.textContent = `Proposed (${proposed.length})`;
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

    for (const proposal of proposed) {
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
      accept.textContent = "accept";
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
  const balances = new Map([...invoiceBalanceMap()].filter(([, b]) => shows(b.invoice)));
  creditNoteSection(body, balances, money);
  const owing = [...balances.values()]
    .filter((b) => b.remaining > 0 && isPosted(b.invoice))
    .sort((a, b) => b.remaining - a.remaining);

  // Drafts on their own, so they can be found and approved, and are plainly
  // not owing: a draft is not in the books until it is approved.
  const drafts = invoices.filter((i) => !isPosted(i) && i.status.trim().toLowerCase() === "draft");
  if (drafts.length > 0) {
    const draftHeading = document.createElement("h3");
    draftHeading.textContent = `Drafts (${drafts.length})`;
    body.append(draftHeading);
    body.append(
      note("Not in the books, not owing, and not offered for matching until approved (status Awaiting Payment)."),
    );
    const draftTable = document.createElement("table");
    draftTable.className = "report-table owner-table match-table";
    const draftHead = document.createElement("thead");
    draftHead.innerHTML = "<tr><th>Invoice</th><th>Date</th><th>Total</th><th></th></tr>";
    const draftBody = document.createElement("tbody");
    for (const invoice of drafts) {
      if (!hit(`${invoice.number} ${invoice.contact} ${invoice.reference}`)) continue;
      const tr = document.createElement("tr");
      tr.append(invoiceCell(invoice, invoice.number), nameCell(invoice.issued), amountCell(money(invoice.total)));
      tr.append(editInvoiceCell(invoice));
      draftBody.append(tr);
    }
    draftTable.append(draftHead, draftBody);
    body.append(draftTable);
  }

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
    const how = nameCell(match.how);
    how.classList.add("match-how");
    tr.append(how);
    tr.append(editInvoiceCell(match.invoice));
    tbody.append(tr);
  }

  // Invoices settled by hand, which the matcher never proposed and so never
  // reports. Without these a payment split across two invoices cleared them
  // both out of "still owing" and then appeared nowhere at all -- money that
  // had gone somewhere the page could not say.
  const shownAlready = new Set([
    ...result.matched.map((m) => m.invoice.number),
    ...acceptedDifferences.map((p) => p.invoiceNumber),
  ]);
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

  // --- accepted differences ---
  // Matched, but for an amount that was not the invoice's: the difference is
  // still somebody's to code, so it stays in view rather than disappearing
  // into Matched.
  if (acceptedDifferences.length > 0) {
    const accHeading = document.createElement("h3");
    accHeading.textContent = `Accepted differences (${acceptedDifferences.length})`;
    body.append(accHeading);
    body.append(note("Accepted matches whose amounts differ. Code each difference yourself, as a write-off or a fee."));
    const accTable = document.createElement("table");
    accTable.className = "report-table owner-table match-table";
    const accHead = document.createElement("thead");
    accHead.innerHTML =
      "<tr><th>Invoice</th><th>Invoice total</th><th>Bank line</th><th>Received</th><th>Difference</th><th>Why</th></tr>";
    const accBody = document.createElement("tbody");
    for (const proposal of acceptedDifferences) {
      const invoice = byNumber.get(proposal.invoiceNumber);
      const bank = byTransaction.get(proposal.transactionId);
      if (!hit(`${proposal.invoiceNumber} ${invoice?.contact ?? ""} ${invoice?.reference ?? ""} ${bank?.otherParty ?? ""}`)) {
        continue;
      }
      const tr = document.createElement("tr");
      tr.append(invoiceCell(invoice, proposal.invoiceNumber));
      tr.append(amountCell(money(invoice?.total ?? proposal.invoiceAmount)));
      tr.append(
        nameCell(
          bank === undefined
            ? ""
            : `${bank.date} · ${bankLabel(bank.account)} · ${bank.otherParty || bank.particulars || ""}`,
        ),
      );
      tr.append(amountCell(money(proposal.bankAmount)));
      const diff = amountCell(money(proposal.adjustment));
      diff.classList.add(proposal.adjustment === 0 ? "match-ok" : "match-off");
      tr.append(diff);
      const why = nameCell(proposal.source);
      why.classList.add("match-why");
      tr.append(why);
      accBody.append(tr);
    }
    accTable.append(accHead, accBody);
    body.append(accTable);
  }
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
  editorOn = "invoices";
  editingInvoice = "";
  redraw("invoiceEditor");
}

/**
 * Approve a draft bill from its row, in one press.
 *
 * Through the same save as the editor, so it is checked the same way: an
 * entity, somewhere for it to sit until paid, and a second look at anything
 * that does not add up.
 */
export async function approveBill(number: string): Promise<void> {
  const existing = (state.ledger.invoices ?? []).find((i) => i.number === number);
  if (existing === undefined) return;
  await saveInvoice({ ...existing, status: "Awaiting Payment" }, existing);
}

/** Begin a fresh bill, on the Bills page. */
export function startNewBill(): void {
  editorOn = "bills";
  editingInvoice = "";
  redraw("invoiceEditor");
}

/** Open a bill in the editor, on the Bills page. */
export function editBill(number: string): void {
  editorOn = "bills";
  editingInvoice = number;
  redraw("invoiceEditor");
  document.getElementById("bill-editor")?.scrollIntoView({ block: "nearest" });
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
export function creditNoteSection(
  body: HTMLElement,
  balances: Map<string, InvoiceBalance>,
  money: (cents: number) => string,
): void {
  const notes = [...balances.values()].filter((b) => b.status === "credit note");
  if (notes.length === 0) return;
  const bills = notes.every((b) => b.invoice.kind === "purchase");

  const links = state.ledger.creditNotes ?? {};
  const heading = document.createElement("h3");
  heading.textContent = `Credit notes (${notes.length})`;
  body.append(heading);
  body.append(
    note(
      bills
        ? "Choose the bill each credit note applies to; it then reduces what that bill owes, " +
            "dated on the credit note."
        : "Choose the invoice each credit note applies to; it then reduces what that invoice " +
            "owes, dated on the credit note.",
    ),
  );

  const table = document.createElement("table");
  table.className = "report-table owner-table match-table";
  const head = document.createElement("thead");
  head.innerHTML =
    "<tr><th>Credit note</th><th>Date</th><th>Contact</th><th>Amount</th>" +
    `<th>Reference</th><th>${bills ? "Bill it credits" : "Credits"}</th></tr>`;
  const tbody = document.createElement("tbody");

  // Only invoices that could still take a credit: one already settled by money
  // would be pushed into a negative balance, which is a different mistake.
  // Those still owing first, as they are the ones a credit usually belongs to;
  // newest first within each.
  const open = [...balances.values()]
    .filter((b) => b.status !== "credit note" && b.invoice.total > 0 && isPosted(b.invoice))
    .sort(
      (a, b) =>
        Number(b.remaining > 0) - Number(a.remaining > 0) ||
        (a.invoice.issued < b.invoice.issued ? 1 : -1),
    );

  for (const balance of notes) {
    const cn = balance.invoice;
    const tr = document.createElement("tr");
    tr.append(invoiceCell(cn, cn.number));
    const issued = nameCell(cn.issued);
    issued.classList.add("report-date");
    tr.append(issued);
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
    // Its own kind only -- a supplier's credit never reduces a customer's
    // invoice -- and the same contact's first, which is nearly always where
    // it belongs.
    const contact = cn.contact.trim().toLowerCase();
    const theirs = open.filter((b) => b.invoice.kind === cn.kind);
    const ordered = [
      ...theirs.filter((b) => b.invoice.contact.trim().toLowerCase() === contact),
      ...theirs.filter((b) => b.invoice.contact.trim().toLowerCase() !== contact),
    ];
    for (const other of ordered) {
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
  // Both pages list credit notes: a supplier's chosen on Bills stayed on the
  // screen, still unassigned, until the page was left and opened again.
  redraw("invoices");
  redraw("bills");
}
