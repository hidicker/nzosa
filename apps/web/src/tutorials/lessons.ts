import { DEMO_PERSONAS, currentDemoPersona } from "../demo-personas.js";
import { noSalesTax } from "../country.js";
import { onScreen } from "./engine.js";
import type { Lesson } from "./engine.js";

/**
 * The lessons, written for the demo books.
 *
 * Each one points at real parts of the screen by the same selectors the app
 * draws them with. A step whose target is not there -- a page the visitor's
 * books do not have -- shows its card without a ring rather than failing.
 */

const q = (selector: string) => (): Element | null => document.querySelector(selector);
const visible = (selector: string) => (): Element | null =>
  [...document.querySelectorAll(selector)].find((e) => e instanceof HTMLElement && e.offsetParent !== null) ?? null;

/** The bank line a lesson is about: the first one waiting on Reconcile. */
const firstLine = (): HTMLElement | null => document.querySelector<HTMLElement>("#reconcile-body .code-row");
let watchedLine = "";
const suggested = (): boolean =>
  (firstLine()?.querySelector<HTMLInputElement>(".combo-input")?.value.trim() ?? "") !== "";

/** The first line on Reconcile whose suggestion came from a given place. */
const lineSuggestedBy = (said: RegExp) => (): Element | null =>
  [...document.querySelectorAll("#reconcile-body .code-row .code-reason-ai")].find((e) => said.test(e.textContent ?? ""))
    ?.closest(".code-row") ?? null;

/** Show a report on the Reports page: only what is on screen changes. */
const report = (kind: string) => (): void => {
  const choose = document.getElementById("report-kind");
  if (choose instanceof HTMLSelectElement && choose.value !== kind) {
    choose.value = kind;
    choose.dispatchEvent(new Event("change"));
  }
};

/** The first visible element matching a selector whose text matches. */
const withText = (selector: string, text: RegExp) => (): Element | null =>
  [...document.querySelectorAll(selector)].find(
    (e) => e instanceof HTMLElement && e.offsetParent !== null && text.test(e.textContent ?? ""),
  ) ?? null;

/** Whether a figure on the Reports page has been opened to its lines. */
const opened = (): boolean => document.querySelector("#reports-body tr.report-behind") !== null;

