// Whole-trip logic without any page code (so it can be tested in Node):
// where are we, what's next, which nights have no bed, which Tokyo plan days
// clash with the timeline, and what the booked flights + stays cost.

export const COUNTRY = {
  TH: { flag: "🇹🇭", name: "Thailand", bg: "#D6F2F0", ink: "#0B6E69" },
  JP: { flag: "🇯🇵", name: "Japan", bg: "#FDE1EA", ink: "#B0245F" },
  IL: { flag: "🇮🇱", name: "Israel", bg: "#DCEBFF", ink: "#1C5DAA" },
  XX: { flag: "🌍", name: "Other", bg: "#FFF3C4", ink: "#7A5D00" },
};
export const CURRENCY = { ILS: "₪", THB: "฿", JPY: "¥", USD: "$", EUR: "€" };

const DAY = 86400000;
const ms = (iso) => Date.parse(`${iso}T00:00:00Z`);
export const addDays = (iso, n) => new Date(ms(iso) + n * DAY).toISOString().slice(0, 10);
export const daysBetween = (a, b) => Math.round((ms(b) - ms(a)) / DAY);

/** First and last calendar day of the trip. */
export function tripRange(doc) {
  const segs = doc?.segments || [];
  if (!segs.length) return null;
  return { start: segs.reduce((m, s) => (s.from < m ? s.from : m), segs[0].from), end: segs.reduce((m, s) => (s.to > m ? s.to : m), segs[0].to) };
}

/** Which country we're in on a date. The last day of the trip counts as the last country. */
export function segmentFor(doc, date) {
  const segs = [...(doc?.segments || [])].sort((a, b) => a.from.localeCompare(b.from));
  const hit = segs.find((s) => date >= s.from && date < s.to);
  if (hit) return hit;
  const last = segs[segs.length - 1];
  return last && date === last.to ? last : null;
}

/** Which country an item belongs to: flights by where they land, stays by check-in. */
export function itemSegment(doc, it) {
  if (it.kind === "flight") return segmentFor(doc, it.arrDate || it.date) || segmentFor(doc, it.date);
  return segmentFor(doc, it.kind === "stay" ? it.checkIn : it.date);
}

/** When an item happens, for sorting: "YYYY-MM-DD HH:MM". */
export const when = (it) => (it.kind === "stay" ? `${it.checkIn} 15:00` : `${it.date} ${it.time || "12:00"}`);
export const sortItems = (items) => [...(items || [])].sort((a, b) => when(a).localeCompare(when(b)));

/** Where we are today: before / during / after, day N of M, the current country. */
export function status(doc, today) {
  const r = tripRange(doc);
  if (!r) return null;
  const total = daysBetween(r.start, r.end) + 1;
  if (today < r.start) return { phase: "before", daysToGo: daysBetween(today, r.start), total, ...r };
  if (today > r.end) return { phase: "after", total, ...r };
  return { phase: "during", day: daysBetween(r.start, today) + 1, total, segment: segmentFor(doc, today), ...r };
}

/** The next flight / stay / note from today on (in-progress stays don't count). */
export function nextItem(doc, today) {
  return sortItems(doc?.items).find((it) => (it.kind === "stay" ? it.checkIn : it.date) >= today) || null;
}

function nightsCovered(doc) {
  const beds = new Map(); // night date → stays
  const air = new Set();
  for (const it of doc?.items || []) {
    if (it.kind === "stay") {
      for (let d = it.checkIn; d < it.checkOut; d = addDays(d, 1)) beds.set(d, [...(beds.get(d) || []), it]);
    } else if (it.kind === "flight" && it.arrDate && it.arrDate > it.date) {
      for (let d = it.date; d < it.arrDate; d = addDays(d, 1)) air.add(d); // overnight flight
    }
  }
  return { beds, air };
}

