import { redraw } from "../app.js";
import { bookYears, record } from "../books.js";
import { taxYearStart } from "../tax-year.js";
import { booksCurrency, booksLocale } from "../country.js";
import { $, state } from "../state.js";
import { save, savePart } from "../store.js";
import { askOnPage, note, tellOnPage } from "../ui.js";
import { foreignInUse, missingRates } from "@nzosa/core";
import type { Account } from "@nzosa/core";
import { exchangeAccounts, fxRates } from "../fx-books.js";

/**
 * Currencies: the ones these books use besides their own, the rate each is
 * turned into the books' currency at, and the accounts the differences go to.
 *
 * Rates are kept by date. The rate for a day is the latest given on or before
 * it. They can be typed in, or fetched from the European Central Bank's daily
 * reference rates (through frankfurter.dev, which needs no key): only the
 * currency, the books' currency and the dates are asked for.
 */

type Held = Record<string, { date: string; rate: number }[]>;

const held = (): Held => (state.ledger.fxRates ?? {}) as Held;

async function keepRates(next: Held, what: string): Promise<void> {
  const before = held();
  state.ledger = { ...state.ledger, fxRates: next };
  state.persistent = await save(state.ledger);
  await record("fxRates", what, before, next);
  redraw("currencies");
  redraw("reports");
}

/** The usual currencies, to offer on a document. */
export const COMMON_CURRENCIES = ["AUD", "USD", "EUR", "GBP", "CAD", "JPY", "SGD", "HKD", "CNY", "CHF", "FJD", "NZD"];

/** Realised and unrealised currency gains, added to the chart where they are not there. */
async function addExchangeAccounts(): Promise<void> {
  const taken = new Set(state.chart.map((a) => a.code.trim()));
  const free = (wanted: string): string => {
    let n = Number(wanted);
    while (taken.has(String(n))) n += 1;
    taken.add(String(n));
    return String(n);
  };
  const add: Account[] = [
    { code: free("498"), name: "Unrealised Currency Gains", type: "Overhead", taxCode: "No GST", description: "Foreign currency balances revalued at the balance date.", gstTreatment: "out-of-scope" },
    { code: free("499"), name: "Realised Currency Gains", type: "Overhead", taxCode: "No GST", description: "The difference when foreign currency is paid or received at another rate.", gstTreatment: "out-of-scope" },
  ];
  const chart = [...state.chart, ...add];
  state.chart = chart;
  state.ledger = { ...state.ledger, chart };
  state.persistent = await savePart(state.ledger, "chart");
  await record("chartImport", "Currency gains accounts added", state.chart.filter((a) => !add.includes(a)), chart);
  redraw("currencies");
}

/** The ECB's daily rates for a currency over a span, from frankfurter.dev. */
async function fetchRates(currency: string, from: string, to: string): Promise<{ date: string; rate: number }[]> {
  const books = booksCurrency();
  const url = `https://api.frankfurter.dev/v1/${from}..${to}?from=${encodeURIComponent(currency)}&to=${encodeURIComponent(books)}`;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`The rates service answered ${response.status}.`);
  const body = (await response.json()) as { rates?: Record<string, Record<string, number>> };
  return Object.entries(body.rates ?? {})
    .map(([date, by]) => ({ date, rate: by[books] ?? 0 }))
    .filter((r) => r.rate > 0)
    .sort((a, b) => a.date.localeCompare(b.date));
}

