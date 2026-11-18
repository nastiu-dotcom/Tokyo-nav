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
import { initTax, renderTax } from "./js/tax.js";
import { initMapView, renderMapView, stopMapTracking } from "./js/mapview.js";
import { buildPlanDays, mapsLink, planDay, planStop, TIPS } from "./js/plan.js";
import {
  buildTripDays, edgeBetween, edgeSummary, foodFor, isTripKey, loadTrip2027, maxLeg, reachable, routeStops,
  toAppStop, TRIP_CATS, tripDay, tripReady, tripStop, arrivalInfo, prepSections, isArrivalKey,
} from "./js/trip2027.js";

const CATEGORIES = [
  ["all", "⭐ Top picks"],
  ["food", "🍜 Food"],
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
  planSection: $("#plan"), browseSection: $("#browse"), prep: $("#prep"), prepList: $("#prep-list"),
  prepProgress: $("#prep-progress"), prepReset: $("#prep-reset"), tax: $("#tax"), taxRoot: $("#tax-root"), mapview: $("#mapview"), mapRoot: $("#mapview-root"),
  timeline: $("#timeline"), dayIntro: $("#day-intro"), tips: $("#tips-list"), addPlace: $("#add-place"), planActions: $("#plan-actions"),
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

/** "✈️ Arrival", "Day 1"… (April 2027 days keep their own numbers). */
function dayName(d, i) {
  if (d && isTripKey(d.planKey)) {
    const n = Number(d.planKey.slice(5));
    return n === 0 ? "✈️ Arrival" : `Day ${n}`;
  }
  return `Day ${i + 1}`;
}
const curDayName = () => dayName(state.trip.days[state.day], state.day);

/* ---------- checklists (arrival + preparation), saved on this phone ---------- */
const checks = () => store.get("checks") || {};
function setCheck(id, on) {
  const c = checks();
  if (on) c[id] = true; else delete c[id];
  store.set("checks", c);
}
const checkItem = (id, text) => `<li><label><input type="checkbox" data-check="${esc(id)}" ${checks()[id] ? "checked" : ""}><span>${esc(text)}</span></label></li>`;

async function renderPrep() {
  if (!tripReady()) {
    els.prepList.innerHTML = `<p class="hint">Loading the checklist…</p>`;
    try { await loadTrip2027(); } catch (err) { els.prepList.innerHTML = `<p class="warn">${esc(err.message)}</p>`; return; }
  }
  const c = checks();
  const secs = prepSections();
  const all = secs.flatMap((x) => x.items);
  const done = all.filter((it) => c[it.id]).length;
  els.prepProgress.textContent = `${done} of ${all.length} done${done === all.length ? " – you're ready! 🎉" : ""}`;
  els.prepList.innerHTML = secs.map((sec) => {
    const n = sec.items.filter((it) => c[it.id]).length;
    return `<details class="prep-sec" ${n < sec.items.length ? "open" : ""}>
      <summary><span>${sec.icon} ${esc(sec.title)}</span><span class="prep-count">${n}/${sec.items.length}</span></summary>
      <ul class="checklist">${sec.items.map((it) => checkItem(it.id, it.text)).join("")}</ul>
    </details>`;
  }).join("");
}

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
    const label = `${dayName(d, i)}${d.date ? ` · ${fmtDate(d.date)}` : ""}${d.date === today ? " · Today" : ""}`;
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
    ? `${curDayName()}${route.date ? ` · ${fmtDate(route.date)}` : ""}`
    : "Today's adventure";
  els.dateWrap.hidden = !trip;
  if (trip) els.date.value = route.date || "";

  renderDayIntro(route, trip);
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

const weekdayOf = (iso) => (iso ? new Date(`${iso}T12:00:00+09:00`).getUTCDay() : null);

function pointHtml(p, i, trip) {
  const isStart = i === -1;
  const route = active();
  const meta = [];
  if (p.type) meta.push(esc(p.type));
  if (p.rating) meta.push(`★ ${p.rating.toFixed(1)}`);
  if (!isStart && p.hours) {
    const line = hoursForDate(p.hours, trip ? route.date : null);
    if (line) meta.push(`🕘 ${esc(line)}`);
  }
  let badge = "";
  const wd = trip ? weekdayOf(route.date) : tokyoNow().day;
  if (!isStart && Array.isArray(p.closed) && wd != null && p.closed.includes(wd)) {
    badge = `<span class="badge closed">⚠️ Closed that day</span>`;
  } else if (!isStart && isToday()) {
    const open = isOpenNow(p.periods);
    badge = open === true ? `<span class="badge open">Open now</span>` : open === false ? `<span class="badge closed">Closed now</span>` : "";
  }
  const controls = isStart
    ? `<button class="mini" type="button" data-act="start" aria-label="Change start">✏️</button>`
    : `<button class="mini" type="button" data-act="up" data-i="${i}" aria-label="Move earlier" ${i === 0 ? "disabled" : ""}>↑</button>
       <button class="mini" type="button" data-act="down" data-i="${i}" aria-label="Move later" ${i === route.stops.length - 1 ? "disabled" : ""}>↓</button>
       <button class="mini" type="button" data-act="remove" data-i="${i}" aria-label="Remove">✕</button>`;
  const chips = [];
  if (p.time) chips.push(`<span class="chip-sm time">🕗 ${esc(p.time)}</span>`);
  if (p.stay) chips.push(`<span class="chip-sm">⏳ ${esc(p.stay)}</span>`);
  if (p.optional) chips.push(`<span class="chip-sm opt">Optional</span>`);
  if (p.food) chips.push(`<span class="chip-sm food">🍽️ Food</span>`);
  return `<li class="point${isStart ? " start" : ""}">
    <span class="dot">${isStart ? (trip ? "🏨" : "📍") : i + 1}</span>
    <div class="body">
      ${chips.length ? `<div class="chips-sm">${chips.join("")}</div>` : ""}
      <p class="pname">${p.emoji ? `${p.emoji} ` : ""}${esc(p.name)} ${badge}</p>
      ${p.cost ? `<p class="cost">💴 ${esc(p.cost)}</p>` : ""}
      ${meta.length ? `<p class="small">${meta.join(" · ")}</p>` : p.address ? `<p class="small">${esc(p.address)}</p>` : ""}
      ${isStart ? "" : stopMore(p)}
    </div>
    <div class="controls">${controls}</div>
  </li>`;
}

/** Expandable info + links for a stop (Google Maps, tickets, official site). */
function stopMore(p) {
  const links = [`<a class="btn btn-secondary" href="${esc(mapsLink(p))}" target="_blank" rel="noopener">📍 Google Maps</a>`];
  if (p.tickets && /^https?:\/\//.test(p.tickets.url)) {
    links.push(`<a class="btn btn-primary" href="${esc(p.tickets.url)}" target="_blank" rel="noopener">🎟️ ${esc(p.tickets.label || "Tickets")}</a>`);
  }
  if (/^https?:\/\//.test(p.website || "")) {
    links.push(`<a class="btn btn-secondary" href="${esc(p.website)}" target="_blank" rel="noopener">🌐 Official site</a>`);
  }
  return `<details class="stop-more">
    <summary>Info, tickets &amp; map</summary>
    ${p.tip ? `<p>${esc(p.tip)}</p>` : ""}
    ${p.closedNote ? `<p class="warn">📅 ${esc(p.closedNote)}</p>` : ""}
    ${p.tickets?.note ? `<p class="small">🎟️ ${esc(p.tickets.note)}</p>` : ""}
    ${p.weatherAlt ? `<p class="small">☔ ${esc(p.weatherAlt)}</p>` : ""}
    ${p.verify?.length ? `<p class="small verify">⚠️ Check before you go: ${esc(p.verify.join(", "))}</p>` : ""}
    <div class="links">${links.join("")}</div>
    ${foodListHtml(p.id)}
  </details>`;
}

/** 3–4 food options near a ready-made April 2027 stop. */
function foodListHtml(id) {
  const list = foodFor(id);
  if (!list.length) return "";
  const kind = { snack: "Quick snack", meal: "Cheap meal", special: "Special" };
  return `<div class="food-list"><p class="sub">🍽️ Eat nearby</p><ul>${list.map((f) => `<li>
      <span class="fname">${f.emoji} ${esc(f.name)}</span>
      <span class="small">${esc(kind[f.kind] || f.kind)} · ~${f.walkMinutes} min walk · ${esc(f.cost)}${f.cashOnly ? " · 💴 cash only" : ""} · ${esc(f.hours)}</span>
      <span class="small">👪 ${esc(f.kidFriendly)}</span>
      <a class="mini-link" href="${esc(mapsLink(f))}" target="_blank" rel="noopener">📍 Map</a>
    </li>`).join("")}</ul></div>`;
}

function renderDayIntro(route, trip) {
  if (!trip) { els.dayIntro.innerHTML = ""; return; }
  const hasPlan = state.trip.days.some((d) => d.planKey);
  const info = planDay(route.planKey);
  let html = "";
  const arr = isArrivalKey(route.planKey) ? arrivalInfo() : null;
  if (arr) {
    html += `<div class="intro">
      <p class="intro-area">${esc(arr.area)}</p>
      <h3>${esc(arr.title)}</h3>
      <p>${esc(arr.summary)}</p>
      <p class="small">⏱ ${esc(arr.duration)}</p>
      <h4>🛬 At Narita Airport, step by step</h4>
      <ol class="steps">${arr.airportSteps.map((st) => `<li><strong>${esc(st.title)}</strong>${esc(st.detail)}</li>`).join("")}</ol>
      <h4>🚆 Getting to the hotel</h4>
      ${arr.routes.map((rt) => `<details class="route-opt" ${rt.recommended ? "open" : ""}>
        <summary>${rt.recommended ? "⭐ " : ""}${esc(rt.name)}</summary>
        <p class="small">${esc(rt.time)} · ${esc(rt.cost)}</p>
        <p>${esc(rt.why)}</p>
        <ol>${rt.steps.map((x) => `<li>${esc(x)}</li>`).join("")}</ol>
      </details>`).join("")}
      <h4>✅ Arrival checklist</h4>
      <ul class="checklist">${arr.checklist.map((t, k) => checkItem(`arrival-${k}`, t)).join("")}</ul>
      <p>🌙 ${esc(arr.evening)}</p>
      <p class="budget">💴 ${esc(arr.budget)}</p>
      <p class="small verify">⚠️ Check before you go: ${esc(arr.verify.join(", "))}</p>
    </div>`;
  }
  const apr = tripDay(route.planKey);
  if (apr) {
    const wd = weekdayOf(route.date);
    const closedStops = route.stops.filter((st) => Array.isArray(st.closed) && wd != null && st.closed.includes(wd));
    const b = apr.budgetYen;
    html += `<div class="intro">
      <p class="intro-area">${esc(apr.area)}</p>
      <h3>${esc(apr.title)}</h3>
      <p>${esc(apr.summary)}</p>
      <p class="budget">💴 ≈ ¥${b.total.toLocaleString()} for three (adult ¥${b.adult.toLocaleString()} · age 12 ¥${b.age12.toLocaleString()} · age 10 ¥${b.age10.toLocaleString()}) – attractions, budget food, IC transport</p>
      ${closedStops.length ? `<p class="warn">⚠️ Closed on this date: ${closedStops.map((x) => esc(x.name)).join(", ")}</p>` : ""}
      <ul class="before">${apr.before.map((x) => `<li>✅ ${esc(x)}</li>`).join("")}</ul>
      <div class="row tight">
        <button class="btn btn-secondary" type="button" data-act="trip-route" data-kind="five">Short day (5 stops)</button>
        <button class="btn btn-secondary" type="button" data-act="trip-route" data-kind="seven">Full day (7 stops)</button>
      </div>
      ${state.trip.days.some((d) => isArrivalKey(d.planKey)) ? "" : `<button class="btn btn-secondary full" type="button" data-act="add-arrival">✈️ Add the arrival day (Narita → hotel guide)</button>`}
      <p class="small">After each stop, “Next stop” below only shows places within 45 minutes. Times and prices are researched estimates – ⚠️ marks things to check.</p>
    </div>`;
  }
  if (info) {
    const wd = weekdayOf(route.date);
    const clashes = route.stops.filter((s) => Array.isArray(s.closed) && wd != null && s.closed.includes(wd));
    html += `<div class="intro">
      <p class="intro-area">${esc(info.area)}</p>
      <h3>${esc(info.title)}</h3>
      <p>${esc(info.summary)}</p>
      <p class="budget">💴 ${esc(info.budget)}</p>
      ${clashes.length ? `<p class="warn">⚠️ On this date ${clashes.map((s) => esc(s.name)).join(" and ")} ${clashes.length > 1 ? "are" : "is"} closed – swap with another day (change the date) or skip ${clashes.length > 1 ? "them" : "it"}.</p>` : ""}
      ${route.date ? "" : `<p class="small">Tip: set the date above to see opening days and hours for that day.</p>`}
      <ul class="before">${info.before.map((b) => `<li>✅ ${esc(b)}</li>`).join("")}</ul>
    </div>`;
  }
  if (!state.trip.days.some((d) => isTripKey(d.planKey))) {
    html += `<div class="promo">
      <p><strong>April 1–5, 2027:</strong> your 5-day family trip from Rainbow Palace Yoyogi – Shinjuku sakura, Skytree, Tokyo Dome, Odaiba and Ikebukuro, with a “next stop within 45 minutes” guide and food after every stop.</p>
      <button class="btn btn-primary full" type="button" data-act="load-trip2027">📥 Load the April 2027 5-day trip</button>
    </div>`;
  }
  if (!hasPlan) {
    html += `<div class="promo">
      <p><strong>New:</strong> a ready-made 3-day family plan – temples, dinosaurs, sushi trains, Pokémon, teamLab and the bay – with times, costs, tickets and food stops.</p>
      <button class="btn btn-primary full" type="button" data-act="load-plan">📥 Use the ready-made 3-day plan</button>
    </div>`;
  }
  els.dayIntro.innerHTML = html;
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
    const known = tripLeg(from, to);
    if (known) { li.querySelector(".leg-summary").innerHTML = known; continue; }
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

/** Leg summary from the April 2027 dataset (no API call), or null. */
function tripLeg(from, to) {
  const e = edgeBetween(from.id, to.id);
  if (e) return edgeSummary(e);
  if (from.id === "pin-narita" && to.id === "pin-hotel") return "🚆 ≈ 1 h 45 min door to door · Narita Express → Odakyu Line (steps above)";
  if (from.id === "pin-hotel" && tripStop(to.id)) return `🏨 ~${tripStop(to.id).hotelMinutes} min from the hotel (estimate)`;
  return null;
}

async function fillLegBody(i, body) {
  const pts = points(active());
  const from = pts[i], to = pts[i + 1];
  if (!legData.has(i)) {
    body.innerHTML = `<p class="small">Loading the live route…</p>`;
    try {
      legData.set(i, await loadLeg(from, to));
    } catch (err) {
      body.innerHTML = `<p class="small">Couldn't get the live route (${esc(err.message)}). Tap Navigate.</p>`;
      return;
    }
  }
  const data = legData.get(i);
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
  if (state.mode === "trip") {
    const empty = state.trip.days.filter((d) => !d.start);
    if (empty.length && confirm(`Use “${p.name}” as the start for the other ${empty.length} day${empty.length === 1 ? "" : "s"} too?`)) {
      empty.forEach((d) => { d.start = { ...p }; });
    }
  }
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
    case "load-trip2027": {
      const hasStops = state.trip.days.some((d) => d.stops.length);
      if (hasStops && !confirm("Replace your current trip plan with the April 1–5, 2027 five-day trip?")) return;
      try { await loadTrip2027(); } catch (err) { return alert(err.message); }
      state.trip.days = buildTripDays("seven");
      state.day = 0;
      state.browse.tripCat = "all";
      save();
      render();
      return;
    }
    case "add-arrival": {
      try { await loadTrip2027(); } catch (err) { return alert(err.message); }
      state.trip.days.unshift(buildTripDays("seven")[0]);
      state.day = 0;
      break;
    }
    case "trip-route": {
      const kind = btn.dataset.kind;
      if (route.stops.length && !confirm(`Replace today's stops with the suggested ${kind === "five" ? "5" : "7"}-stop route?`)) return;
      route.stops = routeStops(route.planKey, kind);
      break;
    }
    case "load-plan": {
      const hasStops = state.trip.days.some((d) => d.stops.length);
      if (hasStops && !confirm("Replace your current trip plan with the ready-made 3-day plan?")) return;
      const first = state.trip.days[0];
      state.trip.days = buildPlanDays(first?.start, first?.date);
      state.day = 0;
      save();
      render();
      if (!state.trip.days[0].start) {
        alert("Plan loaded! Now set your hotel as the start of each day (tap “Choose start”). New days copy it automatically.");
      }
      return;
    }
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
      if (!confirm(`Delete ${curDayName()} and its places?`)) return;
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
      alert(`Saved as ${curDayName()} in your trip plan.`);
      return setMode("trip");
    }
    default: return;
  }
  save();
  render();
}

