import type { Account } from "./chart.js";

/**
 * Entities: the separate books a chart of accounts is really several of.
 *
 * One person's affairs are rarely one set of books. A trading company, two
 * rental properties and a family home each need their own profit figure, their
 * own return, and their own answer to "how did this year go" -- but they share
 * a chart of accounts and, often, a bank account.
 *
 * Two relationships, deliberately different:
 *
 *  * An **account** belongs to exactly one entity. `Totara Place Rates` is a
 *    Totara Place expense and nothing else; letting it belong to two would make
 *    every per-entity total ambiguous, and there would be no honest way to add
 *    them up.
 *
 *  * A **bank account** may serve several. One current account pays the rates
 *    on two properties and the company's suppliers, and splitting it would be a
 *    fiction. So the link is many, and what a transaction actually belongs to
 *    is decided by its coding -- by the account it lands in, which has exactly
 *    one entity.
 *
 * Nothing here changes a figure. It is the vocabulary a per-entity report will
 * need, recorded now while the knowledge is at hand.
 */

export interface Entity {
  /** Stable key used by the mappings. Never shown. */
  id: string;
  /** What the user calls it. */
  name: string;
  /** Optional longer description, e.g. a legal name or address. */
  note?: string;
  /**
   * Who owns it, and in what share.
   *
   * A jointly owned rental is not one taxpayer's income: each owner returns
   * their share, and the share is a fact about the property rather than about
   * any transaction. Empty means the entity is not apportioned -- a company
   * owns its own profit.
   */
  owners?: Owner[];
  /**
   * What kind of income this produces, because tax treats them differently.
   *
   * New Zealand ring-fences residential rental losses; commercial rent and
   * trading income are not ring-fenced, and they appear in different places on
   * a return. `personal` is the fourth answer and the most important one to be
   * able to say: money that is nobody's business but the owner's, kept out of
   * every figure rather than quietly absorbed into one.
   *
   * Nothing here computes tax, but a report that mixes these would be useless
   * for filling one in.
   */
  kind?: EntityKind;
  /**
   * Whether this entity is registered for GST.
   *
   * It decides what its own reports should say, and the two answers are not a
   * presentation choice. A registered entity never owns the GST it collects:
   * it holds it for Inland Revenue and hands it over, so GST belongs in
   * neither its income nor its expenses and its profit is worked out net. An
   * entity that is not registered charges no GST and cannot claim any back,
   * so the GST it pays is simply part of what things cost, and leaving it out
   * would understate every expense it has.
   *
   * One ledger can hold both -- a registered company beside a residential
   * rental, which is an exempt supply and registers for nothing -- so this is
   * a fact about the entity rather than a switch on the report.
   *
   * Undefined means nobody has said. Registered is assumed, because a set of
   * books being kept at all usually means there is a return to file.
   */
  gstRegistered?: boolean;
  /**
   * The GST number, as it goes on an invoice you send somebody.
   *
   * Held rather than derived because nothing else in these books knows it, and
   * an invoice for more than $200 has to carry the supplier's. Written as the
   * person writes it -- IRD numbers are shown with dashes and stored without,
   * and correcting somebody's punctuation on their own GST number is not this
   * program's business.
   */
  gstNumber?: string;
  /**
   * Postal or street address, for the top of an invoice.
   *
   * Free text over several lines, because addresses are not a shape: a rural
   * delivery number, a PO box and a unit number are all addresses and none of
   * them fits the same fields.
   */
  address?: string;
  /**
   * Where a customer should pay, printed at the foot of an invoice.
   *
   * A bank account number, usually, but left as text: some people are paid
   * into an account, some quote a customer reference to put with it, and some
   * are paid another way entirely.
   */
  payTo?: string;
}

export type EntityKind = "residential" | "commercial" | "business" | "personal";

export interface Owner {
  name: string;
  /** Percentage share, 0 to 100. Shares across one entity should total 100. */
  percent: number;
}

/**
 * The key an account is filed under.
 *
 * Bank accounts in a Xero chart export carry no code at all, so keying on the
 * code alone files all of them together -- assign one and the other five follow
 * it, which is both wrong and baffling to watch. Falling back to the name keeps
 * them distinct.
 */
export function accountEntityKey(account: Pick<Account, "code" | "name">): string {
  return account.code.trim() !== "" ? account.code.trim() : `name:${account.name.trim()}`;
}

