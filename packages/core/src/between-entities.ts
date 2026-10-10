import type { Cents } from "./money.js";
import type { IsoDate } from "./dates.js";
import type { Entity, EntityModel } from "./entities.js";
import { accountEntityKey } from "./entities.js";
import type { PostedJournal, PostedLine } from "./posting.js";

/**
 * Money that passes between entities, recorded on both sides.
 *
 * A bank account belongs to one entity: whose money it holds. A line on it
 * belongs to whichever entity it is coded to. When the two differ -- the
 * household's card paying a rental's repair, a commercial lease paid into the
 * owners' joint account -- the line's profit and GST are the coded entity's,
 * and the money came from, or went to, the account's owner. Each entity's
 * own books only balance if that passage is written down on both sides.
 *
 * It is worked out from the posted journals, never stored: change who an
 * account belongs to, or how a line is coded, and these follow. Each journal
 * whose lines fall in more than one entity gets a companion journal that
 * balances every entity in it against the one whose bank account moved.
 *
 * What the balancing lines are depends on who is on each side:
 *
 * - Something people own directly -- a person, a couple's joint money, a
 *   rental or a business they own without a company -- has no existence apart
 *   from its owners. Money into it is the owners putting it in (funds
 *   introduced); money out is the owners taking it (drawings). Split by each
 *   owner's share, so it is seen who funded what.
 * - A separate legal person -- a company (an LTC included), a trust, a
 *   society or charity -- can only owe or be owed. Money crossing its boundary
 *   is a loan: with each owner of the other side as their current account, or
 *   with another company as a balance due between the two.
 * - A person dealing with a company lends to it, or borrows from it.
 *
 * A pair of entities can be set to treat everything between them as a loan
 * instead, or as owners' money, where the defaults are not wanted.
 */

export type BetweenTreatment = "equity" | "loan";

/** Treatments chosen for a pair of entities, keyed by `pairKey`. */
export type BetweenOverrides = Readonly<Record<string, BetweenTreatment>>;

/** The key for a pair of entities, the same whichever order they are named in. */
export function pairKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

/** A company, a trust, a society or a charity: a legal person apart from its owners. */
export function isSeparatePerson(entity: Entity): boolean {
  if (entity.kind === "trust" || entity.kind === "nonprofit") return true;
  if ((entity.kind ?? "business") !== "business") return false;
  if (entity.structure !== undefined) return entity.structure === "company" || entity.structure === "trust";
  return /\b(limited|ltd)\b/i.test(entity.name);
}

/** Every synthetic account starts with this, so it is never mistaken for a chart code. */
export const BETWEEN_PREFIX = "between:";

export type BetweenRole = "introduced" | "drawings" | "paid-for-others" | "received-for-others" | "current" | "loan";

export interface BetweenAccount {
  code: string;
  name: string;
  entityId: string;
  /** For the balance sheet: owners' money is equity, a loan a liability (or an asset, overdrawn). */
  type: "Equity" | "Current Liability";
  role: BetweenRole;
  /** The person a per-owner account is for; empty for a balance with another entity. */
  person: string;
  /** The other entity, for a loan with one. */
  counterparty: string;
}

export interface BetweenOptions {
  model: EntityModel;
  /** Whose a bank account is, by its id; undefined when nobody has said. */
  bankOwner: (account: string) => string | undefined;
  /** The bank account ids the postings name. */
  isBank: (code: string) => boolean;
  overrides?: BetweenOverrides | undefined;
}

interface Share {
  name: string;
  percent: number;
}

function sharesOf(entity: Entity): Share[] {
  const owners = (entity.owners ?? []).filter((o) => o.percent > 0);
  return owners.length > 0 ? owners : [{ name: entity.name, percent: 100 }];
}

/** Split whole cents by shares, the remainder to the last, so the parts add up exactly. */
function split(amount: number, shares: readonly Share[]): number[] {
  const total = shares.reduce((sum, s) => sum + s.percent, 0) || 100;
  const parts = shares.map((s) => Math.trunc((amount * s.percent) / total));
  const rest = amount - parts.reduce((sum, p) => sum + p, 0);
  const last = parts.length - 1;
  if (last >= 0) parts[last] = (parts[last] ?? 0) + rest;
  return parts;
}

type SideKind = "equity" | "loan-per-owner" | "loan";

function sideKind(x: Entity, y: Entity, overrides: BetweenOverrides | undefined): SideKind {
  const chosen = overrides?.[pairKey(x.id, y.id)];
  if (isSeparatePerson(x)) {
    if (chosen === "loan") return "loan";
    return isSeparatePerson(y) ? "loan" : "loan-per-owner";
  }
  if (chosen === "loan") return "loan";
  if (chosen === "equity") return "equity";
  // A person lends to a company; a rental or a business its owners own pays
  // its money out to them first, and they lend it on.
  if (isSeparatePerson(y) && x.kind === "personal") return "loan";
  return "equity";
}

