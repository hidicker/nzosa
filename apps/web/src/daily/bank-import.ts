import { redraw, showPage } from "../app.js";
import { accountsForEditing, ensureDefaultEntity, reclassify, } from "../books.js";
import { balanceMovementSection, renderBalanceChecks } from "../daily/opening-balances.js";
import { currentReport, ownerSummaryFor } from "../daily/reports.js";
import type { RuleFileShape } from "../rules-ui.js";
import { $, state } from "../state.js";
import { save, writesToFolder } from "../store.js";
import { download, escapeHtml, nameCell, note } from "../ui.js";
import {
  accountEntityKey,
  accountsAtExportLimit,
  akahuAccountId,
  checkDailyBalances,
  dedupe,
  dedupeKey,
  depreciationSchedule,
  emptyEntityModel,
  feedResumeDate,
  financialYearOf,
  formatAmount,
  formatChartOfAccounts,
  formatDepreciationSchedule,
  formatOwnerSummary,
  formatOwners,
  formatProfitAndLoss,
  fromAkahu,
  hash,
  importFile,
  importers,
  judgeDuplicates,
  matchLedgerAccount,
  parseDailyBalances,
} from "@nzosa/core";
import type {
  Account,
  AkahuAccount,
  AkahuTransaction,
  DuplicateJudgement,
  ImportProblem,
  Transaction,
} from "@nzosa/core";

/**
 * Getting bank data in, by file or by feed.
 *
 * This is the one thing that happens every month for as long as the books are
 * kept, so it is judged by the awkward cases rather than the easy one. A
 * statement re-imported over one already held must not double the year: lines
 * are keyed on what they are rather than where they sat in a file, so the same
 * download twice is caught and reported rather than absorbed.
 *
 * A bank that caps an export at a round thousand rows says nothing about
 * having done so, and an account holding exactly the cap is reported for
 * somebody to check. A total that looks complete and is not is worse than one
 * that is obviously short.
 *
 * The feed is the same intake by another road, and resumes from where the
 * earliest-ending account stops, less a week: a card charge settles after the
 * date it carries, and a duplicate is cheap where a gap is not.
 */

/**
 * Where a fetch from the feed should start.
 *
 * One request covers every account at once, so the window has to suit the
 * account furthest behind rather than the ledger as a whole. Taking the last
 * transaction anywhere in the books meant an account that had not been
 * imported for months -- or a newly connected one with nothing at all -- was
 * asked only for the last week, and the rest never arrived. Nothing failed and
 * nothing was said; the account was simply short.
 *
 * So the earliest of the per-account dates, and nothing at all when any mapped
 * account is empty, because everything it holds is still to come.
 */
function feedStartDate(mapping: Record<string, string>): string | undefined {
  return feedResumeDate({ mapping, transactions: state.ledger.transactions });
}

/**
 * Bring in what the feed has, on opening, without being asked.
 *
 * This is the step a feed exists to remove. Somebody who connected one wants
 * what it holds; making them press a button for it every time puts the manual
 * step back in a different place.
 *
 * It runs after everything else and is not waited for: a slow feed or a bank
 * having a bad morning must not hold up books that are already on the screen.
 * It says what it did, because something that changes a ledger on its own has
 * to be visible, and it does nothing at all until accounts have been mapped --
 * an unmapped feed has nowhere to put anything.
 */
export async function autoFetchFromFeed(): Promise<void> {
  if (!writesToFolder()) return;

  try {
    const status = (await fetch("/api/feed").then((r) => r.json())) as {
      configured: boolean;
      autoFetch: boolean;
      accounts: Record<string, string>;
    };
    if (!status.configured || !status.autoFetch) return;

    const mapping = status.accounts ?? {};
    const mapped = Object.values(mapping).filter((to) => to !== "");
    if (mapped.length === 0) return;

    const start = feedStartDate(mapping);
    const search = start === undefined ? "" : `?start=${encodeURIComponent(`${start}T00:00:00.000Z`)}`;

    const answer = (await fetch(`/api/feed/transactions${search}`).then((r) => r.json())) as {
      items?: AkahuTransaction[];
      error?: string;
    };
    if (answer.error !== undefined) throw new Error(answer.error);

    const read = fromAkahu(answer.items ?? [], {
      accountFor: (id) => {
        const to = mapping[id];
        return to === undefined || to === "" ? null : to;
      },
    });
    if (read.transactions.length === 0) return;

    const before = state.ledger.transactions.length;
    await addTransactions(read.transactions, {
      importer: "akahu",
      file: "bank feed, on opening",
      problems: read.problems,
    });
    const added = state.ledger.transactions.length - before;

    // Nothing new is the ordinary case and says nothing. Something new is
    // worth a line, because it arrived without anybody asking.
    if (added === 0) return;
    state.startupMessage =
      `${added} new transaction${added === 1 ? "" : "s"} from the bank feed. ` +
      "They are on the Bank import page with anything that needs a decision.";
    // Through showPage rather than render: the startup line is drawn there,
    // and setting the state without it left the message written down and never
    // shown -- which for something that changed the ledger on its own is the
    // one thing it must not do.
    showPage(state.page);
  } catch (error) {
    // Quiet on the page that is showing: the books are fine, the feed is not,
    // and the Bank feed page is where that belongs.
    state.feedProblem = (error as Error).message;
  }
}

