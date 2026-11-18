// April 2027 five-day family trip: loads data/tokyo-5day-2027.json and powers
// the "choose your own route" engine (only places ≤ 45 min away are offered).
import { uid } from "./util.js";

const URL = "/data/tokyo-5day-2027.json";
let DATA = null;
let BY_ID = new Map();
let FOOD = new Map();
let EDGES = new Map();
const key = (a, b) => (a < b ? `${a}|${b}` : `${b}|${a}`);

export const TRIP_CATS = [
  ["all", "⭐ All"],
  ["museum", "🏛️ Museums"],
  ["anime", "⚡ Anime"],
  ["food", "🍜 Food"],
  ["views", "🌆 Views"],
  ["kids_fun", "🎢 Kids' fun"],
  ["arcade", "🕹️ Arcades"],
];

export async function loadTrip2027() {
  if (DATA) return DATA;
  const res = await fetch(URL);
  if (!res.ok) throw new Error("Could not load the April 2027 trip data");
  DATA = await res.json();
  BY_ID = new Map(DATA.stops.map((s) => [s.id, s]));
  FOOD = new Map();
  for (const f of DATA.food) {
    if (!FOOD.has(f.afterStop)) FOOD.set(f.afterStop, []);
    FOOD.get(f.afterStop).push(f);
  }
  EDGES = new Map(DATA.edges.map((e) => [key(e.from, e.to), e]));
  return DATA;
}

export const tripReady = () => Boolean(DATA);
export const arrivalInfo = () => DATA?.arrival || null;
export const prepSections = () => DATA?.preparation || [];
export const isArrivalKey = (k) => k === "apr-d0";
export const isTripKey = (k) => /^apr-d\d$/.test(k || "");
export const tripStop = (id) => BY_ID.get(id) || null;
export const allPoolStops = () => DATA?.stops || [];
export const allFood = () => DATA?.food || [];
export const foodFor = (id) => FOOD.get(id) || [];
export const edgeBetween = (a, b) => (a && b ? EDGES.get(key(a, b)) || null : null);
export const tripDay = (planKey) => (DATA && isTripKey(planKey) ? DATA.days.find((d) => `apr-${d.key}` === planKey) : null);
export const maxLeg = () => DATA?.trip.maxLegMinutes || 45;

export function hotelPoint() {
  const h = DATA.trip.hotel;
  return { id: "pin-hotel", name: `${h.name} (hotel)`, lat: h.lat, lng: h.lng, address: h.address || "", maps: h.address || h.name };
}

/** A dataset attraction as a stop the app can show/save. */
export function toAppStop(s, time = "") {
  return { ...s, time, food: s.categories.includes("food") };
}

/** Trip days for the app (route kind: "seven" or "five"). */
export function buildTripDays(kind = "seven") {
  const a = DATA.arrival;
  const arrival = a ? [{
    id: uid(),
    planKey: "apr-d0",
    date: a.date,
    start: { ...a.narita },
    stops: [{ ...hotelPoint(), emoji: "🏨", type: "Your hotel", tip: a.evening, verify: a.verify }],
  }] : [];
  return arrival.concat(DATA.days.map((d) => ({
    id: uid(),
    planKey: `apr-${d.key}`,
    date: d.date,
    start: hotelPoint(),
    stops: d.routes[kind].map((id, i) => toAppStop(BY_ID.get(id), d.routeTimes?.[kind]?.[i] || "")),
  })));
}

export function routeStops(planKey, kind) {
  const d = tripDay(planKey);
  return d ? d.routes[kind].map((id, i) => toAppStop(BY_ID.get(id), d.routeTimes?.[kind]?.[i] || "")) : [];
}

/**
 * Pool attractions reachable from `fromId` (a dataset stop) within 45 min,
 * or all of the day's pool with hotel travel times when starting at the hotel.
 */
export function reachable(planKey, fromId) {
  const d = tripDay(planKey);
  if (!d) return [];
  const dayNum = Number(d.key.slice(1));
  const pool = DATA.stops.filter((s) => s.day === dayNum);
  if (!fromId || !BY_ID.has(fromId)) {
    return pool.map((s) => ({ stop: s, minutes: s.hotelMinutes, line: "from the hotel", mode: "mixed" }))
      .sort((a, b) => a.minutes - b.minutes);
  }
  return pool
    .filter((s) => s.id !== fromId)
    .map((s) => ({ stop: s, edge: EDGES.get(key(fromId, s.id)) }))
    .filter((x) => x.edge && x.edge.minutes <= maxLeg())
    .map((x) => ({ stop: x.stop, minutes: x.edge.minutes, line: x.edge.line, mode: x.edge.mode }))
    .sort((a, b) => a.minutes - b.minutes);
}

export function edgeSummary(e) {
  const icon = e.mode === "walk" ? "🚶" : e.mode === "subway" ? "🚇" : "🚆";
  return e.mode === "walk" ? `${icon} ~${e.minutes} min on foot` : `${icon} ~${e.minutes} min door to door · ${e.line}`;
}
