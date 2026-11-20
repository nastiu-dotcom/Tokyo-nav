// 💰 Wallet – the trip budget, made for one-handed use on the go.
// Top: what's left and what you can spend today. Then a quick add (amount,
// currency picked from the country you're in, category, card/cash), budgets
// per category, a daily chart, countries, and the list. Works offline: new
// spending waits on the phone (⏳) and is sent when there's signal.
import { isHe, locale, t } from "./i18n.js";
import { esc, getJSON, postJSON, store } from "./util.js";
import { CATEGORIES, chartDays, countryFor, currencyFor, summarize, toCsv } from "./wallet-core.js";

const SYM = { ILS: "₪", THB: "฿", JPY: "¥", USD: "$", EUR: "€" };
const FLAG = { TH: "🇹🇭", JP: "🇯🇵", IL: "🇮🇱", XX: "🌍" };
const CAT_LABEL = () => ({
  food: t("Food"), transport: t("Transport"), fun: t("Fun & tickets"), shopping: t("Shopping"),
  stay: t("Stays"), flights: t("Flights"), essentials: t("SIM, insurance & visas"), other: t("Other"),
});
const COUNTRY_LABEL = () => ({ TH: t("🇹🇭 Thailand"), JP: t("🇯🇵 Japan"), IL: t("🇮🇱 Israel"), XX: t("🌍 Other") });

let root = null, ctx = null;
let data = store.get("wallet");
let form = null;          // the quick-add form state
let showAll = false, planOpen = false, ratesOpen = false;
let loading = null;

const today = () => new Date().toLocaleDateString("en-CA");
const nf = (n, d = 0) => new Intl.NumberFormat(locale(), { maximumFractionDigits: d, minimumFractionDigits: d }).format(n);
const ils = (n) => `₪${nf(Math.round(n))}`;
const money = (n, c) => `${SYM[c] || ""}${nf(n, c === "JPY" ? 0 : n % 1 ? 2 : 0)}`;
const rid = () => Array.from(crypto.getRandomValues(new Uint8Array(9)), (b) => "abcdefghijkmnopqrstuvwxyz23456789"[b % 33]).join("");
const queue = () => store.get("walletQueue") || [];
const setQueue = (q) => store.set("walletQueue", q);

function freshForm() {
  const d = today();
  const segs = data?.segments || [];
  return {
    id: null, amount: "", currency: currencyFor(segs, d) || store.get("walletCurrency") || "ILS",
    category: "food", method: "cash", date: d, note: "", ilsExact: "",
  };
}

/** Server list + what's still waiting on this phone. */
function expenses() {
  let list = [...(data?.expenses || [])];
  for (const op of queue()) {
    if (op.action === "remove") list = list.filter((e) => e.id !== op.id);
    else {
      const e = op.expense;
      const rate = e.currency === "ILS" ? 1 : data?.rates?.ilsPer?.[e.currency] || 0;
      const est = { ...e, amount: Number(e.amount), ils: Number(e.ilsExact) > 0 ? Number(e.ilsExact) : Number(e.amount) * rate, pending: true };
      list = [est, ...list.filter((x) => x.id !== e.id)];
    }
  }
  return list.sort((a, b) => (b.date + (b.created || "~")).localeCompare(a.date + (a.created || "~")));
}

export function initWallet(container, c) {
  root = container;
  ctx = c;
  root.addEventListener("click", onClick);
  root.addEventListener("input", onInput);
  root.addEventListener("submit", onSubmit);
  window.addEventListener("online", () => syncQueue());
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible" && ctx.visible()) loadWallet(true); });
  setInterval(() => { if (document.visibilityState === "visible" && ctx.visible()) loadWallet(true); }, 60_000);
}

export async function loadWallet(quiet) {
  if (loading) return loading;
  loading = (async () => {
    await syncQueue(true);
    try {
      const d = await getJSON(`/api/wallet${data?.v ? `?v=${encodeURIComponent(data.v)}` : ""}`);
      if (!d.unchanged) { data = d; store.set("wallet", data); }
    } catch (err) {
      if (!quiet && !data) root.innerHTML = `<p class="warn">${esc(err.message)}</p>`;
    }
    loading = null;
    if (ctx.visible() && !root.contains(document.activeElement)) renderWallet();
  })();
  return loading;
}

