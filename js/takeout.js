// Reads Google Maps saved places exported with Google Takeout:
//  * "Saved Places.json"  (starred places, GeoJSON – old and new formats)
//  * "Saved/<list>.csv"   (saved lists: Title, Note, URL – usually no coordinates)
//  * the Takeout .zip itself (read in the browser, nothing is uploaded)
// Pure parsing functions are exported for tests.

export const inJapan = (lat, lng) => lat >= 24 && lat <= 45.7 && lng >= 122.9 && lng <= 146;

/** Coordinates hidden in a Google Maps URL (@lat,lng · !3dlat!4dlng · q=lat,lng). */
export function coordsFromUrl(url) {
  const s = String(url || "");
  const pats = [/!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/, /@(-?\d+\.\d+),(-?\d+\.\d+)/, /[?&](?:q|ll|query)=(-?\d+\.\d+),\s*(-?\d+\.\d+)/];
  for (const p of pats) {
    const m = s.match(p);
    if (m) return { lat: Number(m[1]), lng: Number(m[2]) };
  }
  return null;
}

const key = (name, lat, lng) => `${String(name).toLowerCase().trim()}|${lat ? lat.toFixed(4) : ""}|${lng ? lng.toFixed(4) : ""}`;

/** Starred places GeoJSON → [{name, address, lat, lng, url, list}] (lat/lng may be null). */
export function parseSavedPlacesJson(text, list = "Starred places") {
  const data = JSON.parse(text);
  const feats = Array.isArray(data?.features) ? data.features : [];
  return feats.map((f) => {
    const p = f.properties || {};
    const loc = p.location || p.Location || {};
    const geo = loc["Geo Coordinates"] || {};
    let lat = Number(geo.Latitude ?? f.geometry?.coordinates?.[1]);
    let lng = Number(geo.Longitude ?? f.geometry?.coordinates?.[0]);
    const url = p.google_maps_url || p["Google Maps URL"] || "";
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || (lat === 0 && lng === 0)) {
      const c = coordsFromUrl(url);
      lat = c?.lat ?? null; lng = c?.lng ?? null;
    }
    const name = loc.name || loc["Business Name"] || p.Title || loc.address || loc.Address || "Saved place";
    return { name, address: loc.address || loc.Address || "", lat, lng, url, list, country: loc.country_code || loc["Country Code"] || "" };
  });
}

/** Minimal CSV parser (quotes, commas, newlines in quotes). */
export function parseCsv(text) {
  const rows = [];
  let row = [], cell = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (c === '"') q = false; else cell += c;
    } else if (c === '"') q = true;
    else if (c === ",") { row.push(cell); cell = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(cell); rows.push(row); row = []; cell = "";
    } else cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((x) => x.trim()));
}

/** Saved list CSV → places (Title, Note, URL[, Tags, Comment]). */
export function parseSavedListCsv(text, list = "Saved list") {
  const rows = parseCsv(text.replace(/^﻿/, ""));
  if (!rows.length) return [];
  const head = rows[0].map((h) => h.trim().toLowerCase());
  const ti = head.indexOf("title"), ui = head.indexOf("url"), ni = head.indexOf("note");
  if (ti < 0 && ui < 0) return [];
  return rows.slice(1).map((r) => {
    // An unquoted URL containing commas spills into extra columns – join it back.
    const extra = Math.max(0, r.length - head.length);
    const url = ui >= 0 ? r.slice(ui, ui + extra + 1).join(",") : "";
    const c = coordsFromUrl(url);
    return { name: (r[ti] || "").trim() || "Saved place", note: (r[ni] || "").trim(), address: "", lat: c?.lat ?? null, lng: c?.lng ?? null, url, list };
  }).filter((p) => p.name !== "Saved place" || p.url);
}

/** Merge new places into existing ones (dedupe by name + coordinates/URL). */
export function mergePlaces(existing, incoming) {
  const seen = new Set(existing.map((p) => p.url || key(p.name, p.lat, p.lng)));
  const out = [...existing];
  for (const p of incoming) {
    const k = p.url || key(p.name, p.lat, p.lng);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push({ ...p, id: `g-${Math.random().toString(36).slice(2, 10)}` });
  }
  return out;
}

/* ---------------- zip (browser only) ---------------- */
async function inflateRaw(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** Returns [{name, text}] for .json/.csv files inside a Takeout zip. */
export async function readZip(buffer) {
  const u8 = new Uint8Array(buffer);
  const dv = new DataView(buffer);
  let eocd = -1;
  for (let i = u8.length - 22; i >= Math.max(0, u8.length - 70000); i--) {
    if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error("Not a zip file");
  const count = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true);
  const out = [];
  const dec = new TextDecoder();
  for (let n = 0; n < count; n++) {
    if (dv.getUint32(p, true) !== 0x02014b50) break;
    const method = dv.getUint16(p + 10, true);
    const csize = dv.getUint32(p + 20, true);
    const nlen = dv.getUint16(p + 28, true), xlen = dv.getUint16(p + 30, true), clen = dv.getUint16(p + 32, true);
    const local = dv.getUint32(p + 42, true);
    const name = dec.decode(u8.subarray(p + 46, p + 46 + nlen));
    p += 46 + nlen + xlen + clen;
    if (!/\.(json|csv)$/i.test(name) || !/(saved|maps)/i.test(name)) continue;
    const lnlen = dv.getUint16(local + 26, true), lxlen = dv.getUint16(local + 28, true);
    const start = local + 30 + lnlen + lxlen;
    const data = u8.subarray(start, start + csize);
    const raw = method === 0 ? data : method === 8 ? await inflateRaw(data) : null;
    if (raw) out.push({ name, text: dec.decode(raw) });
  }
  return out;
}

/** Parse any supported file (zip, json, csv) into places. */
export async function placesFromFile(file) {
  const files = /\.zip$/i.test(file.name) ? await readZip(await file.arrayBuffer()) : [{ name: file.name, text: await file.text() }];
  const places = [];
  for (const f of files) {
    const base = f.name.split("/").pop().replace(/\.(json|csv)$/i, "");
    try {
      if (/\.json$/i.test(f.name)) places.push(...parseSavedPlacesJson(f.text, /saved places/i.test(base) ? "Starred places" : base));
      else places.push(...parseSavedListCsv(f.text, base));
    } catch { /* skip unreadable files */ }
  }
  return places;
}
