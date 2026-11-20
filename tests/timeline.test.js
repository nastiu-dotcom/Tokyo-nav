// Whole-trip timeline: the logic (countdown, missing nights, clashes) and the API rules.
import { test } from "node:test";
import assert from "node:assert/strict";
import { cookieFor, useFakeAuth } from "./helpers.js";
import { doubleBooked, fixedCosts, itemSegment, missingNights, nextItem, planClashes, segmentFor, status } from "../js/timeline-core.js";

useFakeAuth();
const { default: api, DEFAULT } = await import("../api/timeline.js");
const adult = await cookieFor("nastia");
const kid = await cookieFor("noam");

function call(method, { body, query = {}, cookie = adult } = {}) {
  return new Promise((resolve) => {
    const res = { headers: {} };
    res.setHeader = (k, v) => { res.headers[k] = v; };
    res.status = (c) => { res.statusCode = c; return res; };
    res.json = (b) => resolve({ status: res.statusCode, body: b });
    api({ method, query, body, headers: { cookie } }, res);
  });
}

const doc = (items = []) => ({ ...structuredClone(DEFAULT), items });

test("default trip: Thailand 19/3–1/4, Japan 1/4–10/5 2027, ₪80,000", () => {
  const d = doc();
  assert.equal(d.trip.budget, 80000);
  assert.equal(segmentFor(d, "2027-03-31").country, "TH");
  assert.equal(segmentFor(d, "2027-04-01").country, "JP");
  assert.equal(segmentFor(d, "2027-05-10").country, "JP", "the day you fly home still counts");
  assert.equal(segmentFor(d, "2027-05-11"), null);
  assert.deepEqual(status(d, "2027-03-09"), { phase: "before", daysToGo: 10, total: 53, start: "2027-03-19", end: "2027-05-10" });
  assert.equal(status(d, "2027-04-01").day, 14);
  assert.equal(status(d, "2027-04-01").segment.country, "JP");
  assert.equal(status(d, "2027-06-01").phase, "after");
});

test("missing nights, overnight flights and double bookings", () => {
  const d = doc([
    { kind: "flight", date: "2027-03-18", time: "23:00", arrDate: "2027-03-19", from: "TLV", to: "BKK" },
    { kind: "stay", name: "Bangkok hotel", checkIn: "2027-03-19", checkOut: "2027-03-25" },
    { kind: "stay", name: "Island bungalow", checkIn: "2027-03-24", checkOut: "2027-04-01" },
    { kind: "flight", date: "2027-04-01", time: "23:30", arrDate: "2027-04-02", from: "BKK", to: "NRT" },
    { kind: "stay", name: "Tokyo apartment", checkIn: "2027-04-02", checkOut: "2027-05-10" },
  ]);
  assert.deepEqual(missingNights(d), [], "every night has a bed or a plane seat");
  assert.deepEqual(doubleBooked(d), [{ night: "2027-03-24", names: ["Bangkok hotel", "Island bungalow"] }]);
  d.items.pop();
  assert.deepEqual(missingNights(d), [{ from: "2027-04-02", to: "2027-05-10", nights: 38 }]);
  assert.equal(nextItem(d, "2027-03-20").name, "Island bungalow");
  // flights are filed where they land: the night flight of 18/3 belongs to Thailand
  assert.equal(itemSegment(d, d.items[0]).country, "TH");
  assert.equal(itemSegment(d, d.items[3]).country, "JP");
  assert.equal(itemSegment(d, { kind: "flight", date: "2027-05-10", arrDate: "2027-05-11" }).country, "JP", "flight home");
});

test("Tokyo plan days dated while in Thailand are flagged", () => {
  const plan = [{ date: "2027-03-31" }, { date: "2027-04-01" }, { date: "" }, { date: "2027-06-01" }];
  assert.deepEqual(planClashes(doc(), plan), [{ index: 0, date: "2027-03-31", country: "TH" }, { index: 3, date: "2027-06-01", country: null }]);
});

test("fixed costs add up per currency", () => {
  assert.deepEqual(fixedCosts(doc([{ price: 4000, currency: "ILS" }, { price: 1500, currency: "ILS" }, { price: 9000, currency: "THB" }, { price: null }])), { ILS: 5500, THB: 9000 });
});

test("grown-ups add flights and stays; kids see them without prices and can't edit", async () => {
  const first = await call("GET");
  assert.equal(first.body.timeline.segments.length, 2);
  const add = await call("POST", { body: { action: "item", item: { kind: "flight", from: "TLV", to: "BKK", date: "2027-03-19", time: "10:30", flightNo: "ly81", price: 4200, currency: "ILS", booking: "ABC123" } } });
  assert.equal(add.status, 200);
  const flight = add.body.timeline.items[0];
  assert.equal(flight.flightNo, "LY81");
  assert.match(flight.id, /^[a-f0-9]{12}$/);
  const edited = await call("POST", { body: { action: "item", item: { ...flight, time: "11:00" } } });
  assert.equal(edited.body.timeline.items.length, 1, "editing keeps one copy");
  assert.equal(edited.body.timeline.items[0].time, "11:00");

  const asKid = await call("GET", { cookie: kid });
  const k = asKid.body.timeline;
  assert.equal(k.items[0].from, "TLV");
  assert.equal(k.items[0].price, undefined);
  assert.equal(k.items[0].booking, undefined);
  assert.equal(k.trip.budget, undefined);
  assert.equal((await call("POST", { cookie: kid, body: { action: "remove", id: flight.id } })).status, 403);

  const v = edited.body.timeline.v;
  assert.deepEqual((await call("GET", { query: { v: String(v) } })).body, { unchanged: true, v });
});

test("bad input is refused", async () => {
  const bad = async (item) => (await call("POST", { body: { action: "item", item } })).status;
  assert.equal(await bad({ kind: "flight", from: "TLV", to: "", date: "2027-03-19" }), 400);
  assert.equal(await bad({ kind: "flight", from: "A", to: "B", date: "2027-03-19", arrDate: "2027-03-18" }), 400);
  assert.equal(await bad({ kind: "stay", name: "X", checkIn: "2027-04-02", checkOut: "2027-04-02" }), 400);
  assert.equal(await bad({ kind: "stay", name: "X", checkIn: "not-a-date", checkOut: "2027-04-02" }), 400);
  assert.equal(await bad({ kind: "boat" }), 400);
  const overlap = await call("POST", { body: { action: "trip", trip: { budget: 80000 }, segments: [
    { country: "TH", from: "2027-03-19", to: "2027-04-02" }, { country: "JP", from: "2027-04-01", to: "2027-05-10" }] } });
  assert.equal(overlap.status, 400);
  const ok = await call("POST", { body: { action: "trip", trip: { title: "Our big trip", budget: 85000, currency: "ILS" }, segments: [
    { country: "JP", from: "2027-04-02", to: "2027-05-10" }, { country: "TH", from: "2027-03-19", to: "2027-04-02" }] } });
  assert.equal(ok.status, 200);
  assert.deepEqual(ok.body.timeline.segments.map((s) => s.country), ["TH", "JP"], "sorted by date");
  assert.equal(ok.body.timeline.trip.budget, 85000);
});
