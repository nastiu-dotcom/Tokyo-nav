// Wallet maths without page code (tested in Node): what's left, today's
// allowance, the pace, and breakdowns by category, country and day.
// All money here is in ₪ (expenses carry their ₪ value).

export const CATEGORIES = [
  ["food", "🍜"], ["transport", "🚆"], ["fun", "🎢"], ["shopping", "🛍️"],
  ["stay", "🏨"], ["flights", "✈️"], ["essentials", "📱"], ["other", "🎁"],
];
const DAY = 86400000;
const ms = (iso) => Date.parse(`${iso}T00:00:00Z`);
export const daysBetween = (a, b) => Math.round((ms(b) - ms(a)) / DAY);
export const addDays = (iso, n) => new Date(ms(iso) + n * DAY).toISOString().slice(0, 10);
const sum = (list, f = (x) => x) => list.reduce((s, x) => s + (Number(f(x)) || 0), 0);

/**
 * @param {{expenses, booked, budget, range: {start, end}, plan, today}} w
 */
export function summarize({ expenses = [], booked = [], budget = 0, range = null, plan = {}, today }) {
  const bookedIls = sum(booked, (b) => b.ils);
  const spent = sum(expenses, (e) => e.ils);
  const spentToday = sum(expenses.filter((e) => e.date === today), (e) => e.ils);
  const spentBefore = sum(expenses.filter((e) => e.date < today), (e) => e.ils);
  const left = budget - bookedIls - spent;
  const out = { budget, bookedIls, spent, spentToday, left, used: bookedIls + spent, phase: "none" };

  if (range) {
    const totalDays = daysBetween(range.start, range.end) + 1;
    out.totalDays = totalDays;
    if (today < range.start) {
      out.phase = "before";
      out.daysToGo = daysBetween(today, range.start);
      out.daily = (budget - bookedIls - spent) / totalDays; // everything not booked, spread over the trip
    } else if (today > range.end) {
      out.phase = "after";
    } else {
      out.phase = "during";
      out.day = daysBetween(range.start, today) + 1;
      out.daysLeft = daysBetween(today, range.end) + 1; // today included
      out.daily = (budget - bookedIls - spentBefore) / out.daysLeft;
      out.todayLeft = out.daily - spentToday;
      // pace: daily spending so far (inside the trip) carried to the end
      const tripSpent = sum(expenses.filter((e) => e.date >= range.start && e.date <= today), (e) => e.ils);
      out.avgPerDay = tripSpent / out.day;
      out.projected = bookedIls + spent + out.avgPerDay * (out.daysLeft - 1);
      out.onTrack = out.projected <= budget;
    }
  }

  // by category (booked flights / stays count too)
  out.byCategory = CATEGORIES.map(([id, icon]) => {
    const exp = sum(expenses.filter((e) => e.category === id), (e) => e.ils);
    const bk = sum(booked.filter((b) => b.category === id), (b) => b.ils);
    return { id, icon, spent: exp + bk, booked: bk, plan: Number(plan?.[id]) || 0 };
  });
  out.planTotal = sum(out.byCategory, (c) => c.plan);

  // by country (expenses only)
  const byCountry = {};
  for (const e of expenses) byCountry[e.country || "XX"] = (byCountry[e.country || "XX"] || 0) + e.ils;
  out.byCountry = byCountry;

  // by day (expenses only)
  const byDay = {};
  for (const e of expenses) byDay[e.date] = (byDay[e.date] || 0) + e.ils;
  out.byDay = byDay;
  return out;
}

/** Days to chart: the trip (until today), or the last 30 days before it starts. */
export function chartDays(range, today) {
  if (range && today >= range.start) {
    const end = today < range.end ? today : range.end;
    const n = daysBetween(range.start, end) + 1;
    return Array.from({ length: n }, (_, i) => addDays(range.start, i));
  }
  return Array.from({ length: 30 }, (_, i) => addDays(today, i - 29));
}

/** Which currency to suggest on a date: the country's money. */
export function currencyFor(segments, date) {
  const seg = (segments || []).find((s) => date >= s.from && date < s.to) || (segments || []).find((s) => date === s.to);
  return { TH: "THB", JP: "JPY", IL: "ILS" }[seg?.country] || null;
}
export function countryFor(segments, date) {
  const seg = (segments || []).find((s) => date >= s.from && date < s.to) || (segments || []).find((s) => date === s.to);
  return seg?.country || "";
}

/** CSV for a spreadsheet (Excel / Google Sheets). */
export function toCsv(expenses, names = {}) {
  const q = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const head = ["date", "category", "note", "amount", "currency", "ILS", "rate", "payment", "country", "by"];
  const rows = [...expenses].sort((a, b) => a.date.localeCompare(b.date)).map((e) => [
    e.date, e.category, e.note, e.amount, e.currency, e.ils, Number(e.rate).toFixed(5), e.method, e.country, names[e.by] || e.by,
  ].map(q).join(","));
  return "﻿" + [head.join(","), ...rows].join("\r\n"); // BOM so Excel reads Hebrew
}