async function syncQueue(silent) {
  const q = queue();
  if (!q.length || !navigator.onLine) return;
  const left = [];
  let failed = null;
  for (let i = 0; i < q.length; i++) {
    try {
      await postJSON("/api/wallet", q[i]);
    } catch (err) {
      if (err instanceof TypeError) { left.push(...q.slice(i)); break; } // no signal: keep the rest
      failed = err.message; // refused by the server: drop it, tell once
    }
  }
  setQueue(left);
  if (failed) alert(t("Sorry: {e}", { e: failed }));
  if (!silent && q.length !== left.length) { data = { ...data, v: "" }; await loadWallet(true); }
}

async function send(op) {
  setQueue([...queue(), op]);
  renderWallet();
  if (navigator.onLine) {
    await syncQueue(true);
    data = { ...data, v: "" };
    await loadWallet(true);
  }
  renderWallet();
}

/* ---------- small chart: ₪ per day with the daily budget as a dashed line ---------- */
function dayChart(days, byDay, daily) {
  const W = 360, H = 160, P = { l: 40, r: 6, t: 10, b: 22 };
  const vals = days.map((d) => byDay[d] || 0);
  const top = Math.max(...vals, daily > 0 ? daily : 0, 1);
  const p10 = 10 ** Math.floor(Math.log10(top));
  const max = [1, 2, 2.5, 5, 10].map((m) => m * p10).find((m) => m >= top);
  const pw = W - P.l - P.r, ph = H - P.t - P.b, slot = pw / days.length, bw = Math.max(3, Math.min(16, slot - 3));
  const y = (v) => P.t + ph - (v / max) * ph;
  const every = Math.ceil(days.length / 6);
  const fmtDay = (iso) => new Date(`${iso}T12:00:00Z`).toLocaleDateString(locale(), { day: "numeric", month: "numeric", timeZone: "UTC" });
  let svg = [0, max / 2, max].map((v) => `<line class="grid" x1="${P.l}" x2="${W - P.r}" y1="${y(v)}" y2="${y(v)}"/><text class="tick" x="${P.l - 4}" y="${y(v) + 3}" text-anchor="end">₪${nf(v)}</text>`).join("");
  days.forEach((d, i) => {
    const v = vals[i], x = P.l + i * slot + (slot - bw) / 2, h = (v / max) * ph;
    if (h > 0) {
      const r = Math.min(4, bw / 2, h);
      const yy = y(v);
      svg += `<path class="${daily > 0 && v > daily ? "bar over" : "bar"}" d="M${x},${yy + h}V${yy + r}Q${x},${yy} ${x + r},${yy}H${x + bw - r}Q${x + bw},${yy} ${x + bw},${yy + r}V${yy + h}Z"/>`;
    }
    svg += `<rect class="hit" x="${P.l + i * slot}" y="${P.t}" width="${slot}" height="${ph}" tabindex="0"><title>${esc(fmtDay(d))}: ${ils(v)}</title></rect>`;
    if (i % every === 0 || i === days.length - 1) svg += `<text class="tick" x="${x + bw / 2}" y="${H - 6}" text-anchor="middle">${esc(fmtDay(d))}</text>`;
  });
  if (daily > 0) svg += `<line class="budget-line" x1="${P.l}" x2="${W - P.r}" y1="${y(daily)}" y2="${y(daily)}"/>`;
  svg = `<line class="axis" x1="${P.l}" x2="${W - P.r}" y1="${y(0)}" y2="${y(0)}"/>${svg}`;
  return `<figure class="chart">
    <figcaption>${t("Spending per day (₪)")}</figcaption>
    ${daily > 0 ? `<ul class="legend"><li><span class="sw" style="background:var(--series-1)"></span>${t("Spent")}</li><li><span class="sw over"></span>${t("Over the daily budget")}</li><li><span class="dash"></span>${t("Daily budget {n}", { n: ils(daily) })}</li></ul>` : ""}
    <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${t("Spending per day (₪)")}" dir="ltr">${svg}</svg>
    <details class="table-view"><summary>${t("📋 Show as a table")}</summary><div class="tbl-wrap"><table>
      <thead><tr><th>${t("Date")}</th><th>₪</th></tr></thead>
      <tbody>${days.map((d, i) => `<tr><td>${esc(fmtDay(d))}</td><td>${ils(vals[i])}</td></tr>`).join("")}</tbody>
    </table></div></details>
  </figure>`;
}

