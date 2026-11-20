// Wallet: budget maths, exchange rates, and the API rules.
import { test } from "node:test";
import assert from "node:assert/strict";
import { cookieFor, useFakeAuth } from "./helpers.js";
import { chartDays, currencyFor, summarize, toCsv } from "../js/wallet-core.js";

let fxUp = true, fxCalls = 0;
globalThis.fetch = async (input) => {
  const url = typeof input === "string" ? input : input.url;
  if (url.includes("frankfurter")) {
    fxCalls++;
    if (!fxUp) throw new TypeError("network down");
    // 1 ILS = 10 THB, 40 JPY, 0.27 USD, 0.25 EUR
    return new Response(JSON.stringify({ base: "ILS", date: "2027-03-20", rates: { THB: 10, JPY: 40, USD: 0.27, EUR: 0.25 } }), { status: 200 });
  }
  return new Response("{}", { status: 404 });
};
const db = useFakeAuth();
const { default: api } = await import("../api/wallet.js");
const admin = await cookieFor("nastia");
const kid = await cookieFor("noam");

function call(method, { body, query = {}, cookie = admin } = {}) {
  return new Promise((resolve) => {
    const res = { headers: {} };
    res.setHeader = (k, v) => { res.headers[k] = v; };
    res.status = (c) => { res.statusCode = c; return res; };
    res.json = (b) => resolve({ status: res.statusCode, body: b });
    api({ method, url: "/api/wallet", query, body, headers: { cookie } }, res);
  });
}

const range = { start: "2027-03-19", end: "2027-05-10" }; // 53 days
const e = (date, ils, category = "food", country = "TH") => ({ id: Math.random().toString(36).slice(2, 12), date, ils, category, country });

test("before the trip: what's left after bookings, spread over 53 days", () => {
  const s = summarize({ expenses: [], booked: [{ ils: 15000, category: "flights" }, { ils: 11500, category: "stay" }], budget: 80000, range, today: "2027-03-09" });
  assert.equal(s.phase, "before");
  assert.equal(s.daysToGo, 10);
  assert.equal(s.left, 53500);
  assert.equal(s.daily, 53500 / 53);
  assert.equal(s.byCategory.find((c) => c.id === "flights").spent, 15000);
});

test("during the trip: today's allowance and the pace", () => {
  const ex = [e("2027-03-19", 1200), e("2027-03-20", 900), e("2027-03-21", 300), e("2027-03-21", 400, "transport")];
  const s = summarize({ expenses: ex, booked: [{ ils: 26500, category: "flights" }], budget: 80000, range, today: "2027-03-21" });
  assert.equal(s.phase, "during");
  assert.equal(s.day, 3);
  assert.equal(s.daysLeft, 51);
  assert.equal(s.spentToday, 700);
  assert.equal(s.daily, (80000 - 26500 - 2100) / 51);
  assert.equal(s.todayLeft, s.daily - 700);
  assert.equal(s.avgPerDay, 2800 / 3);
  assert.equal(s.projected, 26500 + 2800 + (2800 / 3) * 50);
  assert.equal(s.onTrack, true);
  const big = summarize({ expenses: [e("2027-03-19", 5000)], booked: [{ ils: 26500 }], budget: 80000, range, today: "2027-03-19" });
  assert.equal(big.onTrack, false, "₪5,000 a day can't last 53 days");
  assert.equal(s.byCountry.TH, 2800);
  assert.equal(s.byDay["2027-03-21"], 700);
});

test("helpers: chart days, currency for the country, CSV for a spreadsheet", () => {
  assert.equal(chartDays(range, "2027-03-21").length, 3);
  assert.equal(chartDays(range, "2026-11-20").length, 30);
  const segs = [{ country: "TH", from: "2027-03-19", to: "2027-04-01" }, { country: "JP", from: "2027-04-01", to: "2027-05-10" }];
  assert.equal(currencyFor(segs, "2027-03-25"), "THB");
  assert.equal(currencyFor(segs, "2027-04-01"), "JPY");
  assert.equal(currencyFor(segs, "2027-05-10"), "JPY");
  assert.equal(currencyFor(segs, "2026-11-20"), null);
  const csv = toCsv([{ date: "2027-03-20", category: "food", note: 'Pad "thai"', amount: 120, currency: "THB", ils: 12, rate: 0.1, method: "cash", country: "TH", by: "nastia" }]);
  assert.ok(csv.startsWith("﻿date,category"));
  assert.match(csv, /"Pad ""thai"""/);
});