export async function handleFiles(files: File[]): Promise<void> {
  if (files.length === 0 || state.busy) return;

  state.busy = true;
  state.reports = [];
  render();

  const account = $<HTMLInputElement>("account").value.trim();
  const currency = $<HTMLInputElement>("currency").value.trim().toUpperCase() || "NZD";
  const dayFirst = $<HTMLInputElement>("day-first").checked;

  const incoming: Transaction[] = [];

  for (const file of files) {
    if (file.size > 50 * 1024 * 1024) {
      alert(`"${file.name}" is over 50MB. Bank export files are normally much smaller. Skipped to prevent memory exhaustion.`);
      continue;
    }
    const text = await file.text();

    try {
      const result = importFile(text, {
        file: file.name,
        defaultCurrency: currency,
        dayFirst,
        ...(account !== "" ? { account } : {}),
      });

      incoming.push(...result.transactions);
      state.reports.push({
        name: file.name,
        importer: result.importer,
        account: result.account,
        count: result.transactions.length,
        problems: result.problems,
      });
    } catch (error) {
      state.reports.push({
        name: file.name,
        importer: "",
        account: "",
        count: 0,
        problems: [],
        error: (error as Error).message,
      });
    }
  }

  // Existing rows go first so anything already in the ledger wins the tie and
  // keeps its provenance. Anything already judged a duplicate and thrown
  // away is not offered again.
  const discarded = new Set(state.ledger.removedDuplicates ?? []);
  const merged = dedupe(
    [...state.ledger.transactions, ...incoming.filter((t) => !discarded.has(t.id))],
    { legitimateDuplicates: state.ledger.legitimateDuplicates },
  );

  state.ledger = { ...state.ledger, transactions: merged.kept };
  state.entries = merged.entries;
  showWhatNeedsDeciding();

  state.persistent = await save(state.ledger);
  // Bank files are where somebody with no other accounting system starts, so
  // this is the moment their books first hold any accounts at all -- and the
  // moment to give them the one entity those accounts belong to. It was only
  // done on opening the ledger and after a chart import, so a person who
  // imported a statement and carried on saw no entity until they next reloaded.
  await ensureDefaultEntity();
  state.busy = false;
  render();
}

/**
 * Put transactions from somewhere other than a file into the ledger.
 *
 * The same merge a file import does, so a feed is not a second way in with its
 * own rules: the same duplicate check, the same review list, the same report at
 * the top of the Import page.
 *
 * Ids are assigned here for the same reason the file importers assign them
 * centrally -- from the transaction's own content, so the same transaction gets
 * the same id however it arrived, and a coding survives a change of route.
 */
async function addTransactions(
  incoming: Transaction[],
  report: { importer: string; file: string; problems: ImportProblem[] },
): Promise<void> {
  const counts = new Map<string, number>();
  for (const transaction of incoming) {
    const key = dedupeKey(transaction);
    const next = (counts.get(key) ?? 0) + 1;
    counts.set(key, next);
    transaction.occurrence = next;
  }
  for (const transaction of incoming) transaction.id = hash(dedupeKey(transaction));

  // Anything already judged a duplicate and thrown away does not come back.
  const removed = new Set(state.ledger.removedDuplicates ?? []);
  const wanted = incoming.filter((transaction) => !removed.has(transaction.id));

  const merged = dedupe([...state.ledger.transactions, ...wanted], {
    legitimateDuplicates: state.ledger.legitimateDuplicates,
  });

  state.ledger = { ...state.ledger, transactions: merged.kept };
  state.entries = merged.entries;
  showWhatNeedsDeciding();
  state.reports.push({
    name: report.file,
    importer: report.importer,
    account: "",
    count: incoming.length,
    problems: report.problems,
  });

  state.persistent = await save(state.ledger);
  // Bank data is where a person with no other system starts, so this is the
  // moment their books first have accounts in them. Waiting until the next
  // reload to give them the one entity those accounts belong to made the
  // first minutes of a new ledger look emptier than it was.
  await ensureDefaultEntity();
  render();
}

