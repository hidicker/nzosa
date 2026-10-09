import assert from "node:assert/strict";
import test from "node:test";
import { nonProfitDefaults, nonProfitFormName, nonProfitNotes, nonProfitReporting, standardAccounts } from "../dist/index.js";

test("a charity and a charitable trust start as registered charities; a society and a club do not", () => {
  assert.equal(nonProfitDefaults("charity").registeredCharity, true);
  assert.equal(nonProfitDefaults("charitable-trust").registeredCharity, true);
  assert.equal(nonProfitDefaults("society").registeredCharity, undefined);
  assert.equal(nonProfitDefaults("club").registeredCharity, undefined);
  assert.equal(nonProfitFormName("society"), "Incorporated society");
});

test("what is filed depends on the facts, not only the form", () => {
  const charity = nonProfitReporting({ form: "charity", registeredCharity: true }).join(" ");
  assert.match(charity, /Charities Services/);
  assert.match(charity, /\$140,000/);
  const society = nonProfitReporting({ form: "society" }).join(" ");
  assert.match(society, /Companies Office/);
  assert.match(society, /\$50,000/);
  assert.match(society, /IR9/);
  // A society that is also a registered charity reports as a charity, and files no IR9.
  const both = nonProfitReporting({ form: "society", registeredCharity: true }).join(" ");
  assert.match(both, /Charities Services/);
  assert.doesNotMatch(both, /Companies Office|IR9/);
});

test("notes: donee without charity, the receipt number, the deduction, and GST", () => {
  const donee = nonProfitNotes({ form: "club", donee: true }, false).join(" ");
  assert.match(donee, /registered charity/);
  const receipt = nonProfitNotes({ form: "charity", registeredCharity: true, donee: true }, false).join(" ");
  assert.match(receipt, /registration number/);
  const withNumber = nonProfitNotes({ form: "charity", registeredCharity: true, donee: true, charityNumber: "CC12345" }, false).join(" ");
  assert.doesNotMatch(withNumber, /registration number/);
  assert.match(withNumber, /IRD number/, "a donee also needs its IRD number on receipts");
  const complete = nonProfitNotes({ form: "charity", registeredCharity: true, donee: true, charityNumber: "CC12345", irdNumber: "123-456-789" }, false).join(" ");
  assert.doesNotMatch(complete, /enter it above/);
  assert.match(nonProfitNotes({ form: "club" }, false).join(" "), /\$1,000 deduction/);
  assert.doesNotMatch(nonProfitNotes({ form: "club", deduction: true }, false).join(" "), /can claim a \$1,000/);
  assert.match(nonProfitNotes({ form: "charity" }, true).join(" "), /sponsorship and subscriptions are/);
  assert.match(nonProfitNotes({ form: "charity" }, false).join(" "), /\$60,000/);
});

test("the starter chart: donations carry no GST, grants and subscriptions do, donated goods are exempt", () => {
  const registered = standardAccounts("nonprofit", { gstRegistered: true });
  const by = (name) => registered.find((a) => a.name === name);
  assert.equal(by("Donations").taxCode, "No GST");
  assert.equal(by("Grants").taxCode, "15% GST on Income");
  assert.equal(by("Subscriptions").taxCode, "15% GST on Income");
  assert.equal(by("Sales of donated goods").taxCode, "No GST");
  assert.equal(by("Grants and donations paid").taxCode, "No GST");
  assert.equal(by("Grants received in advance").type, "Current Liability");
  assert.ok(by("GST"));
  const codes = registered.map((a) => a.code);
  assert.equal(new Set(codes).size, codes.length, "no code used twice");
});

test("not registered for GST: no GST account, and no GST on anything", () => {
  const plain = standardAccounts("nonprofit", { gstRegistered: false });
  assert.equal(plain.find((a) => a.name === "GST"), undefined);
  assert.ok(plain.every((a) => a.taxCode === "No GST"));
  assert.ok(plain.find((a) => a.name === "Accumulated funds"));
});

test("two entities in one books keep their own codes", () => {
  const club = standardAccounts("nonprofit", { suffix: "CL" });
  assert.ok(club.every((a) => /^\d{3}CL$/.test(a.code)));
});

test("the AI is told a non-profit has no drawings and spends for its purposes", async () => {
  const { instructions } = await import("../dist/index.js");
  const text = instructions({
    about: "",
    entities: [{ name: "Kowhai Tennis Club", kind: "nonprofit", gstRegistered: false, about: "" }],
    accounts: [],
  });
  assert.match(text, /a not-for-profit/);
  assert.match(text, /never drawings/);
});
