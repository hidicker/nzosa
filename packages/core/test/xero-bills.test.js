import test from "node:test";
import assert from "node:assert/strict";
import { parseXeroInvoices } from "../dist/index.js";

// Xero's bills export, cut down: the columns the reader uses. Invented figures.
const HEAD = "ContactName,InvoiceNumber,Reference,InvoiceDate,DueDate,Total,TaxTotal,InvoiceAmountPaid,InvoiceAmountDue,Description,Quantity,LineAmount,AccountCode,TaxType,TaxAmount,Currency,Type,Status";
const row = (contact, number, date, total, tax, line, lineTax, code, type = "Bill") =>
  [contact, number, "", date, "", total, tax, total, "0", "x", "1", line, code, "15% GST on Expenses", lineTax, "NZD", type, "Paid"].join(",");

test("bills sharing a number are separate bills, and one with no number is kept", () => {
  // A supplier puts the same reference on every monthly bill.
  const text = [
    HEAD,
    row("Kowhai Power", "RPT445-1", "7/08/2026", "115.00", "15.00", "100.00", "15.00", "445"),
    row("Kowhai Power", "RPT445-1", "7/09/2026", "92.00", "12.00", "80.00", "12.00", "445"),
    // Every row of a bill repeats its total.
    row("Rimu Training", "", "2/09/2025", "345.00", "45.00", "200.00", "30.00", "412"),
    row("Rimu Training", "", "2/09/2025", "345.00", "45.00", "100.00", "15.00", "453"),
  ].join("\n");
  const { invoices, problems } = parseXeroInvoices(text);
  assert.deepEqual(
    invoices.map((i) => [i.kind, i.number, i.total, i.lines.length]),
    [
      ["purchase", "RPT445-1/2026-08-07", 11500, 1],
      ["purchase", "RPT445-1/2026-09-07", 9200, 1],
      ["purchase", "Rimu Training/2025-09-02", 34500, 2],
    ],
  );
  assert.deepEqual(problems, []);
});

test("an invoice number used once stays as it is", () => {
  const text = [HEAD, row("Totara Cafe", "INV-0001", "1/05/2026", "115.00", "15.00", "100.00", "15.00", "200", "Sales invoice")].join("\n");
  assert.deepEqual(parseXeroInvoices(text).invoices.map((i) => [i.kind, i.number]), [["sales", "INV-0001"]]);
});

test("a payment names a bill by the number the supplier wrote, not the date kept beside it", async () => {
  const { namesInvoice, xeroNumberOf } = await import("../dist/index.js");
  assert.equal(xeroNumberOf("RPT445-1/2026-09-17"), "RPT445-1");
  assert.equal(namesInvoice("Payment: PowerDirect RPT445-1", "RPT445-1/2026-09-17"), true);
  // A bill with no number is kept under its contact, which no payment names.
  assert.equal(namesInvoice("Payment: Rimu Training", "Rimu Training/2025-09-02"), false);
});

test("a bill with no number open at the start is found by contact and date", async () => {
  const { documentsInPlay } = await import("../dist/index.js");
  // Kept here as "Google/2024-08-20"; the aged payables names it "Google 2024-08-20".
  const bill = { number: "Google/2024-08-20", kind: "purchase", contact: "Google", reference: "", issued: "2024-08-20",
    due: null, total: 10000, tax: 1304, paid: 10000, outstanding: 0, currency: "NZD", status: "Paid", lines: [] };
  const inPlay = documentsInPlay([bill], "2025-04-01", [
    { asAt: "2025-03-31", kind: "purchase", source: "aged.xlsx", items: [{ number: "Google 2024-08-20", contact: "Google", date: "2024-08-20", due: null, owing: 10000 }] },
  ]);
  assert.deepEqual(inPlay.map((i) => [i.number, i.broughtForward]), [["Google/2024-08-20", 10000]]);
});
