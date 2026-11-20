// 🧳 The whole trip: a card at the top of the Trip tab (countdown / day N of M,
// country bar, what's next, things to check) and a full-screen timeline with
// flights, stays and notes. Grown-ups edit; kids look (no prices).
import { fwd, locale, t, tn } from "./i18n.js";
import { esc, fmtDate, getJSON, postJSON, store } from "./util.js";
import {
  COUNTRY, CURRENCY, doubleBooked, fixedCosts, holidayNotes, itemSegment, missingNights, nextItem, nights, planClashes,
  planShiftTarget, sortItems, startSuggestions, status, tripRange,
} from "./timeline-core.js";

let doc = store.get("timeline");
let ctx = null;
let form = null; // null = list · {kind, item} = editing · {kind: "trip"}

const today = () => new Date().toLocaleDateString("en-CA"); // YYYY-MM-DD, phone's own day
const num = (n) => new Intl.NumberFormat(locale(), { maximumFractionDigits: 0 }).format(n);
const money = (n, c = "ILS") => `${CURRENCY[c] || ""}${num(n)}`;
const countryName = (c) => t(`${COUNTRY[c]?.flag || "🌍"} ${COUNTRY[c]?.name || "Other"}`);
const segName = (s) => s.name || countryName(s.country);
const segStyle = (s) => `--day-bg:${COUNTRY[s.country]?.bg || COUNTRY.XX.bg};--day-ink:${COUNTRY[s.country]?.ink || COUNTRY.XX.ink}`;
const range = (a, b) => `${fmtDate(a)} – ${fmtDate(b)}`;
const canEdit = () => ctx?.canEdit();

export const journey = () => doc;

export async function initJourney(c) {
  ctx = c;
  c.card.addEventListener("click", onClick);
  c.sheet.addEventListener("click", onClick);
  c.sheet.addEventListener("submit", onSubmit);
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") refreshJourney(); });
  renderJourney();
  await refreshJourney();
}

export async function refreshJourney() {
  try {
    const d = await getJSON(`/api/timeline${doc ? `?v=${doc.v}` : ""}`);
    if (!d.unchanged) { doc = d.timeline; store.set("timeline", doc); }
  } catch { /* offline: keep the saved copy */ }
  renderJourney();
}

export function renderJourney() {
  if (!ctx) return;
  renderCard();
  if (!ctx.sheet.hidden) renderSheet();
}

/* ---------- describing items ---------- */
function headline(it) {
  if (it.kind === "flight") return `✈️ <bdi>${esc(it.from)}</bdi> ${fwd()} <bdi>${esc(it.to)}</bdi>`;
  if (it.kind === "stay") return `🏨 <bdi>${esc(it.name)}</bdi>`;
  return `📌 ${esc(it.title)}`;
}
function whenText(it) {
  if (it.kind === "flight") return `${fmtDate(it.date)}${it.time ? ` ${it.time}` : ""}`;
  if (it.kind === "stay") return fmtDate(it.checkIn);
  return fmtDate(it.date);
}

function checks() {
  if (!doc || !canEdit()) return [];
  const out = [];
  for (const g of missingNights(doc)) {
    out.push({ html: t("🛏️ No stay booked: {range} · {nights}", { range: range(g.from, g.to), nights: tn(g.nights, "1 night", "{n} nights") }) });
  }
  for (const d of doubleBooked(doc)) {
    out.push({ html: t("⚠️ Two stays for the night of {date}: {names}", { date: fmtDate(d.night), names: d.names.map((n) => `<bdi>${esc(n)}</bdi>`).join(" + ") }) });
  }
  for (const c of planClashes(doc, ctx.planDays())) {
    out.push({
      html: t("📅 {day} ({date}) is in your Tokyo plan, but that day you're in {country}", {
        day: esc(ctx.dayName(c.index)), date: fmtDate(c.date), country: c.country ? countryName(c.country) : t("no country (outside the trip dates)"),
      }),
      day: c.index,
    });
  }
  const shift = planShiftTarget(doc, ctx.planDays());
  if (shift) {
    out.push({
      html: t("📅 Your Tokyo plan starts on {a}, but you reach Japan on {b}.", { a: fmtDate(shift.from), b: fmtDate(shift.to) }),
      action: `<button class="small-btn btn btn-primary" type="button" data-jr="shift" data-to="${shift.to}">${t("Move the plan to {d}", { d: fmtDate(shift.to) })}</button>`,
    });
  }
  for (const g of startSuggestions(doc, ctx.planDays())) {
    out.push({
      html: t("🏨 {n} plan days don't start at your hotel, {stay}.", { n: g.days.length, stay: `<bdi>${esc(g.stay.name)}</bdi>` }),
      action: `<button class="small-btn btn btn-primary" type="button" data-jr="starts" data-stay="${esc(g.stay.id)}">${t("Start those days there")}</button>`,
    });
  }
  return out;
}

