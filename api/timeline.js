// The whole trip: countries (segments), flights, stays and notes – one shared
// document for the family, stored in Upstash Redis.
//
// GET  /api/timeline[?v=…]   → {timeline} (or {unchanged}); kids get no prices / budget
// POST /api/timeline (grown-ups only)
//   {action: "item",   item}           add or update a flight / stay / note
//   {action: "remove", id}             delete one
//   {action: "trip",   trip, segments} trip title, budget and country dates
import { randomBytes } from "node:crypto";
import { HttpError, handleJson } from "../lib/common.js";
import { kv } from "../lib/kv.js";
import { requireAdult, requireUser } from "../lib/users.js";

const KEY = "trip:timeline";
const MAX_ITEMS = 200;
export const COUNTRIES = ["TH", "JP", "IL", "XX"];
export const CURRENCIES = ["ILS", "THB", "JPY", "USD", "EUR"];

// Thailand 19/3 → 1/4, Japan 1/4 → 10/5 (2027), budget ₪80,000.
export const DEFAULT = {
  v: 0,
  trip: { title: "Thailand & Japan 2027", budget: 80000, currency: "ILS" },
  segments: [
    { id: "th", country: "TH", from: "2027-03-19", to: "2027-04-01" },
    { id: "jp", country: "JP", from: "2027-04-01", to: "2027-05-10" },
  ],
  items: [],
};

const rid = () => randomBytes(6).toString("hex");
const clip = (s, n) => String(s ?? "").replace(/[\u0000-\u001f]/g, " ").trim().slice(0, n);
const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`));
const date = (s, name, required = true) => {
  const v = clip(s, 10);
  if (!v && !required) return "";
  if (!isDate(v)) throw new HttpError(400, `${name}: use a real date`);
  return v;
};
const time = (s) => (/^([01]\d|2[0-3]):[0-5]\d$/.test(String(s || "")) ? String(s) : "");
function money(item) {
  const price = item.price === "" || item.price == null ? null : Number(item.price);
  if (price !== null && !(Number.isFinite(price) && price >= 0 && price <= 10_000_000)) throw new HttpError(400, "Price must be a number");
  return { price, currency: CURRENCIES.includes(item.currency) ? item.currency : "ILS" };
}

export function cleanItem(item) {
  const kind = item?.kind;
  const base = { id: /^[a-f0-9]{12}$/.test(item?.id || "") ? item.id : rid(), kind, notes: clip(item.notes, 500), booking: clip(item.booking, 60) };
  if (kind === "flight") {
    const out = {
      ...base, ...money(item),
      date: date(item.date, "Departure date"), time: time(item.time),
      arrDate: date(item.arrDate, "Arrival date", false), arrTime: time(item.arrTime),
      from: clip(item.from, 60), to: clip(item.to, 60), airline: clip(item.airline, 60), flightNo: clip(item.flightNo, 12).toUpperCase(),
    };
    if (!out.from || !out.to) throw new HttpError(400, "A flight needs “from” and “to”");
    if (out.arrDate && out.arrDate < out.date) throw new HttpError(400, "The flight lands before it leaves");
    return out;
  }
  if (kind === "stay") {
    const out = {
      ...base, ...money(item),
      name: clip(item.name, 100), address: clip(item.address, 200),
      checkIn: date(item.checkIn, "Check-in"), checkOut: date(item.checkOut, "Check-out"),
    };
    if (!out.name) throw new HttpError(400, "The stay needs a name");
    if (out.checkOut <= out.checkIn) throw new HttpError(400, "Check-out must be after check-in");
    return out;
  }
  if (kind === "note") {
    const out = { ...base, date: date(item.date, "Date"), title: clip(item.title, 100) };
    if (!out.title) throw new HttpError(400, "The note needs a title");
    return out;
  }
  throw new HttpError(400, "Unknown item type");
}

export function cleanTrip(trip, segments) {
  const budget = Number(trip?.budget);
  if (!(Number.isFinite(budget) && budget >= 0 && budget <= 100_000_000)) throw new HttpError(400, "Budget must be a number");
  if (!Array.isArray(segments) || !segments.length || segments.length > 12) throw new HttpError(400, "Add at least one country");
  const segs = segments.map((s, i) => {
    const seg = {
      id: clip(s.id, 20) || `s${i}`, country: COUNTRIES.includes(s.country) ? s.country : "XX",
      name: clip(s.name, 40), from: date(s.from, "From"), to: date(s.to, "To"),
    };
    if (seg.to <= seg.from) throw new HttpError(400, "Each country needs an end date after its start");
    return seg;
  }).sort((a, b) => a.from.localeCompare(b.from));
  for (let i = 1; i < segs.length; i++) {
    if (segs[i].from < segs[i - 1].to) throw new HttpError(400, "Two countries overlap – check the dates");
  }
  return {
    trip: { title: clip(trip?.title, 80) || DEFAULT.trip.title, budget, currency: CURRENCIES.includes(trip?.currency) ? trip.currency : "ILS" },
    segments: segs,
  };
}

/** Kids see the journey, not the money. */
export function forKids(doc) {
  return {
    ...doc,
    trip: { title: doc.trip.title },
    items: doc.items.map(({ price, currency, booking, ...rest }) => rest),
  };
}

async function load() {
  const raw = await kv(["GET", KEY]);
  return raw ? JSON.parse(raw) : structuredClone(DEFAULT);
}

export default handleJson(async (req, res, body) => {
  if (req.method === "GET") {
    const me = await requireUser(req);
    const doc = await load();
    if (req.query.v !== undefined && Number(req.query.v) === doc.v) return { unchanged: true, v: doc.v };
    return { timeline: me.role === "kid" ? forKids(doc) : doc };
  }

  await requireAdult(req);
  const doc = await load();
  if (body.action === "item") {
    const item = cleanItem(body.item);
    const i = doc.items.findIndex((x) => x.id === item.id);
    if (i >= 0) doc.items[i] = item;
    else if (doc.items.length >= MAX_ITEMS) throw new HttpError(409, "The timeline is full");
    else doc.items.push(item);
  } else if (body.action === "remove") {
    doc.items = doc.items.filter((x) => x.id !== body.id);
  } else if (body.action === "trip") {
    Object.assign(doc, cleanTrip(body.trip, body.segments));
  } else {
    throw new HttpError(400, "Unknown action");
  }
  doc.v += 1;
  await kv(["SET", KEY, JSON.stringify(doc)]);
  return { timeline: doc };
});
