import test from "node:test";
import assert from "node:assert/strict";
import { applySalesTax, postInvoice, salesTaxAt, salesTaxByRate, NOT_TAXABLE, TAXABLE } from "../dist/index.js";

const seattle = { id: "sea", name: "Seattle, WA", percent: 10.35, accountCode: "2200" };
const nyc = { id: "nyc", name: "New York City", percent: 8.875, accountCode: "2210" };
const line = (description, net, taxType = TAXABLE) => ({ description, accountCode: "4000", taxType, net, tax: 0, gross: net });

test("the tax on an amount, to the cent", () => {
  assert.equal(salesTaxAt(10000, 10.35), 1035);
  // 33.33 at 8.875% is 2.958 -- 2.96.
  assert.equal(salesTaxAt(3333, 8.875), 296);
  // Half a cent goes up: 2.00 at 6.25% is 0.125.
  assert.equal(salesTaxAt(200, 6.25), 13);
  assert.equal(salesTaxAt(-200, 6.25), -13);
});

test("worked out on the taxable lines together, and shared so the lines add up to it", () => {
  const lines = applySalesTax([line("Widget", 3333), line("Gadget", 3333), line("Gizmo", 3334), line("Labour", 5000, NOT_TAXABLE)], nyc);
  const tax = lines.reduce((s, l) => s + l.tax, 0);
  // 100.00 taxable at 8.875% is 8.88, shared over the three lines.
  assert.equal(tax, salesTaxAt(10000, 8.875));
  assert.equal(lines[3].tax, 0);
  assert.equal(lines[3].gross, 5000);
  assert.equal(lines[3].taxAccount, undefined);
  for (const one of lines.slice(0, 3)) {
    assert.equal(one.gross, one.net + one.tax);
    assert.equal(one.taxAccount, "2210");
  }
});

test("with no rate, nothing is added and nothing is owed", () => {
  const lines = applySalesTax([line("Widget", 1000)], null);
  assert.equal(lines[0].tax, 0);
  assert.equal(lines[0].gross, 1000);
  assert.equal(lines[0].taxAccount, undefined);
});

test("the tax posts to the rate's own account, the sale to sales, the whole to receivables", () => {
  const lines = applySalesTax([line("Widget", 10000), line("Delivery", 1500, NOT_TAXABLE)], seattle);
  const invoice = {
    number: "1001", kind: "sales", contact: "Pike Cafe", reference: "", issued: "2026-03-02", due: null,
    total: lines.reduce((s, l) => s + l.gross, 0), tax: lines.reduce((s, l) => s + l.tax, 0),
    paid: 0, outstanding: 0, currency: "USD", status: "Awaiting Payment", lines, salesTaxRateId: "sea",
  };
  const posted = postInvoice(invoice, { receivableCode: "1100" });
  const at = (code) => posted.lines.filter((l) => l.accountCode === code).reduce((s, l) => s + l.amount, 0);
  assert.equal(at("1100"), 12535);
  assert.equal(at("4000"), -11500);
  assert.equal(at("2200"), -1035);
  assert.equal(posted.lines.reduce((s, l) => s + l.amount, 0), 0);
});

test("sales by rate, as a state's return asks for them", () => {
  const make = (number, rate, lines, status = "Awaiting Payment") => {
    const taxed = applySalesTax(lines, rate);
    return {
      number, kind: "sales", contact: "", reference: "", issued: "2026-04-01", due: null,
      total: 0, tax: 0, paid: 0, outstanding: 0, currency: "USD", status, lines: taxed,
      ...(rate === null ? {} : { salesTaxRateId: rate.id }),
    };
  };
  const rows = salesTaxByRate(
    [
      make("1", seattle, [line("A", 10000), line("B", 2000, NOT_TAXABLE)]),
      make("2", seattle, [line("C", 5000)]),
      make("3", null, [line("D", 7000)]),
      make("4", seattle, [line("E", 9900)], "Draft"),
    ],
    [seattle, nyc],
    "2026-01-01",
    "2026-12-31",
  );
  assert.equal(rows.length, 2);
  const sea = rows.find((r) => r.rate?.id === "sea");
  assert.deepEqual([sea.invoices, sea.sales, sea.taxable, sea.tax], [2, 17000, 15000, 1035 + 518]);
  assert.equal(rows.find((r) => r.rate === null).sales, 7000);
});

test("the printed invoice adds the sales tax under a subtotal, not into each line", async () => {
  const { invoiceDocument } = await import("../dist/index.js");
  const lines = applySalesTax([line("Widget", 10000), line("Delivery", 1500, NOT_TAXABLE)], seattle);
  const invoice = {
    number: "1001", kind: "sales", contact: "Pike Cafe", reference: "", issued: "2026-03-02", due: null,
    total: 12535, tax: 1035, paid: 0, outstanding: 12535, currency: "USD", status: "Awaiting Payment", lines,
  };
  const html = invoiceDocument(invoice, { name: "Harbour Lane Bakery" }, { noTax: true, salesTaxLabel: "Sales tax (Seattle, WA 10.35%)" });
  assert.match(html, /Subtotal<\/td><td class="n">115\.00/);
  assert.match(html, /Sales tax \(Seattle, WA 10\.35%\)<\/td><td class="n">10\.35/);
  assert.doesNotMatch(html, /110\.35/);
  assert.match(html, /Total due<\/td><td class="n">125\.35/);
  // With no sales tax on it, the plain invoice is as it was.
  const plain = invoiceDocument({ ...invoice, tax: 0, total: 11500, lines: applySalesTax(lines, null) }, { name: "X" }, { noTax: true });
  assert.doesNotMatch(plain, /Subtotal/);
});
