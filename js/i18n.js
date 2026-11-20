// Language support: Hebrew (RTL, default) and English.
//  t("English text {n}", {n}) → translated UI text (falls back to English)
//  L(obj, "tip")              → content field in the current language (obj.he.tip)
import HE from "./i18n-he.js";

const read = () => { try { return JSON.parse(localStorage.getItem("lang")); } catch { return null; } };
let lang = read() === "en" ? "en" : "he";

export const getLang = () => lang;
export const isHe = () => lang === "he";
export const locale = () => (lang === "he" ? "he-IL" : "en-GB");

export function setLang(l) {
  lang = l === "en" ? "en" : "he";
  try { localStorage.setItem("lang", JSON.stringify(lang)); } catch { /* ignore */ }
}

export function t(s, vars) {
  let out = (lang === "he" && HE[s]) || s;
  if (vars) out = out.replace(/\{(\w+)\}/g, (m, k) => (vars[k] ?? m));
  return out;
}

/** Plural helper: tn(n, "1 place", "{n} places"). */
export const tn = (n, one, many) => t(n === 1 ? one : many, { n });

/** Content in the current language: obj.he[field] when Hebrew, else obj[field]. */
export function L(obj, field) {
  if (!obj) return "";
  if (lang === "he" && obj.he && obj.he[field] != null && obj.he[field] !== "") return obj.he[field];
  return obj[field];
}

/** Sets lang/dir on <html> and translates static elements marked data-i18n. */
export function applyLang() {
  const html = document.documentElement;
  html.lang = lang;
  html.dir = lang === "he" ? "rtl" : "ltr";
  document.querySelectorAll("[data-i18n]").forEach((el) => { el.textContent = t(el.dataset.i18n); });
  document.querySelectorAll("[data-i18n-ph]").forEach((el) => { el.placeholder = t(el.dataset.i18nPh); });
  document.querySelectorAll("[data-i18n-aria]").forEach((el) => { el.setAttribute("aria-label", t(el.dataset.i18nAria)); });
  document.title = t("Tokyo Kids Explorer");
}

/** Arrow pointing "forward" in the reading direction. */
export const fwd = () => (lang === "he" ? "←" : "→");
