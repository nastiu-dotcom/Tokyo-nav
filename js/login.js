// Login page. Self-contained on purpose: it loads no trip data, so nothing
// about the family's plans is visible before logging in.
const TX = {
  he: {
    title: "טוקיו לילדים", hello: "שלום! 👋", intro: "האפליקציה של הטיול המשפחתי. היכנסו עם השם והסיסמה שלכם.",
    name: "שם", password: "סיסמה", login: "כניסה", wait: "נכנסים…", show: "הצגת הסיסמה",
    empty: "הקלידו שם וסיסמה.", page: "כניסה · טוקיו לילדים", offline: "אין חיבור לאינטרנט – נסו שוב.",
    "Wrong name or password": "שם או סיסמה שגויים",
    "Too many wrong passwords – wait 15 minutes and try again": "יותר מדי ניסיונות שגויים – חכו 15 דקות ונסו שוב",
  },
  en: {
    title: "Tokyo Kids Explorer", hello: "Hello! 👋", intro: "The family trip app. Log in with your name and password.",
    name: "Name", password: "Password", login: "Log in", wait: "Logging in…", show: "Show password",
    empty: "Type your name and password.", page: "Log in · Tokyo Kids Explorer", offline: "No internet connection – try again.",
  },
};
const read = () => { try { return JSON.parse(localStorage.getItem("lang")); } catch { return null; } };
const lang = read() === "en" ? "en" : "he";
const tx = (k) => TX[lang][k] ?? TX.en[k] ?? k;
const $ = (s) => document.querySelector(s);

document.documentElement.lang = lang;
document.documentElement.dir = lang === "he" ? "rtl" : "ltr";
document.title = tx("page");
document.querySelectorAll("[data-tx]").forEach((el) => { el.textContent = tx(el.dataset.tx); });
document.querySelectorAll("[data-tx-aria]").forEach((el) => el.setAttribute("aria-label", tx(el.dataset.txAria)));
$("#lang-btn").textContent = lang === "he" ? "EN" : "עב";
$("#lang-btn").addEventListener("click", () => {
  try { localStorage.setItem("lang", JSON.stringify(lang === "he" ? "en" : "he")); } catch { /* ignore */ }
  location.reload();
});
$("#show-pw").addEventListener("click", (e) => {
  const on = $("#password").type === "password";
  $("#password").type = on ? "text" : "password";
  e.currentTarget.setAttribute("aria-pressed", String(on));
});

// Only go back to a page on this site (never to another domain).
function target() {
  const n = new URLSearchParams(location.search).get("next") || "/";
  return (/^\/(?!\/)/.test(n) ? n : "/") + location.hash; // keeps #join=… family links
}

const showError = (msg) => { $("#error").textContent = msg; $("#error").hidden = !msg; };

$("#login").addEventListener("submit", async (e) => {
  e.preventDefault();
  const name = $("#name").value.trim(), password = $("#password").value;
  if (!name || !password) return showError(tx("empty"));
  showError("");
  $("#go").disabled = true;
  $("#go").textContent = tx("wait");
  try {
    const res = await fetch("/api/auth", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "login", name, password }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Error ${res.status}`);
    location.replace(target());
  } catch (err) {
    showError(err instanceof TypeError ? tx("offline") : tx(err.message));
    $("#password").select();
  } finally {
    $("#go").disabled = false;
    $("#go").textContent = tx("login");
  }
});
$("#name").focus();