/* ---------- browse activities ---------- */
function renderCategories() {
  const trip = tripDayActive();
  const cats = trip ? TRIP_CATS : CATEGORIES;
  const current = trip ? state.browse.tripCat || "all" : state.browse.category;
  els.categories.innerHTML = cats.map(([id, label]) =>
    `<button class="chip" type="button" data-cat="${id}" aria-pressed="${id === current}">${label}</button>`).join("");
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

const tripDayActive = () => state.mode === "trip" && isTripKey(active()?.planKey) && tripReady();

function renderTripBrowse() {
  const route = active();
  const last = route.stops[route.stops.length - 1];
  const fromId = last && tripStop(last.id) ? last.id : null;
  els.browseTitle.textContent = `Next stop for ${curDayName()} (≤ ${maxLeg()} min)`;
  els.browseNear.innerHTML = fromId
    ? `Only places within ${maxLeg()} minutes door to door from <strong>${esc(last.name)}</strong>`
    : "From your hotel – choose the first stop";
  els.openNow.closest("label").hidden = true;
  const cat = state.browse.tripCat || "all";
  const added = new Set(route.stops.map((x) => x.id));
  const wd = weekdayOf(route.date);
  const arrivalDay = isArrivalKey(route.planKey);
  if (arrivalDay) {
    els.browseTitle.textContent = "This evening near the hotel (only if you have energy)";
    els.browseNear.textContent = "Day 1 places within 30 minutes of the hotel – most families just eat and sleep";
  }
  const items = (arrivalDay ? reachable("apr-d1", null).filter((x) => x.minutes <= 30) : reachable(route.planKey, fromId))
    .filter((x) => cat === "all" || x.stop.categories.includes(cat))
    .sort((a, b) => Number(added.has(a.stop.id)) - Number(added.has(b.stop.id)) || a.minutes - b.minutes); // new places first
  els.status.textContent = items.length ? `${items.length} place${items.length === 1 ? "" : "s"}, closest first` : "Nothing in this category within 45 minutes – try another.";
  els.list.innerHTML = items.map(({ stop: s, minutes, line, mode }) => {
    const isAdded = added.has(s.id);
    const closed = Array.isArray(s.closed) && wd != null && s.closed.includes(wd);
    const how = mode === "mixed" ? "from the hotel" : mode === "walk" ? "on foot" : esc(line);
    return `
<details class="activity">
  <summary>
    <span class="name">${s.emoji} ${esc(s.name)}</span>
    <span class="dist">${minutes} min</span>
    <span class="meta">${esc(s.cost.split("·")[0].trim())}${closed ? `<span class="badge closed">Closed that day</span>` : ""}${isAdded ? `<span class="badge added">✓ In plan</span>` : ""}</span>
  </summary>
  <div class="details">
    <p class="small">🚆 ${minutes} min ${how}</p>
    <dl>
      <dt>Type</dt><dd>${esc(s.type)}</dd>
      <dt>Hours</dt><dd>${esc(s.hours)}${s.closedNote ? `<br><span class="small">${esc(s.closedNote)}</span>` : ""}</dd>
      <dt>Cost</dt><dd>${esc(s.cost)}</dd>
      <dt>Stay</dt><dd>${esc(s.stay)} · best: ${esc(s.bestTime)}</dd>
      <dt>Station</dt><dd>${esc(s.station)}</dd>
      ${s.booking !== "none" ? `<dt>Booking</dt><dd>${esc(s.booking)}</dd>` : ""}
    </dl>
    <p>${esc(s.tip)}</p>
    ${s.verify?.length ? `<p class="small verify">⚠️ Check before you go: ${esc(s.verify.join(", "))}</p>` : ""}
    <div class="actions">
      <button class="btn btn-primary wide" type="button" data-trip-add="${esc(s.id)}" ${isAdded ? "disabled" : ""}>${isAdded ? "✓ Already in the plan" : "➕ Go here next"}</button>
      <a class="btn btn-secondary" href="${esc(mapsLink(s))}" target="_blank" rel="noopener">📍 Google Maps</a>
      ${/^https?:\/\//.test(s.website || "") ? `<a class="btn btn-secondary" href="${esc(s.website)}" target="_blank" rel="noopener">🌐 Official site</a>` : ""}
    </div>
    ${foodListHtml(s.id)}
  </div>
</details>`;
  }).join("");
}

function renderBrowse() {
  renderCategories();
  if (tripDayActive()) return renderTripBrowse();
  els.openNow.closest("label").hidden = false;
  const b = state.browse;
  const here = anchor();
  const trip = state.mode === "trip";
  els.browseTitle.textContent = trip ? `Add places to ${curDayName()}` : "What's next?";
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
        ${isAdded ? "✓ Already in the plan" : trip ? `➕ Add to ${curDayName()}` : "➕ Go here next"}</button>
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
  const prep = state.mode === "prep";
  const tax = state.mode === "tax";
  const mapMode = state.mode === "map";
  els.prep.hidden = !prep;
  els.tax.hidden = !tax;
  els.mapview.hidden = !mapMode;
  els.planSection.hidden = prep || tax || mapMode;
  els.browseSection.hidden = prep || tax || mapMode;
  if (!mapMode) stopMapTracking(); // GPS only while the map is open
  if (mapMode) {
    els.daysBar.hidden = true;
    renderMapView(els.mapRoot, { days: () => state.trip.days, dayName });
    return;
  }
  if (prep) { els.daysBar.hidden = true; renderPrep(); return; }
  if (tax) { els.daysBar.hidden = true; renderTax(els.taxRoot); return; }
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
  // Fill in the following days that have no date yet (Day 2 = next day, …).
  if (els.date.value) {
    const base = new Date(`${els.date.value}T12:00:00Z`);
    state.trip.days.slice(state.day + 1).forEach((d, k) => {
      if (d.date) return;
      const x = new Date(base);
      x.setUTCDate(x.getUTCDate() + k + 1);
      d.date = x.toISOString().slice(0, 10);
    });
  }
  save();
  render();
});
document.addEventListener("change", (e) => {
  const cb = e.target.closest("[data-check]");
  if (!cb) return;
  setCheck(cb.dataset.check, cb.checked);
  if (state.mode === "prep") renderPrep();
});
els.prepReset.addEventListener("click", () => {
  if (!confirm("Untick every item on the preparation list?")) return;
  const c = checks();
  for (const sec of prepSections()) for (const it of sec.items) delete c[it.id];
  store.set("checks", c);
  renderPrep();
});
els.dayIntro.addEventListener("click", (e) => { const b = e.target.closest("[data-act]"); if (b) onPlanAction(b); });
els.timeline.addEventListener("click", (e) => { const b = e.target.closest("[data-act]"); if (b) onPlanAction(b); });
els.planActions.addEventListener("click", (e) => { const b = e.target.closest("[data-act]"); if (b) onPlanAction(b); });
els.addPlace.addEventListener("click", () => openPicker({
  title: state.mode === "trip" ? `Add a place to ${curDayName()}` : "Where to next?",
  initial: anchor(), saveText: "Add", onSave: addStop,
}));
els.categories.addEventListener("click", (e) => {
  const btn = e.target.closest("[data-cat]");
  if (btn && tripDayActive()) {
    state.browse.tripCat = btn.dataset.cat;
    return renderBrowse();
  }
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
  const tripAdd = e.target.closest("[data-trip-add]");
  if (tripAdd) { const s = tripStop(tripAdd.dataset.tripAdd); if (s) addStop(toAppStop(s)); return; }
  const add = e.target.closest("[data-add]");
  if (add) addFromList(add.dataset.add);
});

