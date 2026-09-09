import type { Account } from "./chart.js";
import type { AccountEntities } from "./entities.js";
import { accountEntityKey } from "./entities.js";
import type { Overrides } from "./overrides.js";
import type { RuleSet } from "./rules.js";
import type { Splits } from "./splits.js";
import type { RuleFile } from "./chart-codes.js";

/**
 * Renaming an account, and everything that points at it.
 *
 * An account is stored in the chart, but it is *referred to* by a label built
 * from its code and name -- `Advertising - 400` -- and that label is what is
 * written into every coding decision, every rule, every split part and the GST
 * treatment. Change the code or the name and the label changes with it, which
 * means an edit that touches only the chart row silently orphans all of them:
 * the transactions stay coded to a name no account has any more, their GST
 * treatment stops being found, and the account's entity assignment is left
 * keyed to a code nothing holds.
 *
 * None of that shows up as an error. It shows up as a return that quietly
 * moved, which is the worst way for it to show up. So renaming is one
 * operation over every part that stores the label, and it is here rather than
 * in the screen that offers the button, because being able to test it matters
 * more than where it is called from.
 */

export interface AccountReferences {
  chart: readonly Account[];
  overrides: Overrides;
  splits: Splits;
  rules: RuleSet | undefined;
  accountEntities: AccountEntities;
}

export interface RenameResult extends AccountReferences {
  chart: Account[];
  /** How many stored references moved, so the user can be told plainly. */
  moved: {
    codings: number;
    splitParts: number;
    rules: number;
    treatment: boolean;
    entity: boolean;
  };
}

/**
 * Rename one chart account, carrying its references with it.
 *
 * `from` identifies the account as it stands; `to` is what it becomes.
 * `oldLabel` and `newLabel` are the coding names before and after, worked out
 * by the caller because only it knows what the ledger already calls this
 * account -- an account the codings know as `NB Sales - 200` keeps that shape.
 *
 * Returns fresh objects throughout and never edits what it was given: the
 * caller saves the result as one change, so a rename either lands completely
 * or not at all.
 */
export function renameAccount(
  before: AccountReferences,
  from: Pick<Account, "code" | "name">,
  to: Pick<Account, "code" | "name">,
  oldLabel: string,
  newLabel: string,
): RenameResult {
  const moved = { codings: 0, splitParts: 0, rules: 0, treatment: false, entity: false };

  const chart = before.chart.map((account) =>
    account.code === from.code && account.name === from.name
      ? { ...account, code: to.code.trim(), name: to.name.trim() }
      : account,
  );

  const overrides: Record<string, Overrides[string]> = {};
  for (const [id, override] of Object.entries(before.overrides)) {
    if (override.code === oldLabel) {
      overrides[id] = { ...override, code: newLabel };
      moved.codings += 1;
    } else {
      overrides[id] = override;
    }
  }

  // A split's parts each carry their own code, and a part is exactly as able
  // to point at a renamed account as a whole transaction is.
  const splits: Record<string, Splits[string]> = {};
  for (const [id, parts] of Object.entries(before.splits)) {
    let touched = false;
    const moved_ = parts.map((part) => {
      if (part.code !== oldLabel) return part;
      touched = true;
      moved.splitParts += 1;
      return { ...part, code: newLabel };
    });
    splits[id] = touched ? moved_ : parts;
  }

  const file = before.rules as RuleFile | undefined;
  let rules = before.rules;
  if (file !== undefined) {
    const rewrite = <T extends { code?: string }>(list: readonly T[] | undefined): T[] | undefined =>
      list?.map((entry) => {
        if (entry.code !== oldLabel) return entry;
        moved.rules += 1;
        return { ...entry, code: newLabel };
      });

    const codeTreatments = { ...(file.codeTreatments ?? {}) };
    const held = codeTreatments[oldLabel];
    if (held !== undefined) {
      delete codeTreatments[oldLabel];
      codeTreatments[newLabel] = held;
      moved.treatment = true;
    }

    rules = {
      ...file,
      ...(file.rules !== undefined ? { rules: rewrite(file.rules) } : {}),
      ...(file.defaults !== undefined ? { defaults: rewrite(file.defaults) } : {}),
      ...(Object.keys(codeTreatments).length > 0 ? { codeTreatments } : {}),
    } as RuleSet;
  }

  // The entity assignment is keyed by code, or by name where there is no code.
  // Either half of a rename can move that key, and an assignment left under
  // the old one is a row nothing will read and something will one day count.
  const accountEntities: Record<string, string> = { ...before.accountEntities };
  const wasKey = accountEntityKey(from);
  const nowKey = accountEntityKey({ code: to.code.trim(), name: to.name.trim() });
  if (wasKey !== nowKey && accountEntities[wasKey] !== undefined) {
    accountEntities[nowKey] = accountEntities[wasKey] as string;
    delete accountEntities[wasKey];
    moved.entity = true;
  }

  return { chart, overrides, splits, rules, accountEntities, moved };
}

/**
 * Why this rename cannot go ahead, or null when it can.
 *
 * Checked before anything is written rather than reported afterwards: half a
 * rename is worse than none.
 */
export function renameProblem(
  chart: readonly Account[],
  from: Pick<Account, "code" | "name">,
  to: Pick<Account, "code" | "name">,
): string | null {
  const code = to.code.trim();
  const name = to.name.trim();

  if (name === "") return "An account needs a name.";

  // A code is what survives a rename: it is how the entity assignment, the
  // reports and the chart's own tax code find the account again after somebody
  // changes what it is called. An account without one can only be found by its
  // name, which is the thing most likely to change.
  if (code === "") return "An account needs a code.";
  if (!/^[A-Za-z0-9-]+$/.test(code)) {
    return "A code can hold letters, numbers and hyphens, and nothing else.";
  }

  const clash = chart.find(
    (account) =>
      !(account.code === from.code && account.name === from.name) &&
      account.code.trim().toLowerCase() === code.toLowerCase(),
  );
  if (clash) return `Code ${code} is already ${clash.name}.`;

  return null;
}