/** Mark a transaction's key as a genuine repeat and re-run classification. */
async function allow(transaction: Transaction): Promise<void> {
  const key = dedupeKey(transaction);
  if (!state.ledger.legitimateDuplicates.includes(key)) {
    state.ledger = {
      ...state.ledger,
      legitimateDuplicates: [...state.ledger.legitimateDuplicates, key],
    };
  }
  reclassify();
  state.persistent = await save(state.ledger);
  render();
}

async function remove(transaction: Transaction): Promise<void> {
  // Remembered, not just removed. The feed still holds it, and without a note
  // that it was judged it arrives again on the next fetch and is asked about
  // all over again -- a decision that has to be made every morning is not a
  // decision, it is a chore.
  const removed = state.ledger.removedDuplicates ?? [];
  state.ledger = {
    ...state.ledger,
    transactions: state.ledger.transactions.filter((t) => t !== transaction),
    removedDuplicates: removed.includes(transaction.id) ? removed : [...removed, transaction.id],
  };
  reclassify();
  state.persistent = await save(state.ledger);
  render();
}

export function renderFormats(): void {
  $("formats").innerHTML = importers
    .map(
      (importer) =>
        `<li><strong>${escapeHtml(importer.label)}</strong><span>${escapeHtml(
          importer.description,
        )}</span></li>`,
    )
    .join("");
}

/**
 * Which of their accounts is which of ours, and pulling what they hold.
 *
 * Nothing is imported until each account it would touch has been pointed at an
 * account in these books. A feed can carry accounts a set of books has never
 * heard of -- a personal card alongside the company's -- and filing those under
 * whatever Akahu calls them would put private spending into the company ledger.
 */
function accountMappingSection(mapping: Record<string, string>): HTMLElement {
  const wrap = document.createElement("div");
  wrap.className = "feed-accounts";

  const load = document.createElement("button");
  load.type = "button";
  load.textContent = "Show the connected accounts";

  const table = document.createElement("div");
  const said = document.createElement("p");
  said.className = "feed-said";

  const chosen: Record<string, string> = { ...mapping };

  load.addEventListener("click", () => {
    load.disabled = true;
    said.textContent = "Asking Akahu…";
    void fetch("/api/feed/accounts")
      .then(async (r) => {
        const answer = (await r.json()) as { accounts?: AkahuAccount[]; error?: string };
        if (!r.ok) throw new Error(answer.error ?? "could not list the accounts");
        said.textContent = "";
        draw(answer.accounts ?? []);
      })
      .catch((error: Error) => {
        said.textContent = error.message;
      })
      .finally(() => {
        load.disabled = false;
      });
  });

  const ours = (): string[] => [...new Set(state.ledger.transactions.map((t) => t.account))].sort();

  function draw(accounts: readonly AkahuAccount[]): void {
    table.textContent = "";
    if (accounts.length === 0) {
      table.append(note("Akahu has no accounts connected yet. Connect your bank at my.akahu.nz."));
      return;
    }

    const grid = document.createElement("table");
    grid.className = "report-table owner-table";
    const head = document.createElement("thead");
    head.innerHTML = "<tr><th>At the bank</th><th>Number</th><th>Balance</th><th>In these books</th></tr>";
    const rows = document.createElement("tbody");

    for (const account of accounts) {
      const tr = document.createElement("tr");
      tr.append(nameCell(`${account.name}${account.connection?.name ? ` · ${account.connection.name}` : ""}`));
      tr.append(nameCell(account.formatted_account ?? "—"));
      const balance = document.createElement("td");
      balance.className = "report-amount";
      balance.textContent =
        account.balance?.current === undefined ? "—" : formatAmount(Math.round(account.balance.current * 100));
      tr.append(balance);

      const pick = document.createElement("td");
      const select = document.createElement("select");
      const none = document.createElement("option");
      none.value = "";
      none.textContent = "-- do not import --";
      select.append(none);

      // The account this already is, when these books have it. The two systems
      // write the same account differently -- a suffix as two digits in one and
      // three in the other, a card as a masked number -- so a plain comparison
      // finds nothing and would offer to create a second account beside a
      // reconciled one. Only when unambiguous; otherwise it asks.
      const suggestion = matchLedgerAccount(account, ours()) ?? akahuAccountId(account);
      for (const id of [...new Set([...ours(), suggestion])].sort()) {
        const option = document.createElement("option");
        option.value = id;
        option.textContent = id;
        option.selected = (chosen[account._id] ?? suggestion) === id;
        select.append(option);
      }
      select.addEventListener("change", () => {
        chosen[account._id] = select.value;
      });
      if (chosen[account._id] === undefined) chosen[account._id] = suggestion;
      pick.append(select);
      tr.append(pick);
      rows.append(tr);
    }
    grid.append(head, rows);
    table.append(grid);

    const from = document.createElement("input");
    from.type = "date";

    // A week before the last transaction already held, not the day after it.
    //
    // A feed reports settled transactions, and a card charge settles days
    // after the date it carries. Starting where the ledger ends would step
    // over anything that settled in between and leave a hole nothing later
    // fills. Overlapping costs nothing: what is already held is recognised as
    // a duplicate and dropped, which is the whole point of doing it that way.
    // Empty means from the beginning, which is what an account with nothing in
    // the books needs and what the picker should therefore offer.
    from.value = feedStartDate(chosen) ?? "";
    const fromLabel = document.createElement("label");
    fromLabel.append("From ", from);

    const fetchButton = document.createElement("button");
    fetchButton.type = "button";
    fetchButton.className = "primary";
    fetchButton.textContent = "Fetch transactions";
    fetchButton.addEventListener("click", () => {
      void pullFromFeed(chosen, from.value, fetchButton, said);
    });

    const actions = document.createElement("div");
    actions.className = "feed-form";
    actions.append(fromLabel, fetchButton);
    table.append(actions);
  }

  wrap.append(load, said, table);
  return wrap;
}