/* ---------- the card on the Trip tab ---------- */
function renderCard() {
  const el = ctx.card;
  if (!doc) { el.hidden = true; return; }
  el.hidden = !ctx.visible();
  const r = tripRange(doc);
  const st = status(doc, today());
  const total = Math.max(1, (r ? (Date.parse(r.end) - Date.parse(r.start)) / 86400000 : 1));
  const segs = [...doc.segments].sort((a, b) => a.from.localeCompare(b.from));
  const marker = st?.phase === "during" ? Math.min(100, ((Date.parse(today()) - Date.parse(r.start)) / 86400000 / total) * 100) : null;
  const statusLine = !st ? "" : st.phase === "before"
    ? tn(st.daysToGo, "Tomorrow we fly! ✈️", "{n} days to go ✈️")
    : st.phase === "during" ? `${t("Day {d} of {n}", { d: st.day, n: st.total })}${st.segment ? ` · ${segName(st.segment)}` : ""}`
      : t("We're home – what a trip! 💖");
  const next = nextItem(doc, today());
  const todo = checks();
  el.innerHTML = `
    <div class="journey-head">
      <h2>🧳 ${esc(t(doc.trip.title))}</h2>
      <span class="small">${r ? range(r.start, r.end) : ""}</span>
    </div>
    <div class="journey-bar" role="img" aria-label="${esc(segs.map((s) => `${segName(s)}: ${tn(nights(s), "1 night", "{n} nights")}`).join(", "))}">
      ${segs.map((s) => `<span class="seg-chip" style="${segStyle(s)};flex:${Math.max(1, nights(s))} 0 auto">${COUNTRY[s.country]?.flag || "🌍"} ${tn(nights(s), "1 night", "{n} nights")}</span>`).join("")}
      ${marker !== null ? `<span class="today-mark" style="inset-inline-start:${marker}%" title="${t("Today")}"></span>` : ""}
    </div>
    <p class="journey-status">${statusLine}</p>
    ${next ? `<p class="small">${t("Next:")} ${headline(next)} · ${whenText(next)}</p>` : canEdit() ? `<p class="small">${t("Add your flights and stays to see what's next.")}</p>` : ""}
    ${todo.length ? `<p class="chip-sm warn-chip">${tn(todo.length, "⚠️ 1 thing to check", "⚠️ {n} things to check")}</p>` : ""}
    <button class="btn btn-secondary full" type="button" data-jr="open">${t("🧳 The whole trip")}</button>`;
}

