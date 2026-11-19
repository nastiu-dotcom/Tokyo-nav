// Tokyo Kids Explorer
//  * Trip plan: days built in advance (start/hotel + places in order).
//  * Adventure: today's route, grown stop by stop as you go.
//  * Prepare, Map and Tax-refund tabs.
//  * Family sharing: kids get a link, suggest places; the parent approves them.
// Hebrew (RTL, default) or English. No API keys here: Google / Claude / Redis
// calls go through /api/* on Vercel.
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
import { applyLang, fwd, getLang, L, setLang, t, tn } from "./js/i18n.js";
import { dayColor, dayStyle } from "./js/theme.js";
import {
  createFamily, family, familyData, isKid, isParentShared, joinFamily, joinFromHash, kidLink, leaveFamily,
  markPushed, parentLink, pushPlanSoon, refreshFamily, removeSuggestion, reviewSuggestion, startFamilyPolling,
  suggestPlace,
} from "./js/family.js";

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
const KID_MODES = ["trip", "map"];

const $ = (sel) => document.querySelector(sel);
const els = {
  modes: document.querySelectorAll("[data-mode]"), daysBar: $("#days-bar"),
  planTitle: $("#plan-title"), dateWrap: $("#date-wrap"), date: $("#day-date"),
  planSection: $("#plan"), browseSection: $("#browse"), prep: $("#prep"), prepList: $("#prep-list"),
  prepProgress: $("#prep-progress"), prepReset: $("#prep-reset"), tax: $("#tax"), taxRoot: $("#tax-root"),
  mapview: $("#mapview"), mapRoot: $("#mapview-root"), familyCard: $("#family"), tipsCard: $("#tips-card"),
  timeline: $("#timeline"), dayIntro: $("#day-intro"), tips: $("#tips-list"), addPlace: $("#add-place"), planActions: $("#plan-actions"),
  browseTitle: $("#browse-title"), browseNear: $("#browse-near"), categories: $("#categories"),
  openNow: $("#open-now"), status: $("#status"), list: $("#list"), langBtn: $("#lang-btn"), toast: $("#toast"),
};

const state = {
  mode: "trip",
  trip: { days: [] },
  day: 0,                       // selected day index
  adventure: { start: null, stops: [] },
  browse: { category: "all", openOnly: false, places: [], center: null },
};

/* ---------- small helpers ---------- */
let toastTimer;
function toast(msg) {
  els.toast.textContent = msg;
  els.toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { els.toast.hidden = true; }, 3500);
}
const kidMode = () => isKid();
const readOnly = () => kidMode() && state.mode === "trip";

/* ---------- persistence ---------- */
const newDay = (start = null, date = "") => ({ id: uid(), date, start, stops: [] });
function save() {
  if (!kidMode()) {
    store.set("trip", state.trip);
    store.set("adventure", state.adventure);
    pushPlanSoon(state.trip, () => toast(t("Couldn't sync with the family – will try again")));
  }
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
    return n === 0 ? t("✈️ Arrival") : t("Day {n}", { n });
  }
  return t("Day {n}", { n: i + 1 });
}
const curDayName = () => dayName(state.trip.days[state.day], state.day);