/* ---------- render ---------- */
function statusLine(ok, okText, badText) {
  return ok ? `<p class="pace good">✓ ${okText}</p>` : `<p class="pace serious">⚠️ ${badText}</p>`;
}

export function renderWallet() {
  if (!root) return;
  if (!data) { root.innerHTML = `<p class="hint">${t("Loading…")}</p>`; return; }
  form ||= freshForm();
  const cats = CAT_LABEL();
  const list = expenses();
  const s = summarize({ expenses: list, booked: data.booked, budget: data.budget.total, range: data.range, plan: data.plan, today: today() });
  const pctOf = (n) => (s.budget > 0 ? Math.max(0, Math.min(100, (n / s.budget) * 100)) : 0);
  const rates = data.rates || { ilsPer: { ILS: 1 }, missing: [] };
  const rate = form.currency === "ILS" ? 1 : rates.ilsPer?.[form.currency];
  const preview = Number(form.ilsExact) > 0 ? Number(form.ilsExact) : Number(form.amount) > 0 && rate ? Number(form.amount) * rate : null;
  const shown = showAll ? list : list.slice(0, 25);
  const pending = queue().length;

  // phase-specific headline
  let phase = "";
  if (s.phase === "before") {
    phase = `<p class="today-line">${t("{n} days to go · {d} a day for {days} days", { n: nf(s.daysToGo), d: ils(s.daily), days: nf(s.totalDays) })}</p>
      <p class="small">${t("That's what's left after flights and stays you booked, spread over the whole trip.")}</p>`;
  } else if (s.phase === "during") {
    phase = `<p class="today-line">${s.todayLeft >= 0 ? t("Today you can still spend {n}", { n: `<b>${ils(s.todayLeft)}</b>` }) : t("Today is {n} over", { n: `<b>${ils(-s.todayLeft)}</b>` })}</p>
      <p class="small">${t("Day {d} of {n} · daily budget {b} · spent today {t}", { d: s.day, n: s.totalDays, b: ils(s.daily), t: ils(s.spentToday) })}</p>
      ${statusLine(s.onTrack, t("On track – at this pace the trip costs {p}", { p: ils(s.projected) }), t("Over pace – at this pace the trip costs {p} ({o} over)", { p: ils(s.projected), o: ils(s.projected - s.budget) }))}`;
  } else if (s.phase === "after") {
    phase = `<p class="today-line">${t("Trip total: {n}", { n: `<b>${ils(s.used)}</b>` })}</p>`;
  }

  const rateNote = rates.missing?.length
    ? `<p class="pace serious">⚠️ ${t("No exchange rate yet for {c} – type the ₪ amount, or an admin can set the rate below.", { c: rates.missing.map((c) => SYM[c] || c).join(" ") })}</p>`
    : rates.stale ? `<p class="small">⚠️ ${t("Exchange rates from {d} (couldn't update).", { d: esc(rates.date) })}</p>` : "";

  root.innerHTML = `
    <section class="card wallet-hero">
      <p class="tile-label">${s.left >= 0 ? t("Left to spend") : t("Over budget")}</p>
      <p class="hero-num ${s.left < 0 ? "neg" : ""}">${ils(Math.abs(s.left))}</p>
      <p class="small">${t("of {b} · booked {k} · spent {s}", { b: ils(s.budget), k: ils(s.bookedIls), s: ils(s.spent) })}</p>
      <div class="seg-meter" role="img" aria-label="${esc(t("of {b} · booked {k} · spent {s}", { b: ils(s.budget), k: ils(s.bookedIls), s: ils(s.spent) }))}">
        <span class="seg booked" style="inline-size:${pctOf(s.bookedIls)}%"></span><span class="seg spent" style="inline-size:${pctOf(s.spent)}%"></span>
      </div>
      <ul class="legend"><li><span class="sw booked"></span>${t("Booked (flights & stays)")}</li><li><span class="sw spent"></span>${t("Spent")}</li><li><span class="sw left"></span>${t("Left")}</li></ul>
      ${phase}
      ${pending ? `<p class="small">⏳ ${t("{n} waiting to sync – they'll be sent when there's signal.", { n: pending })}</p>` : ""}
      ${rateNote}
    </section>

    <form class="card wallet-add" id="w-form" novalidate>
      <h2>${form.id ? t("✏️ Edit spending") : t("➕ Add spending")}</h2>
      <div class="amount-row" dir="ltr">
        <span class="cur-sym">${SYM[form.currency]}</span>
        <input id="w-amount" name="amount" inputmode="decimal" autocomplete="off" placeholder="0" value="${esc(form.amount)}" aria-label="${t("Amount")}">
      </div>
      <div class="chips cur-chips" role="group" aria-label="${t("Currency")}">${Object.keys(SYM).map((c) => `<button class="chip" type="button" data-w="cur" data-v="${c}" aria-pressed="${form.currency === c}">${SYM[c]} ${c}</button>`).join("")}</div>
      <p class="small" id="w-preview">${preview ? `≈ ${ils(preview)}` : form.currency !== "ILS" && !rate ? t("No rate – type the ₪ amount below") : "&nbsp;"}</p>
      <div class="cat-grid" role="group" aria-label="${t("Category")}">${CATEGORIES.map(([id, icon]) => `<button type="button" class="cat-btn" data-w="cat" data-v="${id}" aria-pressed="${form.category === id}"><span>${icon}</span>${esc(cats[id])}</button>`).join("")}</div>
      <div class="two-col">
        <div class="pay-toggle" role="group" aria-label="${t("Paid with")}">
          <button type="button" class="chip" data-w="method" data-v="cash" aria-pressed="${form.method === "cash"}">💵 ${t("Cash")}</button>
          <button type="button" class="chip" data-w="method" data-v="card" aria-pressed="${form.method === "card"}">💳 ${t("Card")}</button>
        </div>
        <input id="w-date" name="date" type="date" value="${esc(form.date)}" aria-label="${t("Date")}">
      </div>
      <input id="w-note" name="note" class="text-input" placeholder="${t("What was it? (optional)")}" value="${esc(form.note)}" maxlength="120">
      <details class="exact" ${form.ilsExact || (form.currency !== "ILS" && !rate) ? "open" : ""}><summary>${t("₪ exact amount (from the card app – optional)")}</summary>
        <input id="w-exact" name="ilsExact" class="text-input" inputmode="decimal" placeholder="₪" value="${esc(form.ilsExact)}">
      </details>
      <div class="row">
        <button class="btn btn-primary" type="submit">${form.id ? t("💾 Save") : t("➕ Add")}</button>
        ${form.id ? `<button class="btn btn-secondary" type="button" data-w="cancel">${t("Cancel")}</button><button class="btn btn-secondary" type="button" data-w="delete" aria-label="${t("Remove")}">🗑️</button>` : ""}
      </div>
    </form>

    <section class="card">
      <div class="sec-head"><h2>${t("📊 By category")}</h2><button class="btn btn-secondary small-btn" type="button" data-w="plan">${t("✏️ Budgets")}</button></div>
      ${s.planTotal ? `<p class="small">${t("Category budgets add up to {p} of {b}.", { p: ils(s.planTotal), b: ils(s.budget) })}</p>` : `<p class="small">${t("Tip: give each category a budget to see where you stand.")}</p>`}
      ${planOpen ? `<form class="plan-form" id="w-plan">${CATEGORIES.map(([id, icon]) => `<label class="plan-row"><span>${icon} ${esc(cats[id])}</span><input name="${id}" inputmode="numeric" placeholder="₪" value="${esc(data.plan?.[id] || "")}"></label>`).join("")}
        <div class="row"><button class="btn btn-primary" type="submit">${t("💾 Save")}</button><button class="btn btn-secondary" type="button" data-w="plan">${t("Cancel")}</button></div></form>` : ""}
      ${(() => {
        const maxSpent = Math.max(...s.byCategory.map((c) => c.spent), 1);
        return s.byCategory.filter((c) => c.spent || c.plan).map((c) => {
          const lim = c.plan || maxSpent;
          const p = Math.min(100, (c.spent / lim) * 100);
          const over = c.plan && c.spent > c.plan;
          return `<div class="meter-row">
            <div class="meter-head"><span class="meter-name">${c.icon} ${esc(cats[c.id])}</span><span class="meter-fig">${ils(c.spent)}${c.plan ? ` / ${ils(c.plan)}` : ""}</span></div>
            <div class="meter-track"><span class="meter-fill ${over ? "critical" : c.plan && p >= 80 ? "serious" : ""}" style="inline-size:${Math.max(c.spent ? 1.5 : 0, p)}%"></span></div>
            ${over ? `<p class="meter-note"><span class="st critical">⛔ ${t("{n} over", { n: ils(c.spent - c.plan) })}</span></p>` : c.booked ? `<p class="meter-note">${t("incl. {n} booked", { n: ils(c.booked) })}</p>` : ""}
          </div>`;
        }).join("") || `<p class="hint">${t("Nothing yet – add your first spending above.")}</p>`;
      })()}
    </section>

    <section class="card">
      ${dayChart(chartDays(data.range, today()), s.byDay, s.phase === "during" || s.phase === "before" ? s.daily : 0)}
      ${Object.keys(s.byCountry).length ? `<h3>${t("By country")}</h3><div class="tbl-wrap"><table><tbody>${Object.entries(s.byCountry).sort((a, b) => b[1] - a[1]).map(([c, n]) => `<tr><td>${esc(COUNTRY_LABEL()[c] || c)}</td><td class="num">${ils(n)}</td></tr>`).join("")}</tbody></table></div>` : ""}
    </section>

    <section class="card">
      <h2>${t("🧾 All spending ({n})", { n: nf(list.length) })}</h2>
      <ul class="w-list">${shown.map((e, i) => {
        const head = i === 0 || shown[i - 1].date !== e.date;
        const dayTotal = list.filter((x) => x.date === e.date).reduce((a, x) => a + x.ils, 0);
        return `${head ? `<li class="w-day"><span>${esc(new Date(`${e.date}T12:00:00Z`).toLocaleDateString(locale(), { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" }))}</span><span class="num">${ils(dayTotal)}</span></li>` : ""}
          <li><button type="button" class="w-item" data-w="edit" data-id="${esc(e.id)}">
            <span class="w-ico">${(CATEGORIES.find(([id]) => id === e.category) || ["", "🎁"])[1]}</span>
            <span class="w-main"><span class="w-name">${esc(e.note || cats[e.category] || e.category)}</span>
              <span class="small">${e.pending ? "⏳ " : ""}${e.method === "cash" ? "💵" : "💳"} ${e.currency !== "ILS" ? `<bdi dir="ltr">${money(e.amount, e.currency)}</bdi> · ` : ""}${FLAG[e.country] || ""} <bdi>${esc(e.by || "")}</bdi></span></span>
            <span class="w-amt num">${ils(e.ils)}</span>
          </button></li>`;
      }).join("") || `<li class="hint">${t("Nothing yet – add your first spending above.")}</li>`}</ul>
      ${!showAll && list.length > shown.length ? `<button class="btn btn-secondary full" type="button" data-w="all">${t("Show all ({n})", { n: nf(list.length) })}</button>` : ""}
      <div class="row">
        <button class="btn btn-secondary" type="button" data-w="csv">${t("⬇️ Spreadsheet (CSV)")}</button>
        <button class="btn btn-secondary" type="button" data-w="tax">${t("🧾 Tax refund receipts")}</button>
      </div>
      <p class="small">${rates.date ? t("Rates: {list} ({src}, {d}).", { list: ["THB", "JPY", "USD"].filter((c) => rates.ilsPer?.[c]).map((c) => `1 ${SYM[c]} = ₪${nf(rates.ilsPer[c], 3)}`).join(" · "), src: esc(rates.source || ""), d: esc(rates.date) }) : ""}
        ${data.me?.role === "admin" ? ` <button class="linkish" type="button" data-w="rates">${t("Set rates by hand")}</button>` : ""}</p>
      ${ratesOpen ? `<form class="plan-form" id="w-rates">${["THB", "JPY", "USD", "EUR"].map((c) => `<label class="plan-row"><span>1 ${SYM[c]} ${c} = ₪</span><input name="${c}" inputmode="decimal" value="${esc(rates.manual?.[c] || "")}" placeholder="${rates.ilsPer?.[c] ? nf(rates.ilsPer[c], 4) : ""}"></label>`).join("")}
        <p class="small">${t("Leave empty to use the automatic rate.")}</p>
        <div class="row"><button class="btn btn-primary" type="submit">${t("💾 Save")}</button><button class="btn btn-secondary" type="button" data-w="rates">${t("Cancel")}</button></div></form>` : ""}
    </section>`;
}

