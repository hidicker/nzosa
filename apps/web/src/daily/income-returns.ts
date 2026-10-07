import { record } from "../books.js";
import { aiReadDocument, aiRoute, aiStatus } from "../ai-backend.js";
import { chosenStartDate } from "../migrate/onboarding-state.js";
import { state } from "../state.js";
import { save } from "../store.js";
import type { StoredIncomeReturn } from "../store.js";
import { note } from "../ui.js";
import { booksIr10, booksRentals } from "./reports.js";
import {
  IR10_LAYOUT,
  PROVIDER_NAMES,
  detectProvider,
  emptyEntityModel,
  incomeReturnFields,
  incomeReturnPrompt,
  ir10BoxForAccount,
  ir10Differences,
  readIncomeReturn,
} from "@nzosa/core";
import type { Cents, Entity, FiledIncomeReturn, FiledIr3, FiledIr4, IncomeReturnForm } from "@nzosa/core";
import { booksLocale, moneyPlaces } from "../country.js";

/**
 * Last year's income tax return, read in from myIR.
 *
 * By way of a model: either the person carries the PDF and a prompt to one
 * they already use and pastes the answer back, or -- with their own key, on
 * this computer, having agreed -- the PDF is sent from here. Either way the
 * answer is a fixed JSON shape, and nothing is kept until the return's own
 * arithmetic holds and somebody has looked at the figures beside the books.
 */

let form: IncomeReturnForm = "IR4";
let pasted = "";
let reading: ReturnType<typeof readIncomeReturn> | null = null;
let chosenEntity = "";
let chosenOwner = "";
let asking = "";

function dollars(cents: Cents): string {
  return `${cents < 0 ? "−" : ""}$${(Math.abs(cents) / 100).toLocaleString(booksLocale(), {
    minimumFractionDigits: moneyPlaces(),
    maximumFractionDigits: moneyPlaces(),
  })}`;
}

/** Entities that file an IR4: businesses that are companies, or not yet said. */
function companies(): Entity[] {
  const model = state.ledger.entities ?? emptyEntityModel();
  return model.entities.filter(
    (e) => (e.kind ?? "business") === "business" && (e.structure === undefined || e.structure === "company"),
  );
}

/** The people who file an IR3: the entities' owners, or a personal entity's own name. */
function people(): string[] {
  const model = state.ledger.entities ?? emptyEntityModel();
  const names = new Set<string>();
  for (const entity of model.entities) {
    for (const owner of entity.owners ?? []) if (owner.name.trim() !== "") names.add(owner.name.trim());
    if ((entity.owners ?? []).length === 0 && entity.kind === "personal") names.add(entity.name);
  }
  return [...names].sort();
}

function booksStart(): string {
  return state.ledger.openingBalances?.asAt ?? chosenStartDate() ?? "";
}

function dayBefore(iso: string): string {
  const day = new Date(`${iso}T00:00:00Z`);
  day.setUTCDate(day.getUTCDate() - 1);
  return day.toISOString().slice(0, 10);
}

/** Debtors, cash and creditors from the opening balances, as IR10 boxes 30, 31 and 45. */
function openingBoxes(): Record<number, Cents> {
  const held = state.ledger.openingBalances?.accounts ?? {};
  const banks = new Set(state.ledger.transactions.map((t) => t.account));
  const out: Record<number, Cents> = { 30: 0, 31: 0, 45: 0 };
  for (const [key, balance] of Object.entries(held)) {
    let box: number | null;
    if (banks.has(key)) box = 31;
    else {
      const account = state.chart.find(
        (a) => a.code.trim() === key || `${a.name} - ${a.code}` === key || a.name === key,
      );
      box = account === undefined ? null : ir10BoxForAccount(account.code, account.type, balance, account.name);
    }
    if (box === 30 || box === 31) out[box] = (out[box] ?? 0) + balance;
    if (box === 45) out[45] = (out[45] ?? 0) - balance;
  }
  for (const box of [30, 31, 45]) out[box] = Math.round((out[box] ?? 0) / 100) * 100;
  return out;
}

