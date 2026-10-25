import type { IsoDate } from "./dates.js";
import type { InvoiceBalance } from "./invoices.js";
import { isPosted } from "./invoices.js";
import { inBooks } from "./foreign-currency.js";
import type { Cents } from "./money.js";
import type { RecurringInvoice } from "./recurring-invoices.js";
import { addDays, occurrence } from "./recurring-invoices.js";

/**
 * The few figures an owner asks of the books beyond the profit: how long
 * customers take to pay, what is kept of each dollar of sales, and where the
 * bank balance is heading over the next thirteen weeks.
 */

/**
 * Days sales outstanding: what customers owe at the end of a period, as days
 * of that period's sales. Null when there were no sales to measure against.
 */
export function daysSalesOutstanding(owedAtEnd: Cents, sales: Cents, days: number): number | null {
  if (sales <= 0 || days <= 0) return null;
  return Math.round((Math.max(0, owedAtEnd) / sales) * days);
}

/** Gross margin (after direct costs) and net margin, as whole percentages of income. */
export function margins(income: Cents, directCosts: Cents, netProfit: Cents): { gross: number | null; net: number | null } {
  if (income <= 0) return { gross: null, net: null };
  return {
    gross: Math.round(((income - Math.abs(directCosts)) / income) * 100),
    net: Math.round((netProfit / income) * 100),
  };
}

export interface CashEvent {
  date: IsoDate;
  /** In positive, out negative. */
  amount: Cents;
  what: string;
  /** Due before today and still unpaid: counted in the first week. */
  overdue?: boolean;
}

/** What is owed to and by the books, as the money it should become: each open document at its due date. */
export function documentCashEvents(balances: Iterable<InvoiceBalance>, today: IsoDate): CashEvent[] {
  const out: CashEvent[] = [];
  for (const b of balances) {
    const i = b.invoice;
    if (b.remaining <= 0 || i.total <= 0) continue;
    if (!isPosted(i)) continue;
    const due = i.due ?? i.issued;
    const sign = i.kind === "sales" ? 1 : -1;
    out.push({
      date: due < today ? today : due,
      // In the books' currency: a document in another is owed at its rate.
      amount: (sign * inBooks(i, b.remaining)) as Cents,
      what: `${i.kind === "sales" ? "Invoice" : "Bill"} ${i.number}, ${i.contact}`,
      ...(due < today ? { overdue: true } : {}),
    });
  }
  return out;
}

/** The invoices recurring schedules will make before `until`, as money due in. */
export function recurringCashEvents(schedules: readonly RecurringInvoice[], today: IsoDate, until: IsoDate): CashEvent[] {
  const out: CashEvent[] = [];
  for (const s of schedules) {
    if (!s.active) continue;
    const total = s.lines.reduce((sum, l) => sum + l.gross, 0);
    if (total <= 0) continue;
    for (let n = s.made; n < s.made + 400; n += 1) {
      const issued = occurrence(s.start, s.frequency, n);
      if (s.end !== null && issued > s.end) break;
      const due = s.dueDays === null ? issued : addDays(issued, s.dueDays);
      if (due > until) break;
      if (due < today) continue;
      out.push({ date: due, amount: total as Cents, what: `Recurring invoice, ${s.contact}` });
    }
  }
  return out;
}

export interface ForecastWeek {
  from: IsoDate;
  to: IsoDate;
  in: Cents;
  out: Cents;
  closing: Cents;
  events: CashEvent[];
}

/**
 * The bank balance week by week from today: what is held now, plus what is
 * owed in and less what is owed out, each on the week it falls due. Overdue
 * amounts are counted in the first week, and said to be.
 */
export function cashForecast(
  opening: Cents,
  today: IsoDate,
  events: readonly CashEvent[],
  weeks = 13,
): { weeks: ForecastWeek[]; lowest: { date: IsoDate; balance: Cents }; overdueIn: Cents; overdueOut: Cents } {
  const out: ForecastWeek[] = [];
  let balance = opening;
  let lowest = { date: today, balance: opening };
  for (let w = 0; w < weeks; w += 1) {
    const from = addDays(today, w * 7);
    const to = addDays(today, w * 7 + 6);
    const mine = events.filter((e) => e.date >= from && e.date <= to).sort((a, b) => a.date.localeCompare(b.date));
    const moneyIn = mine.filter((e) => e.amount > 0).reduce((s, e) => s + e.amount, 0);
    const moneyOut = mine.filter((e) => e.amount < 0).reduce((s, e) => s - e.amount, 0);
    balance = (balance + moneyIn - moneyOut) as Cents;
    if (balance < lowest.balance) lowest = { date: to, balance };
    out.push({ from, to, in: moneyIn as Cents, out: moneyOut as Cents, closing: balance, events: mine });
  }
  const overdue = events.filter((e) => e.overdue === true);
  return {
    weeks: out,
    lowest,
    overdueIn: overdue.filter((e) => e.amount > 0).reduce((s, e) => s + e.amount, 0) as Cents,
    overdueOut: overdue.filter((e) => e.amount < 0).reduce((s, e) => s - e.amount, 0) as Cents,
  };
}
