import { test } from "node:test";
import assert from "node:assert/strict";
import { accountKeyOf, recodeElsewhere } from "../dist/index.js";

const from = { code: "404", name: "Bank Fees" };
const to = { code: "405", name: "Bank Charges" };

function stores() {
  return {
    invoices: [
      {
        number: "BILL-1", kind: "purchase", contact: "ANZ", reference: "", issued: "2026-05-01", due: null, total: 1_000, paid: 1_000, outstanding: 0,
        lines: [
          { description: "Fee", accountCode: "404", taxType: "No GST", net: 1_000, tax: 0, gross: 1_000 },
          { description: "Other", accountCode: "4040", taxType: "No GST", net: 0, tax: 0, gross: 0 },
        ],
        paidOutside: [{ date: "2026-05-02", amount: 1_000, accountCode: "Bank Fees - 404" }],
      },
      { number: "INV-1", kind: "sales", contact: "X", reference: "", issued: "2026-05-01", due: null, total: 1, paid: 0, outstanding: 1, lines: [{ description: "x", accountCode: "200", taxType: "", net: 1, tax: 0, gross: 1 }] },
    ],
    recurring: [{ id: "r1", lines: [{ description: "Fee", accountCode: "404", taxType: "No GST", net: 500, tax: 0, gross: 500 }] }],
    items: [{ id: "i1", name: "Fee", accountCode: "404" }, { id: "i2", name: "Coffee", accountCode: "200" }],
    contacts: [{ id: "c1", name: "ANZ", kind: "vendor", defaultAccount: "404" }],
    openingBalances: { asAt: "2026-03-31", accounts: { "404": 1_500, "405": 500, "200": -9_000 }, byDate: { "2025-03-31": { "404": 700 } } },
    budgets: { "2027": { "404": 12_000, "405": 3_000 }, "2026": { "200": 1 } },
    vehicleUse: [{ id: "v1", accounts: ["404", "449"], counterCode: "404" }],
    prepayments: [{ id: "p1", accountCode: "404" }],
    payroll: {
      accounts: { wages: "477", wagesPayable: "404" },
      employees: [{ id: "e1", allowances: [{ name: "Tools", account: "404" }], deductions: [{ name: "Rent", account: "200" }] }],
      payRuns: [{ id: "run1", lines: [{ employeeId: "e1", allowances: [{ name: "Tools", account: "404" }] }] }],
    },
  };
}

test("a new code reaches every store that keeps codes, and nothing else", () => {
  const start = stores();
  const { stores: after, moved } = recodeElsewhere(start, from, to);
  assert.deepEqual(after.invoices[0].lines.map((l) => l.accountCode), ["405", "4040"], "4040 is another account");
  assert.equal(after.invoices[0].paidOutside[0].accountCode, "405", "a label kept as a code is found too");
  assert.equal(after.invoices[1], start.invoices[1], "an untouched document is the same object");
  assert.equal(after.recurring[0].lines[0].accountCode, "405");
  assert.deepEqual(after.items.map((i) => i.accountCode), ["405", "200"]);
  assert.equal(after.contacts[0].defaultAccount, "405");
  assert.deepEqual(after.vehicleUse[0], { id: "v1", accounts: ["405", "449"], counterCode: "405" });
  assert.equal(after.prepayments[0].accountCode, "405");
  assert.deepEqual(after.payroll.accounts, { wages: "477", wagesPayable: "405" });
  assert.equal(after.payroll.employees[0].allowances[0].account, "405");
  assert.equal(after.payroll.employees[0].deductions[0].account, "200");
  assert.equal(after.payroll.payRuns[0].lines[0].allowances[0].account, "405");
  assert.ok(moved >= 12);
  // Given in, unchanged.
  assert.equal(start.invoices[0].lines[0].accountCode, "404");
  assert.equal(start.openingBalances.accounts["404"], 1_500);
});

test("amounts kept by account are added together, as a merge makes the two one", () => {
  const { stores: after } = recodeElsewhere(stores(), from, to);
  assert.deepEqual(after.openingBalances.accounts, { "405": 2_000, "200": -9_000 });
  assert.deepEqual(after.openingBalances.byDate, { "2025-03-31": { "405": 700 } });
  assert.deepEqual(after.budgets, { "2027": { "405": 15_000 }, "2026": { "200": 1 } });
});

test("a new name with the same code moves nothing", () => {
  const start = stores();
  const { stores: after, moved } = recodeElsewhere(start, from, { code: "404", name: "Bank Charges" });
  assert.equal(moved, 0);
  assert.equal(after, start);
});

test("an account with no code is kept by its name", () => {
  assert.equal(accountKeyOf({ code: "", name: "Petty cash" }), "Petty cash");
  const { stores: after } = recodeElsewhere({ items: [{ id: "i", name: "x", accountCode: "Petty cash" }] }, { code: "", name: "Petty cash" }, { code: "091", name: "Petty cash" });
  assert.equal(after.items[0].accountCode, "091");
});
