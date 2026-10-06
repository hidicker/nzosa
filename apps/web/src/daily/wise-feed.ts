import { autoLinkBankRows } from "./entities.js";
import { addTransactions } from "./bank-import.js";
import { state } from "../state.js";
import { openCloudBookId } from "../store.js";
import { feedIsHosted, feedPossible } from "../feed-route.js";
import { callFunction } from "../cloud.js";
import { note } from "../ui.js";
import { chosenStartDate } from "../migrate/onboarding-state.js";
import { feedRequestFrom, fromWise, onOrAfter, wiseAccountId } from "@nzosa/core";
import type { IsoDate, WiseStatementLine } from "@nzosa/core";

/**
 * Wise, connected with its own API token.
 *
 * The bank feed reaches the New Zealand banks and not Wise, so a Wise balance
 * came in only as a statement downloaded by hand. This is the same shape as
 * the feed: the token is given once and kept by the app's server, never shown
 * again; each balance is chosen to come in or not; and what comes in goes
 * through the same import -- duplicates, review, coding, transfers -- as any
 * bank line.
 */

interface WiseStatus {
  configured: boolean;
  token: string;
  accounts: Record<string, string>;
  /** The day to fetch from, where one was chosen: a balance used for other things before. */
  from: string;
  lastFetch: string;
}

interface WiseBalanceRow {
  profileId: number;
  profileType: string;
  profileName: string;
  balanceId: number;
  currency: string;
  amount: number;
}

/**
 * Ask the app's server, or for books kept online the `wise` function, which
 * holds the token in the vault. The same questions either way: the path and
 * method say which, and are turned into the function's action here.
 */
async function call<T>(path: string, init?: RequestInit): Promise<T> {
  if (feedIsHosted()) {
    const method = init?.method ?? "GET";
    const sent = typeof init?.body === "string" ? (JSON.parse(init.body) as Record<string, unknown>) : {};
    const [route, query] = path.split("?");
    const action =
      route === ""
        ? method === "PUT" ? "connect" : method === "DELETE" ? "disconnect" : "status"
        : route === "/balances" ? "balances"
          : route === "/accounts" ? "set"
            : route === "/statement" ? "statement" : route;
    const asked = Object.fromEntries(new URLSearchParams(query ?? ""));
    return callFunction<T>("wise", { action, book: openCloudBookId(), ...sent, ...asked });
  }
  const response = await fetch(`/api/wise${path}`, init);
  const body = (await response.json().catch(() => ({}))) as { error?: string };
  if (!response.ok) throw new Error(body.error ?? `the app said ${response.status}`);
  return body as T;
}

