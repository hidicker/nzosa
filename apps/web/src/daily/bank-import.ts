import { clearInbox, inboxIsFresh } from "../nightly.js";
import { morningChoice } from "../nightly-ui.js";
import type { Morning } from "../nightly.js";
import { PreviousSystem, previousSystem } from "../modules.js";
import { redraw, showPage } from "../app.js";
import { accountsForEditing, bankLabel, ensureDefaultEntity, reclassify, } from "../books.js";
import { balanceMovementSection, openingBalancesFromFeed, renderBalanceChecks } from "../daily/opening-balances.js";
import type { RuleFileShape } from "../rules-ui.js";
import { $, state } from "../state.js";
import { save } from "../store.js";
import { placeBankImport } from "../menu.js";
import { renderLockedArrivals } from "./lock-dates.js";
import { amountCell, dollars, download, escapeHtml, nameCell, note } from "../ui.js";
import {
  feedAccounts,
  feedAutoFetch,
  feedConnect,
  feedDisconnect,
  feedIsHosted,
  feedMapping,
  feedPossible,
  feedStatus,
  feedTransactions,
} from "../feed-route.js";
import type { FeedPendingItem } from "../feed-route.js";
import {
  accountEntityKey,
  accountsAtExportLimit,
  akahuAccountId,
  akahuLabels,
  checkDailyBalances,
  dedupe,
  dedupeKey,
  emptyEntityModel,
  feedResumeDate,
  formatAmount,
  formatChartOfAccounts,
  formatOwners,
  fromAkahu,
  lockedThrough,
  heldByLock,
  feedRequestFrom,
  onOrAfter,
  hash,
  importFile,
  importers,
  judgeDuplicates,
  matchLedgerAccount,
  parseAmount,
  parseDailyBalances,
} from "@nzosa/core";
import type {
  Account,
  BalanceCheck,
  BalanceSection,
  IsoDate,
  AkahuAccount,
  DuplicateJudgement,
  ImportProblem,
  Transaction,
} from "@nzosa/core";
import { loadCheckFiles } from "../migrate/coding-reconciliation.js";
import { chosenStartDate } from "../migrate/onboarding-state.js";
import { renderWise } from "./wise-feed.js";
import { autoLinkBankRows } from "./entities.js";
import { booksCurrency, booksLocale, moneyPlaces } from "../country.js";

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

