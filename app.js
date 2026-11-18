// Tokyo Kids Explorer – two modes:
//  * Trip plan: days you build in advance (start/hotel + places in order).
//  * Adventure: today's route, grown stop by stop as you go.
// Both show how to get from each place to the next. No API keys here: every
// Google / Claude call goes through /api/* on Vercel.
import {
  distanceKm, esc, fmtDate, fmtDist, getJSON, hoursForDate, isOpenNow, navUrl, PRICE, r, store, tokyoNow, uid,
} from "./js/util.js";
import {
  AI_COST_NOTE, cachedAiGuide, freeGuide, legSummary, loadAiGuide, loadLeg, renderGuideText, renderRoute,
} from "./js/legs.js";
import { openPicker } from "./js/picker.js";
import { readTripFromHash, shareTrip } from "./js/share.js";

const CATEGORIES = [
  ["all", "⭐ Top picks"],
  ["museums", "🔬 Museums"],
  ["animals", "🐼 Zoos & aquariums"],
  ["parks", "🌳 Parks"],
  ["fun", "🎢 Fun & games"],
  ["anime", "🎮 Anime & toys"],
  ["views", "🗼 Views"],
];

const $ = (sel) => document.querySelector(sel);
const els = {
  modes: document.querySelectorAll("[data-mode]"), daysBar: $("#days-bar"),
  planTitle: $("#plan-title"), dateWrap: $("#date-wrap"), date: $("#day-date"),
  timeline: $("#timeline"), addPlace: $("#add-place"), planActions: $("#plan-actions"),
  browseTitle: $("#browse-title"), browseNear: $("#browse-near"), categories: $("#categories"),
  openNow: $("#open-now"), status: $("#status"), list: $("#list"),
};

const state = {
  mode: "trip",
  trip: { days: [] },
  day: 0,                       // selected day index
  adventure: { start: null, stops: [] },
  browse: { category: "all", openOnly: false, places: [], center: null },
};

/* ---------- persistence ---------- */
const newDay = (start = null, date = "") => ({ id: uid(), date, start, stops: [] });
function save() {
  store.set("trip", state.trip);
  store.set("adventure", state.adventure);
  store.set("mode", state.mode);
  store.set("day", state.day);
}

/** The route being shown: the selected trip day, or today's adventure. */
const active = () => (state.mode === "trip" ? state.trip.days[state.day] : state.adventure);
const points = (route) => (route.start ? [route.start, ...route.stops] : []);
const anchor = () => { const p = points(active()); return p[p.length - 1] || null; };
const isToday = () => state.mode === "adventure" || active().date === tokyoNow().date;

/* ---------- mode + days ---------- */
function setMode(mode) {
  state.mode = mode;
  els.modes.forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.mode === mode)));
  save();
  render();
}

function renderDays() {
  els.daysBar.hidden = state.mode !== "trip";
  if (state.mode !== "trip") return;
  const today = tokyoNow().date;
  els.daysBar.innerHTML = state.trip.days.map((d, i) => {
    const label = `Day ${i + 1}${d.date ? ` · ${fmtDate(d.date)}` : ""}${d.date === today ? " · Today" : ""}`;
    return `<button class="chip" type="button" data-day="${i}" aria-pressed="${i === state.day}">${esc(label)}</button>`;
  }).join("") + `<button class="chip add" type="button" data-day="new">＋ Add day</button>`;
}

