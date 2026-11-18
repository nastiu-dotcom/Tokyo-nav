// GET /api/route?from=35.681,139.767&to=35.715,139.797
// FREE step (Google free monthly usage): route data only, no AI.
// Transit route if Google has one; in Japan usually a walking route or the
// nearest stations (see lib/route.js). Cached 24 h in Vercel's CDN.
import { cacheFor, handle, HttpError, memo, ONE_DAY, parseLatLng, round } from "../lib/common.js";
import { getRouteData } from "../lib/route.js";

export function routePoints(query) {
  const from = parseLatLng(String(query.from || ""));
  const to = parseLatLng(String(query.to || ""));
  if (!from || !to) throw new HttpError(400, "Both points must be in the Tokyo area");
  // ~100 m precision: enough for routing, and makes cache hits likely.
  return {
    a: { lat: round(from.lat, 3), lng: round(from.lng, 3) },
    b: { lat: round(to.lat, 4), lng: round(to.lng, 4) },
  };
}

export function cachedRoute(a, b) {
  return memo(`route:${a.lat},${a.lng}:${b.lat},${b.lng}`, ONE_DAY, () => getRouteData(a, b));
}

export default handle(async (req, res) => {
  const { a, b } = routePoints(req.query);
  const route = await cachedRoute(a, b);
  cacheFor(res, ONE_DAY);
  res.status(200).json({
    route,
    // Lets the app show the optional (paid) AI guide button only when set up.
    aiAvailable: Boolean(process.env.ANTHROPIC_API_KEY) && process.env.AI_GUIDES !== "off",
    createdAt: new Date().toISOString(),
  });
});
