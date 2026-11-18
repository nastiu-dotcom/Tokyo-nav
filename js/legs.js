// "How to get from A to B": route data (free, Google), built-in guide (free),
// optional AI guide (paid, asks first).
import { esc, getJSON, r, store } from "./util.js";

const VEHICLE_ICON = { Subway: "🚇", Train: "🚆", Shinkansen: "🚄", Monorail: "🚝", Tram: "🚋", Bus: "🚌", Ferry: "⛴️", "Cable car": "🚡", Ropeway: "🚡" };
const AI_COST_NOTE = "about 1–2 US cents";

export function legKeys(from, to) {
  const f = `${r(from.lat, 3)},${r(from.lng, 3)}`;
  const t = `${r(to.lat, 4)},${r(to.lng, 4)}`;
  return { f, t, routeKey: `cache:route:${f}:${t}`, aiKey: `cache:guide:${f}:${t}` };
}

/** Route data for one leg (cached 24 h on the phone and in Vercel's CDN). */
export async function loadLeg(from, to) {
  const k = legKeys(from, to);
  const cached = store.getFresh(k.routeKey);
  if (cached) return cached;
  const data = await getJSON(`/api/route?from=${k.f}&to=${k.t}`);
  store.setFresh(k.routeKey, data);
  return data;
}

export const cachedAiGuide = (from, to) => store.getFresh(legKeys(from, to).aiKey);

/** PAID: only after the user confirms. */
export async function loadAiGuide(from, to, name) {
  const k = legKeys(from, to);
  const cached = store.getFresh(k.aiKey);
  if (cached) return cached;
  const ok = confirm(
    `This is a PAID step.\n\nClaude (AI) will write a family guide to ${name}. ` +
    `It costs ${AI_COST_NOTE}, taken from your prepaid Anthropic credit.\n\n` +
    `The guide is saved for 24 hours, so opening it again is free.\n\nContinue?`);
  if (!ok) return null;
  const data = await getJSON(`/api/guide?from=${k.f}&to=${k.t}&name=${encodeURIComponent(name)}`);
  store.setFresh(k.aiKey, data);
  return data;
}

/** One-line summary shown on the day plan between two stops. */
export function legSummary(route) {
  if (route.kind === "walk") return `🚶 Walk about ${route.totalMinutes} min (${route.distanceKm} km)`;
  if (route.kind === "stations") {
    const s = route.startStations[0], e = route.endStations[0];
    if (s.name === e.name) return `🚶 Walk – both are near ${esc(s.name)}`;
    return `🚶 ${s.walkMinutes} min → 🚉 <strong>${esc(s.name)}</strong> → 🚆 → 🚉 <strong>${esc(e.name)}</strong> → 🚶 ${e.walkMinutes} min`;
  }
  const rides = route.steps.filter((s) => s.mode === "TRANSIT").map((s) => esc(s.lineShort || s.line)).join(" → ");
  return `⏱ ${route.totalMinutes} min · ${rides || "walk"}${route.adultFare ? ` · ${esc(route.adultFare)}` : ""}`;
}

/** Full route details (stations / lines). */
export function renderRoute(route) {
  if (route.kind === "walk") {
    return `<p class="route-summary">🚶 Walk about ${route.totalMinutes} min (${route.distanceKm} km)</p>`;
  }
  if (route.kind === "stations") {
    const st = (list) => list.map((x, i) =>
      `<li><span class="icon">${i ? "·" : "🚉"}</span><span>${i ? esc(x.name) : `<strong>${esc(x.name)}</strong>`} <span class="small">· ~${x.walkMinutes} min walk</span></span></li>`).join("");
    return `<p class="route-summary">📏 ${route.distanceKm} km (straight line)</p>
      <p class="small">Google doesn't share Japanese train timetables with apps, so tap <strong>Navigate</strong> for the exact lines.</p>
      <p class="sub">Stations near the start</p><ul class="legs">${st(route.startStations)}</ul>
      <p class="sub">Stations near the destination</p><ul class="legs">${st(route.endStations)}</ul>`;
  }
  const hex = (c) => (/^#[0-9a-f]{3,8}$/i.test(c || "") ? c : null);
  const head = `⏱ ${route.totalMinutes} min · ${route.transfers} transfer${route.transfers === 1 ? "" : "s"}` +
    (route.adultFare ? ` · ${esc(route.adultFare)} per adult` : "");
  const legs = route.steps.map((s) => {
    if (s.mode === "WALK") return `<li><span class="icon">🚶</span><span>Walk ${s.minutes} min (${s.meters} m)</span></li>`;
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

/** Free, built-in guide made only from the route data + general tips. */
export function freeGuide(route, name) {
  const lines = ["## Steps"];
  let n = 1;
  if (route.kind === "walk") {
    lines.push(`${n++}. Walk about ${route.totalMinutes} min to ${name}. Tap Navigate for the walking map.`);
  } else if (route.kind === "stations") {
    const s = route.startStations[0], e = route.endStations[0];
    if (s.name === e.name) {
      lines.push(`${n++}. Both places are near ${s.name} – walking is easiest. Tap Navigate for the map.`);
    } else {
      lines.push(`${n++}. Walk about ${s.walkMinutes} min to **${s.name}**.`);
      lines.push(`${n++}. Take the train to **${e.name}** – tap Navigate to see which line and where to change.`);
      lines.push(`${n++}. Walk about ${e.walkMinutes} min to ${name}.`);
    }
  } else {
    for (const st of route.steps) {
      lines.push(st.mode === "WALK"
        ? `${n++}. Walk ${st.minutes} min (${st.meters} m).`
        : `${n++}. Take the **${st.line}**${st.direction ? ` toward ${st.direction}` : ""} from ${st.from} to **${st.to}**${st.stops != null ? ` (${st.stops} stops)` : ""}.`);
    }
  }
  if (route.kind !== "walk") {
    lines.push("## Good to know");
    lines.push("- Everyone needs their own IC card (Suica/PASMO) or ticket. Tap in and tap out.");
    lines.push("- Elementary-school kids (usually up to 12) pay about half fare; junior high and up pay adult fare.");
    lines.push("- Weekday rush hours (about 7:30–9:30 and 17:30–19:30) are very crowded – stay together at the gates.");
  }
  return lines.join("\n");
}

/** Renders the small "## heading / 1. step / - bullet" text format. */
export function renderGuideText(text) {
  let html = "", list = null;
  const close = () => { if (list) { html += `</${list}>`; list = null; } };
  const inline = (s) => esc(s).replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  for (const raw of String(text).split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    let m;
    if ((m = line.match(/^#{1,4}\s+(.*)/))) { close(); html += `<h4>${inline(m[1])}</h4>`; }
    else if ((m = line.match(/^\d+[.)]\s+(.*)/))) { if (list !== "ol") { close(); html += "<ol>"; list = "ol"; } html += `<li>${inline(m[1])}</li>`; }
    else if ((m = line.match(/^[-*•]\s+(.*)/))) { if (list !== "ul") { close(); html += "<ul>"; list = "ul"; } html += `<li>${inline(m[1])}</li>`; }
    else { close(); html += `<p>${inline(line)}</p>`; }
  }
  close();
  return html;
}

export { AI_COST_NOTE };