/* ---------- the full-screen timeline ---------- */
function itemHtml(it) {
  if (it.kind === "holiday") {
    return `<li class="tl-item tl-holiday"><p class="pname">🎌 ${t("Golden Week")}</p><p class="small">${range(it.date, it.to)}</p>
      <p class="tl-notes">${t("Japan's biggest holiday week: trains, sights and hotels are packed and prices go up. Book tickets and restaurants ahead; big sights are calmer early in the morning.")}</p></li>`;
  }
  const adult = canEdit();
  const lines = [];
  if (it.kind === "flight") {
    lines.push(`🛫 ${fmtDate(it.date)}${it.time ? ` ${it.time}` : ""}${it.arrDate || it.arrTime ? ` · 🛬 ${it.arrDate ? fmtDate(it.arrDate) : ""}${it.arrTime ? ` ${it.arrTime}` : ""}` : ""}`);
    if (it.airline || it.flightNo) lines.push(`<bdi>${esc([it.airline, it.flightNo].filter(Boolean).join(" · "))}</bdi>`);
  } else if (it.kind === "stay") {
    lines.push(`${t("Check-in {a} · check-out {b}", { a: fmtDate(it.checkIn), b: fmtDate(it.checkOut) })} · ${tn(Math.round((Date.parse(it.checkOut) - Date.parse(it.checkIn)) / 86400000), "1 night", "{n} nights")}`);
    if (it.address) lines.push(`<bdi>${esc(it.address)}</bdi>`);
  } else {
    lines.push(fmtDate(it.date));
  }
  if (adult && it.booking) lines.push(`${t("Booking:")} <bdi>${esc(it.booking)}</bdi>`);
  if (adult && it.price != null) lines.push(`💳 ${money(it.price, it.currency)}`);
  const links = [];
  if (it.kind === "flight" && it.flightNo) links.push(`<a class="btn btn-secondary" href="https://www.google.com/search?q=${encodeURIComponent(`${it.flightNo} flight status`)}" target="_blank" rel="noopener">${t("✈️ Flight status")}</a>`);
  if (it.kind === "stay") links.push(`<a class="btn btn-secondary" href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent([it.name, it.address].filter(Boolean).join(" "))}" target="_blank" rel="noopener">${t("📍 Google Maps")}</a>`);
  if (adult) {
    links.push(`<button class="btn btn-secondary" type="button" data-jr="edit" data-id="${esc(it.id)}">${t("✏️ Edit")}</button>`);
    links.push(`<button class="btn btn-secondary" type="button" data-jr="delete" data-id="${esc(it.id)}" aria-label="${t("Remove")}">🗑️</button>`);
  }
  return `<li class="tl-item tl-${it.kind}">
    <p class="pname">${headline(it)}</p>
    ${lines.map((l) => `<p class="small">${l}</p>`).join("")}
    ${it.notes ? `<p class="tl-notes">${esc(it.notes)}</p>` : ""}
    ${links.length ? `<div class="row tight">${links.join("")}</div>` : ""}
  </li>`;
}

function listHtml() {
  const adult = canEdit();
  const segs = [...doc.segments].sort((a, b) => a.from.localeCompare(b.from));
  const groups = new Map(segs.map((s) => [s.id, []]));
  const other = [];
  for (const it of sortItems(doc.items)) {
    const s = itemSegment(doc, it);
    (s ? groups.get(s.id) : other).push(it);
  }
  for (const h of holidayNotes(doc)) groups.get(h.segment)?.push(h);
  for (const list of groups.values()) list.sort((a, b) => (a.kind === "stay" ? a.checkIn : a.date).localeCompare(b.kind === "stay" ? b.checkIn : b.date));
  const costs = adult ? fixedCosts(doc) : {};
  const todo = checks();
  return `
    ${adult ? `<div class="row tight tl-actions">
      <button class="btn btn-primary" type="button" data-jr="add" data-kind="flight">${t("＋ ✈️ Flight")}</button>
      <button class="btn btn-primary" type="button" data-jr="add" data-kind="stay">${t("＋ 🏨 Stay")}</button>
      <button class="btn btn-secondary" type="button" data-jr="add" data-kind="note">${t("＋ 📌 Note")}</button>
      <button class="btn btn-secondary" type="button" data-jr="trip">${t("✏️ Dates & budget")}</button>
    </div>
    <p class="budget">${t("💰 Budget {budget} · booked so far: {booked}", {
      budget: money(doc.trip.budget, doc.trip.currency),
      booked: Object.keys(costs).length ? Object.entries(costs).map(([c, n]) => money(n, c)).join(" + ") : money(0, doc.trip.currency),
    })}</p>` : ""}
    ${todo.length ? `<div class="tl-checks"><h3>${t("⚠️ To check")}</h3><ul>${todo.map((c) => `<li>${c.html}${c.day != null ? ` <button class="small-btn btn btn-secondary" type="button" data-jr="day" data-day="${c.day}">${t("Open the day")}</button>` : ""}${c.action ? ` ${c.action}` : ""}</li>`).join("")}</ul></div>` : ""}
    ${segs.map((s) => `<section class="tl-seg" style="${segStyle(s)}">
      <h3 class="tl-seg-head">${segName(s)} <span class="small">${range(s.from, s.to)} · ${tn(nights(s), "1 night", "{n} nights")}</span></h3>
      <ul class="tl-list">${groups.get(s.id).map(itemHtml).join("") || `<li class="hint">${adult ? t("Nothing here yet – add flights and stays above.") : t("Nothing here yet.")}</li>`}</ul>
    </section>`).join("")}
    ${other.length ? `<section class="tl-seg" style="${segStyle({ country: "XX" })}"><h3 class="tl-seg-head">${t("🌍 Outside the trip dates")}</h3><ul class="tl-list">${other.map(itemHtml).join("")}</ul></section>` : ""}`;
}

