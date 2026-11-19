// 🗺️ Map tab: every saved place on one map (free OpenStreetMap tiles, no key).
// Tapping a pin opens it in Google Maps (place page or directions).
// Layers: your plan · more ideas from the 5-day pools · food · your Google Maps
// saved places (imported from Google Takeout) · tax-refund shops.
import { esc, getJSON, store } from "./util.js";
import { L as tr, t, tn } from "./i18n.js";
import { dayColor } from "./theme.js";
import { inJapan, mergePlaces, placesFromFile } from "./takeout.js";
import { allTaxRecords, saveTaxRecord } from "./tax.js";
import { allFood, allPoolStops, tripReady } from "./trip2027.js";
import { mapsLink } from "./plan.js";

const LAYERS = [
  ["plan", "🗓️ My plan", true],
  ["ideas", "💡 More ideas", false],
  ["food", "🍽️ Food", false],
  ["google", "⭐ My Google places", true],
  ["tax", "🧾 Tax-refund shops", true],
  ["mine", "📌 My spots", true],
  ["wish", "💖 Kids' wishlist", true],
];

let map, group, root, ctx;
const ui = { layers: Object.fromEntries(LAYERS.map(([k, , on]) => [k, on])), day: "all", busy: false, msg: "" };

/* ---------------- my live location + saved spots ---------------- */
const loc = { on: store.get("mapTrack") === true, follow: false, watch: null, pos: null, dot: null, ring: null, error: "" };
const mySpots = () => store.get("myspots") || [];
const setMySpots = (l) => store.set("myspots", l);