function addDay() {
  const last = state.trip.days[state.trip.days.length - 1];
  let date = "";
  if (last?.date) {
    const d = new Date(`${last.date}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() + 1);
    date = d.toISOString().slice(0, 10);
  }
  state.trip.days.push(newDay(last?.start ? { ...last.start } : null, date)); // same hotel as the day before
  state.day = state.trip.days.length - 1;
  save();
  render();
}

/* ---------- plan (timeline) ---------- */
function renderPlan() {
  const route = active();
  const trip = state.mode === "trip";
  els.planTitle.textContent = trip
    ? `Day ${state.day + 1}${route.date ? ` · ${fmtDate(route.date)}` : ""}`
    : "Today's adventure";
  els.dateWrap.hidden = !trip;
  if (trip) els.date.value = route.date || "";

  const pts = points(route);
  let html = "";
  if (!route.start) {
    html += `<li class="point start empty">
      <span class="dot">${trip ? "🏨" : "📍"}</span>
      <div class="body">
        <p class="pname">${trip ? "Where does this day start? (hotel, station…)" : "Where are you starting?"}</p>
        <div class="row">
          ${trip ? "" : `<button class="btn btn-primary" type="button" data-act="here">📍 Use my location</button>`}
          <button class="btn btn-secondary" type="button" data-act="start">${trip ? "Choose start" : "Pick on map / search"}</button>
        </div>
      </div></li>`;
  } else {
    html += pointHtml(route.start, -1, trip);
    route.stops.forEach((stop, i) => {
      html += legHtml(i);
      html += pointHtml(stop, i, trip);
    });
    if (!route.stops.length) {
      html += `<li class="empty-note">Add your first place from the list below 👇 or with “Add any place”.</li>`;
    }
  }
  els.timeline.innerHTML = html;
  els.addPlace.hidden = !route.start;

  els.planActions.innerHTML = trip
    ? `<button class="btn btn-secondary" type="button" data-act="share">🔗 Share trip</button>
       <button class="btn btn-secondary" type="button" data-act="delete-day">🗑️ Delete day</button>`
    : `<button class="btn btn-secondary" type="button" data-act="to-trip" ${route.stops.length ? "" : "disabled"}>🗓️ Save to trip plan</button>
       <button class="btn btn-secondary" type="button" data-act="new-adventure">🔁 New adventure</button>`;

  loadLegs(pts);
}

function pointHtml(p, i, trip) {
  const isStart = i === -1;
  const route = active();
  let meta = [];
  if (p.type) meta.push(esc(p.type));
  if (p.rating) meta.push(`★ ${p.rating.toFixed(1)}`);
  if (!isStart && p.hours) {
    const line = hoursForDate(p.hours, trip ? route.date : null);
    if (line) meta.push(`🕘 ${esc(line)}`);
  }
  let badge = "";
  if (!isStart && isToday()) {
    const open = isOpenNow(p.periods);
    badge = open === true ? `<span class="badge open">Open now</span>` : open === false ? `<span class="badge closed">Closed now</span>` : "";
  }
  const site = /^https?:\/\//.test(p.website || "") ? `<a class="mini" href="${esc(p.website)}" target="_blank" rel="noopener" aria-label="Official site">🌐</a>` : "";
  const controls = isStart
    ? `<button class="mini" type="button" data-act="start" aria-label="Change start">✏️</button>`
    : `${site}
       <button class="mini" type="button" data-act="up" data-i="${i}" aria-label="Move earlier" ${i === 0 ? "disabled" : ""}>↑</button>
       <button class="mini" type="button" data-act="down" data-i="${i}" aria-label="Move later" ${i === route.stops.length - 1 ? "disabled" : ""}>↓</button>
       <button class="mini" type="button" data-act="remove" data-i="${i}" aria-label="Remove">✕</button>`;
  return `<li class="point${isStart ? " start" : ""}">
    <span class="dot">${isStart ? (trip ? "🏨" : "📍") : i + 1}</span>
    <div class="body">
      <p class="pname">${esc(p.name)} ${badge}</p>
      ${meta.length ? `<p class="small">${meta.join(" · ")}</p>` : p.address ? `<p class="small">${esc(p.address)}</p>` : ""}
    </div>
    <div class="controls">${controls}</div>
  </li>`;
}

function legHtml(i) {
  return `<li class="leg" data-leg="${i}">
    <p class="leg-summary">Finding the way…</p>
    <div class="row tight">
      <a class="btn btn-secondary nav" href="#" target="_blank" rel="noopener">🧭 Navigate</a>
      <button class="btn btn-secondary" type="button" data-act="leg-details" data-i="${i}" aria-expanded="false">Details</button>
    </div>
    <div class="leg-body" hidden></div>
  </li>`;
}

const legData = new Map(); // leg index → route response (for the current render)
let legRun = 0;

async function loadLegs(pts) {
  const run = ++legRun;
  legData.clear();
  for (let i = 1; i < pts.length; i++) {
    const from = pts[i - 1], to = pts[i];
    const li = els.timeline.querySelector(`[data-leg="${i - 1}"]`);
    if (!li) continue;
    li.querySelector(".nav").href = navUrl(from, to);
    try {
      const data = await loadLeg(from, to);
      if (run !== legRun) return;
      legData.set(i - 1, data);
      li.querySelector(".leg-summary").innerHTML = legSummary(data.route);
    } catch (err) {
      if (run !== legRun) return;
      li.querySelector(".leg-summary").textContent = `Couldn't get the route (${err.message}). Tap Navigate.`;
    }
  }
}

