import { codingEngine } from "@nzosa/core";
import type {
  Account,
  BalanceSection,
  CodingEngine,
  EntityModel,
  Transaction,
} from "@nzosa/core";
import { Sandbox } from "./sandbox.js";
import type { BookFile } from "./sandbox.js";

/**
 * A folder of books, read once and kept until a file in it changes.
 *
 * The app writes each part as `{ version, data }`. Only what the tools need is
 * taken, and nothing is written back.
 */
export interface Books {
  name: string;
  transactions: Transaction[];
  entities: EntityModel;
  chart: Account[];
  engine: CodingEngine | null;
  dailyBalances: BalanceSection[];
}

type Rules = NonNullable<Parameters<typeof codingEngine>[0]["rules"]>;

export class BookShelf {
  private cached: { stamp: string; books: Books } | undefined;

  constructor(readonly sandbox: Sandbox) {}

  get(): Books {
    const stamp = this.sandbox.stamp();
    if (this.cached?.stamp === stamp) return this.cached.books;
    const books = this.read();
    this.cached = { stamp, books };
    return books;
  }

  private part(name: BookFile): unknown {
    const text = this.sandbox.read(name);
    if (text === undefined) return undefined;
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch (error) {
      throw new Error(`${name} is not valid JSON: ${(error as Error).message}`);
    }
    const held = (parsed as { data?: unknown } | null)?.data;
    return held ?? parsed;
  }

  private read(): Books {
    const meta = (this.part("ledger.json") ?? {}) as { name?: string };
    const transactions = asArray<Transaction>(this.part("transactions.json"));
    const decisions = (this.part("decisions.json") ?? {}) as Record<string, unknown>;
    const entities = (this.part("entities.json") ?? { entities: [], accounts: {}, banks: {} }) as EntityModel;
    const chart = asArray<Account>(this.part("chart.json"));
    const rules = rulesFrom(this.part("rules.json"));

    const engine = codingEngine({
      transactions,
      splits: (decisions["splits"] ?? {}) as never,
      overrides: (decisions["overrides"] ?? {}) as never,
      ...(rules ? { rules } : {}),
    });

    return {
      name: meta.name ?? "NZOSA books",
      transactions,
      entities,
      chart,
      engine,
      dailyBalances: asArray<BalanceSection>(decisions["dailyBalances"]),
    };
  }
}

/**
 * The rule set inside a rules file.
 *
 * A file written by hand is the set itself; the one the app writes wraps it with
 * where it came from. Both are read, as the app reads them.
 */
function rulesFrom(held: unknown): Rules | undefined {
  if (held === null || typeof held !== "object" || Object.keys(held).length === 0) return undefined;
  const file = held as Record<string, unknown>;
  return (Array.isArray(file["rules"]) ? file : file["rules"]) as Rules | undefined;
}

function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}
