// Validates data/tokyo-5day-2027.json (the April 2027 five-day trip).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const data = JSON.parse(readFileSync(new URL("../data/tokyo-5day-2027.json", import.meta.url)));
const CATS = ["museum", "anime", "food", "views", "kids_fun", "arcade"];
const stops = new Map(data.stops.map((s) => [s.id, s]));
const edge = new Map(data.edges.map((e) => [[e.from, e.to].sort().join("|"), e]));

test("ids are unique, lowercase, plan- prefixed", () => {
  const ids = [...data.stops, ...data.food].map((x) => x.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const id of ids) assert.match(id, /^plan-[a-z0-9]+(-[a-z0-9]+)*$/);
});

test("every attraction has 3–4 food options and food references exist", () => {
  for (const f of data.food) assert.ok(stops.has(f.afterStop), f.id);
  for (const s of data.stops) {
    const n = data.food.filter((f) => f.afterStop === s.id).length;
    assert.ok(n >= 3 && n <= 4, `${s.id}: ${n}`);
  }
});

test("edges are within 45 minutes and inside one day", () => {
  for (const e of data.edges) {
    assert.ok(e.minutes <= 45, JSON.stringify(e));
    assert.equal(stops.get(e.from).day, stops.get(e.to).day);
  }
});

test("each day: 12–16 attractions, ≥2 per category, valid 5- and 7-stop routes", () => {
  for (const d of data.days) {
    const n = Number(d.key.slice(1));
    const pool = data.stops.filter((s) => s.day === n);
    assert.ok(pool.length >= 12 && pool.length <= 16, `${d.key} pool ${pool.length}`);
    for (const c of CATS) assert.ok(pool.filter((s) => s.categories.includes(c)).length >= 2, `${d.key} ${c}`);
    for (const [kind, len] of [["five", 5], ["seven", 7]]) {
      const r = d.routes[kind];
      assert.equal(r.length, len);
      const cov = new Set(r.flatMap((id) => stops.get(id).categories));
      for (const c of CATS) assert.ok(cov.has(c), `${d.key} ${kind} misses ${c}`);
      for (let i = 1; i < r.length; i++) assert.ok(edge.has([r[i - 1], r[i]].sort().join("|")), `${d.key} ${kind} leg ${i}`);
      for (const id of r) assert.ok(stops.get(id).openOnTripDay, `${id} closed on trip day`);
    }
    assert.ok(d.suggestedRoute.length >= 5 && d.suggestedRoute.length <= 7);
  }
});

test("Monday April 5 avoids Monday-closed attractions in its routes", () => {
  const d5 = data.days.find((d) => d.date === "2027-04-05");
  for (const id of d5.routes.seven) assert.ok(!stops.get(id).closed.includes(1), id);
});

test("arrival day and preparation checklist are present and well-formed", () => {
  const a = data.arrival;
  assert.equal(a.date, "2027-03-31");
  assert.ok(a.airportSteps.length >= 8);
  assert.ok(a.routes.some((r) => r.recommended && r.steps.length >= 5));
  assert.ok(a.checklist.length >= 8);
  const ids = data.preparation.flatMap((s) => s.items.map((i) => i.id));
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(ids.length >= 30);
});