/** Adds details (tips, translations…) from the trip data to saved/shared stops. */
function enrichStop(st) {
  if (tripStop(st.id)) return { ...st, ...toAppStop(tripStop(st.id), st.time) };
  if (planStop(st.id)) return { ...st, ...planStop(st.id) };
  return st;
}
const hydrate = (plan) => ({
  days: (plan?.days || []).map((d) => ({ ...d, id: d.id || uid(), stops: (d.stops || []).map(enrichStop) })),
});

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
    els.prepList.innerHTML = `<p class="hint">${t("Loading the checklist…")}</p>`;
    try { await loadTrip2027(); } catch (err) { els.prepList.innerHTML = `<p class="warn">${esc(err.message)}</p>`; return; }
  }
  const c = checks();
  const secs = prepSections();
  const all = secs.flatMap((x) => x.items);
  const done = all.filter((it) => c[it.id]).length;
  els.prepProgress.textContent = t("{done} of {all} done", { done, all: all.length }) + (done === all.length ? t(" – you're ready! 🎉") : "");
  els.prepList.innerHTML = secs.map((sec) => {
    const n = sec.items.filter((it) => c[it.id]).length;
    return `<details class="prep-sec" ${n < sec.items.length ? "open" : ""}>
      <summary><span>${sec.icon} ${esc(L(sec, "title"))}</span><span class="prep-count">${n}/${sec.items.length}</span></summary>
      <ul class="checklist">${sec.items.map((it) => checkItem(it.id, L(it, "text"))).join("")}</ul>
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
    const label = `${dayName(d, i)}${d.date ? ` · ${fmtDate(d.date)}` : ""}${d.date === today ? ` · ${t("Today")}` : ""}`;
    return `<button class="chip day-chip" style="${dayStyle(dayColor(d, i))}" type="button" data-day="${i}" aria-pressed="${i === state.day}">${esc(label)}</button>`;
  }).join("") + (readOnly() ? "" : `<button class="chip add" type="button" data-day="new">${t("＋ Add day")}</button>`);
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
  const ro = readOnly();
  const color = trip ? dayColor(route, state.day) : { bg: "#E3F1EC", ink: "#1F6B57" };
  els.planSection.setAttribute("style", dayStyle(color));
  els.planTitle.textContent = trip
    ? `${curDayName()}${route.date ? ` · ${fmtDate(route.date)}` : ""}`
    : t("Today's adventure");
  els.dateWrap.hidden = !trip || ro;
  if (trip) els.date.value = route.date || "";

  renderDayIntro(route, trip);
  const pts = points(route);
  let html = "";
  if (!route.start) {
    html += ro ? `<li class="empty-note">${t("The plan for this day isn't ready yet.")}</li>` : `<li class="point start empty">
      <span class="dot">${trip ? "🏨" : "📍"}</span>
      <div class="body">
        <p class="pname">${trip ? t("Where does this day start? (hotel, station…)") : t("Where are you starting?")}</p>
        <div class="row">
          ${trip ? "" : `<button class="btn btn-primary" type="button" data-act="here">${t("📍 Use my location")}</button>`}
          <button class="btn btn-secondary" type="button" data-act="start">${trip ? t("Choose start") : t("Pick on map / search")}</button>
        </div>
      </div></li>`;
  } else {
    html += pointHtml(route.start, -1, trip);
    route.stops.forEach((stop, i) => {
      html += legHtml(i);
      html += pointHtml(stop, i, trip);
    });
    if (!route.stops.length) {
      html += `<li class="empty-note">${ro ? t("No stops yet for this day.") : t("Add your first place from the list below 👇 or with “Add any place”.")}</li>`;
    }
  }
  els.timeline.innerHTML = html;
  els.addPlace.hidden = !route.start || ro;

  els.planActions.innerHTML = ro ? "" : trip
    ? `<button class="btn btn-secondary" type="button" data-act="share">${t("🔗 Share trip")}</button>
       <button class="btn btn-secondary" type="button" data-act="delete-day">${t("🗑️ Delete day")}</button>
       ${isParentShared() ? "" : `<button class="btn btn-primary full" type="button" data-act="family-create">${t("👨‍👩‍👧 Share with the kids")}</button>`}`
    : `<button class="btn btn-secondary" type="button" data-act="to-trip" ${route.stops.length ? "" : "disabled"}>${t("🗓️ Save to trip plan")}</button>
       <button class="btn btn-secondary" type="button" data-act="new-adventure">${t("🔁 New adventure")}</button>`;

  loadLegs(pts);
}

const weekdayOf = (iso) => (iso ? new Date(`${iso}T12:00:00+09:00`).getUTCDay() : null);

function pointHtml(p, i, trip) {
  const isStart = i === -1;
  const route = active();
  const ro = readOnly();
  const meta = [];
  const type = L(p, "type");
  if (type) meta.push(esc(type));
  if (p.rating) meta.push(`★ ${p.rating.toFixed(1)}`);
  if (!isStart && Array.isArray(p.hours)) {
    const line = hoursForDate(p.hours, trip ? route.date : null);
    if (line) meta.push(`🕘 ${esc(line)}`);
  }
  let badge = "";
  const wd = trip ? weekdayOf(route.date) : tokyoNow().day;
  if (!isStart && Array.isArray(p.closed) && wd != null && p.closed.includes(wd)) {
    badge = `<span class="badge closed">${t("⚠️ Closed that day")}</span>`;
  } else if (!isStart && isToday()) {
    const open = isOpenNow(p.periods);
    badge = open === true ? `<span class="badge open">${t("Open now")}</span>` : open === false ? `<span class="badge closed">${t("Closed now")}</span>` : "";
  }
  const controls = ro ? "" : isStart
    ? `<button class="mini" type="button" data-act="start" aria-label="${t("Change start")}">✏️</button>`
    : `<button class="mini" type="button" data-act="up" data-i="${i}" aria-label="${t("Move earlier")}" ${i === 0 ? "disabled" : ""}>↑</button>
       <button class="mini" type="button" data-act="down" data-i="${i}" aria-label="${t("Move later")}" ${i === route.stops.length - 1 ? "disabled" : ""}>↓</button>
       <button class="mini" type="button" data-act="remove" data-i="${i}" aria-label="${t("Remove")}">✕</button>`;
  const chips = [];
  if (p.time) chips.push(`<span class="chip-sm time">🕗 ${esc(p.time)}</span>`);
  const stay = L(p, "stay");
  if (stay) chips.push(`<span class="chip-sm">⏳ ${esc(stay)}</span>`);
  if (p.optional) chips.push(`<span class="chip-sm opt">${t("Optional")}</span>`);
  if (p.food) chips.push(`<span class="chip-sm food">${t("🍽️ Food")}</span>`);
  if (p.by) chips.push(`<span class="chip-sm kid">${t("💖 {name}'s idea", { name: `<bdi>${esc(p.by)}</bdi>` })}</span>`);
  const cost = L(p, "cost");
  return `<li class="point${isStart ? " start" : ""}">
    <span class="dot">${isStart ? (p.id === "pin-narita" ? "✈️" : trip ? "🏨" : "📍") : i + 1}</span>
    <div class="body">
      ${chips.length ? `<div class="chips-sm">${chips.join("")}</div>` : ""}
      <p class="pname">${p.emoji ? `${p.emoji} ` : ""}${esc(p.name)} ${badge}</p>
      ${cost ? `<p class="cost">💴 ${esc(cost)}</p>` : ""}
      ${meta.length ? `<p class="small">${meta.join(" · ")}</p>` : p.address ? `<p class="small">${esc(p.address)}</p>` : ""}
      ${isStart ? "" : stopMore(p)}
    </div>
    ${controls ? `<div class="controls">${controls}</div>` : ""}
  </li>`;
}

/** Expandable info + links for a stop (Google Maps, tickets, official site). */
function stopMore(p) {
  const links = [`<a class="btn btn-secondary" href="${esc(mapsLink(p))}" target="_blank" rel="noopener">${t("📍 Google Maps")}</a>`];
  if (p.tickets && /^https?:\/\//.test(p.tickets.url)) {
    links.push(`<a class="btn btn-primary" href="${esc(p.tickets.url)}" target="_blank" rel="noopener">🎟️ ${esc(L(p.tickets, "label") || t("Tickets"))}</a>`);
  }
  if (/^https?:\/\//.test(p.website || "")) {
    links.push(`<a class="btn btn-secondary" href="${esc(p.website)}" target="_blank" rel="noopener">${t("🌐 Official site")}</a>`);
  }
  const tip = L(p, "tip"), closedNote = L(p, "closedNote"), wAlt = L(p, "weatherAlt"), verify = L(p, "verify");
  const tNote = p.tickets ? L(p.tickets, "note") : "";
  return `<details class="stop-more">
    <summary>${t("Info, tickets & map")}</summary>
    ${p.note ? `<p>💬 ${esc(p.note)}</p>` : ""}
    ${tip ? `<p>${esc(tip)}</p>` : ""}
    ${closedNote ? `<p class="warn">📅 ${esc(closedNote)}</p>` : ""}
    ${tNote ? `<p class="small">🎟️ ${esc(tNote)}</p>` : ""}
    ${wAlt ? `<p class="small">☔ ${esc(wAlt)}</p>` : ""}
    ${verify?.length ? `<p class="small verify">${t("⚠️ Check before you go:")} ${esc(verify.join(", "))}</p>` : ""}
    <div class="links">${links.join("")}</div>
    ${foodListHtml(p.id)}
  </details>`;
}

/** 3–4 food options near a ready-made April 2027 stop. */
function foodListHtml(id) {
  const list = foodFor(id);
  if (!list.length) return "";
  const kind = { snack: t("Quick snack"), meal: t("Cheap meal"), special: t("Special") };
  return `<div class="food-list"><p class="sub">${t("🍽️ Eat nearby")}</p><ul>${list.map((f) => `<li>
      <span class="fname">${f.emoji} ${esc(f.name)}</span>
      <span class="small">${esc(kind[f.kind] || f.kind)} · ${t("~{n} min walk", { n: f.walkMinutes })} · ${esc(L(f, "cost"))}${f.cashOnly ? ` · ${t("💴 cash only")}` : ""} · ${esc(L(f, "hours"))}</span>
      <span class="small">👪 ${esc(L(f, "kidFriendly"))}</span>
      <a class="mini-link" href="${esc(mapsLink(f))}" target="_blank" rel="noopener">${t("📍 Map")}</a>
    </li>`).join("")}</ul></div>`;
}

function renderDayIntro(route, trip) {
  if (!trip) { els.dayIntro.innerHTML = ""; return; }
  const ro = readOnly();
  const hasPlan = state.trip.days.some((d) => d.planKey);
  const info = planDay(route.planKey);
  let html = "";
  const arr = isArrivalKey(route.planKey) ? arrivalInfo() : null;
  if (arr) {
    html += `<div class="intro">
      <p class="intro-area">${esc(L(arr, "area"))}</p>
      <h3>${esc(L(arr, "title"))}</h3>
      <p>${esc(L(arr, "summary"))}</p>
      <p class="small">⏱ ${esc(L(arr, "duration"))}</p>
      <h4>${t("🛬 At Narita Airport, step by step")}</h4>
      <ol class="steps">${arr.airportSteps.map((st) => `<li><strong>${esc(L(st, "title"))}</strong>${esc(L(st, "detail"))}</li>`).join("")}</ol>
      <h4>${t("🚆 Getting to the hotel")}</h4>
      ${arr.routes.map((rt) => `<details class="route-opt" ${rt.recommended ? "open" : ""}>
        <summary>${rt.recommended ? "⭐ " : ""}${esc(L(rt, "name"))}</summary>
        <p class="small">${esc(L(rt, "time"))} · ${esc(L(rt, "cost"))}</p>
        <p>${esc(L(rt, "why"))}</p>
        <ol>${L(rt, "steps").map((x) => `<li>${esc(x)}</li>`).join("")}</ol>
      </details>`).join("")}
      <h4>${t("✅ Arrival checklist")}</h4>
      <ul class="checklist">${L(arr, "checklist").map((x, k) => checkItem(`arrival-${k}`, x)).join("")}</ul>
      <p>🌙 ${esc(L(arr, "evening"))}</p>
      <p class="budget">💴 ${esc(L(arr, "budget"))}</p>
      <p class="small verify">${t("⚠️ Check before you go:")} ${esc(L(arr, "verify").join(", "))}</p>
    </div>`;
  }
  const apr = tripDay(route.planKey);
  if (apr) {
    const wd = weekdayOf(route.date);
    const closedStops = route.stops.filter((st) => Array.isArray(st.closed) && wd != null && st.closed.includes(wd));
    const b = apr.budgetYen;
    const y = (n) => `¥${n.toLocaleString()}`;
    html += `<div class="intro">
      <p class="intro-area">${esc(L(apr, "area"))}</p>
      <h3>${esc(L(apr, "title"))}</h3>
      <p>${esc(L(apr, "summary"))}</p>
      <p class="budget">💴 ${t("≈ {total} for three (adult {a} · age 12 {b} · age 10 {c}) – attractions, budget food, IC transport", { total: y(b.total), a: y(b.adult), b: y(b.age12), c: y(b.age10) })}</p>
      ${closedStops.length ? `<p class="warn">${t("⚠️ Closed on this date:")} ${closedStops.map((x) => esc(x.name)).join(", ")}</p>` : ""}
      <ul class="before">${L(apr, "before").map((x) => `<li>✅ ${esc(x)}</li>`).join("")}</ul>
      ${ro ? "" : `<div class="row tight">
        <button class="btn btn-secondary" type="button" data-act="trip-route" data-kind="five">${t("Short day (5 stops)")}</button>
        <button class="btn btn-secondary" type="button" data-act="trip-route" data-kind="seven">${t("Full day (7 stops)")}</button>
      </div>
      ${state.trip.days.some((d) => isArrivalKey(d.planKey)) ? "" : `<button class="btn btn-secondary full" type="button" data-act="add-arrival">${t("✈️ Add the arrival day (Narita → hotel guide)")}</button>`}
      <p class="small">${t("After each stop, “Next stop” below only shows places within 45 minutes. Times and prices are researched estimates – ⚠️ marks things to check.")}</p>`}
    </div>`;
  }
  if (info) {
    const wd = weekdayOf(route.date);
    const clashes = route.stops.filter((s) => Array.isArray(s.closed) && wd != null && s.closed.includes(wd));
    html += `<div class="intro">
      <p class="intro-area">${esc(L(info, "area"))}</p>
      <h3>${esc(L(info, "title"))}</h3>
      <p>${esc(L(info, "summary"))}</p>
      <p class="budget">💴 ${esc(L(info, "budget"))}</p>
      ${clashes.length ? `<p class="warn">${t("⚠️ Closed on this date:")} ${clashes.map((s) => esc(s.name)).join(", ")} – ${t("swap with another day (change the date) or skip it.")}</p>` : ""}
      ${route.date || ro ? "" : `<p class="small">${t("Tip: set the date above to see opening days and hours for that day.")}</p>`}
      <ul class="before">${L(info, "before").map((b) => `<li>✅ ${esc(b)}</li>`).join("")}</ul>
    </div>`;
  }
  if (!ro && !state.trip.days.some((d) => isTripKey(d.planKey))) {
    html += `<div class="promo">
      <p>${t("<strong>April 1–5, 2027:</strong> your 5-day family trip from Rainbow Palace Yoyogi – Shinjuku sakura, Skytree, Tokyo Dome, Odaiba and Ikebukuro, with a “next stop within 45 minutes” guide and food after every stop.")}</p>
      <button class="btn btn-primary full" type="button" data-act="load-trip2027">${t("📥 Load the April 2027 5-day trip")}</button>
    </div>`;
  }
  if (!ro && !hasPlan) {
    html += `<div class="promo">
      <p>${t("<strong>New:</strong> a ready-made 3-day family plan – temples, dinosaurs, sushi trains, Pokémon, teamLab and the bay – with times, costs, tickets and food stops.")}</p>
      <button class="btn btn-primary full" type="button" data-act="load-plan">${t("📥 Use the ready-made 3-day plan")}</button>
    </div>`;
  }
  els.dayIntro.innerHTML = html;
}

function legHtml(i) {
  return `<li class="leg" data-leg="${i}">
    <p class="leg-summary">${t("Finding the way…")}</p>
    <div class="row tight">
      <a class="btn btn-secondary nav" href="#" target="_blank" rel="noopener">${t("🧭 Navigate")}</a>
      <button class="btn btn-secondary" type="button" data-act="leg-details" data-i="${i}" aria-expanded="false">${t("Details")}</button>
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
      li.querySelector(".leg-summary").textContent = t("Couldn't get the route ({e}). Tap Navigate.", { e: err.message });
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
  btn.textContent = open ? t("Hide details") : t("Details");
  if (open) fillLegBody(i, body);
}

/** Leg summary from the April 2027 dataset (no API call), or null. */
function tripLeg(from, to) {
  const e = edgeBetween(from.id, to.id);
  if (e) return edgeSummary(e);
  if (from.id === "pin-narita" && to.id === "pin-hotel") return t("🚆 ≈ 1 h 45 min door to door · Narita Express → Odakyu Line (steps above)");
  if (from.id === "pin-hotel" && tripStop(to.id)) return t("🏨 ~{n} min from the hotel (estimate)", { n: tripStop(to.id).hotelMinutes });
  return null;
}

async function fillLegBody(i, body) {
  const pts = points(active());
  const from = pts[i], to = pts[i + 1];
  if (!legData.has(i)) {
    body.innerHTML = `<p class="small">${t("Loading the live route…")}</p>`;
    try {
      legData.set(i, await loadLeg(from, to));
    } catch (err) {
      body.innerHTML = `<p class="small">${t("Couldn't get the live route ({e}). Tap Navigate.", { e: esc(err.message) })}</p>`;
      return;
    }
  }
  const data = legData.get(i);
  const ai = cachedAiGuide(from, to);
  body.innerHTML = renderRoute(data.route) + (ai
    ? `<div class="ai-guide"><p class="small">${t("✨ AI family guide (saved – no extra cost)")}</p>${renderGuideText(ai.guide)}</div>`
    : renderGuideText(freeGuide(data.route, to.name)) +
      (data.aiAvailable && !kidMode() ? `<button class="btn btn-secondary full ai-btn" type="button" data-act="ai" data-i="${i}">${t("✨ AI family guide · paid, {cost}", { cost: AI_COST_NOTE() })}</button>` : ""));
}

async function aiGuide(btn) {
  const i = Number(btn.dataset.i);
  const pts = points(active());
  btn.disabled = true;
  btn.textContent = t("Writing your guide… (about 10 seconds)");
  try {
    const res = await loadAiGuide(pts[i], pts[i + 1], pts[i + 1].name);
    if (!res) { btn.disabled = false; btn.textContent = t("✨ AI family guide · paid, {cost}", { cost: AI_COST_NOTE() }); return; }
    fillLegBody(i, btn.closest(".leg-body"));
  } catch (err) {
    btn.disabled = false;
    btn.textContent = t("✨ Try again · paid, {cost}", { cost: AI_COST_NOTE() });
    alert(t("Sorry: {e}", { e: err.message }));
  }
}

/* ---------- plan editing ---------- */
function setStart(p) {
  active().start = p;
  if (state.mode === "trip") {
    const empty = state.trip.days.filter((d) => !d.start);
    if (empty.length && confirm(t("Use “{name}” as the start for the other {n} days too?", { name: p.name, n: empty.length }))) {
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
  if (!navigator.geolocation) return alert(t("Location is not available on this device."));
  navigator.geolocation.getCurrentPosition(
    (pos) => setStart({ lat: pos.coords.latitude, lng: pos.coords.longitude, name: t("Where we started"), id: "pin-start" }),
    () => alert(t("Could not get your location. Use “Pick on map / search” instead.")),
    { enableHighAccuracy: true, timeout: 10000 },
  );
}

async function shareLink(url, title) {
  if (navigator.share) {
    try { await navigator.share({ title, url }); return; } catch (e) { if (e.name === "AbortError") return; }
  }
  try { await navigator.clipboard.writeText(url); toast(t("Link copied!")); } catch { prompt(t("Copy this link:"), url); }
}

async function onPlanAction(btn) {
  const route = active();
  const i = Number(btn.dataset.i);
  const act = btn.dataset.act;
  if (readOnly() && !["leg-details", "ai"].includes(act)) return;
  switch (act) {
    case "start":
      return openPicker({
        title: state.mode === "trip" ? t("Where does this day start?") : t("Where are you starting?"),
        initial: route.start, saveText: t("Start here"), onSave: setStart,
      });
    case "here": return useMyLocationAsStart();
    case "load-trip2027": {
      const hasStops = state.trip.days.some((d) => d.stops.length);
      if (hasStops && !confirm(t("Replace your current trip plan with the April 1–5, 2027 five-day trip?"))) return;
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
      if (route.stops.length && !confirm(t("Replace today's stops with the suggested {n}-stop route?", { n: kind === "five" ? 5 : 7 }))) return;
      route.stops = routeStops(route.planKey, kind);
      break;
    }
    case "load-plan": {
      const hasStops = state.trip.days.some((d) => d.stops.length);
      if (hasStops && !confirm(t("Replace your current trip plan with the ready-made 3-day plan?"))) return;
      const first = state.trip.days[0];
      state.trip.days = buildPlanDays(first?.start, first?.date);
      state.day = 0;
      save();
      render();
      if (!state.trip.days[0].start) {
        alert(t("Plan loaded! Now set your hotel as the start of each day (tap “Choose start”). New days copy it automatically."));
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
      if (how === "copied") toast(t("Link copied! Send it to the other phone and open it there."));
      return;
    }
    case "family-create": return familyCreate();
    case "delete-day":
      if (!confirm(t("Delete {day} and its places?", { day: curDayName() }))) return;
      state.trip.days.splice(state.day, 1);
      if (!state.trip.days.length) state.trip.days.push(newDay());
      state.day = Math.min(state.day, state.trip.days.length - 1);
      break;
    case "new-adventure":
      if (route.stops.length && !confirm(t("Start a new adventure? Today's route will be cleared."))) return;
      state.adventure = { start: null, stops: [] };
      break;
    case "to-trip": {
      const d = newDay({ ...route.start }, tokyoNow().date);
      d.stops = route.stops.map((s) => ({ ...s }));
      state.trip.days.push(d);
      state.day = state.trip.days.length - 1;
      save();
      toast(t("Saved as {day} in your trip plan.", { day: curDayName() }));
      return setMode("trip");
    }
    default: return;
  }
  save();
  render();
}

/* ---------- family sharing ---------- */
async function familyCreate() {
  if (!confirm(t("Share this trip with the kids? They get a link to see the plan and the map, and can suggest places for you to approve."))) return;
  try {
    await createFamily(state.trip);
    renderFamily();
    renderPlan();
    await shareLink(kidLink(), t("Our Tokyo trip – suggest places!"));
  } catch (err) {
    alert(t("Sorry: {e}", { e: err.message }));
  }
}

const statusLabel = (it) => (it.status === "approved"
  ? t("✅ Approved – {day}", { day: dayNameById(it.day) })
  : it.status === "declined" ? t("✖ Not this time") : t("⏳ Waiting for approval"));

function dayNameById(id) {
  const i = state.trip.days.findIndex((d) => d.id === id);
  return i >= 0 ? dayName(state.trip.days[i], i) : t("the plan");
}

function suggestionHtml(it, parent) {
  const dayOptions = state.trip.days.map((d, i) => `<option value="${esc(d.id)}" ${i === state.day ? "selected" : ""}>${esc(dayName(d, i))}${d.date ? ` · ${esc(fmtDate(d.date))}` : ""}</option>`).join("");
  return `<li class="sugg ${esc(it.status)}" data-sid="${esc(it.id)}">
    <p class="pname">${esc(it.emoji || "💖")} <bdi>${esc(it.name)}</bdi></p>
    <p class="small">${t("💖 {name}'s idea", { name: `<bdi>${esc(it.by)}</bdi>` })}${it.note ? ` · “<bdi>${esc(it.note)}</bdi>”` : ""}</p>
    <p class="small">${statusLabel(it)}</p>
    <div class="row tight">
      ${parent && it.status === "pending" ? `<select data-sday aria-label="${t("Day")}">${dayOptions}</select>
        <button class="btn btn-primary" type="button" data-fam="approve">${t("✅ Add to day")}</button>
        <button class="btn btn-secondary" type="button" data-fam="decline">${t("✖ No")}</button>` : ""}
      <a class="btn btn-secondary" href="${esc(mapsLink({ name: it.name, lat: it.lat, lng: it.lng, id: it.placeId || "pin-x" }))}" target="_blank" rel="noopener">${t("📍 Map")}</a>
      ${(parent || it.status === "pending") ? `<button class="btn btn-secondary" type="button" data-fam="remove" aria-label="${t("Remove")}">🗑️</button>` : ""}
    </div>
  </li>`;
}

function renderFamily() {
  const f = family();
  const show = f && state.mode === "trip";
  els.familyCard.hidden = !show;
  updateBadge();
  if (!show) return;
  const data = familyData();
  const wish = data.wishlist || [];
  if (f.role === "parent") {
    const pending = wish.filter((w) => w.status === "pending");
    const done = wish.filter((w) => w.status !== "pending");
    els.familyCard.innerHTML = `
      <h2>${t("👨‍👩‍👧 Family")}</h2>
      <p class="small">${t("The kids see this plan on their phones and can suggest places. Changes sync automatically.")}</p>
      <div class="row tight">
        <button class="btn btn-primary" type="button" data-fam="send">${t("📤 Send the link to the kids")}</button>
        <button class="btn btn-secondary" type="button" data-fam="refresh">${t("🔄 Check now")}</button>
      </div>
      <h3>${pending.length ? t("💖 New suggestions ({n})", { n: pending.length }) : t("💖 No new suggestions")}</h3>
      <ul class="sugg-list">${pending.map((it) => suggestionHtml(it, true)).join("")}</ul>
      ${done.length ? `<details><summary>${t("Earlier suggestions ({n})", { n: done.length })}</summary><ul class="sugg-list">${done.map((it) => suggestionHtml(it, true)).join("")}</ul></details>` : ""}
      <details class="fam-more"><summary>${t("⚙️ Family settings")}</summary>
        <p class="small">${t("Your parent link lets another adult manage the family. Keep it private.")}</p>
        <div class="row tight">
          <button class="btn btn-secondary" type="button" data-fam="parent-link">${t("🔑 Copy my parent link")}</button>
          <button class="btn btn-secondary" type="button" data-fam="leave">${t("Stop sharing on this phone")}</button>
        </div>
      </details>`;
  } else {
    const mine = wish.filter((w) => w.by === f.name);
    const others = wish.filter((w) => w.by !== f.name);
    els.familyCard.innerHTML = `
      <h2>${t("Hi {name}! 💖", { name: `<bdi>${esc(f.name || "")}</bdi>` })}</h2>
      <p>${t("Find places you'd love to visit and suggest them. A parent will add the best ones to the plan.")}</p>
      <div class="kid-actions">
        <button class="btn btn-primary" type="button" data-fam="suggest-search">${t("🔎 Find a place")}</button>
        <button class="btn btn-primary" type="button" data-fam="suggest-here">${t("📍 I'm here – suggest this spot")}</button>
        <button class="btn btn-secondary" type="button" data-fam="suggest-map">${t("🗺️ Long-press on the map")}</button>
      </div>
      <h3>${t("My suggestions")}</h3>
      <ul class="sugg-list">${mine.map((it) => suggestionHtml(it, false)).join("") || `<li class="hint">${t("Nothing yet – find a cool place!")}</li>`}</ul>
      ${others.length ? `<details><summary>${t("Family suggestions ({n})", { n: others.length })}</summary><ul class="sugg-list">${others.map((it) => suggestionHtml(it, false)).join("")}</ul></details>` : ""}
      <div class="row tight">
        <button class="btn btn-secondary" type="button" data-fam="refresh">${t("🔄 Check now")}</button>
        <button class="btn btn-secondary" type="button" data-fam="leave">${t("Leave the family plan")}</button>
      </div>`;
  }
}

function updateBadge() {
  const f = family();
  const btn = document.querySelector("[data-mode='trip']");
  const n = f?.role === "parent" ? (familyData().wishlist || []).filter((w) => w.status === "pending").length : 0;
  btn.dataset.badge = n ? String(n) : "";
}

async function kidSuggest(p) {
  const note = prompt(t("Why do you want to go there? (optional)"), "") ?? "";
  try {
    await suggestPlace({ name: p.name, lat: p.lat, lng: p.lng, placeId: p.id && !String(p.id).startsWith("pin-") ? p.id : "", address: p.address || "", note, emoji: "💖" });
    toast(t("Sent! 💖 A parent will see it."));
    renderFamily();
  } catch (err) {
    alert(t("Sorry: {e}", { e: err.message }));
  }
}

function kidSuggestHere() {
  if (!navigator.geolocation) return alert(t("Location is not available on this device."));
  navigator.geolocation.getCurrentPosition((pos) => {
    const name = prompt(t("What is this place called?"), "");
    if (!name) return;
    kidSuggest({ name, lat: pos.coords.latitude, lng: pos.coords.longitude, id: "pin-here" });
  }, () => alert(t("Could not get your location.")), { enableHighAccuracy: true, timeout: 10000 });
}

async function onFamilyAction(btn) {
  const act = btn.dataset.fam;
  const li = btn.closest("[data-sid]");
  const sid = li?.dataset.sid;
  const item = sid ? (familyData().wishlist || []).find((w) => w.id === sid) : null;
  try {
    switch (act) {
      case "send": return shareLink(kidLink(), t("Our Tokyo trip – suggest places!"));
      case "parent-link": return shareLink(parentLink(), t("Tokyo trip – parent link"));
      case "refresh": await refreshFamily(); return onFamilyChange();
      case "leave":
        if (!confirm(kidMode() ? t("Leave the family plan on this phone?") : t("Stop sharing on this phone? The kids' link keeps working until it expires."))) return;
        leaveFamily();
        if (kidMode()) return;
        state.trip = store.get("trip") || { days: [] };
        return render();
      case "approve": {
        if (!item) return;
        const dayId = li.querySelector("[data-sday]").value;
        const d = state.trip.days.find((x) => x.id === dayId) || active();
        d.stops.push({
          id: `kid-${item.id}`, name: item.name, lat: item.lat, lng: item.lng, emoji: item.emoji || "💖", by: item.by,
          note: item.note, address: item.address, maps: item.address ? `${item.name} ${item.address}` : item.name,
        });
        save();
        await reviewSuggestion(item.id, "approved", d.id);
        toast(t("Added to {day} ✅", { day: dayNameById(d.id) }));
        return render();
      }
      case "decline": await reviewSuggestion(item.id, "declined"); return renderFamily();
      case "remove":
        if (!confirm(t("Remove this suggestion?"))) return;
        await removeSuggestion(item.id);
        return renderFamily();
      case "suggest-search":
        return openPicker({ title: t("Suggest a place"), initial: anchor(), saveText: t("Suggest"), onSave: kidSuggest });
      case "suggest-here": return kidSuggestHere();
      case "suggest-map": return setMode("map");
      default: return undefined;
    }
  } catch (err) {
    alert(t("Sorry: {e}", { e: err.message }));
  }
}

/** Something changed on the server (or we refreshed). */
function onFamilyChange() {
  if (kidMode()) {
    state.trip = hydrate(familyData().plan);
    state.day = Math.min(state.day, Math.max(0, state.trip.days.length - 1));
  }
  render();
}

/* ---------- browse activities ---------- */
function renderCategories() {
  const trip = tripDayActive();
  const cats = trip ? TRIP_CATS : CATEGORIES;
  const current = trip ? state.browse.tripCat || "all" : state.browse.category;
  els.categories.innerHTML = cats.map(([id, label]) =>
    `<button class="chip" type="button" data-cat="${id}" aria-pressed="${id === current}">${t(label)}</button>`).join("");
}

async function loadActivities(center) {
  const b = state.browse;
  b.center = center;
  const near = `${r(center.lat, 2)},${r(center.lng, 2)}`;
  const cacheKey = `cache:act:${b.category}:${near}`;
  let data = store.getFresh(cacheKey);
  if (!data) {
    els.status.textContent = t("Finding fun places…");
    els.list.innerHTML = "";
    try {
      data = await getJSON(`/api/activities?category=${b.category}&near=${near}`);
      store.setFresh(cacheKey, data);
    } catch (err) {
      els.status.textContent = t("Sorry: {e}", { e: err.message });
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
  els.browseTitle.textContent = t("Next stop for {day} (≤ {n} min)", { day: curDayName(), n: maxLeg() });
  els.browseNear.innerHTML = fromId
    ? t("Only places within {n} minutes door to door from <strong>{name}</strong>", { n: maxLeg(), name: esc(last.name) })
    : t("From your hotel – choose the first stop");
  els.openNow.closest("label").hidden = true;
  const cat = state.browse.tripCat || "all";
  const added = new Set(route.stops.map((x) => x.id));
  const wd = weekdayOf(route.date);
  const arrivalDay = isArrivalKey(route.planKey);
  if (arrivalDay) {
    els.browseTitle.textContent = t("This evening near the hotel (only if you have energy)");
    els.browseNear.textContent = t("Day 1 places within 30 minutes of the hotel – most families just eat and sleep");
  }
  const items = (arrivalDay ? reachable("apr-d1", null).filter((x) => x.minutes <= 30) : reachable(route.planKey, fromId))
    .filter((x) => cat === "all" || x.stop.categories.includes(cat))
    .sort((a, b) => Number(added.has(a.stop.id)) - Number(added.has(b.stop.id)) || a.minutes - b.minutes); // new places first
  els.status.textContent = items.length ? tn(items.length, "1 place, closest first", "{n} places, closest first") : t("Nothing in this category within 45 minutes – try another.");
  els.list.innerHTML = items.map(({ stop: s, minutes, line, mode }) => {
    const isAdded = added.has(s.id);
    const closed = Array.isArray(s.closed) && wd != null && s.closed.includes(wd);
    const how = mode === "mixed" ? t("from the hotel") : mode === "walk" ? t("on foot") : esc(line);
    const verify = L(s, "verify");
    return `
<details class="activity">
  <summary>
    <span class="name">${s.emoji} ${esc(s.name)}</span>
    <span class="dist">${t("{n} min", { n: minutes })}</span>
    <span class="meta">${esc(String(L(s, "cost")).split("·")[0].trim())}${closed ? `<span class="badge closed">${t("Closed that day")}</span>` : ""}${isAdded ? `<span class="badge added">${t("✓ In plan")}</span>` : ""}</span>
  </summary>
  <div class="details">
    <p class="small">🚆 ${t("{n} min", { n: minutes })} ${how}</p>
    <dl>
      <dt>${t("Type")}</dt><dd>${esc(L(s, "type"))}</dd>
      <dt>${t("Hours")}</dt><dd>${esc(L(s, "hours"))}${L(s, "closedNote") ? `<br><span class="small">${esc(L(s, "closedNote"))}</span>` : ""}</dd>
      <dt>${t("Cost")}</dt><dd>${esc(L(s, "cost"))}</dd>
      <dt>${t("Stay")}</dt><dd>${esc(L(s, "stay"))} · ${t("best:")} ${esc(L(s, "bestTime"))}</dd>
      <dt>${t("Station")}</dt><dd>${esc(s.station)}</dd>
      ${s.booking !== "none" ? `<dt>${t("Booking")}</dt><dd>${t(s.booking)}</dd>` : ""}
    </dl>
    <p>${esc(L(s, "tip"))}</p>
    ${verify?.length ? `<p class="small verify">${t("⚠️ Check before you go:")} ${esc(verify.join(", "))}</p>` : ""}
    <div class="actions">
      <button class="btn btn-primary wide" type="button" data-trip-add="${esc(s.id)}" ${isAdded ? "disabled" : ""}>${isAdded ? t("✓ Already in the plan") : t("➕ Go here next")}</button>
      <a class="btn btn-secondary" href="${esc(mapsLink(s))}" target="_blank" rel="noopener">${t("📍 Google Maps")}</a>
      ${/^https?:\/\//.test(s.website || "") ? `<a class="btn btn-secondary" href="${esc(s.website)}" target="_blank" rel="noopener">${t("🌐 Official site")}</a>` : ""}
    </div>
    ${foodListHtml(s.id)}
  </div>
</details>`;
  }).join("");
}

function renderBrowse() {
  els.browseSection.hidden = readOnly() || ["prep", "tax", "map"].includes(state.mode);
  if (els.browseSection.hidden) return;
  renderCategories();
  if (tripDayActive()) return renderTripBrowse();
  els.openNow.closest("label").hidden = false;
  const b = state.browse;
  const here = anchor();
  const trip = state.mode === "trip";
  els.browseTitle.textContent = trip ? t("Add places to {day}", { day: curDayName() }) : t("What's next?");
  if (!here) {
    els.browseNear.textContent = "";
    els.status.textContent = t("Set a starting point above to see things to do nearby.");
    els.list.innerHTML = "";
    return;
  }
  // Re-sorting by the newest stop is free; fetching a new list is a Google call,
  // so only offer it when the route has moved more than ~1.5 km.
  const moved = !b.center || distanceKm(b.center, here) > 1.5;
  els.browseNear.innerHTML = t("Nearest to <strong>{name}</strong>", { name: esc(here.name) }) +
    (moved && b.center ? ` <button class="btn btn-secondary small-btn" type="button" data-act="refresh">${t("🔄 Find places near here")}</button>` : "");
  if (!b.center) { loadActivities(here); return; }

  const added = new Set(active().stops.map((s) => s.id));
  let items = b.places.map((p) => ({ ...p, km: distanceKm(here, p), open: p.temporarilyClosed ? false : isOpenNow(p.periods) }))
    .sort((a, c) => a.km - c.km);
  if (b.openOnly) items = items.filter((p) => p.open === true);
  els.status.textContent = items.length
    ? tn(items.length, "1 place, nearest first", "{n} places, nearest first")
    : b.openOnly ? t("Nothing open right now in this category. Try another one!") : t("No places found.");

  const todayIdx = (tokyoNow().day + 6) % 7;
  els.list.innerHTML = items.map((p) => {
    const badge = p.temporarilyClosed ? `<span class="badge closed">${t("Temporarily closed")}</span>`
      : p.open === true ? `<span class="badge open">${t("Open now")}</span>`
      : p.open === false ? `<span class="badge closed">${t("Closed now")}</span>` : "";
    const rating = p.rating ? `★ ${p.rating.toFixed(1)} <span class="small">(${t("{n} reviews", { n: p.reviews.toLocaleString() })})</span>` : t("No rating yet");
    const hours = p.hours
      ? `<ul class="hours" dir="ltr">${p.hours.map((h, i) => `<li class="${i === todayIdx ? "today" : ""}">${esc(h)}</li>`).join("")}</ul>`
      : t("Not listed");
    const hasSite = /^https?:\/\//.test(p.website || "");
    const isAdded = added.has(p.id);
    return `
<details class="activity">
  <summary>
    <span class="name">${esc(p.name)}</span>
    <span class="dist">${fmtDist(p.km)}</span>
    <span class="meta">${rating}${badge}${isAdded ? `<span class="badge added">${t("✓ In plan")}</span>` : ""}</span>
  </summary>
  <div class="details">
    <dl>
      ${p.type ? `<dt>${t("Type")}</dt><dd>${esc(p.type)}</dd>` : ""}
      <dt>${t("Address")}</dt><dd>${esc(p.address)}</dd>
      <dt>${t("Rating")}</dt><dd>${rating}</dd>
      <dt>${t("Price")}</dt><dd>${esc(t(PRICE[p.price] || "Not listed"))}</dd>
      <dt>${t("Distance")}</dt><dd>${t("{d} from {name}", { d: fmtDist(p.km), name: esc(here.name) })}</dd>
      <dt>${t("Hours")}</dt><dd>${hours}</dd>
    </dl>
    <div class="actions">
      <button class="btn btn-primary wide" type="button" data-add="${esc(p.id)}" ${isAdded ? "disabled" : ""}>
        ${isAdded ? t("✓ Already in the plan") : trip ? t("➕ Add to {day}", { day: curDayName() }) : t("➕ Go here next")}</button>
      <a class="btn btn-secondary${hasSite ? "" : " wide"}" href="${esc(navUrl(here, p))}" target="_blank" rel="noopener">${t("🧭 Navigate")}</a>
      ${hasSite ? `<a class="btn btn-secondary" href="${esc(p.website)}" target="_blank" rel="noopener">${t("🌐 Official site")}</a>` : ""}
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
  if (kidMode() && !KID_MODES.includes(state.mode)) state.mode = "trip";
  els.modes.forEach((b) => {
    b.hidden = kidMode() && !KID_MODES.includes(b.dataset.mode);
    b.setAttribute("aria-pressed", String(b.dataset.mode === state.mode));
  });
  document.body.classList.toggle("kid-mode", kidMode());
  const prep = state.mode === "prep";
  const tax = state.mode === "tax";
  const mapMode = state.mode === "map";
  els.prep.hidden = !prep;
  els.tax.hidden = !tax;
  els.mapview.hidden = !mapMode;
  els.planSection.hidden = prep || tax || mapMode;
  els.tipsCard.hidden = kidMode();
  renderFamily();
  if (!mapMode) stopMapTracking(); // GPS only while the map is open
  if (mapMode) {
    els.daysBar.hidden = true;
    els.browseSection.hidden = true;
    renderMapView(els.mapRoot, {
      days: () => state.trip.days, dayName,
      wishlist: () => (family() ? familyData().wishlist || [] : []),
      isKid: kidMode,
      onSuggestAt: (lat, lng) => {
        const name = prompt(t("What is this place called?"), "");
        if (name) kidSuggest({ name, lat, lng, id: "pin-map" }).then(() => render());
      },
    });
    return;
  }
  if (prep) { els.daysBar.hidden = true; els.browseSection.hidden = true; renderPrep(); return; }
  if (tax) { els.daysBar.hidden = true; els.browseSection.hidden = true; renderTax(els.taxRoot); return; }
  if (!state.trip.days.length) state.trip.days.push(newDay());
  state.day = Math.max(0, Math.min(state.day, state.trip.days.length - 1));
  renderDays();
  renderPlan();
  renderBrowse();
}

/* ---------- events ---------- */
els.modes.forEach((b) => b.addEventListener("click", () => setMode(b.dataset.mode)));
els.langBtn.addEventListener("click", () => {
  setLang(getLang() === "he" ? "en" : "he");
  location.reload();
});
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
  if (!confirm(t("Untick every item on the preparation list?"))) return;
  const c = checks();
  for (const sec of prepSections()) for (const it of sec.items) delete c[it.id];
  store.set("checks", c);
  renderPrep();
});
els.familyCard.addEventListener("click", (e) => { const b = e.target.closest("[data-fam]"); if (b) onFamilyAction(b); });
els.dayIntro.addEventListener("click", (e) => { const b = e.target.closest("[data-act]"); if (b) onPlanAction(b); });
els.timeline.addEventListener("click", (e) => { const b = e.target.closest("[data-act]"); if (b) onPlanAction(b); });
els.planActions.addEventListener("click", (e) => { const b = e.target.closest("[data-act]"); if (b) onPlanAction(b); });
els.addPlace.addEventListener("click", () => openPicker({
  title: state.mode === "trip" ? t("Add a place to {day}", { day: curDayName() }) : t("Where to next?"),
  initial: anchor(), saveText: t("Add"), onSave: addStop,
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
  applyLang();
  els.langBtn.textContent = getLang() === "he" ? "EN" : "עב";
  els.langBtn.setAttribute("aria-label", getLang() === "he" ? "Switch to English" : "החלפה לעברית");
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

  // A kid (or second parent) opening a family link: #join=<id>.<key>
  const join = joinFromHash();
  if (join) {
    history.replaceState(null, "", location.pathname);
    const name = prompt(t("Welcome to the family trip! 💖 What's your name?"), family()?.name || "");
    if (name !== null) {
      try {
        const d = await joinFamily(join.id, join.key, name.trim().slice(0, 30));
        state.mode = "trip";
        state.day = 0;
        toast(d.role === "kid" ? t("You're in! Suggest places you'd love to visit 💖") : t("Parent access on this phone ✅"));
        if (d.role === "parent") { state.trip = hydrate(d.plan); }
      } catch (err) {
        alert(t("This family link doesn't work: {e}", { e: err.message }));
      }
    }
  }

  // A shared trip link (#trip=...)
  try {
    const shared = await readTripFromHash();
    if (shared?.days.length) {
      const stops = shared.days.reduce((n, d) => n + d.stops.length, 0);
      if (confirm(t("Open the shared trip plan ({days} days, {stops} places)?\n\nIt replaces the trip plan on this phone.", { days: shared.days.length, stops }))) {
        state.trip = shared;
        state.mode = "trip";
        state.day = 0;
      }
    }
  } catch {
    alert(t("This trip link looks broken – ask for a new one."));
  }
  if (location.hash.startsWith("#trip=")) history.replaceState(null, "", location.pathname);

  // Kids see the family plan (read-only).
  if (kidMode()) state.trip = hydrate(familyData().plan);

  // April 2027 trip: load its data (45-min engine, food, translations) and refresh stop details.
  if (state.trip.days.some((d) => isTripKey(d.planKey))) {
    try { await loadTrip2027(); } catch { /* offline: keep saved stops */ }
  }
  state.trip = { ...state.trip, days: state.trip.days.map((d) => ({ ...d, stops: d.stops.map(enrichStop) })) };
  if (isParentShared()) markPushed(state.trip);

  els.tips.innerHTML = TIPS.map((tip) => `<details class="tip"><summary>${tip.icon} ${esc(L(tip, "title"))}</summary>
    <p>${esc(L(tip, "text"))}</p>${tip.url ? `<a class="btn btn-secondary" href="${esc(tip.url)}" target="_blank" rel="noopener">${t("🌐 More info")}</a>` : ""}</details>`).join("");

  // In trip mode, jump to today's day if there is one.
  const todayIdx = state.trip.days.findIndex((d) => d.date === tokyoNow().date);
  if (todayIdx >= 0 && state.mode === "trip") state.day = todayIdx;

  renderCategories();
  save();
  render();
  startFamilyPolling(onFamilyChange);
  if (family()) refreshFamily().then((changed) => { if (changed) onFamilyChange(); }).catch(() => {});

  if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => {});
})();
