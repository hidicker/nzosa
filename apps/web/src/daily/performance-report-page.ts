import { redraw } from "../app.js";
import { bookYears, postedJournals, record } from "../books.js";
import { $, state } from "../state.js";
import { savePart } from "../store.js";
import { amountCell, download, nameCell, note } from "../ui.js";
import {
  TIER4_CHOICES,
  TIER4_OTHER_PAID,
  TIER4_OTHER_RECEIVED,
  TIER4_PAID,
  TIER4_RECEIVED,
  cashStatement,
  statementFromFigures,
  defaultTier4Line,
  emptyEntityModel,
  emptyInputs,
  grantOpen,
  grantPosition,
  nonProfitFormName,
  parseAmount,
  performanceReportHtml,
  reportProblems,
  spreadsheetCell,
  accountEntityKey,
} from "@nzosa/core";
import type { Cents, CashAccounts, Entity, PerformanceInputs, PreviousFigures, Tier4Line } from "@nzosa/core";
import { taxYearEnd, taxYearEndSaid, taxYearOf, taxYearStart } from "../tax-year.js";
import { linesFor } from "./grants-page.js";

/**
 * The yearly Performance Report for a charity or society reporting on a cash
 * basis under the Tier 4 (NFP) Standard: the figures worked out from the books,
 * and what only the organisation can say -- what it did, who is related to
 * whom, who approved it -- typed in beside them. See core's tier4-report.ts for
 * how each part follows the standard.
 */

let chosen = "";
let chosenYear = 0;

function key(entity: Entity, year: number): string {
  return `${entity.id}:${year}`;
}

export function inputsFor(entity: Entity, year: number): PerformanceInputs {
  return state.ledger.performanceReports?.[key(entity, year)] ?? emptyInputs();
}

async function saveInputs(entity: Entity, year: number, next: PerformanceInputs, what: string): Promise<void> {
  const before = state.ledger.performanceReports ?? {};
  const after = { ...before, [key(entity, year)]: next };
  state.ledger = { ...state.ledger, performanceReports: after };
  state.persistent = await savePart(state.ledger);
  await record("performanceReport", what, before, after);
}

/** The bank accounts and cash tins this organisation uses. */
function cashAccountsOf(entity: Entity): CashAccounts {
  const model = state.ledger.entities ?? emptyEntityModel();
  const ids = [...new Set(linesFor(entity).map((t) => t.account))];
  const owned = ids.filter((id) => {
    const list = model.banks[id] ?? [];
    return list.length === 0 ? model.entities.length <= 1 : list.includes(entity.id);
  });
  const labelOf = (id: string): string => {
    const named = state.ledger.transactions.find((t) => t.account === id)?.extras?.["accountLabel"];
    return typeof named === "string" && named !== "" ? named : id;
  };
  const cashCodes = state.chart
    .filter((a) => /petty cash|cash on hand|cash float/i.test(a.name) && a.code.trim() !== "")
    .filter((a) => {
      const holder = model.accounts[accountEntityKey(a)];
      return holder === undefined || holder === entity.id;
    })
    .map((a) => a.code.trim());
  return { banks: owned.map((id) => ({ id, label: labelOf(id) })), cashCodes };
}

export function statementFor(entity: Entity, year: number) {
  return cashStatement({
    journals: postedJournals(),
    chart: state.chart,
    accounts: cashAccountsOf(entity),
    opening: state.ledger.openingBalances,
    year,
    from: taxYearStart(year),
    to: taxYearEnd(year),
    mapping: state.ledger.tier4Lines ?? {},
  });
}

export function legalFormOf(entity: Entity): string {
  const np = entity.nonprofit;
  if (np === undefined) return "Not-for-profit organisation";
  const form = nonProfitFormName(np.form);
  return np.registeredCharity === true && np.form !== "charity" && np.form !== "charitable-trust"
    ? `${form}, registered charity`
    : form;
}

function textArea(value: string, rows: number, placeholder: string, onChange: (v: string) => void): HTMLTextAreaElement {
  const box = document.createElement("textarea");
  box.rows = rows;
  box.value = value;
  box.placeholder = placeholder;
  box.addEventListener("change", () => onChange(box.value));
  return box;
}