function kmBetween(a, b) {
  const R = 6371, t = (x) => (x * Math.PI) / 180;
  const h = Math.sin(t(b.lat - a.lat) / 2) ** 2 + Math.cos(t(a.lat)) * Math.cos(t(b.lat)) * Math.sin(t(b.lng - a.lng) / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
const fmtKm = (km) => (km < 1 ? t("{n} m", { n: Math.round(km * 1000 / 10) * 10 }) : t("{n} km", { n: km.toFixed(km < 10 ? 1 : 0) }));

function drawMe() {
  if (!map || !loc.pos) return;
  const ll = [loc.pos.lat, loc.pos.lng];
  if (!loc.dot || !map.hasLayer(loc.dot)) {
    loc.ring = L.circle(ll, { radius: loc.pos.acc, color: "#1a73e8", weight: 1, fillColor: "#1a73e8", fillOpacity: 0.12, interactive: false }).addTo(map);
    loc.dot = L.marker(ll, { icon: L.divIcon({ className: "me-dot", html: "<span></span>", iconSize: [22, 22], iconAnchor: [11, 11] }), zIndexOffset: 1000, title: t("You are here") })
      .bindPopup(() => mePopup()).addTo(map);
  } else {
    loc.dot.setLatLng(ll);
    loc.ring.setLatLng(ll).setRadius(loc.pos.acc);
  }
  if (loc.follow) map.setView(ll, Math.max(map.getZoom(), 16), { animate: false });
}

function mePopup() {
  const p = loc.pos;
  return `<div class="pop"><strong>${t("📍 You are here")}</strong><br><span class="small">${t("Accuracy ±{n} m", { n: Math.round(p.acc) })}</span>
    <div class="pop-links"><button type="button" data-spot-save="me">${ctx?.isKid?.() ? t("💖 Suggest this spot") : t("📌 Save this spot")}</button>
    <a href="https://www.google.com/maps/search/?api=1&query=${p.lat},${p.lng}" target="_blank" rel="noopener">${t("📍 Open in Google Maps")}</a></div></div>`;
}

function setStatus(t) { const el = root?.querySelector("#map-status"); if (el) el.textContent = t; }

function startTracking(center) {
  if (!navigator.geolocation) { loc.error = t("Location is not available on this device."); loc.on = false; return; }
  if (loc.watch !== null) { if (center && loc.pos) map.setView([loc.pos.lat, loc.pos.lng], 16); return; }
  let first = true;
  loc.watch = navigator.geolocation.watchPosition((pos) => {
    loc.pos = { lat: pos.coords.latitude, lng: pos.coords.longitude, acc: pos.coords.accuracy || 30 };
    loc.error = "";
    drawMe();
    if (first && center) map.setView([loc.pos.lat, loc.pos.lng], 16, { animate: false });
    first = false;
    updateMeButtons();
  }, (err) => {
    loc.error = err.code === 1 ? t("Location permission was denied – allow it in your browser settings to see yourself on the map.") : t("Couldn't get your location right now.");
    if (err.code === 1) { loc.on = false; store.set("mapTrack", false); stopMapTracking(); }
    setStatus(loc.error);
    updateMeButtons();
  }, { enableHighAccuracy: true, maximumAge: 5000, timeout: 20000 });
}

/** Stop GPS (called when leaving the Map tab, to save battery). */
export function stopMapTracking() {
  if (loc.watch !== null) navigator.geolocation.clearWatch(loc.watch);
  loc.watch = null;
  loc.follow = false;
}

function updateMeButtons() {
  const me = root?.querySelector("[data-mapact='me']");
  const fol = root?.querySelector("[data-mapact='follow']");
  if (me) { me.textContent = loc.on ? t("📍 My location: on") : t("📍 Show my location"); me.setAttribute("aria-pressed", String(loc.on)); }
  if (fol) { fol.hidden = !loc.on; fol.setAttribute("aria-pressed", String(loc.follow)); fol.textContent = loc.follow ? t("🎯 Following you") : t("🎯 Follow me"); }
}

function saveSpot(lat, lng) {
  if (ctx?.isKid?.()) { map.closePopup(); ctx.onSuggestAt(lat, lng); return; }
  const name = prompt(t("Name this spot (e.g. 'Great ramen', 'Meeting point'):"), t("My spot"));
  if (name === null) return;
  const list = mySpots();
  list.push({ id: `s-${Date.now().toString(36)}`, name: name.trim() || t("My spot"), lat, lng, created: new Date().toISOString() });
  setMySpots(list);
  map.closePopup();
  drawMarkers(false);
}
const gplaces = () => store.get("gplaces") || [];
const setGplaces = (list) => store.set("gplaces", list);

const directions = (p) => `https://www.google.com/maps/dir/?api=1&destination=${p.lat},${p.lng}&travelmode=transit`;
const placeLink = (p) => p.url || mapsLink(p);

function pinIcon(emoji, color, small = false) {
  const s = small ? 26 : 34;
  return L.divIcon({
    className: "pin",
    html: `<span style="background:${color};width:${s}px;height:${s}px;font-size:${small ? 13 : 17}px">${emoji}</span>`,
    iconSize: [s, s], iconAnchor: [s / 2, s / 2], popupAnchor: [0, -s / 2],
  });
}

/** All markers for the current filters. */
async function collect() {
  const out = [];
  const days = ctx.days();
  const planIds = new Set();
  const dayFilter = ui.day;

  days.forEach((d, i) => {
    const n = d.planKey?.startsWith("apr-d") ? Number(d.planKey.slice(5)) : i + 1;
    if (dayFilter !== "all" && Number(dayFilter) !== i) return;
    const color = dayColor(d, i).ink;
    const label = ctx.dayName(d, i);
    const pts = [d.start, ...d.stops].filter(Boolean);
    pts.forEach((p, k) => {
      if (p.id) planIds.add(p.id);
      if (!ui.layers.plan || !Number.isFinite(p.lat)) return;
      const isBase = /^pin-(hotel|narita)/.test(p.id || "") || (k === 0 && !p.categories);
      out.push({
        layer: "plan", lat: p.lat, lng: p.lng, color, emoji: isBase ? (p.id === "pin-narita" ? "✈️" : "🏨") : (p.emoji || String(k)),
        title: p.name, sub: `${label}${p.time ? ` · ${p.time}` : ""}${tr(p, "type") ? ` · ${tr(p, "type")}` : ""}`, link: placeLink(p), small: false,
      });
    });
  });

  if (tripReady() && (ui.layers.ideas || ui.layers.food)) {
    const dayNums = dayFilter === "all" ? null : (() => {
      const d = days[Number(dayFilter)];
      return d?.planKey?.startsWith("apr-d") ? [Number(d.planKey.slice(5))] : [];
    })();
    if (ui.layers.ideas) {
      for (const s of allPoolStops()) {
        if (planIds.has(s.id) || (dayNums && !dayNums.includes(s.day))) continue;
        out.push({ layer: "ideas", lat: s.lat, lng: s.lng, color: dayColor({ planKey: `apr-d${s.day}` }, 0).ink, emoji: s.emoji, title: s.name,
          sub: `${t("Idea for Day {n}", { n: s.day })} · ${tr(s, "type")}`, link: placeLink(s), small: true });
      }
    }
    if (ui.layers.food) {
      const seen = new Set();
      for (const f of allFood()) {
        if (/konbini/.test(f.id) || (dayNums && !dayNums.includes(f.day))) continue;
        const k = `${f.name}|${f.lat}`;
        if (seen.has(k)) continue;
        seen.add(k);
        out.push({ layer: "food", lat: f.lat, lng: f.lng, color: "#8d5524", emoji: f.emoji, title: f.name,
          sub: `${tr(f, "type")} · ${tr(f, "cost")}${f.cashOnly ? ` · ${t("💴 cash only")}` : ""}`, link: placeLink(f), small: true });
      }
    }
  }

  if (ui.layers.google && dayFilter === "all") {
    for (const p of gplaces()) {
      if (!Number.isFinite(p.lat) || !inJapan(p.lat, p.lng)) continue;
      out.push({ layer: "google", lat: p.lat, lng: p.lng, color: "#f2b705", emoji: "⭐", title: p.name,
        sub: `${p.list}${p.note ? ` · ${p.note}` : ""}${p.address ? ` · ${p.address}` : ""}`, link: placeLink(p), small: false });
    }
  }

  if (ui.layers.mine && dayFilter === "all") {
    for (const sp of mySpots()) {
      out.push({ layer: "mine", lat: sp.lat, lng: sp.lng, color: "#0f8b8d", emoji: "📌", title: sp.name,
        sub: t("Saved {date}", { date: sp.created.slice(0, 10) }), link: `https://www.google.com/maps/search/?api=1&query=${sp.lat},${sp.lng}`, spotId: sp.id });
    }
  }

  if (ui.layers.wish && dayFilter === "all" && ctx.wishlist) {
    for (const w of ctx.wishlist()) {
      const st = w.status === "approved" ? t("✅ Approved") : w.status === "declined" ? t("✖ Not this time") : t("⏳ Waiting for approval");
      out.push({ layer: "wish", lat: w.lat, lng: w.lng, color: w.status === "approved" ? "#22703D" : w.status === "declined" ? "#8A8A8A" : "#D63F7A",
        emoji: w.emoji || "💖", title: w.name, sub: `${t("💖 {name}'s idea", { name: w.by })} · ${st}${w.note ? ` · “${w.note}”` : ""}`,
        link: placeLink({ name: w.name, lat: w.lat, lng: w.lng, id: w.placeId || "pin-x" }) });
    }
  }

  if (ui.layers.tax && dayFilter === "all") {
    for (const r of await taxRecordsSafe()) {
      if (!Number.isFinite(r.lat)) continue;
      out.push({ layer: "tax", lat: r.lat, lng: r.lng, color: "#c9184a", emoji: "🧾", title: r.shop || t("Shop"),
        sub: `${r.description || t("Purchase")} · ${r.date}`, link: placeLink({ name: r.shop, lat: r.lat, lng: r.lng, id: r.placeId }), small: false });
    }
  }
  return out;
}

async function taxRecordsSafe() {
  try { return await allTaxRecords(); } catch { return []; }
}

function popupHtml(m) {
  const dist = loc.pos ? `<br><span class="small">📏 ${t("{d} from you (straight line)", { d: fmtKm(kmBetween(loc.pos, m)) })}</span>` : "";
  return `<div class="pop"><strong>${esc(m.title)}</strong><br><span class="small">${esc(m.sub)}</span>${dist}
    <div class="pop-links"><a href="${esc(m.link)}" target="_blank" rel="noopener">${t("📍 Open in Google Maps")}</a>
    <a href="${esc(directions(m))}" target="_blank" rel="noopener">${t("🧭 Directions")}</a>
    ${m.spotId ? `<button type="button" data-spot-del="${esc(m.spotId)}">${t("🗑️ Delete this spot")}</button>` : ""}</div></div>`;
}

/* ---------------- render ---------------- */
export async function renderMapView(container, context) {
  root = container;
  ctx = context;
  const g = gplaces();
  const gPending = g.filter((p) => !Number.isFinite(p.lat) && !p.notFound).length;
  const gShown = g.filter((p) => Number.isFinite(p.lat) && inJapan(p.lat, p.lng)).length;
  const gOutside = g.filter((p) => Number.isFinite(p.lat) && !inJapan(p.lat, p.lng)).length;
  const tax = await taxRecordsSafe();
  const taxPending = tax.filter((r) => !Number.isFinite(r.lat) && r.shop && !r.notFound).length;
  const days = ctx.days();

  root.innerHTML = `
    <div class="chips" role="group" aria-label="${t("Layers")}">${LAYERS.filter(([k]) => !(ctx.isKid?.() && ["tax", "google", "mine"].includes(k))).filter(([k]) => k !== "wish" || ctx.wishlist?.().length).map(([k, label]) =>
      `<button class="chip" type="button" data-layer="${k}" aria-pressed="${ui.layers[k]}">${t(label)}</button>`).join("")}</div>
    <div class="chips" role="group" aria-label="${t("Day")}">
      <button class="chip" type="button" data-mapday="all" aria-pressed="${ui.day === "all"}">${t("All days")}</button>
      ${days.map((d, i) => `<button class="chip day-chip" style="--day-bg:${dayColor(d, i).bg};--day-ink:${dayColor(d, i).ink}" type="button" data-mapday="${i}" aria-pressed="${ui.day === String(i)}">${esc(ctx.dayName(d, i))}</button>`).join("")}
    </div>
    <div id="big-map" class="big-map" aria-label="${t("Map of all saved places")}" dir="ltr"></div>
    <div class="row tight">
      <button class="btn btn-secondary" type="button" data-mapact="fit">${t("🔍 Show all")}</button>
      <button class="btn btn-secondary" type="button" data-mapact="me" aria-pressed="${loc.on}">${loc.on ? t("📍 My location: on") : t("📍 Show my location")}</button>
      <button class="btn btn-secondary" type="button" data-mapact="follow" aria-pressed="${loc.follow}" ${loc.on ? "" : "hidden"}>${loc.follow ? t("🎯 Following you") : t("🎯 Follow me")}</button>
    </div>
    <p class="small">${ctx.isKid?.() ? t("Tip: long-press anywhere on the map to suggest that place to your parent 💖") : t("Tip: long-press anywhere on the map (or tap your blue dot) to save a 📌 spot.")}</p>
    <p class="status" id="map-status">${esc(ui.msg)}</p>
    <details class="map-list"><summary>${t("📋 List of places on the map")}</summary><div id="map-list"></div></details>

    ${ctx.isKid?.() ? "" : `<details class="tax-info" ${!g.length || gPending ? "open" : ""}>
      <summary>${t("⭐ Import my Google Maps saved places")}</summary>
      <ol>
        <li>${t("Open <a href=\"https://takeout.google.com/\" target=\"_blank\" rel=\"noopener\">takeout.google.com</a> (signed in to your Google account).")}</li>
        <li>${t("Tap <strong>Deselect all</strong>, then tick <strong>Saved</strong> (your lists) and <strong>Maps (your places)</strong> (starred places).")}</li>
        <li>${t("<strong>Next step → Create export</strong>. Google emails a link, usually within minutes.")}</li>
        <li>${t("Download the <strong>.zip</strong> on this phone, then choose it below (or the “Saved Places.json” / list .csv files inside it).")}</li>
      </ol>
      <label class="btn btn-primary full">${t("📂 Choose Takeout file(s)")}<input type="file" accept=".zip,.json,.csv,application/zip,application/json,text/csv" multiple data-mapfile hidden></label>
      <p class="small">${t("Read on this phone only – nothing is uploaded. Only places in Japan are shown.")}</p>
      ${g.length ? `<p>⭐ ${tn(gShown, "1 place on the map", "{n} places on the map")}${gOutside ? ` · ${t("{n} outside Japan (hidden)", { n: gOutside })}` : ""}${gPending ? ` · ${t("{n} without coordinates", { n: gPending })}` : ""}</p>` : ""}
      ${gPending ? `<button class="btn btn-secondary full" type="button" data-mapact="find-google">${t("🔎 Find {n} with Google", { n: gPending })}</button>
        <p class="small">${t("Google exports saved lists without coordinates. Each lookup uses one Google search from your free monthly allowance (your daily cap may stop it – try the rest tomorrow).")}</p>` : ""}
      ${g.length ? `<button class="btn btn-secondary full" type="button" data-mapact="clear-google">${t("🗑️ Remove imported Google places")}</button>` : ""}
    </details>`}
    ${taxPending && !ctx.isKid?.() ? `<div class="promo"><p>🧾 ${t("{n} tax-refund shops have no location yet.", { n: taxPending })}</p>
      <button class="btn btn-secondary full" type="button" data-mapact="find-tax">${t("🔎 Find {n} with Google", { n: taxPending })}</button>
      <p class="small">${t("Tip: when adding a receipt you can also tap “📍 I'm at the shop” to save the location for free.")}</p></div>` : ""}`;

  {
    if (map) map.remove(); // the container was re-rendered
    map = L.map("big-map", { zoomControl: true }).setView([35.6812, 139.7671], 11);
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    }).addTo(map);
    group = L.featureGroup().addTo(map);
    loc.dot = null; // new map: redraw my location layer
    map.on("contextmenu", (e) => saveSpot(e.latlng.lat, e.latlng.lng)); // long-press on phones
    map.on("dragstart", () => { if (loc.follow) { loc.follow = false; updateMeButtons(); } });
    map.on("popupopen", (e) => {
      const el = e.popup.getElement();
      el.querySelector("[data-spot-save]")?.addEventListener("click", () => saveSpot(loc.pos.lat, loc.pos.lng));
      el.querySelector("[data-spot-del]")?.addEventListener("click", (ev) => {
        if (!confirm(t("Delete this saved spot?"))) return;
        setMySpots(mySpots().filter((x) => x.id !== ev.currentTarget.dataset.spotDel));
        map.closePopup();
        drawMarkers(false);
      });
    });
  }
  await drawMarkers(true);
  if (loc.on) { drawMe(); startTracking(false); }
}