/** Pull from the feed and hand it to the same import everything else uses. */
async function pullFromFeed(
  mapping: Record<string, string>,
  from: string,
  button: HTMLButtonElement,
  said: HTMLElement,
): Promise<void> {
  // The button itself says so, not only the line of text beside it.
  //
  // A fetch reaches a bank and can take a while, and the only sign it had
  // started was a sentence somewhere else on the page. Pressing a button that
  // does not change is how somebody comes to press it three times.
  const label = button.textContent ?? "Fetch transactions";
  button.disabled = true;
  button.textContent = "Fetching…";
  button.classList.add("working");
  button.setAttribute("aria-busy", "true");
  said.textContent = "Fetching…";
  try {
    await fetch("/api/feed/accounts", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ accounts: mapping }),
    });

    const search = from === "" ? "" : `?start=${encodeURIComponent(`${from}T00:00:00.000Z`)}`;
    const answer = (await fetch(`/api/feed/transactions${search}`).then((r) => r.json())) as {
      items?: AkahuTransaction[];
      error?: string;
    };
    if (answer.error !== undefined) throw new Error(answer.error);

    const read = fromAkahu(answer.items ?? [], {
      accountFor: (id) => {
        const to = mapping[id];
        return to === undefined || to === "" ? null : to;
      },
    });

    if (read.transactions.length === 0) {
      said.textContent =
        read.unmappedAccounts.length > 0
          ? "Nothing to import: every account it returned is set to be left alone."
          : "Nothing new in that period.";
      return;
    }

    await addTransactions(read.transactions, {
      importer: "akahu",
      file: `bank feed, from ${from || "the beginning"}`,
      problems: read.problems,
    });
    said.textContent =
      `${read.transactions.length} read from the feed. They are on the Bank import page ` +
      "with anything that needs a decision.";
  } catch (error) {
    said.textContent = (error as Error).message;
  } finally {
    button.disabled = false;
    button.textContent = label;
    button.classList.remove("working");
    button.removeAttribute("aria-busy");
  }
}

/**
 * Connecting a bank feed, and pulling from it.
 *
 * The tokens are typed here and then never seen again: they are held by the
 * process serving this page, not by the page, so nothing can read one back out
 * of the screen or out of browser storage. What comes back is a list of
 * accounts, a mapping to the accounts already in these books, and transactions
 * that go through exactly the same import as a downloaded file -- the same
 * duplicate check, the same review, the same coding.
 */
