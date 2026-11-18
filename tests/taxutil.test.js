import { test } from "node:test";
import assert from "node:assert/strict";
import { exportDeadline, minimumCheck, refundEstimate, summary } from "../js/taxutil.js";

test("refund is the tax inside a tax-included price", () => {
  assert.equal(refundEstimate(11000), 1000);          // 10 %
  assert.equal(refundEstimate(10800, "reduced"), 800); // 8 %
  assert.equal(refundEstimate(0), 0);
  assert.equal(refundEstimate("abc"), 0);
});

test("goods must leave Japan within 90 days", () => {
  assert.equal(exportDeadline("2027-04-01"), "2027-06-30");
});

test("¥5,000-before-tax minimum is checked per shop per day", () => {
  const g = minimumCheck([
    { id: "a", shop: "Pokémon Center", date: "2027-04-05", amount: 3300, rate: "standard" },
    { id: "b", shop: "pokémon center ", date: "2027-04-05", amount: 2200, rate: "standard" },
    { id: "c", shop: "Animate", date: "2027-04-05", amount: 4400, rate: "standard" },
  ]);
  const pc = g.find((x) => x.ids.includes("a"));
  assert.equal(pc.beforeTax, 5000);
  assert.equal(pc.ok, true);
  assert.equal(g.find((x) => x.ids.includes("c")).ok, false);
});

test("summary counts pending refunds only", () => {
  const s = summary([{ amount: 11000, status: "pending" }, { amount: 22000, status: "refunded" }]);
  assert.equal(s.refund, 3000);
  assert.equal(s.pendingRefund, 1000);
  assert.equal(s.pending, 1);
});
