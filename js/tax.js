// Tax-refund tab: photograph receipts and products, keep them as records on
// this phone (IndexedDB – nothing is uploaded), and show them at customs.
import { esc, tokyoNow, uid } from "./util.js";
import { exportDeadline, minimumCheck, MIN_PER_SHOP_DAY, refundEstimate, summary, yen } from "./taxutil.js";

const DB_NAME = "tke-tax";
const STORE = "receipts";
let root;
let editing = null;          // record being edited (or a new one)
let draft = { receipt: null, product: null, enhance: true, loc: null };
let urls = [];               // object URLs to revoke on re-render

/* ---------------- IndexedDB ---------------- */
function openDb() {
  return new Promise((resolve, reject) => {
    if (!("indexedDB" in window)) return reject(new Error("This browser can't store photos (no IndexedDB)."));
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: "id" });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error("Storage unavailable"));
  });
}
async function tx(mode, fn) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const out = fn(t.objectStore(STORE));
    t.oncomplete = () => resolve(out?.result ?? out);
    t.onerror = () => reject(t.error);
  });
}
const allRecords = async () => (await tx("readonly", (s) => s.getAll())) || [];
const putRecord = (r) => tx("readwrite", (s) => s.put(r));
const deleteRecord = (id) => tx("readwrite", (s) => s.delete(id));
export const allTaxRecords = allRecords;
export const saveTaxRecord = putRecord;

