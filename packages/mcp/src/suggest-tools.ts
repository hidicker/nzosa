import {
  addSuggestedSet,
  labelForCode,
  lockedThrough,
  readSuggestedFile,
  splitAccountLabel,
  suggesterName,
  suggestionsWaiting,
} from "@nzosa/core";
import type { Cents, IsoDate, SuggestedItem, SuggestedJournalLine, SuggestedSplitPart, Transaction } from "@nzosa/core";
import type { Books } from "./load.js";
import { ToolError, entitiesOfLine, money, row, scope, text } from "./tools.js";
import type { Tool, ToolContext } from "./tools.js";

/**
 * Suggesting, for a server started with --suggest.
 *
 * The books are still never written. A suggestion is checked against them --
 * a real line, a real account, a split that adds up, a journal that balances,
 * nothing in a locked period -- and kept in the suggestions file beside them.
 * It reaches the books only when somebody uses it in NZOSA, where it goes
 * through the same checks as if they had typed it. Several suggestions made
 * in one call are one set, and the same set sent twice is kept once, so a
 * call retried after a dropped answer does not suggest everything twice.
 */

const WHERE_IT_WAITS =
  "Nothing is in the books yet: it waits in NZOSA until somebody uses it there. " +
  "Codes show on Reconcile as suggested; splits and journals are listed under Actions required.";

/** Pages a person can be shown, by the name NZOSA's menu uses. */
const PAGES = ["reconcile", "actions", "invoices", "bills", "reports", "gst", "contacts", "assets"] as const;

const MAX_CODES = 200;

/** A decimal string as cents, unsigned or signed: "12.30", "-12.3", "12". */
function cents(value: unknown, where: string): Cents {
  const said = typeof value === "number" ? String(value) : value;
  if (typeof said !== "string" || !/^-?\d+(\.\d{1,2})?$/.test(said.trim())) {
    throw new ToolError(`${where}: give the amount as a decimal such as "123.45".`);
  }
  const trimmed = said.trim();
  const negative = trimmed.startsWith("-");
  const [dollars = "0", part = ""] = trimmed.replace("-", "").split(".");
  const total = Number(dollars) * 100 + Number(part.padEnd(2, "0"));
  return negative ? -total : total;
}

function said(value: unknown, where: string, max = 300): string {
  if (typeof value !== "string" || value.trim() === "") throw new ToolError(`${where}: say why, in a line.`);
  return value.trim().slice(0, max);
}

/** An account as these books name it, from a full name or the code alone. */
function account(books: Books, value: unknown, where: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new ToolError(`${where}: give an account from list_accounts.`);
  }
  const wanted = value.trim();
  const exact = books.labels.find((label) => label.toLowerCase() === wanted.toLowerCase());
  // By name alone ("General Expenses"), when only one account has it.
  const byName = books.labels.filter((label) => {
    const at = label.lastIndexOf(" - ");
    return at > 0 && label.slice(0, at).trim().toLowerCase() === wanted.toLowerCase();
  });
  const found =
    exact ?? (byName.length === 1 ? byName[0] : undefined) ?? labelForCode(splitAccountLabel(wanted).code || wanted, books.labels);
  if (found === undefined || found === null) {
    throw new ToolError(`${where}: these books have no account "${wanted}". Use one from list_accounts.`);
  }
  return found;
}

function notLocked(books: Books, day: string, where: string): void {
  const through = lockedThrough(books.locks);
  if (through !== undefined && day <= through) {
    throw new ToolError(`${where}: ${day} is in a locked period (locked to ${through}), so nothing can be suggested there.`);
  }
}

/** A line of these books, one this server may show, outside any lock. */
function line(books: Books, context: ToolContext, id: unknown, where: string): Transaction {
  if (typeof id !== "string" || id === "") throw new ToolError(`${where}: give the line's id.`);
  const found = books.transactions.find((t) => t.id === id);
  const shown =
    found !== undefined &&
    (context.allowed === undefined ||
      entitiesOfLine(books, found, books.engine?.codeOf(found) ?? null).some((e) => context.allowed?.has(e)));
  if (found === undefined || !shown) throw new ToolError(`${where}: no line "${id}" in these books.`);
  notLocked(books, found.date, where);
  return found;
}

