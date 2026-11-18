// GET /api/guide?from=35.681,139.767&to=35.715,139.797&name=Senso-ji
// 1. Gets route data: a Google Routes API transit route, or (Google has no
//    transit data for Japan) a walking route / the nearest stations.
// 2. Sends it to Claude to write a short family guide.
// The whole result is cached 24 h in Vercel's CDN (the browser also keeps it
// 24 h), so each origin/destination pair costs at most one Routes call and one
// Claude call per day.
import { cacheFor, handle, HttpError, memo, ONE_DAY, parseLatLng, round } from "../lib/common.js";
import { getRouteData } from "../lib/route.js";
import { writeGuide } from "../lib/claude.js";

export default handle(async (req, res) => {
  const from = parseLatLng(String(req.query.from || ""));
  const to = parseLatLng(String(req.query.to || ""));
  if (!from || !to) throw new HttpError(400, "Both points must be in the Tokyo area");
  const name = String(req.query.name || "your destination").slice(0, 120);

  // ~100 m precision: enough for routing, and makes cache hits likely.
  const a = { lat: round(from.lat, 3), lng: round(from.lng, 3) };
  const b = { lat: round(to.lat, 4), lng: round(to.lng, 4) };
  const key = `guide:${a.lat},${a.lng}:${b.lat},${b.lng}:${name}`;

  const result = await memo(key, ONE_DAY, async () => {
    const route = await getRouteData(a, b);
    const guide = await writeGuide(name, route);
    return { route, guide, createdAt: new Date().toISOString() };
  });

  cacheFor(res, ONE_DAY);
  res.status(200).json(result);
});
