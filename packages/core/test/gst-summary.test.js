import assert from "node:assert/strict";
import test from "node:test";
import { identifyExport, isGstReturnSummary, parseGstReturnSummary } from "../dist/index.js";

// myIR's GST return summary, as the download comes out (figures invented).
const SUMMARY = [
  "Account ID:,123-456-789-GST001,,,,,,,",
  'Name:,"Example, Pat",,,,,,,',
  "From:,2025-03-31,,,,,,,",
  "To:,2025-09-30,,,,,,,",
  '"Disclaimer: This information is correct as at today.",,,,,,,,',
  "Period ending,Total sales,Zero-rated supplies,Debit adjustments,Total GST collected,Total expenses,Credit adjustments,Total GST paid,Payment / Refund",
  "2025-03-31,11500,0,0,1500,2300,0,300,1200",
  "2025-05-31,10000.00,0,0,1304.35,0,0,0,1304.35",
  "2025-07-31,2300,0,10,310,23000,5,3005,-2695",
].join("\r\n");

test("myIR's GST return summary is recognised", () => {
  assert.equal(isGstReturnSummary(SUMMARY), true);
  assert.equal(identifyExport(SUMMARY).kind, "gst-summary");
});

test("each period becomes a filed return, with every box", () => {
  const { returns, problems, account, name } = parseGstReturnSummary(SUMMARY);
  assert.deepEqual(problems, []);
  assert.equal(account, "123-456-789-GST001");
  assert.equal(name, "Example, Pat");
  assert.equal(returns.length, 3);
  const first = returns[0];
  assert.equal(first.periodEnd, "2025-03-31");
  assert.equal(first.boxes.box5, 1150000);
  assert.equal(first.boxes.box8, 150000);
  assert.equal(first.boxes.box12, 30000);
  assert.equal(first.boxes.box15, 120000);
  assert.equal(first.core, 120000);
  // Adjustments are taken out of Boxes 8 and 12, as the form adds them up.
  const third = returns[2];
  assert.equal(third.boxes.box9, 1000);
  assert.equal(third.boxes.box8, 30000);
  assert.equal(third.boxes.box13, 500);
  assert.equal(third.boxes.box12, 300000);
  assert.equal(third.boxes.box15, -269500);
});

test("each period starts the day after the one before, and the first by the spacing", () => {
  const { returns } = parseGstReturnSummary(SUMMARY);
  assert.equal(returns[0].periodStart, "2025-02-01");
  assert.equal(returns[1].periodStart, "2025-04-01");
  assert.equal(returns[2].periodStart, "2025-06-01");
});

test("a period whose figures do not add up is left out and said", () => {
  const broken = SUMMARY.replace("2025-05-31,10000.00,0,0,1304.35,0,0,0,1304.35", "2025-05-31,10000.00,0,0,1304.35,0,0,0,999");
  const { returns, problems } = parseGstReturnSummary(broken);
  assert.equal(returns.length, 2);
  assert.match(problems[0].message, /2025-05-31/);
});

test("each co-owner's return is kept with its registration, and a period's returns add together", async () => {
  const { filedByPeriod, filedKey } = await import("../dist/index.js");
  const alex = parseGstReturnSummary(SUMMARY).returns;
  const sam = parseGstReturnSummary(SUMMARY.replace("123-456-789-GST001", "987-654-321-GST001")).returns;
  assert.equal(alex[0].registration, "123-456-789-GST001");
  assert.notEqual(filedKey(alex[0]), filedKey(sam[0]));
  const both = filedByPeriod([...alex, ...sam]);
  assert.equal(both.length, alex.length);
  assert.equal(both[0].boxes.box5, 2 * alex[0].boxes.box5);
  assert.equal(both[0].core, 2 * alex[0].core);
  assert.match(both[0].status, /2 returns filed/);
});
