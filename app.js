// Tokyo Kids Explorer – plain JavaScript frontend.
// No API keys here: every Google / Claude call goes through /api/* on Vercel.

const DAY_MS = 24 * 60 * 60 * 1000;
const TOKYO_STATION = { lat: 35.6812, lng: 139.7671, label: "Tokyo Station" };
const CATEGORIES = [
  ["all", "⭐ Top picks"],
  ["museums", "🔬 Museums"],
  ["animals", "🐼 Zoos & aquariums"],
  ["parks", "🌳 Parks"],
  ["fun", "🎢 Fun & games"],
  ["anime", "🎮 Anime & toys"],
  ["views", "🗼 Views"],
];
const PRICE = {
  PRICE_LEVEL_FREE: "Free",
  PRICE_LEVEL_INEXPENSIVE: "¥ (cheap)",
  PRICE_LEVEL_MODERATE: "¥¥ (moderate)",
  PRICE_LEVEL_EXPENSIVE: "¥¥¥ (pricey)",
  PRICE_LEVEL_VERY_EXPENSIVE: "¥¥¥¥ (very pricey)",
};

const $ = (sel) => document.querySelector(sel);
const els = {
  startLabel: $("#start-label"), changeStart: $("#change-start"), picker: $("#picker"),
  search: $("#search"), suggestions: $("#suggestions"), useLocation: $("#use-location"),
  saveStart: $("#save-start"), categories: $("#categories"), openNow: $("#open-now"),
  status: $("#status"), list: $("#list"),
};

const state = {
  start: null,          // saved starting point {lat, lng, label}
  draft: null,          // point being picked on the map
  category: "all",
  openOnly: false,
  places: [],
};

/* ---------- storage (localStorage can be unavailable: always guard) ---------- */
const store = {
  get(key) {
    try { return JSON.parse(localStorage.getItem(key)); } catch { return null; }
  },
  set(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* full or blocked */ }
  },
  getFresh(key) {
    const v = store.get(key);
    return v && Date.now() - v.t < DAY_MS ? v.data : null;
  },
  setFresh(key, data) { store.set(key, { t: Date.now(), data }); },
  prune() {
    try {
      for (let i = localStorage.length - 1; i >= 0; i--) {
        const k = localStorage.key(i);
        if (!k.startsWith("cache:")) continue;
        const v = store.get(k);
        if (!v || Date.now() - v.t > DAY_MS) localStorage.removeItem(k);
      }
    } catch { /* ignore */ }
  },
};

/* ---------- helpers ---------- */
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const r = (n, d) => Math.round(n * 10 ** d) / 10 ** d;

function distanceKm(a, b) {
  const R = 6371, toRad = (x) => (x * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat), dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
const fmtDist = (km) => (km < 1 ? `${Math.round(km * 1000 / 10) * 10} m` : `${km.toFixed(km < 10 ? 1 : 0)} km`);

async function getJSON(url) {
  const res = await fetch(url);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

/** Current day (0 = Sunday) and minutes since midnight, in Tokyo time. */
function tokyoNow() {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Tokyo", weekday: "short", hour: "numeric", minute: "numeric", hourCycle: "h23",
  }).formatToParts(new Date());
  const get = (t) => parts.find((p) => p.type === t)?.value;
  const day = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(get("weekday"));
  return { day, minutes: Number(get("hour")) * 60 + Number(get("minute")) };
}

/** true / false from the weekly opening periods, or null when unknown. */
function isOpenNow(periods) {
  if (!Array.isArray(periods) || periods.length === 0) return null;
  const { day, minutes } = tokyoNow();
  const WEEK = 7 * 1440;
  const now = day * 1440 + minutes;
  for (const p of periods) {
    if (!p.open) continue;
    if (!p.close) return true; // open 24/7
    const open = p.open.day * 1440 + (p.open.hour || 0) * 60 + (p.open.minute || 0);
    let close = p.close.day * 1440 + (p.close.hour || 0) * 60 + (p.close.minute || 0);
    if (close <= open) close += WEEK;
    if ((now >= open && now < close) || (now + WEEK >= open && now + WEEK < close)) return true;
  }
  return false;
}

/* ---------- starting point ---------- */
function showStart() {
  els.startLabel.textContent = state.start ? state.start.label : "Not set yet – pick one below";
}

