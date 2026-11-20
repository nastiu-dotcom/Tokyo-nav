// Family sharing (client): the parent shares the plan, kids suggest places,
// the parent approves them. Talks to /api/family (Upstash Redis behind it).
import { getJSON, postJSON, store } from "./util.js";

export const family = () => store.get("family") || null;
export const familyData = () => store.get("familyData") || { plan: null, wishlist: [], v: 0 };
export const isKid = () => family()?.role === "kid";
export const isParentShared = () => family()?.role === "parent";

const keep = (d) => store.set("familyData", { plan: d.plan, wishlist: d.wishlist || [], v: d.v });

async function post(body) {
  const f = family();
  return postJSON("/api/family", { id: f?.id, key: f?.key, ...body });
}

/** Only what other phones need; details are re-added from the trip data there. */
const slim = (p) => p && ({
  id: p.id, name: p.name, lat: p.lat, lng: p.lng, emoji: p.emoji || "", time: p.time || "",
  type: p.type || "", maps: p.maps || "", address: p.address || "", by: p.by || "",
});
export const packPlan = (trip) => ({
  days: trip.days.map((d) => ({ id: d.id, planKey: d.planKey || "", date: d.date || "", start: slim(d.start), stops: d.stops.map(slim) })),
});

export async function createFamily(trip) {
  const plan = packPlan(trip);
  const d = await post({ action: "create", plan });
  store.set("family", { id: d.id, key: d.parentKey, kidKey: d.kidKey, role: "parent", name: "" });
  keep({ plan, wishlist: [], v: d.v });
  lastPushed = JSON.stringify(plan);
  return d;
}

export async function joinFamily(id, key, name) {
  const d = await getJSON(`/api/family?id=${encodeURIComponent(id)}&key=${encodeURIComponent(key)}`);
  store.set("family", { id, key, role: d.role, name: name || "" });
  keep(d);
  return d;
}

/** Returns true when something changed on the server. */
export async function refreshFamily() {
  const f = family();
  if (!f) return false;
  const cur = familyData();
  const d = await getJSON(`/api/family?id=${f.id}&key=${f.key}&v=${cur.v}`);
  if (d.unchanged) return false;
  keep(d);
  return true;
}

let lastPushed = "";
let pushTimer = null;
/** Parent: upload the plan (debounced, only when it really changed). */
export function pushPlanSoon(trip, onError) {
  if (!isParentShared()) return;
  const plan = packPlan(trip);
  const json = JSON.stringify(plan);
  if (json === lastPushed) return;
  clearTimeout(pushTimer);
  pushTimer = setTimeout(async () => {
    try {
      keep(await post({ action: "plan", plan }));
      lastPushed = json;
    } catch (err) {
      onError?.(err);
    }
  }, 2000);
}
export const markPushed = (trip) => { lastPushed = JSON.stringify(packPlan(trip)); };

export async function suggestPlace(item) {
  const d = await post({ action: "suggest", item: { ...item, by: family()?.name || "" } });
  keep(d);
  return d;
}
export async function reviewSuggestion(itemId, status, day) { keep(await post({ action: "review", itemId, status, day })); }
export async function removeSuggestion(itemId) { keep(await post({ action: "remove", itemId, by: family()?.name || "" })); }

export function leaveFamily() {
  store.set("family", null);
  store.set("familyData", null);
}

export const kidLink = () => { const f = family(); return f?.kidKey ? `${location.origin}/#join=${f.id}.${f.kidKey}` : ""; };
export const parentLink = () => { const f = family(); return f?.role === "parent" ? `${location.origin}/#join=${f.id}.${f.key}` : ""; };

/** Reads a #join=<id>.<key> link. */
export function joinFromHash() {
  const m = location.hash.match(/^#join=([a-z0-9]{10})\.([a-z0-9]{16,32})$/);
  return m ? { id: m[1], key: m[2] } : null;
}

/** Check for changes every 90 s while the app is visible (light on the free tier). */
export function startFamilyPolling(onChange) {
  const tick = async () => {
    if (!family() || document.visibilityState !== "visible") return;
    try { if (await refreshFamily()) onChange(); } catch { /* offline – try next time */ }
  };
  setInterval(tick, 90_000);
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") tick(); });
}