let drawRun = 0;
async function drawMarkers(fit) {
  const run = ++drawRun;
  const markers = await collect();
  if (run !== drawRun) return; // a newer draw started
  group.clearLayers();
  for (const m of markers) L.marker([m.lat, m.lng], { icon: pinIcon(m.emoji, m.color, m.small), title: m.title }).bindPopup(() => popupHtml(m)).addTo(group);
  const m0 = map, g0 = group;
  setTimeout(() => {
    if (m0 !== map || !m0.getContainer().isConnected) return; // map was rebuilt meanwhile
    m0.invalidateSize();
    if (!fit || !markers.length) return;
    // Fit to central Tokyo unless the user picked a day (Narita would shrink everything).
    const tokyo = markers.filter((m) => m.lat > 35.45 && m.lat < 35.95 && m.lng > 139.45 && m.lng < 140.0);
    const use = ui.day === "all" && tokyo.length >= 2 ? tokyo : markers;
    m0.fitBounds(L.latLngBounds(use.map((m) => [m.lat, m.lng])).pad(0.12), { maxZoom: 15, animate: false });
  }, 60);
  const counts = LAYERS.map(([k, label]) => [label, markers.filter((m) => m.layer === k).length]).filter(([, n]) => n);
  root.querySelector("#map-status").textContent = ui.msg || (markers.length
    ? `${tn(markers.length, "1 place", "{n} places")} · ${counts.map(([l, n]) => `${t(l).split(" ").slice(1).join(" ")} ${n}`).join(" · ")}`
    : t("No places yet – load the April trip, add stops, or import your Google places."));
  root.querySelector("#map-list").innerHTML = markers.length ? `<ul class="map-ul">${markers.map((m) =>
    `<li><span>${m.emoji} <strong>${esc(m.title)}</strong><br><span class="small">${esc(m.sub)}</span></span>
     <a class="mini-link" href="${esc(m.link)}" target="_blank" rel="noopener">${t("Google Maps")}</a></li>`).join("")}</ul>` : "";
}