export async function renderFeed(): Promise<void> {
  const body = $("feed-body");
  body.textContent = "";

  if (!writesToFolder()) {
    body.append(
      note(
        "A bank feed needs the app running with a folder behind it, because the " +
          "connection is held there rather than in this browser. Start it from the " +
          "NZOSA shortcut rather than opening the page on its own.",
      ),
    );
    return;
  }

  const status = (await fetch("/api/feed").then((r) => r.json()).catch(() => null)) as
    | {
        configured: boolean;
        appToken: string;
        accounts: Record<string, string>;
        autoFetch: boolean;
        lastFetch: string;
        balances: { at: string; balances: Record<string, number> }[];
      }
    | null;

  if (status === null) {
    body.append(note("Could not ask the app about the bank feed."));
    return;
  }

  // --- how to get the tokens ------------------------------------------------
  const how = document.createElement("details");
  how.open = !status.configured;
  const summary = document.createElement("summary");
  summary.textContent = "How to connect your bank";
  how.append(summary);
  const steps = document.createElement("ol");
  steps.className = "feed-steps";
  for (const step of [
    "Create an account at my.akahu.nz and set up two-factor authentication.",
    "Connect your bank there. Nothing appears here until at least one account is connected, " +
      "and the User Access Token does not exist until then.",
    "Open my.akahu.nz/developers, accept the developer terms, and copy the two tokens.",
    "Paste them below. They are kept by this app on this machine, not in the browser.",
  ]) {
    const li = document.createElement("li");
    li.textContent = step;
    steps.append(li);
  }
  how.append(steps);
  body.append(how);

  // --- the tokens -----------------------------------------------------------
  const form = document.createElement("div");
  form.className = "feed-form";

  const appToken = document.createElement("input");
  appToken.type = "text";
  appToken.placeholder = "App ID Token — app_token_…";
  appToken.autocomplete = "off";

  const userToken = document.createElement("input");
  // Masked: this is the half that reaches somebody's bank data.
  userToken.type = "password";
  userToken.placeholder = "User Access Token — user_token_…";
  userToken.autocomplete = "off";

  const save = document.createElement("button");
  save.type = "button";
  save.className = "primary";
  save.textContent = status.configured ? "Replace the connection" : "Connect";

  const said = document.createElement("p");
  said.className = "feed-said";

  save.addEventListener("click", () => {
    save.disabled = true;
    said.textContent = "Connecting…";
    void fetch("/api/feed", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ appToken: appToken.value, userToken: userToken.value }),
    })
      .then(async (r) => {
        const answer = (await r.json()) as { error?: string };
        if (!r.ok) throw new Error(answer.error ?? "could not save the connection");
        appToken.value = "";
        userToken.value = "";
        void renderFeed();
      })
      .catch((error: Error) => {
        said.textContent = error.message;
        save.disabled = false;
      });
  });

  form.append(appToken, userToken, save);
  body.append(form, said);

  if (!status.configured) return;

  const connected = document.createElement("p");
  connected.className = "feed-connected";
  connected.textContent = `Connected as ${status.appToken}`;
  const forget = document.createElement("button");
  forget.type = "button";
  forget.className = "link-button";
  forget.textContent = "forget this connection";
  forget.addEventListener("click", () => {
    if (!confirm("Forget the bank feed connection? The tokens are deleted from this machine.")) return;
    void fetch("/api/feed", { method: "DELETE" }).then(() => renderFeed());
  });
  connected.append(" · ", forget);
  body.append(connected);

  // Whatever went wrong last time it looked, said here rather than on whatever
  // page happened to be open when it happened.
  if (state.feedProblem !== "") {
    const failed = document.createElement("p");
    failed.className = "variance-problems";
    failed.textContent = `Last time it looked: ${state.feedProblem}`;
    body.append(failed);
  }

  const auto = document.createElement("label");
  auto.className = "feed-auto";
  const box = document.createElement("input");
  box.type = "checkbox";
  box.checked = status.autoFetch;
  box.addEventListener("change", () => {
    void fetch("/api/feed/settings", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ autoFetch: box.checked }),
    });
  });
  auto.append(box, " Fetch new transactions when NZOSA opens");
  body.append(auto);

  body.append(balanceMovementSection(status.balances ?? [], status.accounts ?? {}));

  if (status.lastFetch !== "") {
    const when = document.createElement("p");
    when.className = "feed-said";
    // Said plainly, because a feed that has stopped working looks exactly like
    // a feed with nothing new until you know when it last managed to look.
    when.textContent = `Last looked ${new Date(status.lastFetch).toLocaleString("en-NZ")}.`;
    body.append(when);
  }

  body.append(accountMappingSection(status.accounts));
}

/**
 * Point the Import page at whatever is waiting to be decided.
 *
 * Everything on that page except the review queue is a record of what arrived.
 * The queue is the only part somebody has to act on, and it opened on "All" --
 * a list of five thousand rows with thirty-two that mattered somewhere in it.
 */
export function showWhatNeedsDeciding(): void {
  state.filter = "review";
}

/**
 * Write the chart out, carrying the entity and GST columns.
 *
 * The chart is the natural home for both. An account's entity and its GST
 * treatment are facts about the account, and keeping them in one file means
 * they can be backed up, diffed and edited in a spreadsheet -- rather than
 * living only in one browser profile, which is where they were.
 */
