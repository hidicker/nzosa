import assert from "node:assert/strict";
import test from "node:test";
import { buildPayRun, noticeDeductions } from "../dist/index.js";

// An invented employee, paid weekly.
const worker = (notices) => ({
  id: "a", name: "Aroha Test", irdNumber: "49098576", taxCode: "M", payFrequency: "weekly",
  kiwiSaverRate: 0, kiwiSaverEmployerRate: 0, esctRate: 0, bankAccount: "", notices,
});
const pay = (notices, payDate = "2026-09-22", history = []) =>
  buildPayRun({
    id: "r", employerIrd: "49091850", periodStart: "2026-09-14", periodEnd: "2026-09-20", payDate,
    employees: [worker(notices)], inputs: [{ employeeId: "a", grossOverride: 100_000 }], history,
  });

test("a child support notice fills the pay's child support, protected as IR says", () => {
  const plain = pay([]).lines[0];
  const line = pay([{ id: "n1", kind: "child-support", reference: "CS-1", amount: 5_000, from: "2026-09-01" }]).lines[0];
  assert.equal(line.childSupport, 5_000);
  assert.equal(line.netPay, plain.netPay - 5_000);
  assert.equal(pay([{ id: "n1", kind: "child-support", reference: "CS-1", amount: 5_000, from: "2026-10-01" }]).lines[0].childSupport, 0, "not before it starts");
});

test("an IRD notice is a deduction after tax, to its account, until its total is taken", () => {
  const notice = { id: "n2", kind: "ird", reference: "DN-77", amount: 20_000, from: "2026-09-01", total: 30_000, account: "IRD deductions payable - 826" };
  const first = pay([notice]);
  const d = first.lines[0].deductions[0];
  assert.deepEqual([d.name, d.amount, d.notice, d.account], ["IRD deduction notice DN-77", 20_000, "n2", "IRD deductions payable - 826"]);
  const second = pay([notice], "2026-09-29", [first]);
  assert.equal(second.lines[0].deductions[0].amount, 10_000, "what is left of the total");
  const third = pay([notice], "2026-10-06", [first, second]);
  assert.equal(third.lines[0].deductions, undefined, "nothing once it is all taken");
});

test("a court's protected earnings are kept, and nothing below nothing", () => {
  const items = noticeDeductions(
    worker([
      { id: "n3", kind: "court-fine", reference: "CRN 123", rate: 0.5, from: "2026-01-01", protectedNet: 60_000 },
      { id: "n4", kind: "ird", reference: "DN-9", amount: 99_999, from: "2026-01-01" },
    ]),
    "2026-09-22",
    80_000,
    [],
  );
  assert.deepEqual(items.map((i) => [i.name, i.amount]), [["Court fine CRN 123", 20_000], ["IRD deduction notice DN-9", 60_000]]);
});