/** Nights inside the trip with no stay booked (and not on a plane), as ranges. */
export function missingNights(doc) {
  const r = tripRange(doc);
  if (!r) return [];
  const { beds, air } = nightsCovered(doc);
  const out = [];
  for (let d = r.start; d < r.end; d = addDays(d, 1)) {
    if (beds.has(d) || air.has(d)) continue;
    const last = out[out.length - 1];
    if (last && last.to === d) { last.to = addDays(d, 1); last.nights += 1; } else out.push({ from: d, to: addDays(d, 1), nights: 1 });
  }
  return out;
}

/** Nights with two stays booked at once. */
export function doubleBooked(doc) {
  const { beds } = nightsCovered(doc);
  return [...beds.entries()].filter(([, list]) => list.length > 1).map(([night, list]) => ({ night, names: list.map((s) => s.name) }));
}

/** Tokyo plan days dated when the timeline says we're not in Japan. */
export function planClashes(doc, planDays) {
  if (!doc?.segments?.length) return [];
  return (planDays || []).map((d, i) => ({ ...d, index: i })).filter((d) => d.date).flatMap((d) => {
    const seg = segmentFor(doc, d.date);
    return seg?.country === "JP" ? [] : [{ index: d.index, date: d.date, country: seg?.country || null }];
  });
}

/** Booked flight + stay prices, per currency (kids' copies have none). */
export function fixedCosts(doc) {
  const sums = {};
  for (const it of doc?.items || []) {
    if (it.price == null || it.price === "") continue;
    sums[it.currency || "ILS"] = (sums[it.currency || "ILS"] || 0) + Number(it.price);
  }
  return sums;
}

export const nights = (s) => daysBetween(s.from, s.to);

/* ---------- holidays, plan dates, hotel starts ---------- */

/** Japan's Golden Week (29 Apr – 5 May, every year): crowds, higher prices, book ahead. */
export function goldenWeek(date) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || "")) return false;
  const md = date.slice(5);
  return md >= "04-29" && md <= "05-05";
}

/** Golden Week ranges that fall inside the Japan part of the trip. */
export function holidayNotes(doc) {
  const out = [];
  for (const s of doc?.segments || []) {
    if (s.country !== "JP") continue;
    for (let y = Number(s.from.slice(0, 4)); y <= Number(s.to.slice(0, 4)); y++) {
      const from = `${y}-04-29`, to = `${y}-05-05`;
      if (to >= s.from && from <= s.to) out.push({ kind: "holiday", id: `gw${y}`, date: from > s.from ? from : s.from, to: to < s.to ? to : s.to, segment: s.id });
    }
  }
  return out;
}

/** The date the Tokyo plan should start on: the first day in Japan (if plan days clash). */
export function planShiftTarget(doc, planDays) {
  if (!planClashes(doc, planDays).length) return null;
  const jp = [...(doc?.segments || [])].filter((s) => s.country === "JP").sort((a, b) => a.from.localeCompare(b.from))[0];
  const first = (planDays || []).map((d) => d.date).filter(Boolean).sort()[0];
  return jp && first && first !== jp.from ? { from: first, to: jp.from, days: daysBetween(first, jp.from) } : null;
}

const far = (a, b) => !a || !Number.isFinite(a.lat) || Math.abs(a.lat - b.lat) > 0.003 || Math.abs(a.lng - b.lng) > 0.003;
/** Plan days whose start isn't the hotel booked for that night (hotels located with 📍 only). */
export function startSuggestions(doc, planDays) {
  const stays = (doc?.items || []).filter((it) => it.kind === "stay" && Number.isFinite(it.lat));
  const byStay = new Map();
  (planDays || []).forEach((d, index) => {
    if (!d.date) return;
    const stay = stays.find((s) => d.date >= s.checkIn && d.date < s.checkOut);
    if (stay && far(d.start, stay)) byStay.set(stay.id, { stay, days: [...(byStay.get(stay.id)?.days || []), index] });
  });
  return [...byStay.values()];
}