function currencySection(body: HTMLElement, currency: string, use: { from: string; to: string; lines: number; documents: number } | undefined): void {
  const list = [...(held()[currency] ?? [])].sort((a, b) => b.date.localeCompare(a.date));
  const books = booksCurrency();
  const heading = document.createElement("h3");
  heading.textContent = currency;
  body.append(heading);
  const used =
    use === undefined
      ? "Not used yet."
      : `${use.lines} bank ${use.lines === 1 ? "line" : "lines"} and ${use.documents} ${use.documents === 1 ? "document" : "documents"}, ${use.from} to ${use.to}.`;
  body.append(note(`${used} ${list.length === 0 ? "No rates yet: nothing in it is converted, so its amounts count as if they were " + books + "." : `${list.length} ${list.length === 1 ? "rate" : "rates"}, ${list[list.length - 1]!.date} to ${list[0]!.date}.`}`));

  const row = document.createElement("div");
  row.className = "contacts-controls";
  const fetchButton = document.createElement("button");
  fetchButton.type = "button";
  fetchButton.className = list.length === 0 ? "primary" : "";
  fetchButton.textContent = "Fetch daily rates";
  fetchButton.title = "The European Central Bank's reference rates, through frankfurter.dev. Only the currencies and the dates are sent.";
  // From its first use, or -- not used yet -- from the start of the books.
  const oldest = bookYears().at(-1);
  const from = use?.from ?? (oldest !== undefined ? taxYearStart(oldest) : new Date().toLocaleDateString("en-CA"));
  const today = new Date().toLocaleDateString("en-CA");
  fetchButton.addEventListener("click", () => {
    fetchButton.disabled = true;
    fetchButton.textContent = "Fetching…";
    void fetchRates(currency, from < today ? from : today, today)
      .then(async (got) => {
        if (got.length === 0) {
          await tellOnPage(`No rates came back for ${currency} to ${books}. The European Central Bank publishes about thirty currencies; type this one's in below.`);
          redraw("currencies");
          return;
        }
        // Typed rates are kept; fetched ones fill the rest.
        const byDate = new Map((held()[currency] ?? []).map((r) => [r.date, r]));
        for (const r of got) if (!byDate.has(r.date)) byDate.set(r.date, r);
        await keepRates({ ...held(), [currency]: [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date)) }, `${got.length} ${currency} rates fetched, ${got[0]!.date} to ${got[got.length - 1]!.date}`);
      })
      .catch(async (error: unknown) => {
        await tellOnPage(`The rates could not be fetched: ${(error as Error).message || "no answer"}. Type them in below instead.`);
        redraw("currencies");
      });
  });
  const date = document.createElement("input");
  date.type = "date";
  date.value = today;
  const rate = document.createElement("input");
  rate.type = "text";
  rate.inputMode = "decimal";
  rate.placeholder = `${books} for 1 ${currency}`;
  rate.className = "payroll-tiny-input";
  const add = document.createElement("button");
  add.type = "button";
  add.textContent = "Add rate";
  add.addEventListener("click", () => {
    const value = Number(rate.value.trim());
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date.value) || !(value > 0)) {
      void tellOnPage(`A date, and how many ${books} one ${currency} buys, such as 1.6842.`);
      return;
    }
    const kept = (held()[currency] ?? []).filter((r) => r.date !== date.value);
    void keepRates({ ...held(), [currency]: [...kept, { date: date.value, rate: value }].sort((a, b) => a.date.localeCompare(b.date)) }, `${currency} rate on ${date.value}: ${value}`);
  });
  row.append(fetchButton, " or ", date, rate, add);
  body.append(row);

  if (list.length > 0) {
    const details = document.createElement("details");
    const summary = document.createElement("summary");
    summary.textContent = `The ${list.length} ${currency} rates`;
    const table = document.createElement("table");
    table.className = "report-table owner-table";
    table.innerHTML = `<thead><tr><th>Date</th><th>${books} for 1 ${currency}</th><th></th></tr></thead>`;
    const tbody = document.createElement("tbody");
    for (const r of list.slice(0, 400)) {
      const tr = document.createElement("tr");
      const d = document.createElement("td");
      d.textContent = r.date;
      const v = document.createElement("td");
      v.className = "report-amount";
      v.textContent = r.rate.toLocaleString(booksLocale(), { maximumFractionDigits: 6 });
      const x = document.createElement("td");
      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "link-button";
      remove.textContent = "Remove";
      remove.addEventListener("click", () => {
        void keepRates({ ...held(), [currency]: (held()[currency] ?? []).filter((y) => y.date !== r.date) }, `${currency} rate on ${r.date} removed`);
      });
      x.append(remove);
      tr.append(d, v, x);
      tbody.append(tr);
    }
    table.append(tbody);
    details.append(summary, table);
    const clear = document.createElement("button");
    clear.type = "button";
    clear.className = "link-button";
    clear.textContent = `Remove every ${currency} rate`;
    clear.addEventListener("click", async () => {
      if (!await askOnPage(`Remove all ${list.length} ${currency} rates? Its amounts then count as if they were ${books}.`)) return;
      const next = { ...held() };
      delete next[currency];
      void keepRates(next, `Every ${currency} rate removed`);
    });
    details.append(clear);
    body.append(details);
  }
}

export function renderCurrencies(): void {
  const body = $("currencies-body");
  body.textContent = "";
  const books = booksCurrency();
  const inUse = foreignInUse(state.ledger.transactions, state.ledger.invoices ?? [], books);
  const currencies = [...new Set([...inUse.keys(), ...Object.keys(held())])].sort();

  const accounts = exchangeAccounts();
  if (accounts === null) {
    const warn = document.createElement("div");
    warn.className = "variance-note warn";
    warn.append(
      `Exchange differences need an account to go to. Add Realised and Unrealised Currency Gains to the chart? Until then, no difference is posted. `,
    );
    const add = document.createElement("button");
    add.type = "button";
    add.className = "primary";
    add.textContent = "Add the two accounts";
    add.addEventListener("click", () => void addExchangeAccounts());
    warn.append(add);
    body.append(warn);
  } else {
    body.append(
      note(
        `Exchange differences on payments and conversions go to ${accounts.realised.code} ${accounts.realised.name}; ` +
          `bank balances revalued at the balance date to ${accounts.unrealised.code} ${accounts.unrealised.name}.`,
      ),
    );
  }

  const missing = missingRates(inUse, fxRates());
  if (missing.length > 0) {
    const warn = document.createElement("p");
    warn.className = "variance-note warn";
    warn.textContent = `No rates for ${missing.join(", ")}: those amounts count in the reports as if they were ${books} until rates are added.`;
    body.append(warn);
  }

  if (currencies.length === 0) {
    body.append(note(`Everything in these books is in ${books}. A bank account or a document in another currency appears here, to give it rates.`));
  }
  for (const currency of currencies) currencySection(body, currency, inUse.get(currency));

  // A currency not in use yet: set its rates ahead of the first invoice.
  const another = document.createElement("div");
  another.className = "contacts-controls";
  const pick = document.createElement("select");
  for (const c of COMMON_CURRENCIES.filter((c) => c !== books && !currencies.includes(c))) {
    const option = document.createElement("option");
    option.value = c;
    option.textContent = c;
    pick.append(option);
  }
  const start = document.createElement("button");
  start.type = "button";
  start.textContent = "Add a currency";
  start.addEventListener("click", () => {
    if (pick.value === "") return;
    void keepRates({ ...held(), [pick.value]: held()[pick.value] ?? [] }, `${pick.value} added`);
  });
  another.append(pick, start);
  body.append(another);
}