function keep(context: ToolContext, items: SuggestedItem[]): Record<string, unknown> {
  const sandbox = context.shelf.sandbox;
  const heldText = sandbox.readSuggested();
  let held: unknown = undefined;
  try {
    held = heldText === undefined ? undefined : JSON.parse(heldText);
  } catch {
    // A file somebody broke by hand is started again rather than refused for ever.
    held = undefined;
  }
  const now = context.now?.() ?? new Date().toISOString();
  const { file, set, already } = addSuggestedSet(readSuggestedFile(held), items, context.client ?? "", now);
  if (!already) sandbox.writeSuggested(JSON.stringify(file));
  return {
    suggestionSet: set.id,
    suggestions: items.length,
    ...(already ? { alreadyHeld: true } : {}),
    from: suggesterName(set.from),
    said: WHERE_IT_WAITS,
  };
}

function needSuggesting(context: ToolContext): void {
  if (context.suggest !== true) {
    throw new ToolError("This server was started read-only. Start it with --suggest to make suggestions.");
  }
}

export const SUGGEST_TOOLS: Tool[] = [
  {
    name: "suggest_codes",
    description:
      "Suggest an account for bank lines nothing has coded yet (from get_unreconciled_transactions). " +
      "Each is checked: the line must be in these books, still uncoded and outside any locked period, and the account must be one of list_accounts. " +
      WHERE_IT_WAITS,
    inputSchema: {
      type: "object",
      properties: {
        lines: {
          type: "array",
          description: `Up to ${MAX_CODES}.`,
          items: {
            type: "object",
            properties: {
              transaction: { type: "string", description: "The line's id." },
              account: { type: "string", description: "An account from list_accounts, by name or code." },
              because: { type: "string", description: "One line for the person deciding: why this account." },
            },
            required: ["transaction", "account", "because"],
            additionalProperties: false,
          },
        },
      },
      required: ["lines"],
      additionalProperties: false,
    },
    run(args, context) {
      needSuggesting(context);
      const books = context.shelf.get();
      const asked = args["lines"];
      if (!Array.isArray(asked) || asked.length === 0) throw new ToolError("lines: give at least one.");
      if (asked.length > MAX_CODES) throw new ToolError(`lines: at most ${MAX_CODES} in one call.`);
      const items: SuggestedItem[] = [];
      const seen = new Set<string>();
      for (const [i, one] of asked.entries()) {
        const where = `lines[${i}]`;
        const given = (one ?? {}) as Record<string, unknown>;
        const t = line(books, context, given["transaction"], where);
        if (seen.has(t.id)) throw new ToolError(`${where}: line ${t.id} is suggested twice.`);
        seen.add(t.id);
        const now = books.engine?.codeOf(t) ?? null;
        if (now !== null) throw new ToolError(`${where}: line ${t.id} is already coded to ${now}. Only uncoded lines take a suggested code.`);
        if (books.split.has(t.id)) throw new ToolError(`${where}: line ${t.id} is split already.`);
        items.push({ kind: "coding", transaction: t.id, code: account(books, given["account"], where), because: said(given["because"], where) });
      }
      return keep(context, items);
    },
  },

  {
    name: "suggest_split",
    description:
      "Suggest splitting one bank line between accounts. The parts must add up to the line exactly; give amounts unsigned and they take the line's direction. " +
      WHERE_IT_WAITS,
    inputSchema: {
      type: "object",
      properties: {
        transaction: { type: "string", description: "The line's id." },
        parts: {
          type: "array",
          items: {
            type: "object",
            properties: {
              amount: { type: "string", description: 'A decimal such as "115.00".' },
              account: { type: "string", description: "An account from list_accounts." },
              note: { type: "string" },
            },
            required: ["amount", "account"],
            additionalProperties: false,
          },
        },
        because: { type: "string" },
      },
      required: ["transaction", "parts", "because"],
      additionalProperties: false,
    },
    run(args, context) {
      needSuggesting(context);
      const books = context.shelf.get();
      const t = line(books, context, args["transaction"], "transaction");
      const asked = args["parts"];
      if (!Array.isArray(asked) || asked.length < 2) throw new ToolError("parts: a split needs at least two.");
      const given = asked.map((one, i) => {
        const part = (one ?? {}) as Record<string, unknown>;
        const note = text(part, "note");
        return {
          amount: cents(part["amount"], `parts[${i}]`),
          code: account(books, part["account"], `parts[${i}]`),
          ...(note !== undefined ? { note: note.slice(0, 200) } : {}),
        };
      });
      // Unsigned parts of a payment are the payment's parts.
      const flip = t.amount < 0 && given.every((p) => p.amount >= 0);
      const parts: SuggestedSplitPart[] = given.map((p) => ({ ...p, amount: flip ? -p.amount : p.amount }));
      const total = parts.reduce((sum, p) => sum + p.amount, 0);
      if (total !== t.amount) {
        throw new ToolError(`parts: they come to ${money(total)}, and the line is ${money(t.amount)} (out by ${money(total - t.amount)}).`);
      }
      return keep(context, [{ kind: "split", transaction: t.id, parts, because: said(args["because"], "because") }]);
    },
  },

  {
    name: "suggest_journal",
    description:
      "Suggest a manual journal: a date, a narration, and lines that each debit or credit one account. Debits must equal credits, and the date must be outside any locked period. " +
      WHERE_IT_WAITS,
    inputSchema: {
      type: "object",
      properties: {
        date: { type: "string", description: "YYYY-MM-DD." },
        narration: { type: "string", description: "What the journal is for, as it will read a year from now." },
        lines: {
          type: "array",
          items: {
            type: "object",
            properties: {
              account: { type: "string", description: "An account from list_accounts." },
              debit: { type: "string", description: 'A decimal such as "1287.40"; give debit or credit, not both.' },
              credit: { type: "string" },
              description: { type: "string" },
            },
            required: ["account"],
            additionalProperties: false,
          },
        },
        because: { type: "string" },
      },
      required: ["date", "narration", "lines", "because"],
      additionalProperties: false,
    },
    run(args, context) {
      needSuggesting(context);
      const books = context.shelf.get();
      const day = text(args, "date");
      if (day === undefined || !/^\d{4}-\d{2}-\d{2}$/.test(day) || Number.isNaN(Date.parse(day))) {
        throw new ToolError("date: give it as YYYY-MM-DD.");
      }
      notLocked(books, day, "date");
      const narration = text(args, "narration")?.trim();
      if (narration === undefined || narration === "") throw new ToolError("narration: say what the journal is for.");
      const asked = args["lines"];
      if (!Array.isArray(asked) || asked.length < 2) throw new ToolError("lines: a journal needs at least two.");
      const lines: SuggestedJournalLine[] = asked.map((one, i) => {
        const where = `lines[${i}]`;
        const given = (one ?? {}) as Record<string, unknown>;
        const hasDebit = given["debit"] !== undefined && given["debit"] !== "";
        const hasCredit = given["credit"] !== undefined && given["credit"] !== "";
        if (hasDebit === hasCredit) throw new ToolError(`${where}: give a debit or a credit, one of them.`);
        const amount = cents(hasDebit ? given["debit"] : given["credit"], where);
        if (amount <= 0) throw new ToolError(`${where}: the amount must be more than nothing.`);
        const description = text(given, "description");
        return {
          code: account(books, given["account"], where),
          debit: hasDebit ? amount : 0,
          credit: hasCredit ? amount : 0,
          ...(description !== undefined ? { description: description.slice(0, 200) } : {}),
        };
      });
      const debits = lines.reduce((sum, l) => sum + l.debit, 0);
      const credits = lines.reduce((sum, l) => sum + l.credit, 0);
      if (debits !== credits) {
        throw new ToolError(`lines: debits ${money(debits)} and credits ${money(credits)} do not balance (out by ${money(debits - credits)}).`);
      }
      return keep(context, [
        { kind: "journal", date: day as IsoDate, narration: narration.slice(0, 300), lines, because: said(args["because"], "because") },
      ]);
    },
  },

  {
    name: "show_in_app",
    description:
      "Bring up a page in NZOSA where the person has it open, for them to look at what you are talking about, with a search filled in. Changes nothing.",
    inputSchema: {
      type: "object",
      properties: {
        page: { type: "string", enum: [...PAGES] },
        search: { type: "string", description: "Words or an amount for the page's search box (Reconcile, Invoices, Bills)." },
      },
      required: ["page"],
      additionalProperties: false,
    },
    run(args, context) {
      needSuggesting(context);
      const page = text(args, "page");
      if (page === undefined || !(PAGES as readonly string[]).includes(page)) {
        throw new ToolError(`page: one of ${PAGES.join(", ")}.`);
      }
      const search = text(args, "search")?.trim().slice(0, 100);
      // Unique each time: showing the same page twice is two requests.
      const at = context.now?.() ?? new Date().toISOString();
      const kept = keep(context, [{ kind: "show", page, ...(search ? { search } : {}), at } as SuggestedItem]);
      return { ...kept, said: "Shown in NZOSA if it is open on this computer." };
    },
  },

  {
    name: "list_suggestions",
    description: "The suggestions made here that nobody has used or declined in NZOSA yet.",
    inputSchema: { type: "object", properties: { entity: { type: "string" } }, additionalProperties: false },
    run(args, context) {
      const books = context.shelf.get();
      scope(books, context, args);
      let held: unknown = undefined;
      try {
        const textHeld = context.shelf.sandbox.readSuggested();
        held = textHeld === undefined ? undefined : JSON.parse(textHeld);
      } catch {
        held = undefined;
      }
      const waiting = suggestionsWaiting(readSuggestedFile(held), books.suggestionsDone).filter(
        (one) => one.item.kind !== "show",
      );
      return {
        waiting: waiting.length,
        suggestions: waiting.slice(0, context.maxRows).map(({ set, item }) => {
          if (item.kind === "coding" || item.kind === "split") {
            const t = books.transactions.find((x) => x.id === item.transaction);
            return { kind: item.kind, at: set.at, line: t === undefined ? item.transaction : row(books, t, null), ...(item.kind === "coding" ? { account: item.code } : { parts: item.parts.map((p) => ({ ...p, amount: money(p.amount) })) }) };
          }
          if (item.kind === "journal") {
            return { kind: "journal", at: set.at, date: item.date, narration: item.narration, lines: item.lines.map((l) => ({ ...l, debit: money(l.debit), credit: money(l.credit) })) };
          }
          return { kind: item.kind, at: set.at };
        }),
      };
    },
  },
];

/** The accounts a line can be coded to, for every suggest tool. Offered read-only too. */
export const LIST_ACCOUNTS: Tool = {
  name: "list_accounts",
  description:
    "Every account these books can code to, by the name NZOSA uses, with the entity it belongs to where the books say. Use these names when suggesting.",
  inputSchema: { type: "object", properties: { entity: { type: "string" } }, additionalProperties: false },
  run(args, context) {
    const books = context.shelf.get();
    const entity = scope(books, context, args);
    const accounts = books.labels
      .map((label) => {
        const owner = books.entities.accounts[splitAccountLabel(label).code];
        return { account: label, entity: owner ?? null };
      })
      .filter((a) => entity === undefined || a.entity === null || a.entity === entity)
      .filter((a) => context.allowed === undefined || a.entity === null || context.allowed.has(a.entity));
    return { accounts };
  },
};