function toggleLegDetails(btn) {
  const i = Number(btn.dataset.i);
  const li = btn.closest(".leg");
  const body = li.querySelector(".leg-body");
  const open = body.hidden;
  body.hidden = !open;
  btn.setAttribute("aria-expanded", String(open));
  btn.textContent = open ? "Hide details" : "Details";
  if (open) fillLegBody(i, body);
}

function fillLegBody(i, body) {
  const data = legData.get(i);
  if (!data) { body.innerHTML = `<p class="small">Still loading…</p>`; return; }
  const pts = points(active());
  const from = pts[i], to = pts[i + 1];
  const ai = cachedAiGuide(from, to);
  body.innerHTML = renderRoute(data.route) + (ai
    ? `<div class="ai-guide"><p class="small">✨ AI family guide (saved – no extra cost)</p>${renderGuideText(ai.guide)}</div>`
    : renderGuideText(freeGuide(data.route, to.name)) +
      (data.aiAvailable ? `<button class="btn btn-secondary full ai-btn" type="button" data-act="ai" data-i="${i}">✨ AI family guide · paid, ${AI_COST_NOTE}</button>` : ""));
}

async function aiGuide(btn) {
  const i = Number(btn.dataset.i);
  const pts = points(active());
  btn.disabled = true;
  btn.textContent = "Writing your guide… (about 10 seconds)";
  try {
    const res = await loadAiGuide(pts[i], pts[i + 1], pts[i + 1].name);
    if (!res) { btn.disabled = false; btn.textContent = `✨ AI family guide · paid, ${AI_COST_NOTE}`; return; }
    fillLegBody(i, btn.closest(".leg-body"));
  } catch (err) {
    btn.disabled = false;
    btn.textContent = `✨ Try again · paid, ${AI_COST_NOTE}`;
    alert(`Sorry: ${err.message}`);
  }
}

/* ---------- plan editing ---------- */
function setStart(p) {
  active().start = p;
  save();
  render();
}

function addStop(p) {
  const route = active();
  if (route.stops.some((s) => s.id === p.id)) return;
  route.stops.push(p);
  save();
  renderPlan();
  renderBrowse();
  els.timeline.lastElementChild?.scrollIntoView({ behavior: "smooth", block: "center" });
}

function useMyLocationAsStart() {
  if (!navigator.geolocation) return alert("Location is not available on this device.");
  navigator.geolocation.getCurrentPosition(
    (pos) => setStart({ lat: pos.coords.latitude, lng: pos.coords.longitude, name: "Where we started", id: "pin-start" }),
    () => alert("Could not get your location. Use “Pick on map / search” instead."),
    { enableHighAccuracy: true, timeout: 10000 },
  );
}

async function onPlanAction(btn) {
  const route = active();
  const i = Number(btn.dataset.i);
  switch (btn.dataset.act) {
    case "start":
      return openPicker({
        title: state.mode === "trip" ? "Where does this day start?" : "Where are you starting?",
        initial: route.start, saveText: "Start here", onSave: setStart,
      });
    case "here": return useMyLocationAsStart();
    case "up": [route.stops[i - 1], route.stops[i]] = [route.stops[i], route.stops[i - 1]]; break;
    case "down": [route.stops[i + 1], route.stops[i]] = [route.stops[i], route.stops[i + 1]]; break;
    case "remove": route.stops.splice(i, 1); break;
    case "leg-details": return toggleLegDetails(btn);
    case "ai": return aiGuide(btn);
    case "share": {
      const how = await shareTrip(state.trip);
      if (how === "copied") alert("Link copied! Send it to the other phone and open it there.");
      return;
    }
    case "delete-day":
      if (!confirm(`Delete Day ${state.day + 1} and its places?`)) return;
      state.trip.days.splice(state.day, 1);
      if (!state.trip.days.length) state.trip.days.push(newDay());
      state.day = Math.min(state.day, state.trip.days.length - 1);
      break;
    case "new-adventure":
      if (route.stops.length && !confirm("Start a new adventure? Today's route will be cleared.")) return;
      state.adventure = { start: null, stops: [] };
      break;
    case "to-trip": {
      const d = newDay({ ...route.start }, tokyoNow().date);
      d.stops = route.stops.map((s) => ({ ...s }));
      state.trip.days.push(d);
      state.day = state.trip.days.length - 1;
      save();
      alert(`Saved as Day ${state.day + 1} in your trip plan.`);
      return setMode("trip");
    }
    default: return;
  }
  save();
  render();
}

