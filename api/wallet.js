// 💰 Wallet: the trip budget. Grown-ups only (kids never see money).
// GET  /api/wallet[?v=…]  → expenses, category plan, budget + dates, booked
//                            flights/stays from the timeline (in ₪), rates
// POST /api/wallet
//   {action: "save",   expense}       add or edit (id made on the phone, so offline retries are safe)
//   {action: "remove", id}
//   {action: "plan",   plan}          budget per category, in ₪
//   {action: "rates",  rates}         admin: hand-typed ₪ per unit (0 clears)
// Storage: wallet:exp (hash id → JSON, so two phones adding at once never clash),
//          wallet:v (version), wallet:plan (JSON).
import { HttpError, handleJson } from "../lib/common.js";
import { CURRENCIES, getRates, setManualRates } from "../lib/fx.js";
import { kv, kvPipeline } from "../lib/kv.js";
import { requireAdmin, requireAdult } from "../lib/users.js";

export const CATEGORIES = ["food", "transport", "fun", "shopping", "stay", "flights", "essentials", "other"];
const MAX = 5000;
const clip = (s, n) => String(s ?? "").replace(/[\u0000-\u001f]/g, " ").trim().slice(0, n);
const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`));
const round2 = (n) => Math.round(n * 100) / 100;

/** Validate an expense and work out its ₪ value. */
export function cleanExpense(e, rates, by) {
  if (!/^[a-z0-9]{8,24}$/.test(String(e?.id || ""))) throw new HttpError(400, "Bad expense id");
  const amount = Number(e.amount);
  if (!(Number.isFinite(amount) && amount > 0 && amount < 100_000_000)) throw new HttpError(400, "Type an amount");
  const currency = CURRENCIES.includes(e.currency) ? e.currency : "ILS";
  if (!isDate(e.date)) throw new HttpError(400, "Pick a date");
  let ils, rate, exact = false;
  const typed = Number(e.ilsExact);
  if (e.ilsExact !== undefined && e.ilsExact !== null && e.ilsExact !== "" && Number.isFinite(typed) && typed > 0) {
    ils = typed; rate = typed / amount; exact = true; // e.g. the card statement says ₪
  } else {
    rate = currency === "ILS" ? 1 : rates.ilsPer[currency];
    if (!(rate > 0)) throw new HttpError(409, `No exchange rate for ${currency} yet – type the ₪ amount too`);
    ils = amount * rate;
  }
  return {
    id: e.id, date: e.date, amount: round2(amount), currency, ils: round2(ils), rate, exact,
    category: CATEGORIES.includes(e.category) ? e.category : "other",
    method: e.method === "cash" ? "cash" : "card",
    note: clip(e.note, 120), country: ["TH", "JP", "IL", "XX"].includes(e.country) ? e.country : "",
    by: e.by && /^[\p{L}\p{N}._-]{1,30}$/u.test(e.by) ? e.by : by,
    created: isDate(String(e.created || "").slice(0, 10)) ? e.created : new Date().toISOString(),
    updated: new Date().toISOString(),
  };
}

/** Flights and stays with a price in the timeline, in ₪ (counted as already spent). */
export function bookedFromTimeline(timeline, rates) {
  return (timeline?.items || []).filter((it) => it.price != null && it.price !== "" && (it.kind === "flight" || it.kind === "stay")).map((it) => {
    const rate = (it.currency || "ILS") === "ILS" ? 1 : rates.ilsPer[it.currency];
    return {
      id: it.id, kind: it.kind, label: it.kind === "flight" ? `${it.from} → ${it.to}` : it.name,
      date: it.kind === "stay" ? it.checkIn : it.date, price: Number(it.price), currency: it.currency || "ILS",
      ils: rate > 0 ? round2(Number(it.price) * rate) : null,
      category: it.kind === "flight" ? "flights" : "stay",
    };
  });
}

export default handleJson(async (req, res, body) => {
  const me = await requireAdult(req);

  if (req.method === "GET") {
    const [v, tlRaw] = await kv(["MGET", "wallet:v", "trip:timeline"]);
    const timeline = tlRaw ? JSON.parse(tlRaw) : null;
    const version = `${Number(v) || 0}.${timeline?.v || 0}`;
    if (req.query.v && req.query.v === version) return { unchanged: true, v: version };
    const [expRaw, planRaw] = await kvPipeline([["HGETALL", "wallet:exp"], ["GET", "wallet:plan"]]);
    const expenses = [];
    for (let i = 1; i < (expRaw || []).length; i += 2) expenses.push(JSON.parse(expRaw[i]));
    expenses.sort((a, b) => (b.date + b.created).localeCompare(a.date + a.created));
    const rates = await getRates();
    const segs = [...(timeline?.segments || [])].sort((a, b) => a.from.localeCompare(b.from));
    return {
      v: version, expenses, plan: planRaw ? JSON.parse(planRaw) : {},
      budget: { total: Number(timeline?.trip?.budget ?? 80000), currency: timeline?.trip?.currency || "ILS" },
      range: segs.length ? { start: segs[0].from, end: segs.reduce((m, s) => (s.to > m ? s.to : m), segs[0].to) } : null,
      segments: segs.map(({ id, country, from, to }) => ({ id, country, from, to })),
      booked: bookedFromTimeline(timeline, rates),
      rates, me: { id: me.id, role: me.role },
    };
  }

  let out = {};
  switch (body.action) {
    case "save": {
      const rates = await getRates();
      const existing = await kv(["HGET", "wallet:exp", String(body.expense?.id || "")]);
      if (!existing && Number(await kv(["HLEN", "wallet:exp"])) >= MAX) throw new HttpError(409, "The wallet is full");
      const prev = existing ? JSON.parse(existing) : null;
      const expense = cleanExpense({ ...body.expense, created: prev?.created, by: prev?.by }, rates, me.id);
      await kvPipeline([["HSET", "wallet:exp", expense.id, JSON.stringify(expense)], ["INCR", "wallet:v"]]);
      out = { expense };
      break;
    }
    case "remove":
      await kvPipeline([["HDEL", "wallet:exp", clip(body.id, 24)], ["INCR", "wallet:v"]]);
      break;
    case "plan": {
      const plan = {};
      for (const c of CATEGORIES) {
        const n = Number(body.plan?.[c]);
        if (Number.isFinite(n) && n > 0 && n < 100_000_000) plan[c] = Math.round(n);
      }
      await kvPipeline([["SET", "wallet:plan", JSON.stringify(plan)], ["INCR", "wallet:v"]]);
      out = { plan };
      break;
    }
    case "rates": {
      await requireAdmin(req);
      await setManualRates(body.rates || {});
      await kv(["INCR", "wallet:v"]);
      out = { rates: await getRates() };
      break;
    }
    default:
      throw new HttpError(400, "Unknown action");
  }
  return { ok: true, ...out };
});
