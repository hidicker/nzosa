import type { Cents } from "@nzosa/core";
import { emptyEntityModel } from "@nzosa/core";
import { state } from "../state.js";

/**
 * Provisional tax a person paid for a year, from their income tax account's
 * transactions as downloaded from myIR.
 *
 * Everything credited to the account against that year's period: the
 * instalments, and any transfer in from another year, since those are paid
 * too. A payment made after 31 March still belongs to the year it is against,
 * which is how the export files it -- by period, not by date paid.
 *
 * Whose the account is: the entity it was given when it was loaded, where
 * that is this person's own; otherwise the name on the account, every word of
 * the person's name in it ("Whitcombe, Ana M" is Ana Whitcombe).
 */
export function provisionalPaidFromIrd(
  owner: string,
  year: number,
): { paid: Cents; payments: number; account: string } | null {
  const model = state.ledger.entities ?? emptyEntityModel();
  const words = owner.toLowerCase().split(/\s+/).filter((w) => w !== "");
  const theirs = (entityId: string | undefined, name: string): boolean => {
    const entity = model.entities.find((e) => e.id === entityId);
    const owners = entity?.owners ?? [];
    if (owners.length === 1 && owners[0]?.name === owner) return true;
    const said = name.toLowerCase();
    return words.length > 0 && words.every((w) => said.includes(w));
  };
  const periodEnd = `${year}-03-31`;
  let paid = 0;
  let payments = 0;
  let account = "";
  for (const record of state.ledger.irdRecords ?? []) {
    if (record.kind !== "account" || !/income/i.test(record.taxType)) continue;
    if (!theirs(record.entityId, record.name)) continue;
    for (const row of record.rows) {
      if (row.periodEnd !== periodEnd || row.amount >= 0) continue;
      paid -= row.amount;
      payments += 1;
      account = record.accountId;
    }
  }
  return payments === 0 ? null : { paid: paid as Cents, payments, account };
}