/** The balancing lines on one side: `amount` is the side's own debit (positive) or credit. */
function sideLines(x: Entity, y: Entity, amount: number, kind: SideKind, accounts: Map<string, BetweenAccount>): PostedLine[] {
  const line = (account: BetweenAccount, value: number): PostedLine => {
    accounts.set(account.code, account);
    return { accountCode: account.code, accountName: account.name, amount: value as Cents, taxType: "NONE", description: `With ${y.name}` };
  };
  if (kind === "loan") {
    const name = x.kind === "personal" ? `Loan with ${y.name}` : `Owed between ${x.name} and ${y.name}`;
    return [
      line(
        { code: `${BETWEEN_PREFIX}${x.id}:loan:${y.id}`, name, entityId: x.id, type: "Current Liability", role: "loan", person: "", counterparty: y.id },
        amount,
      ),
    ];
  }
  if (kind === "loan-per-owner") {
    const shares = sharesOf(y);
    const parts = split(amount, shares);
    return shares.map((share, i) =>
      line(
        {
          code: `${BETWEEN_PREFIX}${x.id}:current:${share.name}`,
          name: `Current account: ${share.name}`,
          entityId: x.id,
          type: "Current Liability",
          role: "current",
          person: share.name,
          counterparty: "",
        },
        parts[i]!,
      ),
    ).filter((l) => l.amount !== 0);
  }
  const shares = sharesOf(x);
  const parts = split(amount, shares);
  const personal = x.kind === "personal";
  // A debit takes money out of the owners' side; a credit puts it in.
  const role: BetweenRole = personal
    ? amount > 0
      ? "paid-for-others"
      : "received-for-others"
    : amount > 0
      ? "drawings"
      : "introduced";
  const words: Record<string, string> = {
    "paid-for-others": "To other entities",
    "received-for-others": "From other entities",
    drawings: "Drawings",
    introduced: "Funds introduced",
  };
  return shares
    .map((share, i) =>
      line(
        {
          code: `${BETWEEN_PREFIX}${x.id}:${role}:${share.name}`,
          name: `${words[role]}: ${share.name}`,
          entityId: x.id,
          type: "Equity",
          role,
          person: share.name,
          counterparty: "",
        },
        parts[i]!,
      ),
    )
    .filter((l) => l.amount !== 0);
}

/**
 * The between-entity journals for a set of posted journals, and the accounts
 * they post to.
 *
 * Each posted journal's lines are given to entities: a bank line to the
 * account's owner, any other to the entity of the account it posts to. A line
 * whose entity is not known stays with the journal's anchor -- the owner of
 * the bank account that moved, or else the first entity named. Every other
 * entity left out of balance is then balanced against the anchor.
 */
export function betweenEntityJournals(
  journals: readonly PostedJournal[],
  options: BetweenOptions,
): { journals: PostedJournal[]; accounts: BetweenAccount[] } {
  const { model } = options;
  const byId = new Map(model.entities.map((e) => [e.id, e]));
  const accounts = new Map<string, BetweenAccount>();
  const out: PostedJournal[] = [];
  if (model.entities.length < 2) return { journals: out, accounts: [] };

  const entityOfLine = (line: PostedLine): string | undefined => {
    if (line.accountCode.startsWith(BETWEEN_PREFIX)) return undefined;
    if (options.isBank(line.accountCode)) return options.bankOwner(line.accountCode);
    return model.accounts[accountEntityKey({ code: line.accountCode, name: line.accountName })];
  };

  for (const journal of journals) {
    const owners = journal.lines.map(entityOfLine);
    const bankIndex = journal.lines.findIndex((l, i) => options.isBank(l.accountCode) && owners[i] !== undefined);
    const anchor = bankIndex >= 0 ? owners[bankIndex] : owners.find((o) => o !== undefined);
    if (anchor === undefined) continue;
    const net = new Map<string, number>();
    journal.lines.forEach((line, i) => {
      const whose = owners[i] ?? anchor;
      net.set(whose, (net.get(whose) ?? 0) + line.amount);
    });
    const home = byId.get(anchor);
    if (home === undefined) continue;
    const lines: PostedLine[] = [];
    for (const [whose, amount] of net) {
      if (whose === anchor || amount === 0) continue;
      const other = byId.get(whose);
      if (other === undefined) continue;
      // The other entity is brought back to balance; the anchor takes the opposite.
      lines.push(...sideLines(other, home, -amount, sideKind(other, home, options.overrides), accounts));
      lines.push(...sideLines(home, other, amount, sideKind(home, other, options.overrides), accounts));
    }
    if (lines.length === 0) continue;
    out.push({
      transactionId: journal.transactionId,
      date: journal.date,
      narration: `Between entities: ${journal.narration}`,
      lines,
      source: "between",
      taxBasis: "both",
    });
  }
  return { journals: out, accounts: [...accounts.values()] };
}