/* ---------------- images ---------------- */
async function loadBitmap(file) {
  if ("createImageBitmap" in window) {
    try { return await createImageBitmap(file, { imageOrientation: "from-image" }); } catch { /* fall back */ }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return img;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Shrinks a photo (and for receipts, boosts contrast in black & white). */
export async function processImage(file, maxDim, enhance) {
  const bmp = await loadBitmap(file);
  const w0 = bmp.width, h0 = bmp.height;
  const k = Math.min(1, maxDim / Math.max(w0, h0));
  const w = Math.round(w0 * k), h = Math.round(h0 * k);
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  const ctx = c.getContext("2d");
  ctx.drawImage(bmp, 0, 0, w, h);
  if (enhance) {
    const img = ctx.getImageData(0, 0, w, h);
    const d = img.data;
    for (let i = 0; i < d.length; i += 4) {
      const y = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
      const v = Math.max(0, Math.min(255, (y - 128) * 1.5 + 140)); // contrast + slight brighten
      d[i] = d[i + 1] = d[i + 2] = v;
    }
    ctx.putImageData(img, 0, 0);
  }
  return new Promise((res) => c.toBlob(res, "image/jpeg", 0.82));
}

const objUrl = (blob) => { if (!blob) return ""; const u = URL.createObjectURL(blob); urls.push(u); return u; };

/* ---------------- rendering ---------------- */
export async function renderTax(container) {
  root = container;
  urls.forEach((u) => URL.revokeObjectURL(u));
  urls = [];
  let records = [];
  let storageError = "";
  try { records = await allRecords(); } catch (e) { storageError = e.message; }
  records.sort((a, b) => (b.date + b.createdAt).localeCompare(a.date + a.createdAt));
  const s = summary(records);
  const under = minimumCheck(records).filter((g) => !g.ok);

  root.innerHTML = `
    <details class="tax-info">
      <summary>ℹ️ How the tax refund works (since Nov 1, 2026)</summary>
      <ol>
        <li>Spend at least <strong>${yen(MIN_PER_SHOP_DAY)} before tax per shop per day</strong> at a shop with a “Tax-free / Tax refund” sign.</li>
        <li>Show your <strong>passport at the till</strong>. You pay the full price including tax; the purchase is recorded on your passport.</li>
        <li>Save the receipt here with a photo of the product.</li>
        <li>Keep the goods <strong>unused and in your hand luggage</strong> – don't put them in checked bags before customs.</li>
        <li>At the airport, <strong>before check-in</strong>, scan your passport at the tax-free customs terminal. Customs may ask to see the goods – use “Show at customs”.</li>
        <li>The refund is paid by the shop or its refund company (card, app or cash) as agreed at the till. Goods must leave Japan within 90 days.</li>
      </ol>
      <p class="small">Food, drinks and cosmetics you use in Japan don't qualify. Rules are new – check the shop's refund instructions.</p>
    </details>
    ${storageError ? `<p class="warn">⚠️ ${esc(storageError)}</p>` : ""}
    <div class="tax-summary">
      <div><span class="big">${s.count}</span><span class="small">purchase${s.count === 1 ? "" : "s"}</span></div>
      <div><span class="big">${yen(s.paid)}</span><span class="small">paid</span></div>
      <div><span class="big">${yen(s.pendingRefund)}</span><span class="small">refund to collect</span></div>
    </div>
    ${under.length ? `<p class="warn">⚠️ Under the ${yen(MIN_PER_SHOP_DAY)} minimum (before tax): ${under.map((g) => `${esc(g.shop || "unnamed shop")} on ${esc(g.date)} (${yen(g.beforeTax)})`).join(", ")} – these may not be refunded.</p>` : ""}
    <div class="row">
      <button class="btn btn-primary" type="button" data-tax="new">➕ Add a purchase</button>
      <button class="btn btn-secondary" type="button" data-tax="customs" ${s.pending ? "" : "disabled"}>🛃 Show at customs</button>
    </div>
    <div id="tax-form-slot"></div>
    <div class="tax-list">${records.map(cardHtml).join("") || `<p class="hint">No receipts yet. Tap “Add a purchase” after shopping tax-free.</p>`}</div>
    <details class="tax-backup">
      <summary>💾 Backup &amp; privacy</summary>
      <p class="small">Receipts are stored only on this phone, in this browser. Clearing browser data or uninstalling deletes them – save a backup file now and then (e.g. to Files / Google Drive).</p>
      <div class="row">
        <button class="btn btn-secondary" type="button" data-tax="export" ${records.length ? "" : "disabled"}>⬇️ Save backup file</button>
        <label class="btn btn-secondary">⬆️ Restore backup<input type="file" accept="application/json,.json" data-tax-file="restore" hidden></label>
      </div>
    </details>`;
}

function cardHtml(r) {
  const deadline = exportDeadline(r.date);
  return `<article class="tax-card" data-id="${esc(r.id)}">
    <div class="tax-thumbs">
      ${r.product ? `<img src="${objUrl(r.product)}" alt="Product photo" data-tax="view" data-which="product">` : `<div class="thumb-empty">No product photo</div>`}
      ${r.receipt ? `<img src="${objUrl(r.receipt)}" alt="Receipt photo" data-tax="view" data-which="receipt">` : `<div class="thumb-empty">No receipt photo</div>`}
    </div>
    <div class="tax-body">
      <p class="pname">${esc(r.description || "Purchase")}</p>
      <p class="small">🏬 ${esc(r.shop || "Shop not set")} · 📅 ${esc(r.date)}</p>
      <p>💴 ${yen(r.amount)} paid · refund ≈ <strong>${yen(refundEstimate(r.amount, r.rate))}</strong> (${r.rate === "reduced" ? "8 %" : "10 %"})</p>
      <p class="small">Take it out of Japan by ${esc(deadline)}</p>
      <span class="badge ${r.status === "refunded" ? "open" : "added"}">${r.status === "refunded" ? "✓ Refunded" : "Refund pending"}</span>
    </div>
    <div class="row tight">
      <button class="btn btn-secondary" type="button" data-tax="toggle">${r.status === "refunded" ? "↩︎ Mark pending" : "✓ Mark refunded"}</button>
      <button class="btn btn-secondary" type="button" data-tax="edit">✏️ Edit</button>
      <button class="btn btn-secondary" type="button" data-tax="share">📤 Share</button>
      <button class="btn btn-secondary" type="button" data-tax="delete">🗑️ Delete</button>
    </div>
  </article>`;
}

function formHtml(r) {
  return `<form class="tax-form" novalidate>
    <h3>${r.createdAt ? "Edit purchase" : "New purchase"}</h3>
    <p class="sub">1 · Receipt</p>
    <div class="photo-row">
      <label class="btn btn-primary">📷 Scan receipt<input type="file" accept="image/*" capture="environment" data-tax-file="receipt" hidden></label>
      <label class="btn btn-secondary">🖼️ Upload<input type="file" accept="image/*" data-tax-file="receipt" hidden></label>
    </div>
    <label class="toggle small-toggle"><input type="checkbox" name="enhance" ${draft.enhance ? "checked" : ""}><span>Make receipt photos black &amp; white and sharper</span></label>
    <div class="preview" data-preview="receipt">${draft.receipt ? `<img src="${objUrl(draft.receipt)}" alt="Receipt preview">` : `<span class="small">No receipt photo yet</span>`}</div>
    <p class="sub">2 · Product</p>
    <div class="photo-row">
      <label class="btn btn-primary">📷 Photo of product<input type="file" accept="image/*" capture="environment" data-tax-file="product" hidden></label>
      <label class="btn btn-secondary">🖼️ Upload<input type="file" accept="image/*" data-tax-file="product" hidden></label>
    </div>
    <div class="preview" data-preview="product">${draft.product ? `<img src="${objUrl(draft.product)}" alt="Product preview">` : `<span class="small">No product photo yet</span>`}</div>
    <p class="sub">3 · Details</p>
    <label class="label">What did you buy?<textarea name="description" rows="2" placeholder="e.g. Pokémon plush + 2 card packs">${esc(r.description || "")}</textarea></label>
    <label class="label">Shop<input name="shop" type="text" value="${esc(r.shop || "")}" placeholder="e.g. Pokémon Center Mega Tokyo"></label>
    <div class="row tight">
      <button class="btn btn-secondary" type="button" data-tax="here">📍 I'm at the shop</button>
      <span class="small" data-loc>${draft.loc ? "📍 Shop location saved" : "Saves the shop's location for the 🗺️ Map tab"}</span>
    </div>
    <div class="two-col">
      <label class="label">Date<input name="date" type="date" value="${esc(r.date || tokyoNow().date)}"></label>
      <label class="label">Paid (¥, incl. tax)<input name="amount" type="number" inputmode="numeric" min="0" step="1" value="${esc(r.amount ?? "")}"></label>
    </div>
    <label class="label">Tax rate<select name="rate">
      <option value="standard" ${r.rate !== "reduced" ? "selected" : ""}>10 % – goods (toys, clothes, electronics…)</option>
      <option value="reduced" ${r.rate === "reduced" ? "selected" : ""}>8 % – packaged food &amp; drinks to take home</option>
    </select></label>
    <p class="small" data-estimate></p>
    <div class="row">
      <button class="btn btn-primary" type="submit">💾 Save</button>
      <button class="btn btn-secondary" type="button" data-tax="cancel">Cancel</button>
    </div>
  </form>`;
}

function showForm(r) {
  editing = r;
  draft = { receipt: r.receipt || null, product: r.product || null, enhance: draft.enhance,
    loc: Number.isFinite(r.lat) ? { lat: r.lat, lng: r.lng } : null };
  const slot = root.querySelector("#tax-form-slot");
  slot.innerHTML = formHtml(r);
  updateEstimate();
  slot.scrollIntoView({ behavior: "smooth", block: "start" });
}

function updateEstimate() {
  const f = root.querySelector(".tax-form");
  if (!f) return;
  const est = refundEstimate(f.amount.value, f.rate.value);
  f.querySelector("[data-estimate]").textContent = f.amount.value ? `Estimated refund: ${yen(est)}` : "";
}

/* ---------------- overlays ---------------- */
function overlay(html) {
  const o = document.createElement("div");
  o.className = "viewer";
  o.innerHTML = `<button class="btn btn-secondary viewer-close" type="button">✕ Close</button>${html}`;
  o.addEventListener("click", (e) => { if (e.target === o || e.target.closest(".viewer-close")) o.remove(); });
  document.body.appendChild(o);
}

async function customsView() {
  const recs = (await allRecords()).filter((r) => r.status !== "refunded");
  const s = summary(recs);
  overlay(`<div class="customs">
    <h2>Tax-free purchases · 免税品</h2>
    <p class="small">${recs.length} purchase${recs.length === 1 ? "" : "s"} · ${yen(s.paid)} paid · refund ≈ ${yen(s.pendingRefund)}</p>
    ${recs.map((r) => `<div class="customs-item">
      ${r.product ? `<img src="${objUrl(r.product)}" alt="">` : ""}
      <div><p class="pname">${esc(r.description || "Purchase")}</p>
      <p class="small">${esc(r.shop || "")} · ${esc(r.date)} · ${yen(r.amount)}</p></div>
      ${r.receipt ? `<img class="rcpt" src="${objUrl(r.receipt)}" alt="">` : ""}
    </div>`).join("")}
  </div>`);
}

/* ---------------- share & backup ---------------- */
async function shareRecord(r) {
  const text = `${r.description || "Purchase"} – ${r.shop || ""} – ${r.date} – ${yen(r.amount)} (refund ≈ ${yen(refundEstimate(r.amount, r.rate))})`;
  const files = [];
  if (r.receipt) files.push(new File([r.receipt], `receipt-${r.date}.jpg`, { type: "image/jpeg" }));
  if (r.product) files.push(new File([r.product], `product-${r.date}.jpg`, { type: "image/jpeg" }));
  if (navigator.canShare?.({ files })) {
    try { await navigator.share({ title: "Tax-free purchase", text, files }); return; } catch (e) { if (e.name === "AbortError") return; }
  }
  for (const f of files) download(f, f.name); // fallback: save the photos
}

function download(blob, name) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}

const toDataUrl = (blob) => new Promise((res) => { if (!blob) return res(null); const fr = new FileReader(); fr.onload = () => res(fr.result); fr.readAsDataURL(blob); });
const fromDataUrl = async (u) => (u ? (await fetch(u)).blob() : null);

async function exportBackup() {
  const recs = await allRecords();
  const out = [];
  for (const r of recs) out.push({ ...r, receipt: await toDataUrl(r.receipt), product: await toDataUrl(r.product) });
  download(new Blob([JSON.stringify({ app: "tokyo-kids-explorer", kind: "tax-refund", version: 1, records: out })], { type: "application/json" }),
    `tax-refund-backup-${tokyoNow().date}.json`);
}

async function restoreBackup(file) {
  let data;
  try { data = JSON.parse(await file.text()); } catch { return alert("That file isn't a backup from this app."); }
  if (data?.kind !== "tax-refund" || !Array.isArray(data.records)) return alert("That file isn't a tax-refund backup.");
  let n = 0;
  for (const r of data.records) {
    if (!r?.id) continue;
    await putRecord({ ...r, receipt: await fromDataUrl(r.receipt), product: await fromDataUrl(r.product) });
    n++;
  }
  alert(`Restored ${n} purchase${n === 1 ? "" : "s"}.`);
  renderTax(root);
}

/* ---------------- events ---------------- */
export function initTax(container) {
  root = container;
  root.addEventListener("click", async (e) => {
    const b = e.target.closest("[data-tax]");
    if (!b) return;
    const card = b.closest(".tax-card");
    const id = card?.dataset.id;
    const rec = id ? (await allRecords()).find((r) => r.id === id) : null;
    switch (b.dataset.tax) {
      case "new": return showForm({ id: uid(), status: "pending", rate: "standard" });
      case "cancel": root.querySelector("#tax-form-slot").innerHTML = ""; editing = null; return;
      case "edit": return rec && showForm(rec);
      case "toggle":
        if (!rec) return;
        await putRecord({ ...rec, status: rec.status === "refunded" ? "pending" : "refunded" });
        return renderTax(root);
      case "delete":
        if (!rec || !confirm("Delete this purchase and its photos?")) return;
        await deleteRecord(rec.id);
        return renderTax(root);
      case "share": return rec && shareRecord(rec);
      case "view": {
        const img = b.getAttribute("src");
        return overlay(`<img class="viewer-img" src="${img}" alt="">`);
      }
      case "customs": return customsView();
      case "here": {
        const out = root.querySelector("[data-loc]");
        if (!navigator.geolocation) { out.textContent = "Location not available on this device"; return undefined; }
        out.textContent = "Getting your location…";
        return navigator.geolocation.getCurrentPosition(
          (pos) => { draft.loc = { lat: pos.coords.latitude, lng: pos.coords.longitude }; out.textContent = "📍 Shop location saved"; },
          () => { out.textContent = "Couldn't get your location"; },
          { enableHighAccuracy: true, timeout: 10000 });
      }
      case "export": return exportBackup();
      default: return undefined;
    }
  });

  root.addEventListener("change", async (e) => {
    const input = e.target.closest("[data-tax-file]");
    if (e.target.name === "enhance") { draft.enhance = e.target.checked; return; }
    if (e.target.name === "amount" || e.target.name === "rate") return updateEstimate();
    if (!input || !input.files?.[0]) return;
    const which = input.dataset.taxFile;
    const file = input.files[0];
    input.value = "";
    if (which === "restore") return restoreBackup(file);
    const box = root.querySelector(`[data-preview="${which}"]`);
    box.innerHTML = `<span class="small">Processing photo…</span>`;
    try {
      const blob = await processImage(file, which === "receipt" ? 1800 : 1200, which === "receipt" && draft.enhance);
      draft[which] = blob;
      box.innerHTML = `<img src="${objUrl(blob)}" alt="">`;
    } catch {
      box.innerHTML = `<span class="warn">Couldn't read that photo – try again.</span>`;
    }
  });
  root.addEventListener("input", (e) => { if (e.target.name === "amount") updateEstimate(); });

  root.addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = e.target;
    if (!draft.receipt && !draft.product && !f.description.value.trim()) {
      return alert("Add at least a receipt photo, a product photo or a description.");
    }
    const rec = {
      ...editing,
      description: f.description.value.trim(),
      shop: f.shop.value.trim(),
      date: f.date.value || tokyoNow().date,
      amount: Math.max(0, Math.round(Number(f.amount.value) || 0)),
      rate: f.rate.value === "reduced" ? "reduced" : "standard",
      receipt: draft.receipt,
      product: draft.product,
      lat: draft.loc ? draft.loc.lat : editing.lat,
      lng: draft.loc ? draft.loc.lng : editing.lng,
      notFound: draft.loc ? false : editing.notFound,
      createdAt: editing.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    try {
      await putRecord(rec);
      navigator.storage?.persist?.().catch(() => {}); // ask the browser not to evict the photos
    } catch (err) {
      return alert(`Couldn't save: ${err.message}`);
    }
    editing = null;
    renderTax(root);
  });
}
