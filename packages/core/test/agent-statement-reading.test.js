import test from "node:test";
import assert from "node:assert/strict";
import { agentStatementPrompt, propertyForAddress, readAgentStatements } from "../dist/index.js";

// Harbour Rentals's year-end summary for 12A Kowhai Avenue, FY2026, as read.
const rentShop = {
  agent: "Harbour Rentals Ltd",
  statements: [
    {
      property: "12A ZZ Kowhai Avenue, Ridgeview, Auckland",
      from: "2025-04-01",
      to: "2025-12-31",
      openingBalance: 0,
      income: [
        { kind: "rent", description: "Rent", amount: 30020 },
        { kind: "reimbursement", description: "Tenant reimbursements", amount: "427.51" },
      ],
      expenses: [
        { kind: "management", description: "Management Fees", amount: 2371.58 },
        { kind: "management", description: "Inspection Fees", amount: 80 },
        { kind: "management", description: "Monthly Admin Fee", amount: 207 },
        { kind: "gst", description: "GST", amount: 398.73 },
        { kind: "repairs", description: "Bathroom Renovations", amount: "$224.25" },
      ],
      paidToOwner: 27165.95,
      closingBalance: 0,
    },
  ],
};

test("the prompt names every kind and the balance it must keep", () => {
  const prompt = agentStatementPrompt();
  for (const kind of ["rent", "reimbursement", "management", "gst", "repairs"]) assert.match(prompt, new RegExp(`"${kind}"`));
  assert.match(prompt, /openingBalance \+ income - expenses - paidToOwner = closingBalance/);
});

test("a statement that adds up is read with each line's account", () => {
  const { statements, problems } = readAgentStatements("Here you go:\n" + JSON.stringify(rentShop));
  assert.deepEqual(problems, []);
  const [one] = statements;
  assert.equal(one.agent, "Harbour Rentals Ltd");
  assert.equal(one.difference, 0);
  assert.equal(one.paidToOwner, 2_716_595);
  assert.deepEqual(one.income.map((l) => [l.amount, l.base]), [[3_002_000, "200"], [42_751, "200"]]);
  assert.deepEqual(one.expenses.map((l) => l.base), ["450", "450", "450", "450", "473"]);
  assert.equal(one.expenses[4].amount, 22_425);
});

test("one that does not add up is still returned, with its difference and a problem", () => {
  const off = structuredClone(rentShop);
  off.statements[0].paidToOwner = 27000;
  const { statements, problems } = readAgentStatements(JSON.stringify(off));
  assert.equal(statements.length, 1);
  assert.equal(statements[0].difference, -16_595);
  assert.match(problems[0], /does not add up/);
});

test("unknown kinds go to other; unreadable answers say so", () => {
  const odd = structuredClone(rentShop);
  odd.statements[0].expenses.push({ kind: "smoke alarms", description: "Smoke alarm check", amount: 0 });
  odd.statements[0].expenses[4].kind = "renovation";
  const { statements } = readAgentStatements(JSON.stringify(odd));
  assert.equal(statements[0].expenses[4].base, "429");
  assert.equal(statements[0].expenses.length, 5); // the zero line is dropped
  assert.match(readAgentStatements("no idea").problems[0], /no JSON/);
  assert.match(readAgentStatements("{oops}").problems[0], /not valid JSON/);
});

test("the address finds the rental by a shared word, and only when one matches", () => {
  const rentals = [
    { id: "fa", name: "Kowhai Avenue" },
    { id: "ls", name: "Totara Street" },
    { id: "ms", name: "Matai Street" },
  ];
  assert.equal(propertyForAddress("12A ZZ Kowhai Avenue, Ridgeview", rentals)?.id, "fa");
  assert.equal(propertyForAddress("1 Totara St, Somewhere", rentals)?.id, "ls");
  assert.equal(propertyForAddress("12 Queen Street", rentals), null);
});