/** Chart account code to entity id. An account belongs to one entity at most. */
export type AccountEntities = Readonly<Record<string, string>>;

/** Bank account id to the entities it serves. May be several, may be none. */
export type BankEntities = Readonly<Record<string, readonly string[]>>;

export interface EntityModel {
  entities: readonly Entity[];
  accounts: AccountEntities;
  banks: BankEntities;
}

export function emptyEntityModel(): EntityModel {
  return { entities: [], accounts: {}, banks: {} };
}

/** Whether an entity's figures should be reported net of GST. */
export function reportsNetOfGst(entity: Entity | undefined): boolean {
  return entity === undefined || entity.gstRegistered !== false;
}

/** The name a ledger's first entity is given until somebody renames it. */
export const DEFAULT_ENTITY_NAME = "XYZ Ltd";

/**
 * The one entity a ledger starts with, holding everything.
 *
 * Blank was the old answer for a single set of books, and it worked, but it
 * left every screen having to say what nothing meant and left the person
 * nothing to rename. One entity that owns every account and every bank
 * account is the same books with a name on them: reports are unchanged
 * because nothing is excluded, and the first thing anybody does is call it
 * what their company is actually called.
 */
export function defaultEntityModel(
  accounts: readonly Pick<Account, "code" | "name">[],
  banks: readonly string[],
): EntityModel {
  const entity: Entity = {
    id: entityId(DEFAULT_ENTITY_NAME),
    name: DEFAULT_ENTITY_NAME,
    gstRegistered: true,
  };
  const byAccount: Record<string, string> = {};
  for (const account of accounts) byAccount[accountEntityKey(account)] = entity.id;
  const byBank: Record<string, readonly string[]> = {};
  for (const bank of banks) byBank[bank] = [entity.id];
  return { entities: [entity], accounts: byAccount, banks: byBank };
}

/** Turn a name into an id: lower case, words joined by hyphens. */
export function entityId(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug === "" ? "entity" : slug;
}

/** The entity an account belongs to, or undefined when it is unassigned. */
export function entityOfAccount(
  model: EntityModel,
  account: Pick<Account, "code" | "name">,
): Entity | undefined {
  const id = model.accounts[accountEntityKey(account)];
  if (id === undefined) return undefined;
  return model.entities.find((e) => e.id === id);
}

/** The entities a bank account serves, in the order the model lists them. */
export function entitiesOfBank(model: EntityModel, account: string): Entity[] {
  const ids = new Set(model.banks[account] ?? []);
  return model.entities.filter((e) => ids.has(e.id));
}

/**
 * Parse `Ana Whitcombe 50%; Tom Whitcombe 50%` into owners.
 *
 * Semicolons, commas and the word "and" all separate, because people write all
 * three and only one of them used to work. A comma did not split, so
 * `Hamish 50%, Jaehee 50%` became a single owner named `Hamish 50%, Jaehee`
 * holding 50% -- no error, no warning, and a wrong share on somebody's return.
 *
 * A comma inside a name is the thing this cannot have both ways. `Whitcombe,
 * Ana 50%` is one owner written surname-first and two owners is the far more
 * common reading, so the comma splits and a name that needs one has to be
 * written without it. Said in the placeholder rather than left to be
 * discovered.
 */
export function parseOwners(text: string): Owner[] {
  const owners: Owner[] = [];
  // "and" only between shares, never inside a name: "Rose and Crown Ltd 50%"
  // is one owner. Requiring a percentage in front of it is what tells the two
  // apart, since a separator follows a share and a name does not.
  const parts = text
    .replace(/(%)\s+and\s+/gi, "$1;")
    .split(/[;,]/);

  for (const part of parts) {
    const trimmed = part.trim();
    if (trimmed === "") continue;
    const match = /^(.*?)\s+([\d.]+)\s*%$/.exec(trimmed);
    if (match?.[1] && match[2]) {
      owners.push({ name: match[1].trim(), percent: Number(match[2]) });
    } else {
      // A bare name means the whole thing, which is what one owner means.
      owners.push({ name: trimmed, percent: 100 });
    }
  }
  return owners;
}

/**
 * What the shares come to, and whether that is a problem.
 *
 * Shares that do not total 100 mean somebody's income is unreported or
 * reported twice, which is the whole reason for tracking them. There has been
 * a check for this in `validateEntityModel` since entities existed and nothing
 * ever called it, so it never once ran -- which is why this returns something
 * a screen can show rather than a problem list somebody has to remember to
 * ask for.
 */
