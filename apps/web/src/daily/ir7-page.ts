import { redraw } from "../app.js";
import { bookYears, postedJournals, record, saveEntities } from "../books.js";
import { $, state } from "../state.js";
import { savePart } from "../store.js";
import { amountCell, download, nameCell, note } from "../ui.js";
import {
  IR7_EXPENSE_PLACEMENTS,
  IR7_INCOME_CLASSES,
  accountEntityKey,
  defaultIr7ExpensePlacement,
  defaultIr7IncomeClass,
  emptyEntityModel,
  incomeAndExpenses,
  ir7AttributionRows,
  ir7Inputs,
  ir7Notes,
  ir7Rows,
  ir7Worksheet,
  parseAmount,
  spreadsheetCell,
} from "@nzosa/core";
import type { Account, Cents, Entity, Ir7ExpensePlacement, Ir7Holder, Ir7IncomeClass, Ir7Inputs, Ir7Kind } from "@nzosa/core";
import { taxYearEnd, taxYearEndSaid, taxYearStart } from "../tax-year.js";
import { booksLocale, moneyPlaces } from "../country.js";

/**
 * The IR7: a partnership or look-through company's income tax return, worked
 * out from the books, with each partner or owner's share on the attribution
 * page (IR7P or IR7L). See core's ir7.ts for what the guide says and what is
 * not covered. The shares come from the entity's owners (a partnership) or
 * shareholders (a look-through company), set under Entities & accounts.
 */

let chosen = "";
let chosenYear = 0;

const key = (entity: Entity, year: number): string => `${entity.id}:${year}`;

const kindOf = (e: Entity): Ir7Kind | null =>
  e.structure === "partnership" ? "partnership" : e.structure === "company" && e.lookThrough === true ? "ltc" : null;

function inputsFor(entity: Entity, year: number): Ir7Inputs {
  return ir7Inputs(state.ledger.ir7Returns?.[key(entity, year)]);
}

function money(cents: number): string {
  const text = (Math.abs(cents) / 100).toLocaleString(booksLocale(), {
    minimumFractionDigits: moneyPlaces(),
    maximumFractionDigits: moneyPlaces(),
  });
  return cents < 0 ? `-${text}` : text;
}

