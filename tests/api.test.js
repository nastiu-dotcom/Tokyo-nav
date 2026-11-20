// Runs the serverless handlers with fake Google + Claude responses.
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { summarizeRoute } from "../lib/route.js";
import { parseLatLng } from "../lib/common.js";
import { cookieFor, useFakeAuth } from "./helpers.js";

process.env.GOOGLE_MAPS_API_KEY = "test-google-key";
process.env.ANTHROPIC_API_KEY = "test-anthropic-key";
useFakeAuth();
const cookie = await cookieFor();

const ROUTE = {
  duration: "1500s",
  distanceMeters: 7200,
  travelAdvisory: { transitFare: { currencyCode: "JPY", units: "210" } },
  legs: [{
    steps: [
      { travelMode: "WALK", staticDuration: "120s", distanceMeters: 150 },
      { travelMode: "WALK", staticDuration: "60s", distanceMeters: 70 },
      {
        travelMode: "TRANSIT", staticDuration: "780s", distanceMeters: 6000,
        transitDetails: {
          headsign: "Asakusa", headway: "180s", stopCount: 8,
          stopDetails: { departureStop: { name: "Shimbashi" }, arrivalStop: { name: "Ueno" } },
          transitLine: { name: "Ginza Line", nameShort: "G", color: "#f39700", vehicle: { type: "SUBWAY" }, agencies: [{ name: "Tokyo Metro" }] },
        },
      },
      { travelMode: "WALK", staticDuration: "300s", distanceMeters: 400 },
    ],
  }],
};

let calls;
function fakeRes() {
  const res = { headers: {}, statusCode: 200, body: null };
  res.setHeader = (k, v) => { res.headers[k.toLowerCase()] = v; };
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (b) => { res.body = b; return res; };
  return res;
}
const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json" } });

beforeEach(() => {
  calls = [];
  globalThis.NO_TRANSIT = false;
  globalThis.fetch = async (input, init = {}) => {
    const url = typeof input === "string" ? input : input.url;
    const headers = new Headers(init.headers || (input.headers ?? {}));
    const body = init.body ? JSON.parse(init.body) : null;
    calls.push({ url, headers, body });
    if (url.includes("places:searchText")) {
      return json({ places: [
        { id: "far", displayName: { text: "Far Zoo" }, location: { latitude: 35.75, longitude: 139.8 }, rating: 4.5, userRatingCount: 900 },
        { id: "near", displayName: { text: "Near Museum" }, location: { latitude: 35.682, longitude: 139.768 }, priceLevel: "PRICE_LEVEL_INEXPENSIVE" },
        { id: "gone", displayName: { text: "Closed" }, location: { latitude: 35.7, longitude: 139.7 }, businessStatus: "CLOSED_PERMANENTLY" },
      ] });
    }
    if (url.includes("computeRoutes")) return json(globalThis.NO_TRANSIT ? {} : { routes: [ROUTE] });
    if (url.includes("searchNearby")) {
      const lat = body.locationRestriction.circle.center.latitude;
      return json({ places: [{ displayName: { text: lat > 35.7 ? "Ueno Station" : "Shimbashi Station" }, location: { latitude: lat + 0.003, longitude: 139.77 } }] });
    }
    if (url.includes("/v1/messages")) {
      return json({
        id: "msg_1", type: "message", role: "assistant", model: "claude-opus-5-5",
        stop_reason: "end_turn", stop_sequence: null,
        usage: { input_tokens: 10, output_tokens: 10 },
        content: [{ type: "thinking", thinking: "", signature: "x" }, { type: "text", text: "## Steps\n1. Walk to Shimbashi." }],
      });
    }
    return json({ error: { message: "unexpected " + url } }, 500);
  };
  useFakeAuth(); // Redis calls go to the in-memory fake, everything else to the fake Google above
});

test("parseLatLng accepts Tokyo, rejects elsewhere and junk", () => {
  assert.deepEqual(parseLatLng("35.68,139.76"), { lat: 35.68, lng: 139.76 });
  assert.equal(parseLatLng("48.85,2.35"), null);
  assert.equal(parseLatLng("abc"), null);
});

test("summarizeRoute merges walks and extracts transit details", () => {
  const r = summarizeRoute(ROUTE);
  assert.equal(r.totalMinutes, 25);
  assert.equal(r.transfers, 0);
  assert.equal(r.adultFare, "¥210");
  assert.equal(r.steps.length, 3);
  assert.deepEqual(r.steps[0], { mode: "WALK", meters: 220, minutes: 3 });
  assert.equal(r.steps[1].line, "Ginza Line");
  assert.equal(r.steps[1].vehicle, "Subway");
  assert.equal(r.steps[1].direction, "Asakusa");
  assert.equal(r.steps[1].everyMinutes, 3);
});

test("/api/activities uses a field mask, drops closed places, caches 24h", async () => {
  const { default: handler } = await import("../api/activities.js");
  const res = fakeRes();
  await handler({ method: "GET", headers: { cookie }, query: { category: "animals", near: "35.68,139.77" } }, res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body.places.map((p) => p.id), ["far", "near"]);
  assert.match(res.headers["cache-control"], /s-maxage=86400/);
  const g = calls[0];
  assert.equal(g.headers.get("x-goog-api-key"), "test-google-key");
  assert.match(g.headers.get("x-goog-fieldmask"), /places\.websiteUri/);
  assert.equal(g.body.textQuery, "zoo or aquarium in Tokyo");
});