/* ---------- forms ---------- */
const field = (name, label, value = "", type = "text", extra = "") =>
  `<label class="label" for="jf-${name}">${label}</label><input id="jf-${name}" name="${name}" type="${type}" value="${esc(value ?? "")}" ${extra}>`;
const priceFields = (it) => `<div class="two-col">
    <div>${field("price", t("Price (optional)"), it.price ?? "", "number", 'min="0" step="any" inputmode="decimal"')}</div>
    <div><label class="label" for="jf-currency">${t("Currency")}</label><select id="jf-currency" name="currency">${Object.entries(CURRENCY).map(([c, sym]) => `<option value="${c}" ${(it.currency || "ILS") === c ? "selected" : ""}>${sym} ${c}</option>`).join("")}</select></div>
  </div>`;
const notesField = (it) => `<label class="label" for="jf-notes">${t("Notes")}</label><textarea id="jf-notes" name="notes" rows="3">${esc(it.notes || "")}</textarea>`;

function formHtml() {
  const it = form.item || {};
  const head = (title) => `<h3>${title}</h3>`;
  const buttons = `<div class="row"><button class="btn btn-primary" type="submit">${t("💾 Save")}</button><button class="btn btn-secondary" type="button" data-jr="back">${t("Cancel")}</button></div>`;
  if (form.kind === "flight") {
    return `<form class="tax-form" data-kind="flight">${head(it.id ? t("✏️ Flight") : t("＋ ✈️ Flight"))}
      <div class="two-col"><div>${field("from", t("From (city / airport)"), it.from, "text", 'required placeholder="TLV"')}</div><div>${field("to", t("To"), it.to, "text", 'required placeholder="BKK"')}</div></div>
      <div class="two-col"><div>${field("date", t("Departure date"), it.date, "date", "required")}</div><div>${field("time", t("Departure time"), it.time, "time")}</div></div>
      <div class="two-col"><div>${field("arrDate", t("Arrival date"), it.arrDate, "date")}</div><div>${field("arrTime", t("Arrival time"), it.arrTime, "time")}</div></div>
      <div class="two-col"><div>${field("airline", t("Airline"), it.airline)}</div><div>${field("flightNo", t("Flight number"), it.flightNo, "text", 'placeholder="LY081" autocapitalize="characters"')}</div></div>
      ${field("booking", t("Booking reference"), it.booking, "text", 'autocapitalize="characters"')}
      ${priceFields(it)}${notesField(it)}${buttons}</form>`;
  }
  if (form.kind === "stay") {
    return `<form class="tax-form" data-kind="stay">${head(it.id ? t("✏️ Stay") : t("＋ 🏨 Stay"))}
      ${field("name", t("Hotel / apartment name"), it.name, "text", "required")}
      ${field("address", t("Address or area (for the map link)"), it.address)}
      <input type="hidden" name="lat" value="${esc(it.lat ?? "")}"><input type="hidden" name="lng" value="${esc(it.lng ?? "")}">
      <button class="btn btn-secondary full" type="button" data-jr="locate">${t("📍 Find on the map")}</button>
      <p class="small" id="jf-located">${Number.isFinite(it.lat) ? `✓ ${t("On the map – plan days can start here.")}` : t("Optional: lets the Tokyo plan start each day at this hotel (one free Google search).")}</p>
      <div class="two-col"><div>${field("checkIn", t("Check-in"), it.checkIn, "date", "required")}</div><div>${field("checkOut", t("Check-out"), it.checkOut, "date", "required")}</div></div>
      ${field("booking", t("Booking reference"), it.booking)}
      ${priceFields(it)}${notesField(it)}${buttons}</form>`;
  }
  if (form.kind === "note") {
    return `<form class="tax-form" data-kind="note">${head(it.id ? t("✏️ Note") : t("＋ 📌 Note"))}
      ${field("title", t("What? (e.g. Songkran festival, pick up rail passes)"), it.title, "text", "required")}
      ${field("date", t("Date"), it.date, "date", "required")}
      ${notesField(it)}${buttons}</form>`;
  }
  // trip dates & budget
  const segs = [...doc.segments].sort((a, b) => a.from.localeCompare(b.from));
  const segRow = (s) => `<div class="seg-row" data-seg="${esc(s.id)}">
      <select name="country" aria-label="${t("Country")}">${Object.keys(COUNTRY).map((c) => `<option value="${c}" ${s.country === c ? "selected" : ""}>${countryName(c)}</option>`).join("")}</select>
      <input type="date" name="from" value="${esc(s.from)}" aria-label="${t("From")}" required>
      <input type="date" name="to" value="${esc(s.to)}" aria-label="${t("To")}" required>
      <button class="mini" type="button" data-jr="seg-remove" aria-label="${t("Remove")}">🗑️</button>
    </div>`;
  return `<form class="tax-form" data-kind="trip">${head(t("✏️ Dates & budget"))}
    ${field("title", t("Trip name"), doc.trip.title, "text", "required")}
    <div class="two-col"><div>${field("budget", t("Total budget"), doc.trip.budget, "number", 'min="0" step="100" inputmode="numeric" required')}</div>
      <div><label class="label" for="jf-currency">${t("Currency")}</label><select id="jf-currency" name="currency">${Object.entries(CURRENCY).map(([c, sym]) => `<option value="${c}" ${doc.trip.currency === c ? "selected" : ""}>${sym} ${c}</option>`).join("")}</select></div></div>
    <p class="label">${t("Countries (from the arrival day to the day you leave)")}</p>
    <div class="seg-rows">${segs.map(segRow).join("")}</div>
    <button class="btn btn-secondary full" type="button" data-jr="seg-add">${t("＋ Add a country")}</button>
    ${buttons}</form>`;
}

