import { showPage } from "../app.js";
import { myirCard } from "./myir-cards.js";
import { accountDecided, bookYears } from "../books.js";
import { $, state } from "../state.js";
import { download, note } from "../ui.js";
import { emptyEntityModel, isRental, ownersOf } from "@nzosa/core";
import type { Cents } from "@nzosa/core";
import { ir3Csv, ir3For, renderIr3Details, renderTaxExtras } from "./reports.js";
import { ir3PackHtml } from "./ir3-pack.js";
import { provisionalPaidFromIrd } from "./ird-provisional.js";
import { checklistHtml, checklistOpen, checklistPanel } from "./personal-checklist.js";
import { tripsStatus } from "./vehicle-trips-panel.js";

/**
 * A person's year end: what their return needs, and the return.
 *
 * The books already know each rental's year and each person's share of it.
 * What they cannot know is everything that never passes through a bank
 * account here -- wages and their PAYE, interest and its RWT, dividends and
 * their credits, KiwiSaver and other PIE income -- and the facts Inland
 * Revenue holds: provisional tax paid, last year's carried-forward rental
 * deductions, whether the independent earner credit applies. So this page
 * asks for those, says what is still missing, and then gives the return the
 * way an accountant's year-end pack sets it out, to print or save.
 */

let chosenYear: number | undefined;
let chosenOwner = "";

