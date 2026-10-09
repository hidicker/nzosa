import { redraw, showPage } from "../app.js";
import { record } from "../books.js";
import { $, state } from "../state.js";
import { savePart } from "../store.js";
import { amountCell, download, nameCell, note } from "../ui.js";
import {
  belowCreditMinimum,
  donorYears,
  emptyEntityModel,
  nextReceiptNumber,
  organisationProblems,
  parseAmount,
  receiptHtml,
  receiptProblems,
  spreadsheetCell,
} from "@nzosa/core";
import type { Cents, DonationReceipt, Entity, IsoDate, Transaction } from "@nzosa/core";
import { taxYearEndSaid, taxYearOf } from "../tax-year.js";
import { booksLocale, moneyPlaces } from "../country.js";
import { linesFor } from "./grants-page.js";

/**
 * Donation receipts, for a donee organisation: issued with every detail
 * Inland Revenue asks for, kept for the seven years it asks, cancelled and
 * replaced rather than altered, and totalled by donor for the year.
 *
 * A receipt can be for one gift (a bank line, or cash handed over) or for
 * several gifts in one tax year as a single total, which is how regular
 * givers are usually receipted. See core's donation-receipts.ts.
 */

/** The organisation the page is working on, and what is being typed. */
let chosen = "";
let donor = "";
let address = "";
let manualDate = "";
let manualAmount = "";
let finding = "";
const ticked = new Set<string>();
let replacing: DonationReceipt | null = null;
let summaryYear = 0;

function money(cents: number): string {
  return (cents / 100).toLocaleString(booksLocale(), {
    minimumFractionDigits: moneyPlaces(),
    maximumFractionDigits: moneyPlaces(),
  });
}

function today(): IsoDate {
  return new Date().toISOString().slice(0, 10);
}

function donees(): Entity[] {
  return (state.ledger.entities ?? emptyEntityModel()).entities.filter(
    (e) => e.kind === "nonprofit" && e.nonprofit?.donee === true,
  );
}

/** Whether the page has anything to offer: some not-for-profit, donee or not. */
export function hasDonationPage(): boolean {
  return (state.ledger.entities ?? emptyEntityModel()).entities.some((e) => e.kind === "nonprofit");
}

async function saveReceipts(receipts: DonationReceipt[], what: string): Promise<void> {
  const before = state.ledger.donationReceipts ?? [];
  state.ledger = { ...state.ledger, donationReceipts: receipts };
  state.persistent = await savePart(state.ledger);
  await record("donationReceipts", what, before, receipts);
  redraw("donations");
}