function heading(text: string): HTMLElement {
  const h = document.createElement("h3");
  h.textContent = text;
  return h;
}

function dollarsInput(cents: number | undefined, onChange: (c: Cents | undefined) => void): HTMLInputElement {
  const box = document.createElement("input");
  box.type = "text";
  box.className = "payroll-tiny-input";
  box.placeholder = "0";
  box.value = cents === undefined || cents === 0 ? "" : (cents / 100).toFixed(2);
  box.addEventListener("change", () => {
    const parsed = parseAmount(box.value);
    onChange(parsed === null || parsed === 0 ? undefined : (parsed as Cents));
  });
  return box;
}

export function renderPerformancePage(): void {
  const body = $("performance-body");
  body.textContent = "";
  const entities = (state.ledger.entities ?? emptyEntityModel()).entities.filter((e) => e.kind === "nonprofit");
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
      redraw("performance");
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
    redraw("performance");
  });
  pick.append(when);
  body.append(pick);

  const np = entity.nonprofit;
  if (np?.registeredCharity !== true && np?.form !== "society" && np?.form !== "charitable-trust" && np?.form !== "club") {
    body.append(note("Set up this organisation's details under Entities & accounts first."));
  }
  if (np?.form === "club" && np.registeredCharity !== true) {
    body.append(
      note(
        "A club that is not a registered charity or an incorporated society has no performance report to file with " +
          "Charities Services or the Companies Office; it files an IR9 with Inland Revenue. This report can still be " +
          "used as its annual accounts if the committee wants one.",
      ),
    );
  }

  const statement = statementFor(entity, year);
  const inputs = inputsFor(entity, year);
  const fromBooks = statementFor(entity, year - 1);
  // Last year from the books where they can say; otherwise as last year's
  // report printed it, typed in below.
  const previous = fromBooks.reconciles
    ? fromBooks
    : statementFromFigures(year - 1, taxYearStart(year - 1), taxYearEnd(year - 1), inputs.previousFigures ?? {});
  // Applied to what is stored now, not to what was on screen when the page was
  // drawn: a field changed without a redraw must not undo another one.
  const patch = (change: { [K in keyof PerformanceInputs]?: PerformanceInputs[K] | undefined }, what: string): void => {
    const next = { ...inputsFor(entity, year) } as unknown as Record<string, unknown>;
    for (const [k, v] of Object.entries(change)) {
      if (v === undefined) delete next[k];
      else next[k] = v;
    }
    void saveInputs(entity, year, next as unknown as PerformanceInputs, what);
  };

  const problems = reportProblems({ entity: { name: entity.name, legalForm: legalFormOf(entity) }, inputs, statement, previous });
  if (statement.dollars.paidTotal >= 140_000) {
    problems.unshift(
      "Operating payments reach $140,000, the limit for the Tier 4 standard. A larger organisation reports under Tier 3 or above: ask your accountant before using this report.",
    );
  }
  const status = document.createElement("div");
  status.className = problems.length > 0 ? "journal-card journal-broken" : "journal-card";
  const verdict = document.createElement("p");
  verdict.className = "journal-narration";
  verdict.textContent = problems.length > 0 ? "Before this report is ready:" : "Ready to print, sign and file.";
  status.append(verdict);
  if (problems.length > 0) {
    const list = document.createElement("ul");
    for (const p of problems) list.append(Object.assign(document.createElement("li"), { textContent: p }));
    status.append(list);
  }
  const open = document.createElement("button");
  open.type = "button";
  open.className = "primary";
  open.textContent = "Open the report to print or save as PDF";
  open.addEventListener("click", () => {
    // What is stored now: fields may have been changed since the page was drawn.
    const now = inputsFor(entity, year);
    const html = performanceReportHtml({
      entity: { name: entity.name, legalForm: legalFormOf(entity), address: entity.address },
      gstRegistered: entity.gstRegistered === true,
      statement,
      previous: fromBooks.reconciles
        ? fromBooks
        : statementFromFigures(year - 1, taxYearStart(year - 1), taxYearEnd(year - 1), now.previousFigures ?? {}),
      inputs: now,
      previousInputs: inputsFor(entity, year - 1),
    });
    const url = URL.createObjectURL(new Blob([html], { type: "text/html" }));
    window.open(url, "_blank");
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  });
  status.append(open);
  body.append(status);

  // 1. Entity Information
  body.append(heading("1. Entity information"));
  const names = document.createElement("input");
  names.type = "text";
  names.placeholder = "Any other names it trades under (optional)";
  names.value = inputs.tradingNames ?? "";
  names.addEventListener("change", () => patch({ tradingNames: names.value }, "Trading names"));
  body.append(note(`${entity.name}, ${legalFormOf(entity)}.`), names);

  // 2. Statement of Service Performance
  body.append(heading("2. What the organisation did: statement of service performance"));
  body.append(note("The main activities of the year, and how much of each, as far as you can say: sessions held, people helped, events run, meals served."));
  const rows = [...inputs.activities, { what: "", howMuch: "" }];
  const table = document.createElement("table");
  table.className = "report-table";
  table.innerHTML = "<thead><tr><th>What we did</th><th>How much</th></tr></thead>";
  const tbody = document.createElement("tbody");
  rows.forEach((row, i) => {
    const tr = document.createElement("tr");
    const what = document.createElement("input");
    what.type = "text";
    what.value = row.what;
    what.placeholder = i === rows.length - 1 ? "Add an activity" : "";
    const howMuch = document.createElement("input");
    howMuch.type = "text";
    howMuch.value = row.howMuch;
    const commit = (): void => {
      const next = rows.map((r, j) => (j === i ? { what: what.value.trim(), howMuch: howMuch.value.trim() } : r)).filter((r) => r.what !== "" || r.howMuch !== "");
      patch({ activities: next }, "Statement of service performance");
      redraw("performance");
    };
    what.addEventListener("change", commit);
    howMuch.addEventListener("change", commit);
    const c1 = document.createElement("td");
    c1.append(what);
    const c2 = document.createElement("td");
    c2.append(howMuch);
    tr.append(c1, c2);
    tbody.append(tr);
  });
  table.append(tbody);
  body.append(table);

  // 3. Statement of Cash Received and Cash Paid
  body.append(heading("3. Cash received and cash paid"));
  body.append(
    note(
      `Worked out from the books for the year ended ${taxYearEndSaid(year)}, in whole dollars, GST inclusive. ` +
        "Moves between the organisation's own accounts are left out.",
    ),
  );
  const c = statement.dollars;
  const p = previous.dollars;
  const sheet = document.createElement("table");
  sheet.className = "report-table";
  sheet.innerHTML = `<thead><tr><th></th><th>${year}</th><th>${year - 1}</th></tr></thead>`;
  const sbody = document.createElement("tbody");
  const add = (label: string, a: number, b: number, strong = false): void => {
    const tr = document.createElement("tr");
    const name = nameCell(label);
    if (strong) name.style.fontWeight = "600";
    tr.append(name, amountCell(a.toLocaleString("en-NZ")), amountCell(b.toLocaleString("en-NZ")));
    sbody.append(tr);
  };
  add("Opening balance", c.opening, p.opening, true);
  add("Cash received from operating activities", c.receivedTotal, p.receivedTotal);
  add("Cash paid for operating activities", c.paidTotal, p.paidTotal);
  add("GST paid or refunded", c.lines.gst, p.lines.gst);
  add("Cash surplus or (deficit) from operating activities", c.operatingSurplus, p.operatingSurplus, true);
  add("Cash surplus or (deficit) from other activities", c.otherSurplus, p.otherSurplus, true);
  if (c.lines.incomeTax !== 0 || p.lines.incomeTax !== 0) add("Income tax paid or refunded", c.lines.incomeTax, p.lines.incomeTax);
  add("Increase or (decrease) in cash", c.increase, p.increase, true);
  add("Closing balance", c.closing, p.closing, true);
  add("Cash the books hold", c.held, p.held);
  sheet.append(sbody);
  const sheetWrap = document.createElement("div");
  sheetWrap.className = "table-scroll";
  sheetWrap.append(sheet);
  body.append(sheetWrap);

  const csv = document.createElement("button");
  csv.type = "button";
  csv.textContent = "Download the statement (CSV)";
  csv.addEventListener("click", () => {
    const lines = Object.entries(c.lines).map(([line, amount]) => [line, String(amount), String(p.lines[line as Tier4Line])]);
    const text = [["Line", String(year), String(year - 1)], ...lines]
      .map((row) => row.map((cell) => spreadsheetCell(cell)).join(","))
      .join("\r\n");
    download(text, `cash-received-and-paid-${year}.csv`, "text/csv");
  });
  body.append(csv);

  if (!fromBooks.reconciles) {
    const panel = document.createElement("details");
    panel.open = inputs.previousFigures === undefined;
    const title = document.createElement("summary");
    title.textContent = `Last year's figures (year ended ${taxYearEndSaid(year - 1)})`;
    panel.append(title);
    panel.append(
      note(
        "These books begin after last year did, so they cannot work out last year's cash. The standard shows every figure " +
          "beside the one before it: copy last year's from last year's report, in whole dollars. Leave out any line that had nothing. " +
          "If this is the organisation's first report, no figures are needed.",
      ),
    );
    const figures: PreviousFigures = { ...(inputs.previousFigures ?? {}) };
    const field = (label: string, name: keyof PreviousFigures): HTMLElement => {
      const wrap = document.createElement("label");
      wrap.className = "year-end-field";
      const box = document.createElement("input");
      box.type = "text";
      box.className = "payroll-tiny-input";
      box.placeholder = "0";
      box.value = figures[name] === undefined || figures[name] === 0 ? "" : String(figures[name]);
      box.addEventListener("change", () => {
        const parsed = parseAmount(box.value);
        if (parsed === null || parsed === 0) delete figures[name];
        else figures[name] = Math.round(parsed / 100);
        patch({ previousFigures: { ...figures } }, "Last year's figures");
        redraw("performance");
      });
      wrap.append(`${label} $ `, box);
      return wrap;
    };
    panel.append(field("Opening balance in bank account(s) and any cash on hand", "opening"));
    for (const [name, label] of [...TIER4_RECEIVED, ...TIER4_PAID]) panel.append(field(label, name));
    panel.append(field("GST paid or refunded", "gst"));
    for (const [name, label] of [...TIER4_OTHER_RECEIVED, ...TIER4_OTHER_PAID]) panel.append(field(label, name));
    panel.append(field("Income tax paid or refunded", "incomeTax"));
    panel.append(field("Closing balance of bank account(s)", "bank"));
    panel.append(field("Balance invested in term deposit(s)", "termDeposits"));
    panel.append(field("Undeposited cash held by the entity", "cash"));
    body.append(panel);
  }

  // Where each account goes.
  const fold = document.createElement("details");
  const summary = document.createElement("summary");
  summary.textContent = "Which line each account goes under";
  fold.append(summary);
  fold.append(
    note(
      "Each account's money is placed under a line of the standard from its name and type. Change one if it is in the " +
        "wrong place; anything you cannot place belongs in \"other cash\", as the standard says.",
    ),
  );
  const mapTable = document.createElement("table");
  mapTable.className = "report-table";
  mapTable.innerHTML = "<thead><tr><th>Account</th><th>Line</th></tr></thead>";
  const mbody = document.createElement("tbody");
  const model = state.ledger.entities ?? emptyEntityModel();
  const accountsHere = state.chart.filter(
    (a) => a.code.trim() !== "" && !/bank|^equity$/i.test(a.type) && (model.accounts[accountEntityKey(a)] === undefined || model.accounts[accountEntityKey(a)] === entity.id),
  );
  for (const account of accountsHere) {
    const tr = document.createElement("tr");
    const select = document.createElement("select");
    const fallback = defaultTier4Line(account);
    const held = state.ledger.tier4Lines?.[account.code.trim()] ?? fallback;
    for (const [value, label] of TIER4_CHOICES) {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = label;
      option.selected = value === held;
      select.append(option);
    }
    select.addEventListener("change", () => {
      const before = state.ledger.tier4Lines ?? {};
      const after = { ...before };
      if (select.value === fallback) delete after[account.code.trim()];
      else after[account.code.trim()] = select.value as Tier4Line;
      state.ledger = { ...state.ledger, tier4Lines: after };
      void savePart(state.ledger).then(async (persistent) => {
        state.persistent = persistent;
        await record("performanceReport", `Cash statement line for ${account.name}`, { lines: before }, { lines: after });
        redraw("performance");
      });
    });
    const cell = document.createElement("td");
    cell.append(select);
    tr.append(nameCell(`${account.code} ${account.name}`), cell);
    mbody.append(tr);
  }
  mapTable.append(mbody);
  const mapWrap = document.createElement("div");
  mapWrap.className = "table-scroll";
  mapWrap.append(mapTable);
  fold.append(mapWrap);
  body.append(fold);

  // 4. Notes
  body.append(heading("4. Notes"));
  body.append(
    note(
      "The basis of preparation and the GST note are written for you. These are the others, which only the organisation can fill in.",
    ),
  );

  body.append(Object.assign(document.createElement("h4"), { textContent: "Significant assets at year end" }));
  const assets = inputs.assets ?? {};
  const assetRow = (label: string, field: "land" | "vehicles" | "investments" | "loansOut"): HTMLElement => {
    const wrap = document.createElement("label");
    wrap.className = "year-end-field";
    wrap.append(`${label} $ `, dollarsInput(assets[field], (v) => {
      const next = { ...(inputsFor(entity, year).assets ?? {}) };
      if (v === undefined) delete next[field];
      else next[field] = v;
      patch({ assets: next }, "Significant assets");
    }));
    return wrap;
  };
  body.append(
    assetRow("Land and buildings", "land"),
    assetRow("Vehicles", "vehicles"),
    assetRow("Investments (shares, bonds, units in managed funds)", "investments"),
    assetRow("Amounts loaned to other organisations or persons", "loansOut"),
    textArea(assets.source ?? "", 2, "Where a value is an estimate rather than what was paid (a rateable value, a replacement cost), say where it came from", (v) =>
      patch({ assets: { ...(inputsFor(entity, year).assets ?? {}), source: v } }, "Significant assets"),
    ),
  );

  body.append(Object.assign(document.createElement("h4"), { textContent: "Significant liabilities at year end" }));
  const liabilities = inputs.liabilities ?? {};
  const liabilityRow = (label: string, field: "loans" | "borrowed" | "heldForOthers"): HTMLElement => {
    const wrap = document.createElement("label");
    wrap.className = "year-end-field";
    wrap.append(`${label} $ `, dollarsInput(liabilities[field], (v) => {
      const next = { ...(inputsFor(entity, year).liabilities ?? {}) };
      if (v === undefined) delete next[field];
      else next[field] = v;
      patch({ liabilities: next }, "Significant liabilities");
    }));
    return wrap;
  };
  body.append(
    liabilityRow("Loans and other borrowings", "loans"),
    liabilityRow("Amounts borrowed from other organisations or persons", "borrowed"),
    liabilityRow("Money held on behalf of others", "heldForOthers"),
  );

  body.append(Object.assign(document.createElement("h4"), { textContent: "Related party transactions" }));
  body.append(
    note(
      "Significant transactions with people or organisations that can influence this one: committee members, officeholders, " +
        "their close family, an organisation that controls it or that it controls. Include free services of value.",
    ),
  );
  const related = [...inputs.relatedParties, { relationship: "", what: "", amount: 0 as Cents }];
  const rt = document.createElement("table");
  rt.className = "report-table";
  rt.innerHTML = "<thead><tr><th>Relationship</th><th>Transaction</th><th>Amount $</th></tr></thead>";
  const rbody = document.createElement("tbody");
  related.forEach((row, i) => {
    const tr = document.createElement("tr");
    const rel = document.createElement("input");
    rel.type = "text";
    rel.value = row.relationship;
    rel.placeholder = i === related.length - 1 ? "e.g. Treasurer's partner" : "";
    const what = document.createElement("input");
    what.type = "text";
    what.value = row.what;
    const amount = dollarsInput(row.amount, () => {});
    const commit = (): void => {
      const parsed = parseAmount(amount.value) ?? 0;
      const next = related
        .map((r, j) => (j === i ? { relationship: rel.value.trim(), what: what.value.trim(), amount: parsed as Cents } : r))
        .filter((r) => r.relationship !== "" || r.what !== "");
      patch({ relatedParties: next }, "Related party transactions");
      redraw("performance");
    };
    rel.addEventListener("change", commit);
    what.addEventListener("change", commit);
    amount.addEventListener("change", commit);
    for (const el of [rel, what, amount]) {
      const td = document.createElement("td");
      td.append(el);
      tr.append(td);
    }
    rbody.append(tr);
  });
  rt.append(rbody);
  body.append(rt);
  body.append(
    textArea(inputs.relatedBalances ?? "", 2, "Amounts owed to or by a related party at year end, including loans or advances", (v) =>
      patch({ relatedBalances: v }, "Related party balances"),
    ),
  );

  if (np?.form === "society" && np.registeredCharity !== true) {
    body.append(
      Object.assign(document.createElement("h4"), { textContent: "Security over property" }),
      note(
        "An incorporated society that is not a registered charity, and had under $50,000 of operating payments and current " +
          "assets in each of the last two years, may file just a statement of receipts and payments, its assets and " +
          "liabilities, and any mortgages or other security over its property. This report covers the first two; say " +
          "here what security there is, if any.",
      ),
      textArea(inputs.securityInterests ?? "", 2, "Mortgages, charges or other security over property at year end (leave empty if none)", (v) =>
        patch({ securityInterests: v }, "Security interests"),
      ),
    );
  }
  body.append(Object.assign(document.createElement("h4"), { textContent: "Corrections and other information" }));
  body.append(
    textArea(inputs.errors ?? "", 2, "Errors in last year's report that were corrected this year: what was wrong and how it was put right", (v) =>
      patch({ errors: v }, "Correction of errors"),
    ),
    textArea(inputs.eventsAfter ?? "", 2, "Optional: significant events after year end, the cash expected, and any effect on carrying on", (v) =>
      patch({ eventsAfter: v }, "Events after year end"),
    ),
  );
  const expectations = textArea(
    inputs.grantsWithExpectations ?? "",
    3,
    "Optional: grants or donations received for a purpose and not yet spent at year end",
    (v) => patch({ grantsWithExpectations: v }, "Grants with expectations"),
  );
  const fill = document.createElement("button");
  fill.type = "button";
  fill.textContent = "Fill in from the grant register";
  fill.addEventListener("click", () => {
    const to = taxYearEnd(year);
    const lines = (state.ledger.grants ?? [])
      .filter((g) => g.entityId === entity.id && grantOpen(g))
      .map((g) => ({ g, at: grantPosition(g, state.ledger.grantLinks ?? {}, state.ledger.transactions, to) }))
      .filter((x) => x.at.held > 0)
      .map((x) => `${x.g.funder}: $${Math.round(x.at.held / 100).toLocaleString("en-NZ")} of the grant for ${x.g.purpose} was not yet spent.`);
    expectations.value = lines.join("\n");
    patch({ grantsWithExpectations: expectations.value }, "Grants with expectations");
  });
  body.append(expectations, fill);

  // 5. Approval
  body.append(heading("5. Approval"));
  body.append(note("The report is authorised when it is signed and dated by the committee or the trustees: the date, who gave the approval, and their signatures."));
  const date = document.createElement("input");
  date.type = "date";
  date.value = inputs.approvedOn ?? "";
  date.addEventListener("change", () => {
    patch({ approvedOn: date.value === "" ? undefined : date.value }, "Report approved");
  });
  const signers = document.createElement("input");
  signers.type = "text";
  signers.placeholder = "Names of those signing, separated by commas";
  signers.value = inputs.approvedBy.join(", ");
  signers.addEventListener("change", () => {
    patch({ approvedBy: signers.value.split(",").map((n) => n.trim()).filter((n) => n !== "") }, "Report signed by");
  });
  body.append(date, signers);

  body.append(
    note(
      "Reports on a cash basis, GST inclusive, with the 31 March year end. Built from the XRB's Tier 4 (NFP) Standard; " +
        "have the committee, and if you have one your accountant, read it before it is signed and filed with Charities Services.",
    ),
  );
  void taxYearOf;
}
