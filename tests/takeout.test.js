import { test } from "node:test";
import assert from "node:assert/strict";
import { coordsFromUrl, inJapan, mergePlaces, parseSavedListCsv, parseSavedPlacesJson } from "../js/takeout.js";

test("coordinates are read from Google Maps URLs", () => {
  assert.deepEqual(coordsFromUrl("https://www.google.com/maps/place/X/@35.6586,139.7454,17z"), { lat: 35.6586, lng: 139.7454 });
  assert.deepEqual(coordsFromUrl("https://www.google.com/maps/place/X/data=!3m1!4b1!4m6!3m5!1s0x0:0x0!8m2!3d35.71!4d139.81"), { lat: 35.71, lng: 139.81 });
  assert.equal(coordsFromUrl("https://www.google.com/maps/place/X/data=!4m2!3m1!1s0x60188b:0x1"), null);
});

test("starred places JSON: new and old Takeout formats", () => {
  const newer = JSON.stringify({ type: "FeatureCollection", features: [
    { type: "Feature", geometry: { type: "Point", coordinates: [139.7967, 35.7148] },
      properties: { google_maps_url: "http://maps.google.com/?cid=1", location: { name: "Senso-ji", address: "Asakusa", country_code: "JP" } } },
    { type: "Feature", geometry: { type: "Point", coordinates: [0, 0] },
      properties: { google_maps_url: "http://maps.google.com/?q=Somewhere", location: { name: "No coords" } } },
  ] });
  const a = parseSavedPlacesJson(newer);
  assert.equal(a[0].name, "Senso-ji");
  assert.equal(a[0].lat, 35.7148);
  assert.equal(a[1].lat, null);
  const older = JSON.stringify({ features: [{ geometry: { coordinates: [139.70, 35.69] }, properties: {
    Title: "Old", "Google Maps URL": "u", Location: { "Business Name": "Old Shop", Address: "Shinjuku", "Geo Coordinates": { Latitude: "35.69", Longitude: "139.70" } } } }] });
  const b = parseSavedPlacesJson(older);
  assert.equal(b[0].name, "Old Shop");
  assert.equal(b[0].lng, 139.7);
});

test("saved list CSV with quotes and missing coordinates", () => {
  const csv = '﻿Title,Note,URL\n"Ichiran, Shibuya","with ""kids""",https://www.google.com/maps/place/Ichiran/data=!4m2!3m1!1s0x1:0x2\nTokyo Tower,,https://www.google.com/maps/place/Tokyo+Tower/@35.6586,139.7454,17z\n';
  const p = parseSavedListCsv(csv, "Want to go");
  assert.equal(p.length, 2);
  assert.equal(p[0].name, "Ichiran, Shibuya");
  assert.equal(p[0].note, 'with "kids"');
  assert.equal(p[0].lat, null);
  assert.equal(p[1].lat, 35.6586);
  assert.equal(p[1].list, "Want to go");
});

test("Japan filter and de-duplication", () => {
  assert.ok(inJapan(35.68, 139.76));
  assert.ok(!inJapan(48.85, 2.35));
  const m = mergePlaces([{ name: "A", url: "u1" }], [{ name: "A", url: "u1" }, { name: "B", url: "u2" }]);
  assert.equal(m.length, 2);
});
