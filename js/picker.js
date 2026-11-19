// Full-screen sheet to choose a point: Google search, map tap / pin drag, or
// the phone's location. Used for day start points and for adding any place.
import { esc, getJSON } from "./util.js";
import { t } from "./i18n.js";

const TOKYO_STATION = { lat: 35.6812, lng: 139.7671 };
const $ = (s) => document.querySelector(s);

let map, marker, draft, onSave, sessionToken = crypto.randomUUID(), searchTimer, searchSeq = 0;

const els = {
  sheet: $("#picker"), title: $("#picker-title"), search: $("#search"),
  suggestions: $("#suggestions"), useLocation: $("#use-location"),
  save: $("#save-point"), close: $("#picker-close"),
};

export function openPicker({ title, initial, saveText = "Save", onSave: cb }) {
  onSave = cb;
  els.title.textContent = title;
  els.save.dataset.text = saveText;
  els.search.value = "";
  hideSuggestions();
  els.sheet.hidden = false;
  document.body.classList.add("sheet-open");
  const start = initial || TOKYO_STATION;
  if (!map) {
    map = L.map("map").setView([start.lat, start.lng], 14);
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    }).addTo(map);
    marker = L.marker([start.lat, start.lng], { draggable: true, autoPan: true }).addTo(map);
    marker.on("dragend", () => { const p = marker.getLatLng(); setDraft({ lat: p.lat, lng: p.lng }); });
    map.on("click", (e) => setDraft({ lat: e.latlng.lat, lng: e.latlng.lng }));
  }
  setDraft(initial ? { ...initial } : { ...TOKYO_STATION, name: "Tokyo Station" }, true);
  setTimeout(() => { map.invalidateSize(); els.search.focus({ preventScroll: true }); }, 60);
}

export function closePicker() {
  els.sheet.hidden = true;
  document.body.classList.remove("sheet-open");
}

function setDraft(p, recenter = false) {
  draft = {
    ...p,
    name: p.name || t("Pinned spot ({lat}, {lng})", { lat: p.lat.toFixed(4), lng: p.lng.toFixed(4) }),
    id: p.id || `pin-${p.lat.toFixed(5)},${p.lng.toFixed(5)}`,
  };
  marker.setLatLng([p.lat, p.lng]);
  if (recenter) map.setView([p.lat, p.lng], Math.max(map.getZoom(), 15));
  els.save.textContent = `${els.save.dataset.text}: ${draft.name}`;
}

els.save.addEventListener("click", () => {
  if (!draft) return;
  const cb = onSave;
  closePicker();
  cb?.({ ...draft });
});
els.close.addEventListener("click", closePicker);

els.useLocation.addEventListener("click", () => {
  if (!navigator.geolocation) return alert(t("Location is not available on this device."));
  els.useLocation.disabled = true;
  navigator.geolocation.getCurrentPosition(
    (pos) => { els.useLocation.disabled = false; setDraft({ lat: pos.coords.latitude, lng: pos.coords.longitude, name: t("My location") }, true); },
    () => { els.useLocation.disabled = false; alert(t("Could not get your location. Search or tap the map instead.")); },
    { enableHighAccuracy: true, timeout: 10000 },
  );
});

/* Google Places Autocomplete (through /api) */
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
    els.suggestions.innerHTML = suggestions.length
      ? suggestions.map((s) => `<li role="option" tabindex="0" data-id="${esc(s.id)}" data-name="${esc(s.main)}">${esc(s.main)}<small>${esc(s.secondary)}</small></li>`).join("")
      : `<li aria-disabled="true">${t("No matches – try another name")}</li>`;
  } catch (err) {
    els.suggestions.innerHTML = `<li aria-disabled="true">${esc(err.message)}</li>`;
  }
  els.suggestions.hidden = false;
}

function hideSuggestions() { els.suggestions.hidden = true; els.suggestions.innerHTML = ""; }

async function choose(li) {
  if (!li?.dataset.id) return;
  const name = li.dataset.name;
  hideSuggestions();
  els.search.value = name;
  try {
    const p = await getJSON(`/api/place?id=${encodeURIComponent(li.dataset.id)}&session=${sessionToken}`);
    setDraft({ lat: p.lat, lng: p.lng, name, id: li.dataset.id, address: p.address }, true);
  } catch (err) {
    alert(err.message);
  } finally {
    sessionToken = crypto.randomUUID(); // a session ends once a place is picked
  }
}
els.suggestions.addEventListener("click", (e) => choose(e.target.closest("li")));
els.suggestions.addEventListener("keydown", (e) => { if (e.key === "Enter") choose(e.target.closest("li")); });