function table(head: string[], rows: string[][]): HTMLElement {
  const t = document.createElement("table");
  t.className = "report-table";
  const thead = document.createElement("thead");
  const hr = document.createElement("tr");
  for (const text of head) {
    const th = document.createElement("th");
    th.textContent = text;
    hr.append(th);
  }
  thead.append(hr);
  const body = document.createElement("tbody");
  for (const row of rows) {
    const tr = document.createElement("tr");
    for (const text of row) {
      const td = document.createElement("td");
      td.textContent = text;
      tr.append(td);
    }
    body.append(tr);
  }
  t.append(thead, body);
  return t;
}

/** A company's return set beside the books. */
function ir4AgainstTheBooks(filed: FiledIr4): HTMLElement {
  const wrap = document.createElement("div");
  const start = booksStart();
  const diffTable = (rows: { box: number; title: string; filed: Cents; books: Cents }[]) =>
    table(
      ["IR10 box", "Filed", "These books", "Difference"],
      rows.map((r) => [`${r.box} ${r.title}`, dollars(r.filed), dollars(r.books), dollars((r.filed - r.books) as Cents)]),
    );
  if (Object.keys(filed.ir10).length === 0) {
    wrap.append(note("No IR10 figures were read, so there is nothing to set beside the books."));
    return wrap;
  }
  if (start !== "" && filed.balanceDate === dayBefore(start)) {
    const ours = openingBoxes();
    const rows = [30, 31, 45]
      .filter((box) => filed.ir10[box] !== undefined && Math.abs((filed.ir10[box] ?? 0) - (ours[box] ?? 0)) > 100)
      .map((box) => ({
        box,
        title: IR10_LAYOUT.find((l) => l.box === box)?.title ?? "",
        filed: filed.ir10[box] ?? 0,
        books: ours[box] ?? 0,
      }));
    wrap.append(
      note(
        "The year before these books start: its closing debtors, cash and creditors are the " +
          `opening balances. ${rows.length === 0 ? "All three agree." : "These differ:"}`,
      ),
    );
    if (rows.length > 0) wrap.append(diffTable(rows));
    return wrap;
  }
  if (start !== "" && filed.balanceDate >= start) {
    const rows = ir10Differences(filed.ir10, booksIr10(filed.balanceDate));
    wrap.append(
      note(
        rows.length === 0
          ? "Every IR10 box shown on the return agrees with these books, to the dollar."
          : `${rows.length} IR10 box${rows.length === 1 ? "" : "es"} differ from these books. A late ` +
              "adjustment or a different rounding can explain one; each is worth a look.",
      ),
    );
    if (rows.length > 0) wrap.append(diffTable(rows));
    return wrap;
  }
  wrap.append(
    note(
      "This return is for a year these books neither start from nor cover, so it is kept for its " +
        "carried-forward figures only.",
    ),
  );
  return wrap;
}

/**
 * An individual's rental schedules set beside the books' own.
 *
 * A schedule is matched to the rental whose name shares a distinctive word
 * with it -- the street, usually -- and the books' figures are the owner's
 * share of the property, since that is what each owner files.
 */
