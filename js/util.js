// Small shared helpers for the browser code.

export const DAY_MS = 24 * 60 * 60 * 1000;

/** localStorage can be unavailable (private mode, blocked): always guard. */
export const store = {
  get(key) {
    try { return JSON.parse(localStorage.getItem(key)); } catch { return null; }
  },
  set(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* full or blocked */ }
  },
  getFresh(key) {
    const v = store.get(key);
    return v && Date.now() - v.t < DAY_MS ? v.data : null;
  },
  setFresh(key, data) { store.set(key, { t: Date.now(), data }); },
  prune() {
    try {
      for (let i = localStorage.length - 1; i >= 0; i--) {
        const k = localStorage.key(i);
        if (!k.startsWith("cache:")) continue;
        const v = store.get(k);
        if (!v || Date.now() - v.t > DAY_MS) localStorage.removeItem(k);
      }
    } catch { /* ignore */ }
  },
};

export const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
export const r = (n, d) => Math.round(n * 10 ** d) / 10 ** d;
export const uid = () => Math.random().toString(36).slice(2, 10);

export function distanceKm(a, b) {
  const R = 6371, toRad = (x) => (x * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat), dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
export const fmtDist = (km) => (km < 1 ? `${Math.round(km * 100) * 10} m` : `${km.toFixed(km < 10 ? 1 : 0)} km`);

export async function getJSON(url) {
  const res = await fetch(url);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

/** Current day (0 = Sunday), minutes since midnight and date (YYYY-MM-DD), in Tokyo. */
export function tokyoNow() {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Tokyo", weekday: "short", hour: "numeric", minute: "numeric",
    year: "numeric", month: "2-digit", day: "2-digit", hourCycle: "h23",
  }).formatToParts(new Date());
  const get = (t) => parts.find((p) => p.type === t)?.value;
  const day = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(get("weekday"));
  return {
    day,
    minutes: Number(get("hour")) * 60 + Number(get("minute")),
    date: `${get("year")}-${get("month")}-${get("day")}`,
  };
}

/** true / false from Google's weekly opening periods, or null when unknown. */
export function isOpenNow(periods) {
  if (!Array.isArray(periods) || periods.length === 0) return null;
  const { day, minutes } = tokyoNow();
  const WEEK = 7 * 1440;
  const now = day * 1440 + minutes;
  for (const p of periods) {
    if (!p.open) continue;
    if (!p.close) return true; // open 24/7
    const open = p.open.day * 1440 + (p.open.hour || 0) * 60 + (p.open.minute || 0);
    let close = p.close.day * 1440 + (p.close.hour || 0) * 60 + (p.close.minute || 0);
    if (close <= open) close += WEEK;
    if ((now >= open && now < close) || (now + WEEK >= open && now + WEEK < close)) return true;
  }
  return false;
}

/** Google's weekdayDescriptions start on Monday. Returns the line for a date. */
export function hoursForDate(hours, isoDate) {
  if (!Array.isArray(hours) || hours.length !== 7) return null;
  const d = isoDate ? new Date(`${isoDate}T12:00:00+09:00`) : null;
  const sun0 = d && !Number.isNaN(d.getTime()) ? d.getUTCDay() : tokyoNow().day;
  return hours[(sun0 + 6) % 7];
}

export function fmtDate(isoDate) {
  if (!isoDate) return "";
  const d = new Date(`${isoDate}T12:00:00+09:00`);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-GB", { timeZone: "Asia/Tokyo", weekday: "short", day: "numeric", month: "short" });
}

export const PRICE = {
  PRICE_LEVEL_FREE: "Free",
  PRICE_LEVEL_INEXPENSIVE: "¥ (cheap)",
  PRICE_LEVEL_MODERATE: "¥¥ (moderate)",
  PRICE_LEVEL_EXPENSIVE: "¥¥¥ (pricey)",
  PRICE_LEVEL_VERY_EXPENSIVE: "¥¥¥¥ (very pricey)",
};

/** Google Maps directions link (no key needed). */
export function navUrl(from, to, mode = "transit") {
  let u = `https://www.google.com/maps/dir/?api=1&origin=${from.lat},${from.lng}&destination=${to.lat},${to.lng}&travelmode=${mode}`;
  if (to.id && !String(to.id).startsWith("pin-")) {
    u = `https://www.google.com/maps/dir/?api=1&origin=${from.lat},${from.lng}` +
      `&destination=${encodeURIComponent(to.name || `${to.lat},${to.lng}`)}&destination_place_id=${encodeURIComponent(to.id)}&travelmode=${mode}`;
  }
  return u;
}
