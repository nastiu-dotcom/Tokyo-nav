// GET /api/place?id=<placeId>&session=<uuid>
// Place Details (New) for a chosen autocomplete suggestion. Only asks for
// location + address (cheapest "Essentials" fields).
import { cacheFor, googleFetch, handle, HttpError, ONE_DAY } from "../lib/common.js";

export default handle(async (req, res) => {
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
  res.status(200).json({
    lat: p.location.latitude,
    lng: p.location.longitude,
    address: p.formattedAddress || "",
  });
});