function ir3AgainstTheBooks(filed: FiledIr3, owner: string, redraw: () => void = () => {}): HTMLElement {
  const wrap = document.createElement("div");
  const start = booksStart();
  if (filed.rentals.length === 0) return wrap;
  if (start === "" || filed.balanceDate < start) {
    wrap.append(note("These books do not cover that year, so the rental schedules are kept as filed."));
    return wrap;
  }
  const books = booksRentals(filed.balanceDate);
  const shareOf = (entity: Entity): number => {
    const held = (entity.owners ?? []).find((o) => o.name.trim() === owner);
    return held === undefined ? ((entity.owners ?? []).length === 0 ? 1 : 0) : held.percent / 100;
  };
  // The owner's own rentals first: a line on their return is one of these.
  const theirs = books.filter((b) => shareOf(b.entity) > 0);
  const offered = theirs.length > 0 ? theirs : books;
  const covers = state.ledger.ir3RentalCovers ?? {};

  const table = document.createElement("table");
  table.className = "report-table owner-table";
  const head = document.createElement("thead");
  head.innerHTML =
    "<tr><th>Rental on the return</th><th>Covers</th><th>Filed net income</th><th>These books</th><th>Difference</th></tr>";
  const tbody = document.createElement("tbody");
  for (const rental of filed.rentals) {
    const key = `${owner}\u0000${rental.property}`;
    const chosen = new Set(covers[key] ?? guessCovers(rental.property, offered.map((b) => b.entity)));
    const tr = document.createElement("tr");
    const name = document.createElement("td");
    name.className = "report-name";
    name.textContent = rental.property;
    // Which of the books' rentals this line is: one property, or a portfolio.
    const pick = document.createElement("td");
    for (const one of offered) {
      const label = document.createElement("label");
      label.className = "ir3-cover";
      const tick = document.createElement("input");
      tick.type = "checkbox";
      tick.checked = chosen.has(one.entity.id);
      tick.addEventListener("change", () => {
        const next = new Set(chosen);
        if (tick.checked) next.add(one.entity.id);
        else next.delete(one.entity.id);
        void saveCovers(key, [...next]).then(redraw);
      });
      const share = shareOf(one.entity);
      label.append(tick, ` ${one.entity.name}${share > 0 && share < 1 ? ` (${Math.round(share * 100)}%)` : ""} `);
      pick.append(label);
    }
    const covered = offered.filter((b) => chosen.has(b.entity.id));
    const ours = covered.reduce((sum, b) => sum + Math.round((b.net * shareOf(b.entity)) / 100) * 100, 0) as Cents;
    const cells = covered.length === 0
      ? [dollars(rental.netIncome), "tick what it covers", ""]
      : [
          dollars(rental.netIncome),
          dollars(ours),
          Math.abs(rental.netIncome - ours) > 100 ? dollars((rental.netIncome - ours) as Cents) : "✓",
        ];
    tr.append(name, pick);
    for (const text of cells) {
      const td = document.createElement("td");
      td.className = "report-amount";
      td.textContent = text;
      tr.append(td);
    }
    tbody.append(tr);
  }
  table.append(head, tbody);
  wrap.append(
    note(
      "Each rental line on the return beside the books, at this owner's share. A line can cover " +
        "several properties -- “Residential” is the residential portfolio, “Other " +
        "rental” the net rents of the rest -- so tick the rentals each one is.",
    ),
    table,
  );
  return wrap;
}

/**
 * The rentals a line on a filed IR3 most likely covers, before anybody says.
 *
 * A word they share first -- the street, usually. Failing that the return's
 * own two kinds: its residential line is the residential portfolio, and the
 * net rents line everything else.
 */
function guessCovers(property: string, rentals: readonly Entity[]): string[] {
  const words = (text: string) =>
    new Set(
      text
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter((w) => w.length >= 4 && !/^(rental|rentals|residential|commercial|street|road|other|share|income)$/.test(w)),
    );
  const named = words(property);
  const byName = rentals.filter((e) => [...words(e.name)].some((w) => named.has(w)));
  if (byName.length > 0) return byName.map((e) => e.id);
  if (/residential|portfolio/i.test(property)) {
    return rentals.filter((e) => e.kind === "residential").map((e) => e.id);
  }
  if (/other|rents?\b|commercial/i.test(property)) {
    return rentals.filter((e) => e.kind !== "residential").map((e) => e.id);
  }
  return [];
}

async function saveCovers(key: string, ids: string[]): Promise<void> {
  const before = state.ledger.ir3RentalCovers ?? {};
  const after = { ...before, [key]: ids };
  state.ledger = { ...state.ledger, ir3RentalCovers: after };
  state.persistent = await save(state.ledger);
  await record("ir3Details", `IR3 rental line ${key.split("\u0000")[1] ?? ""}: which rentals it covers`, before, after);
}

