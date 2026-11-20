// Signed login cookie, shared by middleware.js (Edge) and the /api functions
// (Node). Web Crypto only, so it runs in both.
//
// Cookie value: base64url(JSON payload) "." base64url(HMAC-SHA256)
// Payload: {u: user id, v: user's session version, exp: unix seconds}
// The signing secret is SESSION_SECRET if set, otherwise derived from the
// Upstash token (already a secret only the server knows).

export const COOKIE = "tke_s";
export const SESSION_DAYS = 30;

export function sessionSecret(env) {
  return env.SESSION_SECRET || env.KV_REST_API_TOKEN || env.UPSTASH_REDIS_REST_TOKEN || "";
}

const enc = new TextEncoder();
const b64u = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const fromB64u = (s) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));

const keys = new Map();
function hmacKey(secret) {
  if (!keys.has(secret)) {
    keys.set(secret, crypto.subtle.importKey("raw", enc.encode(`${secret}|tke-session-v1`), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]));
  }
  return keys.get(secret);
}

export async function signSession(payload, secret) {
  const body = b64u(enc.encode(JSON.stringify(payload)));
  const sig = await crypto.subtle.sign("HMAC", await hmacKey(secret), enc.encode(body));
  return `${body}.${b64u(sig)}`;
}

/** Returns the payload if the token is genuine and not expired, else null. */
export async function verifySession(token, secret) {
  if (!token || !secret || typeof token !== "string") return null;
  const [body, sig] = token.split(".");
  if (!body || !sig) return null;
  try {
    const ok = await crypto.subtle.verify("HMAC", await hmacKey(secret), fromB64u(sig), enc.encode(body));
    if (!ok) return null;
    const p = JSON.parse(new TextDecoder().decode(fromB64u(body)));
    if (!p || typeof p.u !== "string" || !(p.exp > Date.now() / 1000)) return null;
    return p;
  } catch {
    return null;
  }
}

export function readCookie(header, name) {
  for (const part of String(header || "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return null;
}