let map, marker;
function openPicker() {
  els.picker.hidden = false;
  els.changeStart.hidden = true;
  state.draft = { ...(state.start || TOKYO_STATION) };
  if (!map) {
    map = L.map("map", { zoomControl: true }).setView([state.draft.lat, state.draft.lng], 14);
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    }).addTo(map);
    marker = L.marker([state.draft.lat, state.draft.lng], { draggable: true, autoPan: true }).addTo(map);
    marker.on("dragend", () => {
      const p = marker.getLatLng();
      setDraft(p.lat, p.lng, null);
    });
    map.on("click", (e) => setDraft(e.latlng.lat, e.latlng.lng, null));
  }
  setDraft(state.draft.lat, state.draft.lng, state.draft.label, true);
  setTimeout(() => map.invalidateSize(), 50);
}

function setDraft(lat, lng, label, recenter = false) {
  state.draft = { lat, lng, label: label || `Pinned spot (${lat.toFixed(4)}, ${lng.toFixed(4)})` };
  marker.setLatLng([lat, lng]);
  if (recenter) map.setView([lat, lng], Math.max(map.getZoom(), 15));
  els.saveStart.textContent = `Save: ${state.draft.label}`;
}

function saveStart() {
  if (!state.draft) return;
  state.start = state.draft;
  store.set("start", state.start);
  els.picker.hidden = true;
  els.changeStart.hidden = false;
  showStart();
  loadActivities();
}

function useMyLocation() {
  if (!navigator.geolocation) return alert("Location is not available on this device.");
  els.useLocation.disabled = true;
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      els.useLocation.disabled = false;
      setDraft(pos.coords.latitude, pos.coords.longitude, "My location", true);
    },
    () => {
      els.useLocation.disabled = false;
      alert("Could not get your location. Search or tap the map instead.");
    },
    { enableHighAccuracy: true, timeout: 10000 },
  );
}

/* ---------- search with Google Places Autocomplete (via /api) ---------- */
let sessionToken = crypto.randomUUID();
let searchTimer, searchSeq = 0;

els.search.addEventListener("input", () => {
  clearTimeout(searchTimer);
  const q = els.search.value.trim();
  if (q.length < 3) { hideSuggestions(); return; }
  searchTimer = setTimeout(() => runSearch(q), 350);
});

async function runSearch(q) {
  const seq = ++searchSeq;
  try {
    const { suggestions } = await getJSON(`/api/autocomplete?q=${encodeURIComponent(q)}&session=${sessionToken}`);
    if (seq !== searchSeq) return;
    if (!suggestions.length) {
      els.suggestions.innerHTML = `<li aria-disabled="true">No matches – try another name</li>`;
    } else {
      els.suggestions.innerHTML = suggestions.map((s) =>
        `<li role="option" tabindex="0" data-id="${esc(s.id)}" data-name="${esc(s.main)}">${esc(s.main)}<small>${esc(s.secondary)}</small></li>`).join("");
    }
    els.suggestions.hidden = false;
  } catch (err) {
    els.suggestions.innerHTML = `<li aria-disabled="true">${esc(err.message)}</li>`;
    els.suggestions.hidden = false;
  }
}

function hideSuggestions() { els.suggestions.hidden = true; els.suggestions.innerHTML = ""; }

async function chooseSuggestion(li) {
  if (!li?.dataset.id) return;
  const name = li.dataset.name;
  hideSuggestions();
  els.search.value = name;
  try {
    const p = await getJSON(`/api/place?id=${encodeURIComponent(li.dataset.id)}&session=${sessionToken}`);
    setDraft(p.lat, p.lng, name, true);
  } catch (err) {
    alert(err.message);
  } finally {
    sessionToken = crypto.randomUUID(); // a session ends once a place is picked
  }
}
els.suggestions.addEventListener("click", (e) => chooseSuggestion(e.target.closest("li")));
els.suggestions.addEventListener("keydown", (e) => { if (e.key === "Enter") chooseSuggestion(e.target.closest("li")); });

/* ---------- activities ---------- */
function renderCategories() {
  els.categories.innerHTML = CATEGORIES.map(([id, label]) =>
    `<button class="chip" type="button" data-cat="${id}" aria-pressed="${id === state.category}">${label}</button>`).join("");
}

