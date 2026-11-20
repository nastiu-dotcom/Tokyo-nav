// Lists every UI string that needs a Hebrew translation (used by tests and when
// adding new text). Usage: node scripts/i18n-keys.mjs
import { readFileSync, readdirSync } from "node:fs";

const files = ["app.js", ...readdirSync("js").filter((f) => f.endsWith(".js") && !f.startsWith("i18n")).map((f) => `js/${f}`)];
const keys = new Set();
const lit = String.raw`"((?:[^"\\]|\\.)*)"`;
const unq = (s) => JSON.parse(`"${s}"`);
for (const f of files) {
  const src = readFileSync(f, "utf8");
  for (const m of src.matchAll(new RegExp(String.raw`\bt\(\s*` + lit, "g"))) keys.add(unq(m[1]));
  for (const m of src.matchAll(new RegExp(String.raw`\btn\([^,]+,\s*` + lit + String.raw`\s*,\s*` + lit, "g"))) { keys.add(unq(m[1])); keys.add(unq(m[2])); }
  // label arrays rendered through t(label): [id, "label"] pairs and LAYERS rows
  for (const m of src.matchAll(new RegExp(String.raw`\[\s*"[a-z_]+"\s*,\s*` + lit, "g"))) keys.add(unq(m[1]));
}
const html = readFileSync("index.html", "utf8");
for (const m of html.matchAll(/data-i18n(?:-ph|-aria)?="([^"]+)"/g)) keys.add(m[1].replace(/&amp;/g, "&"));
// values shown via t(): price levels, booking types
// country names: t(`${flag} ${name}`) in js/timeline.js
for (const k of ["Thailand & Japan 2027", "🇹🇭 Thailand", "🇯🇵 Japan", "🇮🇱 Israel", "🌍 Other"]) keys.add(k);
for (const k of ["Free", "¥ (cheap)", "¥¥ (moderate)", "¥¥¥ (pricey)", "¥¥¥¥ (very pricey)", "Not listed", "optional", "recommended", "required"]) keys.add(k);
export const ALL_KEYS = [...keys].filter((k) => /[A-Za-z]/.test(k)).sort();
if (process.argv[1]?.endsWith("i18n-keys.mjs")) console.log(JSON.stringify(ALL_KEYS, null, 0));
