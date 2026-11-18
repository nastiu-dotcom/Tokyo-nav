// Turns a Google Routes API (transit) response into a small, clean object
// that the UI can show and that is sent to Claude.
import { googleFetch, HttpError } from "./common.js";

const FIELD_MASK = [
  "routes.duration",
  "routes.distanceMeters",
  "routes.travelAdvisory.transitFare",
  "routes.legs.steps.travelMode",
  "routes.legs.steps.staticDuration",
  "routes.legs.steps.distanceMeters",
  "routes.legs.steps.transitDetails",
].join(",");

export async function fetchTransitRoute(from, to) {
  const data = await googleFetch("https://routes.googleapis.com/directions/v2:computeRoutes", {
    method: "POST",
    fieldMask: FIELD_MASK,
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
  if (!route) {
    throw new HttpError(404, "Google found no public-transport route for this trip.");
  }
  return summarizeRoute(route);
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