const json = (body: unknown): RequestInit => ({
  method: "PUT",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

/** The balances Wise last listed, while the page is open. */
let listed: WiseBalanceRow[] | null = null;

function booksStart(): IsoDate | undefined {
  return (chosenStartDate() ?? state.ledger.openingBalances?.asAt) as IsoDate | undefined;
}

function button(label: string, action: () => void, primary = false): HTMLButtonElement {
  const b = document.createElement("button");
  b.type = "button";
  b.textContent = label;
  if (primary) b.className = "primary";
  b.addEventListener("click", action);
  return b;
}

export async function renderWise(): Promise<void> {
  const body = document.getElementById("wise-body");
  if (body === null) return;
  body.textContent = "";
  if (!feedPossible()) {
    body.append(
      note("Wise needs the app running on your own computer, or books kept online, where its token is kept."),
    );
    return;
  }
  const status = await call<WiseStatus>("").catch(() => null);
  if (status === null) {
    body.append(note("Could not reach the app's server."));
    return;
  }
  if (!status.configured) {
    body.append(connectForm());
    return;
  }

  const said = document.createElement("p");
  said.className = "feed-said";
  const head = document.createElement("p");
  head.className = "page-hint";
  head.textContent =
    `Connected with token ${status.token}.` +
    (status.lastFetch ? ` Last fetched ${new Date(status.lastFetch).toLocaleString("en-NZ")}.` : "");
  const disconnect = button("Disconnect", () => {
    if (!confirm("Forget the Wise token for these books? The lines already brought in stay.")) return;
    void call("", { method: "DELETE" }).then(() => {
      listed = null;
      void renderWise();
    });
  });
  body.append(head, disconnect);

  const table = document.createElement("div");
  body.append(table, said);
  const chosen: Record<string, string> = { ...status.accounts };

  const draw = (balances: readonly WiseBalanceRow[]): void => {
    table.textContent = "";
    if (balances.length === 0) {
      table.append(note("Wise lists no balances for this token."));
      return;
    }
    const list = document.createElement("table");
    list.className = "report-table";
    list.innerHTML = "<thead><tr><th>Wise balance</th><th>Now</th><th>Bring into these books</th></tr></thead>";
    const tbody = document.createElement("tbody");
    for (const b of balances) {
      const id = wiseAccountId(b);
      const tr = document.createElement("tr");
      const name = document.createElement("td");
      name.textContent = `${b.profileName || b.profileType} · ${b.currency}`;
      const now = document.createElement("td");
      now.className = "report-amount";
      now.textContent = (b.amount / 100).toLocaleString("en-NZ", { minimumFractionDigits: 2 });
      const pick = document.createElement("td");
      const tick = document.createElement("input");
      tick.type = "checkbox";
      tick.checked = (chosen[String(b.balanceId)] ?? "") !== "";
      tick.addEventListener("change", () => {
        chosen[String(b.balanceId)] = tick.checked ? id : "";
        void call("/accounts", json({ accounts: chosen }));
      });
      pick.append(tick);
      tr.append(name, now, pick);
      tbody.append(tr);
    }
    list.append(tbody);
    table.append(list);

    // From the books' start, unless another day was chosen: a Wise balance
    // used for something else before it was the business's brings that
    // history with it.
    const fromLabel = document.createElement("label");
    fromLabel.className = "field-hint";
    const from = document.createElement("input");
    from.type = "date";
    from.value = status.from || booksStart() || "";
    from.addEventListener("change", () => {
      void call("/accounts", json({ accounts: chosen, from: from.value }));
    });
    fromLabel.append("From ", from, " (the books\u2019 start, or the day this balance became the business\u2019s)");
    const fetchIt = button(
      "Fetch",
      () => void fetchStatements(balances, chosen, said, fetchIt, (from.value || undefined) as IsoDate | undefined, false),
      true,
    );
    table.append(fromLabel, fetchIt);
  };

  if (listed !== null) {
    draw(listed);
  } else {
    said.textContent = "Asking Wise for your balances…";
    call<{ balances: WiseBalanceRow[] }>("/balances")
      .then(({ balances }) => {
        listed = balances;
        said.textContent = "";
        draw(balances);
      })
      .catch((error: Error) => {
        said.textContent = error.message;
      });
  }
}

function connectForm(): HTMLElement {
  const wrap = document.createElement("div");
  wrap.append(
    note(
      "In Wise: Settings → Developer tools (or API tokens) → add a token, Read only is " +
        "enough. Paste it here. It is kept " +
        (feedIsHosted() ? "encrypted in the server's vault" : "by this app on this computer") +
        ", never shown again, and never put in the books.",
    ),
  );
  const input = document.createElement("input");
  input.type = "password";
  input.placeholder = "Wise API token";
  input.autocomplete = "off";
  const said = document.createElement("p");
  said.className = "feed-said";
  const connect = button(
    "Connect Wise",
    () => {
      said.textContent = "Checking the token with Wise…";
      void call("", json({ token: input.value.trim() }))
        .then(() => {
          input.value = "";
          void renderWise();
        })
        .catch((error: Error) => {
          said.textContent = error.message;
        });
    },
    true,
  );
  wrap.append(input, connect, said);
  return wrap;
}

async function fetchStatements(
  balances: readonly WiseBalanceRow[],
  chosen: Record<string, string>,
  said: HTMLElement,
  button: HTMLButtonElement,
  fromDay: IsoDate | undefined,
  restore: boolean,
): Promise<void> {
  const wanted = balances.filter((b) => (chosen[String(b.balanceId)] ?? "") !== "");
  if (wanted.length === 0) {
    said.textContent = "Tick the balances to bring in first.";
    return;
  }
  button.disabled = true;
  said.textContent = "Fetching from Wise…";
  // Never before the books start, whatever day is typed.
  const booksFrom = booksStart();
  const start = fromDay !== undefined && (booksFrom === undefined || fromDay > booksFrom) ? fromDay : booksFrom;
  let added = 0;
  let skipped = 0;
  const problems: string[] = [];
  try {
    for (const b of wanted) {
      const search = new URLSearchParams({
        profileId: String(b.profileId),
        balanceId: String(b.balanceId),
        currency: b.currency,
        // A week early, as the bank feed is, so nothing on the first day is
        // missed; only lines from the start are kept.
        ...(start ? { start: feedRequestFrom(start) } : {}),
      });
      const { transactions } = await call<{ transactions: WiseStatementLine[] }>(`/statement?${search.toString()}`);
      const read = fromWise(transactions, { account: wiseAccountId(b), label: `Wise ${b.currency}` });
      const kept = onOrAfter(read.transactions, start);
      if (read.problems.length > 0) problems.push(`${read.problems.length} Wise ${b.currency} line(s) not read`);
      const before = state.ledger.transactions.length;
      const result = await addTransactions(
        kept,
        { importer: "wise-api", file: `Wise ${b.currency}`, problems: read.problems },
        { restoreRemoved: restore },
      );
      added += state.ledger.transactions.length - before;
      skipped += result.skippedAsRemoved;
    }
    // A Wise number in Xero's bank account list links its chart row now.
    await autoLinkBankRows();
    said.textContent =
      `${added} new line${added === 1 ? "" : "s"} from Wise. Review them on this page, and code them on Reconcile.` +
      (problems.length > 0 ? ` ${problems.join("; ")}.` : "");
    // Said, rather than "0 new lines" and nothing else: lines removed from
    // these books earlier are skipped on every fetch, and a removal that took
    // more than was meant left the balance looking empty with no way back.
    if (skipped > 0) {
      said.append(
        ` ${skipped} line${skipped === 1 ? " was" : "s were"} not brought in: ` +
          `${skipped === 1 ? "it was" : "they were"} removed from these books earlier. `,
      );
      const back = document.createElement("button");
      back.type = "button";
      back.textContent = "Bring them back";
      back.addEventListener("click", () => {
        if (
          !confirm(
            `Bring back the ${skipped} Wise line${skipped === 1 ? "" : "s"} removed earlier` +
              (start ? `, from ${start} on` : "") + "?",
          )
        ) {
          return;
        }
        void fetchStatements(balances, chosen, said, button, fromDay, true);
      });
      said.append(back);
    }
  } catch (error) {
    said.textContent = (error as Error).message;
  } finally {
    button.disabled = false;
  }
}