/* ---------- start ---------- */
(async function init() {
  store.prune();
  state.trip = store.get("trip") || { days: [] };
  state.adventure = store.get("adventure") || { start: store.get("start") ? { ...store.get("start"), name: store.get("start").label } : null, stops: [] };
  state.day = store.get("day") || 0;
  state.mode = ["adventure", "prep", "tax", "map"].includes(store.get("mode")) ? store.get("mode") : "trip";
  initTax(els.taxRoot);
  initMapView(els.mapRoot);
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

  // April 2027 trip: load its data (45-min engine, food) and refresh stop details.
  if (state.trip.days.some((d) => isTripKey(d.planKey))) {
    try {
      await loadTrip2027();
      for (const d of state.trip.days) {
        d.stops = d.stops.map((st) => (tripStop(st.id) ? { ...st, ...toAppStop(tripStop(st.id), st.time) } : st));
      }
    } catch { /* offline: keep saved stops */ }
  }
  // Ready-made plan stops: always use the latest details (tips, prices, links).
  for (const d of state.trip.days) {
    d.stops = d.stops.map((st) => (planStop(st.id) ? { ...st, ...planStop(st.id) } : st));
  }
  els.tips.innerHTML = TIPS.map(([icon, title, text, url]) => `<details class="tip"><summary>${icon} ${esc(title)}</summary>
    <p>${esc(text)}</p>${url ? `<a class="btn btn-secondary" href="${esc(url)}" target="_blank" rel="noopener">🌐 More info</a>` : ""}</details>`).join("");

  // In trip mode, jump to today's day if there is one.
  const todayIdx = state.trip.days.findIndex((d) => d.date === tokyoNow().date);
  if (todayIdx >= 0 && state.mode === "trip") state.day = todayIdx;

  els.modes.forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.mode === state.mode)));
  renderCategories();
  save();
  render();

  if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => {});
})();