async function loadActivities() {
  if (!state.start) { els.status.textContent = "Set a starting point first."; els.list.innerHTML = ""; return; }
  const near = `${r(state.start.lat, 2)},${r(state.start.lng, 2)}`;
  const cacheKey = `cache:act:${state.category}:${near}`;
  let data = store.getFresh(cacheKey);
  if (!data) {
    els.status.textContent = "Finding fun places…";
    els.list.innerHTML = "";
    try {
      data = await getJSON(`/api/activities?category=${state.category}&near=${near}`);
      store.setFresh(cacheKey, data);
    } catch (err) {
      els.status.textContent = `Sorry: ${err.message}`;
      return;
    }
  }
  if (data.category !== state.category) return; // user switched meanwhile
  state.places = data.places
    .map((p) => ({ ...p, km: distanceKm(state.start, p) }))
    .sort((a, b) => a.km - b.km);
  renderList();
}

function renderList() {
  const now = tokyoNow();
  const todayIdx = (now.day + 6) % 7; // Google's weekdayDescriptions start on Monday
  let items = state.places.map((p) => ({ ...p, open: p.temporarilyClosed ? false : isOpenNow(p.periods) }));
  if (state.openOnly) items = items.filter((p) => p.open === true);

  els.status.textContent = items.length
    ? `${items.length} places, nearest first`
    : state.openOnly ? "Nothing open right now in this category. Try another one!" : "No places found.";

  els.list.innerHTML = items.map((p) => {
    const badge = p.temporarilyClosed
      ? `<span class="badge closed">Temporarily closed</span>`
      : p.open === true ? `<span class="badge open">Open now</span>`
      : p.open === false ? `<span class="badge closed">Closed now</span>` : "";
    const rating = p.rating ? `★ ${p.rating.toFixed(1)} <span class="small">(${p.reviews.toLocaleString()} reviews)</span>` : "No rating yet";
    const hours = p.hours
      ? `<ul class="hours">${p.hours.map((h, i) => `<li class="${i === todayIdx ? "today" : ""}">${esc(h)}</li>`).join("")}</ul>`
      : "Not listed";
    const hasSite = /^https?:\/\//.test(p.website || "");
    const navUrl = `https://www.google.com/maps/dir/?api=1&origin=${state.start.lat},${state.start.lng}` +
      `&destination=${encodeURIComponent(p.name)}&destination_place_id=${encodeURIComponent(p.id)}&travelmode=transit`;
    return `
<details class="activity" data-id="${esc(p.id)}">
  <summary>
    <span class="name">${esc(p.name)}</span>
    <span class="dist">${fmtDist(p.km)}</span>
    <span class="meta">${rating}${badge}</span>
  </summary>
  <div class="details">
    <dl>
      ${p.type ? `<dt>Type</dt><dd>${esc(p.type)}</dd>` : ""}
      <dt>Address</dt><dd>${esc(p.address)}</dd>
      <dt>Rating</dt><dd>${rating}</dd>
      <dt>Price</dt><dd>${esc(PRICE[p.price] || "Not listed")}</dd>
      <dt>Distance</dt><dd>${fmtDist(p.km)} (straight line)</dd>
      <dt>Hours</dt><dd>${hours}</dd>
    </dl>
    <div class="actions">
      <button class="btn btn-primary wide" type="button" data-guide="${esc(p.id)}">🚆 How to get there</button>
      <a class="btn btn-secondary${hasSite ? "" : " wide"}" href="${esc(navUrl)}" target="_blank" rel="noopener">🧭 Navigate</a>
      ${hasSite ? `<a class="btn btn-secondary" href="${esc(p.website)}" target="_blank" rel="noopener">🌐 Official site</a>` : ""}
    </div>
    <div class="guide-slot"></div>
  </div>
</details>`;
  }).join("");
}

/* ---------- route guide ---------- */
const VEHICLE_ICON = { Subway: "🚇", Train: "🚆", Shinkansen: "🚄", Monorail: "🚝", Tram: "🚋", Bus: "🚌", Ferry: "⛴️", "Cable car": "🚡", Ropeway: "🚡" };