/** The figures read, laid out for somebody to check against the PDF. */
function figures(filed: FiledIncomeReturn): HTMLElement {
  const wrap = document.createElement("div");
  const rows: string[][] = [];
  const held = filed as unknown as Record<string, unknown>;
  for (const [key, what] of incomeReturnFields(filed.form)) {
    const value = held[key];
    if (value === undefined) continue;
    rows.push([
      what.replace(/, as .*$/, ""),
      typeof value === "number" && key !== "lowestEconomicInterest" ? dollars(value as Cents) : String(value),
    ]);
  }
  wrap.append(table(["", "Read"], rows));
  if (filed.form === "IR3" && filed.rentals.length > 0) {
    wrap.append(
      table(
        ["Rental schedule", "Income", "Expenses", "Net", "Ring-fenced loss carried forward"],
        filed.rentals.map((r) => [
          r.property,
          r.grossIncome === undefined ? "not shown" : dollars(r.grossIncome),
          r.expenses === undefined ? "not shown" : dollars(r.expenses),
          dollars(r.netIncome),
          r.ringFencedLossCarriedForward === undefined ? "" : dollars(r.ringFencedLossCarriedForward),
        ]),
      ),
    );
  }
  return wrap;
}

/** Whose return this is, as kept: the entity for a company, the person for an individual. */
function whose(): { entityId?: string; owner?: string } {
  if (form === "IR3") return { owner: chosenOwner };
  const single = (state.ledger.entities?.entities.length ?? 0) <= 1;
  return single ? {} : { entityId: chosenEntity };
}

function isTheirs(held: StoredIncomeReturn): boolean {
  const who = whose();
  return (
    held.form === form &&
    (form === "IR3" ? held.owner === who.owner : (held.entityId ?? "") === (who.entityId ?? ""))
  );
}

async function keep(filed: FiledIncomeReturn, source: string): Promise<void> {
  const before = state.ledger.incomeReturns ?? [];
  const entry = { ...filed, ...whose(), savedAt: new Date().toISOString(), source } as StoredIncomeReturn;
  const after = [
    ...before.filter((r) => !(isTheirs(r) && r.balanceDate === filed.balanceDate)),
    entry,
  ].sort((a, b) => a.balanceDate.localeCompare(b.balanceDate));
  state.ledger = { ...state.ledger, incomeReturns: after };
  state.persistent = await save(state.ledger);
  await record(
    "incomeReturns",
    `Filed ${filed.form} for the year to ${filed.balanceDate} read in` + (form === "IR3" ? ` (${chosenOwner})` : ""),
    before,
    after,
  );
  pasted = "";
  reading = null;
}

async function forget(held: StoredIncomeReturn): Promise<void> {
  const before = state.ledger.incomeReturns ?? [];
  const after = before.filter((r) => r !== held);
  state.ledger = { ...state.ledger, incomeReturns: after };
  state.persistent = await save(state.ledger);
  await record("incomeReturns", `Filed ${held.form} for the year to ${held.balanceDate} removed`, before, after);
}

function heldLine(one: StoredIncomeReturn): string {
  if (one.form === "IR3") {
    const fenced = one.rentals
      .filter((r) => (r.ringFencedLossCarriedForward ?? 0) !== 0)
      .map((r) => `${r.property} ${dollars(r.ringFencedLossCarriedForward ?? 0)}`);
    return (
      `IR3, year to ${one.balanceDate}: taxable income ${dollars(one.taxableIncome)}; ` +
      `residual income tax ${dollars(one.residualIncomeTax)}` +
      ((one.lossCarriedForward ?? 0) !== 0 ? `; loss to carry forward ${dollars(one.lossCarriedForward ?? 0)}` : "") +
      (fenced.length > 0 ? `; ring-fenced losses ${fenced.join(", ")}` : "") +
      (one.provisionalTaxMethod ? `; provisional tax ${one.provisionalTaxMethod}` : "") +
      ". "
    );
  }
  return (
    `IR4, year to ${one.balanceDate}: loss to carry forward ${dollars(one.lossCarriedForward)}; ` +
    `residual income tax ${dollars(one.residualIncomeTax)}` +
    (one.imputationClosing !== undefined ? `; imputation credits ${dollars(one.imputationClosing)}` : "") +
    (one.provisionalTaxMethod ? `; provisional tax ${one.provisionalTaxMethod}` : "") +
    ". "
  );
}

/**
 * Sending the PDF from here, with these books' own key.
 *
 * Filled in once the key is known, because it depends on there being one of
 * the person's own on this computer. Agreed to each time, in words that say
 * what goes: the whole return, identifiers and all, to that provider.
 */
