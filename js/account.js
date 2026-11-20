// Who is logged in, plus the small account menu in the top bar:
// change my password · manage users (admins) · log out.
import { t } from "./i18n.js";
import { esc, getJSON, postJSON } from "./util.js";

let me = null;
export const currentUser = () => me;

export async function initAccount(btn, menu) {
  try {
    me = (await getJSON("/api/auth")).user;
  } catch {
    return null; // offline: keep the app usable; 401 already went to the login page
  }
  btn.hidden = false;
  btn.textContent = `👤 ${me.name}`;
  btn.setAttribute("aria-expanded", "false");
  menu.innerHTML = `
    <p class="small">${t("Logged in as {name}", { name: `<bdi>${esc(me.name)}</bdi>` })}${me.role === "admin" ? ` · ${t("admin")}` : ""}</p>
    ${me.role === "admin" ? `<a class="btn btn-secondary" href="/admin.html">${t("🛡️ Manage users")}</a>` : ""}
    <button class="btn btn-secondary" type="button" data-acc="password">${t("🔑 Change my password")}</button>
    <button class="btn btn-secondary" type="button" data-acc="logout">${t("🚪 Log out")}</button>`;

  const toggle = (open) => { menu.hidden = !open; btn.setAttribute("aria-expanded", String(open)); };
  btn.addEventListener("click", (e) => { e.stopPropagation(); toggle(menu.hidden); });
  document.addEventListener("click", (e) => { if (!menu.hidden && !menu.contains(e.target)) toggle(false); });
  menu.addEventListener("click", async (e) => {
    const act = e.target.closest("[data-acc]")?.dataset.acc;
    if (act === "logout") {
      await postJSON("/api/auth", { action: "logout" }).catch(() => {});
      location.href = "/login.html";
    } else if (act === "password") {
      toggle(false);
      await changePassword();
    }
  });
  return me;
}

async function changePassword() {
  const old = prompt(t("Your current password:"));
  if (!old) return;
  const pw = prompt(t("New password (at least 8 characters):"));
  if (!pw) return;
  if (prompt(t("Type the new password again:")) !== pw) return alert(t("The two passwords are different – nothing changed."));
  try {
    await postJSON("/api/auth", { action: "password", old, password: pw });
    alert(t("Password changed ✅ Other phones will need to log in again."));
  } catch (err) {
    alert(t("Sorry: {e}", { e: err.message }));
  }
}
