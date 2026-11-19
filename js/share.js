import { t } from "./i18n.js";
// Share the trip plan as a link (no accounts, no database).
// The plan is packed into the part of the URL after "#", which never reaches
// the server.

const b64url = (bytes) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const fromB64url = (s) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));
const n5 = (x) => Math.round(x * 1e5) / 1e5;

function pack(trip) {
  const pt = (p) => (p ? [n5(p.lat), n5(p.lng), p.name || "", p.id || "", p.address || ""] : null);
  return { v: 1, d: trip.days.map((d) => ({ t: d.date || "", k: d.planKey || "", s: pt(d.start), p: d.stops.map(pt) })) };
}

function unpack(obj) {
  if (!obj || obj.v !== 1 || !Array.isArray(obj.d)) throw new Error("bad");
  const pt = (a) => (Array.isArray(a) && Number.isFinite(a[0]) && Number.isFinite(a[1])
    ? { lat: a[0], lng: a[1], name: String(a[2] || "").slice(0, 120), id: String(a[3] || "").slice(0, 300), address: String(a[4] || "").slice(0, 200) }
    : null);
  return {
    days: obj.d.slice(0, 60).map((d) => ({
      id: Math.random().toString(36).slice(2, 10),
      date: /^\d{4}-\d{2}-\d{2}$/.test(d.t) ? d.t : "",
      planKey: /^(apr-)?d\d{1,2}$/.test(d.k || "") ? d.k : "",
      start: pt(d.s),
      stops: (Array.isArray(d.p) ? d.p : []).slice(0, 40).map(pt).filter(Boolean),
    })),
  };
}

async function deflate(text) {
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}
async function inflate(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return new Response(stream).text();
}

export async function tripLink(trip) {
  const json = JSON.stringify(pack(trip));
  let code;
  if ("CompressionStream" in window) code = "z" + b64url(await deflate(json));
  else code = "j" + b64url(new TextEncoder().encode(json));
  return `${location.origin}/#trip=${code}`;
}

export async function readTripFromHash() {
  const m = location.hash.match(/^#trip=([zj])([A-Za-z0-9_-]+)$/);
  if (!m) return null;
  const bytes = fromB64url(m[2]);
  const json = m[1] === "z" ? await inflate(bytes) : new TextDecoder().decode(bytes);
  return unpack(JSON.parse(json));
}

export async function shareTrip(trip) {
  const url = await tripLink(trip);
  if (navigator.share) {
    try { await navigator.share({ title: t("Our Tokyo trip plan"), url }); return "shared"; } catch (e) { if (e.name === "AbortError") return "cancelled"; }
  }
  try { await navigator.clipboard.writeText(url); return "copied"; } catch { /* fall through */ }
  prompt(t("Copy this link:"), url);
  return "shown";
}
