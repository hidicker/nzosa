import { redraw } from "../app.js";
import { reclassify, record } from "../books.js";
import { $, state } from "../state.js";
import { savePart } from "../store.js";
import { amountCell, nameCell, note } from "../ui.js";
import {
  depreciationSchedule,
  disposalOf,
  financialYearOf,
  formatAmount,
  parseAmount,
} from "@nzosa/core";
import type { Cents } from "@nzosa/core";
import { loadAssets } from "../migrate/file-intake.js";

/**
 * Fixed assets, their depreciation, and what happens when one is sold.
 *
 * An asset is not an expense. It is bought once and written down over years,
 * on rates Inland Revenue publishes, and the difference between expensing a
 * van and depreciating it is several thousand dollars of tax in the wrong
 * year.
 *
 * Selling one is the part that catches people: the difference between what is
 * received and what the asset is still carried at is a gain or a loss that has
 * to be posted, and it is not the same as the cash that arrived. The schedule
 * and the journals are computed in core; this is where they are shown and
 * where the proceeds are asked for.
 */

/**
 * The disposals, and the one figure that has to be supplied by hand.
 *
 * A fixed asset register carries the cost, the rate and the date something was
 * disposed of. It does not carry what it sold for, and without that a disposal
 * cannot be posted at all: the same asset scrapped for nothing and sold for
 * more than it cost differ by the whole of the profit.
 *
 * So this lists what left during a year, works out the book value it left at,
 * and takes the proceeds. It then shows the three figures that follow, because
 * they are the ones somebody would check against a set of accounts -- and
 * because seeing a capital gain appear tells you the sale beat the original
 * cost, which is worth noticing.
 */
function renderDisposals(body: HTMLElement): void {
  const assets = state.ledger.assets ?? [];
  const disposed = assets.filter((a) => a.disposed !== null);
  if (disposed.length === 0) return;

  const heading = document.createElement("h3");
  heading.textContent = `Disposals (${disposed.length})`;
  body.append(heading);

  const years = [...new Set(state.ledger.transactions.map((t) => financialYearOf(t.date)))];
  // Book value at disposal comes from the schedule for the year it went, since
  // that is where the convention lives: an asset disposed of during a year
  // takes no depreciation that year, and its book value goes to the disposal.
  const bookValues = new Map<string, Cents>();
  for (const year of years) {
    const schedule = depreciationSchedule(assets, {
      from: `${year - 1}-04-01`,
      to: `${year}-03-31`,
    });
    for (const row of schedule.rows) {
      if (row.disposedInPeriod) bookValues.set(row.asset.number, row.bookValueAtDisposal);
    }
  }

  const proceeds = state.ledger.assetProceeds ?? {};
  const missing = disposed.filter((a) => proceeds[a.number] === undefined).length;
  if (missing > 0) {
    body.append(
      note(
        `${missing} of these have no sale proceeds recorded, so nothing is posted for them: ` +
          "the asset is still on the balance sheet at book value and the profit is short " +
          "whatever it fetched. Enter what each sold for, excluding GST.",
      ),
    );
  }

  const fromJournals = document.createElement("button");
  fromJournals.type = "button";
  fromJournals.textContent = "Read proceeds from the journal report";
  fromJournals.addEventListener("click", () => void proceedsFromJournals());
  body.append(fromJournals);

  const table = document.createElement("table");
  table.className = "report-table owner-table";
  const head = document.createElement("thead");
  head.innerHTML =
    "<tr><th>Asset</th><th>Disposed</th><th>Cost</th><th>Depreciation</th>" +
    "<th>Book value</th><th>Proceeds</th><th>Recovered</th><th>Capital gain</th>" +
    "<th>Loss</th><th></th></tr>";
  const tbody = document.createElement("tbody");

  for (const asset of [...disposed].sort((a, b) => (a.disposed ?? "").localeCompare(b.disposed ?? ""))) {
    const book = bookValues.get(asset.number);
    const sold = proceeds[asset.number];
    const tr = document.createElement("tr");
    tr.append(nameCell(`${asset.number} ${asset.name}`));
    tr.append(nameCell(asset.disposed ?? ""));
    tr.append(amountCell(formatAmount(asset.cost)));

    if (book === undefined) {
      // Disposed outside every year the transactions cover, so no schedule ran
      // for it. Saying so beats showing blanks that look like nil.
      tr.append(nameCell("before this ledger"));
      tr.append(nameCell(""));
      tr.append(nameCell(""));
      tr.append(nameCell(""));
      tr.append(nameCell(""));
      tr.append(nameCell(""));
      tr.append(nameCell(""));
      tbody.append(tr);
      continue;
    }

    tr.append(amountCell(formatAmount(asset.cost - book)));
    tr.append(amountCell(formatAmount(book)));

    if (sold === undefined) {
      const cell = document.createElement("td");
      cell.className = "report-amount";
      const ask = document.createElement("button");
      ask.type = "button";
      ask.className = "link-button";
      ask.textContent = "enter";
      ask.addEventListener("click", () => askProceeds(asset.number, asset.name, 0));
      cell.append(ask);
      tr.append(cell);
      tr.append(nameCell(""));
      tr.append(nameCell(""));
      tr.append(nameCell(""));
      tr.append(nameCell(""));
      tbody.append(tr);
      continue;
    }

    const d = disposalOf({
      cost: asset.cost,
      accumulatedDepreciation: asset.cost - book,
      proceeds: sold,
    });
    tr.append(amountCell(formatAmount(d.proceeds)));
    tr.append(amountCell(d.depreciationRecovered === 0 ? "" : formatAmount(d.depreciationRecovered)));
    tr.append(amountCell(d.capitalGain === 0 ? "" : formatAmount(d.capitalGain)));
    tr.append(amountCell(d.lossOnSale === 0 ? "" : formatAmount(d.lossOnSale)));

    const actions = document.createElement("td");
    const edit = document.createElement("button");
    edit.type = "button";
    edit.className = "link-button";
    edit.textContent = "edit";
    edit.addEventListener("click", () => askProceeds(asset.number, asset.name, sold));
    actions.append(edit);
    tr.append(actions);
    tbody.append(tr);
  }

  table.append(head, tbody);
  body.append(table);
  body.append(
    note(
      "Depreciation recovered is assessable income: the part of the depreciation claimed that " +
        "the sale showed was too generous. A capital gain is not assessable, and is anything " +
        "above what the asset cost. A loss on sale is deductible. At most two of the three are " +
        "ever more than nothing.",
    ),
  );
}

