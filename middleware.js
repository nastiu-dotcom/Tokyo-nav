// Vercel Routing Middleware: the whole app is for logged-in family members.
// Runs before every request; without a valid session cookie, pages go to
// /login.html and API calls get 401. The /api functions check again
// (against the user list in Redis), so this is the first of two locks.
import { COOKIE, readCookie, sessionSecret, verifySession } from "./lib/session.js";

// What the login page itself needs.
const PUBLIC = new Set(["/login.html", "/js/login.js", "/styles.css", "/manifest.webmanifest", "/sw.js", "/api/auth", "/favicon.ico"]);
const PUBLIC_DIRS = ["/icons/"];

// Same as next() from @vercel/functions: let the request continue.
const next = () => new Response(null, { headers: { "x-middleware-next": "1" } });

export default async function middleware(request) {
  const url = new URL(request.url);
  const path = url.pathname;
  if (PUBLIC.has(path) || PUBLIC_DIRS.some((d) => path.startsWith(d))) return next();

  const session = await verifySession(readCookie(request.headers.get("cookie"), COOKIE), sessionSecret(process.env));
  if (session) return next();

  if (path.startsWith("/api/")) {
    return new Response(JSON.stringify({ error: "Please log in" }), {
      status: 401, headers: { "content-type": "application/json", "cache-control": "no-store" },
    });
  }
  const to = new URL("/login.html", url);
  if (path !== "/" || url.search) to.searchParams.set("next", path + url.search);
  return new Response(null, { status: 302, headers: { location: to.pathname + to.search, "cache-control": "no-store" } });
}
