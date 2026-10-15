import { booksCurrency, booksMoney } from "../country.js";
import { state } from "../state.js";
import { savePart } from "../store.js";
import { guessBankLayout, importWithLayout, layoutProblem, layoutSignature } from "@nzosa/core";
import type { BankLayout, BankLayoutGuess } from "@nzosa/core";

/**
 * Bank files in a layout no importer knows, waiting for their columns to be
 * pointed out. Each is shown with its first rows, a guess at every column and
 * a preview of what would come in; once chosen, the layout is kept with the
 * books under the file's headings, and the file is imported. The next file
 * with the same headings goes straight in.
 */

interface Waiting {
  file: File;
  text: string;
  guess: BankLayoutGuess;
  layout: BankLayout;
  label: string;
}

const waiting: Waiting[] = [];

/** What a remembered layout holds: the columns, and the account its lines are on. */
export interface RememberedLayout {
  layout: BankLayout;
  account: string;
  accountLabel: string;
}

export function rememberedLayout(signature: string): RememberedLayout | undefined {
  return state.ledger.bankLayouts?.[signature];
}

/** Hold a file whose layout is not known, to have its columns pointed out. */
export function askForColumns(file: File, text: string): void {
  if (waiting.some((w) => w.file.name === file.name && w.text === text)) return;
  const guess = guessBankLayout(text);
  const label = file.name.replace(/\.[^.]+$/, "").replace(/[_]+/g, " ").trim() || "Bank account";
  waiting.push({ file, text, guess, layout: { ...guess.layout }, label });
}

/** Whether a file looks enough like a bank's to be worth asking about: dates, and money. */
export function looksLikeBankFile(text: string): boolean {
  const { layout } = guessBankLayout(text);
  return layout.date >= 0 && (layout.amount >= 0 || (layout.moneyOut >= 0 && layout.moneyIn >= 0));
}

const accountId = (label: string): string =>
  label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "bank";

type Field = "date" | "amount" | "moneyOut" | "moneyIn" | "payee" | "description" | "reference" | "balance";
const FIELDS: readonly [Field, string][] = [
  ["date", "Date"],
  ["amount", "Amount (money out as minus)"],
  ["moneyOut", "Money out"],
  ["moneyIn", "Money in"],
  ["payee", "Payee or other party"],
  ["description", "Description"],
  ["reference", "Reference"],
  ["balance", "Balance"],
];

/**
 * The files waiting, each as a card. `importFiles` runs a file through the
 * usual import once its layout is kept, so it is merged, checked for
 * duplicates and reported like any other.
 */
export function renderColumnChooser(host: HTMLElement, importFiles: (files: File[]) => Promise<void>): void {
  host.textContent = "";
  for (const one of waiting) host.append(card(one, host, importFiles));
}

