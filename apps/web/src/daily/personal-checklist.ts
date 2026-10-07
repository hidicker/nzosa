import { record } from "../books.js";
import { state } from "../state.js";
import { save } from "../store.js";
import type { PersonalYearAnswer } from "../store.js";
import { emptyEntityModel, isRental } from "@nzosa/core";
import type { Entity } from "@nzosa/core";
import { balanceChecksNow } from "./bank-import.js";
import { dailyFileBalances } from "./opening-balances.js";
import { rentalSchedulesFor } from "./reports.js";
import { taxYearEnd, taxYearStart } from "../tax-year.js";
import { booksLocale, moneyPlaces } from "../country.js";

/**
 * The year-end questions an accountant asks, for a person and their rentals.
 *
 * Taken from the checklist practices send before the accounts start, kept to
 * what applies to somebody's own return: their bank and loan balances,
 * investment income, donations, overseas holdings, each rental, and what
 * changed. Business stock, employee leave, childcare funding and livestock
 * belong to other kinds of books and are left out.
 *
 * Where the books already know, the page says what they show, so the answer
 * is a confirmation rather than a hunt for paper. Where they cannot know,
 * it asks -- yes or no, with room for the detail -- and the answers go into
 * the year-end pack as the checklist, signed, as the accountant asks for it.
 */

export interface ChecklistQuestion {
  id: string;
  section: string;
  ask: string;
  /** What the books show, said beside the question. */
  books?: string;
  /** Asks for a figure as well as a yes or no. */
  amount?: boolean;
  /** Said when the answer is yes, where a yes means more to do. */
  ifYes?: string;
  /**
   * On the accountant's checklist, but seldom for a person and their
   * rentals. Shown so nothing they ask for is missing, and not counted as
   * waiting when it is left unanswered.
   */
  optional?: boolean;
}

function money(cents: number): string {
  return `$${(cents / 100).toLocaleString(booksLocale(), { minimumFractionDigits: moneyPlaces(), maximumFractionDigits: moneyPlaces() })}`;
}

function rentalsOf(owner: string): Entity[] {
  return (state.ledger.entities ?? emptyEntityModel()).entities.filter(
    (e) => isRental(e) && (e.owners ?? []).some((o) => o.name === owner),
  );
}

