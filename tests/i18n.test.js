import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { ALL_KEYS } from "../scripts/i18n-keys.mjs";
import HE from "../js/i18n-he.js";
import { t, tn, L, setLang, getLang } from "../js/i18n.js";
import { PLAN_DAYS, TIPS, buildPlanDays } from "../js/plan.js";
import { dayColor, DAY_PALETTE } from "../js/theme.js";

const vars = (s) => (s.match(/\{\w+\}/g) || []).sort().join(",");
const tags = (s) => (s.match(/<\/?[a-z]+/g) || []).sort().join(",");

test("every UI string has a Hebrew translation with the same placeholders and tags", () => {
  const missing = ALL_KEYS.filter((k) => !HE[k]);
  assert.deepEqual(missing, [], "missing Hebrew for these strings");
  for (const [k, v] of Object.entries(HE)) {
    assert.equal(vars(v), vars(k), `placeholders differ: ${k}`);
    assert.equal(tags(v), tags(k), `HTML tags differ: ${k}`);
  }
});

test("t / tn / L follow the chosen language and fall back to English", () => {
  setLang("he");
  assert.equal(getLang(), "he");
  assert.equal(t("Day {n}", { n: 2 }), "יום 2");
  assert.equal(tn(1, "1 stop", "{n} stops"), "תחנה אחת");
  assert.equal(t("Some untranslated text"), "Some untranslated text");
  assert.equal(L({ tip: "en", he: { tip: "עב" } }, "tip"), "עב");
  assert.equal(L({ tip: "en" }, "tip"), "en");
  setLang("en");
  assert.equal(t("Day {n}", { n: 2 }), "Day 2");
  assert.equal(L({ tip: "en", he: { tip: "עב" } }, "tip"), "en");
  setLang("he");
});

test("3-day plan and tips have Hebrew content", () => {
  for (const s of buildPlanDays(null, "").flatMap((d) => d.stops)) assert.ok(s.he?.tip, `stop ${s.name} has no Hebrew`);
  for (const d of PLAN_DAYS) assert.ok(d.he?.title, `day ${d.title} has no Hebrew title`);
  for (const tip of TIPS) assert.ok(tip.he?.title && tip.he?.text, `tip ${tip.title} has no Hebrew`);
});

test("April 2027 dataset carries Hebrew for every stop, food place and day", () => {
  const data = JSON.parse(readFileSync(new URL("../data/tokyo-5day-2027.json", import.meta.url)));
  assert.ok(data.days.length >= 5);
  for (const d of data.days) assert.ok(d.he?.title, `day ${d.date} has no Hebrew`);
  for (const s of data.stops) assert.ok(s.he?.tip, `stop ${s.id} has no Hebrew`);
  for (const f of data.food) assert.ok(f.he, `food ${f.id} has no Hebrew`);
  for (const p of data.preparation) assert.ok(p.he?.title, `prep ${p.id} has no Hebrew`);
  assert.ok(data.arrival.he, "arrival has no Hebrew");
});

test("each trip day gets its own pastel colour", () => {
  const april = ["apr-d0", "apr-d1", "apr-d2", "apr-d3", "apr-d4", "apr-d5"]
    .map((planKey) => dayColor({ planKey }, 99).bg);
  assert.equal(dayColor({ planKey: "apr-d0" }, 3).name, "lavender");
  assert.equal(new Set(april).size, april.length);
  assert.ok(DAY_PALETTE.length >= 6);
});