function card(one: Waiting, host: HTMLElement, importFiles: (files: File[]) => Promise<void>): HTMLElement {
  const box = document.createElement("div");
  box.className = "column-chooser";
  const title = document.createElement("h3");
  title.textContent = `${one.file.name}: which column is which?`;
  const hint = document.createElement("p");
  hint.className = "page-hint";
  hint.textContent =
    "NZOSA doesn't know this bank's layout yet. It has guessed each column below; correct any it got wrong. " +
    "The layout is kept with these books, so the next file from this bank comes straight in.";
  box.append(title, hint);

  const redraw = (): void => renderColumnChooser(host, importFiles);
  const columnSelect = (field: Field): HTMLSelectElement => {
    const select = document.createElement("select");
    const none = document.createElement("option");
    none.value = "-1";
    none.textContent = "None";
    select.append(none);
    one.guess.columns.forEach((name, i) => {
      const option = document.createElement("option");
      option.value = String(i);
      option.textContent = name === "" ? `Column ${i + 1}` : name;
      select.append(option);
    });
    select.value = String(one.layout[field]);
    select.addEventListener("change", () => {
      one.layout = { ...one.layout, [field]: Number(select.value) };
      // One amount, or the pair: choosing one clears the other.
      if (field === "amount" && one.layout.amount >= 0) one.layout = { ...one.layout, moneyOut: -1, moneyIn: -1 };
      if ((field === "moneyOut" || field === "moneyIn") && Number(select.value) >= 0) one.layout = { ...one.layout, amount: -1 };
      redraw();
    });
    return select;
  };

  const grid = document.createElement("div");
  grid.className = "column-chooser-grid";
  for (const [field, words] of FIELDS) {
    const label = document.createElement("label");
    label.className = "contact-field";
    const span = document.createElement("span");
    span.textContent = words;
    label.append(span, columnSelect(field));
    grid.append(label);
  }
  // The date order, where the dates themselves do not settle it.
  const order = document.createElement("select");
  for (const [value, words] of [
    ["auto", "As the file shows"],
    ["day", "Day first (13/04)"],
    ["month", "Month first (04/13)"],
  ] as const) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = words;
    order.append(option);
  }
  order.value = one.layout.dayFirst === null ? "auto" : one.layout.dayFirst ? "day" : "month";
  order.addEventListener("change", () => {
    one.layout = { ...one.layout, dayFirst: order.value === "auto" ? null : order.value === "day" };
    redraw();
  });
  const orderLabel = document.createElement("label");
  orderLabel.className = "contact-field";
  orderLabel.append(Object.assign(document.createElement("span"), { textContent: "Dates" }), order);
  const flip = document.createElement("input");
  flip.type = "checkbox";
  flip.checked = one.layout.outPositive === true;
  flip.addEventListener("change", () => {
    one.layout = { ...one.layout, outPositive: flip.checked };
    redraw();
  });
  const flipLabel = document.createElement("label");
  flipLabel.className = "contact-field";
  flipLabel.append(flip, document.createTextNode(" The amount shows money out as positive"));
  flipLabel.hidden = one.layout.amount < 0;
  const account = document.createElement("input");
  account.type = "text";
  account.value = one.label;
  account.addEventListener("change", () => {
    one.label = account.value.trim() || one.label;
  });
  const accountLabel = document.createElement("label");
  accountLabel.className = "contact-field";
  accountLabel.append(Object.assign(document.createElement("span"), { textContent: "Bank account" }), account);
  grid.append(orderLabel, accountLabel, flipLabel);
  box.append(grid);

  // What would come in, read with the layout as it stands.
  const problem = layoutProblem(one.layout);
  const preview = document.createElement("div");
  preview.className = "table-scroll";
  if (problem === null) {
    const read = importWithLayout(one.text, one.layout, {
      file: one.file.name,
      account: accountId(one.label),
      currency: booksCurrency(),
    });
    const table = document.createElement("table");
    table.className = "report-table";
    table.innerHTML = "<thead><tr><th>Date</th><th>Payee</th><th>Description</th><th>Amount</th></tr></thead>";
    const body = document.createElement("tbody");
    for (const t of read.transactions.slice(0, 5)) {
      const tr = document.createElement("tr");
      for (const [text, cls] of [
        [t.date, "report-name"],
        [t.otherParty, "report-name"],
        [t.particulars, "report-name"],
        [booksMoney(t.amount), "report-amount"],
      ] as const) {
        const td = document.createElement("td");
        td.className = cls;
        td.textContent = text;
        tr.append(td);
      }
      body.append(tr);
    }
    table.append(body);
    preview.append(table);
    const count = document.createElement("p");
    count.className = "page-hint";
    count.textContent =
      `${read.transactions.length} line${read.transactions.length === 1 ? "" : "s"} would come in` +
      (read.problems.length > 0 ? `, ${read.problems.length} left out (totals and lines with no date)` : "") +
      ". Check the amounts: money out should be minus.";
    preview.append(count);
  } else {
    const said = document.createElement("p");
    said.className = "cloud-said";
    said.textContent = problem;
    preview.append(said);
  }
  box.append(preview);

  const go = document.createElement("button");
  go.type = "button";
  go.className = "primary";
  go.textContent = "Import with these columns";
  go.disabled = problem !== null;
  go.addEventListener("click", () => {
    void (async () => {
      go.disabled = true;
      const signature = layoutSignature(one.guess.columns);
      const label = account.value.trim() || one.label;
      state.ledger = {
        ...state.ledger,
        bankLayouts: {
          ...(state.ledger.bankLayouts ?? {}),
          [signature]: { layout: one.layout, account: accountId(label), accountLabel: label },
        },
      };
      state.persistent = await savePart(state.ledger);
      waiting.splice(waiting.indexOf(one), 1);
      await importFiles([one.file]);
    })();
  });
  const skip = document.createElement("button");
  skip.type = "button";
  skip.textContent = "Not now";
  skip.addEventListener("click", () => {
    waiting.splice(waiting.indexOf(one), 1);
    redraw();
  });
  const row = document.createElement("div");
  row.className = "migration-actions";
  row.append(go, skip);
  box.append(row);
  return box;
}
