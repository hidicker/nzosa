import type { Cents } from "./money.js";
import type { IsoDate } from "./dates.js";
import type { PostedJournal } from "./posting.js";
import type { ClassAssignments } from "./classes.js";
import { classSource } from "./classes.js";

/**
 * Jobs: work done for a customer -- a build, a contract, an event -- and what
 * it earned against what it cost.
 *
 * Given the way a class is: to where a posting came from, a bank line, an
 * invoice, a bill or a journal, so every income and expense line that source
 * posts counts to the job. An invoice's payment, and the cost of the stock it
 * sold, go with the invoice. Nothing is posted differently.
 */
export interface Job {
  id: string;
  name: string;
  /** Whose job it is: a customer's name, as the contacts have it. */
  customer: string;
  /** Finished: kept, and no longer offered for new work. */
  closed?: boolean;
  started?: IsoDate;
  note?: string;
}

export interface JobsHeld {
  jobs: Job[];
  /** Where a posting came from (see classSource) to the job's id. */
  assigned: Record<string, string>;
}

export interface JobProfit {
  job: Job;
  /** Income, positive. */
  income: Cents;
  /** Costs, positive. */
  costs: Cents;
  profit: Cents;
  /** Profit as a share of income, or null with no income. */
  margin: number | null;
  /** How many sources are given to it in the span. */
  sources: number;
}

/** A job's name as a report heads it: the name, and whose. */
export function jobLabel(job: Pick<Job, "name" | "customer">): string {
  return job.customer.trim() === "" ? job.name : `${job.name} (${job.customer})`;
}

/**
 * Each job's income, costs and profit, from the postings. `side(code)` says
 * whether an account is income, a cost, or neither (a balance sheet account,
 * which a job's profit leaves out). Without a span, everything the job holds.
 */
export function jobProfits(
  journals: readonly PostedJournal[],
  held: JobsHeld,
  side: (code: string) => "income" | "cost" | null,
  range?: { from: IsoDate; to: IsoDate },
): JobProfit[] {
  const byId = new Map(held.jobs.map((job) => [job.id, { job, income: 0, costs: 0, sources: new Set<string>() }]));
  for (const journal of journals) {
    if (range !== undefined && (journal.date < range.from || journal.date > range.to)) continue;
    const source = classSource(journal);
    const id = held.assigned[source];
    const tally = id === undefined ? undefined : byId.get(id);
    if (tally === undefined) continue;
    for (const line of journal.lines) {
      const what = side(line.accountCode.trim());
      if (what === null) continue;
      tally.sources.add(source);
      // Credits are negative in the journals: income is turned round.
      if (what === "income") tally.income -= line.amount;
      else tally.costs += line.amount;
    }
  }
  return [...byId.values()].map(({ job, income, costs, sources }) => ({
    job,
    income,
    costs,
    profit: income - costs,
    margin: income === 0 ? null : (income - costs) / income,
    sources: sources.size,
  }));
}

/** The jobs as classes are given: source to the job's label, for a report by job. */
export function jobAssignments(held: JobsHeld): ClassAssignments {
  const labels = new Map(held.jobs.map((job) => [job.id, jobLabel(job)]));
  const out: ClassAssignments = {};
  for (const [source, id] of Object.entries(held.assigned)) {
    const label = labels.get(id);
    if (label !== undefined) out[source] = label;
  }
  return out;
}

/** The source key a document is given to a job under: its posting's own. */
export function documentSource(number: string): string {
  return number;
}
