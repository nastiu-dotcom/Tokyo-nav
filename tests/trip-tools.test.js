// Golden Week, plan-date and hotel-start tools, backups, login renewal, Thailand.
import { test } from "node:test";
import assert from "node:assert/strict";
import { cookieFor, useFakeAuth } from "./helpers.js";
import { goldenWeek, holidayNotes, planShiftTarget, startSuggestions } from "../js/timeline-core.js";
import { verifySession } from "../lib/session.js";

const db = useFakeAuth();
const admin = await cookieFor("nastia");
const kid = await cookieFor("eden");

function call(path, method, { body, query = {}, cookie = admin, host = "trip.example.com" } = {}) {
  return new Promise(async (resolve) => {
    const { default: h } = await import(`../api/${path}.js`);
    const res = { headers: {} };
    res.setHeader = (k, v) => { res.headers[k.toLowerCase()] = v; };
    res.status = (c) => { res.statusCode = c; return res; };
    res.json = (b) => resolve({ status: res.statusCode, body: b, headers: res.headers });
    h({ method, url: `/api/${path}`, query, body, headers: { cookie, host } }, res);
  });
}

const doc = {
  segments: [{ id: "th", country: "TH", from: "2027-03-19", to: "2027-04-01" }, { id: "jp", country: "JP", from: "2027-04-01", to: "2027-05-10" }],
  items: [
    { id: "s1", kind: "stay", name: "Shinjuku apartment", checkIn: "2027-04-01", checkOut: "2027-04-08", lat: 35.69, lng: 139.70 },
    { id: "s2", kind: "stay", name: "No location", checkIn: "2027-04-08", checkOut: "2027-04-10" },
  ],
};

test("Golden Week: 29 Apr – 5 May, only inside the Japan part", () => {
  assert.equal(goldenWeek("2027-04-28"), false);
  assert.equal(goldenWeek("2027-04-29"), true);
  assert.equal(goldenWeek("2027-05-05"), true);
  assert.equal(goldenWeek("2027-05-06"), false);
  assert.deepEqual(holidayNotes(doc), [{ kind: "holiday", id: "gw2027", date: "2027-04-29", to: "2027-05-05", segment: "jp" }]);
  assert.deepEqual(holidayNotes({ segments: [doc.segments[0]] }), [], "not while in Thailand");
});

test("the Tokyo plan can be moved to the first day in Japan", () => {
  const plan = [{ date: "2027-03-31" }, { date: "2027-04-01" }, { date: "2027-04-02" }];
  assert.deepEqual(planShiftTarget(doc, plan), { from: "2027-03-31", to: "2027-04-01", days: 1 });
  assert.equal(planShiftTarget(doc, [{ date: "2027-04-01" }]), null, "no clash, nothing to move");
});

test("plan days are offered the hotel booked for that night (located hotels only)", () => {
  const plan = [
    { date: "2027-04-01", start: { name: "Rainbow Palace", lat: 35.67, lng: 139.69 } },
    { date: "2027-04-02", start: { name: "Shinjuku apartment", lat: 35.69, lng: 139.70 } },
    { date: "2027-04-03", start: null },
    { date: "2027-04-08", start: null },
  ];
  const s = startSuggestions(doc, plan);
  assert.equal(s.length, 1);
  assert.equal(s[0].stay.id, "s1");
  assert.deepEqual(s[0].days, [0, 2], "day 2 already starts there; 8/4 hotel has no location");
});

test("stays keep a map location only inside the trip countries", async () => {
  const ok = await call("timeline", "POST", { body: { action: "item", item: { kind: "stay", name: "Bangkok hotel", checkIn: "2027-03-19", checkOut: "2027-03-24", lat: 13.74, lng: 100.53 } } });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.timeline.items[0].lat, 13.74);
  const paris = await call("timeline", "POST", { body: { action: "item", item: { kind: "stay", name: "Paris", checkIn: "2027-03-19", checkOut: "2027-03-20", lat: 48.85, lng: 2.35 } } });
  assert.equal(paris.body.timeline.items.find((i) => i.name === "Paris").lat, undefined);
});

test("kids can suggest places in Thailand too", async () => {
  const c = (await call("family", "POST", { body: { action: "create", plan: { days: [] } } })).body;
  const s = await call("family", "POST", { cookie: kid, body: { action: "suggest", id: c.id, key: "", item: { name: "Sea Life Bangkok", lat: 13.746, lng: 100.535 } } });
  assert.equal(s.status, 200);
  const paris = await call("family", "POST", { cookie: kid, body: { action: "suggest", id: c.id, key: "", item: { name: "Louvre", lat: 48.86, lng: 2.34 } } });
  assert.equal(paris.status, 400);
});

test("opening the app renews the login for another 60 days", async () => {
  const r = await call("auth", "GET");
  assert.equal(r.status, 200);
  const cookie = r.headers["set-cookie"];
  assert.match(cookie, /Max-Age=5184000/);
  const p = await verifySession(cookie.split(";")[0].slice(6), process.env.KV_REST_API_TOKEN);
  assert.ok(p.exp - Date.now() / 1000 > 59 * 86400);
});

test("backup: admins only, everything except passwords", async () => {
  db.set("wallet:exp", new Map([["abc12345", JSON.stringify({ id: "abc12345", amount: 100, currency: "ILS", ils: 100, date: "2027-03-20" })]]));
  assert.equal((await call("backup", "GET", { cookie: kid })).status, 403);
  assert.equal((await call("backup", "GET", { cookie: await cookieFor("noam") })).status, 403);
  const r = await call("backup", "GET");
  assert.equal(r.status, 200);
  assert.match(r.headers["content-disposition"], /trip-backup-\d{4}-\d{2}-\d{2}\.json/);
  assert.equal(r.body.kind, "backup");
  assert.deepEqual(r.body.users.map((u) => u.id), ["nastia", "eden", "noam"]);
  assert.equal(r.body.wallet.expenses[0].ils, 100);
  assert.ok(r.body.timeline.items.length >= 1);
  assert.ok(r.body.family, "the shared plan is included");
  const text = JSON.stringify(r.body);
  assert.ok(!/"(hash|salt)"/.test(text), "no password hashes");
});