async function saveInputs(entity: Entity, year: number, next: Ir7Inputs, what: string): Promise<void> {
  const before = state.ledger.ir7Returns ?? {};
  const after = { ...before, [key(entity, year)]: next };
  state.ledger = { ...state.ledger, ir7Returns: after };
  state.persistent = await savePart(state.ledger);
  await record("ir7Return", what, before, after);
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

let section = 0;
function heading(text: string): HTMLElement {
  const h = document.createElement("h3");
  section += 1;
  h.textContent = `${section}. ${text}`;
  return h;
}

function wrapTable(table: HTMLElement): HTMLElement {
  const wrap = document.createElement("div");
  wrap.className = "table-scroll";
  wrap.append(table);
  return wrap;
}

function rowsTable(rows: { label: string; box: string; amount: number }[], strong: string[]): HTMLElement {
  const table = document.createElement("table");
  table.className = "report-table";
  table.innerHTML = "<thead><tr><th>Box</th><th></th><th>$</th></tr></thead>";
  const tbody = document.createElement("tbody");
  for (const r of rows) {
    const tr = document.createElement("tr");
    const label = nameCell(r.label);
    if (strong.includes(r.box)) label.style.fontWeight = "600";
    tr.append(nameCell(r.box), label, amountCell(money(r.amount)));
    tbody.append(tr);
  }
  table.append(tbody);
  return wrapTable(table);
}

export function renderIr7Page(): void {
  const body = $("ir7-body");
  body.textContent = "";
  section = 0;
  const model = state.ledger.entities ?? emptyEntityModel();
  const entities = model.entities.filter((e) => kindOf(e) !== null);
  if (entities.length === 0) {
    body.append(
      note(
        "No partnerships or look-through companies. On Entities & accounts, set a business's structure to Partnership, or to Company and tick \"Look-through company\".",
      ),
    );
    return;
  }
  const entity = entities.find((e) => e.id === chosen) ?? entities.find((e) => e.id === state.entityFilter) ?? entities[0];
  if (entity === undefined) return;
  chosen = entity.id;
  const kind = kindOf(entity) ?? "partnership";
  const years = bookYears();
  if (years.length === 0) {
    body.append(note("No transactions yet, so there is no year to report on."));
    return;
  }
  const today = new Date().toISOString().slice(0, 10);
  if (!years.includes(chosenYear)) chosenYear = years.filter((y) => taxYearEnd(y) < today)[0] ?? years[0] ?? 0;
  const year = chosenYear;

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
      redraw("ir7");
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
    redraw("ir7");
  });
  pick.append(when);
  body.append(pick);

  const patch = (change: (draft: Ir7Inputs) => void, what: string): void => {
    const next = structuredClone(inputsFor(entity, year));
    change(next);
    void saveInputs(entity, year, next, what);
    redraw("ir7");
  };
  const setScalar = (name: keyof Ir7Inputs, v: Cents | undefined, what: string): void =>
    patch((d) => {
      const target = d as unknown as Record<string, unknown>;
      if (v === undefined) delete target[name];
      else target[name] = v;
    }, what);

  const inputs = inputsFor(entity, year);
  const owned = (accountKey: string): boolean => {
    const holder = model.accounts[accountKey];
    return holder === entity.id || (holder === undefined && model.entities.length <= 1);
  };
  const only = (account: Account): boolean => {
    const bank = (account.ledgerAccount ?? "").trim();
    if (bank !== "") return (model.banks[bank] ?? []).includes(entity.id) || (model.banks[bank] === undefined && model.entities.length <= 1);
    return owned(accountEntityKey(account));
  };
  const from = taxYearStart(year);
  const to = taxYearEnd(year);
  const { income, expenses } = incomeAndExpenses({ journals: postedJournals(), chart: state.chart, from, to, only });

  const people = kind === "ltc" ? (entity.shareholders ?? []) : (entity.owners ?? []);
  const holders: Ir7Holder[] = people.map((p) => ({
    id: p.name,
    name: p.name,
    percent: p.percent,
    irdNumber: entity.holderIrd?.[p.name],
    from: inputs.periods?.[p.name]?.from,
    to: inputs.periods?.[p.name]?.to,
  }));
  const sheet = ir7Worksheet({ income, expenses, holders, inputs, kind, period: { from, to } });

  // 1. Does it have to file?
  body.append(heading("Does it have to file?"));
  body.append(
    note(
      sheet.nil
        ? "Nothing was earned and nothing was spent in this year. A nil return is enough: answer the questions down to 9, then sign the declaration."
        : "Every partnership and look-through company files an IR7 each year, whether or not it was active. It pays no income tax itself: the income goes to the " +
            (kind === "ltc" ? "owners" : "partners") +
            ".",
    ),
  );
  for (const line of ir7Notes(kind)) body.append(note(line));

  // 2. Income
  body.append(heading("What was earned"));
  body.append(note("Say what each income account is. Capital put in, loans and GST are not income. Each kind goes in a box of its own on the form."));
  const incomeTable = document.createElement("table");
  incomeTable.className = "report-table";
  incomeTable.innerHTML = "<thead><tr><th>Account</th><th>For the year</th><th>It is</th></tr></thead>";
  const ibody = document.createElement("tbody");
  for (const a of income) {
    const tr = document.createElement("tr");
    const select = document.createElement("select");
    const held = inputs.classes[a.code] ?? defaultIr7IncomeClass(a);
    for (const [value, label] of IR7_INCOME_CLASSES) {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = label;
      option.selected = value === held;
      select.append(option);
    }
    select.addEventListener("change", () =>
      patch((d) => {
        if (select.value === defaultIr7IncomeClass(a)) delete d.classes[a.code];
        else d.classes[a.code] = select.value as Ir7IncomeClass;
      }, `IR7: ${a.name}`),
    );
    const cell = document.createElement("td");
    cell.append(select);
    tr.append(nameCell(`${a.code} ${a.name}`), amountCell(money(a.amount)), cell);
    ibody.append(tr);
  }
  incomeTable.append(ibody);
  body.append(income.length === 0 ? note("Nothing earned in this year.") : wrapTable(incomeTable));

  // 3. Expenses
  body.append(heading("What it cost"));
  body.append(
    note(
      "Costs of earning business or rental income come off that income. Residential rental deductions are kept apart and shared out: each partner or owner applies the ring-fencing rules to their own residential income. " +
        "Drawings and a partner's salary are not deductible.",
    ),
  );
  const costTable = document.createElement("table");
  costTable.className = "report-table";
  costTable.innerHTML = "<thead><tr><th>Account</th><th>For the year</th><th>It is</th></tr></thead>";
  const cbody = document.createElement("tbody");
  for (const a of expenses) {
    const tr = document.createElement("tr");
    const select = document.createElement("select");
    const held = inputs.placements[a.code] ?? defaultIr7ExpensePlacement(a);
    for (const [value, label] of IR7_EXPENSE_PLACEMENTS) {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = label;
      option.selected = value === held;
      select.append(option);
    }
    select.addEventListener("change", () =>
      patch((d) => {
        if (select.value === defaultIr7ExpensePlacement(a)) delete d.placements[a.code];
        else d.placements[a.code] = select.value as Ir7ExpensePlacement;
      }, `IR7: ${a.name}`),
    );
    const cell = document.createElement("td");
    cell.append(select);
    tr.append(nameCell(`${a.code} ${a.name}`), amountCell(money(a.amount)), cell);
    cbody.append(tr);
  }
  costTable.append(cbody);
  body.append(expenses.length === 0 ? note("No costs in this year.") : wrapTable(costTable));

  // 4. Other figures
  body.append(heading("Other figures the return asks"));
  const field = (label: string, name: keyof Ir7Inputs, what: string): HTMLLabelElement => {
    const wrap = document.createElement("label");
    wrap.className = "year-end-field";
    wrap.append(`${label} `, dollarsBox(inputs[name] as Cents | undefined, (v) => setScalar(name, v, `IR7: ${what}`)));
    return wrap;
  };
  body.append(
    tick("The books record interest and dividends before tax (the credits below are already in them)", inputs.grossBooks === true, (v) =>
      patch((d) => {
        if (v) d.grossBooks = true;
        else delete d.grossBooks;
      }, "IR7: books gross"),
    ),
    field("Tax deducted from schedular payments $", "schedularTax", "schedular tax"),
    field("Tax withheld from interest (RWT) $", "rwtInterest", "RWT on interest"),
    field("Dividend imputation credits $", "imputation", "imputation credits"),
    field("RWT on dividends $", "rwtDividends", "RWT on dividends"),
    field("Taxable Māori authority distributions $", "maori", "Māori authority"),
    field("Māori authority credits $", "maoriCredits", "Māori authority credits"),
    field("Income from another partnership $", "partnership", "partnership income"),
    field("Credits from another partnership $", "partnershipCredits", "partnership credits"),
    field("Income from another look-through company (adjusted) $", "ltc", "LTC income"),
    field("Credits from another look-through company $", "ltcCredits", "LTC credits"),
    field("Tax paid overseas $", "overseasTax", "overseas tax"),
    field("Net bright-line profit $", "brightLine", "bright-line profit"),
    field("Other residential income $", "otherResidential", "other residential income"),
    field("Taxable property sales, profit or loss $", "propertySales", "property sales"),
    field("Residential land withholding tax credit $", "rlwt", "RLWT credit"),
    field("Losses extinguished on moving from a qualifying company $", "extinguished", "extinguished losses"),
    field("Deductions already claimed for them in earlier years $", "extinguishedClaimed", "extinguished losses claimed"),
  );

  // 5. Partners or owners
  const who = kind === "ltc" ? "Owners" : "Partners";
  body.append(heading(who));
  body.append(
    note(
      kind === "ltc"
        ? "An owner's share is their effective look-through interest, generally their percentage of the shares. Set the shareholders and their shares in the entity's settings under Entities & accounts."
        : "Set the partners and their shares in the entity's settings under Entities & accounts. Shares must add up to 100%.",
    ),
  );
  if (holders.length > 0) {
    const t = document.createElement("table");
    t.className = "report-table";
    t.innerHTML = `<thead><tr><th>${kind === "ltc" ? "Owner" : "Partner"}</th><th>Share</th><th>IRD number</th><th>Held from</th><th>Held until</th></tr></thead>`;
    const tb = document.createElement("tbody");
    for (const h of holders) {
      const tr = document.createElement("tr");
      const input = document.createElement("input");
      input.type = "text";
      input.value = h.irdNumber ?? "";
      input.placeholder = "IRD number";
      input.addEventListener("change", () => {
        const live = state.ledger.entities ?? emptyEntityModel();
        void saveEntities(
          {
            ...live,
            entities: live.entities.map((e) => {
              if (e.id !== entity.id) return e;
              const held = { ...(e.holderIrd ?? {}) };
              if (input.value.trim() === "") delete held[h.name];
              else held[h.name] = input.value.trim();
              const { holderIrd: _gone, ...rest } = e;
              return Object.keys(held).length > 0 ? { ...rest, holderIrd: held } : rest;
            }),
          },
          `${entity.name}: IRD number of ${h.name}`,
        ).then(() => redraw("ir7"));
      });
      const cell = document.createElement("td");
      cell.append(input);
      const dateCell = (which: "from" | "to"): HTMLTableCellElement => {
        const d = document.createElement("input");
        d.type = "date";
        d.value = (which === "from" ? h.from : h.to) ?? "";
        d.title = which === "from" ? "Leave empty if held from the start of the year" : "Leave empty if held to the end of the year";
        d.addEventListener("change", () =>
          patch((draft) => {
            const all = { ...(draft.periods ?? {}) };
            const mine = { ...(all[h.name] ?? {}) };
            if (d.value === "") delete mine[which];
            else mine[which] = d.value;
            if (mine.from === undefined && mine.to === undefined) delete all[h.name];
            else all[h.name] = mine;
            if (Object.keys(all).length === 0) delete draft.periods;
            else draft.periods = all;
          }, `IR7: ${h.name} held ${which}`),
        );
        const td = document.createElement("td");
        td.append(d);
        return td;
      };
      const shown = sheet.attributions.find((a) => a.id === h.id);
      tr.append(nameCell(h.name), amountCell(shown !== undefined && shown.percent !== h.percent ? `${h.percent}% (${shown.percent}% of the year)` : `${h.percent}%`), cell, dateCell("from"), dateCell("to"));
      tb.append(tr);
    }
    t.append(tb);
    body.append(wrapTable(t));
  }
  for (const problem of sheet.problems) {
    const p = note(problem);
    p.style.color = "var(--warn, #b45309)";
    body.append(p);
  }

  // 6. The return
  body.append(heading("The return"));
  const rows = ir7Rows(sheet).filter((r) => r.amount !== 0 || ["22", "24"].includes(r.box));
  body.append(rowsTable(rows, ["22", "24", "25B"]));

  // 7. Attribution pages
  if (holders.length > 0) {
    body.append(heading(kind === "ltc" ? "Each owner's page (IR7L)" : "Each partner's page (IR7P)"));
    body.append(
      note(
        "The totals at box 26K for everyone must equal box 24 on the return. Each person includes their share in their own return: income at the questions for partnership or look-through income, and the credits with it.",
      ),
    );
    for (const a of sheet.attributions) {
      const d = document.createElement("details");
      const sum = document.createElement("summary");
      sum.textContent = `${a.name} · ${a.percent}%${a.irdNumber !== "" ? ` · ${a.irdNumber}` : ""} · total $${money(a.total)}`;
      d.append(sum, rowsTable(ir7AttributionRows(a), ["26K"]));
      body.append(d);
    }
  }

  const save = document.createElement("button");
  save.type = "button";
  save.textContent = "Download the worksheet (CSV)";
  save.addEventListener("click", () => {
    const lines: string[][] = [["Page", "Box", "What", "Amount"]];
    for (const r of ir7Rows(sheet)) lines.push(["IR7", r.box, r.label, (r.amount / 100).toFixed(2)]);
    for (const a of sheet.attributions) {
      for (const r of ir7AttributionRows(a)) lines.push([`${kind === "ltc" ? "IR7L" : "IR7P"} ${a.name}`, r.box, r.label, (r.amount / 100).toFixed(2)]);
    }
    const text = lines.map((row) => row.map((cell) => spreadsheetCell(cell)).join(",")).join("\r\n");
    download(text, `ir7-worksheet-${year}.csv`, "text/csv");
  });
  body.append(save);

  body.append(
    note(
      "The box numbers are those of the IR7 for the year to 31 March 2026; Inland Revenue renumbers them from year to year, so check each against that year's form. " +
        "Not worked out here: the loss limitation rule for LTCs in a partnership or joint venture with another LTC, foreign investment fund and controlled foreign company income (enter the figure), " +
        "the attribution rule for personal services, and income a partnership agreement shares differently by kind. Attach the accounts or an IR10; the IR10 financial statement is under Reports.",
    ),
  );
}
