// GET /api/autocomplete?q=shinjuku&session=<uuid>
// Places API (New) Autocomplete, biased to Tokyo and limited to Japan.
// Using the same session token for the follow-up /api/place call makes Google
// bill the typing as one session instead of one charge per keystroke.
import { googleFetch, handle, noStore, sendError } from "../lib/common.js";

export default handle(async (req, res) => {
  const q = String(req.query.q || "").trim().slice(0, 100);
  const session = String(req.query.session || "").slice(0, 64);
  if (q.length < 3) return sendError(res, 400, "Type at least 3 characters");

  const data = await googleFetch("https://places.googleapis.com/v1/places:autocomplete", {
    method: "POST",
    fieldMask:
      "suggestions.placePrediction.placeId,suggestions.placePrediction.structuredFormat",
    body: {
      input: q,
      sessionToken: session || undefined,
      languageCode: "en",
      includedRegionCodes: ["jp"],
      locationBias: {
        circle: { center: { latitude: 35.6812, longitude: 139.7671 }, radius: 40000 },
      },
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