export function ownersTotal(owners: readonly Owner[]): {
  percent: number;
  ok: boolean;
  said: string;
} {
  if (owners.length === 0) return { percent: 0, ok: true, said: "" };

  const percent = owners.reduce((sum, owner) => sum + owner.percent, 0);
  const ok = Math.abs(percent - 100) < 0.001;
  const rounded = Math.round(percent * 100) / 100;
  const named = owners.map((owner) => `${owner.name} ${owner.percent}%`).join(", ");

  return {
    percent,
    ok,
    said: ok ? named : `${named} — totals ${rounded}%, not 100%`,
  };
}

/** The inverse, for writing owners back to a file. */
export function formatOwners(owners: readonly Owner[]): string {
  return owners.map((o) => `${o.name} ${o.percent}%`).join("; ");
}

/** Every distinct owner across all entities, in the order first seen. */
export function ownersOf(model: EntityModel): string[] {
  const names: string[] = [];
  for (const entity of model.entities) {
    for (const owner of entity.owners ?? []) {
      if (!names.includes(owner.name)) names.push(owner.name);
    }
  }
  return names;
}

/** One owner's share of an entity, as a fraction. Absent owners means all of it. */
export function shareOf(entity: Entity, owner: string): number {
  const owners = entity.owners ?? [];
  if (owners.length === 0) return 0;
  const found = owners.find((o) => o.name === owner);
  return found ? found.percent / 100 : 0;
}

export interface EntityProblem {
  message: string;
  /** The account code or bank account id the problem is about. */
  subject: string;
}

/**
 * Check a model against the chart and the bank accounts actually present.
 *
 * A mapping that points at a deleted entity, or at an account no longer in the
 * chart, is worse than no mapping: it will silently drop out of a per-entity
 * total rather than announcing itself.
 */
export function validateEntityModel(
  model: EntityModel,
  chart: readonly Account[],
  bankAccounts: readonly string[],
): EntityProblem[] {
  const problems: EntityProblem[] = [];
  const known = new Set(model.entities.map((e) => e.id));
  const inChart = new Set(chart.map(accountEntityKey));
  const banks = new Set(bankAccounts);

  const seen = new Set<string>();
  for (const entity of model.entities) {
    if (seen.has(entity.id)) {
      problems.push({ subject: entity.id, message: `Two entities share the id "${entity.id}".` });
    }
    seen.add(entity.id);

    // Shares that do not total 100 mean somebody's income is unreported or
    // double-reported, which is the whole point of tracking them.
    const owners = entity.owners ?? [];
    if (owners.length > 0) {
      const total = owners.reduce((sum, o) => sum + o.percent, 0);
      if (Math.abs(total - 100) > 0.001) {
        problems.push({
          subject: entity.id,
          message: `${entity.name}: owner shares total ${total}%, not 100%.`,
        });
      }
    }
  }

  for (const [code, id] of Object.entries(model.accounts)) {
    if (!known.has(id)) {
      problems.push({ subject: code, message: `Account ${code} points at a missing entity "${id}".` });
    }
    if (chart.length > 0 && !inChart.has(code)) {
      problems.push({ subject: code, message: `Account ${code} is not in the chart of accounts.` });
    }
  }

  for (const [account, ids] of Object.entries(model.banks)) {
    for (const id of ids) {
      if (!known.has(id)) {
        problems.push({
          subject: account,
          message: `Bank account ${account} points at a missing entity "${id}".`,
        });
      }
    }
    if (bankAccounts.length > 0 && !banks.has(account)) {
      problems.push({
        subject: account,
        message: `Bank account ${account} is not in the ledger.`,
      });
    }
  }

  return problems;
}

/** How much of the chart has been assigned, for showing progress. */
export function entityCoverage(
  model: EntityModel,
  chart: readonly Account[],
): { assigned: number; total: number; byEntity: Map<string, number> } {
  const byEntity = new Map<string, number>();
  let assigned = 0;
  for (const account of chart) {
    const id = model.accounts[accountEntityKey(account)];
    if (id === undefined) continue;
    assigned += 1;
    byEntity.set(id, (byEntity.get(id) ?? 0) + 1);
  }
  return { assigned, total: chart.length, byEntity };
}
