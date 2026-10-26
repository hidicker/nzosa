import { test } from "node:test";
import assert from "node:assert/strict";
import { attachmentProblem, attachmentsOf, documentOwner, moveAttachments, newAttachmentId, sizeWords } from "../dist/index.js";

const a = (id, owner, added) => ({ id, owner, name: `${id}.pdf`, type: "application/pdf", size: 1000, added });
const bill = documentOwner("purchase", "BILL-1");
const sale = documentOwner("sales", "BILL-1");

test("a document's files, kept apart from another kind's of the same number", () => {
  const all = [a("att-2", bill, "2026-10-02"), a("att-1", bill, "2026-10-01"), a("att-3", sale, "2026-10-01"), a("att-4", { kind: "contact", id: "c1" }, "2026-10-01")];
  assert.deepEqual(attachmentsOf(all, bill).map((x) => x.id), ["att-1", "att-2"]);
  assert.deepEqual(attachmentsOf(all, sale).map((x) => x.id), ["att-3"]);
  assert.deepEqual(attachmentsOf(undefined, bill), []);
});

test("what can be attached", () => {
  assert.equal(attachmentProblem({ name: "bill.pdf", size: 200_000 }), null);
  assert.match(attachmentProblem({ name: "scan.tif", size: 11 * 1024 * 1024 }), /11\.0 MB.*10 MB or less/);
  assert.match(attachmentProblem({ name: "x.txt", size: 0 }), /empty/);
  assert.equal(sizeWords(512), "512 bytes");
  assert.equal(sizeWords(2048), "2 KB");
});

test("ids are safe file names, and files follow a renumbered document", () => {
  assert.match(newAttachmentId(), /^att-[0-9a-f]{16}$/);
  assert.notEqual(newAttachmentId(), newAttachmentId());
  const moved = moveAttachments([a("att-1", bill, "x"), a("att-3", sale, "x")], bill, documentOwner("purchase", "BILL-9"));
  assert.deepEqual(moved.map((x) => x.owner.id), ["purchase:BILL-9", "sales:BILL-1"]);
});
