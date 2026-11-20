// Admin page: list family users, add new ones, change role, reset password,
// switch off or remove. The server (api/admin.js) enforces all the rules.
import { applyLang, isHe, t } from "./i18n.js";
import { esc, getJSON, postJSON } from "./util.js";

const $ = (s) => document.querySelector(s);
const root = $("#admin");
let state = { users: [], me: "" };

const ROLE_LABEL = () => ({ admin: t("🛡️ Admin – can manage users"), member: t("👤 Family member") });

function toast(msg) {
  const el = $("#toast");
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => { el.hidden = true; }, 3000);
}

function render() {
  const roles = ROLE_LABEL();
  const roleSelect = (u) => `<select data-role aria-label="${t("Role")}" ${u.id === state.me ? "disabled" : ""}>${Object.entries(roles)
    .map(([k, label]) => `<option value="${k}" ${u.role === k ? "selected" : ""}>${label}</option>`).join("")}</select>`;
  root.innerHTML = `
    <section class="card">
      <h2>${t("👨‍👩‍👧 Who can use the app ({n})", { n: state.users.length })}</h2>
      <ul class="user-list">${state.users.map((u) => `
        <li class="user-row ${u.disabled ? "off" : ""}" data-id="${esc(u.id)}">
          <p class="pname"><bdi>${esc(u.name)}</bdi>
            ${u.id === state.me ? `<span class="chip-sm">${t("that's you")}</span>` : ""}
            ${u.disabled ? `<span class="badge closed">${t("switched off")}</span>` : ""}</p>
          <div class="row tight">
            ${roleSelect(u)}
            <button class="btn btn-secondary" type="button" data-act="password">${t("🔑 New password")}</button>
            ${u.id === state.me ? "" : `
              <button class="btn btn-secondary" type="button" data-act="disable">${u.disabled ? t("▶️ Switch on") : t("⏸️ Switch off")}</button>
              <button class="btn btn-secondary" type="button" data-act="remove" aria-label="${t("Remove")}">🗑️</button>`}
          </div>
        </li>`).join("")}</ul>
    </section>
    <form class="card add-user" id="add-user" novalidate>
      <h2>${t("➕ Add a user")}</h2>
      <label class="label" for="new-name">${t("Name (used to log in)")}</label>
      <input id="new-name" class="text-input" autocomplete="off" autocapitalize="none" spellcheck="false" required>
      <label class="label" for="new-pw">${t("Password (at least 8 characters)")}</label>
      <input id="new-pw" class="text-input" type="text" autocomplete="new-password" required>
      <label class="label" for="new-role">${t("Role")}</label>
      <select id="new-role">${Object.entries(roles).map(([k, label]) => `<option value="${k}" ${k === "member" ? "selected" : ""}>${label}</option>`).join("")}</select>
      <button class="btn btn-primary full" type="submit">${t("➕ Add")}</button>
      <p class="small">${t("Send the name and password to the person privately. They can change the password in the 👤 menu.")}</p>
    </form>`;
}

async function act(body, done) {
  try {
    state = await postJSON("/api/admin", body);
    render();
    if (done) toast(done);
  } catch (err) {
    alert(t("Sorry: {e}", { e: err.message }));
    render();
  }
}

root.addEventListener("change", (e) => {
  const sel = e.target.closest("[data-role]");
  if (sel) act({ action: "role", id: sel.closest("[data-id]").dataset.id, role: sel.value }, t("Saved ✅"));
});

root.addEventListener("click", (e) => {
  const btn = e.target.closest("[data-act]");
  if (!btn) return;
  const id = btn.closest("[data-id]").dataset.id;
  const u = state.users.find((x) => x.id === id);
  if (btn.dataset.act === "password") {
    const pw = prompt(t("New password for {name} (at least 8 characters):", { name: u.name }));
    if (pw) act({ action: "password", id, password: pw }, t("Password changed ✅ {name} will need to log in again.", { name: u.name }));
  } else if (btn.dataset.act === "disable") {
    act({ action: "disable", id, disabled: !u.disabled }, t("Saved ✅"));
  } else if (btn.dataset.act === "remove") {
    if (confirm(t("Remove {name}? They won't be able to log in.", { name: u.name }))) act({ action: "remove", id }, t("Removed"));
  }
});

root.addEventListener("submit", (e) => {
  e.preventDefault();
  const name = $("#new-name").value.trim(), password = $("#new-pw").value;
  if (!name || !password) return alert(t("Type a name and a password."));
  act({ action: "add", name, password, role: $("#new-role").value }, t("{name} can log in now ✅", { name }));
});

(async function init() {
  applyLang();
  document.title = t("🛡️ Users");
  $("#admin-title").textContent = t("Users");
  $("#back").textContent = isHe() ? "→" : "←";
  $("#back").setAttribute("aria-label", t("Back to the app"));
  try {
    state = await getJSON("/api/admin");
    render();
  } catch (err) {
    root.innerHTML = `<section class="card"><p class="warn">${esc(err.message)}</p><a class="btn btn-secondary" href="/">${t("Back to the app")}</a></section>`;
  }
})();
