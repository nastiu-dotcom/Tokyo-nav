// 💰 Running costs (admins only): what this app used and what it costs,
// recorded by lib/usage.js on every API call.
// GET  /api/usage[?month=YYYY-MM]  → dashboard data
// POST /api/usage {action: "settings", aiEnabled, aiCapUsd, googleFreeOnly}
import { HttpError, handleJson } from "../lib/common.js";
import { kv, kvPipeline } from "../lib/kv.js";
import { CLAUDE, GOOGLE, LIMITS, PRICES_CHECKED, googleCost } from "../lib/prices.js";
import { costConfig, monthOf, saveCostConfig } from "../lib/usage.js";
import { loadUsers, requireAdmin } from "../lib/users.js";

const toObj = (arr) => {
  const o = {};
  for (let i = 0; i + 1 < (arr || []).length; i += 2) o[arr[i]] = Number(arr[i + 1]) || 0;
  return o;
};
const daysOfMonth = (month) => {
  const [y, m] = month.split("-").map(Number);
  const n = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const today = new Date().toISOString().slice(0, 10);
  return Array.from({ length: n }, (_, i) => `${month}-${String(i + 1).padStart(2, "0")}`).filter((d) => d <= today);
};

async function storage() {
  const keys = [];
  let cursor = "0";
  for (let i = 0; i < 20; i++) {
    const [next, batch] = await kv(["SCAN", cursor, "COUNT", "1000"]);
    keys.push(...batch);
    cursor = String(next);
    if (cursor === "0") break;
  }
  const types = keys.length ? await kvPipeline(keys.map((k) => ["TYPE", k])) : [];
  const sizes = keys.length ? await kvPipeline(keys.map((k, i) => (types[i] === "hash" ? ["HLEN", k] : ["STRLEN", k]))) : [];
  const groups = {};
  let bytes = 0;
  keys.forEach((k, i) => {
    const b = types[i] === "hash" ? Number(sizes[i]) * 48 : Number(sizes[i]) + k.length; // hashes: ~48 bytes a field
    const g = k.split(":")[0];
    groups[g] = groups[g] || { keys: 0, bytes: 0 };
    groups[g].keys += 1;
    groups[g].bytes += b;
    bytes += b;
  });
  return { keys: keys.length, bytes, groups };
}

export default handleJson(async (req, res, body) => {
  await requireAdmin(req);

  if (req.method === "POST") {
    if (body.action !== "settings") throw new HttpError(400, "Unknown action");
    const cap = Number(body.aiCapUsd);
    if (!(Number.isFinite(cap) && cap >= 0 && cap <= 1000)) throw new HttpError(400, "The AI limit must be between $0 and $1000");
    const cfg = { aiEnabled: !!body.aiEnabled, aiCapUsd: Math.round(cap * 100) / 100, googleFreeOnly: !!body.googleFreeOnly };
    await saveCostConfig(cfg);
    return { cfg };
  }

  const month = /^\d{4}-\d{2}$/.test(req.query.month || "") ? req.query.month : monthOf();
  const days = daysOfMonth(month);
  const [mRaw, uRaw, ...dRaw] = await kvPipeline([
    ["HGETALL", `use:m:${month}`], ["HGETALL", `use:u:${month}`], ...days.map((d) => ["HGETALL", `use:d:${d}`]),
  ]);
  const m = toObj(mRaw);
  const [cfg, users, store] = await Promise.all([costConfig(true), loadUsers(), storage()]);

  const google = Object.entries(GOOGLE).map(([sku, g]) => ({
    sku, label: g.label, free: g.free, per1000: g.per1000,
    calls: m[`g:${sku}`] || 0, blocked: m[`g:blocked:${sku}`] || 0, usd: googleCost(sku, m[`g:${sku}`] || 0),
  }));
  const ai = {
    guides: m["ai:guides"] || 0, in: m["ai:in"] || 0, out: m["ai:out"] || 0, cacheRead: m["ai:cr"] || 0, cacheWrite: m["ai:cw"] || 0,
    usd: (m["ai:usd_micro"] || 0) / 1e6, blocked: m["ai:blocked"] || 0, enabled: cfg.aiEnabled, cap: cfg.aiCapUsd,
    configured: Boolean(process.env.ANTHROPIC_API_KEY), price: CLAUDE["claude-opus-5-5"],
  };
  const functions = Object.keys(m).filter((k) => k.startsWith("fn:")).map((k) => {
    const route = k.slice(3);
    return { route, calls: m[k], avgMs: m[k] ? Math.round((m[`fnms:${route}`] || 0) / m[k]) : 0 };
  }).sort((a, b) => b.calls - a.calls);

  // per user: "<id>|<field>" → n
  const per = {};
  for (const [k, n] of Object.entries(toObj(uRaw))) {
    const [id, f] = [k.slice(0, k.indexOf("|")), k.slice(k.indexOf("|") + 1)];
    const p = (per[id] ||= { id, name: users.users[id]?.name || id, role: users.users[id]?.role || "", google: 0, aiGuides: 0, aiUsd: 0, apiCalls: 0 });
    if (f.startsWith("g:") && !f.startsWith("g:blocked:")) p.google += n;
    else if (f === "ai:guides") p.aiGuides += n;
    else if (f === "ai:usd_micro") p.aiUsd += n / 1e6;
    else if (f.startsWith("fn:")) p.apiCalls += n;
  }

  const daily = days.map((d, i) => {
    const o = toObj(dRaw[i]);
    return {
      date: d,
      google: Object.fromEntries(Object.keys(GOOGLE).map((sku) => [sku, o[`g:${sku}`] || 0])),
      aiUsd: (o["ai:usd_micro"] || 0) / 1e6, aiGuides: o["ai:guides"] || 0,
      kv: o["kv:cmds"] || 0, fn: Object.keys(o).filter((k) => k.startsWith("fn:")).reduce((s, k) => s + o[k], 0),
    };
  });

  const googleUsd = google.reduce((s, g) => s + g.usd, 0);
  return {
    month, today: new Date().toISOString().slice(0, 10), checked: PRICES_CHECKED, cfg,
    total: { usd: googleUsd + ai.usd, googleUsd, aiUsd: ai.usd },
    google, ai,
    redis: { commands: m["kv:cmds"] || 0, limit: LIMITS.redisCommands, bytesLimit: LIMITS.redisBytes, ...store },
    functions, functionTotal: functions.reduce((s, f) => s + f.calls, 0), functionLimit: LIMITS.functionRuns,
    users: Object.values(per).sort((a, b) => b.apiCalls - a.apiCalls),
    daily,
  };
});