/** The receipt as a page to print or save as a PDF, in a tab of its own. */
function openReceipt(entity: Entity, receipt: DonationReceipt, options: { copy?: boolean } = {}): void {
  if (entity.nonprofit === undefined) return;
  const replaced = receipt.replaces === undefined ? undefined : (state.ledger.donationReceipts ?? []).find((r) => r.id === receipt.replaces)?.number;
  const html = receiptHtml({ name: entity.name, address: entity.address }, entity.nonprofit, receipt, {
    ...(options.copy === true ? { copy: true } : {}),
    ...(replaced !== undefined ? { replacedNumber: replaced } : {}),
  });
  const url = URL.createObjectURL(new Blob([html], { type: "text/html" }));
  window.open(url, "_blank");
  // Left for a minute: the tab reads it after it opens.
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

function issueForm(entity: Entity, receipts: DonationReceipt[]): HTMLElement {
  const np = entity.nonprofit;
  const box = document.createElement("div");
  box.className = "journal-card";
  const heading = document.createElement("p");
  heading.className = "journal-narration";
  heading.textContent = replacing === null ? "Receipt a donation" : `Replace receipt ${replacing.number}`;
  box.append(heading);

  const names = document.createElement("datalist");
  names.id = "donor-names";
  for (const name of new Set(receipts.map((r) => r.donor))) {
    const option = document.createElement("option");
    option.value = name;
    names.append(option);
  }
  const donorBox = document.createElement("input");
  donorBox.type = "text";
  donorBox.setAttribute("list", "donor-names");
  donorBox.placeholder = "Donor's full name";
  donorBox.value = donor;
  donorBox.addEventListener("input", () => {
    donor = donorBox.value;
  });
  donorBox.addEventListener("change", () => {
    // A name given before brings its address with it.
    const before = [...receipts].reverse().find((r) => r.donor.trim().toLowerCase() === donor.trim().toLowerCase());
    if (before?.address !== undefined && address.trim() === "") {
      address = before.address;
      addressBox.value = address;
    }
  });
  const addressBox = document.createElement("textarea");
  addressBox.rows = 2;
  addressBox.placeholder = "Address, if you hold it";
  addressBox.value = address;
  addressBox.addEventListener("input", () => {
    address = addressBox.value;
  });
  box.append(names, donorBox, addressBox);

  // The gifts: bank lines to tick -- several make one total for the year --
  // or, for cash handed over, a date and an amount.
  const used = new Set(receipts.filter((r) => r.voided === undefined).flatMap((r) => r.transactionIds ?? []));
  const needle = finding.trim().toLowerCase();
  const loose = linesFor(entity)
    .filter((t) => t.amount > 0 && !used.has(t.id))
    .filter(
      (t) =>
        ticked.has(t.id) ||
        needle === "" ||
        `${t.otherParty} ${t.particulars} ${t.reference} ${(t.amount / 100).toFixed(2)} ${t.date}`.toLowerCase().includes(needle),
    )
    .sort((a, b) => b.date.localeCompare(a.date));

  const find = document.createElement("input");
  find.type = "text";
  find.placeholder = "Find a bank line: a name, a word or an amount";
  find.value = finding;
  find.addEventListener("input", () => {
    finding = find.value;
  });
  find.addEventListener("keydown", (event) => {
    if (event.key === "Enter") redraw("donations");
  });
  const go = document.createElement("button");
  go.type = "button";
  go.textContent = "Find";
  go.addEventListener("click", () => redraw("donations"));
  const finder = document.createElement("div");
  finder.className = "page-actions";
  finder.append(find, go);
  const lead = document.createElement("h5");
  lead.textContent = "Money received (tick one gift, or several from one year for a single total)";
  box.append(lead, finder);
  for (const t of loose.slice(0, 40)) {
    const label = document.createElement("label");
    label.className = "grant-line";
    const tick = document.createElement("input");
    tick.type = "checkbox";
    tick.checked = ticked.has(t.id);
    tick.addEventListener("change", () => {
      if (tick.checked) ticked.add(t.id);
      else ticked.delete(t.id);
    });
    const strong = document.createElement("strong");
    strong.textContent = money(t.amount);
    label.append(tick, ` ${t.date}  ${[t.otherParty.trim(), t.particulars.trim()].filter((x) => x !== "").join(" · ")}  `, strong);
    box.append(label);
  }
  if (loose.length > 40) box.append(note(`${loose.length - 40} more. Type in the box to narrow them.`));

  const manual = document.createElement("div");
  manual.className = "page-actions";
  const date = document.createElement("input");
  date.type = "date";
  date.value = manualDate;
  date.max = today();
  date.addEventListener("input", () => {
    manualDate = date.value;
  });
  const amount = document.createElement("input");
  amount.type = "text";
  amount.placeholder = "0.00";
  amount.className = "payroll-tiny-input";
  amount.value = manualAmount;
  amount.addEventListener("input", () => {
    manualAmount = amount.value;
  });
  manual.append("Or cash given: ", date, " $", amount);
  box.append(manual);

  const trouble = document.createElement("p");
  trouble.className = "cloud-said";
  const actions = document.createElement("div");
  actions.className = "migration-actions";
  const issue = document.createElement("button");
  issue.type = "button";
  issue.className = "primary";
  issue.textContent = "Issue the receipt";
  issue.addEventListener("click", () => {
    // Everything ticked, whether or not a search has since hidden it.
    const picked: Transaction[] = linesFor(entity).filter((t) => ticked.has(t.id));
    let total: Cents = 0;
    let when: IsoDate = manualDate;
    let year: number | undefined;
    if (picked.length > 0) {
      const years = new Set(picked.map((t) => taxYearOf(t.date)));
      if (years.size > 1) {
        trouble.textContent = "These gifts are from different tax years. Receipt each year on its own.";
        return;
      }
      total = picked.reduce((sum, t) => sum + t.amount, 0) as Cents;
      when = picked.map((t) => t.date).sort().at(-1) as IsoDate;
      if (picked.length > 1) year = [...years][0];
    } else {
      total = parseAmount(amount.value) ?? 0;
    }
    const signer = np?.signatory;
    const draft = { donor: donor.trim(), amount: total, signedBy: signer?.name ?? "" };
    const problems = receiptProblems(np, draft);
    if (picked.length === 0 && when === "") problems.push("Say when the cash was given.");
    if (problems.length > 0) {
      trouble.textContent = `Not issued: ${problems.join(" ")}`;
      return;
    }
    const receipt: DonationReceipt = {
      id: `d${Date.now().toString(36)}`,
      entityId: entity.id,
      number: nextReceiptNumber(receipts),
      date: when,
      amount: total,
      donor: donor.trim(),
      ...(address.trim() !== "" ? { address: address.trim() } : {}),
      ...(picked.length > 0 ? { transactionIds: picked.map((t) => t.id) } : {}),
      ...(year !== undefined ? { year } : {}),
      issued: today(),
      signedBy: signer?.name ?? "",
      designation: signer?.designation ?? "",
      ...(replacing !== null ? { replaces: replacing.id } : {}),
    };
    if (belowCreditMinimum(receipt.amount) && !confirm(
      "This is under $5, the smallest gift Inland Revenue gives a tax credit for. The donor cannot claim it. Issue the receipt anyway?",
    )) {
      return;
    }
    // Opened now, in the click, or a browser takes it for a pop-up it did not ask for.
    openReceipt(entity, receipt);
    donor = "";
    address = "";
    manualDate = "";
    manualAmount = "";
    finding = "";
    ticked.clear();
    replacing = null;
    void saveReceipts([...receipts, receipt], `Receipt ${receipt.number}: ${receipt.donor}, $${money(receipt.amount)}`);
  });
  const cancel = document.createElement("button");
  cancel.type = "button";
  cancel.textContent = replacing === null ? "Clear" : "Cancel";
  cancel.addEventListener("click", () => {
    donor = "";
    address = "";
    manualDate = "";
    manualAmount = "";
    finding = "";
    ticked.clear();
    replacing = null;
    redraw("donations");
  });
  actions.append(issue, cancel);
  box.append(
    actions,
    trouble,
    note(
      "Only gifts of money for which the donor gets nothing back qualify. Membership fees, raffle tickets, " +
        "purchases and gifts of goods are not donations and should not be receipted. A payment that is part " +
        "gift and part ticket is receipted for the gift alone.",
    ),
  );
  return box;
}

function table(entity: Entity, receipts: DonationReceipt[]): HTMLElement {
  const wrap = document.createElement("div");
  wrap.className = "table-scroll";
  const t = document.createElement("table");
  t.className = "report-table";
  t.innerHTML = "<thead><tr><th>Number</th><th>Date</th><th>Donor</th><th>Amount</th><th></th></tr></thead>";
  const body = document.createElement("tbody");
  for (const r of [...receipts].sort((a, b) => b.number.localeCompare(a.number))) {
    const tr = document.createElement("tr");
    const dateCell = nameCell(r.year !== undefined ? `Year to 31 Mar ${r.year}` : r.date);
    tr.append(
      nameCell(r.voided !== undefined ? `${r.number} (cancelled)` : r.number),
      dateCell,
      nameCell(r.donor),
      amountCell(money(r.amount)),
    );
    if (r.voided !== undefined) tr.className = "property-care-overdue";
    const actions = document.createElement("td");
    actions.className = "report-amount";
    const button = (label: string, act: () => void): void => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "link-button";
      b.textContent = label;
      b.addEventListener("click", act);
      actions.append(b, " ");
    };
    if (r.voided === undefined) {
      button("Print", () => openReceipt(entity, r));
      button("Copy", () => openReceipt(entity, r, { copy: true }));
      button("Cancel", () => {
        const why = prompt(
          `Cancel receipt ${r.number} for ${r.donor}?\n\nIt stays on the list marked cancelled, and its number is not reused. Why is it being cancelled?`,
        );
        if (why === null || why.trim() === "") return;
        const next = receipts.map((x) => (x.id === r.id ? { ...x, voided: { on: today(), why: why.trim() } } : x));
        void saveReceipts(next, `Receipt ${r.number} cancelled: ${why.trim()}`);
      });
    } else {
      const replaced = receipts.some((x) => x.replaces === r.id);
      button("View", () => openReceipt(entity, r));
      if (!replaced) {
        button("Issue a replacement", () => {
          replacing = r;
          donor = r.donor;
          address = r.address ?? "";
          ticked.clear();
          for (const id of r.transactionIds ?? []) ticked.add(id);
          if ((r.transactionIds ?? []).length === 0) {
            manualDate = r.date;
            manualAmount = (r.amount / 100).toFixed(2);
          }
          redraw("donations");
        });
      }
      actions.append(r.voided.why);
    }
    tr.append(actions);
    body.append(tr);
  }
  t.append(body);
  wrap.append(t);
  return wrap;
}