export function saveChart(): void {
  const model = state.ledger.entities ?? emptyEntityModel();
  const rows = accountsForEditing();
  if (rows.length === 0) {
    alert("There are no accounts to save yet. Load a chart of accounts first.");
    return;
  }

  const named = new Map(model.entities.map((e) => [e.id, e.name]));
  const file = state.rules as RuleFileShape | undefined;
  const treatments = file?.codeTreatments ?? {};

  // Bank accounts are written as their own rows, because which entities an
  // account pays for is exactly the kind of setup that should survive a
  // browser being cleared. They carry the ledger's own account id as the name,
  // which is what the mapping is keyed on.
  const bankRows: Account[] = [];
  for (const id of [...new Set(state.ledger.transactions.map((t) => t.account))].sort()) {
    const ids = model.banks[id] ?? [];
    const label = state.ledger.transactions.find((t) => t.account === id)?.extras?.[
      "accountLabel"
    ];
    bankRows.push({
      code: "",
      name: id,
      type: "Bank",
      taxCode: "",
      description: typeof label === "string" ? label : "",
      ...(ids.length > 0
        ? { entity: ids.map((e) => named.get(e) ?? e).join("; ") }
        : {}),
    });
  }

  const accounts: Account[] = rows.map(({ account, label }) => {
    const id = model.accounts[accountEntityKey(account)];
    const entity = model.entities.find((e) => e.id === id);
    const raw = treatments[label];
    return {
      ...account,
      ...(entity !== undefined ? { entity: entity.name } : {}),
      ...(raw !== undefined ? { gstTreatment: describeTreatment(raw) } : {}),
      ...(entity?.owners && entity.owners.length > 0
        ? { entityOwners: formatOwners(entity.owners) }
        : {}),
      ...(entity?.kind !== undefined ? { entityKind: entity.kind } : {}),
    };
  });

  download(
    formatChartOfAccounts([...accounts, ...bankRows]),
    "chart-of-accounts.csv",
    "text/csv",
  );
}

/** A stored treatment in the wording the chart file uses. */
function describeTreatment(raw: unknown): string {
  if (typeof raw === "string") return raw;
  const shape = raw as { treatment?: string; side?: string };
  if (shape.side === "imports") return "imports";
  return shape.treatment ?? "standard";
}

/**
 * Read a bank daily balance export and say whether the import ties to it.
 *
 * Held in memory rather than stored: it is a check, not a record. Loading a
 * newer export next month should ask the same question again of the data as it
 * stands, not accumulate answers.
 */
export async function checkBankBalances(file: File): Promise<void> {
  const body = $("balances-body");
  body.textContent = "";
  try {
    // Decoded the same way every other bank file is: a plain UTF-8 read
    // mangles anything the bank wrote in Windows-1252.
    const bytes = new Uint8Array(await file.arrayBuffer());
    let text = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
    if (text.includes("�")) text = new TextDecoder("windows-1252").decode(bytes);
    const parsed = parseDailyBalances(text);
    const checks = checkDailyBalances(parsed.sections, state.ledger.transactions);
    state.balanceChecks = checks;
    renderBalanceChecks(body, file.name, checks, parsed.problems);
    // The review list asks about duplicates the balances can now settle.
    redraw("importRows");
  } catch (error) {
    body.append(note(`Could not read ${file.name}: ${(error as Error).message}`));
  }
}

export function downloadReport(): void {
  const years = [
    ...new Set(state.ledger.transactions.map((t) => financialYearOf(t.date))),
  ].sort((a, b) => b - a);
  const year = Number($<HTMLSelectElement>("report-year").value) || years[0];

  if ($<HTMLSelectElement>("report-kind").value === "depreciation") {
    const assets = state.ledger.assets ?? [];
    if (assets.length === 0 || year === undefined) return;
    download(
      formatDepreciationSchedule(
        depreciationSchedule(assets, { from: `${year - 1}-04-01`, to: `${year}-03-31` }),
        `Depreciation schedule, FY${year}`,
      ),
      `depreciation-schedule-fy${year}.csv`,
      "text/csv",
    );
    return;
  }

  if ($<HTMLSelectElement>("report-kind").value === "owner") {
    const owner = $<HTMLSelectElement>("report-owner").value;
    if (owner === "" || year === undefined) return;
    download(
      formatOwnerSummary(ownerSummaryFor(owner, year), year),
      `rental-income-${owner.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-fy${year}.csv`,
      "text/csv",
    );
    return;
  }

  const built = currentReport();
  if (!built) return;

  // The exported file has to say what it is. It leaves this app and gets read
  // months later beside three others, and a figure whose basis is guessed at is
  // worse than no figure.
  const exportBasis = $<HTMLSelectElement>("report-basis").value;
  const exportNote =
    (exportBasis === "cash"
      ? "Cash basis, from bank data. No depreciation or year-end journals."
      : exportBasis === "posted"
        ? "Accrual basis, from our postings."
        : "Accrual basis, from the imported file.") +
    ($<HTMLSelectElement>("report-gst").value === "gross" && exportBasis !== "accrual"
      ? " GST inclusive."
      : " GST exclusive.");

  download(
    formatProfitAndLoss(
      built.report,
      `${built.title} — Profit and Loss, FY${built.year}`,
      exportNote,
    ),
    `profit-and-loss-${built.title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-fy${built.year}.csv`,
    "text/csv",
  );
}

