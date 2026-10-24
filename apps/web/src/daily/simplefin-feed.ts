import { autoLinkBankRows } from "./entities.js";
import { addTransactions } from "./bank-import.js";
import { state } from "../state.js";
import { feedIsHosted } from "../feed-route.js";
import { backendKind } from "../store.js";
import { askOnPage, note } from "../ui.js";
import { chosenStartDate } from "../migrate/onboarding-state.js";
import { feedRequestFrom, fromSimpleFin, onOrAfter, simpleFinAccountId } from "@nzosa/core";
import type { IsoDate, SimpleFinAccount } from "@nzosa/core";
import { booksCurrency, booksLocale } from "../country.js";

/**
 * SimpleFIN, the bank feed for United States and Canadian banks that the
 * person subscribes to themselves at the SimpleFIN Bridge.
 *
 * The same shape as Wise: a Setup Token is given once and claimed by the
 * app's server, which keeps the access it gives and never shows it again;
 * each account is chosen to come in or not; and what comes in goes through
 * the same import -- duplicates, review, coding, transfers -- as any bank line.
 */

interface SimpleFinStatus {
  configured: boolean;
  bridge: string;
  accounts: Record<string, string>;
  from: string;
  lastFetch: string;
}

interface SimpleFinRow {
  id: string;
  name: string;
  institution: string;
  currency: string;
  balance: string;
  balanceDate: number;
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api/simplefin${path}`, init);
  const body = (await response.json().catch(() => ({}))) as { error?: string };
  if (!response.ok) throw new Error(body.error ?? `the app said ${response.status}`);
  return body as T;
}

const json = (body: unknown): RequestInit => ({
  method: "PUT",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

/** The accounts the Bridge last listed, while the page is open. */
let listed: SimpleFinRow[] | null = null;
let listedErrors: string[] = [];

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

/** Each drawing counted, as Wise's: only the latest draws. */
let drawingCount = 0;
let lastSaid = "";

/** Where the books are kept, for dating a line: the time zone of this computer. */
function timeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
}

export async function renderSimpleFin(): Promise<void> {
  const drawing = ++drawingCount;
  const body = document.getElementById("simplefin-body");
  if (body === null) return;
  if (backendKind() !== "folder" || feedIsHosted()) {
    body.textContent = "";
    body.append(note("SimpleFIN needs the app running on your own computer, where its access is kept."));
    return;
  }
  const status = await call<SimpleFinStatus>("").catch(() => null);
  if (drawing !== drawingCount) return;
  body.textContent = "";
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
    `Connected to ${status.bridge || "the SimpleFIN Bridge"}.` +
    (status.lastFetch ? ` Last fetched ${new Date(status.lastFetch).toLocaleString(booksLocale())}.` : "");
  const disconnect = button("Disconnect", async () => {
    if (!await askOnPage("Forget the SimpleFIN access for these books? The lines already brought in stay.")) return;
    void call("", { method: "DELETE" }).then(() => {
      listed = null;
      void renderSimpleFin();
    });
  });
  body.append(head, disconnect);

  const table = document.createElement("div");
  said.textContent = lastSaid;
  body.append(table, said);
  const chosen: Record<string, string> = { ...status.accounts };

  const draw = (accounts: readonly SimpleFinRow[]): void => {
    table.textContent = "";
    for (const error of listedErrors) table.append(note(`The Bridge says: ${error}`));
    if (accounts.length === 0) {
      table.append(note("The Bridge lists no accounts yet. Connect your banks at the SimpleFIN Bridge first."));
      return;
    }
    const list = document.createElement("table");
    list.className = "report-table";
    list.innerHTML = "<thead><tr><th>Account</th><th>Balance</th><th>Bring into these books</th></tr></thead>";
    const tbody = document.createElement("tbody");
    for (const a of accounts) {
      const tr = document.createElement("tr");
      const name = document.createElement("td");
      name.textContent = [a.institution, a.name].filter((s) => s !== "").join(" · ") + ` · ${a.currency}`;
      const now = document.createElement("td");
      now.className = "report-amount";
      const amount = Number(a.balance);
      now.textContent = Number.isFinite(amount)
        ? amount.toLocaleString(booksLocale(), { minimumFractionDigits: 2, maximumFractionDigits: 2 })
        : a.balance;
      const pick = document.createElement("td");
      const tick = document.createElement("input");
      tick.type = "checkbox";
      tick.checked = (chosen[a.id] ?? "") !== "";
      // The books' own currency only, as for Wise.
      if (a.currency.toUpperCase() !== booksCurrency() && !tick.checked) {
        tick.disabled = true;
        tick.title = `Only ${booksCurrency()} accounts can be brought in.`;
      }
      tick.addEventListener("change", () => {
        chosen[a.id] = tick.checked ? simpleFinAccountId(a) : "";
        void call("/accounts", json({ accounts: chosen }));
      });
      pick.append(tick);
      tr.append(name, now, pick);
      tbody.append(tr);
    }
    list.append(tbody);
    table.append(list);

    const fromLabel = document.createElement("label");
    fromLabel.className = "field-hint";
    const from = document.createElement("input");
    from.type = "date";
    from.value = status.from || booksStart() || "";
    from.addEventListener("change", () => {
      void call("/accounts", json({ accounts: chosen, from: from.value }));
    });
    fromLabel.append("From ", from, " (the books’ start, or the day this account became the business’s)");
    const fetchIt = button(
      "Fetch",
      () => void fetchAccounts(accounts, chosen, said, fetchIt, (from.value || undefined) as IsoDate | undefined, false),
      true,
    );
    table.append(fromLabel, fetchIt);
  };

  if (listed !== null) {
    draw(listed);
  } else {
    said.textContent = "Asking the Bridge for your accounts…";
    call<{ accounts: SimpleFinRow[]; errors: string[] }>("/accounts")
      .then(({ accounts, errors }) => {
        listed = accounts;
        listedErrors = errors;
        said.textContent = lastSaid;
        draw(accounts);
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
      "At the SimpleFIN Bridge (beta-bridge.simplefin.org), connect your banks, then make a Setup Token for " +
        "this app and paste it here. It is claimed once: the access it gives is kept by this app on this " +
        "computer, never shown again and never put in the books. SimpleFIN reads; it cannot move money.",
    ),
  );
  const input = document.createElement("input");
  input.type = "password";
  input.placeholder = "SimpleFIN Setup Token";
  input.autocomplete = "off";
  const said = document.createElement("p");
  said.className = "feed-said";
  const connect = button(
    "Connect SimpleFIN",
    () => {
      said.textContent = "Claiming the token at the Bridge…";
      void call("", json({ token: input.value.trim() }))
        .then(() => {
          input.value = "";
          listed = null;
          void renderSimpleFin();
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

async function fetchAccounts(
  accounts: readonly SimpleFinRow[],
  chosen: Record<string, string>,
  said: HTMLElement,
  button: HTMLButtonElement,
  fromDay: IsoDate | undefined,
  restore: boolean,
): Promise<void> {
  const wanted = accounts.filter((a) => (chosen[a.id] ?? "") !== "" && a.currency.toUpperCase() === booksCurrency());
  if (wanted.length === 0) {
    said.textContent = `Tick the ${booksCurrency()} accounts to bring in first.`;
    return;
  }
  button.disabled = true;
  said.textContent = "Fetching from SimpleFIN…";
  // Never before the books start, whatever day is typed.
  const booksFrom = booksStart();
  const start = fromDay !== undefined && (booksFrom === undefined || fromDay > booksFrom) ? fromDay : booksFrom;
  let added = 0;
  let skipped = 0;
  const problems: string[] = [];
  try {
    for (const a of wanted) {
      const search = new URLSearchParams({
        account: a.id,
        // A week early, as the bank feed is; only lines from the start are kept.
        ...(start ? { start: feedRequestFrom(start) } : {}),
      });
      const fetched = await call<{ account: SimpleFinAccount; errors: string[] }>(`/transactions?${search.toString()}`);
      for (const error of fetched.errors) problems.push(error);
      const label = [a.institution, a.name].filter((s) => s !== "").join(" ");
      const read = fromSimpleFin(fetched.account, { timeZone: timeZone(), label });
      const kept = onOrAfter(read.transactions, start);
      if (read.problems.length > 0) problems.push(`${read.problems.length} line(s) of ${a.name} not read`);
      const before = state.ledger.transactions.length;
      const result = await addTransactions(
        kept,
        { importer: "simplefin", file: `SimpleFIN ${a.name}`, problems: read.problems },
        { restoreRemoved: restore },
      );
      added += state.ledger.transactions.length - before;
      skipped += result.skippedAsRemoved;
    }
    await autoLinkBankRows();
    said.textContent =
      `${added} new line${added === 1 ? "" : "s"} from SimpleFIN. Review them on this page, and code them on Reconcile.` +
      (problems.length > 0 ? ` ${[...new Set(problems)].map((p) => p.replace(/\.+$/, "")).join("; ")}.` : "");
    lastSaid = said.textContent;
    for (const shown of document.querySelectorAll<HTMLElement>("#simplefin-body .feed-said")) shown.textContent = lastSaid;
    if (skipped > 0) {
      said.append(
        ` ${skipped} line${skipped === 1 ? " was" : "s were"} not brought in: ` +
          `${skipped === 1 ? "it was" : "they were"} removed from these books earlier. `,
      );
      const back = document.createElement("button");
      back.type = "button";
      back.textContent = "Bring them back";
      back.addEventListener("click", async () => {
        if (!await askOnPage(`Bring back the ${skipped} line${skipped === 1 ? "" : "s"} removed earlier?`)) return;
        void fetchAccounts(accounts, chosen, said, button, fromDay, true);
      });
      said.append(back);
    }
  } catch (error) {
    said.textContent = (error as Error).message;
  } finally {
    button.disabled = false;
  }
}