/** What one person has put in, net, across everything they own directly, up to a day. */
export interface PersonPosition {
  person: string;
  /** Positive: more has come to them, through the entities, than they put in. */
  net: Cents;
}

/**
 * Each person's net position from the between-entity entries, and who owes whom.
 *
 * Every balancing line is somebody's: a per-owner line is that owner's, and a
 * single line on something people own directly is split by its owners' shares.
 * A loan with a company stays the company's and counts for nobody here. Where
 * one person's money paid for another's -- the joint account paying for a
 * property one of them owns alone -- the positions differ, and the difference
 * is what one owes the other (or gave them).
 */
export function personPositions(
  journals: readonly PostedJournal[],
  accounts: readonly BetweenAccount[],
  model: EntityModel,
  asAt: IsoDate,
): {
  positions: PersonPosition[];
  owes: { from: string; to: string; amount: Cents }[];
  /** Each person's net, entity by entity: where the difference between them comes from. */
  byEntity: { entityId: string; person: string; net: Cents }[];
} {
  const byCode = new Map(accounts.map((a) => [a.code, a]));
  const byId = new Map(model.entities.map((e) => [e.id, e]));
  const totals = new Map<string, number>();
  const byEntity = new Map<string, number>();
  let entityNow = "";
  const add = (person: string, amount: number): void => {
    totals.set(person, (totals.get(person) ?? 0) + amount);
    const key = `${entityNow}|${person}`;
    byEntity.set(key, (byEntity.get(key) ?? 0) + amount);
  };
  for (const journal of journals) {
    if (journal.source !== "between" || journal.date > asAt) continue;
    for (const line of journal.lines) {
      const account = byCode.get(line.accountCode);
      if (account === undefined) continue;
      entityNow = account.entityId;
      // A credit to an owner's account is value to them.
      if (account.person !== "") {
        add(account.person, -line.amount);
        continue;
      }
      const entity = byId.get(account.entityId);
      if (entity === undefined || isSeparatePerson(entity)) continue;
      const shares = sharesOf(entity);
      split(-line.amount, shares).forEach((part, i) => add(shares[i]!.name, part));
    }
  }
  const positions = [...totals.entries()]
    .map(([person, net]) => ({ person, net: Math.round(net) as Cents }))
    .filter((p) => p.net !== 0)
    .sort((a, b) => a.person.localeCompare(b.person));
  // Those who came out ahead owe those who came out behind, largest first.
  const ahead = positions.filter((p) => p.net > 0).map((p) => ({ ...p }));
  const behind = positions.filter((p) => p.net < 0).map((p) => ({ ...p, net: -p.net }));
  const owes: { from: string; to: string; amount: Cents }[] = [];
  for (const a of ahead) {
    for (const b of behind) {
      if (a.net === 0) break;
      const amount = Math.min(a.net, b.net);
      if (amount <= 0) continue;
      owes.push({ from: a.person, to: b.person, amount: amount as Cents });
      a.net -= amount;
      b.net -= amount;
    }
  }
  const breakdown = [...byEntity.entries()]
    .map(([key, net]) => {
      const [entityId, person] = key.split("|") as [string, string];
      return { entityId, person, net: Math.round(net) as Cents };
    })
    .filter((b) => b.net !== 0);
  return { positions, owes, byEntity: breakdown };
}

/**
 * Current accounts a company (or trust, or society) is owed on by a person at
 * a day: an owner who has taken more than they put in. Interest-free, that is
 * a taxable benefit -- fringe benefit tax for an employee, a deemed dividend
 * otherwise -- so it is said at year end.
 */
export function overdrawnCurrentAccounts(
  journals: readonly PostedJournal[],
  accounts: readonly BetweenAccount[],
  asAt: IsoDate,
): { entityId: string; person: string; amount: Cents }[] {
  const current = new Map(accounts.filter((a) => a.role === "current").map((a) => [a.code, a]));
  const totals = new Map<string, number>();
  for (const journal of journals) {
    if (journal.source !== "between" || journal.date > asAt) continue;
    for (const line of journal.lines) {
      if (!current.has(line.accountCode)) continue;
      totals.set(line.accountCode, (totals.get(line.accountCode) ?? 0) + line.amount);
    }
  }
  return [...totals.entries()]
    .filter(([, amount]) => amount > 0)
    .map(([code, amount]) => {
      const account = current.get(code)!;
      return { entityId: account.entityId, person: account.person, amount: amount as Cents };
    });
}
