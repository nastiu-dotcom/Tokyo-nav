// App users (login), stored in Upstash Redis as one small JSON document:
//   auth:users = {users: {<id>: {id, name, role, salt, hash, ver, disabled, created}}, seeded}
// Passwords are kept only as scrypt hashes. The first users are created once,
// from the INITIAL_PASSWORD environment variable (never from the code).
import { randomBytes, scrypt as scryptCb, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { HttpError } from "./common.js";
import { kv, kvConfigured } from "./kv.js";
import { COOKIE, SESSION_DAYS, readCookie, sessionSecret, signSession, verifySession } from "./session.js";

const scrypt = promisify(scryptCb);
const DOC = "auth:users";
// admin: manages users · member: plans and edits · kid: sees the plan (no prices), suggests places
export const ROLES = ["admin", "member", "kid"];
// First users (names only – the password comes from INITIAL_PASSWORD).
const SEED = [["nastia", "admin"], ["eden", "kid"], ["Noam", "kid"]];
const MAX_FAILS = 8;          // wrong passwords per user …
const FAIL_WINDOW = 15 * 60;  // … per 15 minutes

export const userId = (name) => String(name ?? "").normalize("NFKC").trim().toLowerCase();
export const validName = (name) => /^[\p{L}\p{N}._-]{2,30}$/u.test(String(name ?? "").normalize("NFKC").trim());
export function checkPassword(pw) {
  if (typeof pw !== "string" || pw.length < 8 || pw.length > 200) throw new HttpError(400, "The password needs at least 8 characters");
}

async function hashPassword(pw, salt = randomBytes(16).toString("hex")) {
  const hash = (await scrypt(pw.normalize("NFKC"), salt, 32)).toString("hex");
  return { salt, hash };
}

async function passwordMatches(pw, u) {
  // Always run scrypt (even for unknown users) so timing doesn't reveal names.
  const { hash } = await hashPassword(String(pw ?? ""), u?.salt || "0".repeat(32));
  if (!u) return false;
  const a = Buffer.from(hash, "hex"), b = Buffer.from(u.hash, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}

export function setupProblem() {
  if (!kvConfigured()) return "Login is not set up yet: connect the free Upstash Redis database in Vercel (README step d).";
  if (!sessionSecret(process.env)) return "Login is not set up yet: the server has no signing secret.";
  return null;
}

/** Loads the users document, creating the first users once if needed. */
export async function loadUsers() {
  const raw = await kv(["GET", DOC]);
  if (raw) return migrate(JSON.parse(raw));
  const pw = process.env.INITIAL_PASSWORD;
  if (!pw) throw new HttpError(503, "Login is not set up yet: add INITIAL_PASSWORD in Vercel and redeploy (README step e).");
  checkPassword(pw);
  const doc = { users: {}, seeded: new Date().toISOString(), kidsV1: true };
  for (const [name, role] of SEED) doc.users[userId(name)] = await newUser(name, role, pw);
  // NX: if two first logins race, only one seed wins.
  await kv(["SET", DOC, JSON.stringify(doc), "NX"]);
  return JSON.parse(await kv(["GET", DOC]));
}

// Users seeded before the kid role existed: eden and Noam become kids (once).
async function migrate(doc) {
  if (doc.kidsV1) return doc;
  for (const id of ["eden", "noam"]) if (doc.users[id]?.role === "member") { doc.users[id].role = "kid"; doc.users[id].ver += 1; }
  doc.kidsV1 = true;
  await kv(["SET", DOC, JSON.stringify(doc)]);
  return doc;
}

export async function saveUsers(doc) {
  await kv(["SET", DOC, JSON.stringify(doc)]);
}

export async function newUser(name, role, pw) {
  if (!validName(name)) throw new HttpError(400, "Names can use letters, numbers, . _ - (2–30 characters)");
  if (!ROLES.includes(role)) throw new HttpError(400, "Unknown role");
  checkPassword(pw);
  return { id: userId(name), name: String(name).normalize("NFKC").trim(), role, ...(await hashPassword(pw)), ver: 1, disabled: false, created: new Date().toISOString() };
}

export async function setPassword(u, pw) {
  checkPassword(pw);
  Object.assign(u, await hashPassword(pw));
  u.ver = (u.ver || 1) + 1; // logs out old sessions
}

export const publicUser = (u) => ({ id: u.id, name: u.name, role: u.role, disabled: !!u.disabled, created: u.created });

/** Checks a name + password; returns the user or throws 401/429. */
export async function login(name, pw) {
  const id = userId(name);
  const failKey = `auth:fail:${id}`;
  const fails = Number(await kv(["GET", failKey])) || 0;
  if (fails >= MAX_FAILS) throw new HttpError(429, "Too many wrong passwords – wait 15 minutes and try again");
  const doc = await loadUsers();
  const u = doc.users[id];
  const ok = await passwordMatches(pw, u);
  if (!ok || u.disabled) {
    await kv(["SET", failKey, String(fails + 1), "EX", FAIL_WINDOW]);
    throw new HttpError(401, "Wrong name or password");
  }
  if (fails) await kv(["DEL", failKey]);
  return u;
}

export async function sessionCookie(u, req) {
  const exp = Math.floor(Date.now() / 1000) + SESSION_DAYS * 86400;
  const token = await signSession({ u: u.id, v: u.ver, exp }, sessionSecret(process.env));
  return `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_DAYS * 86400}${secure(req)}`;
}
export const clearCookie = (req) => `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure(req)}`;
const secure = (req) => (/^(localhost|127\.0\.0\.1)(:|$)/.test(String(req.headers?.host || "")) ? "" : "; Secure");

/** The logged-in user for this request, or throws 401. Re-checked against Redis every time,
 * so removing a user or resetting a password locks them out at once. */
export async function requireUser(req) {
  const problem = setupProblem();
  if (problem) throw new HttpError(503, problem);
  const s = await verifySession(readCookie(req.headers?.cookie, COOKIE), sessionSecret(process.env));
  if (!s) throw new HttpError(401, "Please log in");
  const doc = await loadUsers();
  const u = doc.users[s.u];
  if (!u || u.disabled || u.ver !== s.v) throw new HttpError(401, "Please log in again");
  return u;
}

/** Admins and members (grown-ups) – not kids. */
export async function requireAdult(req) {
  const u = await requireUser(req);
  if (u.role === "kid") throw new HttpError(403, "Kids can look but not change this");
  return u;
}

export async function requireAdmin(req) {
  const u = await requireUser(req);
  if (u.role !== "admin") throw new HttpError(403, "Only an admin can do this");
  return u;
}
