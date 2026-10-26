import type { Cents } from "./money.js";
import type { Invoice } from "./invoices.js";
import type { RecurringInvoice } from "./recurring-invoices.js";
import type { Item } from "./items.js";
import type { Contact } from "./contacts.js";
import type { OpeningBalances } from "./balance-sheet.js";
import type { Prepayment, VehicleUse } from "./year-end-adjustments.js";
import { splitAccountLabel } from "./chart-codes.js";

/**
 * The account a renamed or merged account was, carried everywhere that keeps
 * it by its code rather than by its coding label.
 *
 * Codings, splits, rules and journals name an account by its label and are
 * moved by renameAccount. Documents, products, budgets, opening balances, the
 * year-end adjustments and payroll keep the bare chart code -- or the name,
 * for an account with no code -- so a change of name alone leaves them right,
 * and a change of code orphaned them: an invoice line posting to a code no
 * account holds, a budget and an opening balance under a key nothing reads.
 *
 * Merging adds what both accounts held where an amount is kept by account
 * (opening balances, budgets), because the two are one account from now on.
 */

/** A pay item's account, wherever payroll keeps one. */
interface WithAccount {
  account?: string | undefined;
}

/** Payroll as these books keep it: only the parts that name accounts are read. */
export interface PayrollAccountsHeld {
  accounts?: Record<string, string | undefined> | undefined;
  employees?: readonly { allowances?: readonly WithAccount[] | undefined; reimbursements?: readonly WithAccount[] | undefined; deductions?: readonly WithAccount[] | undefined }[];
  payRuns?: readonly { lines: readonly { allowances?: readonly WithAccount[] | undefined; reimbursements?: readonly WithAccount[] | undefined; deductions?: readonly WithAccount[] | undefined }[] }[];
}

export interface CodeKeptStores<P extends PayrollAccountsHeld = PayrollAccountsHeld> {
  invoices?: readonly Invoice[] | undefined;
  recurring?: readonly RecurringInvoice[] | undefined;
  items?: readonly Item[] | undefined;
  contacts?: readonly Contact[] | undefined;
  openingBalances?: OpeningBalances | undefined;
  budgets?: Readonly<Record<string, Readonly<Record<string, number>>>> | undefined;
  vehicleUse?: readonly VehicleUse[] | undefined;
  prepayments?: readonly Prepayment[] | undefined;
  payroll?: P | undefined;
}

/** The key such stores use for an account: its code, or its name where it has none. */
export function accountKeyOf(account: { code: string; name: string }): string {
  return account.code.trim() !== "" ? account.code.trim() : account.name.trim();
}

/**
 * Carry `from`'s key to `to`'s through every store that keeps the bare code.
 * Returns the stores changed (others as given) and how many references moved.
 * Never edits what it was given.
 */
