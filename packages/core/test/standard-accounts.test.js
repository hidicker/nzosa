import test from "node:test";
import assert from "node:assert/strict";
import {
  accountKey,
  canonicalCodeFor,
  codeIn,
  isAccountCode,
  matchAccountName,
  resolveAccount,
  splitAccountLabel,
  standardAccounts,
  starterChart,
  suggestSuffix,
  suffixedCode,
} from "../dist/index.js";
import { rentalHeadingFor } from "../dist/rental-schedules.js";

test("a code may carry an entity's suffix, and is read whole", () => {
  assert.deepEqual(splitAccountLabel("Rates and water - 420MS"), { code: "420MS", name: "Rates and water" });
  assert.deepEqual(splitAccountLabel("420MS Rates and water"), { code: "420MS", name: "Rates and water" });
  assert.deepEqual(splitAccountLabel("Rates - 420"), { code: "420", name: "Rates" });
  assert.deepEqual(splitAccountLabel("420MS"), { code: "420MS", name: "420MS" });
  // A name straight after the digits is still a name, as before.
  assert.deepEqual(splitAccountLabel("420Mount"), { code: "420", name: "Mount" });
  assert.deepEqual(splitAccountLabel("Motor Vehicle >1K"), { code: "", name: "Motor Vehicle >1K" });
  assert.equal(codeIn("Rates - 420MS"), "420MS");
  assert.equal(codeIn("Rates - 420"), "420");
  assert.equal(isAccountCode("420MS"), true);
  assert.equal(isAccountCode("420ms"), false);
  assert.equal(isAccountCode("420ABCD"), false);
});

test("420MS is never taken for another entity's 420", () => {
  const chart = [
    { code: "420", name: "Rates", type: "Expense", taxCode: "No GST", description: "" },
    { code: "420MS", name: "Rates", type: "Expense", taxCode: "No GST", description: "" },
  ];
  assert.equal(resolveAccount("Rates - 420MS", chart)?.code, "420MS");
  assert.equal(resolveAccount("Rates - 420", chart)?.code, "420");
  assert.equal(accountKey("Rates - 420MS"), "420MS");
  const known = ["Rates - 420", "Rates - 420MS"];
  assert.equal(canonicalCodeFor("420", known), "Rates - 420");
  assert.equal(canonicalCodeFor("420MS", known), "Rates - 420MS");
  assert.equal(matchAccountName("420MS Rates", known), "Rates - 420MS");
});

test("a residential rental's accounts, suffixed, with no GST", () => {
  const set = standardAccounts("residential", { suffix: "MS", gstRegistered: false });
  const byName = Object.fromEntries(set.map((a) => [a.name, a]));
  assert.equal(byName["Rent received"].code, "200MS");
  assert.equal(byName["Rates and water"].code, "420MS");
  assert.ok(set.every((a) => a.taxCode === "No GST"));
  assert.ok(set.every((a) => /^\d{3}MS$/.test(a.code)));
  assert.equal(new Set(set.map((a) => a.code)).size, set.length);
  assert.equal(byName["GST"], undefined);
});

test("rental expenses land under the schedule's headings by name", () => {
  const heading = (name) =>
    rentalHeadingFor(standardAccounts("residential").find((a) => a.name === name).name);
  assert.equal(heading("Rates and water"), "rates");
  assert.equal(heading("Insurance"), "insurance");
  assert.equal(heading("Interest"), "interest");
  assert.equal(heading("Property management fees"), "agent");
  assert.equal(heading("Repairs and maintenance"), "repairs");
  assert.equal(heading("Legal fees"), "other");
  assert.equal(heading("Travel"), "other");
  const pm = standardAccounts("residential").find((a) => a.name === "Held by property manager");
  assert.equal(pm.type, "Current Asset");
});

test("a registered commercial rental charges and claims GST, and keeps interest out of it", () => {
  const set = standardAccounts("commercial", { gstRegistered: true });
  const tax = (name) => set.find((a) => a.name === name).taxCode;
  assert.equal(tax("Rent received"), "15% GST on Income");
  assert.equal(tax("Repairs and maintenance"), "15% GST on Expenses");
  assert.equal(tax("Interest"), "No GST");
  assert.ok(set.some((a) => a.name === "GST"));
  assert.ok(!standardAccounts("commercial", { gstRegistered: false }).some((a) => a.name === "GST"));
});

test("a person gets income, spending and income tax paid; a business the standard chart", () => {
  assert.deepEqual(
    standardAccounts("personal").map((a) => `${a.code} ${a.name}`),
    ["200 Personal income", "400 Personal spending", "830 Income tax paid"],
  );
  assert.equal(standardAccounts("business").length, starterChart().length);
  assert.ok(standardAccounts("business", { suffix: "AR" }).every((a) => a.code.endsWith("AR")));
});

test("a suffix comes from the name and is never one already taken", () => {
  assert.equal(suggestSuffix("Totara Street"), "TS");
  assert.equal(suggestSuffix("Ana & Tom joint"), "ATJ");
  assert.equal(suggestSuffix("Kowhai"), "KO");
  assert.equal(suggestSuffix("Totara Street", new Set(["TS"])), "TO");
  assert.equal(suffixedCode("420", "MS"), "420MS");
  assert.equal(suffixedCode("420AB", "MS"), "420AB");
  assert.equal(suffixedCode("", "MS"), "");
});

test("an account is never filed under another entity's account of the same name", async () => {
  const { labelForChartAccount, chartTreatments } = await import("../dist/index.js");
  const rimu = { code: "200RS", name: "Rent received", type: "Revenue", taxCode: "15% GST on Income", description: "" };
  const totara = { code: "200TS", name: "Rent received", type: "Revenue", taxCode: "No GST", description: "" };
  // Only the other rental's has been coded to, so only its label is known.
  const known = ["Rent received - 200TS"];
  assert.equal(labelForChartAccount(rimu, known), "Rent received - 200RS");
  const overrides = { t1: { code: "Rent received - 200TS", note: "", at: "2026-01-01" } };
  const map = chartTreatments([totara, rimu], undefined, overrides);
  assert.deepEqual(map.get("Rent received - 200RS"), { treatment: "standard", side: "sales" });
  assert.deepEqual(map.get("Rent received - 200TS"), { treatment: "out-of-scope", side: "none" });
  // A name with no code still finds its account.
  assert.equal(labelForChartAccount({ ...rimu, code: "" }, ["Rent received"]), "Rent received");
});
