// Usage metering: every API call records what it really used – Google calls
// by billing SKU, Claude tokens and cost, database commands, function runs –
// in Upstash, per day, per month and per user. Feeds the 💰 Running costs page
// and the spending guards (AI on/off + monthly cap, Google "free allowance only").
//
//   use:m:<YYYY-MM>     hash  field → count (this month)
//   use:d:<YYYY-MM-DD>  hash  field → count (one day)
//   use:u:<YYYY-MM>     hash  "<user>|<field>" → count
//   cfg:costs           JSON  {aiEnabled, aiCapUsd, googleFreeOnly}
// Fields: g:<sku> · g:blocked:<sku> · ai:guides · ai:in · ai:out · ai:cr · ai:cw ·
//         ai:usd_micro · ai:blocked · fn:<route> · fnms:<route> · kv:cmds
import { AsyncLocalStorage } from "node:async_hooks";
import { CLAUDE_DEFAULT, GOOGLE, claudeCost } from "./prices.js";
import { kv, kvConfigured, kvPipelineRaw } from "./kv.js";

const als = new AsyncLocalStorage();
const DAYS_KEPT = 400 * 86400;
export const CFG_KEY = "cfg:costs";
export const DEFAULT_CFG = { aiEnabled: true, aiCapUsd: 5, googleFreeOnly: true };

export const monthOf = (d = new Date()) => d.toISOString().slice(0, 7);
export const dayOf = (d = new Date()) => d.toISOString().slice(0, 10);

const routeName = (req) => {
  try { return new URL(req.url || "", "http://x").pathname.replace(/^\/api\//, "").replace(/[^a-z]/g, "") || "other"; } catch { return "other"; }
};

/** Wrap an API handler so everything it uses is counted and saved at the end. */
export function withUsage(handler) {
  return (req, res) => {
    const ctx = { route: routeName(req), user: "", counts: new Map(), started: Date.now() };
    return als.run(ctx, async () => {
      try {
        return await handler(req, res);
      } finally {
        await flush(ctx).catch((err) => console.error("usage flush failed", err.message));
      }
    });
  };
}

export function count(field, n = 1) {
  const c = als.getStore();
  if (c && n) c.counts.set(field, (c.counts.get(field) || 0) + n);
}
export const setUsageUser = (id) => { const c = als.getStore(); if (c) c.user = id; };

async function flush(ctx) {
  if (!kvConfigured()) return;
  ctx.counts.set(`fn:${ctx.route}`, 1);
  ctx.counts.set(`fnms:${ctx.route}`, Date.now() - ctx.started);
  const now = new Date();
  const m = `use:m:${monthOf(now)}`, d = `use:d:${dayOf(now)}`, u = `use:u:${monthOf(now)}`;
  const fields = [...ctx.counts.entries()].filter(([, n]) => n);
  const perUser = ctx.user ? fields.filter(([f]) => !f.startsWith("kv:") && !f.startsWith("fnms:")) : [];
  // the save itself is database work too – count it in the same batch
  const saveCmds = fields.length * 2 + perUser.length + 3 + 1;
  ctx.counts.set("kv:cmds", (ctx.counts.get("kv:cmds") || 0) + saveCmds);
  const all = [...ctx.counts.entries()].filter(([, n]) => n);
  const cmds = [];
  for (const [f, n] of all) { cmds.push(["HINCRBY", m, f, Math.round(n)], ["HINCRBY", d, f, Math.round(n)]); }
  for (const [f, n] of perUser) cmds.push(["HINCRBY", u, `${ctx.user}|${f}`, Math.round(n)]);
  cmds.push(["EXPIRE", m, DAYS_KEPT * 2], ["EXPIRE", d, DAYS_KEPT], ["EXPIRE", u, DAYS_KEPT * 2]);
  await kvPipelineRaw(cmds);
}

/* ---------- settings + guards ---------- */
let cfgCache = { at: 0, value: null };
export async function costConfig(fresh = false) {
  if (!fresh && cfgCache.value && Date.now() - cfgCache.at < 15_000) return cfgCache.value;
  const raw = await kv(["GET", CFG_KEY]);
  const value = { ...DEFAULT_CFG, ...(raw ? JSON.parse(raw) : {}) };
  cfgCache = { at: Date.now(), value };
  return value;
}
export async function saveCostConfig(cfg) {
  await kv(["SET", CFG_KEY, JSON.stringify(cfg)]);
  cfgCache = { at: Date.now(), value: cfg };
}

/** Before a paid Claude call: is AI on, and is this month still under the cap? */
export async function aiAllowed() {
  const cfg = await costConfig();
  if (!cfg.aiEnabled) return { ok: false, reason: "AI guides are switched off by the admin." };
  const spent = (Number(await kv(["HGET", `use:m:${monthOf()}`, "ai:usd_micro"])) || 0) / 1e6;
  if (spent >= cfg.aiCapUsd) return { ok: false, reason: `This month's AI limit ($${cfg.aiCapUsd}) is reached – it resets on the 1st.` };
  return { ok: true, spent, cap: cfg.aiCapUsd };
}

/** Before a Google call: with "free allowance only" on, refuse once this month's free calls are used. */
export async function googleAllowed(sku) {
  const g = GOOGLE[sku];
  if (!g || !kvConfigured()) return { ok: true };
  const cfg = await costConfig();
  if (!cfg.googleFreeOnly) return { ok: true };
  const used = Number(await kv(["HGET", `use:m:${monthOf()}`, `g:${sku}`])) || 0;
  return used < g.free ? { ok: true } : { ok: false, reason: "This month's free Google allowance for this feature is used up – it resets on the 1st (switch it in 💰 Running costs)." };
}

/** Record one Claude reply: tokens and exact cost by the model that answered. */
export function recordClaude(response) {
  const u = response?.usage || {};
  const usd = claudeCost(response?.model || CLAUDE_DEFAULT, u);
  count("ai:guides");
  count("ai:in", u.input_tokens || 0);
  count("ai:out", u.output_tokens || 0);
  count("ai:cr", u.cache_read_input_tokens || 0);
  count("ai:cw", u.cache_creation_input_tokens || 0);
  count("ai:usd_micro", Math.round(usd * 1e6));
  return usd;
}
