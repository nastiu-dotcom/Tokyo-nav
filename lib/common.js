// Shared helpers for the Vercel serverless functions.
// Files in /lib are not routes; only files in /api are.

const DAY = 60 * 60 * 24;

// Rough bounding box around greater Tokyo (incl. Yokohama, Disney, Mt. Takao).
// Requests outside it are refused so the keys can't be used as a free
// worldwide Places/Routes proxy.
const BOUNDS = { minLat: 34.9, maxLat: 36.4, minLng: 138.6, maxLng: 140.9 };

export function parseLatLng(value) {
  if (typeof value !== "string") return null;
  const parts = value.split(",").map(Number);
  if (parts.length !== 2 || parts.some((n) => !Number.isFinite(n))) return null;
  const [lat, lng] = parts;
  if (lat < BOUNDS.minLat || lat > BOUNDS.maxLat) return null;
  if (lng < BOUNDS.minLng || lng > BOUNDS.maxLng) return null;
  return { lat, lng };
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
export async function googleFetch(url, { method = "GET", body, fieldMask }) {
  const headers = {
    "X-Goog-Api-Key": googleKey(),
    "X-Goog-FieldMask": fieldMask,
  };
  if (body) headers["Content-Type"] = "application/json";
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

export function handle(fn) {
  return async (req, res) => {
    if (!requireGet(req, res)) return;
    try {
      await fn(req, res);
    } catch (err) {
      const status = err instanceof HttpError ? err.status : 500;
      if (status === 500) console.error(err);
      sendError(res, status, err.message || "Something went wrong");
    }
  };
}
