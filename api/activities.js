// GET /api/activities?category=museums&near=35.68,139.77
// Live family-friendly attractions via Places API (New) Text Search.
//
// Cost control:
//  * a tight field mask (only what the UI shows),
//  * the start point is rounded to ~1 km so nearby users share results,
//  * results are cached 24 h in Vercel's CDN (and in the browser),
//  * "open now" is computed in the browser from the weekly hours, so cached
//    results never show a stale open/closed badge.
import {
  cacheFor, googleFetch, handle, HttpError, memo, ONE_DAY, parseLatLng, round,
} from "../lib/common.js";

export const CATEGORIES = {
  all: "family friendly attractions for kids",
  museums: "interactive science museum or kids museum",
  animals: "zoo or aquarium",
  parks: "park with playground",
  fun: "amusement park, indoor play center or game arcade",
  anime: "anime, character and toy shops for kids",
  views: "observation deck with city view",
  food: "kid friendly cheap restaurant, ramen, sushi or food court",
};

const FIELD_MASK = [
  "places.id",
  "places.displayName",
  "places.formattedAddress",
  "places.location",
  "places.rating",
  "places.userRatingCount",
  "places.regularOpeningHours.periods",
  "places.regularOpeningHours.weekdayDescriptions",
  "places.priceLevel",
  "places.websiteUri",
  "places.primaryTypeDisplayName",
  "places.businessStatus",
].join(",");

export default handle(async (req, res) => {
  const category = String(req.query.category || "all");
  const query = CATEGORIES[category];
  if (!query) throw new HttpError(400, "Unknown category");
  const near = parseLatLng(String(req.query.near || ""));
  if (!near) throw new HttpError(400, "Start point must be in the Tokyo area");

  const lat = round(near.lat, 2);
  const lng = round(near.lng, 2);

  const places = await memo(`act:${category}:${lat},${lng}`, ONE_DAY, async () => {
    const data = await googleFetch("https://places.googleapis.com/v1/places:searchText", {
      method: "POST",
      fieldMask: FIELD_MASK,
      sku: "places.textsearch.enterprise",
      body: {
        textQuery: `${query} in Tokyo`,
        languageCode: "en",
        regionCode: "JP",
        pageSize: 20,
        locationBias: {
          circle: { center: { latitude: lat, longitude: lng }, radius: 15000 },
        },
      },
    });
    return (data.places || [])
      .filter((p) => p.location && p.businessStatus !== "CLOSED_PERMANENTLY")
      .map(simplify);
  });

  cacheFor(res, ONE_DAY);
  res.status(200).json({ category, places });
});

function simplify(p) {
  return {
    id: p.id,
    name: p.displayName?.text || "Unnamed place",
    type: p.primaryTypeDisplayName?.text || "",
    address: p.formattedAddress || "",
    lat: p.location.latitude,
    lng: p.location.longitude,
    rating: p.rating ?? null,
    reviews: p.userRatingCount ?? 0,
    price: p.priceLevel || null,
    website: p.websiteUri || null,
    hours: p.regularOpeningHours?.weekdayDescriptions || null,
    periods: p.regularOpeningHours?.periods || null,
    temporarilyClosed: p.businessStatus === "CLOSED_TEMPORARILY",
  };
}
