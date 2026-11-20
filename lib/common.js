// Shared helpers for the Vercel serverless functions.
// Files in /lib are not routes; only files in /api are.
import { requireUser } from "./users.js";
import { count, googleAllowed, withUsage } from "./usage.js";

const DAY = 60 * 60 * 24;

// The trip's countries (rough boxes). Requests outside them are refused, so the
// keys can't be used as a free worldwide Places/Routes proxy.
export const AREAS = {
  JP: { minLat: 24.0, maxLat: 45.7, minLng: 122.9, maxLng: 146.0, region: "JP" },
  TH: { minLat: 5.5, maxLat: 20.6, minLng: 97.3, maxLng: 105.7, region: "TH" },
};
/** "JP", "TH" or null. */
export function areaOf(lat, lng) {
  for (const [code, b] of Object.entries(AREAS)) {
    if (lat >= b.minLat && lat <= b.maxLat && lng >= b.minLng && lng <= b.maxLng) return code;
  }
  return null;
}

export function parseLatLng(value) {
  if (typeof value !== "string") return null;
  const parts = value.split(",").map(Number);
  if (parts.length !== 2 || parts.some((n) => !Number.isFinite(n))) return null;
  const [lat, lng] = parts;
  const area = areaOf(lat, lng);
  return area ? { lat, lng, area } : null;
}

export function round(n, digits) {
  const f = 10 ** digits;
  return Math.round(n * f) / f;
}

/** Cache in Vercel's CDN (shared by every visitor) for `seconds`. */
export function cacheFor(res, seconds) {
  res.setHeader(
    "Cache-Control",
    `public, max-age=0, s-maxage=${seconds}, stale-while-revalidate=${Math.min(seconds, 3600)}`,
  );
}
export const ONE_DAY = DAY;

export function noStore(res) {
  res.setHeader("Cache-Control", "no-store");
}

export function sendError(res, status, message) {
  noStore(res);
  res.status(status).json({ error: message });
}

export function requireGet(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    sendError(res, 405, "Method not allowed");
    return false;
  }
  return true;
}

export function googleKey() {
  const key = process.env.GOOGLE_MAPS_API_KEY;
  if (!key) throw new HttpError(500, "Server is missing GOOGLE_MAPS_API_KEY");
  return key;
}

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

/** Call a Google Maps Platform REST endpoint with an API key and field mask. */
export async function googleFetch(url, { method = "GET", body, fieldMask, sku }) {
  if (sku) {
    const allowed = await googleAllowed(sku);
    if (!allowed.ok) { count(`g:blocked:${sku}`); throw new HttpError(429, allowed.reason); }
  }
  const headers = {
    "X-Goog-Api-Key": googleKey(),
    "X-Goog-FieldMask": fieldMask,
  };
  if (body) headers["Content-Type"] = "application/json";
  if (sku) count(`g:${sku}`); // sent to Google = billed by Google (even if it then fails)
  const r = await fetch(url, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    const msg = data?.error?.message || `Google API error ${r.status}`;
    console.error("Google API error", r.status, msg);
    throw new HttpError(502, msg);
  }
  return data;
}

/** Tiny per-instance memory cache (helps while a function instance is warm). */
const memory = new Map();
export async function memo(key, ttlSeconds, fn) {
  const hit = memory.get(key);
  if (hit && hit.expires > Date.now()) return hit.value;
  const value = await fn();
  memory.set(key, { value, expires: Date.now() + ttlSeconds * 1000 });
  if (memory.size > 500) memory.delete(memory.keys().next().value);
  return value;
}

/** GET endpoint: logged-in users only, errors become JSON. */
export function handle(fn) {
  return withUsage(async (req, res) => {
    if (!requireGet(req, res)) return;
    try {
      await requireUser(req);
      await fn(req, res);
    } catch (err) {
      const status = err instanceof HttpError ? err.status : 500;
      if (status === 500) console.error(err);
      sendError(res, status, err.message || "Something went wrong");
    }
  });
}

/** GET + POST JSON endpoint (no login check – call requireUser yourself). */
export function handleJson(fn) {
  return withUsage(async (req, res) => {
    noStore(res);
    try {
      if (req.method !== "GET" && req.method !== "POST") {
        res.setHeader("Allow", "GET, POST");
        throw new HttpError(405, "Method not allowed");
      }
      const body = req.method === "POST" ? (typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {}) : {};
      const out = await fn(req, res, body);
      if (out !== undefined) res.status(200).json(out);
    } catch (err) {
      const status = err instanceof HttpError ? err.status : err instanceof SyntaxError ? 400 : 500;
      if (status === 500) console.error(err);
      sendError(res, status, err.message || "Something went wrong");
    }
  });
}
