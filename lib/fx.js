// Exchange rates for the Wallet: how many ₪ one unit of each currency is worth.
// Source: Frankfurter (free, no key; European Central Bank reference rates,
// updated on working days). Saved in Upstash; refreshed at most every 6 hours.
// If the source can't be reached, the last saved rates are used; an admin can
// also type rates by hand (they win over the automatic ones).
import { kv } from "./kv.js";

export const CURRENCIES = ["ILS", "THB", "JPY", "USD", "EUR"];
const KEY = "fx:latest";
const MANUAL = "fx:manual";
const MAX_AGE = 6 * 3600 * 1000;
const SOURCES = [
  "https://api.frankfurter.dev/v1/latest?base=ILS&symbols=THB,JPY,USD,EUR",
  "https://api.frankfurter.app/latest?from=ILS&to=THB,JPY,USD,EUR",
];

/** {THB: 0.1, ...} as ₪ per unit, from a "1 ILS = x units" table. */
export function perUnit(rates) {
  const out = { ILS: 1 };
  for (const c of CURRENCIES) if (c !== "ILS" && Number(rates?.[c]) > 0) out[c] = 1 / Number(rates[c]);
  return out;
}

async function fetchRates() {
  for (const url of SOURCES) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(6000) });
      if (!r.ok) continue;
      const d = await r.json();
      if (d && d.rates && Number(d.rates.THB) > 0 && Number(d.rates.JPY) > 0) {
        return { date: String(d.date || "").slice(0, 10), ilsPer: perUnit(d.rates), source: "ECB (frankfurter)", fetchedAt: new Date().toISOString() };
      }
    } catch { /* try the next one */ }
  }
  return null;
}

/** Current rates: {ilsPer: {THB: …}, date, source, manual: {…}, stale?} or {ilsPer: {ILS: 1}, missing: true}. */
export async function getRates() {
  const [rawAuto, rawManual] = await kv(["MGET", KEY, MANUAL]);
  let auto = rawAuto ? JSON.parse(rawAuto) : null;
  if (!auto || Date.now() - Date.parse(auto.fetchedAt) > MAX_AGE) {
    const fresh = await fetchRates();
    if (fresh) { auto = fresh; await kv(["SET", KEY, JSON.stringify(fresh)]); } else if (auto) auto = { ...auto, stale: true };
  }
  const manual = rawManual ? JSON.parse(rawManual) : {};
  const ilsPer = { ILS: 1, ...(auto?.ilsPer || {}), ...manual };
  const missing = CURRENCIES.filter((c) => !(ilsPer[c] > 0));
  return { ilsPer, date: auto?.date || "", source: auto?.source || "", stale: !!auto?.stale, manual, missing };
}

/** Admin: set (or clear with 0) a hand-typed rate, ₪ per unit. */
export async function setManualRates(rates) {
  const raw = await kv(["GET", MANUAL]);
  const manual = raw ? JSON.parse(raw) : {};
  for (const c of CURRENCIES) {
    if (c === "ILS" || !(c in rates)) continue;
    const v = Number(rates[c]);
    if (v > 0 && v < 100) manual[c] = v; else delete manual[c];
  }
  await kv(["SET", MANUAL, JSON.stringify(manual)]);
  return manual;
}