export function recodeElsewhere<P extends PayrollAccountsHeld>(
  stores: CodeKeptStores<P>,
  from: { code: string; name: string },
  to: { code: string; name: string },
): { stores: CodeKeptStores<P>; moved: number } {
  const was = accountKeyOf(from);
  const now = accountKeyOf(to);
  if (was === now || was === "") return { stores, moved: 0 };
  let moved = 0;
  const same = (value: string | undefined): boolean => {
    const text = (value ?? "").trim();
    if (text === "") return false;
    if (text === was) return true;
    // A label kept where a code is expected: "Bank Fees - 404".
    const { code, name } = splitAccountLabel(text);
    return from.code.trim() !== "" ? code === from.code.trim() : code === "" && name.toLowerCase() === from.name.trim().toLowerCase();
  };
  const swap = (value: string): string => {
    if (!same(value)) return value;
    moved += 1;
    return now;
  };
  const items = <T extends WithAccount>(list: readonly T[] | undefined): T[] | undefined =>
    list?.map((one) => (one.account !== undefined && same(one.account) ? { ...one, account: swap(one.account) } : one));
  const sumInto = (record: Readonly<Record<string, number>>): Record<string, number> => {
    if (record[was] === undefined) return { ...record };
    const out = { ...record };
    out[now] = (out[now] ?? 0) + (out[was] ?? 0);
    delete out[was];
    moved += 1;
    return out;
  };

  const out: CodeKeptStores<P> = { ...stores };
  if (stores.invoices !== undefined) {
    out.invoices = stores.invoices.map((invoice) => {
      const touches =
        invoice.lines.some((l) => same(l.accountCode) || same(l.taxAccount)) || (invoice.paidOutside ?? []).some((p) => same(p.accountCode));
      if (!touches) return invoice;
      return {
        ...invoice,
        lines: invoice.lines.map((l) => ({
          ...l,
          accountCode: swap(l.accountCode),
          ...(l.taxAccount !== undefined ? { taxAccount: swap(l.taxAccount) } : {}),
        })),
        ...(invoice.paidOutside !== undefined ? { paidOutside: invoice.paidOutside.map((p) => ({ ...p, accountCode: swap(p.accountCode) })) } : {}),
      };
    });
  }
  if (stores.recurring !== undefined) {
    out.recurring = stores.recurring.map((r) =>
      r.lines.some((l) => same(l.accountCode)) ? { ...r, lines: r.lines.map((l) => ({ ...l, accountCode: swap(l.accountCode) })) } : r,
    );
  }
  if (stores.items !== undefined) {
    out.items = stores.items.map((i) => (i.accountCode !== undefined && same(i.accountCode) ? { ...i, accountCode: swap(i.accountCode) } : i));
  }
  if (stores.contacts !== undefined) {
    out.contacts = stores.contacts.map((c) =>
      c.defaultAccount !== undefined && same(c.defaultAccount) ? { ...c, defaultAccount: swap(c.defaultAccount) } : c,
    );
  }
  if (stores.openingBalances !== undefined) {
    const ob = stores.openingBalances;
    out.openingBalances = {
      ...ob,
      accounts: sumInto(ob.accounts) as Record<string, Cents>,
      ...(ob.byDate !== undefined
        ? { byDate: Object.fromEntries(Object.entries(ob.byDate).map(([date, accounts]) => [date, sumInto(accounts) as Record<string, Cents>])) }
        : {}),
    };
  }
  if (stores.budgets !== undefined) {
    out.budgets = Object.fromEntries(Object.entries(stores.budgets).map(([year, byCode]) => [year, sumInto(byCode)]));
  }
  if (stores.vehicleUse !== undefined) {
    out.vehicleUse = stores.vehicleUse.map((v) =>
      v.accounts.some(same) || same(v.counterCode)
        ? { ...v, accounts: [...new Set(v.accounts.map(swap))], counterCode: swap(v.counterCode) }
        : v,
    );
  }
  if (stores.prepayments !== undefined) {
    out.prepayments = stores.prepayments.map((p) => (same(p.accountCode) ? { ...p, accountCode: swap(p.accountCode) } : p));
  }
  if (stores.payroll !== undefined) {
    const payroll = stores.payroll;
    const accounts = payroll.accounts === undefined
      ? undefined
      : Object.fromEntries(Object.entries(payroll.accounts).map(([role, code]) => [role, code === undefined ? code : swap(code)]));
    out.payroll = {
      ...payroll,
      ...(accounts !== undefined ? { accounts } : {}),
      ...(payroll.employees !== undefined
        ? {
            employees: payroll.employees.map((e) => ({
              ...e,
              ...(e.allowances !== undefined ? { allowances: items(e.allowances) } : {}),
              ...(e.reimbursements !== undefined ? { reimbursements: items(e.reimbursements) } : {}),
              ...(e.deductions !== undefined ? { deductions: items(e.deductions) } : {}),
            })),
          }
        : {}),
      ...(payroll.payRuns !== undefined
        ? {
            payRuns: payroll.payRuns.map((run) => ({
              ...run,
              lines: run.lines.map((l) => ({
                ...l,
                ...(l.allowances !== undefined ? { allowances: items(l.allowances) } : {}),
                ...(l.reimbursements !== undefined ? { reimbursements: items(l.reimbursements) } : {}),
                ...(l.deductions !== undefined ? { deductions: items(l.deductions) } : {}),
              })),
            })),
          }
        : {}),
    } as P;
  }
  return { stores: out, moved };
}