/** The questions for one person and year, with what the books show for each. */
export function checklistQuestions(owner: string, year: number): ChecklistQuestion[] {
  const end = taxYearEnd(year);
  const from = taxYearStart(year);
  const out: ChecklistQuestion[] = [];

  // 1. Bank and loan balances at 31 March.
  const atEnd = dailyFileBalances(end);
  const checks = balanceChecksNow().filter((c) => c.account !== null);
  const broken = checks.filter((c) => c.breaks.some((b) => b.date <= end));
  out.push({
    id: "bank-balances",
    section: "Bank and loan balances at 31 March",
    ask: "Bank statements for every account, 1 April to 31 March, with opening and closing balances",
    books:
      atEnd.size > 0
        ? `The daily balances file has ${atEnd.size} account${atEnd.size === 1 ? "" : "s"} at ${end}` +
          (broken.length === 0
            ? ", each agreeing with the books every day."
            : `; ${broken.length} do${broken.length === 1 ? "es" : ""} not agree with the books.`)
        : "No daily balances file reaches 31 March: load one on Bank import.",
  });
  out.push({
    id: "loan-statements",
    section: "Bank and loan balances at 31 March",
    ask: "Loan statements at 31 March, showing the interest and principal paid in the year",
  });
  out.push({
    id: "new-loans",
    section: "Loans",
    ask: "A new loan, hire purchase or lease taken out in the year, or a change in borrowing",
    ifYes: "Give the loan or agreement documents, and the balances at 31 March.",
  });

  // 2. Investment income and donations.
  out.push({
    id: "interest-dividends",
    section: "Personal income",
    ask: "Interest and dividend advice notices, and investment portfolio statements at 31 March",
    books: "Entered under income that does not pass through the books, above.",
  });
  const donated = donationsCoded(owner, from, end);
  out.push({
    id: "donations",
    section: "Personal income",
    ask: "Donations to charities eligible for the donation tax credit",
    amount: true,
    ...(donated > 0 ? { books: `${money(donated)} coded to donations in the year.` } : {}),
    ifYes: "Receipts are needed. The credit is claimed separately from the IR3, on an IR526 or in myIR.",
  });
  out.push({
    id: "overseas",
    section: "Personal income",
    ask: "Overseas shares, funds, bank accounts or retirement savings, or crypto-currency, held or sold",
    ifYes:
      "Worldwide income is taxed in New Zealand, and overseas holdings can fall under the foreign " +
      "investment fund rules. These books do not work those out: discuss them with your accountant.",
  });

  // 3. Each rental.
  const mine = rentalsOf(owner);
  const schedules = rentalSchedulesFor(year, false).filter(({ entity }) => mine.some((e) => e.id === entity.id));
  for (const { entity, now } of schedules) {
    const by = (heading: string): number =>
      now.expenses.filter((e) => e.heading === heading).reduce((s, e) => s + e.amount, 0);
    const travel = now.expenses
      .filter((e) => /travel|mileage|vehicle/i.test(e.name))
      .reduce((s, e) => s + e.amount, 0);
    out.push({
      id: `rental-${entity.id}`,
      section: `Rental: ${entity.name}`,
      ask: "Rent received and expenses for the whole property, as the books have them",
      books:
        `Rent ${money(now.totalIncome)}; rates ${money(by("rates"))}; insurance ${money(by("insurance"))}; ` +
        `repairs and maintenance ${money(by("repairs"))}; interest ${money(by("interest"))}` +
        (travel > 0 ? `; travel ${money(travel)}` : "") +
        `; total expenses ${money(now.totalExpenses)}.`,
    });
    out.push({
      id: `visits-${entity.id}`,
      section: `Rental: ${entity.name}`,
      ask: "Property visits: date, reason and kilometres for each",
      ...(travel > 0 ? { books: `${money(travel)} of travel is coded to it.` } : {}),
    });
    out.push({
      id: `insurance-${entity.id}`,
      section: `Rental: ${entity.name}`,
      ask: "Insurance invoices and the policy statement for the year",
      ...(by("insurance") > 0 ? { books: `${money(by("insurance"))} of insurance is coded to it.` } : {}),
    });
    out.push({
      id: `paid-privately-${entity.id}`,
      section: `Rental: ${entity.name}`,
      ask: "Expenses for it paid from an account or card not in these books",
      amount: true,
      ifYes: "Give the receipts: they are deductions the books cannot see.",
    });
    out.push({
      id: `all-banked-${entity.id}`,
      section: `Rental: ${entity.name}`,
      ask: "All of its rent paid into the bank accounts in these books",
      ifYes: "",
    });
    out.push({
      id: `owing-${entity.id}`,
      section: `Rental: ${entity.name}`,
      ask: "Rent owed by tenants, or received in advance, at 31 March; and any unpaid rent written off",
      amount: true,
    });
    out.push({
      id: `short-term-${entity.id}`,
      section: `Rental: ${entity.name}`,
      ask: "Let short-term (Airbnb, Bookabach) or used privately for part of the year",
      ifYes:
        "Give the booking schedule showing the days it was available. Part-private use can bring " +
        "in the mixed-use asset rules, which these books do not apply.",
    });
  }

  // 4. Assets bought and sold.
  const bought = (state.ledger.assets ?? []).filter((a) => (a.purchased ?? "") >= from && (a.purchased ?? "") <= end);
  const sold = (state.ledger.assets ?? []).filter((a) => (a.disposed ?? "") >= from && (a.disposed ?? "") <= end);
  out.push({
    id: "assets",
    section: "Assets",
    ask: "Assets bought or sold in the year, such as a rental's chattels",
    books:
      bought.length + sold.length === 0
        ? "None in the asset register for the year."
        : `In the asset register: ${bought.length} bought, ${sold.length} sold.`,
    ifYes: "Give the invoices or sale documents.",
  });

  // 5. Changes during the year.
  out.push({
    id: "home-business",
    section: "Changes and other",
    ask: "Part of the home used for a business",
    ifYes:
      "The business's share of insurance, mortgage interest or rent, power, rates and repairs, by " +
      "floor area, is claimed in the business's accounts, not on this return.",
  });
  out.push({
    id: "changes",
    section: "Changes and other",
    ask: "Changes to finance or loans, to a rental or mixed-use asset, or to address, email or phone",
    ifYes: "Say what changed.",
  });

  // 6. The rest of the accountant's checklist: for a business, a trust or a
  // farm more than for a person and their rentals, so optional -- there for
  // whoever it does apply to, and skipped by everybody else.
  const optional: [string, string, string?][] = [
    ["vehicle", "A motor vehicle used partly privately: a new logbook completed in the year (a 3-month logbook is needed every 3 years)"],
    ["cash", "Cash on hand, or a till or petty cash balance, at 31 March"],
    ["debtors", "People who owe you money at 31 March (a debtors list), and bad debts written off"],
    ["creditors", "People you owe money at 31 March (a creditors list)"],
    ["stock", "Stock on hand or work in progress at 31 March"],
    ["deposits", "Income received in advance (deposits) at 31 March"],
    ["personal-use", "Goods or cash taken for personal use"],
    ["holiday-pay", "Holiday pay owing at 31 March, or paid within 63 days of it"],
    ["shareholders", "Changes to a company's shareholders, directors or shareholdings"],
    ["trust", "Trust distributions, gifts or debt forgiveness, or changes to a trust deed"],
    ["moe", "Childcare: Ministry of Education funding statements to 1 July"],
    ["livestock", "Farm: livestock numbers at 31 March by age and sex, with births, deaths and stock killed for private use"],
  ];
  for (const [id, ask] of optional) {
    out.push({ id: `optional-${id}`, section: "Other items on the checklist (if they apply)", ask, optional: true });
  }
  return out;
}