/* ---------- browse activities ---------- */
function renderCategories() {
  els.categories.innerHTML = CATEGORIES.map(([id, label]) =>
    `<button class="chip" type="button" data-cat="${id}" aria-pressed="${id === state.browse.category}">${label}</button>`).join("");
}

async function loadActivities(center) {
  const b = state.browse;
  b.center = center;
  const near = `${r(center.lat, 2)},${r(center.lng, 2)}`;
  const cacheKey = `cache:act:${b.category}:${near}`;
  let data = store.getFresh(cacheKey);
  if (!data) {
    els.status.textContent = "Finding fun places…";
    els.list.innerHTML = "";
    try {
      data = await getJSON(`/api/activities?category=${b.category}&near=${near}`);
      store.setFresh(cacheKey, data);
    } catch (err) {
      els.status.textContent = `Sorry: ${err.message}`;
      return;
    }
  }
  if (data.category !== b.category) return; // switched meanwhile
  b.places = data.places;
  renderBrowse();
}

function renderBrowse() {
  const b = state.browse;
  const here = anchor();
  const trip = state.mode === "trip";
  els.browseTitle.textContent = trip ? `Add places to Day ${state.day + 1}` : "What's next?";
  if (!here) {
    els.browseNear.textContent = "";
    els.status.textContent = "Set a starting point above to see things to do nearby.";
    els.list.innerHTML = "";
    return;
  }
  // Re-sorting by the newest stop is free; fetching a new list is a Google call,
  // so only offer it when the route has moved more than ~1.5 km.
  const moved = !b.center || distanceKm(b.center, here) > 1.5;
  els.browseNear.innerHTML = `Nearest to <strong>${esc(here.name)}</strong>` +
    (moved && b.center ? ` <button class="btn btn-secondary small-btn" type="button" data-act="refresh">🔄 Find places near here</button>` : "");
  if (!b.center) { loadActivities(here); return; }

  const added = new Set(active().stops.map((s) => s.id));
  let items = b.places.map((p) => ({ ...p, km: distanceKm(here, p), open: p.temporarilyClosed ? false : isOpenNow(p.periods) }))
    .sort((a, c) => a.km - c.km);
  if (b.openOnly) items = items.filter((p) => p.open === true);
  els.status.textContent = items.length
    ? `${items.length} place${items.length === 1 ? "" : "s"}, nearest first`
    : b.openOnly ? "Nothing open right now in this category. Try another one!" : "No places found.";

  const todayIdx = (tokyoNow().day + 6) % 7;
  els.list.innerHTML = items.map((p) => {
    const badge = p.temporarilyClosed ? `<span class="badge closed">Temporarily closed</span>`
      : p.open === true ? `<span class="badge open">Open now</span>`
      : p.open === false ? `<span class="badge closed">Closed now</span>` : "";
    const rating = p.rating ? `★ ${p.rating.toFixed(1)} <span class="small">(${p.reviews.toLocaleString()} reviews)</span>` : "No rating yet";
    const hours = p.hours
      ? `<ul class="hours">${p.hours.map((h, i) => `<li class="${i === todayIdx ? "today" : ""}">${esc(h)}</li>`).join("")}</ul>`
      : "Not listed";
    const hasSite = /^https?:\/\//.test(p.website || "");
    const isAdded = added.has(p.id);
    return `
<details class="activity">
  <summary>
    <span class="name">${esc(p.name)}</span>
    <span class="dist">${fmtDist(p.km)}</span>
    <span class="meta">${rating}${badge}${isAdded ? `<span class="badge added">✓ In plan</span>` : ""}</span>
  </summary>
  <div class="details">
    <dl>
      ${p.type ? `<dt>Type</dt><dd>${esc(p.type)}</dd>` : ""}
      <dt>Address</dt><dd>${esc(p.address)}</dd>
      <dt>Rating</dt><dd>${rating}</dd>
      <dt>Price</dt><dd>${esc(PRICE[p.price] || "Not listed")}</dd>
      <dt>Distance</dt><dd>${fmtDist(p.km)} from ${esc(here.name)}</dd>
      <dt>Hours</dt><dd>${hours}</dd>
    </dl>
    <div class="actions">
      <button class="btn btn-primary wide" type="button" data-add="${esc(p.id)}" ${isAdded ? "disabled" : ""}>
        ${isAdded ? "✓ Already in the plan" : trip ? `➕ Add to Day ${state.day + 1}` : "➕ Go here next"}</button>
      <a class="btn btn-secondary${hasSite ? "" : " wide"}" href="${esc(navUrl(here, p))}" target="_blank" rel="noopener">🧭 Navigate</a>
      ${hasSite ? `<a class="btn btn-secondary" href="${esc(p.website)}" target="_blank" rel="noopener">🌐 Official site</a>` : ""}
    </div>
  </div>
</details>`;
  }).join("");
}