function money(cents: number): string {
  return `${cents < 0 ? "-" : ""}$${(Math.abs(cents) / 100).toLocaleString("en-NZ", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

/** People with a return to file: whoever owns a share of something here. */
function people(): string[] {
  return ownersOf(state.ledger.entities ?? emptyEntityModel());
}

/** A checklist line: done or not, what it is, and what to do. */
function item(done: boolean | null, what: string, said: string, extra?: HTMLElement): HTMLElement {
  const li = document.createElement("li");
  li.className = done === true ? "setup-step done" : "setup-step";
  const mark = document.createElement("span");
  mark.className = "setup-mark";
  mark.textContent = done === true ? "✓" : done === null ? "–" : "!";
  const text = document.createElement("div");
  const strong = document.createElement("strong");
  strong.textContent = what;
  const detail = document.createElement("div");
  detail.className = "field-hint";
  detail.textContent = said;
  text.append(strong, detail);
  if (extra !== undefined) text.append(extra);
  li.append(mark, text);
  return li;
}

function link(label: string, page: string): HTMLButtonElement {
  const go = document.createElement("button");
  go.type = "button";
  go.className = "link-button";
  go.textContent = label;
  go.addEventListener("click", () => showPage(page));
  return go;
}

export function renderPersonalYearEnd(): void {
  const body = $("personalyear-body");
  body.textContent = "";

  const owners = people();
  if (owners.length === 0) {
    body.append(
      note(
        "Nobody owns anything here yet. On Entities & accounts, give each person's own entity " +
          "its owner, and each rental its owners -- for example “Ana Whitcombe 50%; Tom " +
          "Whitcombe 50%”.",
      ),
      link("Entities & accounts", "entities"),
    );
    return;
  }

  const years = bookYears();
  if (years.length === 0) {
    body.append(note("No transactions yet, so there is no year to finish."));
    return;
  }
  // The latest year that has ended, by default: the one whose return is due.
  const today = new Date().toISOString().slice(0, 10);
  const ended = years.filter((y) => `${y}-03-31` < today);
  if (chosenYear === undefined || !years.includes(chosenYear)) chosenYear = ended[0] ?? years[0];
  if (!owners.includes(chosenOwner)) chosenOwner = owners[0] ?? "";
  const year = chosenYear ?? years[0] ?? 0;
  const owner = chosenOwner;

  // --- which year, and whose -------------------------------------------------
  const pick = document.createElement("div");
  pick.className = "page-actions";
  const yearSelect = document.createElement("select");
  for (const y of years) {
    const option = document.createElement("option");
    option.value = String(y);
    option.textContent = `Year to 31 March ${y}`;
    option.selected = y === year;
    yearSelect.append(option);
  }
  yearSelect.addEventListener("change", () => {
    chosenYear = Number(yearSelect.value);
    renderPersonalYearEnd();
  });
  const ownerSelect = document.createElement("select");
  for (const name of owners) {
    const option = document.createElement("option");
    option.value = name;
    option.textContent = name;
    option.selected = name === owner;
    ownerSelect.append(option);
  }
  ownerSelect.addEventListener("change", () => {
    chosenOwner = ownerSelect.value;
    renderPersonalYearEnd();
  });
  pick.append(yearSelect, ownerSelect);
  body.append(pick);

  const result = ir3For(owner, year);
  const model = state.ledger.entities ?? emptyEntityModel();
  const extras = (state.ledger.taxExtras ?? []).filter((e) => e.owner === owner && e.year === year);
  const details = (state.ledger.ir3Details ?? []).find((d) => d.owner === owner && d.year === year);

  // --- what the return still needs ---------------------------------------------
  const heading = document.createElement("h3");
  heading.textContent = "What the return needs";
  body.append(heading);
  const list = document.createElement("ol");
  list.className = "setup-steps";

  // The books' part: every line of the year coded.
  const from = `${year - 1}-04-01`;
  const to = `${year}-03-31`;
  const decided = accountDecided();
  const transfers = state.ledger.transfers ?? {};
  const open = state.ledger.transactions.filter(
    (t) => t.date >= from && t.date <= to && !decided(t.id) && transfers[t.id] === undefined,
  ).length;
  list.append(
    item(
      open === 0,
      "Every line of the year coded",
      open === 0
        ? "Every bank line in the year is confirmed, so the rental figures are final."
        : `${open} bank line${open === 1 ? " is" : "s are"} in the year and not confirmed yet. The ` +
            "rental figures below include what the rules suggest for them; confirm them on Reconcile.",
      open === 0 ? undefined : link("Reconcile", "reconcile"),
    ),
  );

  // Rentals and their owners.
  const rentals = model.entities.filter(isRental);
  const unowned = rentals.filter((e) => (e.owners ?? []).length === 0);
  const mine = rentals.filter((e) => (e.owners ?? []).some((o) => o.name === owner));
  list.append(
    item(
      rentals.length === 0 ? null : unowned.length === 0,
      "Who owns each rental, and what share",
      rentals.length === 0
        ? "No rental properties in these books."
        : unowned.length > 0
          ? `No owners set on ${unowned.map((e) => e.name).join(", ")}, so nobody's return includes them.`
          : mine.length === 0
            ? `${owner} owns none of the rentals here.`
            : `${owner}: ` +
              mine
                .map((e) => `${e.name} ${(e.owners ?? []).find((o) => o.name === owner)?.percent ?? 0}%`)
                .join(", ") +
              ".",
      unowned.length > 0 ? link("Entities & accounts", "entities") : undefined,
    ),
  );

  // Income outside the books, by kind, so a kind not entered is a question.
  const kinds: [string, string][] = [
    ["salary", "wages or salary (PAYE)"],
    ["interest", "interest"],
    ["dividends", "dividends"],
    ["pie", "KiwiSaver or other PIE income"],
  ];
  const missingKinds = kinds.filter(([k]) => !extras.some((e) => e.category === k)).map(([, what]) => what);
  const extrasBox = document.createElement("div");
  // myIR's own record of the year's income first: one PDF, read by an AI,
  // fills these instead of typing them in.
  extrasBox.append(myirCard("income-details", { owner, year }, [year], renderPersonalYearEnd));
  renderTaxExtras(extrasBox, owner, year);
  list.append(
    item(
      extras.length > 0 ? missingKinds.length === 0 : false,
      "Income that does not pass through these books",
      (extras.length === 0
        ? "Nothing entered yet. "
        : `${extras.length} entered. `) +
        (missingKinds.length > 0
          ? `None entered for ${missingKinds.join(", ")}: enter them if ${owner} had any. ` +
            "myIR's income tax account shows what employers, banks and funds reported for the year."
          : ""),
      extrasBox,
    ),
  );

  // What Inland Revenue holds.
  const detailsBox = document.createElement("div");
  renderIr3Details(detailsBox, owner, year);
  const fromIrd = provisionalPaidFromIrd(owner, year);
  // The income tax account's transactions, where provisional tax paid comes
  // from, and the year's own filed return once there is one.
  detailsBox.prepend(
    myirCard("income-tax-account", { owner }, [year], renderPersonalYearEnd),
    myirCard("ir3-confirmation", { owner, year }, [year], renderPersonalYearEnd),
  );
  const lastYear = (state.ledger.incomeReturns ?? []).some(
    (r) => r.form === "IR3" && r.owner === owner && r.balanceDate === `${year - 1}-03-31`,
  );
  list.append(
    item(
      details?.provisionalTaxPaid !== undefined || fromIrd !== null,
      "Provisional tax paid, and last year's figures",
      (details?.provisionalTaxPaid !== undefined
        ? `Provisional tax paid: ${money(details.provisionalTaxPaid)}, as entered. `
        : fromIrd !== null
          ? `Provisional tax paid: ${money(fromIrd.paid)}, from myIR's income tax account ` +
            `(${fromIrd.payments} payment${fromIrd.payments === 1 ? "" : "s"} against the year). ` +
            "Enter a figure below only to replace it. "
          : "Provisional tax paid for the year is needed for the refund or tax to pay. Load the " +
            "income tax account's transactions from myIR on Inland Revenue records, or enter it below. ") +
        (lastYear
          ? "Last year's return is held, so its carried-forward figures are used."
          : "Last year's return is not held: enter any residential deductions carried forward " +
            "from it, or load it on Setup."),
      detailsBox,
    ),
  );
  // Each rental's own year end -- statements and mileage -- is on its page;
  // this return takes the owner's share of it.
  if (mine.length > 0) {
    const status = tripsStatus(year);
    const statements = (state.ledger.agentStatements ?? []).filter(
      (s) => s.to >= from && s.to <= to && mine.some((e) => e.id === s.entity),
    ).length;
    list.append(
      item(
        status.missingOdometer > 0 ? false : null,
        "Each rental's year end",
        `Property manager statements and trips to the rentals are entered under each property on ` +
          `Rental year end: ${statements} statement${statements === 1 ? "" : "s"} and ${status.trips} ` +
          `trip${status.trips === 1 ? "" : "s"} for the year so far` +
          (status.missingOdometer > 0 ? ", and a vehicle still needs its odometer readings." : "."),
        link("Rental year end", "rentalyear"),
      ),
    );
  }

  // The accountant's checklist: what the books cannot know, asked.
  const unanswered = checklistOpen(owner, year);
  const checklist = document.createElement("details");
  checklist.open = unanswered > 0;
  const summary = document.createElement("summary");
  summary.textContent =
    unanswered === 0 ? "Year-end checklist: all answered" : `Year-end checklist: ${unanswered} to answer`;
  checklist.append(summary, checklistPanel(owner, year, renderPersonalYearEnd));
  list.append(
    item(
      unanswered === 0,
      "The year-end checklist",
      "The questions an accountant asks before the accounts start, for this person and their " +
        "rentals: the books' figures where they have them, and yes or no for the rest. The " +
        "answers go into the pack, to sign.",
      checklist,
    ),
  );
  body.append(list);

  // --- the return ---------------------------------------------------------------
  const done = document.createElement("h3");
  done.textContent = `${owner}'s return for the year to 31 March ${year}`;
  body.append(done);

  const figures = document.createElement("table");
  figures.className = "report-table owner-table";
  const tbody = document.createElement("tbody");
  const line = (label: string, amount: Cents | null): void => {
    const tr = document.createElement("tr");
    const name = document.createElement("td");
    name.className = "report-name";
    name.textContent = label;
    const value = document.createElement("td");
    value.className = "report-amount";
    value.textContent = amount === null ? "not worked out" : money(amount);
    tr.append(name, value);
    tbody.append(tr);
  };
  line("Taxable income", result.taxableIncome);
  line("Tax on taxable income", result.taxOnIncome);
  line("Residual income tax", result.residualIncomeTax);
  if (result.refundOrToPay !== null) {
    line(result.refundOrToPay < 0 ? "Refund due" : "Tax to pay", Math.abs(result.refundOrToPay) as Cents);
  }
  if (result.nextYearProvisional !== null) line(`${year + 1} provisional tax`, result.nextYearProvisional);
  figures.append(tbody);
  body.append(figures);
  for (const said of result.notes) body.append(note(said));

  const actions = document.createElement("div");
  actions.className = "page-actions";
  const pack = document.createElement("button");
  pack.type = "button";
  pack.className = "primary";
  pack.textContent = "Open the year-end pack";
  pack.title = "The return set out as an accountant's year-end pack, to print or save as a PDF.";
  pack.addEventListener("click", () => {
    const html = ir3PackHtml(result, state.ledger.taxExtras ?? [], details?.provisionalTaxPaid ?? fromIrd?.paid, checklistHtml(owner, year));
    const shown = window.open("", "_blank");
    if (shown === null) {
      // A browser that refuses the window still lets the file be saved.
      download(html, `${owner} - ${year} IR3.html`, "text/html");
      return;
    }
    shown.document.open();
    shown.document.write(html);
    shown.document.close();
  });
  const csv = document.createElement("button");
  csv.type = "button";
  csv.textContent = "Download the boxes (CSV)";
  csv.addEventListener("click", () => download(ir3Csv(owner, year), `${owner} - ${year} IR3 boxes.csv`, "text/csv"));
  actions.append(pack, csv);
  body.append(actions);
}
