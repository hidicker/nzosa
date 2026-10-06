import assert from "node:assert/strict";
import test from "node:test";
import { parseXeroAllocations } from "../dist/invoices.js";

// The ungrouped Account Transactions export: no section headings, an Account
// column instead, and each payment written twice.
const HEADER =
  "Date,Source,Contact,Contact Group,Description,Invoice Number,Reference," +
  "Debit,Credit,Gross,Net,GST,GST Rate,GST Rate Name,Account Code,Account,Account Type,Related account";

const rows = (...lines) => [HEADER, ...lines].join("\r\n");

test("a payment is read from its bank side, which names the invoice", () => {
  const csv = rows(
    "01/09/2024,Receivable Payment,Ana Rewi,,,,PG1,0,500.00,,,0,0,,610,Accounts Receivable,Current Asset,",
    "01/09/2024,Receivable Payment,Ana Rewi,,,,INV-9001,500.00,0,,,0,0,,,BNZ 01 - Trading,Asset,",
  );
  const { allocations, problems } = parseXeroAllocations(csv);

  assert.deepEqual(problems, []);
  assert.equal(allocations.length, 1, "one payment, not two");
  assert.equal(allocations[0].invoiceNumber, "INV-9001");
  assert.equal(allocations[0].amount, 50000);
  assert.equal(allocations[0].date, "2024-09-01");
  assert.equal(allocations[0].contact, "Ana Rewi");
});

test("a payment taken through Stripe is resolved by its charge id", () => {
  // The payment names the charge, not the invoice. A sibling row bearing the
  // same charge carries the invoice number.
  const csv = rows(
    "05/10/2024,Receive Money,A Customer,,,INV-0107,ch_3Q7085,350.00,0,,,0,0,,,BNZ 01 - Trading,Asset,",
    "05/10/2024,Receivable Payment,A Customer,,,,ch_3Q7085,350.00,0,,,0,0,,,BNZ 01 - Trading,Asset,",
    "05/10/2024,Receivable Payment,A Customer,,,,ch_3Q7085,0,350.00,,,0,0,,610,Accounts Receivable,Current Asset,",
  );
  const { allocations, problems } = parseXeroAllocations(csv);

  assert.deepEqual(problems, []);
  assert.equal(allocations.length, 1);
  assert.equal(allocations[0].invoiceNumber, "INV-0107");
  assert.equal(allocations[0].amount, 35000);
});

test("a payment whose invoice cannot be identified is reported, not invented", () => {
  const csv = rows(
    "05/10/2024,Receivable Payment,A Customer,,,,ch_unknown,350.00,0,,,0,0,,,BNZ 01 - Trading,Asset,",
  );
  const { allocations, problems } = parseXeroAllocations(csv);
  assert.equal(allocations.length, 0);
  assert.equal(problems.length, 1);
  assert.match(problems[0].message, /could not be identified/);
});

test("the grouped export still reads the way it always did", () => {
  // Sections instead of an Account column, and the receivable side names the
  // invoice. Told apart by the columns, not by asking.
  const csv = [
    "Date,Source,Contact,Reference,Debit,Credit",
    "Accounts Receivable",
    "01/09/2024,Receivable Payment,Ana Rewi,INV-9001,0,500.00",
  ].join("\r\n");
  const { allocations } = parseXeroAllocations(csv);
  assert.equal(allocations.length, 1);
  assert.equal(allocations[0].invoiceNumber, "INV-9001");
  assert.equal(allocations[0].amount, 50000);
});