/* ---------- events ---------- */
function updatePreview() {
  const rate = form.currency === "ILS" ? 1 : data?.rates?.ilsPer?.[form.currency];
  const v = Number(form.ilsExact) > 0 ? Number(form.ilsExact) : Number(form.amount) > 0 && rate ? Number(form.amount) * rate : null;
  const el = root.querySelector("#w-preview");
  if (el) el.innerHTML = v ? `≈ ${ils(v)}` : form.currency !== "ILS" && !rate ? t("No rate – type the ₪ amount below") : "&nbsp;";
}

function onInput(e) {
  const n = e.target.name;
  if (!form || !["amount", "date", "note", "ilsExact"].includes(n)) return;
  form[n] = n === "amount" || n === "ilsExact" ? e.target.value.replace(",", ".").replace(/[^\d.]/g, "") : e.target.value;
  if (n === "date" && !form.id) {
    const cur = currencyFor(data?.segments, form.date);
    if (cur && cur !== form.currency) { form.currency = cur; renderWallet(); root.querySelector("#w-date")?.focus(); return; }
  }
  updatePreview();
}

function onClick(e) {
  const b = e.target.closest("[data-w]");
  if (!b) return;
  const v = b.dataset.v;
  switch (b.dataset.w) {
    case "cur": form.currency = v; store.set("walletCurrency", v); renderWallet(); return;
    case "cat": form.category = v; renderWallet(); return;
    case "method": form.method = v; renderWallet(); return;
    case "cancel": form = freshForm(); renderWallet(); return;
    case "delete":
      if (confirm(t("Delete this spending?"))) { const id = form.id; form = freshForm(); send({ action: "remove", id }); }
      return;
    case "edit": {
      const x = expenses().find((y) => y.id === b.dataset.id);
      if (!x) return;
      form = { id: x.id, amount: String(x.amount), currency: x.currency, category: x.category, method: x.method, date: x.date, note: x.note || "", ilsExact: x.exact ? String(x.ils) : "" };
      renderWallet();
      root.querySelector("#w-form")?.scrollIntoView({ behavior: "smooth", block: "start" });
      return;
    }
    case "plan": planOpen = !planOpen; renderWallet(); return;
    case "rates": ratesOpen = !ratesOpen; renderWallet(); return;
    case "all": showAll = true; renderWallet(); return;
    case "tax": ctx.openTax(); return;
    case "csv": {
      const blob = new Blob([toCsv(expenses())], { type: "text/csv;charset=utf-8" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `trip-spending-${today()}.csv`;
      document.body.append(a);
      a.click();
      setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
      return;
    }
    default:
  }
}

async function onSubmit(e) {
  e.preventDefault();
  const f = e.target;
  if (f.id === "w-plan") {
    const plan = Object.fromEntries(new FormData(f));
    try { await postJSON("/api/wallet", { action: "plan", plan }); planOpen = false; data = { ...data, v: "" }; await loadWallet(true); ctx.toast(t("Saved ✅")); } catch (err) { alert(t("Sorry: {e}", { e: err.message })); }
    return;
  }
  if (f.id === "w-rates") {
    const rates = Object.fromEntries([...new FormData(f)].map(([k, v]) => [k, Number(String(v).replace(",", ".")) || 0]));
    try { await postJSON("/api/wallet", { action: "rates", rates }); ratesOpen = false; data = { ...data, v: "" }; await loadWallet(true); ctx.toast(t("Saved ✅")); } catch (err) { alert(t("Sorry: {e}", { e: err.message })); }
    return;
  }
  // add / edit spending
  const amount = Number(String(form.amount).replace(",", "."));
  if (!(amount > 0)) { root.querySelector("#w-amount")?.focus(); return; }
  const rate = form.currency === "ILS" ? 1 : data?.rates?.ilsPer?.[form.currency];
  if (!rate && !(Number(form.ilsExact) > 0)) { alert(t("No rate – type the ₪ amount below")); return; }
  const expense = {
    id: form.id || rid(), amount, currency: form.currency, category: form.category, method: form.method,
    date: form.date || today(), note: form.note.trim(), ilsExact: Number(form.ilsExact) > 0 ? Number(form.ilsExact) : null,
    country: countryFor(data?.segments, form.date || today()),
  };
  const editing = !!form.id;
  form = { ...freshForm(), currency: form.currency, method: form.method };
  ctx.toast(editing ? t("Saved ✅") : t("Added {n} ✅", { n: money(amount, expense.currency) }));
  await send({ action: "save", expense });
}

export const walletDir = () => (isHe() ? "rtl" : "ltr");