export function render(): void {
  renderStatus();
  renderReports();
  redraw("importRows");
}

function renderStatus(): void {
  const counts = {
    total: state.entries.length,
    review: state.entries.filter((entry) => entry.status === "review").length,
    duplicate: state.entries.filter((entry) => entry.status === "duplicate").length,
  };

  $("stat-total").textContent = String(state.ledger.transactions.length);
  $("stat-review").textContent = String(counts.review);
  $("stat-accounts").textContent = String(
    new Set(state.ledger.transactions.map((t) => t.account)).size,
  );

  const range = dateRange(state.ledger.transactions);
  $("stat-range").textContent = range ? `${range.from} to ${range.to}` : "--";

  for (const filter of ["all", "review", "duplicate"] as const) {
    $(`filter-${filter}`).classList.toggle("active", state.filter === filter);
  }
  $("filter-review").textContent = `Needs review (${counts.review})`;
  $("filter-duplicate").textContent = `Duplicates (${counts.duplicate})`;

  const warning = $("storage-warning");
  warning.hidden = state.persistent;

  $("busy").hidden = !state.busy;
}

function renderReports(): void {
  const container = $("reports");
  if (state.reports.length === 0) {
    // No import this session, but a short export stays short: the warning
    // belongs to the data rather than to the moment it arrived.
    container.innerHTML = "";
    appendTruncationWarning(container);
    return;
  }

  container.innerHTML = state.reports
    .map((report) => {
      if (report.error) {
        return `<div class="report error">
          <strong>${escapeHtml(report.name)}</strong>
          <p>${escapeHtml(report.error)}</p>
        </div>`;
      }

      const problems =
        report.problems.length === 0
          ? ""
          : `<details><summary>${report.problems.length} row(s) skipped</summary><ul>${report.problems
              .map(
                (problem) =>
                  `<li><code>line ${problem.line}</code> ${escapeHtml(problem.message)}</li>`,
              )
              .join("")}</ul></details>`;

      return `<div class="report">
        <strong>${escapeHtml(report.name)}</strong>
        <p>${report.count} transactions &middot; ${escapeHtml(report.importer)} &middot; ${escapeHtml(
          report.account,
        )}</p>
        ${problems}
      </div>`;
    })
    .join("");

  appendTruncationWarning(container);
}

/** Say so when an account looks cut off at the bank's export limit. */
function appendTruncationWarning(container: HTMLElement): void {
  const cut = truncatedAccounts();
  if (cut.length > 0) {
    container.insertAdjacentHTML(
      "beforeend",
      `<div class="report cut-off"><strong>Some of this may be missing</strong>
        <p>${cut.map((a) => escapeHtml(a)).join(", ")} ${
          cut.length === 1 ? "holds" : "hold"
        } exactly 1,000 transactions, which is where BNZ stops an export without
        saying so. Export ${cut.length === 1 ? "that account" : "those accounts"} again in
        shorter date ranges and import each one: nothing is counted twice, and the daily
        balance check will confirm it.</p>
      </div>`,
    );
  }
}

/**
 * Accounts whose export looks cut off at the bank's row limit.
 *
 * BNZ stops a transaction export at a thousand rows without saying so. The
 * file looks complete, imports cleanly, and quietly begins part way through
 * the period -- which shows up much later as a balance that will not tie, and
 * is very hard to recognise from the far end. A count of exactly a thousand is
 * the tell, and it is worth saying out loud at the moment of import.
 */
function truncatedAccounts(): string[] {
  return accountsAtExportLimit(state.ledger.transactions);
}