/** The day these books start, where it is known: nothing from the feed before it is kept. */
function booksStartForFeed(): IsoDate | undefined {
  return (chosenStartDate() ?? state.ledger.openingBalances?.asAt) as IsoDate | undefined;
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
/**
 * The feed's items as these books' lines: only the accounts linked to one of
 * them, named the way the bank names them.
 */
export function feedLines(
  items: Parameters<typeof fromAkahu>[0],
  links: Record<string, string>,
  labels: Record<string, string> = {},
): ReturnType<typeof fromAkahu> {
  return fromAkahu(items, {
    accountFor: (id) => {
      const to = links[id];
      return to === undefined || to === "" ? null : to;
    },
    labelFor: (id) => labels[id],
  });
}

/** The feed's new lines that belong in these books: from the day they start. */
export function feedLinesForBooks(
  items: Parameters<typeof fromAkahu>[0],
  links: Record<string, string>,
  labels: Record<string, string> = {},
): ReturnType<typeof fromAkahu> {
  const fetched = feedLines(items, links, labels);
  return { ...fetched, transactions: onOrAfter(fetched.transactions, booksStartForFeed()) };
}

export async function autoFetchFromFeed(morning?: Morning): Promise<void> {
  if (!feedPossible()) return;

  try {
    const status = await feedStatus();
    // The menu follows the feed: connected, Bank import is set-up work.
    placeBankImport(status?.configured === true);
    if (status === null || !status.configured || !status.autoFetch) return;

    const mapping = status.accounts ?? {};
    const mapped = Object.values(mapping).filter((to) => to !== "");
    if (mapped.length === 0) return;

    // What the morning run fetched, waiting in its inbox. Fresh, it stands in
    // for asking the bank again -- which is what makes opening quick; older,
    // the bank is asked as well. Either way once per item, by the bank's own
    // id: the same item twice would read as a genuine repeat payment.
    const waiting = (morning?.inbox?.items ?? []) as Parameters<typeof fromAkahu>[0];
    const asked =
      morning !== undefined && inboxIsFresh(morning)
        ? []
        : await feedTransactions((() => {
            const start = feedStartDate(mapping);
            return start === undefined ? "" : feedRequestFrom(start);
          })());
    const items = [...new Map([...waiting, ...asked].map((item) => [item._id, item])).values()];
    const fromInbox = waiting.length > 0;

    // The links as they are now, not as they were when the fetch set out. A
    // bank can take a while to answer, and an account set to "do not import"
    // -- its lines removed -- in the meantime had every one of them put back
    // by the fetch that was already under way.
    const now = (await feedStatus())?.accounts ?? mapping;
    // The bank's names, only while an account in these books has none: one
    // more question to the bank, asked once rather than on every opening.
    const unnamed = Object.values(now).some((to) => to !== "" && bankLabel(to) === to);
    const labels = unnamed ? akahuLabels(await feedAccounts().catch(() => [])) : {};
    const fetched = feedLines(items, now, labels);
    // Asked for from a week early; nothing from before the books start goes
    // into them -- but what is dated in the week before is held for a decision.
    await holdJustBefore(fetched.transactions);
    const read = { ...fetched, transactions: onOrAfter(fetched.transactions, booksStartForFeed()) };
    const named = nameHeldAccounts(labels, now);
    if (read.transactions.length === 0) {
      if (named) state.persistent = await save(state.ledger);
      if (fromInbox) await clearInbox();
      return;
    }

    const before = state.ledger.transactions.length;
    await addTransactions(read.transactions, {
      importer: "akahu",
      file: fromInbox ? "bank feed, fetched this morning" : "bank feed, on opening",
      problems: read.problems,
    });
    if (fromInbox) await clearInbox();
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
  // One currency is kept (NZD), so there is nothing to choose.
  const currency = booksCurrency();
  const dayFirst = $<HTMLInputElement>("day-first").checked;

  const incoming: Transaction[] = [];
  // Lines from before the books start belong to the previous system's year:
  // left out, and said, rather than added to a year these books do not keep.
  const booksStart = booksStartForFeed();

  for (const file of files) {
    if (file.size > 50 * 1024 * 1024) {
      alert(`"${file.name}" is over 50 MB and was skipped. Bank exports are normally much smaller.`);
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

      const kept = onOrAfter(result.transactions, booksStart);
      const earlier = result.transactions.length - kept.length;
      incoming.push(...kept);
      state.reports.push({
        name: file.name,
        importer: result.importer,
        account: result.account,
        count: kept.length,
        problems: result.problems,
        ...(earlier > 0 && booksStart !== undefined ? { before: { count: earlier, start: booksStart } } : {}),
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
  const merged = holdLocked(
    dedupe(
      [...state.ledger.transactions, ...incoming.filter((t) => !discarded.has(t.id))],
      { legitimateDuplicates: state.ledger.legitimateDuplicates },
    ),
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
/**
 * Give the lines already held the bank's name for their account, where they
 * have none.
 *
 * A name arrives with each new line, so an account with nothing new would
 * have stayed a bare number for good. Only the label is written: nothing an
 * id is made from, and nothing that posts.
 */
function nameHeldAccounts(labels: Record<string, string>, mapping: Record<string, string>): boolean {
  const names = new Map<string, string>();
  for (const [feedId, to] of Object.entries(mapping)) {
    const label = labels[feedId];
    if (to !== "" && label !== undefined) names.set(to, label);
  }
  if (names.size === 0) return false;
  let changed = false;
  const transactions = state.ledger.transactions.map((t) => {
    const label = names.get(t.account);
    if (label === undefined || t.extras?.["accountLabel"] !== undefined) return t;
    changed = true;
    return { ...t, extras: { ...(t.extras ?? {}), accountLabel: label } };
  });
  if (changed) state.ledger = { ...state.ledger, transactions };
  return changed;
}

export async function addTransactions(
  incoming: Transaction[],
  report: { importer: string; file: string; problems: ImportProblem[] },
  /**
   * Take these lines off the removed list and bring them in. Only on being
   * asked: a line somebody removed stays removed until they say otherwise.
   */
  options: { restoreRemoved?: boolean } = {},
): Promise<{ skippedAsRemoved: number }> {
  const { skippedAsRemoved } = mergeIncoming(incoming, options);
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
  // A chart loaded before the bank lines had rows naming these accounts that
  // could not be linked until they existed.
  await autoLinkBankRows();
  render();
  return { skippedAsRemoved };
}

/**
 * The merge an import does, in memory only: ids from each line's content, the
 * lines somebody removed kept out, duplicates found, and lines dated inside a
 * lock held aside. Nothing is saved -- which is what lets the morning run see
 * the books as they would be with the bank's new lines in, without putting
 * them there.
 */
export function mergeIncoming(
  incoming: Transaction[],
  options: { restoreRemoved?: boolean } = {},
): { skippedAsRemoved: number } {
  const counts = new Map<string, number>();
  for (const transaction of incoming) {
    const key = dedupeKey(transaction);
    const next = (counts.get(key) ?? 0) + 1;
    counts.set(key, next);
    transaction.occurrence = next;
  }
  for (const transaction of incoming) transaction.id = hash(dedupeKey(transaction));

  // Anything already judged a duplicate and thrown away does not come back --
  // and is counted, so an import that brings nothing can say why.
  const removed = new Set(state.ledger.removedDuplicates ?? []);
  if (options.restoreRemoved === true) {
    const back = new Set(incoming.map((transaction) => transaction.id));
    if ([...back].some((id) => removed.has(id))) {
      for (const id of back) removed.delete(id);
      state.ledger = { ...state.ledger, removedDuplicates: [...removed] };
    }
  }
  const wanted = incoming.filter((transaction) => !removed.has(transaction.id));
  const skippedAsRemoved = incoming.length - wanted.length;

  const merged = holdLocked(
    dedupe([...state.ledger.transactions, ...wanted], {
      legitimateDuplicates: state.ledger.legitimateDuplicates,
    }),
  );

  state.ledger = { ...state.ledger, transactions: merged.kept };
  state.entries = merged.entries;
  return { skippedAsRemoved };
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
/**
 * The accounts Akahu last said are connected, for as long as the page is open.
 *
 * Asked for as soon as the section appears -- a connected feed with its
 * accounts hidden behind a button left people wondering whether it had
 * connected at all -- but only once, not on every redraw.
 */
let connectedAccounts: readonly AkahuAccount[] | null = null;

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
    void feedAccounts()
      .then((accounts) => {
        said.textContent = "";
        connectedAccounts = accounts;
        load.textContent = "Ask Akahu again";
        draw(accounts);
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

    // Only what these books already know is theirs starts ticked: an account
    // the books hold lines for, or one a chart bank row has been linked to.
    // Everything else starts left out. Both new-user walkthroughs brought in
    // accounts that were never theirs -- the business card into the household's
    // books, fourteen household accounts into the company's -- because every
    // account on the bank login started on "import".
    const linkedInChart = new Set(
      state.chart
        .map((a) => (a.ledgerAccount ?? "").trim())
        .filter((id) => id !== "" && id.toLowerCase() !== "none"),
    );
    const startsIn = (account: AkahuAccount): string =>
      matchLedgerAccount(account, ours()) ??
      (linkedInChart.has(akahuAccountId(account)) ? akahuAccountId(account) : "");
    if (accounts.every((account) => (chosen[account._id] ?? startsIn(account)) === "")) {
      table.append(
        note(
          "Choose the accounts these books are for: set each one to the account it is in " +
            "these books. The rest stay out, and can be added later.",
        ),
      );
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
      none.textContent = "— do not import —";
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
        option.selected = (chosen[account._id] ?? startsIn(account)) === id;
        select.append(option);
      }
      select.addEventListener("change", () => {
        chosen[account._id] = select.value;
      });
      if (chosen[account._id] === undefined) chosen[account._id] = startsIn(account);
      none.selected = chosen[account._id] === "";
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
    // With nothing held yet, the day the books start: the guided start asks
    // for it, and opening balances are dated it. It was left empty -- the
    // bank's whole history -- right after somebody had said the books start
    // on 1 April. Empty only when nothing says when they start.
    from.value =
      feedStartDate(chosen) ?? chosenStartDate() ?? state.ledger.openingBalances?.asAt ?? "";
    const fromLabel = document.createElement("label");
    fromLabel.append("From ", from);

    const fetchButton = document.createElement("button");
    fetchButton.type = "button";
    fetchButton.className = "primary";
    fetchButton.textContent = "Fetch transactions";
    // Until the books have opening balances, the feed's are taken with the
    // fetch: the bank's own figure, worked back to the day the books start.
    const needsOpening = state.ledger.openingBalances === undefined && state.ledger.startedAtNothing !== true;
    const useBalances = document.createElement("input");
    useBalances.type = "checkbox";
    useBalances.checked = true;
    const useLabel = document.createElement("label");
    useLabel.append(useBalances, " Use the bank feed's balances as opening balances");

    fetchButton.addEventListener("click", () => {
      void pullFromFeed(chosen, from.value, fetchButton, said, akahuLabels(accounts), needsOpening && useBalances.checked);
    });

    const actions = document.createElement("div");
    actions.className = "feed-form";
    actions.append(fromLabel, ...(needsOpening ? [useLabel] : []), fetchButton);
    table.append(actions);
  }

  wrap.append(load, said, table);
  if (connectedAccounts !== null) {
    load.textContent = "Ask Akahu again";
    draw(connectedAccounts);
  } else {
    queueMicrotask(() => load.click());
  }
  return wrap;
}

/** Pull from the feed and hand it to the same import everything else uses. */
async function pullFromFeed(
  mapping: Record<string, string>,
  from: string,
  button: HTMLButtonElement,
  said: HTMLElement,
  /** The bank's names for its accounts, kept on the lines for reading by. */
  labels: Record<string, string> = {},
  /** Take the feed's balances as opening balances once the lines are in. */
  withOpening = false,
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
    await feedMapping(mapping);

    const items = await feedTransactions(from === "" ? "" : feedRequestFrom(from as IsoDate));

    const fetched = fromAkahu(items, {
      accountFor: (id) => {
        const to = mapping[id];
        return to === undefined || to === "" ? null : to;
      },
      labelFor: (id) => labels[id],
    });
    // Asked for from a week early, to catch lines stamped the evening before
    // in UTC; only those from the day chosen are kept, and those in the week
    // before the books start are held for a decision.
    await holdJustBefore(fetched.transactions);
    const read = { ...fetched, transactions: onOrAfter(fetched.transactions, from === "" ? undefined : (from as IsoDate)) };
    const named = nameHeldAccounts(labels, mapping);

    if (read.transactions.length === 0) {
      if (named) state.persistent = await save(state.ledger);
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
      `${read.transactions.length} read from the feed. Review them on the Bank import page.`;
    if (withOpening) {
      const opening = await openingBalancesFromFeed();
      if (opening !== "") said.textContent += ` ${opening}`;
    }
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
  // Wise sits beside the feed, drawn with it.
  void renderWise();

  if (!feedPossible()) {
    placeBankImport(false);
    body.append(
      note(
        "A bank feed needs the app running on your own computer, or books on the server. " +
          "Start NZOSA from its shortcut, or sign in.",
      ),
    );
    return;
  }

  const status = await feedStatus();
  placeBankImport(status?.configured === true);

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
    feedIsHosted()
      ? "Paste them below. They are your own tokens: they are stored encrypted on the " +
        "server, used only to fetch your transactions, deleted when you disconnect, and " +
        "you can revoke them at my.akahu.nz at any time."
      : "Paste them below. They are kept by this app on this machine, not in the browser.",
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
    void feedConnect(appToken.value, userToken.value)
      .then(() => {
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
    if (
      !confirm(
        feedIsHosted()
          ? "Forget the bank feed connection? The tokens are deleted from the server."
          : "Forget the bank feed connection? The tokens are deleted from this machine.",
      )
    ) {
      return;
    }
    void feedDisconnect().then(() => renderFeed());
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
    void feedAutoFetch(box.checked);
  });
  auto.append(box, " Fetch new transactions when NZOSA opens");
  body.append(auto, morningChoice());

  if (status.pending && status.pending.length > 0) {
    body.append(pendingTransactionsSection(status.pending, status.accounts ?? {}, status.balances ?? []));
  }

  body.append(balanceMovementSection(status.balances ?? [], status.accounts ?? {}));

  if (status.lastFetch !== "") {
    const when = document.createElement("p");
    when.className = "feed-said";
    // Said plainly, because a feed that has stopped working looks exactly like
    // a feed with nothing new until you know when it last managed to look.
    when.textContent = `Last looked ${new Date(status.lastFetch).toLocaleString(booksLocale())}.`;
    body.append(when);
  }

  body.append(accountMappingSection(status.accounts));
  body.append(justBeforeSection(status.accounts ?? {}));
}

/**
 * Card charges the bank has authorised but not yet settled, by account, and
 * the bank's balance with and without them. Shown, not judged: whether the
 * settled balance agrees with these books is for the checks below to say.
 */
export function pendingTransactionsSection(
  pending: readonly FeedPendingItem[],
  mapping: Record<string, string>,
  snapshots: readonly {
    at: string;
    balances: Record<string, number>;
    rawBalances?: Record<string, number>;
    pendingAmounts?: Record<string, number>;
  }[],
): HTMLElement {
  const wrap = document.createElement("div");
  wrap.className = "feed-accounts";
  if (pending.length === 0) return wrap;

  const heading = document.createElement("h4");
  heading.className = "feed-subheading";
  heading.textContent = `Pending card authorisations (${pending.length})`;
  wrap.append(heading);

  const byAccount = new Map<string, FeedPendingItem[]>();
  for (const item of pending) {
    const list = byAccount.get(item.account) ?? [];
    list.push(item);
    byAccount.set(item.account, list);
  }

  const latestSnap = snapshots[snapshots.length - 1];

  for (const [akahuId, items] of byAccount) {
    const ourAccount = mapping[akahuId] || akahuId;
    const totalPendingCents = items.reduce((sum, i) => sum + i.amount, 0);
    const rawBankCents = latestSnap?.rawBalances?.[akahuId];
    const adjustedCents = latestSnap?.balances?.[akahuId];

    const box = document.createElement("div");
    box.className = "notice-pending";

    const title = document.createElement("strong");
    title.textContent =
      `${bankLabel(ourAccount)}: ${items.length} pending, ${dollars(totalPendingCents)}`;
    box.append(title);

    const tbl = document.createElement("table");
    tbl.className = "report-table";
    tbl.innerHTML = '<thead><tr><th>Date</th><th>Description</th><th class="report-amount">Amount</th></tr></thead>';
    const tb = document.createElement("tbody");
    for (const it of items) {
      const tr = document.createElement("tr");
      tr.append(
        nameCell(it.date.slice(0, 10)),
        nameCell(it.description || "Card authorisation"),
        amountCell(dollars(it.amount)),
      );
      tb.append(tr);
    }
    tbl.append(tb);
    box.append(tbl);

    const foot = document.createElement("p");
    foot.className = "notice-foot";
    foot.textContent =
      rawBankCents !== undefined && adjustedCents !== undefined
        ? `The bank's current balance is ${dollars(rawBankCents)}. Without the ${dollars(totalPendingCents)} ` +
          `pending, the settled balance is ${dollars(adjustedCents)}, which is the figure used for the checks.`
        : "The bank's balance is taken without these until they settle.";
    box.append(foot);
    wrap.append(box);
  }

  return wrap;
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
    await keepDailyBalances(parsed.sections);
    const checks = balanceChecksNow();
    renderBalanceChecks(body, file.name, checks, parsed.problems);
    // The review list asks about duplicates the balances can now settle.
    redraw("importRows");
  } catch (error) {
    body.append(note(`Could not read ${file.name}: ${(error as Error).message}`));
  }
}

export function render(): void {
  renderStatus();
  renderLockedArrivals();
  renderReports();
  renderBalanceEntry();
  redraw("importRows");
  // The guided start shows this section inside one of its steps, and counts
  // what has arrived. Only when it is the page being looked at: redrawing it
  // moves this section back to its own page and then borrows it again.
  if (state.page === "migration") redraw("migration");
}

/** Statement balances being typed in, kept while the page redraws around them. */
let balanceDraft: { account: string; rows: { date: string; closing: string }[] } | null = null;

/**
 * Statement balances typed in, for anyone without a balances export.
 *
 * The same check the file gets. One balance only says where an account stood;
 * two, a start and an end, say whether anything between them is missing or
 * held twice, and more narrow down where.
 */
function renderBalanceEntry(): void {
  const box = $("balances-entry");
  box.textContent = "";
  const accounts = [...new Set(state.ledger.transactions.map((t) => t.account))].sort();
  if (accounts.length === 0) return;
  if (balanceDraft === null || !accounts.includes(balanceDraft.account)) {
    balanceDraft = { account: accounts[0] as string, rows: [{ date: "", closing: "" }, { date: "", closing: "" }] };
  }
  const draft = balanceDraft;
  const labelOf = (id: string): string => {
    const label = String(state.ledger.transactions.find((t) => t.account === id)?.extras?.["accountLabel"] ?? "");
    return label === "" || label === id ? id : `${id} ${label}`;
  };

  const details = document.createElement("details");
  const summary = document.createElement("summary");
  summary.textContent = "Enter statement balances by hand";
  details.append(summary);
  details.open = draft.rows.some((r) => r.date !== "" || r.closing !== "");

  const fields = document.createElement("div");
  fields.className = "agent-fields";
  const accountLabel = document.createElement("label");
  const select = document.createElement("select");
  for (const id of accounts) {
    const option = document.createElement("option");
    option.value = id;
    option.textContent = labelOf(id);
    option.selected = id === draft.account;
    select.append(option);
  }
  select.addEventListener("change", () => {
    draft.account = select.value;
  });
  accountLabel.append("Account", select);
  fields.append(accountLabel);
  details.append(fields);

  const rows = document.createElement("div");
  const draw = (): void => {
    rows.textContent = "";
    draft.rows.forEach((row, index) => {
      const line = document.createElement("div");
      line.className = "agent-row";
      const date = document.createElement("input");
      date.type = "date";
      date.value = row.date;
      date.addEventListener("input", () => {
        row.date = date.value;
      });
      const closing = document.createElement("input");
      closing.type = "text";
      closing.inputMode = "decimal";
      closing.className = "split-amount";
      closing.placeholder = "Closing balance";
      closing.value = row.closing;
      closing.addEventListener("input", () => {
        row.closing = closing.value;
      });
      const drop = document.createElement("button");
      drop.type = "button";
      drop.textContent = "✕";
      drop.title = "Remove this balance";
      drop.addEventListener("click", () => {
        draft.rows.splice(index, 1);
        draw();
      });
      line.append(date, closing, drop);
      rows.append(line);
    });
  };
  draw();
  details.append(rows);

  const actions = document.createElement("div");
  actions.className = "page-actions";
  const add = document.createElement("button");
  add.type = "button";
  add.textContent = "Add a balance";
  add.addEventListener("click", () => {
    draft.rows.push({ date: "", closing: "" });
    draw();
  });
  const check = document.createElement("button");
  check.type = "button";
  check.className = "primary";
  check.textContent = "Check against the transactions";
  const said = document.createElement("p");
  said.className = "variance-note";
  check.addEventListener("click", () => {
    const days = [];
    for (const row of draft.rows) {
      if (row.date === "" && row.closing.trim() === "") continue;
      const closing = parseAmount(row.closing.trim());
      if (!/^\d{4}-\d{2}-\d{2}$/.test(row.date) || closing === null) {
        said.textContent = "Each balance needs a date and an amount.";
        return;
      }
      days.push({ date: row.date as IsoDate, closing });
    }
    if (days.length === 0) {
      said.textContent = "Enter at least one balance: the closing balance on a statement, and its date.";
      return;
    }
    said.textContent = "";
    days.sort((a, b) => a.date.localeCompare(b.date));
    const sections = [{ account: draft.account, label: labelOf(draft.account), days }];
    void keepDailyBalances(sections);
    const checks = balanceChecksNow();
    renderBalanceChecks($("balances-body"), "the balances entered", checks, []);
    redraw("importRows");
  });
  actions.append(add, check);
  details.append(actions, said);
  box.append(details);
}

/**
 * The counts, and which filter is lit.
 *
 * Exported because the guided start shows this section inside one of its
 * steps, and a review queue whose count says nothing has arrived is worse
 * than no count at all.
 */
export function renderStatus(): void {
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

      const before =
        report.before === undefined
          ? ""
          : `<p class="field-hint">${report.before.count} line${report.before.count === 1 ? "" : "s"} ` +
            `dated before ${escapeHtml(report.before.start)}, when these books start, left out.</p>`;
      return `<div class="report">
        <strong>${escapeHtml(report.name)}</strong>
        <p>${report.count} transactions &middot; ${escapeHtml(report.importer)} &middot; ${escapeHtml(
          report.account,
        )}</p>
        ${before}
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
  if (balanceChecksNow().length > 0) {
    const asking = shown.filter((e) => e.status === "review").map((e) => e.transaction);
    for (const judgement of judgeDuplicates(asking, balanceChecksNow())) {
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
      const index = Number(button.dataset.index);
      const entry = shown[index];
      if (!entry) return;
      // The row answered leaves the list and the page redraws. Hold the next
      // row where this one was, so the place being worked through stays put.
      const row = button.closest("tr");
      const top = row?.getBoundingClientRect().top ?? null;
      const done = button.dataset.action === "keep" ? allow(entry.transaction) : remove(entry.transaction);
      void Promise.resolve(done).then(() => keepPlace(body, index, top));
    });
  }
}

/** Scroll so the row now at `index` sits where the answered row was. */
function keepPlace(body: HTMLElement, index: number, top: number | null): void {
  if (top === null) return;
  requestAnimationFrame(() => {
    const rows = body.querySelectorAll("tr");
    const next = rows[Math.min(index, rows.length - 1)];
    if (next === undefined) return;
    const shift = next.getBoundingClientRect().top - top;
    let box: HTMLElement | null = body.parentElement;
    while (box !== null && !(box.scrollHeight > box.clientHeight && /auto|scroll/.test(getComputedStyle(box).overflowY))) {
      box = box.parentElement;
    }
    if (box !== null) box.scrollTop += shift;
    else window.scrollBy(0, shift);
  });
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

/** Dropping statements in, picking them, filtering what arrived, and the chart that maps them. */
export function wireBankImport(): void {

  const picker = $<HTMLInputElement>("file-input");
  const drop = $<HTMLElement>("dropzone");

  $("pick-button").addEventListener("click", () => picker.click());
  picker.addEventListener("change", () => {
    if (picker.files) void handleFiles([...picker.files]);
    picker.value = "";
  });

  for (const event of ["dragenter", "dragover"]) {
    drop.addEventListener(event, (e) => {
      e.preventDefault();
      drop.classList.add("dragging");
    });
  }
  for (const event of ["dragleave", "drop"]) {
    drop.addEventListener(event, (e) => {
      e.preventDefault();
      drop.classList.remove("dragging");
    });
  }
  drop.addEventListener("drop", (e) => {
    const files = (e as DragEvent).dataTransfer?.files;
    if (files) void handleFiles([...files]);
  });

  for (const filter of ["all", "review", "duplicate"] as const) {
    $(`filter-${filter}`).addEventListener("click", () => {
      state.filter = filter;
      render();
    });
  }

  $<HTMLInputElement>("search").addEventListener("input", (e) => {
    state.search = (e.target as HTMLInputElement).value.toLowerCase();
    redraw("importRows");
  });

  for (const link of document.querySelectorAll<HTMLAnchorElement>(".import-subnav-link, #sidebar-import-sublinks a")) {
    link.addEventListener("click", (e) => {
      const href = link.getAttribute("href");
      if (!href?.startsWith("#")) return;
      e.preventDefault();
      if (state.page !== "import") {
        showPage("import");
      }
      const target = document.getElementById(href.slice(1));
      if (target) {
        target.scrollIntoView({ behavior: "smooth", block: "start" });
        for (const other of document.querySelectorAll<HTMLAnchorElement>(".import-subnav-link")) {
          other.classList.toggle("active", other.getAttribute("href") === href);
        }
      }
    });
  }

  const importObserver = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting && state.page === "import") {
          const id = entry.target.id;
          for (const link of document.querySelectorAll<HTMLAnchorElement>(".import-subnav-link")) {
            link.classList.toggle("active", link.getAttribute("href") === `#${id}`);
          }
        }
      }
    },
    { rootMargin: "-10% 0px -70% 0px" },
  );
  for (const section of document.querySelectorAll(".import-subsection")) {
    importObserver.observe(section);
  }
  $("balances-pick").addEventListener("click", () => $("balances-input").click());
  $<HTMLInputElement>("balances-input").addEventListener("change", (event) => {
    const file = (event.target as HTMLInputElement).files?.[0];
    if (file) void checkBankBalances(file);
  });

  $("chart-pick").addEventListener("click", () => $<HTMLInputElement>("chart-input").click());
  $("chart-save").addEventListener("click", () => saveChart());
  $<HTMLInputElement>("chart-input").addEventListener("change", (e) => {
    const files = [...((e.target as HTMLInputElement).files ?? [])];
    if (files.length > 0) void loadCheckFiles(files);
    (e.target as HTMLInputElement).value = "";
  });
}

/**
 * The bank's daily balances, kept with the books, each account's latest
 * replacing what was there for it.
 *
 * The check itself was held in memory only, so Set-up forgot a file loaded
 * yesterday and asked for it again. The balances are what the bank said, a
 * record like any statement; the check is worked out from them each time.
 */
async function keepDailyBalances(sections: readonly BalanceSection[]): Promise<void> {
  const fresh = new Set(sections.map((s) => s.account));
  const dailyBalances = [...(state.ledger.dailyBalances ?? []).filter((s) => !fresh.has(s.account)), ...sections];
  state.ledger = { ...state.ledger, dailyBalances };
  state.persistent = await save(state.ledger);
}

let checksHeld: { ledger: unknown; checks: BalanceCheck[] } | null = null;

/** The daily balances checked against the books as they are now. */
export function balanceChecksNow(): BalanceCheck[] {
  if (checksHeld !== null && checksHeld.ledger === state.ledger) return checksHeld.checks;
  const kept = state.ledger.dailyBalances ?? [];
  const checks = kept.length === 0 ? [] : checkDailyBalances(kept, state.ledger.transactions);
  checksHeld = { ledger: state.ledger, checks };
  return checks;
}

/** A day plus or minus some days, as an ISO date. */
function shiftDay(day: string, days: number): IsoDate {
  return new Date(Date.parse(`${day}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10) as IsoDate;
}

/**
 * Keep the feed's lines dated in the week before the books start, to be
 * decided on, instead of dropping them with everything else before the start.
 *
 * The feed dates a card payment on the day it was made; the bank, and Xero,
 * on the day it cleared. One made on 30 March and cleared on 1 April is not in
 * the 31 March bank balance the books open with, so it belongs in these books
 * -- and dropped for its date, the account never agreed with the bank again.
 */
async function holdJustBefore(transactions: readonly Transaction[], days = 7): Promise<void> {
  const start = booksStartForFeed();
  if (start === undefined) return;
  const from = shiftDay(start, -days);
  const idOf = (t: Transaction): string => String(t.extras?.["akahuId"] ?? "");
  const known = new Set([
    ...(state.ledger.beforeStart ?? []).map(idOf),
    ...(state.ledger.beforeStartLeft ?? []),
    ...state.ledger.transactions.map(idOf),
  ]);
  const fresh = transactions.filter((t) => t.date < start && t.date >= from && idOf(t) !== "" && !known.has(idOf(t)));
  if (fresh.length === 0) return;
  state.ledger = { ...state.ledger, beforeStart: [...(state.ledger.beforeStart ?? []), ...fresh] };
  state.persistent = await save(state.ledger);
}

/**
 * How far before the start the feed has been searched, in days. A card
 * payment can clear long after it was made (a foreign subscription, a held
 * charge), so the week is only where the search starts.
 */
let lookedBack = 7;

/**
 * Search the feed further back, another 30 days each time, for a line the
 * bank cleared on or after the start but the feed dates earlier.
 */
function lookBackButton(start: IsoDate, mapping: Record<string, string>): HTMLElement {
  const wrap = document.createElement("div");
  const ask = document.createElement("p");
  ask.textContent = `Still can't see a transaction that should be coded on or after ${start}?`;
  const look = document.createElement("button");
  look.type = "button";
  look.textContent = "Look back another 30 days";
  const said = document.createElement("p");
  said.className = "feed-said";
  look.addEventListener("click", () => {
    look.disabled = true;
    said.textContent = "Asking the bank feed…";
    const days = lookedBack + 30;
    void (async () => {
      try {
        const before = (state.ledger.beforeStart ?? []).length;
        const items = await feedTransactions(feedRequestFrom(start, days));
        const fetched = fromAkahu(items, {
          accountFor: (id) => {
            const to = mapping[id];
            return to === undefined || to === "" ? null : to;
          },
        });
        await holdJustBefore(fetched.transactions, days);
        lookedBack = days;
        const found = (state.ledger.beforeStart ?? []).length - before;
        said.textContent =
          found === 0 ? `Nothing more in the ${days} days before ${start} that is not already decided.` : "";
        if (found > 0) void renderFeed();
      } catch (error) {
        said.textContent = (error as Error).message;
      } finally {
        look.disabled = false;
      }
    })();
  });
  wrap.append(ask, look, said);
  return wrap;
}

/** Where the imported Xero file has the same amount in the week from the start. */
function xeroHas(transaction: Transaction, start: string): string | undefined {
  const until = shiftDay(start, 7);
  return state.reference.find(
    (r) => r.amount === transaction.amount && r.date >= start && r.date <= until,
  )?.date;
}

/**
 * The feed's lines from the week before the books start, each to be brought
 * in -- dated the day the books start, the day it counts from -- or left out.
 */
function justBeforeSection(mapping: Record<string, string>): HTMLElement {
  const wrap = document.createElement("div");
  wrap.className = "feed-before";
  const start = booksStartForFeed();
  if (start === undefined) return wrap;
  const held = state.ledger.beforeStart ?? [];

  const heading = document.createElement("h4");
  heading.textContent = "Lines dated just before these books start";
  wrap.append(heading);
  wrap.append(
    note(
      `The feed dates a card payment on the day it was made. One made just before ${start} ` +
        "but cleared by the bank on or after it is not in the opening bank balance, so it " +
        `belongs in these books. Include it, dated ${start}, or leave it out.`,
    ),
  );

  if (held.length === 0) {
    const look = document.createElement("button");
    look.type = "button";
    look.textContent = "Look for lines just before the start";
    const said = document.createElement("p");
    said.className = "feed-said";
    look.addEventListener("click", () => {
      look.disabled = true;
      said.textContent = "Asking the bank feed…";
      void (async () => {
        try {
          const items = await feedTransactions(feedRequestFrom(start));
          const fetched = fromAkahu(items, {
            accountFor: (id) => {
              const to = mapping[id];
              return to === undefined || to === "" ? null : to;
            },
          });
          await holdJustBefore(fetched.transactions);
          const found = (state.ledger.beforeStart ?? []).length;
          said.textContent =
            found === 0 ? "Nothing dated in the week before the start that is not already decided." : "";
          if (found > 0) void renderFeed();
          else if (!wrap.contains(further)) wrap.append(further);
        } catch (error) {
          said.textContent = (error as Error).message;
        } finally {
          look.disabled = false;
        }
      })();
    });
    const further = lookBackButton(start, mapping);
    wrap.append(look, said);
    return wrap;
  }

  // With Xero's file loaded, it says which: a line Xero has on or after the
  // start cleared then. The rest of that week is almost always in the opening
  // balance already, and listing it beside them invited the wrong click.
  const flagged = justBeforeWaiting();
  const others = held.filter((line) => !flagged.includes(line));
  const table = justBeforeTable(flagged.length > 0 || state.reference.length > 0 ? flagged : held, start);
  if (table !== null) wrap.append(table);
  if (state.reference.length > 0 && others.length > 0) {
    const fold = document.createElement("details");
    const summary = document.createElement("summary");
    summary.textContent =
      `${others.length} more from that week that ${previousSystem()} does not have on or after ${start} ` +
      "— most likely in the opening balance already";
    fold.append(summary);
    const all = document.createElement("button");
    all.type = "button";
    all.textContent = `Leave ${others.length === 1 ? "it" : "these"} out`;
    all.addEventListener("click", () => void leaveAllOut(others));
    const inner = justBeforeTable(others, start);
    fold.append(all);
    if (inner !== null) fold.append(inner);
    wrap.append(fold);
  }
  wrap.append(lookBackButton(start, mapping));
  return wrap;
}

/**
 * The held lines that want a decision: those Xero has on or after the start,
 * where Xero's file is loaded, and otherwise all of them.
 */
export function justBeforeWaiting(): Transaction[] {
  const held = state.ledger.beforeStart ?? [];
  const start = booksStartForFeed();
  if (state.reference.length === 0 || start === undefined) return held;
  return held.filter((line) => xeroHas(line, start) !== undefined);
}

async function leaveAllOut(lines: readonly Transaction[]): Promise<void> {
  const ids = new Set(lines.map((t) => String(t.extras?.["akahuId"] ?? "")));
  state.ledger = {
    ...state.ledger,
    beforeStart: (state.ledger.beforeStart ?? []).filter((t) => !ids.has(String(t.extras?.["akahuId"] ?? ""))),
    beforeStartLeft: [...(state.ledger.beforeStartLeft ?? []), ...ids],
  };
  state.persistent = await save(state.ledger);
  redraw("actionsBadge");
  void renderFeed();
}

function justBeforeTable(lines: readonly Transaction[], start: string): HTMLElement | null {
  if (lines.length === 0) return null;
  const table = document.createElement("table");
  table.className = "report-table owner-table match-table";
  const head = document.createElement("thead");
  head.innerHTML = "<tr><th>Date</th><th>Account</th><th>Payee</th><th>Amount</th><th></th><th></th></tr>";
  const tbody = document.createElement("tbody");
  for (const line of lines) {
    const tr = document.createElement("tr");
    tr.append(
      nameCell(line.date),
      nameCell(bankLabel(line.account)),
      nameCell(line.otherParty || line.particulars || ""),
    );
    const amount = document.createElement("td");
    amount.className = "report-amount";
    amount.textContent = (line.amount / 100).toLocaleString(booksLocale(), {
      minimumFractionDigits: moneyPlaces(),
      maximumFractionDigits: moneyPlaces(),
    });
    tr.append(amount);
    const seen = xeroHas(line, start);
    tr.append(nameCell(seen === undefined ? "" : `${PreviousSystem()} has this on ${seen}`));
    const actions = document.createElement("td");
    actions.className = "report-amount";
    const include = document.createElement("button");
    include.type = "button";
    if (seen !== undefined) include.className = "primary";
    include.textContent = `Include, dated ${start}`;
    include.addEventListener("click", () => void decideJustBefore(line, true));
    const leave = document.createElement("button");
    leave.type = "button";
    leave.className = "link-button";
    leave.textContent = "leave out";
    leave.addEventListener("click", () => void decideJustBefore(line, false));
    actions.append(include, " ", leave);
    tr.append(actions);
    tbody.append(tr);
  }
  table.append(head, tbody);
  return table;
}

/** Bring one in, dated the day the books start, or leave it out for good. */
async function decideJustBefore(line: Transaction, include: boolean): Promise<void> {
  const start = booksStartForFeed();
  const id = String(line.extras?.["akahuId"] ?? "");
  const beforeStart = (state.ledger.beforeStart ?? []).filter((t) => String(t.extras?.["akahuId"] ?? "") !== id);
  state.ledger = { ...state.ledger, beforeStart };
  if (!include || start === undefined) {
    state.ledger = { ...state.ledger, beforeStartLeft: [...(state.ledger.beforeStartLeft ?? []), id] };
    state.persistent = await save(state.ledger);
  } else {
    // Dated the day it counts from; the bank's own date kept beside it.
    await addTransactions(
      [{ ...line, date: start, extras: { ...(line.extras ?? {}), bankDate: line.date } }],
      { importer: "akahu", file: "bank feed, cleared after the books start", problems: [] },
    );
  }
  redraw("actionsBadge");
  void renderFeed();
}

/**
 * Keep new lines dated in a locked period out of the books, held for a
 * decision.
 *
 * A feed line from last month arriving after that month's GST return was
 * filed would change the return. It is not dropped -- it is real money -- but
 * held on Bank import, to be brought in dated the first open day, or kept out,
 * or dealt with by moving the lock.
 */
function holdLocked<T extends { kept: Transaction[]; entries: { transaction: Transaction }[] }>(merged: T): T {
  const locks = state.ledger.lockDates;
  if (lockedThrough(locks) === undefined) return merged;
  const before = new Set(state.ledger.transactions.map((t) => t.id));
  const held = merged.kept.filter((t) => !before.has(t.id) && heldByLock(locks, state.ledger.entities, t));
  if (held.length === 0) return merged;
  const out = new Set(held.map((t) => t.id));
  const already = new Set((state.ledger.lockedArrivals ?? []).map((t) => t.id));
  state.ledger = {
    ...state.ledger,
    lockedArrivals: [...(state.ledger.lockedArrivals ?? []), ...held.filter((t) => !already.has(t.id))],
  };
  return {
    ...merged,
    kept: merged.kept.filter((t) => !out.has(t.id)),
    entries: merged.entries.filter((e) => !out.has(e.transaction.id)),
  };
}
