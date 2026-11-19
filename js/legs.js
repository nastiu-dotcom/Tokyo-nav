// "How to get from A to B": route data (free, Google), built-in guide (free),
// optional AI guide (paid, asks first).
import { esc, getJSON, r, store } from "./util.js";
import { fwd, t, tn } from "./i18n.js";

const VEHICLE_ICON = { Subway: "🚇", Train: "🚆", Shinkansen: "🚄", Monorail: "🚝", Tram: "🚋", Bus: "🚌", Ferry: "⛴️", "Cable car": "🚡", Ropeway: "🚡" };
export const AI_COST_NOTE = () => t("about 1–2 US cents");

export function legKeys(from, to) {
  const f = `${r(from.lat, 3)},${r(from.lng, 3)}`;
  const k = `${r(to.lat, 4)},${r(to.lng, 4)}`;
  return { f, t: k, routeKey: `cache:route:${f}:${k}`, aiKey: `cache:guide:${f}:${k}` };
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
  const ok = confirm(t("This is a PAID step.\n\nClaude (AI) will write a family guide to {name}. It costs {cost}, taken from your prepaid Anthropic credit.\n\nThe guide is saved for 24 hours, so opening it again is free.\n\nContinue?", { name, cost: AI_COST_NOTE() }));
  if (!ok) return null;
  const data = await getJSON(`/api/guide?from=${k.f}&to=${k.t}&name=${encodeURIComponent(name)}`);
  store.setFresh(k.aiKey, data);
  return data;
}

/** One-line summary shown on the day plan between two stops. */
export function legSummary(route) {
  const a = fwd();
  if (route.kind === "walk") return t("🚶 Walk about {n} min ({km} km)", { n: route.totalMinutes, km: route.distanceKm });
  if (route.kind === "stations") {
    const s = route.startStations[0], e = route.endStations[0];
    if (s.name === e.name) return t("🚶 Walk – both are near {name}", { name: esc(s.name) });
    return `🚶 ${t("{n} min", { n: s.walkMinutes })} ${a} 🚉 <strong>${esc(s.name)}</strong> ${a} 🚆 ${a} 🚉 <strong>${esc(e.name)}</strong> ${a} 🚶 ${t("{n} min", { n: e.walkMinutes })}`;
  }
  const rides = route.steps.filter((s) => s.mode === "TRANSIT").map((s) => esc(s.lineShort || s.line)).join(` ${a} `);
  return `⏱ ${t("{n} min", { n: route.totalMinutes })} · ${rides || t("walk")}${route.adultFare ? ` · ${esc(route.adultFare)}` : ""}`;
}

/** Full route details (stations / lines). */
export function renderRoute(route) {
  const a = fwd();
  if (route.kind === "walk") {
    return `<p class="route-summary">${t("🚶 Walk about {n} min ({km} km)", { n: route.totalMinutes, km: route.distanceKm })}</p>`;
  }
  if (route.kind === "stations") {
    const st = (list) => list.map((x, i) =>
      `<li><span class="icon">${i ? "·" : "🚉"}</span><span>${i ? esc(x.name) : `<strong>${esc(x.name)}</strong>`} <span class="small">· ${t("~{n} min walk", { n: x.walkMinutes })}</span></span></li>`).join("");
    return `<p class="route-summary">${t("📏 {km} km (straight line)", { km: route.distanceKm })}</p>
      <p class="small">${t("Google doesn't share Japanese train timetables with apps, so tap <strong>Navigate</strong> for the exact lines.")}</p>
      <p class="sub">${t("Stations near the start")}</p><ul class="legs">${st(route.startStations)}</ul>
      <p class="sub">${t("Stations near the destination")}</p><ul class="legs">${st(route.endStations)}</ul>`;
  }
  const hex = (c) => (/^#[0-9a-f]{3,8}$/i.test(c || "") ? c : null);
  const head = `⏱ ${t("{n} min", { n: route.totalMinutes })} · ${tn(route.transfers, "1 transfer", "{n} transfers")}` +
    (route.adultFare ? ` · ${t("{fare} per adult", { fare: esc(route.adultFare) })}` : "");
  const legs = route.steps.map((s) => {
    if (s.mode === "WALK") return `<li><span class="icon">🚶</span><span>${t("Walk {n} min ({m} m)", { n: s.minutes, m: s.meters })}</span></li>`;
    const style = hex(s.color) ? `style="background:${hex(s.color)};color:${hex(s.textColor) || "#fff"}"` : "";
    return `<li><span class="icon">${VEHICLE_ICON[s.vehicle] || "🚆"}</span><span>
      <span class="line-tag" ${style}>${esc(s.lineShort || s.line)}</span>${s.lineShort ? esc(s.line) : ""}
      ${s.direction ? `<br>${t("toward")} <strong>${esc(s.direction)}</strong>` : ""}
      <br>${esc(s.from)} ${a} <strong>${esc(s.to)}</strong>
      <span class="small">${s.stops != null ? ` · ${tn(s.stops, "1 stop", "{n} stops")}` : ""} · ${t("{n} min", { n: s.minutes })}${s.everyMinutes ? ` · ${t("every ~{n} min", { n: s.everyMinutes })}` : ""}</span>
    </span></li>`;
  }).join("");
  return `<p class="route-summary">${head}</p><ul class="legs">${legs}</ul>`;
}

/** Free, built-in guide made only from the route data + general tips. */
export function freeGuide(route, name) {
  const lines = [`## ${t("Steps")}`];
  let n = 1;
  if (route.kind === "walk") {
    lines.push(`${n++}. ${t("Walk about {n} min to {name}. Tap Navigate for the walking map.", { n: route.totalMinutes, name })}`);
  } else if (route.kind === "stations") {
    const s = route.startStations[0], e = route.endStations[0];
    if (s.name === e.name) {
      lines.push(`${n++}. ${t("Both places are near {station} – walking is easiest. Tap Navigate for the map.", { station: s.name })}`);
    } else {
      lines.push(`${n++}. ${t("Walk about {n} min to **{station}**.", { n: s.walkMinutes, station: s.name })}`);
      lines.push(`${n++}. ${t("Take the train to **{station}** – tap Navigate to see which line and where to change.", { station: e.name })}`);
      lines.push(`${n++}. ${t("Walk about {n} min to {name}.", { n: e.walkMinutes, name })}`);
    }
  } else {
    for (const st of route.steps) {
      lines.push(st.mode === "WALK"
        ? `${n++}. ${t("Walk {n} min ({m} m).", { n: st.minutes, m: st.meters })}`
        : `${n++}. ${t("Take the **{line}** from {from} to **{to}**.", { line: st.line, from: st.from, to: st.to })}${st.direction ? ` (${t("toward")} ${st.direction})` : ""}${st.stops != null ? ` – ${tn(st.stops, "1 stop", "{n} stops")}` : ""}`);
    }
  }
  if (route.kind !== "walk") {
    lines.push(`## ${t("Good to know")}`);
    lines.push(`- ${t("Everyone needs their own IC card (Suica/PASMO) or ticket. Tap in and tap out.")}`);
    lines.push(`- ${t("Elementary-school kids (usually up to 12) pay about half fare; junior high and up pay adult fare.")}`);
    lines.push(`- ${t("Weekday rush hours (about 7:30–9:30 and 17:30–19:30) are very crowded – stay together at the gates.")}`);
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
