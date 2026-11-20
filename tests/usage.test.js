// Usage metering and spending guards, with fake Google / Claude / Redis.
import { test } from "node:test";
import assert from "node:assert/strict";
import { cookieFor, useFakeAuth } from "./helpers.js";

process.env.GOOGLE_MAPS_API_KEY = "test-google-key";
process.env.ANTHROPIC_API_KEY = "test-anthropic-key";
let googleCalls = 0, claudeCalls = 0;
const json = (o) => new Response(JSON.stringify(o), { status: 200, headers: { "content-type": "application/json" } });
globalThis.fetch = async (input, init = {}) => {
  const url = typeof input === "string" ? input : input.url;
  if (url.includes("places:searchText")) { googleCalls++; return json({ places: [{ id: "p1", displayName: { text: "Zoo" }, location: { latitude: 35.7, longitude: 139.77 } }] }); }
  if (url.includes("computeRoutes")) { googleCalls++; return json({}); }
  if (url.includes("searchNearby")) { googleCalls++; return json({ places: [{ displayName: { text: "Ueno Station" }, location: { latitude: 35.71, longitude: 139.77 } }] }); }
  if (url.includes("/v1/messages")) {
    claudeCalls++;
    return json({ id: "m", type: "message", role: "assistant", model: "claude-opus-5-5", stop_reason: "end_turn", stop_sequence: null,
      usage: { input_tokens: 1000, output_tokens: 500 }, content: [{ type: "text", text: "## Steps\n1. Walk." }] });
  }
  return json({ error: { message: "unexpected " + url } });
};
const db = useFakeAuth();
const admin = await cookieFor("nastia");
const kid = await cookieFor("eden");
const month = new Date().toISOString().slice(0, 7);
const hget = (key, f) => Number(db.get(key)?.get(f)) || 0;

function call(path, { query = {}, body, cookie = admin, method = body ? "POST" : "GET" } = {}) {
  return new Promise(async (resolve) => {
    const { default: h } = await import(`../api/${path}.js`);
    const res = { headers: {} };
    res.setHeader = (k, v) => { res.headers[k] = v; };
    res.status = (c) => { res.statusCode = c; return res; };
    res.json = (b) => { res.body = b; };
    await h({ method, url: `/api/${path}`, query, body, headers: { cookie } }, res);
    resolve({ status: res.statusCode, body: res.body });
  });
}

test("each API call records Google calls by SKU, database work, function runs and the user", async () => {
  const r = await call("activities", { query: { category: "animals", near: "35.68,139.77" } });
  assert.equal(r.status, 200);
  const m = `use:m:${month}`;
  assert.equal(hget(m, "g:places.textsearch.enterprise"), 1);
  assert.equal(hget(m, "fn:activities"), 1);
  assert.ok(hget(m, "kv:cmds") >= 2, "login check + the save itself");
  assert.equal(hget(`use:u:${month}`, "nastia|g:places.textsearch.enterprise"), 1);
  assert.equal(hget(`use:d:${new Date().toISOString().slice(0, 10)}`, "fn:activities"), 1);
});

test("“free allowance only”: Google is not called once the free calls are used", async () => {
  db.get(`use:m:${month}`).set("g:places.textsearch.pro", 5000); // the Pro free allowance
  const before = googleCalls;
  const r = await call("find", { query: { q: "Pokemon Center" } });
  assert.equal(r.status, 429);
  assert.match(r.body.error, /free Google allowance/);
  assert.equal(googleCalls, before, "no paid Google call");
  assert.equal(hget(`use:m:${month}`, "g:blocked:places.textsearch.pro"), 1);
  // the admin can allow paid calls
  assert.equal((await call("usage", { body: { action: "settings", aiEnabled: true, aiCapUsd: 5, googleFreeOnly: false } })).status, 200);
  assert.equal((await call("find", { query: { q: "Pokemon Center 2" } })).status, 200);
  await call("usage", { body: { action: "settings", aiEnabled: true, aiCapUsd: 5, googleFreeOnly: true } });
});

test("Claude: exact tokens and cost are recorded; AI switch and monthly cap stop paid calls", async () => {
  const q = (n) => ({ query: { from: "35.666,139.758", to: "35.7141,139.7774", name: `Ueno Zoo ${n}` } });
  const r = await call("guide", q(1));
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const m = `use:m:${month}`;
  assert.equal(hget(m, "ai:guides"), 1);
  assert.equal(hget(m, "ai:in"), 1000);
  assert.equal(hget(m, "ai:usd_micro"), 14000, "1000 × $4/M + 500 × $20/M = $0.014");
  assert.equal(hget(`use:u:${month}`, "nastia|ai:usd_micro"), 14000);

  await call("usage", { body: { action: "settings", aiEnabled: false, aiCapUsd: 5, googleFreeOnly: true } });
  const calls = claudeCalls;
  const off = await call("guide", q(2));
  assert.equal(off.status, 403);
  assert.match(off.body.error, /switched off/);

  await call("usage", { body: { action: "settings", aiEnabled: true, aiCapUsd: 0.01, googleFreeOnly: true } });
  const capped = await call("guide", q(3));
  assert.equal(capped.status, 403);
  assert.match(capped.body.error, /limit/);
  assert.equal(claudeCalls, calls, "Claude was not called");
  assert.equal(hget(m, "ai:blocked"), 2);
});

test("the costs page is for admins only and adds everything up", async () => {
  assert.equal((await call("usage", { cookie: kid })).status, 403);
  assert.equal((await call("usage", { cookie: kid, body: { action: "settings", aiEnabled: true, aiCapUsd: 99 } })).status, 403);
  assert.equal((await call("usage", { body: { action: "settings", aiEnabled: true, aiCapUsd: -1 } })).status, 400);
  const r = await call("usage");
  assert.equal(r.status, 200);
  const d = r.body;
  assert.equal(d.month, month);
  const ent = d.google.find((g) => g.sku === "places.textsearch.enterprise");
  assert.equal(ent.calls, 1);
  assert.equal(ent.usd, 0, "inside the free allowance");
  const pro = d.google.find((g) => g.sku === "places.textsearch.pro");
  assert.equal(pro.calls, 5001);
  assert.ok(Math.abs(pro.usd - 0.032) < 1e-9, "1 call over the free 5,000 at $32 per 1,000");
  assert.ok(Math.abs(d.ai.usd - 0.014) < 1e-9);
  assert.ok(Math.abs(d.total.usd - 0.046) < 1e-9);
  assert.equal(d.users.find((u) => u.id === "nastia").aiGuides, 1);
  assert.ok(d.redis.commands > 0 && d.redis.keys > 0 && d.redis.groups.use.keys >= 3);
  assert.ok(d.functions.some((f) => f.route === "guide"));
  assert.equal(d.daily.at(-1).date, new Date().toISOString().slice(0, 10));
  assert.equal(d.daily.at(-1).aiGuides, 1);
});
