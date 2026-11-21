// 💰 Running costs – admin dashboard. Everything that can cost money: Google
// Maps calls (per billing SKU, against each free monthly allowance), Claude
// (exact tokens and $), the Upstash database (commands + storage) and Vercel
// function runs – per day, per endpoint and per person. Refreshes every 30 s.
import { applyLang, isHe, locale, t } from "./i18n.js";
import { esc, getJSON, postJSON } from "./util.js";

const $ = (s) => document.querySelector(s);
const root = $("#costs");
const tip = $("#viz-tip");
let data = null;
let month = "";
let timer = null;

// Google SKU names on screen (the server's English labels are the fallback).
const SKU = () => ({
  "places.autocomplete": t("🔎 Search-box suggestions"),
  "places.details": t("📍 Location of a picked place"),
  "places.textsearch.enterprise": t("🎢 Activity lists (ratings, hours)"),
  "places.textsearch.pro": t("⭐ Finding saved places & shops"),
  "places.nearby.pro": t("🚉 Stations near a stop"),
  "routes.compute": t("🚆 Train & walking routes"),
});
const ROUTE = () => ({
  activities: t("Activity lists"), autocomplete: t("Search box"), find: t("Find a place"),
  route: t("Routes"), guide: t("AI guide"), family: t("Family sharing"), timeline: t("Whole trip"),
  auth: t("Login"), admin: t("Users"), usage: t("This page"),
});
const GROUP = () => ({
  auth: t("Users & logins"), fam: t("Shared plan & kids' ideas"), trip: t("Whole-trip timeline"),
  use: t("Usage counters (this page)"), cfg: t("Settings"),
});

const nf = (n, d = 0) => new Intl.NumberFormat(locale(), { maximumFractionDigits: d, minimumFractionDigits: d }).format(n);
const usd = (n) => `$${nf(n, n > 0 && n < 1 ? 3 : 2)}`;
const pct = (a, b) => (b ? Math.min(999, (a / b) * 100) : 0);
const bytes = (b) => (b < 1024 ? `${nf(b)} B` : b < 1048576 ? `${nf(b / 1024, 1)} KB` : `${nf(b / 1048576, 1)} MB`);
const shortDate = (iso) => new Date(`${iso}T12:00:00Z`).toLocaleDateString(locale(), { day: "numeric", month: "numeric", timeZone: "UTC" });

function toast(msg) {
  const el = $("#toast");
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toast.t);
  toast.t = setTimeout(() => { el.hidden = true; }, 3000);
}

/* ---------- status (icon + word, never colour alone) ---------- */
function status(p) {
  if (p >= 100) return { cls: "critical", icon: "⛔", word: t("used up") };
  if (p >= 80) return { cls: "serious", icon: "⚠️", word: t("almost used up") };
  if (p >= 50) return { cls: "warning", icon: "◐", word: t("half used") };
  return { cls: "good", icon: "✓", word: t("plenty left") };
}

function meter(label, used, limit, figure, note = "") {
  const p = pct(used, limit);
  const s = status(p);
  return `<div class="meter-row">
    <div class="meter-head"><span class="meter-name">${label}</span><span class="meter-fig">${figure}</span></div>
    <div class="meter-track" role="meter" aria-valuemin="0" aria-valuemax="${limit}" aria-valuenow="${used}" aria-label="${esc(label)}">
      <span class="meter-fill ${s.cls}" style="inline-size:${Math.max(p > 0 ? 1.5 : 0, Math.min(100, p))}%"></span>
    </div>
    <p class="meter-note"><span class="st ${s.cls}">${s.icon} ${s.word}</span>${note ? ` · ${note}` : ""}</p>
  </div>`;
}

