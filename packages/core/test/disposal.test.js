import assert from "node:assert/strict";
import test from "node:test";
import { disposalOf, postDisposal } from "../dist/index.js";

const ACCOUNTS = {
  assetCode: "730",
  assetName: "Paragliding Equipment",
  accumulatedCode: "731",
  accumulatedName: "Less Accumulated Depreciation on Paragliding Equipment",
};

const sum = (journal) => journal.lines.reduce((total, l) => total + l.amount, 0);
const at = (journal, code, sign) =>
  journal.lines
    .filter((l) => l.accountCode === code && (sign === undefined || Math.sign(l.amount) === sign))
    .reduce((total, l) => total + l.amount, 0);

test("sold above cost: all the depreciation comes back, and the rest is capital", () => {
  // FA-0036 Sup Air Eona, disposed 18 Dec 2025. Cost 869.57, depreciation
  // claimed to the previous year end 339.86, sold for 1,130.43 excluding GST.
  const d = disposalOf({ cost: 86957, accumulatedDepreciation: 33986, proceeds: 113043 });
  assert.equal(d.bookValue, 52971);
  assert.equal(d.depreciationRecovered, 33986, "all of it, capped at what was claimed");
  assert.equal(d.capitalGain, 26086, "1,130.43 less the 869.57 it cost");
  assert.equal(d.lossOnSale, 0);
  // The two together are the whole profit over book value.
  assert.equal(d.depreciationRecovered + d.capitalGain, d.proceeds - d.bookValue);
});

test("sold below cost but above book value: recovery only, no capital gain", () => {
  const d = disposalOf({ cost: 86957, accumulatedDepreciation: 33986, proceeds: 70000 });
  assert.equal(d.depreciationRecovered, 70000 - 52971, "just the part above book value");
  assert.equal(d.capitalGain, 0, "it did not sell for more than it cost");
  assert.equal(d.lossOnSale, 0);
});

test("sold below book value: a deductible loss and nothing recovered", () => {
  // FA-0021 Ozone Alpina, disposed 28 Jul 2025. Cost 2,608.70, depreciation
  // 1,165.22, sold for 1,399.56.
  const d = disposalOf({ cost: 260870, accumulatedDepreciation: 116522, proceeds: 139956 });
  assert.equal(d.bookValue, 144348);
  assert.equal(d.lossOnSale, 4392, "1,443.48 less 1,399.56");
  assert.equal(d.depreciationRecovered, 0);
  assert.equal(d.capitalGain, 0);
});

test("scrapped for nothing: the whole book value is the loss", () => {
  const d = disposalOf({ cost: 86957, accumulatedDepreciation: 33986, proceeds: 0 });
  assert.equal(d.lossOnSale, 52971);
  assert.equal(d.depreciationRecovered, 0);
});

test("fully depreciated and then sold: every dollar is recovery up to cost", () => {
  const d = disposalOf({ cost: 100000, accumulatedDepreciation: 100000, proceeds: 40000 });
  assert.equal(d.bookValue, 0);
  assert.equal(d.depreciationRecovered, 40000, "capped by the sale, not by the depreciation");
  assert.equal(d.capitalGain, 0);
  assert.equal(d.lossOnSale, 0);
});

test("recovery never exceeds the depreciation actually claimed", () => {
  // Sold for far more than cost. Recovery is capped at what was claimed, and
  // everything above cost is capital. Uncapped it would claw back depreciation
  // nobody ever took.
  const d = disposalOf({ cost: 100000, accumulatedDepreciation: 20000, proceeds: 500000 });
  assert.equal(d.depreciationRecovered, 20000);
  assert.equal(d.capitalGain, 400000);
  assert.equal(d.depreciationRecovered + d.capitalGain, d.proceeds - d.bookValue);
});

test("the journal reproduces the one the accounting system posted", () => {
  // Xero journal 3389, "Disposal of asset FA-0036 on 18 Dec 2025".
  const d = disposalOf({ cost: 86957, accumulatedDepreciation: 33986, proceeds: 113043 });
  const journal = postDisposal(
    { assetNumber: "FA-0036", assetName: "Sup Air Eona (paraglider)", date: "2025-12-18", disposal: d },
    ACCOUNTS,
  );
  assert.equal(sum(journal), 0, "it balances");
  assert.equal(at(journal, "731"), 33986, "depreciation claimed, cleared");
  assert.equal(at(journal, "730", 1), 113043, "proceeds, cleared out of the asset account");
  assert.equal(at(journal, "730", -1), -86957, "the asset, at cost");
  assert.equal(at(journal, "300"), -33986, "depreciation recovered");
  assert.equal(at(journal, "301"), -26086, "capital gain");
  assert.equal(journal.source, "disposal");
});

test("a loss posts to the loss account and balances too", () => {
  const d = disposalOf({ cost: 260870, accumulatedDepreciation: 116522, proceeds: 139956 });
  const journal = postDisposal(
    { assetNumber: "FA-0021", assetName: "Ozone Alpina", date: "2025-07-28", disposal: d },
    ACCOUNTS,
  );
  assert.equal(sum(journal), 0);
  assert.equal(at(journal, "470"), 4392);
  assert.equal(at(journal, "300"), 0, "nothing recovered");
  assert.equal(at(journal, "301"), 0, "no capital gain");
});

test("the asset leaves the balance sheet entirely", () => {
  // Cost out, depreciation out: nothing of it is left carried anywhere.
  const d = disposalOf({ cost: 86957, accumulatedDepreciation: 33986, proceeds: 113043 });
  const journal = postDisposal(
    { assetNumber: "FA-0036", assetName: "Sup Air Eona", date: "2025-12-18", disposal: d },
    ACCOUNTS,
  );
  // The asset account nets to the proceeds less the cost; the credit for those
  // proceeds is on the sale, which is posted separately.
  assert.equal(at(journal, "730"), 113043 - 86957);
  assert.equal(at(journal, "731"), 33986, "and the contra is emptied of this asset's share");
});

test("proceeds credited somewhere other than the asset account still balance", () => {
  // Not every ledger codes the sale to the asset. Told where it went, the
  // journal clears it from there instead.
  const d = disposalOf({ cost: 86957, accumulatedDepreciation: 33986, proceeds: 113043 });
  const journal = postDisposal(
    { assetNumber: "FA-0036", assetName: "Sup Air Eona", date: "2025-12-18", disposal: d },
    ACCOUNTS,
    { proceedsCode: "260", proceedsName: "Other Revenue" },
  );
  assert.equal(sum(journal), 0);
  assert.equal(at(journal, "260"), 113043);
  assert.equal(at(journal, "730"), -86957, "the asset account only loses the cost");
});

test("every shape of disposal balances", () => {
  for (const proceeds of [0, 1, 52970, 52971, 52972, 86956, 86957, 86958, 500000]) {
    const d = disposalOf({ cost: 86957, accumulatedDepreciation: 33986, proceeds });
    const journal = postDisposal(
      { assetNumber: "FA", assetName: "x", date: "2025-12-18", disposal: d },
      ACCOUNTS,
    );
    assert.equal(sum(journal), 0, `does not balance at proceeds ${proceeds}`);
    // At most two of the three outcomes are ever non-zero.
    const nonZero = [d.depreciationRecovered, d.capitalGain, d.lossOnSale].filter((v) => v !== 0);
    assert.ok(nonZero.length <= 2, `three outcomes at once at proceeds ${proceeds}`);
    // And a loss never coexists with a gain of either kind.
    if (d.lossOnSale > 0) {
      assert.equal(d.depreciationRecovered, 0);
      assert.equal(d.capitalGain, 0);
    }
  }
});