function withOwnKey(redraw: () => void): HTMLElement {
  const wrap = document.createElement("div");
  wrap.className = "income-return-key";
  wrap.hidden = true;
  if (aiRoute() !== "folder") return wrap;
  void aiStatus().then((status) => {
    if (status === null || !status.configured || status.sharedKey === true) return;
    const provider = PROVIDER_NAMES[detectProvider(status.key)];
    if (detectProvider(status.key) === "jev") return;
    const file = document.createElement("input");
    file.type = "file";
    file.accept = ".pdf,application/pdf";
    const agreeLabel = document.createElement("label");
    const agree = document.createElement("input");
    agree.type = "checkbox";
    agreeLabel.append(
      agree,
      ` Send the whole PDF — the IRD number, names and address included — to ${provider} under ` +
        "my key, to be read. It is not kept here.",
    );
    const go = document.createElement("button");
    go.type = "button";
    go.className = "primary";
    go.textContent = "Send it and read the answer";
    const said = document.createElement("span");
    said.className = "field-hint";
    said.textContent = asking;
    const ready = () => {
      go.disabled = !agree.checked || (file.files?.length ?? 0) === 0;
    };
    agree.addEventListener("change", ready);
    file.addEventListener("change", ready);
    ready();
    go.addEventListener("click", () => {
      const chosen = file.files?.[0];
      if (chosen === undefined) return;
      go.disabled = true;
      said.textContent = ` Asking ${provider}…`;
      void aiReadDocument(incomeReturnPrompt(form), chosen).then((answer) => {
        if (answer === null || answer.error !== undefined || answer.text === undefined) {
          said.textContent = ` ${answer?.error ?? "It could not be sent from here."}`;
          go.disabled = false;
          return;
        }
        pasted = answer.text;
        reading = readIncomeReturn(pasted, form);
        asking = "";
        redraw();
      });
    });
    wrap.append(
      note(`Or, with your own ${provider} key on this computer, send the PDF from here:`),
      file,
      agreeLabel,
      go,
      said,
    );
    wrap.hidden = false;
  });
  return wrap;
}