/** Lines coded to a donations account, from the person's own entity. */
function donationsCoded(owner: string, from: string, to: string): number {
  const model = state.ledger.entities ?? emptyEntityModel();
  const theirs = new Set(
    model.entities
      .filter((e) => e.kind === "personal" && (e.owners ?? []).length === 1 && e.owners?.[0]?.name === owner)
      .map((e) => e.id),
  );
  const codes = new Set(
    state.chart
      .filter((a) => /donation/i.test(a.name))
      .filter((a) => {
        const key = `${a.code.trim()}|${a.name.trim()}`;
        const id = model.accounts[key] ?? model.accounts[a.code.trim()];
        return id === undefined || theirs.has(id);
      })
      .map((a) => a.code.trim()),
  );
  if (codes.size === 0) return 0;
  const overrides = state.ledger.overrides ?? {};
  return state.ledger.transactions
    .filter((t) => t.date >= from && t.date <= to)
    .filter((t) => {
      const code = overrides[t.id]?.code ?? "";
      return [...codes].some((c) => new RegExp(`\\b${c}\\b`).test(code));
    })
    .reduce((s, t) => s - t.amount, 0);
}

function keyOf(owner: string, year: number, id: string): string {
  return `${owner}\u0000${year}\u0000${id}`;
}

export function answerOf(owner: string, year: number, id: string): PersonalYearAnswer | undefined {
  return state.ledger.personalYearAnswers?.[keyOf(owner, year, id)];
}

async function keepAnswer(owner: string, year: number, id: string, answer: PersonalYearAnswer | null): Promise<void> {
  const before = state.ledger.personalYearAnswers ?? {};
  const after = { ...before };
  if (answer === null) delete after[keyOf(owner, year, id)];
  else after[keyOf(owner, year, id)] = answer;
  state.ledger = { ...state.ledger, personalYearAnswers: after };
  state.persistent = await save(state.ledger);
  await record("ir3Details", `${owner} FY${year}: year-end checklist, ${id}`, before, after);
}