/* ---------------- lookups (Google, free tier) ---------------- */
async function lookupMany(items, query, apply, label) {
  if (ui.busy) return;
  ui.busy = true;
  let ok = 0, miss = 0;
  try {
    for (let i = 0; i < items.length; i++) {
      root.querySelector("#map-status").textContent = t("Finding {i} of {n}…", { i: i + 1, n: items.length });
      try {
        const { place } = await getJSON(`/api/find?q=${encodeURIComponent(query(items[i]))}`);
        if (place && inJapan(place.lat, place.lng)) { await apply(items[i], place); ok++; } else { await apply(items[i], null); miss++; }
      } catch (err) {
        ui.msg = t("Stopped: {e}. Found {n} so far – try the rest later.", { e: err.message, n: ok });
        break;
      }
    }
  } finally {
    ui.busy = false;
  }
  if (!ui.msg) ui.msg = t("Found {n}.", { n: ok }) + (miss ? ` ${t("{n} not found in Japan.", { n: miss })}` : "");
  await renderMapView(root, ctx);
  ui.msg = "";
}

/* ---------------- events ---------------- */
export function initMapView(container) {
  container.addEventListener("click", async (e) => {
    const layer = e.target.closest("[data-layer]");
    if (layer) { ui.layers[layer.dataset.layer] = !ui.layers[layer.dataset.layer]; layer.setAttribute("aria-pressed", ui.layers[layer.dataset.layer]); return drawMarkers(false); }
    const day = e.target.closest("[data-mapday]");
    if (day) {
      ui.day = day.dataset.mapday;
      container.querySelectorAll("[data-mapday]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.mapday === ui.day)));
      return drawMarkers(true);
    }
    const act = e.target.closest("[data-mapact]")?.dataset.mapact;
    if (!act) return undefined;
    if (act === "fit") return drawMarkers(true);
    if (act === "me") {
      if (loc.on && loc.pos && !map.getBounds().contains([loc.pos.lat, loc.pos.lng])) {
        map.setView([loc.pos.lat, loc.pos.lng], 16); // already on: bring me back into view
        return undefined;
      }
      loc.on = !loc.on;
      store.set("mapTrack", loc.on);
      if (loc.on) {
        setStatus(t("Finding your location…"));
        root.querySelector("#big-map").scrollIntoView({ behavior: "smooth", block: "center" });
        startTracking(true);
      } else {
        stopMapTracking();
        if (loc.dot) { map.removeLayer(loc.dot); map.removeLayer(loc.ring); loc.dot = null; }
        loc.pos = null;
        drawMarkers(false);
      }
      return updateMeButtons();
    }
    if (act === "follow") {
      loc.follow = !loc.follow;
      if (loc.follow && loc.pos) map.setView([loc.pos.lat, loc.pos.lng], Math.max(map.getZoom(), 16));
      return updateMeButtons();
    }
    if (act === "clear-google") {
      if (!confirm(t("Remove all imported Google places from this app? (Your Google account is not changed.)"))) return undefined;
      setGplaces([]);
      return renderMapView(root, ctx);
    }
    if (act === "find-google") {
      const pending = gplaces().filter((p) => !Number.isFinite(p.lat) && !p.notFound);
      if (pending.length > 25 && !confirm(t("Look up {n} places with Google? Each uses one search from your free monthly allowance.", { n: pending.length }))) return undefined;
      return lookupMany(pending, (p) => [p.name, p.address].filter(Boolean).join(" "), (p, place) => {
        const list = gplaces();
        const t = list.find((x) => x.id === p.id);
        if (t) {
          if (place) Object.assign(t, { lat: place.lat, lng: place.lng, address: t.address || place.address, placeId: place.id });
          else t.notFound = true;
        }
        setGplaces(list);
      }, "place");
    }
    if (act === "find-tax") {
      const pending = (await taxRecordsSafe()).filter((r) => !Number.isFinite(r.lat) && r.shop && !r.notFound);
      return lookupMany(pending, (r) => `${r.shop} Japan`, (r, place) =>
        saveTaxRecord(place ? { ...r, lat: place.lat, lng: place.lng, placeId: place.id } : { ...r, notFound: true }), "shop");
    }
    return undefined;
  });

  container.addEventListener("change", async (e) => {
    const input = e.target.closest("[data-mapfile]");
    if (!input?.files?.length) return;
    const files = [...input.files];
    input.value = "";
    const status = container.querySelector("#map-status");
    status.textContent = t("Reading your Google Takeout file…");
    let incoming = [];
    for (const f of files) {
      try { incoming = incoming.concat(await placesFromFile(f)); } catch (err) { alert(`${f.name}: ${err.message}`); }
    }
    if (!incoming.length) {
      ui.msg = t("No saved places found in that file. Choose the Takeout .zip, “Saved Places.json” or a list .csv.");
      return renderMapView(root, ctx).then(() => { ui.msg = ""; });
    }
    const before = gplaces().length;
    const merged = mergePlaces(gplaces(), incoming);
    setGplaces(merged);
    const added = merged.length - before;
    ui.msg = t("Imported {n} new places ({m} already there).", { n: added, m: incoming.length - added });
    ui.layers.google = true;
    await renderMapView(root, ctx);
    ui.msg = "";
  });
}
