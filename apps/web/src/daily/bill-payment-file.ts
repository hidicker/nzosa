import { redraw } from "../app.js";
import { record } from "../books.js";
import { booksCountry, booksMoney } from "../country.js";
import { state } from "../state.js";
import { savePart } from "../store.js";
import { download, note, tellOnPage } from "../ui.js";
import { abaFile, findContact, nzAccount, nzBankOf, nzPaymentFile, NZ_BANK_NAMES } from "@nzosa/core";
import type { AbaSettings, DocumentStatus, Invoice, InvoiceBalance } from "@nzosa/core";

/**
 * Paying bills by bank file: tick the bills to pay, and one file pays each
 * supplier into the account kept on their contact. The bills are not marked
 * paid here: the payments come back as bank lines and are matched on
 * Reconcile like any other, so a file that is never uploaded leaves nothing
 * wrong in the books.
 */

type Row = { bill: Invoice; balance: InvoiceBalance; status: DocumentStatus };

/** Ticked bills, by number. Undefined until the panel first opens: then the ones due by the pay date. */
let ticked: Set<string> | undefined;
let payDate = new Date().toLocaleDateString("en-CA");
let open = false;

const TO_PAY: readonly DocumentStatus[] = ["Awaiting payment", "Part paid", "Overdue"];

function settings(): { payFrom?: string; aba?: AbaSettings } {
  return state.ledger.billPayment ?? {};
}

async function keepSettings(next: { payFrom?: string; aba?: AbaSettings }, what: string): Promise<void> {
  const before = state.ledger.billPayment ?? null;
  state.ledger = { ...state.ledger, billPayment: next };
  state.persistent = await savePart(state.ledger);
  await record("billPayment", what, before, next);
}

/** Where a supplier is paid, from their contact. */
function payee(bill: Invoice): { account: string; bsb: string } {
  const contact = findContact(state.ledger.contacts ?? [], bill.contact);
  return { account: contact?.bankAccount?.trim() ?? "", bsb: contact?.bsb?.trim() ?? "" };
}

/** The button that opens the panel, and the panel itself when open. */
export function billPaymentFile(body: HTMLElement, rows: readonly Row[]): void {
  const country = booksCountry().id;
  if (country !== "nz" && country !== "au") return;
  const payable = rows.filter((r) => TO_PAY.includes(r.status) && r.balance.remaining > 0);
  if (payable.length === 0) return;

  const toggle = document.createElement("button");
  toggle.type = "button";
  toggle.textContent = open ? "Close the bank file" : "Pay by bank file";
  toggle.title = "Tick the bills to pay and make one bulk payment file to upload to your bank. Nothing is paid from here.";
  toggle.addEventListener("click", () => {
    open = !open;
    redraw("bills");
  });
  body.append(toggle);
  if (!open) return;

  if (ticked === undefined) {
    ticked = new Set(payable.filter((r) => (r.bill.due ?? r.bill.issued) <= payDate).map((r) => r.bill.number));
  }
  const chosen = ticked;

  const panel = document.createElement("div");
  panel.className = "provisional-note";
  const date = document.createElement("input");
  date.type = "date";
  date.value = payDate;
  date.addEventListener("change", () => {
    payDate = date.value;
    // Re-choose what is due by the new date.
    ticked = undefined;
    redraw("bills");
  });
  const dateLabel = document.createElement("label");
  dateLabel.append("Pay on ", date);
  panel.append(dateLabel);

  if (country === "nz") {
    const from = document.createElement("input");
    from.type = "text";
    from.placeholder = "12-3456-0123456-00";
    from.value = settings().payFrom ?? "";
    from.addEventListener("change", () => void keepSettings({ ...settings(), payFrom: from.value.trim() }, "Account bills are paid from changed"));
    const label = document.createElement("label");
    label.append(" from account ", from);
    panel.append(label);
  } else {
    panel.append(abaFields());
  }

  const table = document.createElement("table");
  table.className = "report-table";
  table.innerHTML = "<thead><tr><th></th><th>Bill</th><th>Supplier</th><th>Due</th><th>Owing</th><th>Paid into</th></tr></thead>";
  const tbody = document.createElement("tbody");
  for (const { bill, balance } of payable) {
    const tr = document.createElement("tr");
    const tick = document.createElement("input");
    tick.type = "checkbox";
    tick.checked = chosen.has(bill.number);
    tick.addEventListener("change", () => {
      if (tick.checked) chosen.add(bill.number);
      else chosen.delete(bill.number);
    });
    const where = payee(bill);
    const readable =
      country === "nz" ? (nzAccount(where.account) !== null ? where.account : "") : where.bsb !== "" && where.account !== "" ? `${where.bsb} ${where.account}` : "";
    const cells = [bill.number, bill.contact, bill.due ?? "", booksMoney(balance.remaining), readable || "no bank account: add one on Contacts"];
    const first = document.createElement("td");
    first.append(tick);
    tr.append(first);
    for (const text of cells) {
      const td = document.createElement("td");
      td.textContent = text;
      tr.append(td);
    }
    tbody.append(tr);
  }
  table.append(tbody);
  panel.append(table);

  const make = document.createElement("button");
  make.type = "button";
  make.className = "primary";
  make.textContent = "Make the bank file";
  make.addEventListener("click", () => void makeFile(payable.filter((r) => chosen.has(r.bill.number))));
  const actions = document.createElement("div");
  actions.className = "migration-actions";
  actions.append(make);
  panel.append(
    actions,
    note(
      "The bills stay unpaid here until the payments come back as bank lines and are matched on Reconcile, " +
        "so a file that is never uploaded leaves the books as they were.",
    ),
  );
  body.append(panel);
}

