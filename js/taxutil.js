// Pure helpers for the tax-refund tab (no DOM – unit-tested in Node).

export const RATES = { standard: 10, reduced: 8 }; // % – goods 10 %, food & drinks 8 %
export const MIN_PER_SHOP_DAY = 5000; // ¥ before tax, per shop per day
export const EXPORT_DAYS = 90; // goods must leave Japan within 90 days of purchase

/** Tax contained in a tax-included price (what you can get back). */
export function refundEstimate(paidYen, rate = "standard") {
  const r = RATES[rate] ?? RATES.standard;
  const n = Math.max(0, Number(paidYen) || 0);
  return Math.floor((n * r) / (100 + r)); // integer maths: ¥11,000 at 10 % -> ¥1,000
}

export const priceBeforeTax = (paidYen, rate = "standard") => (Number(paidYen) || 0) - refundEstimate(paidYen, rate);

/** Last day to take the goods out of Japan (YYYY-MM-DD). */
export function exportDeadline(isoDate) {
  const d = new Date(`${isoDate}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) return "";
  d.setUTCDate(d.getUTCDate() + EXPORT_DAYS);
  return d.toISOString().slice(0, 10);
}

/**
 * Groups purchases by shop + day and flags groups under the ¥5,000 minimum
 * (each shop/day counts separately unless the shop uses a shared counter).
 */
export function minimumCheck(records) {
  const groups = new Map();
  for (const r of records) {
    const k = `${(r.shop || "").trim().toLowerCase()}|${r.date}`;
    const g = groups.get(k) || { shop: r.shop, date: r.date, beforeTax: 0, ids: [] };
    g.beforeTax += priceBeforeTax(r.amount, r.rate);
    g.ids.push(r.id);
    groups.set(k, g);
  }
  return [...groups.values()].map((g) => ({ ...g, ok: g.beforeTax >= MIN_PER_SHOP_DAY }));
}

export function summary(records) {
  const pending = records.filter((r) => r.status !== "refunded");
  return {
    count: records.length,
    paid: records.reduce((n, r) => n + (Number(r.amount) || 0), 0),
    refund: records.reduce((n, r) => n + refundEstimate(r.amount, r.rate), 0),
    pendingRefund: pending.reduce((n, r) => n + refundEstimate(r.amount, r.rate), 0),
    pending: pending.length,
  };
}

export const yen = (n) => `¥${Math.round(Number(n) || 0).toLocaleString("en-US")}`;