/* ---------- charts (hand-made SVG) ---------- */
const W = 360, H = 170, PAD = { l: 34, r: 6, t: 10, b: 22 };
const niceMax = (v) => {
  if (v <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  return [1, 2, 2.5, 5, 10].map((m) => m * p).find((m) => m >= v);
};
// bar with only the data end (top) rounded
function barPath(x, y, w, h, r) {
  if (h <= 0) return "";
  r = Math.min(r, w / 2, h);
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
}

/**
 * Vertical bars per day. series: [{key, label, color}] stacked bottom → top.
 * value(day, key) → number. fmt(n) → label text.
 */
function barChart({ id, days, series, value, fmt, title }) {
  const n = days.length || 1;
  const totals = days.map((d) => series.reduce((s, se) => s + value(d, se.key), 0));
  const max = niceMax(Math.max(...totals, 0));
  const pw = W - PAD.l - PAD.r, ph = H - PAD.t - PAD.b;
  const slot = pw / n, bw = Math.max(3, Math.min(18, slot - 3));
  const y = (v) => PAD.t + ph - (v / max) * ph;
  const grid = [0, max / 2, max].map((v) => `<line class="grid" x1="${PAD.l}" x2="${W - PAD.r}" y1="${y(v)}" y2="${y(v)}"/><text class="tick" x="${PAD.l - 4}" y="${y(v) + 3}" text-anchor="end">${esc(fmt(v, true))}</text>`).join("");
  const labelEvery = Math.ceil(n / 6);
  let bars = "", hits = "", xl = "";
  days.forEach((d, i) => {
    const x = PAD.l + i * slot + (slot - bw) / 2;
    let acc = 0;
    const segs = series.map((se) => ({ se, v: value(d, se.key) })).filter((s) => s.v > 0);
    segs.forEach((s, j) => {
      const h0 = (s.v / max) * ph;
      const gap = j < segs.length - 1 ? 2 : 0; // 2px surface gap between stacked segments
      const top = y(acc + s.v), h = Math.max(0, h0 - gap);
      bars += j === segs.length - 1
        ? `<path d="${barPath(x, top, bw, h, 4)}" fill="var(${s.se.color})"/>`
        : `<rect x="${x}" y="${top + gap}" width="${bw}" height="${h}" fill="var(${s.se.color})"/>`;
      acc += s.v;
    });
    hits += `<rect class="hit" x="${PAD.l + i * slot}" y="${PAD.t}" width="${slot}" height="${ph}" data-i="${i}" tabindex="0" aria-label="${esc(shortDate(d.date))}"/>`;
    if (i % labelEvery === 0 || i === n - 1) xl += `<text class="tick" x="${x + bw / 2}" y="${H - 6}" text-anchor="middle">${esc(shortDate(d.date))}</text>`;
  });
  const legend = series.length > 1
    ? `<ul class="legend">${series.map((se) => `<li><span class="sw" style="background:var(${se.color})"></span>${esc(se.label)}</li>`).join("")}</ul>` : "";
  const table = `<details class="table-view"><summary>${t("📋 Show as a table")}</summary><div class="tbl-wrap"><table>
    <thead><tr><th>${t("Date")}</th>${series.map((se) => `<th>${esc(se.label)}</th>`).join("")}${series.length > 1 ? `<th>${t("Total")}</th>` : ""}</tr></thead>
    <tbody>${days.map((d, i) => `<tr><td>${esc(shortDate(d.date))}</td>${series.map((se) => `<td>${esc(fmt(value(d, se.key)))}</td>`).join("")}${series.length > 1 ? `<td>${esc(fmt(totals[i]))}</td>` : ""}</tr>`).join("")}</tbody>
  </table></div></details>`;
  return `<figure class="chart" id="${id}">
    <figcaption>${title}</figcaption>
    ${legend}
    <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(title)}" dir="ltr">${grid}<line class="axis" x1="${PAD.l}" x2="${W - PAD.r}" y1="${y(0)}" y2="${y(0)}"/>${bars}${xl}${hits}</svg>
    ${table}
  </figure>`;
}

function wireTips(id, days, series, value, fmt) {
  const fig = document.getElementById(id);
  if (!fig) return;
  const show = (e) => {
    const r = e.target.closest(".hit");
    if (!r) return;
    const d = days[Number(r.dataset.i)];
    const rows = series.map((se) => ({ se, v: value(d, se.key) })).filter((x) => x.v > 0);
    tip.innerHTML = `<strong>${esc(shortDate(d.date))}</strong>${rows.length ? rows.reverse().map((x) => `<div><span class="sw" style="background:var(${x.se.color})"></span>${esc(x.se.label)}: <b>${esc(fmt(x.v))}</b></div>`).join("") : `<div>${t("Nothing")}</div>`}`;
    tip.hidden = false;
    const box = r.getBoundingClientRect();
    const left = Math.min(window.innerWidth - tip.offsetWidth - 8, Math.max(8, box.left + box.width / 2 - tip.offsetWidth / 2));
    tip.style.left = `${left}px`;
    tip.style.top = `${window.scrollY + box.top - tip.offsetHeight - 6}px`;
  };
  fig.addEventListener("pointerover", show);
  fig.addEventListener("focusin", show);
  fig.addEventListener("pointerleave", () => { tip.hidden = true; });
  fig.addEventListener("focusout", () => { tip.hidden = true; });
}

/* ---------- page ---------- */
function render() {
  const d = data;
  const skuNames = SKU();
  const routes = ROUTE();
  const groups = GROUP();
  const series = d.google.map((g, i) => ({ key: g.sku, label: skuNames[g.sku] || g.label, color: `--series-${i + 1}` }));
  const topGoogle = d.google.map((g) => ({ ...g, p: pct(g.calls, g.free) })).sort((a, b) => b.p - a.p)[0];
  const ai = d.ai;
  const months = Array.from({ length: 6 }, (_, i) => {
    const x = new Date(`${d.today}T12:00:00Z`);
    x.setUTCDate(1);
    x.setUTCMonth(x.getUTCMonth() - i);
    return x.toISOString().slice(0, 7);
  });
  const monthLabel = (m) => new Date(`${m}-15T12:00:00Z`).toLocaleDateString(locale(), { month: "long", year: "numeric", timeZone: "UTC" });

  root.innerHTML = `
    <div class="costs-bar">
      <select id="month" aria-label="${t("Month")}">${months.map((m) => `<option value="${m}" ${m === d.month ? "selected" : ""}>${esc(monthLabel(m))}</option>`).join("")}</select>
      <span class="small">${t("Updated {time} · refreshes every 30 s", { time: new Date().toLocaleTimeString(locale(), { hour: "2-digit", minute: "2-digit", second: "2-digit" }) })}</span>
    </div>

    <section class="tiles">
      <div class="tile"><p class="tile-label">${t("Estimated bill this month")}</p><p class="tile-value">${usd(d.total.usd)}</p>
        <p class="small">${t("Google {g} · AI {a}", { g: usd(d.total.googleUsd), a: usd(d.total.aiUsd) })}</p></div>
      <div class="tile"><p class="tile-label">${t("AI this month")}</p><p class="tile-value">${usd(ai.usd)}</p>
        <p class="small">${ai.enabled ? t("of your {cap} limit", { cap: usd(ai.cap) }) : t("AI is switched off")}</p></div>
      <div class="tile"><p class="tile-label">${t("Google free allowance")}</p><p class="tile-value">${nf(topGoogle.p)}%</p>
        <p class="small">${t("most used: {name}", { name: esc(skuNames[topGoogle.sku] || topGoogle.label) })}</p></div>
      <div class="tile"><p class="tile-label">${t("Database (free plan)")}</p><p class="tile-value">${nf(pct(d.redis.commands, d.redis.limit), 1)}%</p>
        <p class="small">${t("{n} of {limit} commands", { n: nf(d.redis.commands), limit: nf(d.redis.limit) })}</p></div>
    </section>

    <section class="card">
      <h2>${t("🎛️ Spending controls")}</h2>
      <form id="cfg" class="cfg-form">
        <label class="toggle"><input type="checkbox" name="aiEnabled" ${d.cfg.aiEnabled ? "checked" : ""}> ${t("✨ AI family guides are on")}</label>
        <label class="label" for="cap">${t("Monthly AI limit (US$) – guides stop when it's reached")}</label>
        <input id="cap" class="text-input" name="aiCapUsd" type="number" min="0" max="1000" step="0.5" inputmode="decimal" value="${esc(d.cfg.aiCapUsd)}">
        <label class="toggle"><input type="checkbox" name="googleFreeOnly" ${d.cfg.googleFreeOnly ? "checked" : ""}> ${t("🛡️ Google: free allowance only (stop a feature when its free calls are used up)")}</label>
        <button class="btn btn-primary full" type="submit">${t("💾 Save")}</button>
      </form>
      ${ai.configured ? "" : `<p class="small">${t("No Anthropic key is set in Vercel, so AI can't cost anything.")}</p>`}
    </section>

    <section class="card">
      <h2>${t("🗺️ Google Maps")}</h2>
      <p class="small">${t("Each feature has its own free calls per month. Answers served from the 24-hour cache are not counted – Google doesn't bill them.")}</p>
      ${d.google.map((g) => meter(esc(skuNames[g.sku] || g.label), g.calls, g.free,
        `${nf(g.calls)} / ${nf(g.free)}`,
        `${t("then ${p} per 1,000", { p: nf(g.per1000, 2) })}${g.usd ? ` · <b>${usd(g.usd)}</b>` : ""}${g.blocked ? ` · ${t("{n} stopped by the free-only guard", { n: nf(g.blocked) })}` : ""}`)).join("")}
      ${barChart({ id: "g-chart", days: d.daily, series, value: (day, k) => day.google[k] || 0, fmt: (v) => nf(v), title: t("Google calls per day") })}
    </section>

    <section class="card">
      <h2>${t("✨ AI guides (Claude)")}</h2>
      <div class="mini-tiles">
        <div><b>${nf(ai.guides)}</b><span>${t("guides")}</span></div>
        <div><b>${nf(ai.in + ai.cacheRead + ai.cacheWrite)}</b><span>${t("tokens in")}</span></div>
        <div><b>${nf(ai.out)}</b><span>${t("tokens out")}</span></div>
        <div><b>${ai.guides ? usd(ai.usd / ai.guides) : "–"}</b><span>${t("per guide")}</span></div>
      </div>
      ${meter(t("Spent of the monthly limit"), ai.usd, ai.cap || 0.000001, `${usd(ai.usd)} / ${usd(ai.cap)}`,
        `${t("Opus 5.5: ${i} in · ${o} out per million tokens", { i: ai.price.input, o: ai.price.output })}${ai.blocked ? ` · ${t("{n} guides stopped by your controls", { n: nf(ai.blocked) })}` : ""}`)}
      ${barChart({ id: "ai-chart", days: d.daily, series: [{ key: "ai", label: t("AI cost"), color: "--series-1" }], value: (day) => day.aiUsd, fmt: (v, axis) => (axis ? `$${nf(v, !v ? 0 : v < 0.1 ? 3 : v < 10 ? 2 : 0)}` : usd(v)), title: t("AI cost per day (US$)") })}
    </section>

    <section class="card">
      <h2>${t("🗄️ Database (Upstash, free plan)")}</h2>
      ${meter(t("Commands this month"), d.redis.commands, d.redis.limit, `${nf(d.redis.commands)} / ${nf(d.redis.limit)}`)}
      ${meter(t("Storage"), d.redis.bytes, d.redis.bytesLimit, `${bytes(d.redis.bytes)} / ${bytes(d.redis.bytesLimit)}`, t("{n} keys", { n: nf(d.redis.keys) }))}
      <div class="tbl-wrap"><table>
        <thead><tr><th>${t("What")}</th><th>${t("Keys")}</th><th>${t("Size")}</th></tr></thead>
        <tbody>${Object.entries(d.redis.groups).sort((a, b) => b[1].bytes - a[1].bytes).map(([g, v]) => `<tr><td>${esc(groups[g] || g)}</td><td>${nf(v.keys)}</td><td>${bytes(v.bytes)}</td></tr>`).join("")}</tbody>
      </table></div>
      <p class="small">${t("Over the free plan the database stops answering until next month – it doesn't charge you.")}</p>
    </section>

    <section class="card">
      <h2>${t("⚙️ Server functions (Vercel Hobby)")}</h2>
      ${meter(t("Function runs this month"), d.functionTotal, d.functionLimit, `${nf(d.functionTotal)} / ${nf(d.functionLimit)}`)}
      <div class="tbl-wrap"><table>
        <thead><tr><th>${t("Endpoint")}</th><th>${t("Runs")}</th><th>${t("Avg time")}</th></tr></thead>
        <tbody>${d.functions.map((f) => `<tr><td>${esc(routes[f.route] || f.route)} <bdi class="ltr small">/api/${esc(f.route)}</bdi></td><td>${nf(f.calls)}</td><td><bdi class="ltr">${nf(f.avgMs)} ms</bdi></td></tr>`).join("") || `<tr><td colspan="3">${t("Nothing yet this month.")}</td></tr>`}</tbody>
      </table></div>
      <p class="small">${t("The Hobby plan is free and never billed – at its limit Vercel pauses the app. Page visits and the login gate aren't counted here.")}</p>
    </section>

    <section class="card">
      <h2>${t("👨‍👩‍👧 Who used what")}</h2>
      <div class="tbl-wrap"><table>
        <thead><tr><th>${t("Person")}</th><th>${t("API calls")}</th><th>${t("Google")}</th><th>${t("AI guides")}</th><th>AI $</th></tr></thead>
        <tbody>${d.users.map((u) => `<tr><td><bdi>${esc(u.name)}</bdi></td><td>${nf(u.apiCalls)}</td><td>${nf(u.google)}</td><td>${nf(u.aiGuides)}</td><td>${usd(u.aiUsd)}</td></tr>`).join("") || `<tr><td colspan="5">${t("Nothing yet this month.")}</td></tr>`}</tbody>
      </table></div>
    </section>

    <section class="card">
      <h2>${t("🧾 Real bills")}</h2>
      <p class="small">${t("These numbers are measured by the app and priced with the list prices checked in {when}. The real bills are here:", { when: esc(d.checked) })}</p>
      <div class="links">
        <a class="btn btn-secondary" href="https://console.cloud.google.com/billing" target="_blank" rel="noopener">${t("Google Cloud billing")}</a>
        <a class="btn btn-secondary" href="https://platform.claude.com/" target="_blank" rel="noopener">${t("Anthropic Console")}</a>
        <a class="btn btn-secondary" href="https://vercel.com/dashboard" target="_blank" rel="noopener">${t("Vercel usage")}</a>
        <a class="btn btn-secondary" href="https://console.upstash.com/" target="_blank" rel="noopener">${t("Upstash console")}</a>
      </div>
    </section>`;

  wireTips("g-chart", d.daily, series, (day, k) => day.google[k] || 0, (v) => nf(v));
  wireTips("ai-chart", d.daily, [{ key: "ai", label: t("AI cost"), color: "--series-1" }], (day) => day.aiUsd, usd);
}

async function load(quiet) {
  try {
    data = await getJSON(`/api/usage${month ? `?month=${month}` : ""}`);
    if (!document.activeElement?.closest("#cfg")) render(); // don't redraw while typing
  } catch (err) {
    if (!quiet) root.innerHTML = `<section class="card"><p class="warn">${esc(err.message)}</p><a class="btn btn-secondary" href="/">${t("Back to the app")}</a></section>`;
  }
}

root.addEventListener("change", (e) => {
  if (e.target.id === "month") { month = e.target.value; load(); }
});
root.addEventListener("submit", async (e) => {
  e.preventDefault();
  const f = new FormData(e.target);
  try {
    const r = await postJSON("/api/usage", { action: "settings", aiEnabled: f.has("aiEnabled"), aiCapUsd: Number(f.get("aiCapUsd")), googleFreeOnly: f.has("googleFreeOnly") });
    data.cfg = r.cfg;
    data.ai.enabled = r.cfg.aiEnabled;
    data.ai.cap = r.cfg.aiCapUsd;
    document.activeElement?.blur();
    render();
    toast(t("Saved ✅"));
  } catch (err) {
    alert(t("Sorry: {e}", { e: err.message }));
  }
});

(async function init() {
  applyLang();
  document.title = t("💰 Running costs");
  $("#costs-title").textContent = t("Running costs");
  $("#back").textContent = isHe() ? "→" : "←";
  $("#back").setAttribute("aria-label", t("Back to the app"));
  await load();
  timer = setInterval(() => { if (document.visibilityState === "visible") load(true); }, 30_000);
})();
export const stop = () => clearInterval(timer);