function addFromList(id) {
  const p = state.browse.places.find((x) => x.id === id);
  if (!p) return;
  const { id: pid, name, type, address, lat, lng, rating, reviews, price, website, hours, periods } = p;
  addStop({ id: pid, name, type, address, lat, lng, rating, reviews, price, website, hours, periods });
}

/* ---------- render all ---------- */
function render() {
  if (!state.trip.days.length) state.trip.days.push(newDay());
  state.day = Math.max(0, Math.min(state.day, state.trip.days.length - 1));
  renderDays();
  renderPlan();
  renderBrowse();
}

/* ---------- events ---------- */
els.modes.forEach((b) => b.addEventListener("click", () => setMode(b.dataset.mode)));
els.daysBar.addEventListener("click", (e) => {
  const b = e.target.closest("[data-day]");
  if (!b) return;
  if (b.dataset.day === "new") return addDay();
  state.day = Number(b.dataset.day);
  save();
  render();
});
els.date.addEventListener("change", () => {
  active().date = els.date.value;
  save();
  render();
});
els.timeline.addEventListener("click", (e) => { const b = e.target.closest("[data-act]"); if (b) onPlanAction(b); });
els.planActions.addEventListener("click", (e) => { const b = e.target.closest("[data-act]"); if (b) onPlanAction(b); });
els.addPlace.addEventListener("click", () => openPicker({
  title: state.mode === "trip" ? `Add a place to Day ${state.day + 1}` : "Where to next?",
  initial: anchor(), saveText: "Add", onSave: addStop,
}));
els.categories.addEventListener("click", (e) => {
  const btn = e.target.closest("[data-cat]");
  if (!btn || btn.dataset.cat === state.browse.category) return;
  state.browse.category = btn.dataset.cat;
  store.set("category", state.browse.category);
  renderCategories();
  const here = anchor();
  if (here) loadActivities(here);
});
els.openNow.addEventListener("change", () => {
  state.browse.openOnly = els.openNow.checked;
  store.set("openOnly", state.browse.openOnly);
  renderBrowse();
});
els.browseNear.addEventListener("click", (e) => {
  if (e.target.closest("[data-act='refresh']")) { const here = anchor(); if (here) loadActivities(here); }
});
els.list.addEventListener("click", (e) => {
  const add = e.target.closest("[data-add]");
  if (add) addFromList(add.dataset.add);
});

/* ---------- start ---------- */
(async function init() {
  store.prune();
  state.trip = store.get("trip") || { days: [] };
  state.adventure = store.get("adventure") || { start: store.get("start") ? { ...store.get("start"), name: store.get("start").label } : null, stops: [] };
  state.day = store.get("day") || 0;
  state.mode = store.get("mode") === "adventure" ? "adventure" : "trip";
  const cat = store.get("category");
  state.browse.category = CATEGORIES.some(([id]) => id === cat) ? cat : "all";
  state.browse.openOnly = store.get("openOnly") === true;
  els.openNow.checked = state.browse.openOnly;

  // A shared trip link (#trip=...)
  try {
    const shared = await readTripFromHash();
    if (shared?.days.length) {
      const stops = shared.days.reduce((n, d) => n + d.stops.length, 0);
      if (confirm(`Open the shared trip plan (${shared.days.length} day${shared.days.length === 1 ? "" : "s"}, ${stops} places)?\n\nIt replaces the trip plan on this phone.`)) {
        state.trip = shared;
        state.mode = "trip";
        state.day = 0;
      }
    }
  } catch {
    alert("This trip link looks broken – ask for a new one.");
  }
  if (location.hash.startsWith("#trip=")) history.replaceState(null, "", location.pathname);

  // In trip mode, jump to today's day if there is one.
  const todayIdx = state.trip.days.findIndex((d) => d.date === tokyoNow().date);
  if (todayIdx >= 0 && state.mode === "trip") state.day = todayIdx;

  els.modes.forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.mode === state.mode)));
  renderCategories();
  save();
  render();

  if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => {});
})();