/** The checklist on the page: each question, what the books show, and its answer. */
export function checklistPanel(owner: string, year: number, redraw: () => void): HTMLElement {
  const wrap = document.createElement("div");
  wrap.className = "personal-checklist";
  const questions = checklistQuestions(owner, year);
  let section = "";
  for (const q of questions) {
    if (q.section !== section) {
      section = q.section;
      const h = document.createElement("h4");
      h.textContent = section;
      wrap.append(h);
      if (q.optional === true) {
        const hint = document.createElement("p");
        hint.className = "field-hint";
        hint.textContent = "Leave these if they do not apply.";
        wrap.append(hint);
      }
    }
    const held = answerOf(owner, year, q.id);
    const row = document.createElement("div");
    row.className = "checklist-row";
    const ask = document.createElement("div");
    const strong = document.createElement("strong");
    strong.textContent = q.ask;
    ask.append(strong);
    if (q.books !== undefined) {
      const books = document.createElement("div");
      books.className = "field-hint";
      books.textContent = `The books: ${q.books}`;
      ask.append(books);
    }
    if (held?.answer === "yes" && q.ifYes !== undefined) {
      const more = document.createElement("div");
      more.className = "field-hint";
      more.textContent = q.ifYes;
      ask.append(more);
    }

    const answers = document.createElement("div");
    answers.className = "checklist-answer";
    for (const [value, label] of [["yes", "Yes"], ["no", "No"], ["na", "Not applicable"]] as const) {
      const choice = document.createElement("label");
      const radio = document.createElement("input");
      radio.type = "radio";
      radio.name = `cl-${q.id}`;
      radio.checked = held?.answer === value;
      radio.addEventListener("change", () => {
        void keepAnswer(owner, year, q.id, { ...(held ?? {}), answer: value }).then(redraw);
      });
      choice.append(radio, ` ${label} `);
      answers.append(choice);
    }
    const detail = document.createElement("input");
    detail.type = "text";
    detail.placeholder = q.amount === true ? "Amount, and details" : "Details (optional)";
    detail.value = held?.detail ?? "";
    detail.addEventListener("change", () => {
      const text = detail.value.trim();
      void keepAnswer(owner, year, q.id, {
        answer: held?.answer ?? "yes",
        ...(text !== "" ? { detail: text } : {}),
      }).then(redraw);
    });
    answers.append(detail);
    row.append(ask, answers);
    wrap.append(row);
  }
  return wrap;
}

/** How many questions are still unanswered. */
export function checklistOpen(owner: string, year: number): number {
  return checklistQuestions(owner, year).filter(
    (q) => q.optional !== true && answerOf(owner, year, q.id) === undefined,
  ).length;
}

function esc(text: string): string {
  return text.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] ?? c);
}

/** The checklist as a page of the year-end pack, for signing. */
export function checklistHtml(owner: string, year: number): string {
  const said = { yes: "Yes", no: "No", na: "N/A" } as const;
  const rows = checklistQuestions(owner, year)
    .map((q) => {
      const held = answerOf(owner, year, q.id);
      return (
        `<tr><td>${esc(q.section)}</td><td>${esc(q.ask)}${q.books ? `<div class="note">Books: ${esc(q.books)}</div>` : ""}</td>` +
        `<td>${held === undefined ? "" : said[held.answer]}</td><td>${esc(held?.detail ?? "")}</td></tr>`
      );
    })
    .join("");
  return (
    `<h3>${year} financial year checklist</h3>` +
    '<table class="grid"><thead><tr><th>Section</th><th>Question</th><th>Answer</th><th>Details</th></tr></thead>' +
    `<tbody>${rows}</tbody></table>` +
    '<p style="margin-top:28px">I confirm the information provided is complete and correct to the best of my knowledge.</p>' +
    `<p>Name: ${esc(owner)}</p><p>Signature: ______________________________ &nbsp; Date: ________________</p>`
  );
}