export const LESSONS: readonly Lesson[] = [
  {
    id: "welcome",
    title: "Get to know NZOSA",
    summary: "What NZOSA does, how the menu is arranged, and where your books live.",
    minutes: 2,
    steps: [
      {
        title: "Welcome",
        body: () =>
          (noSalesTax()
            ? "NZOSA turns your bank files into a coded, double-entry set of books, and from those your " +
              "financial statements and the figures for Schedule C, Schedule E and 1099-NEC. "
            : "NZOSA turns your bank files into a coded, double-entry set of books, and from those your GST returns, " +
              "financial statements and tax returns. ") +
          (DEMO_PERSONAS.find((p) => p.id === currentDemoPersona())?.about ?? ""),
        page: "reconcile",
      },
      {
        title: "Daily",
        body:
          "The work you come back to: bank lines waiting for an account, anything that needs your attention, " +
          "and the invoices you send and the bills you pay.",
        target: q('.sidebar-group[data-group="daily"]'),
      },
      {
        title: "Actions required",
        body: () =>
          "What needs you, in the order it matters: lines left to code, " +
          (noSalesTax() ? "" : "a GST return coming due, ") +
          "an invoice overdue. The number beside it is how many.",
        target: visible('.sidebar-nav [data-page="actions"]'),
      },
      {
        title: "Reporting",
        body:
          "Profit and loss, balance sheet, cash flow, aged receivables and the rest. Every figure opens to the " +
          "lines behind it.",
        target: q('.sidebar-group[data-group="reporting"]'),
      },
      {
        title: "Year end",
        body: () =>
          noSalesTax()
            ? "The year-end work, and a pack your accountant can check."
            : "The year-end work: rental schedules, the IR3, IR4 or IR10, and a pack your accountant can check.",
        target: q('.sidebar-group[data-group="yearend"]'),
        when: () => onScreen(document.querySelector('.sidebar-group[data-group="yearend"]')),
      },
      {
        title: "Set up",
        body: () =>
          "Done once and then rarely: your entities, chart of accounts, " +
          (noSalesTax() ? "" : "GST settings, ") +
          "opening balances and coding rules. Pages only appear for what your books use, so a sole trader " +
          "never sees a trust's.",
        target: q('.sidebar-group[data-group="setup"]'),
      },
      {
        title: "Search",
        body: "Any page or report, by name. Press Ctrl+K from anywhere.",
        target: q("#menu-search"),
        when: () => onScreen(document.getElementById("menu-search")),
      },
      {
        title: "Where your books live",
        body:
          "Installed on your own computer, your books are plain files in a folder you choose, and nothing is " +
          "uploaded. In this demo they are kept in this browser, so try anything: Start the demo again puts them back.",
      },
    ],
  },
  {
    id: "code-a-line",
    title: "Code a bank line",
    get summary() {
      return noSalesTax()
        ? "Give a bank line its account, confirm it, and see what NZOSA learns from it."
        : "Give a bank line its account and GST, confirm it, and see what NZOSA learns from it.";
    },
    minutes: 3,
    steps: [
      {
        title: "Bank lines to code",
        body:
          "Every line from your bank files and feeds lands here until it has an account. Coding is most of " +
          "bookkeeping, so this is where the time goes, and where NZOSA saves the most of it.",
        page: "reconcile",
        target: firstLine,
      },
      {
        title: "What the bank said",
        body: "The date, who the money went to or came from, the bank's description, and which of your accounts it was on.",
        target: () => firstLine()?.querySelector(".code-bank") ?? null,
      },
      {
        title: "The account",
        body: () =>
          suggested()
            ? "NZOSA has already suggested one, from how lines like this were coded before. Type in the box to " +
              "choose a different account."
            : "Nothing like this line has been coded before, so there is no suggestion yet. Type in the box to " +
              "search the accounts: a name or a number.",
        target: () => firstLine()?.querySelector(".combo") ?? null,
      },
      {
        title: "Why it was suggested",
        body: "The GST treatment, and the reason for the suggestion, so you can tell a good guess from a lucky one.",
        target: () => firstLine()?.querySelector(".code-reason") ?? null,
      },
      {
        title: "GST",
        body:
          "15% for an ordinary purchase or sale, 0% for anything with no GST in it, such as bank fees or wages. " +
          "The GST return adds these up for you.",
        target: () => firstLine()?.querySelector(".gst-select") ?? null,
        // Where there is no sales tax there is no rate to choose.
        when: () => !noSalesTax(),
      },
      {
        title: "Confirm it",
        body: () =>
          noSalesTax()
            ? "Confirming puts the line in the books: it now counts in the reports and the tax schedules."
            : "Confirming puts the line in the books: it now counts in the reports and the GST return.",
        task: () => (suggested() ? "Press ✓ on this line." : "Choose an account, then press ✓."),
        target: () => firstLine()?.querySelector(".code-tick") ?? null,
        before: () => {
          watchedLine = firstLine()?.dataset["id"] ?? "";
        },
        done: () => {
          if (watchedLine === "") return false;
          const row = document.querySelector<HTMLElement>(`#reconcile-body .code-row[data-id="${watchedLine}"]`);
          return row === null || row.querySelector(".code-tick.tick-live") === null;
        },
      },
      {
        title: "Suggested by AI",
        body:
          "Where nothing you have coded before fits, an AI model you choose can suggest the account, and says how " +
          "sure it is, why, and anything to check. The ones in this demo are examples, written by hand. Nothing " +
          "is used until you confirm it.",
        target: lineSuggestedBy(/^AI suggestion/),
      },
      {
        title: "A known New Zealand business",
        body:
          "NZOSA also recognises well-known New Zealand businesses, such as fuel stations, phone companies and " +
          "couriers, and suggests the one account in your chart that fits. It needs no AI and sends nothing anywhere.",
        target: lineSuggestedBy(/^Known NZ business/),
      },
      {
        title: "Done",
        body:
          "The line you confirmed is in the books, and the next line from the same payee will be suggested the " +
          "same way. When the suggestions on a page all look right, Accept all confirms them in one go.",
        target: q("#accept-all"),
      },
    ],
  },
  {
    id: "invoices",
    title: "Invoices and getting paid",
    summary: "Send an invoice, see a payment matched to it, and set an invoice to repeat.",
    minutes: 3,
    books: [""],
    steps: [
      {
        title: "Invoices at a glance",
        body: "What has been paid in full, what is part paid, and what is still owing, worked out from the bank lines.",
        page: "invoices",
        target: q("#invoices-body .check-summary"),
      },
      {
        title: "Still owing",
        body:
          "Each invoice not yet paid: who it is to, when it is due and how much is left. Overdue ones show on " +
          "Actions required too.",
        target: q("#invoices-body table.match-table tbody tr"),
      },
      {
        title: "The invoice itself",
        body:
          "A tax invoice ready to print or save as a PDF, with your logo, GST number and bank account on it. " +
          "It is made from the books, so it can never disagree with them.",
        target: visible("#invoices-body .invoice-send"),
      },
      {
        title: "Email it",
        body:
          "Opens a new message in your own mail program, addressed to the customer and saying what is owing, " +
          "and saves the invoice to attach. NZOSA never sends mail itself.",
        target: withText("#invoices-body .invoice-send", /^email$/),
      },
      {
        title: "Matched to the bank",
        body:
          "When a payment arrives, NZOSA finds the invoice it settles: by the invoice number in the reference, " +
          "then by amount and date. This says how it knew. Anything less certain waits for you to confirm.",
        target: visible("#invoices-body td.match-how"),
      },
      {
        title: "Repeating invoices",
        body:
          "Rent, a retainer, a monthly supply: set an invoice to repeat weekly, monthly or yearly. The invoices " +
          "are made as drafts when you press the button, so nothing reaches the books unseen.",
        target: q("#recurring-body summary"),
      },
      {
        title: "A new invoice",
        body: "Write one from scratch here. The customer's email is remembered from the last invoice to them.",
        target: q("#invoice-new"),
      },
    ],
  },
  {
    id: "gst",
    title: "Your GST return",
    summary: "Read the return for a period, open a box to the lines behind it, and file it.",
    minutes: 2,
    books: ["", "payroll"],
    steps: [
      {
        title: "The GST return",
        body:
          "Worked out from the coded bank lines and invoices, box by box as myIR asks for it. It is always up to " +
          "date: code a line and the return changes. Choose the period here.",
        page: "reports",
        before: report("gstreturn"),
        target: q("#reports-body select"),
      },
      {
        title: "The boxes",
        body: "Sales and income, then purchases and expenses, and the GST on each. The difference is what you pay or get back.",
        target: withText("#reports-body button.link-button", /Total sales and income/),
      },
      {
        title: "Where a figure comes from",
        body: "Every box opens to the lines that make it up, so you can check it before filing.",
        task: "Press Total sales and income.",
        target: withText("#reports-body button.link-button", /Total sales and income/),
        done: opened,
      },
      {
        title: "Filed",
        body:
          "Once you have filed it in myIR, mark it filed here. A change to that period afterwards then shows as a " +
          "difference, instead of quietly altering a return already sent. In the demo there is no need.",
        target: withText("#reports-body button.primary", /Mark as filed/),
      },
    ],
  },
  {
    id: "reports",
    title: "Reports",
    summary: "Profit and loss, the balance sheet, and any figure opened to its lines.",
    minutes: 2,
    steps: [
      {
        title: "All reports",
        body: "Financial statements, tax, and the detail behind them. Star the ones you use and they stay at the top.",
        page: "reports",
        before: report("home"),
        target: q("#reports-body"),
      },
      {
        title: "Profit and loss",
        body: "Income and expenses for the year, set out the way an accountant reads them. Choose the year here.",
        before: report("pl"),
        target: q("#report-year"),
      },
      {
        title: "Open a figure",
        body: "Every figure opens to the entries behind it: the bank lines, invoices and journals.",
        task: "Press any account name in the report.",
        target: visible("#reports-body button.link-button"),
        done: opened,
      },
      {
        title: "Balance sheet",
        body:
          "What is owned and what is owed at year end. It has to balance, so a mistake shows up as a figure that " +
          "does not add up.",
        before: report("balancesheet"),
        target: q("#reports-body"),
      },
      {
        title: "For your accountant",
        body: "The whole year in one Excel workbook: every report and every line, for an accountant to check.",
        target: q("#report-download-excel"),
      },
    ],
  },
  {
    id: "year-end",
    title: "Year end",
    summary: "The company's IR4, the rental schedules, and each owner's IR3.",
    minutes: 2,
    books: [""],
    steps: [
      {
        title: "The company's tax return",
        body:
          "Kea Coffee Roasters files an IR4. This page works it out from the books in the order of the form, and " +
          "says what each part needs from you.",
        page: "ir4",
        target: q("#ir4-body h3"),
      },
      {
        title: "Imputation credits",
        body: "The imputation credit account, worked out alongside, for when the company pays tax or a dividend.",
        target: withText("#ir4-body h3", /Imputation/),
      },
      {
        title: "The rentals' year",
        body:
          "Each rental property, its owners and its net rental income, with the property manager's statements " +
          "and trips made to it in your own car.",
        page: "rentalyear",
        target: visible("#rentalyear-body summary"),
      },
      {
        title: "Rental schedules",
        body: "Set out as a practitioner sets them out, one per property, split between the owners.",
        page: "reports",
        before: report("rentals"),
        target: q("#reports-body"),
      },
      {
        title: "Each owner's IR3",
        body:
          "Ana's and Tom's own returns: their share of each rental, plus income that never reaches these bank " +
          "accounts, such as salary and interest.",
        before: report("ir3"),
        target: q("#reports-body"),
      },
    ],
  },
  {
    id: "payroll",
    title: "Pay your staff",
    summary: "Employees, a pay run, payday filing, and what is owed to Inland Revenue each month.",
    minutes: 3,
    books: ["payroll"],
    steps: [
      {
        title: "Payroll",
        body:
          "Pay runs, employees and their leave. PAYE, student loan, KiwiSaver and ESCT are worked out by Inland " +
          "Revenue's payroll specification for each payday's tax year.",
        page: "payroll",
        before: () => document.getElementById("payroll-tab-runs")?.click(),
        target: q("#payroll-tabs"),
      },
      {
        title: "The staff",
        body:
          "Mere is on a salary; Josh and Aroha are paid by the hour. Each has a tax code, a KiwiSaver rate and a " +
          "bank account. Josh's tax code includes a student loan.",
        task: "Open Employees.",
        target: q("#payroll-tab-employees"),
        done: () => document.getElementById("payroll-tab-employees")?.classList.contains("active") === true,
      },
      {
        title: "A pay run",
        body:
          "Every second Wednesday: gross pay, PAYE, KiwiSaver and net pay for each person. In the books means it " +
          "has posted: wages to the expense, PAYE and KiwiSaver to what is owed to Inland Revenue.",
        before: () => document.getElementById("payroll-tab-runs")?.click(),
        target: withText("#payroll-body h4", /Pay Date/),
      },
      {
        title: "Payday filing",
        body: "The Employment Information file for myIR, due within two working days of each payday. One press makes it.",
        target: withText("#payroll-body button", /Payday Filing/),
      },
      {
        title: "What goes to Inland Revenue",
        body:
          "Each month's PAYE, student loan, KiwiSaver and ESCT, and the date it is due. Each payment on the bank " +
          "statement clears one month, so at year end only March's is still owing, due on 20 April.",
        target: withText("#payroll-body h3", /Employer deductions/),
      },
      {
        title: "The next pay run",
        body: "The next period is filled in from the last. Change anyone's hours, add a bonus, and check it before it posts.",
        target: q("#payroll-new-run"),
      },
    ],
  },
  {
    id: "society",
    title: "Grants and the club's accounts",
    summary: "A grant tracked from award to report, the society's reporting standard, and its IR9.",
    minutes: 3,
    books: ["society"],
    steps: [
      {
        title: "A grant",
        body:
          "Tasman Community Trust gave the club $6,000 for two training dinghies. Awarded, received, spent and " +
          "still held, worked out from the bank lines linked to it.",
        page: "grants",
        target: withText("#grants-body *", /^Awarded/),
      },
      {
        title: "Linked to the bank",
        body: "Which bank lines brought the money in and which spent it: the dinghies, and their sails and fittings.",
        target: withText("#grants-body button", /Link bank lines/),
      },
      {
        title: "The funder's report",
        body: "What the funder asks for once the money is spent: what it was for, and every payment against it.",
        target: withText("#grants-body button", /Funder's report/),
      },
      {
        title: "Money not yet spent",
        body:
          "This grant has to be returned if it is not used, so what is unspent at balance date is owed, not " +
          "earned. One press moves it to Grants received in advance for the year end. There is no need here.",
        target: withText("#grants-body button", /Post the entry/),
      },
      {
        title: "Which standard applies",
        body:
          "The club's last two years decide how much its statements must show. Under $50,000 of payments and " +
          "assets, a society can use the minimum requirements.",
        page: "society",
        target: withText("#society-body h3", /Which standard/),
      },
      {
        title: "The statements",
        body: "Income and expenditure, assets and liabilities, ready for the committee to approve and file with the Companies Office.",
        target: withText("#society-body button", /Open the statements/),
      },
      {
        title: "The IR9",
        body:
          "A club's income tax return. Members' subscriptions are not income; what it earns from others, such as " +
          "regatta entries, can be. The page works through it in the order of the form.",
        page: "ir9",
        target: withText("#page-ir9 h3", /The return/),
      },
    ],
  },
  {
    id: "trust",
    title: "The trust and its IR6",
    summary: "The trust's people, income allocated to beneficiaries, and the IR6 with its beneficiary pages.",
    minutes: 3,
    books: ["trust"],
    steps: [
      {
        title: "The beneficiaries",
        body:
          "Ana, Tom and Maia. Ana's and Tom's accounts in the books hold what the trust owes them. Maia is 13, so " +
          "income allocated to her over $1,000 would be taxed under the minor rule.",
        page: "trustpeople",
        target: withText("#trust-people-body h3", /Beneficiaries/),
      },
      {
        title: "The settlor",
        body: "Joan Whitcombe settled the trust in 2014 and sold it the house for a loan she still holds.",
        target: withText("#trust-people-body h3", /Settlors/),
      },
      {
        title: "What the trust earned",
        body: "Rent from the house is residential rent, with its own box; term deposit interest goes in the interest box with its RWT.",
        page: "ir6",
        target: withText("#page-ir6 h3", /What was earned/),
      },
      {
        title: "Income allocated",
        body:
          "The trustees allocated $1,500 each to Ana and Tom at balance date. It is credited to their accounts by " +
          "a journal in the books, and taxed at their own rates rather than the trustee's.",
        target: withText("#page-ir6 h3", /Beneficiaries: income/),
      },
      {
        title: "The return",
        body:
          "Box by box. What is left with the trustees is taxed at 33%, because the trustee income is under " +
          "$10,000; the RWT already taken off the interest is credited against it.",
        target: withText("#page-ir6 h3", /The return/),
      },
      {
        title: "The beneficiaries' pages",
        body: "An IR6B for each beneficiary allocated income, with the tax paid for them, which they then include in their own return.",
        target: withText("#page-ir6 h3", /IR6B/),
      },
    ],
  },
  {
    id: "personal",
    title: "Sam's IR3",
    summary: "What the return needs, income from myIR, the rental flat's year, and the IR3 itself.",
    minutes: 3,
    books: ["personal"],
    steps: [
      {
        title: "What the return needs",
        body: "A checklist for the year: the bank lines coded, who owns each rental, and the income these accounts cannot show.",
        page: "personalyear",
        target: withText("#page-personalyear h3", /What the return needs/),
      },
      {
        title: "Income from myIR",
        body:
          "Salary and its PAYE, interest and its RWT, dividends and their credits, as Inland Revenue holds them. " +
          "The gross figures come from here, not the bank, so nothing is counted twice.",
        target: withText("#page-personalyear h3", /Other income for the return/),
      },
      {
        title: "The flat's year",
        body: "Rent, interest, rates, insurance and repairs for Flat 2, as a rental schedule sets them out.",
        target: withText("#page-personalyear strong", /Each rental's year end/),
      },
      {
        title: "The year-end pack",
        body: "Everything an accountant would want to check, in one document to print or save as a PDF.",
        target: withText("#page-personalyear button", /Open the year-end pack/),
      },
      {
        title: "The IR3",
        body:
          "Box by box. The salary's PAYE already covers its tax, so what is left to pay is mostly the tax on the " +
          "flat's profit.",
        page: "reports",
        before: report("ir3"),
        target: q("#reports-body"),
      },
    ],
  },
  {
    id: "us-schedules",
    title: "Schedule C, Schedule E and 1099-NEC",
    summary: "The business's profit, the duplex's rental income, and which contractors need a 1099-NEC.",
    minutes: 3,
    books: ["us"],
    steps: [
      {
        title: "One set of books, two returns' worth",
        body:
          "The studio is a sole proprietorship and the duplex is a rental, each its own entity in the same books. " +
          "Their figures are kept apart, and each has the schedule it goes on.",
        page: "reports",
        before: report("home"),
        target: q("#reports-body"),
      },
      {
        title: "Schedule C: the business",
        body:
          "Gross receipts, then each expense on the line the form gives it: car and truck, contract labor, " +
          "supplies, and so on. Meals are shown in full beside the half the form allows.",
        before: report("schedulec"),
        target: q("#reports-body"),
      },
      {
        title: "Schedule E: the rental",
        body:
          "Rents received, then mortgage interest, property taxes, insurance, repairs and the management fee on " +
          "their lines. Depreciation and personal-use days are for you to add before filing.",
        before: report("schedulee"),
        target: q("#reports-body"),
      },
      {
        title: "Contractors and 1099-NEC",
        body:
          "Everybody paid for contract labor, with what each was paid in the year. Anyone paid $2,000 or more " +
          "from 2026 needs a 1099-NEC; those below are listed too, so you can see how close they are.",
        before: report("contractors"),
        target: q("#reports-body"),
      },
      {
        title: "Open a figure",
        body: "Every figure opens to the bank lines behind it, so you can check it before it goes on a return.",
        task: "Press any account name in the report.",
        before: report("pl"),
        target: withText("#reports-body button.link-button", /./),
        done: opened,
      },
    ],
  },
  {
    id: "us-quickbooks",
    title: "Moving from QuickBooks",
    summary: "Bring a QuickBooks company across: two exports from QuickBooks Online, or an IIF file from QuickBooks Desktop.",
    minutes: 2,
    books: ["us"],
    steps: [
      {
        title: "Two exports",
        body:
          "In QuickBooks Online, export the Chart of accounts, and run the General ledger report for all accounts " +
          "and export that. Both come out as CSV or Excel.",
        page: "setup",
      },
      {
        title: "Drop them in",
        body:
          "Drop both files on Setup, or on Start here. NZOSA works out what each one is: the chart becomes the " +
          "chart, the bank and card postings become bank lines, invoices and bills come in with their payments, " +
          "and the rest of the entries become journals. From QuickBooks Desktop, drop its IIF file instead: it " +
          "holds the accounts, customers, vendors and transactions in one.",
        target: visible("#setup-drop, .dropzone"),
      },
      {
        title: "The coding comes with them",
        body:
          "The account on the other side of each posting is read as the coding. It is checked against the books " +
          "on Coding reconciliation, and what is the same every time becomes a rule, so the next lines are suggested.",
        page: "check",
      },
      {
        title: "What comes out different",
        body:
          "Account codes: QuickBooks Online has none, so they are made, in ranges by type. A credit card shows " +
          "as a bank account with a negative balance, as it does in Xero; net assets are the same.",
      },
    ],
  },
  {
    id: "us-customers",
    title: "Customers, time and getting paid",
    summary: "Customer records, hours turned into an invoice, and a reminder for an invoice past due.",
    minutes: 3,
    books: ["us"],
    steps: [
      {
        title: "Customers and vendors",
        body:
          "Each customer and vendor has a record: email, address, terms and a credit limit, and for a vendor " +
          "whether a W-9 is on file and a 1099-NEC is due. What each owes or is owed is beside them.",
        page: "contacts",
      },
      {
        title: "Past due",
        body:
          "Lakeside Realty has an invoice weeks past due. Reminder makes a letter to print or email, firmer the " +
          "later it is. Late fee drafts an invoice for a percentage of what is past due, for you to approve.",
        page: "contacts",
      },
      {
        title: "Time",
        body:
          "Hours worked for a customer, at a rate. Northwind Dental has some not invoiced yet: Make invoice " +
          "drafts the invoice with a line for each entry.",
        page: "time",
      },
      {
        title: "Classes",
        body:
          "Give bank lines and invoices a class, such as a job or a department, and the Profit and loss by " +
          "class report shows what each one made.",
        page: "classes",
      },
    ],
  },
];
