import { classSource } from "./classes.js";
import type { IsoDate } from "./dates.js";
import type { Cents } from "./money.js";
import type { PostedJournal } from "./posting.js";

/**
 * Jobs: work done for a customer -- a build, a contract, an event -- and what
 * it earned and cost. Like a class, a job is given to where a posting came
 * from (a bank line, an invoice, a bill, a journal), and every income and
 * expense line that source posts counts to it; nothing posts differently.
 * Unlike a class it belongs to a customer, is open or finished, and is read
 * over its whole life rather than a year.
 */

export interface Job {
  id: string;
  name: string;
  /** The customer it is done for, as contacts and invoices name them. */
  customer: string;
  status: "open" | "closed";
  /** What was quoted or agreed, to measure what it earned against. */
  quoted?: Cents | undefined;
  started?: IsoDate | undefined;
  note?: string | undefined;
}

export interface JobsHeld {
  jobs: Job[];
  /** Where a posting came from (see classSource), to the job's id. */
  assigned: Record<string, string>;
}

export interface JobResult {
  job: Job;
  income: Cents;
  directCosts: Cents;
  otherCosts: Cents;
  profit: Cents;
  /** Profit as a whole percentage of income; null with no income. */
  margin: number | null;
  /** Income as a whole percentage of what was quoted; null with no quote. */
  ofQuote: number | null;
  sources: number;
  first?: IsoDate;
  last?: IsoDate;
}

/** What kind of profit-and-loss account a code is, or null when it is not one. */
export type AccountKind = (code: string) => "income" | "direct" | "expense" | null;

/** Each job's income, costs and profit, over its whole life unless a range is given. */
export function jobProfitability(
  journals: readonly PostedJournal[],
  held: JobsHeld,
  kindOf: AccountKind,
  range?: { from: IsoDate; to: IsoDate },
): JobResult[] {
  const results = new Map<string, JobResult & { seen: Set<string> }>();
  for (const job of held.jobs) {
    results.set(job.id, { job, income: 0, directCosts: 0, otherCosts: 0, profit: 0, margin: null, ofQuote: null, sources: 0, seen: new Set() });
  }
  for (const journal of journals) {
    if (range !== undefined && (journal.date < range.from || journal.date > range.to)) continue;
    const source = classSource(journal);
    const result = results.get(held.assigned[source] ?? "");
    if (result === undefined) continue;
    let touched = false;
    for (const line of journal.lines) {
      const kind = kindOf(line.accountCode.trim());
      if (kind === null) continue;
      touched = true;
      // Credits are negative: income is turned round, costs are as posted.
      if (kind === "income") result.income -= line.amount;
      else if (kind === "direct") result.directCosts += line.amount;
      else result.otherCosts += line.amount;
    }
    if (!touched) continue;
    if (!result.seen.has(source)) {
      result.seen.add(source);
      result.sources += 1;
    }
    if (result.first === undefined || journal.date < result.first) result.first = journal.date;
    if (result.last === undefined || journal.date > result.last) result.last = journal.date;
  }
  return [...results.values()]
    .map(({ seen: _seen, ...r }) => {
      const profit = r.income - r.directCosts - r.otherCosts;
      return {
        ...r,
        profit,
        margin: r.income > 0 ? Math.round((profit / r.income) * 100) : null,
        ofQuote: r.job.quoted !== undefined && r.job.quoted > 0 ? Math.round((r.income / r.job.quoted) * 100) : null,
      };
    })
    .sort((a, b) => (a.job.status === b.job.status ? a.job.name.localeCompare(b.job.name) : a.job.status === "open" ? -1 : 1));
}

/** The assignments by job name, for the profit and loss by job (see profitAndLossByClass). */
export function jobColumns(held: JobsHeld): Record<string, string> {
  const names = new Map(held.jobs.map((j) => [j.id, j.name]));
  const out: Record<string, string> = {};
  for (const [source, id] of Object.entries(held.assigned)) {
    const name = names.get(id);
    if (name !== undefined) out[source] = name;
  }
  return out;
}
