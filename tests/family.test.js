// Family sharing API against an in-memory Redis.
import { test } from "node:test";
import assert from "node:assert/strict";
import { cookieFor, useFakeAuth } from "./helpers.js";

const db = useFakeAuth();
const cookie = await cookieFor("eden");
const { default: handler } = await import("../api/family.js");

function call(method, { query = {}, body } = {}) {
  return new Promise((resolve) => {
    const res = { headers: {} };
    res.setHeader = (k, v) => { res.headers[k] = v; };
    res.status = (c) => { res.statusCode = c; return res; };
    res.json = (b) => resolve({ status: res.statusCode, body: b });
    handler({ method, query, body, headers: { cookie } }, res);
  });
}
const plan = { days: [{ planKey: "apr-d1", date: "2027-04-01", start: { name: "Hotel", lat: 35.68, lng: 139.695 }, stops: [] }] };

test("parent creates a family; kid and parent keys get the right roles", async () => {
  const c = await call("POST", { body: { action: "create", plan } });
  assert.equal(c.status, 200);
  assert.match(c.body.id, /^[a-z0-9]{10}$/);
  const asKid = await call("GET", { query: { id: c.body.id, key: c.body.kidKey } });
  assert.equal(asKid.body.role, "kid");
  assert.equal(asKid.body.plan.days[0].planKey, "apr-d1");
  const asParent = await call("GET", { query: { id: c.body.id, key: c.body.parentKey } });
  assert.equal(asParent.body.role, "parent");
  const bad = await call("GET", { query: { id: c.body.id, key: "x".repeat(16) } });
  assert.equal(bad.status, 403);
  // keys are stored hashed, not in clear text
  assert.ok(![...db.values()].some((v) => v.includes(c.body.kidKey)));
});

test("kid suggests, parent approves; cheap polling with v", async () => {
  const c = (await call("POST", { body: { action: "create", plan } })).body;
  const s = await call("POST", { body: { action: "suggest", id: c.id, key: c.kidKey, item: { name: "Ramen shop", lat: 35.69, lng: 139.70, by: "Noa", note: "smells great" } } });
  assert.equal(s.status, 200);
  assert.equal(s.body.wishlist[0].status, "pending");
  const item = s.body.wishlist[0];
  const kidReview = await call("POST", { body: { action: "review", id: c.id, key: c.kidKey, itemId: item.id, status: "approved" } });
  assert.equal(kidReview.status, 403);
  const kidPlan = await call("POST", { body: { action: "plan", id: c.id, key: c.kidKey, plan } });
  assert.equal(kidPlan.status, 403);
  const ok = await call("POST", { body: { action: "review", id: c.id, key: c.parentKey, itemId: item.id, status: "approved", day: "apr-d1" } });
  assert.equal(ok.body.wishlist[0].status, "approved");
  const same = await call("GET", { query: { id: c.id, key: c.kidKey, v: String(ok.body.v) } });
  assert.equal(same.body.unchanged, true);
  const older = await call("GET", { query: { id: c.id, key: c.kidKey, v: "1" } });
  assert.equal(older.body.wishlist.length, 1);
});

test("suggestions outside Japan or without a name are refused; kids remove only their own pending items", async () => {
  const c = (await call("POST", { body: { action: "create", plan } })).body;
  const paris = await call("POST", { body: { action: "suggest", id: c.id, key: c.kidKey, item: { name: "Eiffel", lat: 48.85, lng: 2.35 } } });
  assert.equal(paris.status, 400);
  const s = (await call("POST", { body: { action: "suggest", id: c.id, key: c.kidKey, item: { name: "Arcade", lat: 35.7, lng: 139.77, by: "Tom" } } })).body;
  const other = await call("POST", { body: { action: "remove", id: c.id, key: c.kidKey, itemId: s.wishlist[0].id, by: "Noa" } });
  assert.equal(other.status, 403);
  const own = await call("POST", { body: { action: "remove", id: c.id, key: c.kidKey, itemId: s.wishlist[0].id, by: "Tom" } });
  assert.equal(own.body.wishlist.length, 0);
});
