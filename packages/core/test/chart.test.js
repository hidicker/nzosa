import assert from "node:assert/strict";
import test from "node:test";
test("which ledger account a chart's bank row is survives a round trip", async () => {
  const { parseChartOfAccounts, formatChartOfAccounts } = await import("../dist/chart.js");
  const accounts = [
    { code: "", name: "Platinum Card for Business", type: "Bank", taxCode: "No GST",
      description: "", ledgerAccount: "visa-platinum-4003" },
    { code: "", name: "An Old Account", type: "Bank", taxCode: "No GST", description: "",
      ledgerAccount: "none" },
    { code: "400", name: "Advertising", type: "Expense", taxCode: "15% GST on Expenses",
      description: "" },
  ];
  const back = parseChartOfAccounts(formatChartOfAccounts(accounts)).accounts;
  // The same card under two names is one card, and only a person can say so.
  // Losing that on the way through the file would ask them again every time.
  assert.equal(back[0]?.ledgerAccount, "visa-platinum-4003");
  // "Not in this ledger" is an answer, and has to survive as one: dropped, it
  // would read as never having been asked.
  assert.equal(back[1]?.ledgerAccount, "none");
  // An account that is not a bank account carries none of this.
  assert.equal(back[2]?.ledgerAccount, undefined);
});
