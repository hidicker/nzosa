import { booksCurrency } from "../country.js";
import { formatAmount, parseAmount } from "@nzosa/core";
import type { DeductionNotice } from "@nzosa/core";
import { state } from "../state.js";

/**
 * An employee's deduction notices, as a list to edit: child support from
 * Inland Revenue, an IRD deduction notice for a tax or student loan debt, or
 * a court's attachment order for a fine. Each is taken from every pay from
 * its start until its end, or until its total is reached.
 */

const KINDS: readonly (readonly [DeductionNotice["kind"], string])[] = [
  ["child-support", "Child support (IR)"],
  ["ird", "IRD deduction notice"],
  ["court-fine", "Court fine (attachment order)"],
];

export function noticesEditor(
  notices: readonly DeductionNotice[],
  onChange: (notices: DeductionNotice[]) => void,
): HTMLElement {
  const wrap = document.createElement("div");
  wrap.className = "payroll-items payroll-notices";
  const title = document.createElement("strong");
  title.textContent = "Deduction notices";
  const hint = document.createElement("small");
  hint.textContent =
    " Taken from every pay by law, ahead of agreed deductions. Child support is filed with the pay and keeps 60% of net pay; " +
    "the others are held in the account chosen until paid on.";
  wrap.append(title, hint);
  let list = notices.map((n) => ({ ...n }));
  const rows = document.createElement("div");
  wrap.append(rows);

  const money = (text: string): number | undefined => {
    if (text.trim() === "") return undefined;
    const cents = parseAmount(text.trim(), booksCurrency());
    return cents === null ? undefined : cents;
  };
  const shown = (cents: number | undefined): string => (cents === undefined ? "" : formatAmount(cents));

  const draw = (): void => {
    rows.textContent = "";
    list.forEach((notice, index) => {
      const row = document.createElement("div");
      row.className = "payroll-notice";
      const set = (patch: Partial<DeductionNotice>): void => {
        const next = { ...list[index]!, ...patch } as DeductionNotice;
        for (const key of Object.keys(next) as (keyof DeductionNotice)[]) if (next[key] === undefined || next[key] === "") delete next[key];
        list[index] = { ...next, id: notice.id, kind: next.kind ?? notice.kind, reference: next.reference ?? "", from: next.from ?? notice.from };
        onChange(list);
      };
      const field = (label: string, control: HTMLElement): void => {
        const l = document.createElement("label");
        l.append(`${label} `, control);
        row.append(l);
      };
      const input = (value: string, type = "text", placeholder = ""): HTMLInputElement => {
        const el = document.createElement("input");
        el.type = type;
        el.value = value;
        el.placeholder = placeholder;
        if (type === "text") el.className = "payroll-tiny-input";
        return el;
      };

      const kind = document.createElement("select");
      for (const [value, text] of KINDS) {
        const option = document.createElement("option");
        option.value = value;
        option.textContent = text;
        option.selected = value === notice.kind;
        kind.append(option);
      }
      kind.addEventListener("change", () => {
        set({ kind: kind.value as DeductionNotice["kind"] });
        draw();
      });
      field("Kind", kind);
      const reference = input(notice.reference, "text", "Its reference");
      reference.className = "";
      reference.addEventListener("change", () => set({ reference: reference.value.trim() }));
      field("Reference", reference);
      const amount = input(shown(notice.amount), "text", "0.00");
      amount.addEventListener("change", () => set({ amount: money(amount.value), ...(money(amount.value) !== undefined ? { rate: undefined } : {}) }));
      field("Each pay", amount);
      if (notice.kind !== "child-support") {
        const rate = input(notice.rate === undefined ? "" : String(Math.round(notice.rate * 10000) / 100), "text", "%");
        rate.addEventListener("change", () => {
          const n = Number(rate.value);
          set({ rate: rate.value.trim() === "" || !(n > 0) ? undefined : Math.min(100, n) / 100 });
        });
        field("or % of net", rate);
      }
      const from = input(notice.from, "date");
      from.addEventListener("change", () => set({ from: from.value }));
      field("From", from);
      const until = input(notice.until ?? "", "date");
      until.addEventListener("change", () => set({ until: until.value === "" ? undefined : until.value }));
      field("Until", until);
      if (notice.kind !== "child-support") {
        const total = input(shown(notice.total), "text", "no limit");
        total.addEventListener("change", () => set({ total: money(total.value) }));
        field("Total to take", total);
        const keep = input(shown(notice.protectedNet), "text", "none");
        keep.title = "Net pay the employee keeps whatever the notice asks: the protected earnings on an attachment order";
        keep.addEventListener("change", () => set({ protectedNet: money(keep.value) }));
        field("Protected net pay", keep);
        const account = document.createElement("select");
        const blank = document.createElement("option");
        blank.value = "";
        blank.textContent = "Post with wages";
        account.append(blank);
        for (const a of state.chart.filter((c) => c.code.trim() !== "" && /liabilit|payable/i.test(`${c.type} ${c.name}`))) {
          const option = document.createElement("option");
          option.value = a.code;
          option.textContent = `${a.code} ${a.name}`;
          option.selected = a.code === notice.account;
          account.append(option);
        }
        account.addEventListener("change", () => set({ account: account.value === "" ? undefined : account.value }));
        field("Held in", account);
      }
      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "link-button";
      remove.textContent = "Remove";
      remove.addEventListener("click", () => {
        list = list.filter((_, i) => i !== index);
        onChange(list);
        draw();
      });
      row.append(remove);
      rows.append(row);
    });
  };

  const add = document.createElement("button");
  add.type = "button";
  add.className = "small";
  add.textContent = "Add a notice";
  add.addEventListener("click", () => {
    list = [...list, { id: `notice-${Date.now().toString(36)}`, kind: "ird", reference: "", from: new Date().toLocaleDateString("en-CA") }];
    onChange(list);
    draw();
  });
  draw();
  wrap.append(add);
  return wrap;
}