function askProceeds(number: string, name: string, current: Cents): void {
  const amount = window.prompt(
    `What did ${number} ${name} sell for, excluding GST?\n\n` +
      "Nothing at all, if it was scrapped: the whole book value is then a loss on sale.",
    (current / 100).toFixed(2),
  );
  if (amount === null) return;
  const parsed = parseAmount(amount.trim());
  if (parsed === null) {
    alert(`"${amount}" is not an amount.`);
    return;
  }
  void saveProceeds(number, Math.abs(parsed));
}

async function saveProceeds(number: string, cents: Cents): Promise<void> {
  const before = state.ledger.assetProceeds ?? {};
  const assetProceeds = { ...before, [number]: cents };
  state.ledger = { ...state.ledger, assetProceeds };
  state.persistent = await savePart(state.ledger);
  await record(
    "disposal",
    `${number} sold for ${(cents / 100).toFixed(2)}`,
    before[number] ?? null,
    cents,
    number,
  );
  reclassify();
  redraw("assets");
}

/**
 * Take the proceeds from the disposal journals the accounting system posted.
 *
 * Its journal names the asset and carries the outcome -- what was recovered,
 * any capital gain, any loss -- so the proceeds can be worked back out of it:
 * book value plus what was recovered plus any gain, less any loss. That is
 * arithmetic on figures somebody else already agreed, not a guess.
 *
 * Reversals are why this cannot simply add up every journal mentioning the
 * asset. A disposal reversed and re-posted appears three times, and summing
 * them would give a figure that never happened; the last one dated on or
 * before the disposal date is the one that stands.
 */