function summary(receipts: DonationReceipt[]): HTMLElement | null {
  const rows = donorYears(receipts, taxYearOf);
  if (rows.length === 0) return null;
  const years = [...new Set(rows.map((r) => r.year))].sort((a, b) => b - a);
  if (!years.includes(summaryYear)) summaryYear = years[0] ?? 0;
  const box = document.createElement("div");
  const pick = document.createElement("select");
  for (const y of years) {
    const option = document.createElement("option");
    option.value = String(y);
    option.textContent = `Year to ${taxYearEndSaid(y)}`;
    option.selected = y === summaryYear;
    pick.append(option);
  }
  pick.addEventListener("change", () => {
    summaryYear = Number(pick.value);
    redraw("donations");
  });
  const mine = rows.filter((r) => r.year === summaryYear);
  const t = document.createElement("table");
  t.className = "report-table";
  t.innerHTML = "<thead><tr><th>Donor</th><th>Receipts</th><th>Given</th></tr></thead>";
  const body = document.createElement("tbody");
  for (const r of mine) {
    const tr = document.createElement("tr");
    tr.append(nameCell(r.donor), amountCell(String(r.receipts)), amountCell(money(r.amount)));
    body.append(tr);
  }
  const sum = mine.reduce((s, r) => s + r.amount, 0);
  const foot = document.createElement("tr");
  foot.append(nameCell("Total"), amountCell(""), amountCell(money(sum)));
  body.append(foot);
  t.append(body);
  const wrap = document.createElement("div");
  wrap.className = "table-scroll";
  wrap.append(t);
  const save = document.createElement("button");
  save.type = "button";
  save.textContent = "Download (CSV)";
  save.addEventListener("click", () => {
    const text = [["Donor", "Receipts", "Total given"], ...mine.map((r) => [r.donor, String(r.receipts), (r.amount / 100).toFixed(2)])]
      .map((row) => row.map((cell) => spreadsheetCell(cell)).join(","))
      .join("\r\n");
    download(text, `donations-by-donor-${summaryYear}.csv`, "text/csv");
  });
  box.append(pick, wrap, save);
  return box;
}

