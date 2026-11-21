// GET /api/autocomplete?q=shinjuku&session=<uuid>        → suggestions while typing
// GET /api/autocomplete?id=<placeId>&session=<uuid>       → location of the chosen one
//   (Place Details, only location + address = cheapest "Essentials" fields)
// One function for both keeps the app under Vercel Hobby's 12-function limit.
// Places API (New) Autocomplete, limited to the trip's countries (Japan,
// Thailand) and biased to where the user is looking (?near=lat,lng).
// Using the same session token for the follow-up ?id= call makes Google
// bill the typing as one session instead of one charge per keystroke.
import { cacheFor, googleFetch, handle, HttpError, noStore, ONE_DAY, parseLatLng, sendError } from "../lib/common.js";

async function placeDetails(req, res) {
  const id = String(req.query.id || "");
  if (!/^[A-Za-z0-9_-]{10,300}$/.test(id)) throw new HttpError(400, "Bad place id");
  const session = String(req.query.session || "").slice(0, 64);
  const url = new URL(`https://places.googleapis.com/v1/places/${id}`);
  url.searchParams.set("languageCode", "en");
  if (session) url.searchParams.set("sessionToken", session);
  const p = await googleFetch(url.toString(), { fieldMask: "location,formattedAddress", sku: "places.details" });
  if (!p.location) throw new HttpError(404, "Place has no location");
  // Same place always has the same coordinates; let the CDN keep it a day.
  cacheFor(res, ONE_DAY);
  res.status(200).json({ lat: p.location.latitude, lng: p.location.longitude, address: p.formattedAddress || "" });
}

export default handle(async (req, res) => {
  if (req.query.id) return placeDetails(req, res);
  const q = String(req.query.q || "").trim().slice(0, 100);
  const session = String(req.query.session || "").slice(0, 64);
  if (q.length < 3) return sendError(res, 400, "Type at least 3 characters");
  const near = parseLatLng(String(req.query.near || ""));

  const data = await googleFetch("https://places.googleapis.com/v1/places:autocomplete", {
    method: "POST",
    sku: "places.autocomplete",
    fieldMask:
      "suggestions.placePrediction.placeId,suggestions.placePrediction.structuredFormat",
    body: {
      input: q,
      sessionToken: session || undefined,
      languageCode: "en",
      includedRegionCodes: ["jp", "th"],
      ...(near ? { locationBias: { circle: { center: { latitude: near.lat, longitude: near.lng }, radius: 50000 } } } : {}),
    },
  });

  const suggestions = (data.suggestions || [])
    .map((s) => s.placePrediction)
    .filter(Boolean)
    .map((p) => ({
      id: p.placeId,
      main: p.structuredFormat?.mainText?.text || "",
      secondary: p.structuredFormat?.secondaryText?.text || "",
    }));

  noStore(res);
  res.status(200).json({ suggestions });
});