async function proceedsFromJournals(): Promise<void> {
  const journals = state.ledger.journals ?? [];
  if (journals.length === 0) {
    alert(
      "No journal report loaded. Load one on the Coding reconciliation page, and the disposal journals " +
        "in it can be read for what each asset sold for.",
    );
    return;
  }

  const assets = state.ledger.assets ?? [];
  const years = [...new Set(state.ledger.transactions.map((t) => financialYearOf(t.date)))];
  const bookValues = new Map<string, Cents>();
  for (const year of years) {
    const schedule = depreciationSchedule(assets, {
      from: `${year - 1}-04-01`,
      to: `${year}-03-31`,
    });
    for (const row of schedule.rows) {
      if (row.disposedInPeriod) bookValues.set(row.asset.number, row.bookValueAtDisposal);
    }
  }

  const found = new Map<string, Cents>();
  const skipped: string[] = [];
  for (const asset of assets) {
    if (asset.disposed === null) continue;
    const book = bookValues.get(asset.number);
    if (book === undefined) continue;

    // The live disposal for this asset: its own journals, reversals left out,
    // latest first.
    const mine = journals
      .filter(
        (j) =>
          j.narration.includes(asset.number) &&
          /disposal/i.test(j.narration) &&
          !/^reversed:/i.test(j.narration.trim()),
      )
      .sort((a, b) => b.date.localeCompare(a.date));
    const journal = mine[0];
    if (journal === undefined) {
      skipped.push(asset.number);
      continue;
    }

    const on = (code: string): Cents =>
      journal.lines.filter((l) => l.accountCode === code).reduce((sum, l) => sum + l.amount, 0);
    const recovered = -on("300");
    const gain = -on("301");
    const loss = on("470");
    found.set(asset.number, book + recovered + gain - loss);
  }

  if (found.size === 0) {
    alert("No disposal journals found for the assets in the register.");
    return;
  }

  const lines = [...found]
    .map(([number, cents]) => `  ${number}  ${(cents / 100).toFixed(2)}`)
    .join("\n");
  const ok = confirm(
    `Proceeds worked back from ${found.size} disposal journal${found.size === 1 ? "" : "s"}:\n\n` +
      lines +
      (skipped.length > 0 ? `\n\nNo journal found for: ${skipped.join(", ")}` : "") +
      "\n\nThis replaces any proceeds already entered.",
  );
  if (!ok) return;

  const before = state.ledger.assetProceeds ?? {};
  const assetProceeds = { ...before, ...Object.fromEntries(found) };
  state.ledger = { ...state.ledger, assetProceeds };
  state.persistent = await savePart(state.ledger);
  await record(
    "disposal",
    `Proceeds read from the journal report for ${found.size} assets`,
    before,
    assetProceeds,
    "proceeds",
  );
  reclassify();
  redraw("assets");
}

export function renderAssetsPage(): void {
  const body = $("assets-body");
  body.textContent = "";
  const assets = state.ledger.assets ?? [];

  if (assets.length === 0) {
    body.append(
      note(
        "No assets loaded. Without them the accounts are short exactly one figure: " +
          "depreciation, and any gain or loss on something sold.",
      ),
    );
    return;
  }

  const total = assets.reduce((sum, a) => sum + a.cost, 0);
  body.append(
    note(
      `${assets.length} asset${assets.length === 1 ? "" : "s"}, ${formatAmount(total)} at cost. ` +
        "The depreciation schedule is on the Reports page.",
    ),
  );

  const table = document.createElement("table");
  table.className = "report-table owner-table";
  const head = document.createElement("thead");
  head.innerHTML =
    "<tr><th>Number</th><th>Asset</th><th>Type</th><th>Purchased</th>" +
    "<th>Cost</th><th>Rate</th><th>Disposed / status</th></tr>";
  const tbody = document.createElement("tbody");

  for (const asset of [...assets].sort((a, b) => (a.purchased ?? "").localeCompare(b.purchased ?? ""))) {
    const tr = document.createElement("tr");
    tr.append(nameCell(asset.number));
    tr.append(nameCell(asset.name));
    tr.append(nameCell(asset.type));
    tr.append(nameCell(asset.purchased ?? ""));
    tr.append(amountCell(formatAmount(asset.cost)));
    tr.append(amountCell(`${asset.rate}%`));
    tr.append(nameCell(asset.disposed ?? asset.status));
    tbody.append(tr);
  }
  table.append(head, tbody);
  body.append(table);

  renderDisposals(body);
}

/** Loading a fixed-asset schedule. */
export function wireAssets(): void {

  $("assets-pick").addEventListener("click", () => $<HTMLInputElement>("assets-input").click());
  $("assets-pick2").addEventListener("click", () => $<HTMLInputElement>("assets-input").click());
  $<HTMLInputElement>("assets-input").addEventListener("change", (e) => {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (file) void loadAssets(file);
    (e.target as HTMLInputElement).value = "";
  });
}
