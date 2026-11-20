// GET /api/guide?from=35.681,139.767&to=35.715,139.797&name=Senso-ji
// PAID step (Claude API): the app only calls this after the user confirms.
// 1. Gets the same route data as /api/route (Google, free tier).
// 2. Sends it to Claude to write a short family guide.
// Cached 24 h in Vercel's CDN and on the phone, so each trip is paid for at
// most once a day.
import { cacheFor, handle, HttpError, memo, ONE_DAY } from "../lib/common.js";
import { writeGuide } from "../lib/claude.js";
import { cachedRoute, routePoints } from "./route.js";
import { aiAllowed, count } from "../lib/usage.js";

export default handle(async (req, res) => {
  if (process.env.AI_GUIDES === "off") throw new HttpError(403, "AI guides are switched off.");
  const { a, b } = routePoints(req.query);
  const name = String(req.query.name || "your destination").slice(0, 120);

  const result = await memo(`guide:${a.lat},${a.lng}:${b.lat},${b.lng}:${name}`, ONE_DAY, async () => {
    // paid step: AI must be on and this month under the admin's cap
    const allowed = await aiAllowed();
    if (!allowed.ok) { count("ai:blocked"); throw new HttpError(403, allowed.reason); }
    const route = await cachedRoute(a, b);
    const guide = await writeGuide(name, route);
    return { route, guide, createdAt: new Date().toISOString() };
  });

  cacheFor(res, ONE_DAY);
  res.status(200).json(result);
});
