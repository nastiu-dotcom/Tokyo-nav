// GET /api/find?q=Pokemon+Center+Mega+Tokyo
// Finds one place in Japan by name/address and returns its location.
// Used for Google Takeout saved places without coordinates and for shop names
// from tax-refund receipts. Places API (New) Text Search, smallest field mask,
// restricted to a rectangle around Japan; cached 24 h in the CDN.
import { cacheFor, googleFetch, handle, HttpError, memo, ONE_DAY } from "../lib/common.js";

import { AREAS } from "../lib/common.js";

const rect = (b) => ({ low: { latitude: b.minLat, longitude: b.minLng }, high: { latitude: b.maxLat, longitude: b.maxLng } });

export default handle(async (req, res) => {
  const q = String(req.query.q || "").trim().replace(/\s+/g, " ").slice(0, 150);
  if (q.length < 2) throw new HttpError(400, "Search text is too short");

  const country = String(req.query.country || "JP").toUpperCase() === "TH" ? "TH" : "JP";
  const place = await memo(`find:${country}:${q.toLowerCase()}`, ONE_DAY, async () => {
    const data = await googleFetch("https://places.googleapis.com/v1/places:searchText", {
      method: "POST",
      fieldMask: "places.id,places.displayName,places.formattedAddress,places.location",
      sku: "places.textsearch.pro",
      body: { textQuery: q, languageCode: "en", regionCode: country, pageSize: 1, locationRestriction: { rectangle: rect(AREAS[country]) } },
    });
    const p = data.places?.[0];
    return p?.location
      ? { id: p.id, name: p.displayName?.text || q, address: p.formattedAddress || "", lat: p.location.latitude, lng: p.location.longitude }
      : null;
  });

  cacheFor(res, ONE_DAY);
  res.status(200).json({ place });
});
