// Turns a Google Routes API (transit) response into a small, clean object
// that the UI can show and that is sent to Claude.
import { googleFetch, HttpError, memo, ONE_DAY, round } from "./common.js";

const FIELD_MASK = [
  "routes.duration",
  "routes.distanceMeters",
  "routes.travelAdvisory.transitFare",
  "routes.legs.steps.travelMode",
  "routes.legs.steps.staticDuration",
  "routes.legs.steps.distanceMeters",
  "routes.legs.steps.transitDetails",
].join(",");

/**
 * Best available route data. Google's API has no train/subway data for
 * Japan, so in Tokyo the transit request usually comes back empty. Fallbacks:
 *  - short trips: a real walking route,
 *  - longer trips: the nearest stations at both ends (real Places data).
 */
export async function getRouteData(from, to) {
  const transit = await fetchTransitRoute(from, to);
  if (transit) return transit;
  const km = distanceKm(from, to);
  if (km <= 1.6) {
    const walk = await fetchWalkRoute(from, to);
    if (walk) return walk;
  }
  return fetchStationsRoute(from, to, km);
}

export async function fetchTransitRoute(from, to) {
  const data = await googleFetch("https://routes.googleapis.com/directions/v2:computeRoutes", {
    method: "POST",
    fieldMask: FIELD_MASK,
    sku: "routes.compute",
    body: {
      origin: { location: { latLng: { latitude: from.lat, longitude: from.lng } } },
      destination: { location: { latLng: { latitude: to.lat, longitude: to.lng } } },
      travelMode: "TRANSIT",
      computeAlternativeRoutes: false,
      languageCode: "en",
      units: "METRIC",
    },
  });
  const route = data.routes?.[0];
  return route ? { kind: "transit", ...summarizeRoute(route) } : null;
}

async function fetchWalkRoute(from, to) {
  const data = await googleFetch("https://routes.googleapis.com/directions/v2:computeRoutes", {
    method: "POST",
    fieldMask: "routes.duration,routes.distanceMeters",
    sku: "routes.compute",
    body: {
      origin: { location: { latLng: { latitude: from.lat, longitude: from.lng } } },
      destination: { location: { latLng: { latitude: to.lat, longitude: to.lng } } },
      travelMode: "WALK",
      languageCode: "en",
    },
  });
  const r = data.routes?.[0];
  if (!r) return null;
  return {
    kind: "walk",
    totalMinutes: minutes(seconds(r.duration)),
    distanceKm: Math.round((r.distanceMeters || 0) / 100) / 10,
  };
}

// Each stop is the end of one leg and the start of the next, so cache the
// stations per point (~100 m) instead of per leg.
function nearestStations(point) {
  const p = { lat: round(point.lat, 3), lng: round(point.lng, 3) };
  return memo(`stations:${p.lat},${p.lng}`, ONE_DAY, () => lookupStations(point));
}

async function lookupStations(point) {
  const data = await googleFetch("https://places.googleapis.com/v1/places:searchNearby", {
    method: "POST",
    fieldMask: "places.displayName,places.location,places.primaryType",
    sku: "places.nearby.pro",
    body: {
      includedTypes: ["train_station", "subway_station", "light_rail_station"],
      rankPreference: "DISTANCE",
      maxResultCount: 3,
      languageCode: "en",
      locationRestriction: {
        circle: { center: { latitude: point.lat, longitude: point.lng }, radius: 2000 },
      },
    },
  });
  return (data.places || [])
    .filter((p) => p.location && p.displayName?.text)
    .map((p) => {
      // Straight line x1.3 for streets, ~80 m per minute walking.
      const meters = Math.round(distanceKm(point, { lat: p.location.latitude, lng: p.location.longitude }) * 1300);
      return { name: p.displayName.text, walkMeters: meters, walkMinutes: Math.max(1, Math.round(meters / 80)) };
    });
}

async function fetchStationsRoute(from, to, km) {
  const [startStations, endStations] = await Promise.all([nearestStations(from), nearestStations(to)]);
  if (!startStations.length || !endStations.length) {
    throw new HttpError(404, "No train station found near the start or the destination.");
  }
  return {
    kind: "stations",
    note: "Google has no train/subway timetable data for Japan. Exact lines come from the Navigate button (Google Maps app).",
    distanceKm: Math.round(km * 10) / 10,
    startStations,
    endStations,
  };
}

export function distanceKm(a, b) {
  const R = 6371, rad = (x) => (x * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat), dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

const seconds = (d) => (d ? parseInt(String(d), 10) || 0 : 0);
const minutes = (s) => Math.max(1, Math.round(s / 60));

const VEHICLES = {
  SUBWAY: "Subway", METRO_RAIL: "Subway", HEAVY_RAIL: "Train", COMMUTER_TRAIN: "Train",
  HIGH_SPEED_TRAIN: "Shinkansen", LONG_DISTANCE_TRAIN: "Train", RAIL: "Train",
  MONORAIL: "Monorail", TRAM: "Tram", LIGHT_RAIL: "Train", BUS: "Bus",
  INTERCITY_BUS: "Bus", TROLLEYBUS: "Bus", FERRY: "Ferry", CABLE_CAR: "Cable car",
  GONDOLA_LIFT: "Ropeway", FUNICULAR: "Funicular",
};

export function summarizeRoute(route) {
  const steps = [];
  for (const leg of route.legs || []) {
    for (const s of leg.steps || []) {
      const dur = seconds(s.staticDuration);
      if (s.travelMode === "TRANSIT" && s.transitDetails) {
        const t = s.transitDetails;
        const line = t.transitLine || {};
        const vehicleType = line.vehicle?.type;
        steps.push({
          mode: "TRANSIT",
          line: line.name || line.nameShort || "Line",
          lineShort: line.nameShort || "",
          color: line.color || null,
          textColor: line.textColor || null,
          vehicle: VEHICLES[vehicleType] || line.vehicle?.name?.text || "Transit",
          operator: line.agencies?.[0]?.name || "",
          direction: t.headsign || "",
          from: t.stopDetails?.departureStop?.name || "",
          to: t.stopDetails?.arrivalStop?.name || "",
          stops: t.stopCount ?? null,
          everyMinutes: t.headway ? minutes(seconds(t.headway)) : null,
          minutes: minutes(dur),
        });
      } else {
        // Google returns many small walking turns; merge them into one step.
        const prev = steps[steps.length - 1];
        if (prev && prev.mode === "WALK") {
          prev.seconds += dur;
          prev.meters += s.distanceMeters || 0;
          prev.minutes = minutes(prev.seconds);
        } else {
          steps.push({ mode: "WALK", seconds: dur, meters: s.distanceMeters || 0, minutes: minutes(dur) });
        }
      }
    }
  }
  for (const s of steps) delete s.seconds;
  const filtered = steps.filter((s) => s.mode !== "WALK" || s.meters >= 30);

  const transitCount = filtered.filter((s) => s.mode === "TRANSIT").length;
  const fare = route.travelAdvisory?.transitFare;
  return {
    totalMinutes: minutes(seconds(route.duration)),
    distanceKm: Math.round((route.distanceMeters || 0) / 100) / 10,
    transfers: Math.max(0, transitCount - 1),
    adultFare: fare?.units
      ? `${fare.currencyCode === "JPY" ? "¥" : fare.currencyCode + " "}${Number(fare.units).toLocaleString("en-US")}`
      : null,
    steps: filtered,
  };
}
