// Family sharing: one parent shares the trip with the kids; kids suggest places,
// the parent approves them into a day.
//
// GET  /api/family?id=…&key=…[&v=…]   → plan + suggestions (or {unchanged} if v is current)
// POST /api/family {action, …}
//   create   {plan}                       → {id, parentKey, kidKey}
//   plan     {id, key, plan}              (parent) save the plan
//   suggest  {id, key, item}              (anyone) add a suggestion
//   review   {id, key, itemId, status, day} (parent) approve / decline
//   remove   {id, key, itemId, by?}       (parent, or the kid who suggested it)
//
// Storage (Upstash Redis, 180-day expiry, refreshed on every write):
//   fam:<id>:auth  {p: sha256(parentKey), k: sha256(kidKey)}
//   fam:<id>:v     version number (cheap polling)
//   fam:<id>:data  {plan, wishlist}
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { HttpError } from "../lib/common.js";
import { kv, kvPipeline } from "../lib/kv.js";

const TTL = 60 * 60 * 24 * 180;
const MAX_PLAN = 300_000;     // bytes of JSON
const MAX_WISH = 300;
const ALPHA = "abcdefghijkmnpqrstuvwxyz23456789";

const rid = (n) => Array.from(randomBytes(n), (b) => ALPHA[b % ALPHA.length]).join("");
const sha = (s) => createHash("sha256").update(String(s)).digest("hex");
const keys = (id) => ({ auth: `fam:${id}:auth`, v: `fam:${id}:v`, data: `fam:${id}:data` });

function same(a, b) {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && timingSafeEqual(x, y);
}

function send(res, status, body) {
  res.setHeader("Cache-Control", "no-store");
  res.status(status).json(body);
}

/** Load a family and check the key. Returns {role, v, data?}. */
async function open(id, key, withData) {
  if (!/^[a-z0-9]{10}$/.test(String(id || "")) || !/^[a-z0-9]{16,32}$/.test(String(key || ""))) {
    throw new HttpError(400, "Invalid family link");
  }
  const k = keys(id);
  const [authRaw, v, dataRaw] = await kv(withData ? ["MGET", k.auth, k.v, k.data] : ["MGET", k.auth, k.v]);
  if (!authRaw) throw new HttpError(404, "This family link has expired or doesn't exist");
  const auth = JSON.parse(authRaw);
  const h = sha(key);
  const role = same(h, auth.p) ? "parent" : same(h, auth.k) ? "kid" : null;
  if (!role) throw new HttpError(403, "This family link is not valid");
  return { role, v: Number(v) || 0, data: dataRaw ? JSON.parse(dataRaw) : { plan: null, wishlist: [] }, k };
}

async function write(k, data, v) {
  const json = JSON.stringify(data);
  if (json.length > MAX_PLAN + 200_000) throw new HttpError(413, "The plan is too big to share");
  await kvPipeline([
    ["SET", k.data, json, "EX", TTL],
    ["SET", k.v, String(v + 1), "EX", TTL],
    ["EXPIRE", k.auth, TTL],
  ]);
  return v + 1;
}

const clip = (s, n) => String(s ?? "").replace(/[\u0000-\u001f]/g, " ").trim().slice(0, n);
const inJapan = (lat, lng) => Number.isFinite(lat) && Number.isFinite(lng) && lat >= 24 && lat <= 45.7 && lng >= 122.9 && lng <= 146;

function cleanPlan(plan) {
  if (!plan || !Array.isArray(plan.days)) throw new HttpError(400, "Missing plan");
  const json = JSON.stringify(plan);
  if (json.length > MAX_PLAN) throw new HttpError(413, "The plan is too big to share");
  return JSON.parse(json);
}

function cleanItem(item) {
  const lat = Number(item?.lat), lng = Number(item?.lng);
  if (!inJapan(lat, lng)) throw new HttpError(400, "The place must be in Japan");
  const name = clip(item.name, 80);
  if (!name) throw new HttpError(400, "The place needs a name");
  return {
    id: rid(8), name, lat, lng,
    note: clip(item.note, 200), by: clip(item.by, 30) || "Kid", emoji: clip(item.emoji, 8) || "💖",
    placeId: clip(item.placeId, 300), address: clip(item.address, 160),
    status: "pending", day: null, created: new Date().toISOString(),
  };
}

export default async function handler(req, res) {
  try {
    if (req.method === "GET") {
      const { id, key } = req.query;
      const since = Number(req.query.v);
      const quick = Number.isFinite(since) && req.query.v !== undefined;
      const f = await open(id, key, !quick);
      if (quick && f.v === since) return send(res, 200, { unchanged: true, v: f.v, role: f.role });
      const full = quick ? await open(id, key, true) : f;
      return send(res, 200, { role: full.role, v: full.v, plan: full.data.plan, wishlist: full.data.wishlist || [] });
    }
    if (req.method !== "POST") {
      res.setHeader("Allow", "GET, POST");
      return send(res, 405, { error: "Method not allowed" });
    }

    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
    const action = body.action;

    if (action === "create") {
      const plan = cleanPlan(body.plan);
      const id = rid(10), parentKey = rid(24), kidKey = rid(16);
      const k = keys(id);
      await kvPipeline([
        ["SET", k.auth, JSON.stringify({ p: sha(parentKey), k: sha(kidKey) }), "EX", TTL],
        ["SET", k.data, JSON.stringify({ plan, wishlist: [] }), "EX", TTL],
        ["SET", k.v, "1", "EX", TTL],
      ]);
      return send(res, 200, { id, parentKey, kidKey, v: 1 });
    }

    const f = await open(body.id, body.key, true);
    const data = { plan: f.data.plan, wishlist: f.data.wishlist || [] };

    if (action === "plan") {
      if (f.role !== "parent") throw new HttpError(403, "Only the parent can change the plan");
      data.plan = cleanPlan(body.plan);
    } else if (action === "suggest") {
      if (data.wishlist.length >= MAX_WISH) throw new HttpError(409, "The wishlist is full");
      data.wishlist.push(cleanItem(body.item));
    } else if (action === "review") {
      if (f.role !== "parent") throw new HttpError(403, "Only the parent can approve suggestions");
      const it = data.wishlist.find((x) => x.id === body.itemId);
      if (!it) throw new HttpError(404, "Suggestion not found");
      if (!["approved", "declined", "pending"].includes(body.status)) throw new HttpError(400, "Bad status");
      it.status = body.status;
      it.day = body.status === "approved" ? clip(body.day, 40) || null : null;
    } else if (action === "remove") {
      const it = data.wishlist.find((x) => x.id === body.itemId);
      if (!it) throw new HttpError(404, "Suggestion not found");
      if (f.role !== "parent" && !(it.status === "pending" && it.by === clip(body.by, 30))) {
        throw new HttpError(403, "You can only remove your own suggestions that are still waiting");
      }
      data.wishlist = data.wishlist.filter((x) => x.id !== body.itemId);
    } else {
      throw new HttpError(400, "Unknown action");
    }

    const v = await write(f.k, data, f.v);
    return send(res, 200, { ok: true, v, role: f.role, plan: data.plan, wishlist: data.wishlist });
  } catch (err) {
    const status = err instanceof HttpError ? err.status : 500;
    if (status === 500) console.error(err);
    return send(res, status, { error: err.message || "Something went wrong" });
  }
}
