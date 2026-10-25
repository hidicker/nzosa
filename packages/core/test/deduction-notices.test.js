import { test } from "node:test";
import assert from "node:assert/strict";
import { buildPayRun, noticesForPay } from "../dist/index.js";

const base = {
  id: "e", name: "Mere Test", irdNumber: "048125360", taxCode: "M", payFrequency: "weekly",
  kiwiSaverRate: 0, kiwiSaverEmployerRate: 0, esctRate: 0, bankAccount: "", annualSalary: 6_500_000,
};
const run = (payDate, employee, history = [], inputs = [{ employeeId: "e" }]) =>
  buildPayRun({ id: payDate, employerIrd: "49091850", periodStart: payDate, periodEnd: payDate, payDate, employees: [employee], inputs, history });

test("a fines order is taken every pay until what is owed has gone, the last pay taking the rest", () => {
  const employee = { ...base, notices: [{ id: "f", kind: "court-fines", payTo: "Ministry of Justice", reference: "AO-551", amount: 5_000, owing: 12_000 }] };
  const first = run("2026-10-01", employee);
  const second = run("2026-10-08", employee, [first]);
  const third = run("2026-10-15", employee, [first, second]);
  const fourth = run("2026-10-22", employee, [first, second, third]);
  assert.deepEqual([first, second, third, fourth].map((r) => r.lines[0].notices ?? []), [
    [{ id: "f", amount: 5_000 }],
    [{ id: "f", amount: 5_000 }],
    [{ id: "f", amount: 2_000 }],
    [],
  ]);
  assert.deepEqual(first.lines[0].deductions, [{ name: "Fines attachment order AO-551", amount: 5_000 }]);
  const plain = run("2026-10-01", base);
  assert.equal(first.lines[0].netPay, plain.lines[0].netPay - 5_000);
});

test("child support from a notice is reported as child support, and a typed amount still wins", () => {
  const employee = { ...base, notices: [{ id: "c", kind: "child-support", payTo: "Inland Revenue", reference: "CS1", amount: 4_000 }] };
  const r = run("2026-10-01", employee);
  assert.equal(r.lines[0].childSupport, 4_000);
  assert.deepEqual(r.lines[0].notices, [{ id: "c", amount: 4_000 }]);
  assert.equal(r.lines[0].deductions, undefined);
  const typed = run("2026-10-01", employee, [], [{ employeeId: "e", childSupport: 1_000 }]);
  assert.equal(typed.lines[0].childSupport, 1_000);
  assert.equal(typed.lines[0].notices, undefined, "a typed amount is nobody's notice");
});

test("a notice applies only between its dates", () => {
  const employee = { ...base, notices: [{ id: "i", kind: "ird", payTo: "Inland Revenue", reference: "", amount: 2_500, from: "2026-11-01", until: "2026-11-30" }] };
  assert.deepEqual(noticesForPay(employee, "2026-10-25", []).deductions, []);
  assert.equal(noticesForPay(employee, "2026-11-05", []).deductions[0].amount, 2_500);
  assert.deepEqual(noticesForPay(employee, "2026-12-01", []).deductions, []);
});
