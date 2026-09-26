import { redraw, showPage } from "../app.js";
import { accountsForEditing, importedAssetProceeds, reclassify, record } from "../books.js";
import { combobox } from "../combobox.js";
import { $, state } from "../state.js";
import { savePart } from "../store.js";
import { amountCell, download, nameCell, note } from "../ui.js";
import {
  DEPRECIATION_METHODS,
  depreciationSchedule,
  disposalOf,
  financialYearOf,
  fixedAssetProblems,
  fixedAssetTemplate,
  formatAmount,
  formatFixedAssets,
  isNoDepreciation,
  nextAssetNumber,
  parseAmount,
} from "@nzosa/core";
import type { Cents, FixedAsset, IsoDate } from "@nzosa/core";
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

  // Entered by hand wins; the journal report's disposal journals fill the rest,
  // so a sale Xero has already posted needs nothing typed in.
  const entered = state.ledger.assetProceeds ?? {};
  const imported = importedAssetProceeds();
  const proceeds: Record<string, Cents> = { ...Object.fromEntries(imported), ...entered };
  const missing = disposed.filter((a) => proceeds[a.number] === undefined).length;
  if (missing > 0) {
    body.append(
      note(
        `${missing} of these have no sale proceeds recorded, so nothing is posted for them. ` +
          "Enter what each sold for, excluding GST.",
      ),
    );
  }

  const read = disposed.filter(
    (a) => entered[a.number] === undefined && imported.has(a.number),
  ).length;
  if (read > 0) {
    body.append(
      note(
        `Proceeds for ${read} disposal${read === 1 ? " are" : "s are"} taken from the journal ` +
          "report. An amount entered by hand overrides it.",
      ),
    );
  }
  // A figure typed in that the journal disagrees with is most likely a typing
  // slip, and a slip here moves the gain by exactly as much.
  const disagree = disposed.filter(
    (a) =>
      entered[a.number] !== undefined &&
      imported.has(a.number) &&
      imported.get(a.number) !== entered[a.number],
  );
  if (disagree.length > 0) {
    body.append(
      note(
        "Entered by hand and different from the journal report: " +
          disagree
            .map(
              (a) =>
                `${a.number} ${formatAmount(entered[a.number] ?? 0)} entered, ` +
                `${formatAmount(imported.get(a.number) ?? 0)} in the journal`,
            )
            .join("; ") +
          '. Press "use" on the row to take the journal\'s figure.',
      ),
    );
  }

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
    const fromJournal = imported.get(asset.number);
    if (entered[asset.number] === undefined) {
      const from = document.createElement("span");
      from.textContent = " · from the journal report";
      actions.append(from);
    } else if (fromJournal !== undefined && fromJournal !== sold) {
      const use = document.createElement("button");
      use.type = "button";
      use.className = "link-button";
      use.textContent = `use ${formatAmount(fromJournal)}`;
      use.addEventListener("click", () => void saveProceeds(asset.number, fromJournal));
      actions.append(" · ", use);
    }
    tr.append(actions);
    tbody.append(tr);
  }

  table.append(head, tbody);
  body.append(table);
  body.append(
    note(
      "Depreciation recovered is taxable income. A capital gain (above original cost) is not " +
        "taxable. A loss on sale is deductible.",
    ),
  );
}