function renderSheet() {
  const s = ctx.sheet;
  s.innerHTML = `
    <div class="sheet-head"><h2 id="journey-title">🧳 ${esc(doc ? t(doc.trip.title) : "")}</h2>
      <button class="btn btn-secondary" type="button" data-jr="${form ? "back" : "close"}" aria-label="${t("Close")}">✕</button></div>
    <div class="journey-body">${!doc ? `<p class="hint">${t("Loading…")}</p>` : form ? formHtml() : listHtml()}</div>`;
}

function openSheet() {
  form = null;
  ctx.sheet.hidden = false;
  document.body.classList.add("sheet-open");
  renderSheet();
  refreshJourney();
}
function closeSheet() {
  form = null;
  ctx.sheet.hidden = true;
  document.body.classList.remove("sheet-open");
}

async function send(body) {
  try {
    doc = (await postJSON("/api/timeline", body)).timeline;
    store.set("timeline", doc);
    form = null;
    renderJourney();
    ctx.onChange?.();
    return true;
  } catch (err) {
    alert(t("Sorry: {e}", { e: err.message }));
    return false;
  }
}

function onClick(e) {
  const b = e.target.closest("[data-jr]");
  if (!b) return;
  const id = b.dataset.id;
  switch (b.dataset.jr) {
    case "open": return openSheet();
    case "close": return closeSheet();
    case "back": form = null; return renderSheet();
    case "add": form = { kind: b.dataset.kind, item: {} }; renderSheet(); return ctx.sheet.scrollTo(0, 0);
    case "edit": {
      const it = doc.items.find((x) => x.id === id);
      if (it) { form = { kind: it.kind, item: { ...it } }; renderSheet(); ctx.sheet.scrollTo(0, 0); }
      return undefined;
    }
    case "delete":
      if (confirm(t("Delete this from the trip?"))) send({ action: "remove", id });
      return undefined;
    case "trip": form = { kind: "trip" }; renderSheet(); return ctx.sheet.scrollTo(0, 0);
    case "seg-add": {
      const rows = ctx.sheet.querySelector(".seg-rows");
      const last = [...rows.querySelectorAll("[name=to]")].pop()?.value || "";
      rows.insertAdjacentHTML("beforeend", `<div class="seg-row" data-seg="s${Date.now().toString(36)}">${rows.lastElementChild?.innerHTML || ""}</div>`);
      const row = rows.lastElementChild;
      row.querySelector("[name=country]").value = "XX";
      row.querySelector("[name=from]").value = last;
      row.querySelector("[name=to]").value = "";
      return undefined;
    }
    case "seg-remove":
      if (ctx.sheet.querySelectorAll(".seg-row").length > 1) b.closest(".seg-row").remove();
      return undefined;
    case "day":
      closeSheet();
      return ctx.onGoToDay(Number(b.dataset.day));
    case "shift":
      if (confirm(t("Move every dated day of the Tokyo plan so it starts on {d}?", { d: fmtDate(b.dataset.to) }))) { ctx.onShiftPlan(b.dataset.to); renderJourney(); }
      return undefined;
    case "starts": {
      const g = startSuggestions(doc, ctx.planDays()).find((x) => x.stay.id === b.dataset.stay);
      if (g) { ctx.onSetStarts(g.days, { name: g.stay.name, lat: g.stay.lat, lng: g.stay.lng, address: g.stay.address || "" }); renderJourney(); }
      return undefined;
    }
    case "locate": return locate(b.closest("form"));
    default: return undefined;
  }
}