function abaFields(): HTMLElement {
  // The payroll's ABA details are the same bank's, so they are offered first.
  const held = settings().aba ?? state.ledger.auPayroll?.aba ?? { bankCode: "", userName: "", userId: "", fromBsb: "", fromAccount: "" };
  const wrap = document.createElement("span");
  const box = (words: string, key: keyof Omit<AbaSettings, "balance">, placeholder: string): HTMLLabelElement => {
    const input = document.createElement("input");
    input.type = "text";
    input.placeholder = placeholder;
    input.value = held[key];
    input.size = key === "userName" ? 20 : 8;
    input.addEventListener("change", () => {
      const aba = { ...held, ...(settings().aba ?? {}), [key]: input.value.trim() };
      void keepSettings({ ...settings(), aba }, "ABA details for bills changed");
    });
    const label = document.createElement("label");
    label.append(` ${words} `, input);
    return label;
  };
  wrap.append(
    box("bank", "bankCode", "CBA"),
    box("account name", "userName", "As the bank holds it"),
    box("direct entry user ID", "userId", "123456"),
    box("from BSB", "fromBsb", "062-000"),
    box("account", "fromAccount", "Account"),
  );
  return wrap;
}

async function makeFile(rows: readonly Row[]): Promise<void> {
  const country = booksCountry().id;
  const items = rows.map(({ bill, balance }) => {
    const where = payee(bill);
    return {
      name: bill.contact,
      account: where.account,
      bsb: where.bsb,
      amount: balance.remaining,
      // The supplier sees their own bill number and reference.
      particulars: bill.number,
      reference: bill.reference || bill.number,
    };
  });
  const payer = state.ledger.entities?.entities.find((e) => e.id === rows[0]?.bill.entityId)?.name ??
    state.ledger.entities?.entities[0]?.name ?? "";
  let file;
  if (country === "nz") {
    const fromAccount = settings().payFrom ?? "";
    const bank = nzBankOf(fromAccount);
    if (bank === null) {
      await tellOnPage(
        fromAccount === ""
          ? "Enter the account the bills are paid from first: its bank decides the file's layout."
          : "There is no bulk payment file here for that account's bank. ANZ, ASB, BNZ, Kiwibank and Westpac are covered.",
      );
      return;
    }
    file = nzPaymentFile(items, { bank, fromAccount, payerName: payer, date: payDate });
  } else {
    const aba = settings().aba ?? state.ledger.auPayroll?.aba ?? { bankCode: "", userName: "", userId: "", fromBsb: "", fromAccount: "" };
    file = abaFile(items, { ...aba, remitter: payer, description: "SUPPLIERS", date: payDate });
  }
  if (file.problems.length > 0) {
    await tellOnPage(`The bank file cannot be made yet:\n\n${file.problems.join("\n")}`);
    return;
  }
  download(file.text, file.fileName, "text/plain;charset=us-ascii");
  await tellOnPage(
    `${file.count} payment${file.count === 1 ? "" : "s"}, ${booksMoney(file.total)} in all, are in ${file.fileName}. ` +
      `Upload it to ${country === "nz" ? NZ_BANK_NAMES[nzBankOf(settings().payFrom ?? "") ?? "bnz"] + "'s internet banking" : "your bank's business banking"} ` +
      "as a bulk payment, check the payments it lists, and approve them there. Nothing has been paid from here.",
  );
}
