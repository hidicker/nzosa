import { redraw } from "../app.js";
import { bookYears, postedJournals, record } from "../books.js";
import { $, state } from "../state.js";
import { savePart } from "../store.js";
import { amountCell, download, nameCell, note } from "../ui.js";
import {
  IR9_CLASSES,
  accountEntityKey,
  defaultIr9Class,
  emptyEntityModel,
  emptyIr9Inputs,
  incomeAndExpenses,
  ir9Rows,
  ir9Worksheet,
  parseAmount,
  spreadsheetCell,
} from "@nzosa/core";
import type { Cents, Entity, Ir9Class, Ir9Inputs } from "@nzosa/core";
import { taxYearEnd, taxYearEndSaid, taxYearStart } from "../tax-year.js";
import { booksLocale, moneyPlaces } from "../country.js";

/**
 * The IR9: a club or society's income tax return, worked out from the books in
 * the order of the form, with each choice that is the organisation's to make
 * shown beside the figures it affects. See core's ir9.ts for what the guide
 * says and what is and is not covered.
 */

let chosen = "";
let chosenYear = 0;

function key(entity: Entity, year: number): string {
  return `${entity.id}:${year}`;
}

function inputsFor(entity: Entity, year: number): Ir9Inputs {
  return state.ledger.ir9Returns?.[key(entity, year)] ?? emptyIr9Inputs();
}

function money(cents: number): string {
  const text = (Math.abs(cents) / 100).toLocaleString(booksLocale(), {
    minimumFractionDigits: moneyPlaces(),
    maximumFractionDigits: moneyPlaces(),
  });
  return cents < 0 ? `-${text}` : text;
}

async function saveInputs(entity: Entity, year: number, next: Ir9Inputs, what: string): Promise<void> {
  const before = state.ledger.ir9Returns ?? {};
  const after = { ...before, [key(entity, year)]: next };
  state.ledger = { ...state.ledger, ir9Returns: after };
  state.persistent = await savePart(state.ledger);
  await record("ir9", what, before, after);
}

function tick(label: string, checked: boolean, onChange: (value: boolean) => void): HTMLLabelElement {
  const wrap = document.createElement("label");
  wrap.className = "feed-auto";
  const box = document.createElement("input");
  box.type = "checkbox";
  box.checked = checked;
  box.addEventListener("change", () => onChange(box.checked));
  wrap.append(box, ` ${label}`);
  return wrap;
}

function dollarsBox(cents: number | undefined, onChange: (c: Cents | undefined) => void): HTMLInputElement {
  const box = document.createElement("input");
  box.type = "text";
  box.className = "payroll-tiny-input";
  box.placeholder = "0.00";
  box.value = cents === undefined || cents === 0 ? "" : (cents / 100).toFixed(2);
  box.addEventListener("change", () => {
    const parsed = parseAmount(box.value);
    onChange(parsed === null || parsed === 0 ? undefined : (parsed as Cents));
  });
  return box;
}

function heading(text: string): HTMLElement {
  const h = document.createElement("h3");
  h.textContent = text;
  return h;
}

