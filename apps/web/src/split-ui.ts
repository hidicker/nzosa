import { combobox } from "./combobox.js";
import { formatAmount, parseAmount } from "@nzosa/core";
import type { SplitPart, Transaction } from "@nzosa/core";
import { GST_OPTIONS, classificationToRate, rateToClassification } from "./reconcile.js";
import type { GstRate } from "./reconcile.js";

/**
 * Dividing one bank line into parts.
 *
 * A statement line is often several things at once: freight plus border GST
 * plus an entry fee, a payout net of its processing fee, a meal that is half
 * deductible. Each part needs its own code and GST treatment, and the bank
 * still only moved one amount.
 *
 * So the editor enforces one rule above all others: the parts must sum to the
 * transaction exactly. A split that does not balance would change a GST return
 * without any bank line having changed, which is the one thing this tool must
 * never allow. Saving stays disabled until it balances, and the shortfall is
 * shown while it does not.
 */

export interface SplitEditorOptions {
  transaction: Transaction;
  /** Parts already recorded, if this line has been split before. */
  parts: readonly SplitPart[];
  codes: readonly string[];
  onSave: (parts: SplitPart[]) => void;
  onRemove: () => void;
  onCancel: () => void;
}

interface Draft {
  amount: string;
  code: string;
  rate: GstRate;
  note: string;
}

function toDraft(part: SplitPart): Draft {
  return {
    amount: (part.amount / 100).toFixed(2),
    code: part.code ?? "",
    rate: classificationToRate({
      treatment: part.treatment ?? "standard",
      side: part.side ?? "none",
    }),
    note: part.note ?? "",
  };
}

