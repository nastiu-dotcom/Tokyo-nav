// GET /api/find?q=Pokemon+Center+Mega+Tokyo
// Finds one place in Japan by name/address and returns its location.
// Used for Google Takeout saved places without coordinates and for shop names
// from tax-refund receipts. Places API (New) Text Search, smallest field mask,
// restricted to a rectangle around Japan; cached 24 h in the CDN.
import { cacheFor, googleFetch, handle, HttpError, memo, ONE_DAY } from "../lib/common.js";

const JAPAN = { low: { latitude: 24.0, longitude: 122.9 }, high: { latitude: 45.6, longitude: 146.0 } };

export default handle(async (req, res) => {
  const q = String(req.query.q || "").trim().replace(/\s+/g, " ").slice(0, 150);
  if (q.length < 2) throw new HttpError(400, "Search text is too short");

  const place = await memo(`find:${q.toLowerCase()}`, ONE_DAY, async () => {
    const data = await googleFetch("https://places.googleapis.com/v1/places:searchText", {
      method: "POST",
      fieldMask: "places.id,places.displayName,places.formattedAddress,places.location",
      sku: "places.textsearch.pro",
      body: { textQuery: q, languageCode: "en", regionCode: "JP", pageSize: 1, locationRestriction: { rectangle: JAPAN } },
    });
    const p = data.places?.[0];
    return p?.location
      ? { id: p.id, name: p.displayName?.text || q, address: p.formattedAddress || "", lat: p.location.latitude, lng: p.location.longitude }
      : null;
  });

  cacheFor(res, ONE_DAY);
  res.status(200).json({ place });
});
