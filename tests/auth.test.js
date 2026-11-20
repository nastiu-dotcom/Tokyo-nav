// Login, admin rules and the middleware gate, against an in-memory Redis.
import { test } from "node:test";
import assert from "node:assert/strict";
import { TEST_PASSWORD, cookieFor, useFakeAuth } from "./helpers.js";

const db = useFakeAuth();
const { default: auth } = await import("../api/auth.js");
const { default: admin } = await import("../api/admin.js");
const { default: middleware } = await import("../middleware.js");

function call(handler, method, { body, cookie, host = "trip.example.com" } = {}) {
  return new Promise((resolve) => {
    const res = { headers: {} };
    res.setHeader = (k, v) => { res.headers[k.toLowerCase()] = v; };
    res.status = (c) => { res.statusCode = c; return res; };
    res.json = (b) => resolve({ status: res.statusCode, body: b, headers: res.headers });
    handler({ method, query: {}, body, headers: { host, ...(cookie ? { cookie } : {}) } }, res);
  });
}
const loginAs = (name, password = TEST_PASSWORD) => call(auth, "POST", { body: { action: "login", name, password } });
const cookieOf = (r) => r.headers["set-cookie"].split(";")[0];

test("first login creates nastia (admin), eden and Noam; names are case-insensitive", async () => {
  const r = await loginAs("NASTIA");
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.user, { ...r.body.user, id: "nastia", role: "admin" });
  assert.equal((await loginAs("noam")).body.user.name, "Noam");
  assert.equal((await loginAs("eden")).body.user.role, "kid");
  const c = r.headers["set-cookie"];
  assert.match(c, /^tke_s=.+; Path=\/; HttpOnly; SameSite=Lax; Max-Age=\d+; Secure$/);
  // the password itself is never stored
  assert.ok(![...db.values()].some((v) => v.includes(TEST_PASSWORD)));
  const me = await call(auth, "GET", { cookie: cookieOf(r) });
  assert.equal(me.body.user.id, "nastia");
});

test("wrong passwords are refused and rate-limited", async () => {
  assert.equal((await loginAs("eden", "nope-nope")).status, 401);
  assert.equal((await loginAs("nobody")).status, 401);
  for (let i = 0; i < 8; i++) await loginAs("noam", "wrong-password");
  const blocked = await loginAs("noam"); // even the right password waits now
  assert.equal(blocked.status, 429);
  db.delete("auth:fail:noam");
});

test("members can't open the admin API; admins can add users", async () => {
  const member = await call(admin, "GET", { cookie: await cookieFor("eden") });
  assert.equal(member.status, 403);
  const boss = await cookieFor("nastia");
  const list = await call(admin, "GET", { cookie: boss });
  assert.deepEqual(list.body.users.map((u) => u.id), ["nastia", "eden", "noam"]);
  assert.ok(!JSON.stringify(list.body).includes("hash"), "no password hashes in the reply");
  const added = await call(admin, "POST", { cookie: boss, body: { action: "add", name: "Grandma", password: "cookies-2027", role: "member" } });
  assert.equal(added.status, 200);
  assert.equal((await loginAs("grandma", "cookies-2027")).status, 200);
  assert.equal((await call(admin, "POST", { cookie: boss, body: { action: "add", name: "grandma", password: "another-pw-1" } })).status, 409);
  assert.equal((await call(admin, "POST", { cookie: boss, body: { action: "add", name: "x", password: "short" } })).status, 400);
});

test("admin rules: keep one admin, can't remove yourself; reset/disable logs people out", async () => {
  const boss = await cookieFor("nastia");
  assert.equal((await call(admin, "POST", { cookie: boss, body: { action: "remove", id: "nastia" } })).status, 409);
  assert.equal((await call(admin, "POST", { cookie: boss, body: { action: "role", id: "nastia", role: "member" } })).status, 409);

  const edenCookie = cookieOf(await loginAs("eden"));
  assert.equal((await call(auth, "GET", { cookie: edenCookie })).status, 200);
  await call(admin, "POST", { cookie: boss, body: { action: "password", id: "eden", password: "new-secret-9" } });
  assert.equal((await call(auth, "GET", { cookie: edenCookie })).status, 401, "old session ends at once");
  assert.equal((await loginAs("eden")).status, 401);
  const eden2 = cookieOf(await loginAs("eden", "new-secret-9"));

  await call(admin, "POST", { cookie: boss, body: { action: "disable", id: "eden", disabled: true } });
  assert.equal((await call(auth, "GET", { cookie: eden2 })).status, 401);
  assert.equal((await loginAs("eden", "new-secret-9")).status, 401);
  await call(admin, "POST", { cookie: boss, body: { action: "disable", id: "eden", disabled: false } });
  assert.equal((await loginAs("eden", "new-secret-9")).status, 200);

  await call(admin, "POST", { cookie: boss, body: { action: "remove", id: "grandma" } });
  assert.equal((await loginAs("grandma", "cookies-2027")).status, 401);
});

test("users can change their own password (needs the current one)", async () => {
  const c = cookieOf(await loginAs("noam"));
  assert.equal((await call(auth, "POST", { cookie: c, body: { action: "password", old: "wrong-one-1", password: "noam-new-pw" } })).status, 401);
  const ok = await call(auth, "POST", { cookie: c, body: { action: "password", old: TEST_PASSWORD, password: "noam-new-pw" } });
  assert.equal(ok.status, 200);
  assert.equal((await call(auth, "GET", { cookie: cookieOf(ok) })).status, 200, "the phone that changed it stays logged in");
  assert.equal((await loginAs("noam", "noam-new-pw")).status, 200);
});

test("middleware: login page is public, everything else needs a session", async () => {
  const req = (path, cookie) => new Request(`https://trip.example.com${path}`, { headers: cookie ? { cookie } : {} });
  const passes = (r) => r.headers.get("x-middleware-next") === "1";
  for (const p of ["/login.html", "/js/login.js", "/styles.css", "/api/auth", "/icons/icon.svg"]) assert.ok(passes(await middleware(req(p))), p);
  const home = await middleware(req("/"));
  assert.equal(home.status, 302);
  assert.equal(home.headers.get("location"), "/login.html");
  assert.equal((await middleware(req("/admin.html?x=1"))).headers.get("location"), "/login.html?next=%2Fadmin.html%3Fx%3D1");
  assert.equal((await middleware(req("/data/tokyo-5day-2027.json"))).status, 302);
  assert.equal((await middleware(req("/api/activities"))).status, 401);
  assert.equal((await middleware(req("/", "tke_s=forged.token"))).status, 302);
  assert.ok(passes(await middleware(req("/", await cookieFor("nastia")))));
});

test("no INITIAL_PASSWORD and no users yet → clear setup message, nobody gets in", async () => {
  const saved = process.env.INITIAL_PASSWORD;
  const doc = db.get("auth:users");
  db.delete("auth:users");
  delete process.env.INITIAL_PASSWORD;
  const r = await loginAs("nastia");
  assert.equal(r.status, 503);
  assert.match(r.body.error, /INITIAL_PASSWORD/);
  process.env.INITIAL_PASSWORD = saved;
  db.set("auth:users", doc);
});