async function locate(f) {
  const name = f.querySelector("[name=name]").value.trim(), address = f.querySelector("[name=address]").value.trim();
  const note = f.querySelector("#jf-located");
  if (!name) { note.textContent = t("Type the hotel name first."); return; }
  const checkIn = f.querySelector("[name=checkIn]").value;
  const seg = checkIn ? doc.segments.find((s) => checkIn >= s.from && checkIn < s.to) : null;
  note.textContent = t("Finding…");
  try {
    const { place } = await getJSON(`/api/find?q=${encodeURIComponent([name, address].filter(Boolean).join(" "))}&country=${seg?.country === "TH" ? "TH" : "JP"}`);
    if (!place) { note.textContent = t("Not found – add the city or area to the address and try again."); return; }
    f.querySelector("[name=lat]").value = place.lat;
    f.querySelector("[name=lng]").value = place.lng;
    if (!address && place.address) f.querySelector("[name=address]").value = place.address;
    note.textContent = `✓ ${t("Found: {a}", { a: place.address || place.name })}`;
  } catch (err) {
    note.textContent = t("Sorry: {e}", { e: err.message });
  }
}

function onSubmit(e) {
  e.preventDefault();
  const f = e.target;
  const data = Object.fromEntries(new FormData(f));
  if (f.dataset.kind === "trip") {
    const segments = [...f.querySelectorAll(".seg-row")].map((row) => ({
      id: row.dataset.seg, country: row.querySelector("[name=country]").value,
      from: row.querySelector("[name=from]").value, to: row.querySelector("[name=to]").value,
    }));
    return send({ action: "trip", trip: { title: data.title, budget: Number(data.budget), currency: data.currency }, segments });
  }
  const item = { ...data, kind: f.dataset.kind, id: form.item?.id };
  if ("price" in item) item.price = item.price === "" ? null : Number(item.price);
  return send({ action: "item", item });
}