export function renderIr9Page(): void {
  const body = $("ir9-body");
  body.textContent = "";
  const model = state.ledger.entities ?? emptyEntityModel();
  const entities = model.entities.filter((e) => e.kind === "nonprofit");
  if (entities.length === 0) {
    body.append(note("No not-for-profit organisations. On Entities & accounts, add one: a charity, society or club."));
    return;
  }
  const entity = entities.find((e) => e.id === chosen) ?? entities.find((e) => e.id === state.entityFilter) ?? entities[0];
  if (entity === undefined) return;
  chosen = entity.id;
  const years = bookYears();
  if (years.length === 0) {
    body.append(note("No transactions yet, so there is no year to report on."));
    return;
  }
  const today = new Date().toISOString().slice(0, 10);
  if (!years.includes(chosenYear)) chosenYear = years.filter((y) => taxYearEnd(y) < today)[0] ?? years[0] ?? 0;
  const year = chosenYear;
  const np = entity.nonprofit;

  const pick = document.createElement("div");
  pick.className = "page-actions";
  if (entities.length > 1) {
    const who = document.createElement("select");
    for (const e of entities) {
      const option = document.createElement("option");
      option.value = e.id;
      option.textContent = e.name;
      option.selected = e.id === entity.id;
      who.append(option);
    }
    who.addEventListener("change", () => {
      chosen = who.value;
      redraw("ir9");
    });
    pick.append(who);
  }
  const when = document.createElement("select");
  for (const y of years) {
    const option = document.createElement("option");
    option.value = String(y);
    option.textContent = `Year ended ${taxYearEndSaid(y)}`;
    option.selected = y === year;
    when.append(option);
  }
  when.addEventListener("change", () => {
    chosenYear = Number(when.value);
    redraw("ir9");
  });
  pick.append(when);
  body.append(pick);

  if (np?.registeredCharity === true) {
    body.append(
      note(
        "A registered charity's income is generally exempt, and Inland Revenue says it does not need to be asked to confirm " +
          "that. Whether a charity with only exempt income files a return at all is for Inland Revenue to say: ask them before " +
          "relying on this page. It is for clubs and societies that are not charities.",
      ),
    );
  }

  // What is stored now: a field changed without a redraw must not undo another.
  const patch = (change: { [K in keyof Ir9Inputs]?: Ir9Inputs[K] | undefined }, what: string): void => {
    const next = { ...inputsFor(entity, year) } as unknown as Record<string, unknown>;
    for (const [k, v] of Object.entries(change)) {
      if (v === undefined) delete next[k];
      else next[k] = v;
    }
    void saveInputs(entity, year, next as unknown as Ir9Inputs, what);
    redraw("ir9");
  };

  const stored = inputsFor(entity, year);
  // Starting answers from the organisation's own settings, each of which can be changed here.
  const inputs: Ir9Inputs = {
    ...stored,
    incorporated: stored.incorporated ?? np?.form === "society",
    donationsAllowed: stored.donationsAllowed ?? np?.form === "society",
    deductionApproved: stored.deductionApproved ?? np?.deduction === true,
  };

  const owned = (accountKey: string): boolean => {
    const holder = model.accounts[accountKey];
    return holder === entity.id || (holder === undefined && model.entities.length <= 1);
  };
  const { income, expenses } = incomeAndExpenses({
    journals: postedJournals(),
    chart: state.chart,
    from: taxYearStart(year),
    to: taxYearEnd(year),
    only: (account) => owned(accountEntityKey(account)),
  });
  const sheet = ir9Worksheet({ income, expenses, inputs });

  // 1. Who files
  body.append(heading("1. Does it have to file?"));
  body.append(
    note(
      "Every club and society files a return unless all its income is exempt. An amateur sports club, racing club, charitable " +
        "society, district improvement society, veterinary services promoter, scientific or industrial research promoter or herd " +
        "improvement promoter has exempt income, as long as none of its funds can be used for the private benefit of members.",
    ),
    tick("It is one of those kinds of organisation", inputs.exemptKind === true, (v) => patch({ exemptKind: v }, "IR9: kind of organisation")),
  );
  if (inputs.exemptKind === true) {
    body.append(
      tick("Some of its funds can be used for the private benefit of members", inputs.privateBenefit === true, (v) =>
        patch({ privateBenefit: v }, "IR9: private benefit"),
      ),
    );
  }
  if (sheet.exempt) {
    const card = document.createElement("div");
    card.className = "journal-card";
    card.append(note(sheet.exemptReason));
    body.append(card);
    return;
  }

  // 2. Income
  body.append(heading("2. What was earned"));
  body.append(
    note(
      "Only net profit from revenue sources is taxed: interest, dividends, rents, sponsorship and admission fees, advertising, and " +
        "trading. Membership subscriptions and levies are not income, and neither is a gift. Say what each account is.",
    ),
  );
  const incomeTable = document.createElement("table");
  incomeTable.className = "report-table";
  incomeTable.innerHTML = "<thead><tr><th>Account</th><th>For the year</th><th>It is</th></tr></thead>";
  const ibody = document.createElement("tbody");
  for (const a of income) {
    const tr = document.createElement("tr");
    const select = document.createElement("select");
    const held = inputs.classes[a.code] ?? defaultIr9Class(a);
    for (const [value, label] of IR9_CLASSES) {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = label;
      option.selected = value === held;
      select.append(option);
    }
    select.addEventListener("change", () => {
      const classes = { ...inputsFor(entity, year).classes };
      if (select.value === defaultIr9Class(a)) delete classes[a.code];
      else classes[a.code] = select.value as Ir9Class;
      patch({ classes }, `IR9: ${a.name}`);
    });
    const cell = document.createElement("td");
    cell.append(select);
    tr.append(nameCell(`${a.code} ${a.name}`), amountCell(money(a.amount)), cell);
    ibody.append(tr);
  }
  incomeTable.append(ibody);
  const iwrap = document.createElement("div");
  iwrap.className = "table-scroll";
  iwrap.append(income.length === 0 ? note("Nothing earned in this year.") : incomeTable);
  body.append(iwrap);

  // 3. Costs
  body.append(heading("3. The costs of earning it"));
  body.append(
    note(
      "Deduct only what went on earning the taxable income above: for hall hire, the share of the hall's running costs it accounts for. " +
        "Give each account the share, from 0 to 100, that was spent earning taxable income.",
    ),
  );
  const costTable = document.createElement("table");
  costTable.className = "report-table";
  costTable.innerHTML = "<thead><tr><th>Account</th><th>For the year</th><th>Share used earning taxable income, %</th></tr></thead>";
  const cbody = document.createElement("tbody");
  for (const a of expenses) {
    const tr = document.createElement("tr");
    const share = document.createElement("input");
    share.type = "text";
    share.className = "payroll-tiny-input";
    share.placeholder = "0";
    share.value = inputs.shares[a.code] === undefined || inputs.shares[a.code] === 0 ? "" : String(inputs.shares[a.code]);
    share.addEventListener("change", () => {
      const parsed = Number(share.value.replace(/[^0-9.]/g, ""));
      const shares = { ...inputsFor(entity, year).shares };
      if (!Number.isFinite(parsed) || parsed <= 0) delete shares[a.code];
      else shares[a.code] = Math.min(100, parsed);
      patch({ shares }, `IR9: share of ${a.name}`);
    });
    const cell = document.createElement("td");
    cell.append(share);
    tr.append(nameCell(`${a.code} ${a.name}`), amountCell(money(a.amount)), cell);
    cbody.append(tr);
  }
  costTable.append(cbody);
  const cwrap = document.createElement("div");
  cwrap.className = "table-scroll";
  cwrap.append(expenses.length === 0 ? note("No costs in this year.") : costTable);
  body.append(cwrap);

  // 4. The rest
  body.append(heading("4. Other things the return asks"));
  const field = (label: string, control: HTMLElement): HTMLLabelElement => {
    const wrap = document.createElement("label");
    wrap.className = "year-end-field";
    wrap.append(`${label} `, control);
    return wrap;
  };
  body.append(
    tick("Incorporated (taxed at 28%); unticked, assessed at individual rates", inputs.incorporated === true, (v) =>
      patch({ incorporated: v }, "IR9: incorporated"),
    ),
    tick("Inland Revenue has approved it as a not-for-profit (the $1,000 deduction)", inputs.deductionApproved === true, (v) =>
      patch({ deductionApproved: v }, "IR9: approved not-for-profit"),
    ),
    tick(
      "Registered under the Incorporated Societies Act, or a friendly or building society (donations can be deducted)",
      inputs.donationsAllowed === true,
      (v) => patch({ donationsAllowed: v }, "IR9: donations deduction"),
    ),
  );
  if (inputs.donationsAllowed === true) {
    body.append(field("Donations made to donee organisations $", dollarsBox(inputs.donations, (v) => patch({ donations: v }, "IR9: donations made"))));
  }
  body.append(
    field("Taxable Māori authority distributions received $", dollarsBox(inputs.maoriAuthority, (v) => patch({ maoriAuthority: v }, "IR9: Māori authority"))),
    field("Net losses brought forward $", dollarsBox(inputs.lossBroughtForward, (v) => patch({ lossBroughtForward: v }, "IR9: losses brought forward"))),
    field("Resident withholding tax already deducted $", dollarsBox(inputs.rwt, (v) => patch({ rwt: v }, "IR9: RWT"))),
    field("Imputation credits from dividends $", dollarsBox(inputs.imputationCredits, (v) => patch({ imputationCredits: v }, "IR9: imputation credits"))),
  );

  // 5. The return
  body.append(heading("5. The return"));
  const table = document.createElement("table");
  table.className = "report-table";
  table.innerHTML = "<thead><tr><th>Box</th><th></th><th>$</th></tr></thead>";
  const tbody = document.createElement("tbody");
  const rows = ir9Rows(sheet);
  for (const r of rows) {
    const tr = document.createElement("tr");
    const strong = ["14D", "17", "19"].includes(r.box);
    const label = nameCell(r.label);
    if (strong) label.style.fontWeight = "600";
    tr.append(nameCell(r.box), label, amountCell(money(r.amount)));
    tbody.append(tr);
  }
  if (sheet.tax !== null) {
    const tax = document.createElement("tr");
    tax.append(nameCell("20"), nameCell("Tax on taxable income, at 28%"), amountCell(money(sheet.tax)));
    tbody.append(tax);
    if (sheet.credits > 0) {
      const credits = document.createElement("tr");
      credits.append(nameCell(""), nameCell("Less tax already deducted or credited"), amountCell(money(sheet.credits)));
      tbody.append(credits);
    }
    const pay = document.createElement("tr");
    const payLabel = nameCell("Tax to pay (or refund, if negative)");
    payLabel.style.fontWeight = "600";
    pay.append(nameCell(""), payLabel, amountCell(money(sheet.toPay ?? 0)));
    tbody.append(pay);
  }
  table.append(tbody);
  const wrap = document.createElement("div");
  wrap.className = "table-scroll";
  wrap.append(table);
  body.append(wrap);
  body.append(note(sheet.taxNote));
  if (sheet.box.taxableIncome < 0) {
    body.append(note(`A loss of $${money(-sheet.box.taxableIncome)} is carried forward to next year.`));
  }

  const save = document.createElement("button");
  save.type = "button";
  save.textContent = "Download the worksheet (CSV)";
  save.addEventListener("click", () => {
    const lines = [["Box", "What", "Amount"], ...rows.map((r) => [r.box, r.label, (r.amount / 100).toFixed(2)])];
    const text = lines.map((row) => row.map((cell) => spreadsheetCell(cell)).join(",")).join("\r\n");
    download(text, `ir9-worksheet-${year}.csv`, "text/csv");
  });
  body.append(save);

  body.append(
    note(
      "The box numbers are those of the IR9 for the year to 31 March 2026; Inland Revenue renumbers them from year to year, so " +
        "check each against that year's form. This does not cover residential rental property (the form's question 10) or " +
        "provisional tax. Return due 7 July for a 31 March balance date, later with an agent. The figures go into myIR. " +
        "An incorporated society must also file its financial statements with the Companies Office.",
    ),
  );
}