export function renderTable(): void {
  const body = $("rows");

  let entries = state.entries;
  if (state.filter !== "all") {
    entries = entries.filter((entry) => entry.status === state.filter);
  }
  if (state.search !== "") {
    entries = entries.filter((entry) => matches(entry.transaction, state.search));
  }

  if (entries.length === 0) {
    body.innerHTML = `<tr><td colspan="7" class="empty">${
      state.ledger.transactions.length === 0
        ? "No transactions yet. Drop a bank export above to get started."
        : "Nothing matches this filter."
    }</td></tr>`;
    return;
  }

  // Newest first, which is what someone reconciling a month actually wants.
  const sorted = [...entries].sort((a, b) =>
    b.transaction.date.localeCompare(a.transaction.date),
  );

  const limit = 500;
  const shown = sorted.slice(0, limit);

  // What the bank's own balance says about each row we are asking about. Only
  // the questionable ones are judged: this answers a question already on the
  // screen rather than going looking for new ones.
  const verdicts = new Map<string, DuplicateJudgement>();
  if (state.balanceChecks.length > 0) {
    const asking = shown.filter((e) => e.status === "review").map((e) => e.transaction);
    for (const judgement of judgeDuplicates(asking, state.balanceChecks)) {
      verdicts.set(judgement.transactionId, judgement);
    }
  }

  body.innerHTML = shown
    .map((entry, index) => {
      const t = entry.transaction;
      const negative = t.amount < 0;
      const foreign = t.foreign
        ? `<span class="foreign">${escapeHtml(t.foreign.currency)} ${formatAmount(
            t.foreign.amount,
            t.foreign.currency,
          )}</span>`
        : "";

      return `<tr class="status-${entry.status}">
        <td class="date">${t.date}</td>
        <td class="amount ${negative ? "out" : "in"}">${formatAmount(
          t.amount,
          t.currency,
        )}<span class="ccy">${escapeHtml(t.currency)}</span>${foreign}</td>
        <td class="party">${escapeHtml(t.otherParty || "--")}</td>
        <td class="detail">${escapeHtml(
          [t.particulars, t.code, t.reference].filter(Boolean).join(" / ") || "--",
        )}</td>
        <td class="account">${escapeHtml(t.account)}</td>
        <td class="source" title="${escapeHtml(t.source.file)}">${escapeHtml(
          t.source.file,
        )}:${t.source.line}</td>
        <td class="status">
          <span class="chip ${entry.status}">${entry.status}</span>
          ${
            entry.reason
              ? `<p class="reason">${escapeHtml(entry.reason)}</p>`
              : ""
          }
          ${(() => {
            if (entry.status !== "review") return "";
            const judgement = verdicts.get(t.id);
            const said = judgement
              ? `<p class="verdict verdict-${judgement.verdict.replace(/ /g, "-")}">` +
                `${escapeHtml(judgement.reason)}</p>`
              : "";
            // The likelier answer goes first and is the emphasised one, so the
            // button a person reaches for is the one the bank supports.
            const removeFirst = judgement?.verdict === "double counted";
            const keep = `<button data-action="keep" data-index="${index}"${
              removeFirst ? "" : ' class="primary"'
            }>Keep both</button>`;
            const remove = `<button data-action="remove" data-index="${index}"${
              removeFirst ? ' class="primary"' : ""
            }>Remove this one</button>`;
            return `${said}<div class="actions">${
              removeFirst ? remove + keep : keep + remove
            }</div>`;
          })()}
        </td>
      </tr>`;
    })
    .join("");

  if (sorted.length > limit) {
    body.insertAdjacentHTML(
      "beforeend",
      `<tr><td colspan="7" class="empty">Showing the first ${limit} of ${sorted.length}. Use search to narrow it down.</td></tr>`,
    );
  }

  for (const button of body.querySelectorAll<HTMLButtonElement>("button[data-action]")) {
    button.addEventListener("click", () => {
      const entry = shown[Number(button.dataset.index)];
      if (!entry) return;
      if (button.dataset.action === "keep") void allow(entry.transaction);
      else void remove(entry.transaction);
    });
  }
}

function matches(transaction: Transaction, needle: string): boolean {
  return [
    transaction.otherParty,
    transaction.particulars,
    transaction.code,
    transaction.reference,
    transaction.account,
    transaction.date,
    formatAmount(transaction.amount, transaction.currency),
  ]
    .join(" ")
    .toLowerCase()
    .includes(needle);
}

function dateRange(transactions: readonly Transaction[]): { from: string; to: string } | null {
  if (transactions.length === 0) return null;
  let from = transactions[0]!.date;
  let to = from;
  for (const transaction of transactions) {
    if (transaction.date < from) from = transaction.date;
    if (transaction.date > to) to = transaction.date;
  }
  return { from, to };
}
