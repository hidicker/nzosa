import assert from "node:assert/strict";
import test from "node:test";
import { filedReturnFromBoxes, filedReturnFromOurs, gstBoxesFrom } from "../dist/index.js";

test("the boxes a person types give every box of the return", () => {
  const boxes = gstBoxesFrom({ box5: 1_150_000, box6: 0, box9: 0, box11: 460_000, box13: 0 });
  assert.deepEqual(boxes, {
    box5: 1_150_000, box6: 0, box7: 1_150_000, box8: 150_000, box9: 0, box10: 150_000,
    box11: 460_000, box12: 60_000, box13: 0, box14: 60_000, box15: 90_000,
  });
});

test("zero-rated sales, adjustments and a refund", () => {
  const boxes = gstBoxesFrom({ box5: 2_300_000, box6: 300_000, box9: 1_000, box11: 3_450_000, box13: 500 });
  assert.equal(boxes.box7, 2_000_000);
  assert.equal(boxes.box8, 260_870, "three twenty-thirds, to the cent");
  assert.equal(boxes.box10, 261_870);
  assert.equal(boxes.box12, 450_000);
  assert.equal(boxes.box14, 450_500);
  assert.equal(boxes.box15, -188_630, "negative is a refund");
});

test("Box 8 and Box 12 as filed are kept, rounding and all", () => {
  const boxes = gstBoxesFrom({ box5: 2_000_000, box6: 0, box9: 0, box11: 0, box13: 0, box8: 260_869 });
  assert.equal(boxes.box8, 260_869);
  assert.equal(boxes.box15, 260_869);
});

test("a filed return carries Box 8 less Box 12 as the figure it is compared on", () => {
  const filed = filedReturnFromBoxes({
    periodStart: "2025-04-01", periodEnd: "2025-05-31", basis: "Payments basis", status: "Filed",
    boxes: gstBoxesFrom({ box5: 1_150_000, box6: 0, box9: 5_000, box11: 460_000, box13: 0 }),
  });
  assert.equal(filed.core, 90_000, "Box 9 is not part of it");
  assert.deepEqual(filed.lines, []);
});

test("the books' own return can be recorded as the one filed", () => {
  const ours = {
    period: { from: "2025-06-01", to: "2025-07-31", label: "2025-07", due: "2025-08-28" },
    basis: "payments",
    sharePercent: 100,
    boxes: {
      box5: 575_000, box6: 0, box7: 575_000, box8: 75_000, box9: 0, box10: 75_000,
      box11: 230_000, box12: 30_000, box13: 0, box14: 30_000, box15: 45_000, outcome: "pay",
    },
    lines: [], excluded: [], lateClaims: [], missingTaxPoint: [],
  };
  const filed = filedReturnFromOurs(ours);
  assert.equal(filed.periodEnd, "2025-07-31");
  assert.equal(filed.periodStart, "2025-06-01");
  assert.equal(filed.basis, "Payments basis");
  assert.equal(filed.status, "Filed from these books");
  assert.equal(filed.boxes.box15, 45_000);
  assert.equal(filed.core, 45_000);

  // A refund is carried as a size with its direction beside it; filed, it is negative.
  const refund = filedReturnFromOurs({
    ...ours,
    boxes: { ...ours.boxes, box8: 30_000, box10: 30_000, box12: 75_000, box14: 75_000, box15: 45_000, outcome: "refund" },
  });
  assert.equal(refund.boxes.box15, -45_000);
  assert.equal(refund.core, -45_000);
});