async function showGuide(button) {
  const place = state.places.find((p) => p.id === button.dataset.guide);
  const slot = button.closest(".details").querySelector(".guide-slot");
  if (!place || !state.start) return;

  const from = `${r(state.start.lat, 3)},${r(state.start.lng, 3)}`;
  const to = `${r(place.lat, 4)},${r(place.lng, 4)}`;
  const cacheKey = `cache:guide:${from}:${to}`;
  let data = store.getFresh(cacheKey);
  if (!data) {
    button.disabled = true;
    slot.innerHTML = `<div class="guide"><p>Planning the trip and writing your guide… (about 10 seconds)</p></div>`;
    try {
      data = await getJSON(`/api/guide?from=${from}&to=${to}&name=${encodeURIComponent(place.name)}`);
      store.setFresh(cacheKey, data);
    } catch (err) {
      slot.innerHTML = `<div class="guide"><p><strong>Sorry:</strong> ${esc(err.message)}</p><p>Tap “Navigate” to open Google Maps instead.</p></div>`;
      return;
    } finally {
      button.disabled = false;
    }
  }
  slot.innerHTML = `<div class="guide">${renderRoute(data.route)}${renderGuideText(data.guide)}
    <p class="small">Planned ${new Date(data.createdAt).toLocaleString("en-GB", { timeZone: "Asia/Tokyo", dateStyle: "medium", timeStyle: "short" })} (Tokyo time). Trains change – check station signs.</p></div>`;
  slot.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

function renderRoute(route) {
  const head = `⏱ ${route.totalMinutes} min · ${route.transfers} transfer${route.transfers === 1 ? "" : "s"}` +
    (route.adultFare ? ` · ${esc(route.adultFare)} per adult` : "");
  const legs = route.steps.map((s) => {
    if (s.mode === "WALK") return `<li><span class="icon">🚶</span><span>Walk ${s.minutes} min (${s.meters} m)</span></li>`;
    const hex = (c) => (/^#[0-9a-f]{3,8}$/i.test(c || "") ? c : null);
    const style = hex(s.color) ? `style="background:${hex(s.color)};color:${hex(s.textColor) || "#fff"}"` : "";
    return `<li><span class="icon">${VEHICLE_ICON[s.vehicle] || "🚆"}</span><span>
      <span class="line-tag" ${style}>${esc(s.lineShort || s.line)}</span>${s.lineShort ? esc(s.line) : ""}
      ${s.direction ? `<br>toward <strong>${esc(s.direction)}</strong>` : ""}
      <br>${esc(s.from)} → <strong>${esc(s.to)}</strong>
      <span class="small">${s.stops != null ? ` · ${s.stops} stop${s.stops === 1 ? "" : "s"}` : ""} · ${s.minutes} min${s.everyMinutes ? ` · every ~${s.everyMinutes} min` : ""}</span>
    </span></li>`;
  }).join("");
  return `<p class="route-summary">${head}</p><ul class="legs">${legs}</ul>`;
}

/** Renders the small "## heading / 1. step / - bullet" format the guide uses. */
function renderGuideText(text) {
  let html = "", list = null;
  const close = () => { if (list) { html += `</${list}>`; list = null; } };
  const inline = (s) => esc(s).replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  for (const raw of String(text).split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    let m;
    if ((m = line.match(/^#{1,4}\s+(.*)/))) { close(); html += `<h3>${inline(m[1])}</h3>`; }
    else if ((m = line.match(/^\d+[.)]\s+(.*)/))) { if (list !== "ol") { close(); html += "<ol>"; list = "ol"; } html += `<li>${inline(m[1])}</li>`; }
    else if ((m = line.match(/^[-*•]\s+(.*)/))) { if (list !== "ul") { close(); html += "<ul>"; list = "ul"; } html += `<li>${inline(m[1])}</li>`; }
    else { close(); html += `<p>${inline(line)}</p>`; }
  }
  close();
  return html;
}

/* ---------- wire up ---------- */
els.changeStart.addEventListener("click", openPicker);
els.saveStart.addEventListener("click", saveStart);
els.useLocation.addEventListener("click", useMyLocation);
els.categories.addEventListener("click", (e) => {
  const btn = e.target.closest("[data-cat]");
  if (!btn || btn.dataset.cat === state.category) return;
  state.category = btn.dataset.cat;
  store.set("category", state.category);
  renderCategories();
  loadActivities();
});
els.openNow.addEventListener("change", () => {
  state.openOnly = els.openNow.checked;
  store.set("openOnly", state.openOnly);
  renderList();
});
els.list.addEventListener("click", (e) => {
  const btn = e.target.closest("[data-guide]");
  if (btn) showGuide(btn);
});

(function init() {
  store.prune();
  state.start = store.get("start");
  state.category = CATEGORIES.some(([id]) => id === store.get("category")) ? store.get("category") : "all";
  state.openOnly = store.get("openOnly") === true;
  els.openNow.checked = state.openOnly;
  renderCategories();
  showStart();
  if (state.start) loadActivities();
  else { els.status.textContent = "Set a starting point to see activities."; openPicker(); }

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  }
})();