test("API: grown-ups add, edit and delete spending; ₪ is worked out from today's rate", async () => {
  const add = await call("POST", { body: { action: "save", expense: { id: "abc12345", amount: 350, currency: "THB", category: "food", date: "2027-03-20", note: "Mango sticky rice", method: "cash", country: "TH" } } });
  assert.equal(add.status, 200, JSON.stringify(add.body));
  assert.equal(add.body.expense.ils, 35, "350 ฿ at 10 ฿ per ₪");
  assert.equal(add.body.expense.by, "nastia");
  // the card statement said ₪36.40 – that wins
  const exact = await call("POST", { body: { action: "save", expense: { id: "abc12345", amount: 350, currency: "THB", category: "food", date: "2027-03-20", ilsExact: 36.4 } } });
  assert.equal(exact.body.expense.ils, 36.4);
  assert.equal(exact.body.expense.exact, true);
  assert.equal(exact.body.expense.note, "", "an edit replaces the whole entry");
  const yen = await call("POST", { body: { action: "save", expense: { id: "def67890", amount: 2000, currency: "JPY", category: "transport", date: "2027-04-02" } } });
  assert.equal(yen.body.expense.ils, 50);

  const got = await call("GET");
  assert.equal(got.status, 200);
  assert.equal(got.body.expenses.length, 2);
  assert.equal(got.body.expenses[0].id, "def67890", "newest date first");
  assert.equal(got.body.budget.total, 80000);
  assert.equal(got.body.rates.ilsPer.THB, 0.1);
  assert.deepEqual((await call("GET", { query: { v: got.body.v } })).body, { unchanged: true, v: got.body.v });

  await call("POST", { body: { action: "remove", id: "def67890" } });
  assert.equal((await call("GET")).body.expenses.length, 1);
});

test("API: bad input, kids, category budgets and booked flights from the timeline", async () => {
  const bad = async (expense) => (await call("POST", { body: { action: "save", expense } })).status;
  assert.equal(await bad({ id: "x", amount: 1, currency: "ILS", date: "2027-03-20" }), 400);
  assert.equal(await bad({ id: "abcdefgh", amount: 0, currency: "ILS", date: "2027-03-20" }), 400);
  assert.equal(await bad({ id: "abcdefgh", amount: 5, currency: "ILS", date: "soon" }), 400);
  assert.equal((await call("GET", { cookie: kid })).status, 403, "kids never see money");
  assert.equal((await call("POST", { cookie: kid, body: { action: "remove", id: "abc12345" } })).status, 403);

  const plan = await call("POST", { body: { action: "plan", plan: { food: "12000", fun: 8000, bogus: 5, shopping: -3 } } });
  assert.deepEqual(plan.body.plan, { food: 12000, fun: 8000 });

  db.set("trip:timeline", JSON.stringify({ v: 3, trip: { budget: 80000, currency: "ILS" }, segments: [{ id: "th", country: "TH", from: "2027-03-19", to: "2027-04-01" }], items: [
    { id: "f1", kind: "flight", from: "TLV", to: "BKK", date: "2027-03-18", price: 14800, currency: "ILS" },
    { id: "s1", kind: "stay", name: "Hotel", checkIn: "2027-03-19", checkOut: "2027-03-24", price: 9500, currency: "THB" },
    { id: "n1", kind: "note", title: "Songkran", date: "2027-04-13" },
  ] }));
  const got = (await call("GET")).body;
  assert.deepEqual(got.booked.map((b) => [b.category, b.ils]), [["flights", 14800], ["stay", 950]]);
  assert.deepEqual(got.range, { start: "2027-03-19", end: "2027-04-01" });
});

test("rates: saved and reused when the source is down; admins can type them; no rate → ask for ₪", async () => {
  db.set("fx:latest", JSON.stringify({ date: "2027-03-19", ilsPer: { ILS: 1, THB: 0.1, JPY: 0.025 }, source: "ECB (frankfurter)", fetchedAt: "2000-01-01T00:00:00Z" }));
  fxUp = false;
  const got = (await call("GET")).body;
  assert.equal(got.rates.stale, true);
  assert.equal(got.rates.ilsPer.THB, 0.1, "last saved rate still used");
  assert.deepEqual(got.rates.missing, ["USD", "EUR"]);
  const usd = await call("POST", { body: { action: "save", expense: { id: "usd00001", amount: 20, currency: "USD", date: "2027-03-20" } } });
  assert.equal(usd.status, 409, "never guesses a rate");
  assert.match(usd.body.error, /type the ₪ amount/);
  const typed = await call("POST", { body: { action: "save", expense: { id: "usd00001", amount: 20, currency: "USD", date: "2027-03-20", ilsExact: 74 } } });
  assert.equal(typed.body.expense.ils, 74);
  assert.equal((await call("POST", { cookie: await cookieFor("eden"), body: { action: "rates", rates: { USD: 3.7 } } })).status, 403);
  const set = await call("POST", { body: { action: "rates", rates: { USD: 3.7, THB: 0 } } });
  assert.equal(set.body.rates.ilsPer.USD, 3.7);
  fxUp = true;
});