export function renderDonationsPage(): void {
  const body = $("donations-body");
  body.textContent = "";
  const all = (state.ledger.entities ?? emptyEntityModel()).entities.filter((e) => e.kind === "nonprofit");
  if (all.length === 0) {
    body.append(note("No not-for-profit organisations. On Entities & accounts, add one: a charity, society or club."));
    return;
  }
  const ready = donees();
  if (ready.length === 0) {
    body.append(
      note(
        "Receipts can be issued only by an approved donee organisation, so that donors can claim a tax credit " +
          "for what they give. Mark an organisation as one under Entities & accounts, in its settings.",
      ),
    );
    return;
  }
  const fallback = ready.find((e) => e.id === state.entityFilter) ?? ready[0];
  const entity = ready.find((e) => e.id === chosen) ?? fallback;
  if (entity === undefined) return;
  chosen = entity.id;

  if (ready.length > 1) {
    const pick = document.createElement("select");
    for (const e of ready) {
      const option = document.createElement("option");
      option.value = e.id;
      option.textContent = e.name;
      option.selected = e.id === entity.id;
      pick.append(option);
    }
    pick.addEventListener("change", () => {
      chosen = pick.value;
      ticked.clear();
      redraw("donations");
    });
    body.append(pick);
  }

  const missing = organisationProblems(entity.nonprofit);
  if (missing.length > 0) {
    const list = document.createElement("ul");
    for (const m of missing) list.append(Object.assign(document.createElement("li"), { textContent: m }));
    const fix = document.createElement("button");
    fix.type = "button";
    fix.textContent = "Open the organisation's settings";
    fix.addEventListener("click", () => showPage("entities"));
    body.append(note("Before a receipt can be issued:"), list, fix);
  }

  const receipts = (state.ledger.donationReceipts ?? []).filter((r) => r.entityId === entity.id);
  if (missing.length === 0) body.append(issueForm(entity, state.ledger.donationReceipts ?? []));
  if (receipts.length > 0) {
    const h = document.createElement("h3");
    h.textContent = "Receipts issued";
    body.append(h, table(entity, receipts));
    const s = summary(receipts);
    if (s !== null) {
      const sh = document.createElement("h3");
      sh.textContent = "Given by each donor";
      body.append(sh, s);
    }
  }
  body.append(
    note(
      "Keep a copy of every receipt for seven years: they are kept here, and a receipt is cancelled and " +
        "replaced, never changed. A donor who gave $5 or more can claim one-third of it back as a tax credit.",
    ),
  );
}
