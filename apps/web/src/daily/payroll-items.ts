import { parseAmount } from "@nzosa/core";
import type { Cents, PayDeduction, PayItem } from "@nzosa/core";
import { state } from "../state.js";

/**
 * Allowances, reimbursements and deductions, as a list to edit.
 *
 * The same editor serves an employee's pay template -- what every pay carries
 * -- and one pay's own items in a pay run, where it starts from the template.
 * Each item can name the account it posts to; left blank, it posts with
 * wages, which is right for an allowance and seldom for anything else.
 */

export type ItemKind = "allowance" | "reimbursement" | "deduction";

const LABELS: Record<ItemKind, { title: string; hint: string; placeholder: string }> = {
  allowance: {
    title: "Allowances",
    hint: "Taxed, and part of gross earnings for KiwiSaver and holiday pay: an accommodation or tool allowance.",
    placeholder: "e.g. Accommodation Allowance",
  },
  reimbursement: {
    title: "Reimbursements",
    hint: "Not taxed, paid on top of net pay: mileage, or costs the employee paid for the business.",
    placeholder: "e.g. Mileage",
  },
  deduction: {
    title: "Deductions",
    hint: "Taken out of net pay after tax, by agreement: rent, a staff purchase.",
    placeholder: "e.g. Rent",
  },
};

type Row = {
  name: string;
  units: number;
  rate: Cents;
  account?: string | undefined;
  category?: PayItem["category"];
  taxRate?: number | undefined;
};

function accountSelect(value: string | undefined, onSet: (code: string | undefined) => void): HTMLSelectElement {
  const select = document.createElement("select");
  select.title = "Account it posts to";
  const blank = document.createElement("option");
  blank.value = "";
  blank.textContent = "Post with wages";
  select.append(blank);
  for (const account of state.chart.filter((a) => a.code.trim() !== "")) {
    const option = document.createElement("option");
    option.value = account.code;
    option.textContent = `${account.code} ${account.name}`;
    option.selected = account.code === value;
    select.append(option);
  }
  select.addEventListener("change", () => onSet(select.value === "" ? undefined : select.value));
  return select;
}

/** An editable list of one kind of pay item. `onChange` gets the whole list each time. */
export function itemsEditor(
  kind: ItemKind,
  items: readonly (PayItem | PayDeduction)[],
  onChange: (items: (PayItem | PayDeduction)[]) => void,
): HTMLElement {
  const wrap = document.createElement("div");
  wrap.className = "payroll-items";
  const label = LABELS[kind];
  const title = document.createElement("strong");
  title.textContent = label.title;
  const hint = document.createElement("small");
  hint.textContent = ` ${label.hint}`;
  wrap.append(title, hint);

  const rows: Row[] = items.map((i) =>
    "units" in i
      ? { name: i.name, units: i.units, rate: i.rate, account: i.account, category: i.category, taxRate: i.taxRate }
      : { name: i.name, units: 1, rate: i.amount, account: i.account },
  );
  const emit = (): void => {
    onChange(
      rows
        .filter((r) => r.name.trim() !== "")
        .map((r) =>
          kind === "deduction"
            ? { name: r.name.trim(), amount: r.rate, ...(r.account ? { account: r.account } : {}) }
            : {
                name: r.name.trim(),
                units: r.units,
                rate: r.rate,
                ...(r.account ? { account: r.account } : {}),
                ...(r.category !== undefined && r.category !== "allowance" ? { category: r.category } : {}),
                ...(r.category === "withholding" && r.taxRate !== undefined ? { taxRate: r.taxRate } : {}),
              },
        ),
    );
  };

  const list = document.createElement("div");
  const draw = (): void => {
    list.textContent = "";
    rows.forEach((row, index) => {
      const line = document.createElement("div");
      line.className = "payroll-item-row";
      const name = document.createElement("input");
      name.type = "text";
      name.placeholder = label.placeholder;
      name.value = row.name;
      name.addEventListener("change", () => {
        row.name = name.value;
        emit();
      });
      line.append(name);
      if (kind === "allowance") {
        // The kind of earnings, as a payroll's earnings categories have it.
        const category = document.createElement("select");
        for (const [value, caption] of [
          ["allowance", "Ordinary earnings"],
          ["withholding", "Withholding income (WT): directors' fees, schedular"],
          ["acc-first-week", "ACC first week (80%)"],
        ] as const) {
          const option = document.createElement("option");
          option.value = value;
          option.textContent = caption;
          option.selected = (row.category ?? "allowance") === value;
          category.append(option);
        }
        category.addEventListener("change", () => {
          row.category = category.value as PayItem["category"];
          emit();
          draw();
        });
        line.append(category);
        if (row.category === "withholding") {
          const rate = document.createElement("input");
          rate.type = "number";
          rate.step = "1";
          rate.min = "10";
          rate.max = "100";
          rate.className = "payroll-tiny-input";
          rate.title = "Withholding rate, %: 33 unless the payee chose another on their IR330C";
          rate.value = String(Math.round((row.taxRate ?? 0.33) * 100));
          rate.addEventListener("change", () => {
            row.taxRate = (Number(rate.value) || 33) / 100;
            emit();
          });
          line.append(rate, "% ");
        }
      }
      if (kind !== "deduction") {
        const units = document.createElement("input");
        units.type = "number";
        units.step = "any";
        units.className = "payroll-tiny-input";
        units.value = String(row.units);
        units.title = "Quantity: units, hours or kilometres";
        units.addEventListener("change", () => {
          row.units = Number(units.value) || 0;
          emit();
        });
        line.append(units, " × ");
      }
      const rate = document.createElement("input");
      rate.type = "text";
      rate.className = "payroll-tiny-input";
      rate.placeholder = "0.00";
      rate.value = (row.rate / 100).toFixed(2);
      rate.title = kind === "deduction" ? "Amount" : row.category === "acc-first-week" ? "Rate per hour: leave 0.00 for 80% of the ordinary rate" : "Rate per unit";
      rate.addEventListener("change", () => {
        row.rate = (parseAmount(rate.value.trim()) ?? 0) as Cents;
        emit();
      });
      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "link-button";
      remove.textContent = "remove";
      remove.addEventListener("click", () => {
        rows.splice(index, 1);
        emit();
        draw();
      });
      line.append(
        rate,
        accountSelect(row.account, (code) => {
          row.account = code;
          emit();
        }),
        remove,
      );
      list.append(line);
    });
  };
  draw();
  const add = document.createElement("button");
  add.type = "button";
  add.className = "link-button";
  add.textContent = `+ Add ${kind}`;
  add.addEventListener("click", () => {
    rows.push({ name: "", units: 1, rate: 0 as Cents });
    draw();
  });
  wrap.append(list, add);
  return wrap;
}