export function splitEditor(options: SplitEditorOptions): HTMLElement {
  const { transaction } = options;
  const drafts: Draft[] =
    options.parts.length > 0
      ? options.parts.map(toDraft)
      : [
          // Seed with the whole amount so the common case -- peel one part off
          // a line -- starts from something that already balances.
          { amount: (transaction.amount / 100).toFixed(2), code: "", rate: "15", note: "" },
        ];

  const wrap = document.createElement("div");
  wrap.className = "split-editor";

  const rows = document.createElement("div");
  rows.className = "split-rows";

  const footer = document.createElement("div");
  footer.className = "split-footer";
  const balance = document.createElement("span");
  balance.className = "split-balance";

  const addButton = button("Add part", () => {
    drafts.push({ amount: "0.00", code: "", rate: "15", note: "" });
    draw();
  });

  /**
   * The account this chart uses for a thing, or nothing.
   *
   * The two entertainment accounts used to be written in here by name, with
   * one chart's house prefix on them -- `NB Entertainment - 420`. On anybody
   * else's books those accounts do not exist, so the button produced two parts
   * coded to nothing at all and the person had to undo it. Found by looking
   * for it, not by anybody hitting it.
   */
  const accountLike = (pattern: RegExp, avoid?: RegExp): string =>
    options.codes.find((c) => pattern.test(c) && (avoid === undefined || !avoid.test(c))) ?? "";

  const halfButton = button("Split 50/50", () => {
    // Entertainment: half deductible with GST, half not. The odd cent goes to
    // the first part so the two still sum to the line.
    const whole = transaction.amount;
    const first = whole - Math.trunc(whole / 2);
    const nonDeductible = accountLike(/entertainment.*non[- ]?deduct|non[- ]?deduct.*entertainment/i);
    const deductible = accountLike(/entertainment/i, /non[- ]?deduct/i);

    drafts.length = 0;
    drafts.push({
      amount: (first / 100).toFixed(2),
      code: deductible,
      rate: "15",
      note: "Deductible half",
    });
    drafts.push({
      amount: (Math.trunc(whole / 2) / 100).toFixed(2),
      code: nonDeductible,
      rate: "0",
      note: "Non-deductible half, no GST claimed",
    });
    draw();
  });

  const saveButton = button("Save split", () => {
    // The account pickers commit without firing an event, so their values are
    // read back before the drafts are turned into parts.
    readRows();
    options.onSave(
      drafts.map((draft) => {
        const amount = parseAmount(draft.amount) ?? 0;
        const { treatment, side } = rateToClassification(draft.rate, amount);
        return {
          amount,
          ...(draft.code !== "" ? { code: draft.code } : {}),
          treatment,
          side,
          note: draft.note,
        };
      }),
    );
  });
  saveButton.className = "primary";

  const removeButton = button("Remove split", () => options.onRemove());
  removeButton.className = "danger";

  function total(): number {
    return drafts.reduce((sum, draft) => sum + (parseAmount(draft.amount) ?? 0), 0);
  }

  /**
   * Read-backs for controls that do not fire a change event when they commit.
   *
   * The combobox sets its value on a mousedown it has already handled, so
   * nothing bubbles; asking each row for its value before using the drafts is
   * simpler than making the picker synthesise an event.
   */
  let readers: Array<() => void> = [];

  function readRows(): void {
    for (const read of readers) read();
  }

  function draw(): void {
    rows.textContent = "";
    readers = [];
    drafts.forEach((draft, index) => {
      const row = document.createElement("div");
      row.className = "split-row";

      const amount = document.createElement("input");
      amount.type = "text";
      amount.className = "split-amount";
      amount.value = draft.amount;
      amount.addEventListener("input", () => {
        draft.amount = amount.value;
        refresh();
      });

      // The same filtering picker the reconcile row uses. A split is a coding
      // decision like any other, and a hundred accounts in a native select is
      // no easier to search here than it was there.
      //
      // A code the rules have never produced still has to be choosable when a
      // previous split used it, so it is added to the list rather than lost.
      const codes = options.codes.includes(draft.code) || draft.code === ""
        ? options.codes
        : [draft.code, ...options.codes];
      const code = combobox(codes, draft.code === "" ? null : draft.code, "Account");
      code.element.addEventListener("change", () => {
        draft.code = code.value;
      });
      // The combobox commits on picking, which fires no change event of its
      // own, so the draft is read back whenever the row is read.
      readers.push(() => {
        draft.code = code.value;
      });

      const gst = document.createElement("select");
      for (const rate of GST_OPTIONS) {
        const option = document.createElement("option");
        option.value = rate.value;
        option.textContent = rate.label;
        option.title = rate.hint;
        option.selected = rate.value === draft.rate;
        gst.append(option);
      }
      gst.addEventListener("change", () => {
        draft.rate = gst.value as GstRate;
      });

      const note = document.createElement("input");
      note.type = "text";
      note.placeholder = "What this part is";
      note.value = draft.note;
      note.addEventListener("input", () => {
        draft.note = note.value;
      });

      const drop = button("×", () => {
        drafts.splice(index, 1);
        draw();
      });
      drop.className = "split-drop";
      drop.title = "Remove this part";
      drop.disabled = drafts.length < 2;

      row.append(amount, code.element, gst, note, drop);
      rows.append(row);
    });
    refresh();
  }

  function refresh(): void {
    const sum = total();
    const difference = transaction.amount - sum;
    saveButton.disabled = difference !== 0 || drafts.length < 2;
    balance.className = difference === 0 ? "split-balance ok" : "split-balance off";
    balance.textContent =
      difference === 0
        ? `Parts total ${formatAmount(sum)} — matches the bank line`
        : `Parts total ${formatAmount(sum)} against ${formatAmount(transaction.amount)}: ` +
          `${formatAmount(difference)} still to allocate`;
  }

  footer.append(addButton, halfButton, saveButton, removeButton, balance);
  if (options.parts.length === 0) removeButton.hidden = true;
  footer.append(button("Cancel", () => options.onCancel()));

  wrap.append(rows, footer);
  draw();
  return wrap;
}

function button(label: string, onClick: () => void): HTMLButtonElement {
  const element = document.createElement("button");
  element.type = "button";
  element.textContent = label;
  element.addEventListener("click", onClick);
  return element;
}