test("/api/activities rejects bad input", async () => {
  const { default: handler } = await import("../api/activities.js");
  const res = fakeRes();
  await handler({ method: "GET", headers: { cookie }, query: { category: "nope", near: "35.68,139.77" } }, res);
  assert.equal(res.statusCode, 400);
  const res2 = fakeRes();
  await handler({ method: "POST", headers: { cookie }, query: {} }, res2);
  assert.equal(res2.statusCode, 405);
});

test("/api/guide gets a transit route, asks Claude, returns both", async () => {
  const { default: handler } = await import("../api/guide.js");
  const res = fakeRes();
  await handler({ method: "GET", headers: { cookie }, query: { from: "35.666,139.758", to: "35.7141,139.7774", name: "Ueno Zoo" } }, res);
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  assert.equal(res.body.guide, "## Steps\n1. Walk to Shimbashi.");
  assert.equal(res.body.route.steps[1].to, "Ueno");
  const routes = calls.find((c) => c.url.includes("computeRoutes"));
  assert.equal(routes.body.travelMode, "TRANSIT");
  const claude = calls.find((c) => c.url.includes("/v1/messages"));
  assert.equal(claude.body.model, "claude-opus-5-5");
  assert.match(claude.body.messages[0].content, /Ginza Line/);
  assert.match(claude.headers.get("anthropic-beta"), /server-side-fallback/);
  assert.equal(claude.body.fallbacks, "default");
  assert.equal(claude.body.output_config.effort, "low");
  assert.match(res.headers["cache-control"], /s-maxage=86400/);
});

test("/api/guide falls back to nearest stations when Google has no transit (Japan)", async () => {
  globalThis.NO_TRANSIT = true;
  const { default: handler } = await import("../api/guide.js");
  const res = fakeRes();
  await handler({ method: "GET", headers: { cookie }, query: { from: "35.666,139.770", to: "35.7141,139.7700", name: "Ueno Park" } }, res);
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  assert.equal(res.body.route.kind, "stations");
  assert.equal(res.body.route.startStations[0].name, "Shimbashi Station");
  assert.equal(res.body.route.endStations[0].name, "Ueno Station");
  const claude = calls.find((c) => c.url.includes("/v1/messages"));
  assert.match(claude.body.messages[0].content, /"kind": "stations"/);
});

test("/api/route is free: Google only, never calls Claude", async () => {
  const { default: handler } = await import("../api/route.js");
  const res = fakeRes();
  await handler({ method: "GET", headers: { cookie }, query: { from: "35.666,139.758", to: "35.7141,139.7774" } }, res);
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  assert.equal(res.body.route.kind, "transit");
  assert.equal(res.body.aiAvailable, true);
  assert.equal(calls.some((c) => c.url.includes("anthropic")), false);
});

test("AI_GUIDES=off blocks the paid endpoint and hides the button", async () => {
  process.env.AI_GUIDES = "off";
  try {
    const guide = (await import("../api/guide.js")).default;
    const res = fakeRes();
    await guide({ method: "GET", headers: { cookie }, query: { from: "35.600,139.758", to: "35.7141,139.7774" } }, res);
    assert.equal(res.statusCode, 403);
    const route = (await import("../api/route.js")).default;
    const res2 = fakeRes();
    await route({ method: "GET", headers: { cookie }, query: { from: "35.600,139.758", to: "35.7141,139.7774" } }, res2);
    assert.equal(res2.body.aiAvailable, false);
    assert.equal(calls.some((c) => c.url.includes("anthropic")), false);
  } finally {
    delete process.env.AI_GUIDES;
  }
});

test("/api/find searches inside Japan with a minimal field mask", async () => {
  globalThis.fetch = async (url, init) => {
    calls.push({ url, body: JSON.parse(init.body), headers: new Headers(init.headers) });
    return new Response(JSON.stringify({ places: [{ id: "abc", displayName: { text: "Pokémon Center Mega Tokyo" }, formattedAddress: "Ikebukuro", location: { latitude: 35.7288, longitude: 139.7188 } }] }), { status: 200 });
  };
  useFakeAuth();
  const { default: handler } = await import("../api/find.js");
  const res = fakeRes();
  await handler({ method: "GET", headers: { cookie }, query: { q: "Pokemon Center Mega Tokyo" } }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.place.lat, 35.7288);
  const c = calls[0];
  assert.ok(c.body.locationRestriction.rectangle);
  assert.equal(c.headers.get("x-goog-fieldmask"), "places.id,places.displayName,places.formattedAddress,places.location");
  const bad = fakeRes();
  await handler({ method: "GET", headers: { cookie }, query: { q: "x" } }, bad);
  assert.equal(bad.statusCode, 400);
});

test("API refuses calls without a login", async () => {
  const { default: handler } = await import("../api/activities.js");
  const res = fakeRes();
  await handler({ method: "GET", headers: {}, query: { category: "animals", near: "35.68,139.77" } }, res);
  assert.equal(res.statusCode, 401);
  const forged = fakeRes();
  await handler({ method: "GET", headers: { cookie: "tke_s=eyJ1IjoibmFzdGlhIn0.bad" }, query: { category: "animals", near: "35.68,139.77" } }, forged);
  assert.equal(forged.statusCode, 401);
  assert.ok(!calls.some((c) => c.url.includes("places:searchText")), "Google must not be called");
});