function askProceeds(number: string, name: string, current: Cents): void {
  const amount = window.prompt(
    `What did ${number} ${name} sell for, excluding GST?\n\n` +
      "Enter 0 if it was scrapped; the book value is then a loss on sale.",
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

/** An asset being added or changed: what is typed, until it is saved. */
interface AssetDraft {
  /** The number of the asset being changed, or null for a new one. */
  replacing: string | null;
  number: string;
  name: string;
  type: string;
  purchased: string;
  depreciationFrom: string;
  cost: string;
  method: string;
  rate: string;
  /** Shown once an asset is being disposed of, or already has been. */
  disposing: boolean;
  disposed: string;
  proceeds: string;
}

let assetDraft: AssetDraft | null = null;

const today = (): IsoDate => new Date().toISOString().slice(0, 10) as IsoDate;
const typed = (cents: Cents): string => (cents / 100).toFixed(2);

/**
 * Open the form for a new asset, filled in from what is already known.
 *
 * Called from the coding of a purchase: the date, the cost and the account it
 * was coded to are in front of the person already, and asking for them again
 * on another page is how assets go unrecorded.
 */
export function offerAsset(prefill: { name: string; type: string; purchased: IsoDate; cost: Cents }): void {
  assetDraft = {
    replacing: null,
    number: nextAssetNumber(state.ledger.assets ?? []),
    name: prefill.name,
    type: prefill.type,
    purchased: prefill.purchased,
    depreciationFrom: prefill.purchased,
    cost: typed(prefill.cost),
    method: "Diminishing Value",
    rate: "",
    disposing: false,
    disposed: "",
    proceeds: "",
  };
  showPage("assets");
}

function draftOf(asset: FixedAsset, disposing: boolean): AssetDraft {
  const proceeds = state.ledger.assetProceeds?.[asset.number];
  return {
    replacing: asset.number,
    number: asset.number,
    name: asset.name,
    type: asset.type,
    purchased: asset.purchased ?? "",
    depreciationFrom: asset.depreciationFrom ?? "",
    cost: typed(asset.cost),
    method: asset.method,
    rate: String(asset.rate),
    disposing: disposing || asset.disposed !== null,
    disposed: asset.disposed ?? (disposing ? today() : ""),
    proceeds: proceeds === undefined ? "" : typed(proceeds),
  };
}

/** The asset a draft would save, its sale proceeds, and what is still stopping it. */
function assetFromDraft(draft: AssetDraft): { asset: FixedAsset; proceeds: Cents | null; problems: string[] } {
  const problems: string[] = [];
  const amount = (text: string, what: string): Cents | null => {
    if (text.trim() === "") return null;
    const parsed = parseAmount(text.trim());
    if (parsed === null) problems.push(`${what}: that is not an amount`);
    return parsed;
  };
  const date = (text: string): IsoDate | null => (/^\d{4}-\d{2}-\d{2}$/.test(text) ? (text as IsoDate) : null);
  const none = isNoDepreciation(draft.method);
  const rate = none ? 0 : Number(draft.rate.trim() === "" ? NaN : draft.rate.trim());
  const existing = (state.ledger.assets ?? []).find((a) => a.number === draft.replacing);
  const disposed = draft.disposing ? date(draft.disposed) : null;
  if (draft.disposing && disposed === null) problems.push("give the date it was disposed of");
  const asset: FixedAsset = {
    number: draft.number.trim(),
    name: draft.name.trim(),
    type: draft.type.trim(),
    status: disposed !== null ? "Disposed" : "Registered",
    purchased: date(draft.purchased),
    depreciationFrom: date(draft.depreciationFrom) ?? date(draft.purchased),
    cost: Math.abs(amount(draft.cost, "cost") ?? 0),
    rate: Number.isFinite(rate) ? rate : 0,
    method: draft.method,
    averaging: existing?.averaging || "Full Month",
    disposed,
  };
  const proceeds = draft.disposing ? amount(draft.proceeds, "sale proceeds") : null;
  return {
    asset,
    proceeds: proceeds === null ? null : Math.abs(proceeds),
    problems: [...problems, ...fixedAssetProblems(asset, state.ledger.assets ?? [], draft.replacing ?? undefined)],
  };
}

/** The asset types to offer: those already in use, and the chart's fixed asset accounts. */
function assetTypes(): string[] {
  const fromRegister = (state.ledger.assets ?? []).map((a) => a.type).filter((t) => t.trim() !== "");
  const fromChart = accountsForEditing()
    .map((row) => row.account)
    .filter((a) => a.type.trim().toLowerCase() === "fixed asset" && !/accumulated/i.test(a.name))
    .map((a) => a.name);
  return [...new Set([...fromRegister, ...fromChart])].sort((a, b) => a.localeCompare(b));
}

function assetEditor(draft: AssetDraft): HTMLElement {
  const wrap = document.createElement("div");
  wrap.className = "split-editor journal-editor";
  const title = document.createElement("h4");
  title.textContent = draft.replacing === null ? "Add an asset" : draft.disposing ? `Dispose of ${draft.replacing}` : `Change ${draft.replacing}`;
  wrap.append(title);

  const status = document.createElement("p");
  status.className = "split-balance";
  const save = document.createElement("button");
  save.type = "button";
  save.className = "primary";
  save.textContent = draft.replacing === null ? "Add asset" : "Save";

  const fields = document.createElement("div");
  fields.className = "agent-fields";
  const field = (label: string, control: HTMLElement, hint = ""): HTMLLabelElement => {
    const wrapper = document.createElement("label");
    wrapper.append(label, control);
    if (hint !== "") wrapper.title = hint;
    fields.append(wrapper);
    return wrapper;
  };
  const input = (value: string, set: (v: string) => void, type = "text", placeholder = ""): HTMLInputElement => {
    const element = document.createElement("input");
    element.type = type;
    element.value = value;
    element.placeholder = placeholder;
    element.addEventListener("input", () => {
      set(element.value);
      refresh();
    });
    return element;
  };
  const money = (value: string, set: (v: string) => void): HTMLInputElement => {
    const element = input(value, set, "text", "0.00");
    element.inputMode = "decimal";
    element.className = "split-amount";
    return element;
  };

  field("Asset name", input(draft.name, (v) => { draft.name = v; }, "text", "e.g. Delivery van"));
  field("Asset number", input(draft.number, (v) => { draft.number = v; }));
  const typePicker = combobox(assetTypes(), draft.type === "" ? null : draft.type, "e.g. Motor Vehicles", () => {
    draft.type = typePicker.value;
    refresh();
  });
  // A new type can be typed as well as picked; the picker only commits a pick.
  typePicker.element.querySelector("input")?.addEventListener("input", (event) => {
    draft.type = (event.target as HTMLInputElement).value;
    refresh();
  });
  field(
    "Asset type",
    typePicker.element,
    "Assets are grouped by type on the schedule, and depreciation is posted to the fixed asset account whose name matches it best.",
  );
  field("Purchase date", input(draft.purchased, (v) => { draft.purchased = v; }, "date"));
  field(
    "Purchase price",
    money(draft.cost, (v) => { draft.cost = v; }),
    "What it cost, excluding GST if the books are registered for GST.",
  );
  field("Depreciation start date", input(draft.depreciationFrom, (v) => { draft.depreciationFrom = v; }, "date"));
  const method = document.createElement("select");
  for (const option of DEPRECIATION_METHODS) {
    const element = document.createElement("option");
    element.value = option.value;
    element.textContent = option.label;
    element.selected = option.value.toLowerCase() === draft.method.toLowerCase();
    method.append(element);
  }
  const rate = input(draft.rate, (v) => { draft.rate = v; }, "text", "e.g. 30");
  rate.inputMode = "decimal";
  method.addEventListener("change", () => {
    draft.method = method.value;
    refresh();
  });
  field("Depreciation method", method);
  field("Rate, % a year", rate, "Inland Revenue's rate for this kind of asset, for the method chosen. Its depreciation rate finder gives both.");

  if (draft.disposing) {
    field("Disposal date", input(draft.disposed, (v) => { draft.disposed = v; }, "date"));
    field(
      "Sale proceeds",
      money(draft.proceeds, (v) => { draft.proceeds = v; }),
      "What it sold for, excluding GST. Nothing if it was scrapped.",
    );
  }
  wrap.append(fields);

  save.addEventListener("click", () => {
    const { asset, proceeds, problems } = assetFromDraft(draft);
    if (problems.length > 0) return;
    const replacing = draft.replacing;
    assetDraft = null;
    void saveAsset(asset, replacing, proceeds);
  });
  const cancel = document.createElement("button");
  cancel.type = "button";
  cancel.textContent = "Cancel";
  cancel.addEventListener("click", () => {
    assetDraft = null;
    redraw("assets");
  });
  const buttons = document.createElement("div");
  buttons.className = "page-actions";
  buttons.append(save, cancel);
  wrap.append(status, buttons);

  function refresh(): void {
    const none = isNoDepreciation(draft.method);
    rate.disabled = none;
    if (none) rate.value = "";
    const { problems } = assetFromDraft(draft);
    status.textContent = problems.length === 0 ? "Ready to save." : `Still to do: ${problems.join("; ")}.`;
    status.className = problems.length === 0 ? "split-balance ok" : "split-balance off";
    save.disabled = problems.length > 0;
  }
  refresh();
  return wrap;
}

async function saveAsset(asset: FixedAsset, replacing: string | null, proceeds: Cents | null): Promise<void> {
  const before = state.ledger.assets ?? [];
  const assets =
    replacing === null ? [...before, asset] : before.map((a) => (a.number === replacing ? asset : a));

  // Proceeds are kept by asset number, so a renumbered asset takes them along.
  const proceedsBefore = state.ledger.assetProceeds ?? {};
  const assetProceeds = { ...proceedsBefore };
  if (replacing !== null && replacing !== asset.number && assetProceeds[replacing] !== undefined) {
    assetProceeds[asset.number] = assetProceeds[replacing] as Cents;
    delete assetProceeds[replacing];
  }
  if (asset.disposed === null) delete assetProceeds[asset.number];
  else if (proceeds !== null) assetProceeds[asset.number] = proceeds;

  state.ledger = { ...state.ledger, assets, assetProceeds };
  state.persistent = await savePart(state.ledger, "assets");
  const what =
    replacing === null
      ? `${asset.number} ${asset.name} added, ${formatAmount(asset.cost)}`
      : asset.disposed !== null
        ? `${asset.number} ${asset.name} disposed of on ${asset.disposed}`
        : `${asset.number} ${asset.name} changed`;
  await record("assets", what, before, assets);
  if (JSON.stringify(proceedsBefore) !== JSON.stringify(assetProceeds)) {
    await record("disposal", `${asset.number} sale proceeds`, proceedsBefore, assetProceeds, "proceeds");
  }
  reclassify();
  redraw("assets");
}

async function removeAsset(asset: FixedAsset): Promise<void> {
  if (!confirm(`Remove ${asset.number} ${asset.name} from the register? Its depreciation goes with it.`)) return;
  const before = state.ledger.assets ?? [];
  const assets = before.filter((a) => a.number !== asset.number);
  // Its sale proceeds go with it. Left behind, they would sit under a number no
  // asset holds -- and be picked up by the next asset given that number.
  const proceedsBefore = state.ledger.assetProceeds ?? {};
  const assetProceeds = { ...proceedsBefore };
  delete assetProceeds[asset.number];
  state.ledger = { ...state.ledger, assets, assetProceeds };
  state.persistent = await savePart(state.ledger, "assets");
  if (proceedsBefore[asset.number] !== undefined) {
    await record("disposal", `${asset.number} sale proceeds removed with it`, proceedsBefore, assetProceeds, "proceeds");
  }
  await record("assets", `${asset.number} ${asset.name} removed`, before, assets);
  reclassify();
  redraw("assets");
}

export function renderAssetsPage(): void {
  const body = $("assets-body");
  body.textContent = "";
  const assets = state.ledger.assets ?? [];

  const actions = document.createElement("div");
  actions.className = "page-actions";
  const add = document.createElement("button");
  add.type = "button";
  add.className = "primary";
  add.textContent = "Add asset";
  add.disabled = assetDraft !== null;
  add.addEventListener("click", () => {
    assetDraft = {
      replacing: null,
      number: nextAssetNumber(assets),
      name: "",
      type: "",
      purchased: today(),
      depreciationFrom: today(),
      cost: "",
      method: "Diminishing Value",
      rate: "",
      disposing: false,
      disposed: "",
      proceeds: "",
    };
    redraw("assets");
  });
  const template = document.createElement("button");
  template.type = "button";
  template.textContent = "Download template";
  template.title = "The columns a register is loaded from, with one example asset, to fill in on a sheet.";
  template.addEventListener("click", () =>
    download(fixedAssetTemplate(), "fixed-asset-register-template.csv", "text/csv"),
  );
  const exportButton = document.createElement("button");
  exportButton.type = "button";
  exportButton.textContent = "Export register";
  exportButton.disabled = assets.length === 0;
  exportButton.addEventListener("click", () =>
    download(formatFixedAssets(assets), "fixed-asset-register.csv", "text/csv"),
  );
  actions.append(add, template, exportButton);
  body.append(actions);
  if (assetDraft !== null) body.append(assetEditor(assetDraft));

  if (assets.length === 0) {
    body.append(
      note(
        "No assets yet. Add them to calculate depreciation and gains or losses on sale, or " +
          "fill in the template and load it below.",
      ),
    );
    return;
  }

  // This year's figures beside each asset: the latest year the books reach.
  const years = state.ledger.transactions.map((t) => financialYearOf(t.date));
  const year = years.length > 0 ? Math.max(...years) : financialYearOf(today());
  const schedule = depreciationSchedule(assets, { from: `${year - 1}-04-01`, to: `${year}-03-31` });
  const rowOf = new Map(schedule.rows.map((row) => [row.asset.number, row]));

  const total = assets.reduce((sum, a) => sum + a.cost, 0);
  body.append(
    note(
      `${assets.length} asset${assets.length === 1 ? "" : "s"}, ${formatAmount(total)} at cost. ` +
        `Depreciation and book value are for FY${year}; the full schedule is on the Reports page.`,
    ),
  );

  const table = document.createElement("table");
  table.className = "report-table owner-table";
  const head = document.createElement("thead");
  head.innerHTML =
    "<tr><th>Number</th><th>Asset</th><th>Type</th><th>Purchased</th><th>Cost</th>" +
    `<th>Method</th><th>Depreciation FY${year}</th><th>Book value 31 Mar ${year}</th>` +
    "<th>Status</th><th></th></tr>";
  const tbody = document.createElement("tbody");

  for (const asset of [...assets].sort((a, b) => (a.purchased ?? "").localeCompare(b.purchased ?? ""))) {
    const row = rowOf.get(asset.number);
    const tr = document.createElement("tr");
    tr.append(nameCell(asset.number));
    tr.append(nameCell(asset.name));
    tr.append(nameCell(asset.type));
    tr.append(nameCell(asset.purchased ?? ""));
    tr.append(amountCell(formatAmount(asset.cost)));
    tr.append(nameCell(isNoDepreciation(asset.method) ? "None" : `${asset.rate}% ${/dim|dv/i.test(asset.method) ? "DV" : "SL"}`));
    tr.append(amountCell(row === undefined ? "" : formatAmount(row.depreciation)));
    tr.append(amountCell(row === undefined ? "" : formatAmount(row.closing)));
    tr.append(nameCell(asset.disposed !== null ? `Disposed ${asset.disposed}` : asset.status || "Registered"));

    const cell = document.createElement("td");
    const button = (text: string, act: () => void): HTMLButtonElement => {
      const element = document.createElement("button");
      element.type = "button";
      element.className = "link-button";
      element.textContent = text;
      element.disabled = assetDraft !== null;
      element.addEventListener("click", act);
      return element;
    };
    cell.append(
      button("edit", () => {
        assetDraft = draftOf(asset, false);
        redraw("assets");
      }),
    );
    if (asset.disposed === null) {
      cell.append(
        " · ",
        button("dispose", () => {
          assetDraft = draftOf(asset, true);
          redraw("assets");
        }),
      );
    }
    cell.append(" · ", button("remove", () => void removeAsset(asset)));
    tr.append(cell);
    tbody.append(tr);
  }
  table.append(head, tbody);
  body.append(table);

  renderDisposals(body);
}

/** Loading a fixed-asset schedule. */
export function wireAssets(): void {

  $("assets-pick2").addEventListener("click", () => $<HTMLInputElement>("assets-input").click());
  $<HTMLInputElement>("assets-input").addEventListener("change", (e) => {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (file) void loadAssets(file);
    (e.target as HTMLInputElement).value = "";
  });
}