/** The whole panel: what is held, and reading another in. */
export function incomeReturnPanel(redraw: () => void): HTMLElement {
  const wrap = document.createElement("div");
  wrap.className = "income-returns";
  const firms = companies();
  const persons = people();
  if (firms.length === 0 && persons.length === 0) {
    wrap.append(
      note(
        "Nothing here files an income tax return yet: set a business entity's structure to Company, " +
          "or give an entity its owners, on Entities & accounts.",
      ),
    );
    return wrap;
  }
  if (form === "IR4" && firms.length === 0) form = "IR3";
  if (form === "IR3" && persons.length === 0) form = "IR4";

  // Which return, and whose.
  const which = document.createElement("div");
  which.className = "migration-actions";
  const formPick = document.createElement("select");
  for (const [value, caption, allowed] of [
    ["IR4", "A company's return (IR4)", firms.length > 0],
    ["IR3", "An individual's return (IR3)", persons.length > 0],
  ] as const) {
    if (!allowed) continue;
    const option = document.createElement("option");
    option.value = value;
    option.textContent = caption;
    option.selected = form === value;
    formPick.append(option);
  }
  formPick.addEventListener("change", () => {
    form = formPick.value as IncomeReturnForm;
    reading = null;
    redraw();
  });
  which.append(formPick);
  if (form === "IR4" && firms.length > 1) {
    if (!firms.some((e) => e.id === chosenEntity)) chosenEntity = firms[0]?.id ?? "";
    const pick = document.createElement("select");
    for (const entity of firms) {
      const option = document.createElement("option");
      option.value = entity.id;
      option.textContent = entity.name;
      option.selected = entity.id === chosenEntity;
      pick.append(option);
    }
    pick.addEventListener("change", () => {
      chosenEntity = pick.value;
      redraw();
    });
    which.append(pick);
  } else if (form === "IR4") {
    chosenEntity = firms[0]?.id ?? "";
  }
  if (form === "IR3") {
    if (!persons.includes(chosenOwner)) chosenOwner = persons[0] ?? "";
    const pick = document.createElement("select");
    for (const person of persons) {
      const option = document.createElement("option");
      option.value = person;
      option.textContent = person;
      option.selected = person === chosenOwner;
      pick.append(option);
    }
    pick.addEventListener("change", () => {
      chosenOwner = pick.value;
      reading = null;
      redraw();
    });
    which.append(pick);
  }
  wrap.append(which);

  // What is held already.
  for (const one of (state.ledger.incomeReturns ?? []).filter(isTheirs)) {
    const line = document.createElement("div");
    line.className = "income-return-held";
    line.textContent = heldLine(one);
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "link-button";
    remove.textContent = "remove";
    remove.addEventListener("click", () => void forget(one).then(redraw));
    line.append(remove);
    wrap.append(line);
    // Its rental lines beside the books, where it is an individual's: kept
    // returns are where the matching is set, not only one being read in.
    if (one.form === "IR3" && one.rentals.length > 0) {
      wrap.append(ir3AgainstTheBooks(one, one.owner ?? chosenOwner, redraw));
    }
  }

  // Reading one in: carried, or sent from here. Where the PDF comes from
  // first, in myIR's own words -- nothing there is called a return download.
  wrap.append(
    note(
      "Getting the return from myIR: go to the Income tax account panel, click More…, " +
        "select File or amend a return, and save the return as a PDF, all pages.",
    ),
    note(
      "Copy the prompt and give it, with the return's PDF from myIR, to any AI you use " +
        "(ChatGPT, Claude, Gemini), then paste its answer below. The PDF goes only where you send it.",
    ),
  );
  const copy = document.createElement("button");
  copy.type = "button";
  copy.textContent = "Copy the prompt";
  const copied = document.createElement("span");
  copied.className = "field-hint";
  copy.addEventListener("click", () => {
    void navigator.clipboard
      .writeText(incomeReturnPrompt(form))
      .then(() => {
        copied.textContent = " Copied.";
      })
      .catch(() => {
        copied.textContent = " Could not copy; open the prompt below and copy it by hand.";
      });
  });
  const shown = document.createElement("details");
  const summary = document.createElement("summary");
  summary.textContent = "Show the prompt";
  const pre = document.createElement("pre");
  pre.className = "ai-prompt";
  pre.textContent = incomeReturnPrompt(form);
  shown.append(summary, pre);
  wrap.append(copy, copied, shown, withOwnKey(redraw));

  const box = document.createElement("textarea");
  box.rows = 6;
  box.placeholder = `{"form": "${form}", "balanceDate": "2026-03-31", ...}`;
  box.value = pasted;
  box.addEventListener("input", () => {
    pasted = box.value;
  });
  const read = document.createElement("button");
  read.type = "button";
  read.textContent = "Read the answer";
  read.addEventListener("click", () => {
    reading = readIncomeReturn(pasted, form);
    redraw();
  });
  wrap.append(box, read);

  if (reading !== null) {
    const result = reading;
    if (result.problems.length > 0) {
      const list = document.createElement("ul");
      list.className = "variance-problems";
      for (const problem of result.problems) {
        const item = document.createElement("li");
        item.textContent = problem;
        list.append(item);
      }
      wrap.append(
        note(
          "The return's own figures do not add up as read, so it is not kept. Check them against the " +
            "PDF, correct the answer, and read it again:",
        ),
        list,
      );
    }
    if (result.filed !== undefined) {
      const filed = result.filed;
      wrap.append(
        note("Check these against the PDF."),
        figures(filed),
        filed.form === "IR4" ? ir4AgainstTheBooks(filed) : ir3AgainstTheBooks(filed, chosenOwner, redraw),
      );
      if (result.problems.length === 0) {
        const replacing = (state.ledger.incomeReturns ?? []).some(
          (r) => isTheirs(r) && r.balanceDate === filed.balanceDate,
        );
        const keepIt = document.createElement("button");
        keepIt.type = "button";
        keepIt.className = "primary";
        keepIt.textContent = replacing ? "Replace the one held for that year" : "Keep this return";
        keepIt.addEventListener(
          "click",
          () => void keep(filed, "myIR return, read by an AI model and checked here").then(redraw),
        );
        wrap.append(keepIt);
      }
    }
  }
  return wrap;
}
