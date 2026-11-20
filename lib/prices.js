// What each service charges, and what is free each month.
// Checked November 2026. Prices change – update here (one place) and check the
// real bills in each console (links on the 💰 Running costs page).
//   Google: per-SKU free monthly calls since March 2025 (Essentials 10k, Pro 5k,
//           Enterprise 1k), then the price per 1,000 calls below.
//   Claude: US$ per million tokens (Anthropic API list prices).
//   Upstash Redis free plan: 500k commands / month, 256 MB.
//   Vercel Hobby: ~1M function invocations / month; never billed (pauses instead).
export const PRICES_CHECKED = "2026-11";

/** Google Maps Platform SKUs this app uses – chosen by the fields each call asks for. */
export const GOOGLE = {
  "places.autocomplete": { label: "Places Autocomplete (search box)", free: 10000, per1000: 2.83, route: "autocomplete" },
  "places.details": { label: "Place Details Essentials (location of a picked place)", free: 10000, per1000: 5, route: "place" },
  "places.textsearch.enterprise": { label: "Text Search Enterprise (activity lists: ratings, hours, website)", free: 1000, per1000: 35, route: "activities" },
  "places.textsearch.pro": { label: "Text Search Pro (find a saved place / shop)", free: 5000, per1000: 32, route: "find" },
  "places.nearby.pro": { label: "Nearby Search Pro (stations near a stop)", free: 5000, per1000: 32, route: "guide/route" },
  "routes.compute": { label: "Compute Routes Essentials (train / walking routes)", free: 10000, per1000: 5, route: "route" },
};

/** Claude models (fallbacks can answer with another model – price by the model that ran). */
export const CLAUDE = {
  "claude-opus-5-5": { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 },
  "claude-opus-5": { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
  "claude-opus-4-8": { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
  "claude-sonnet-5-5": { input: 2, output: 10, cacheRead: 0.1, cacheWrite: 2.5 },
  "claude-sonnet-5": { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 },
  "claude-haiku-5-5": { input: 0.1, output: 0.5, cacheRead: 0.01, cacheWrite: 0.125 },
  "claude-fable-5-2": { input: 8, output: 40, cacheRead: 0.2, cacheWrite: 10 },
};
export const CLAUDE_DEFAULT = "claude-opus-5-5";

export const LIMITS = {
  redisCommands: 500_000, // Upstash free plan, per month
  redisBytes: 256 * 1024 * 1024,
  functionRuns: 1_000_000, // Vercel Hobby, per month
};

/** US$ cost of one Claude reply from its usage numbers. */
export function claudeCost(model, u) {
  const p = CLAUDE[model] || CLAUDE[String(model).replace(/-\d{8}$/, "")] || CLAUDE[CLAUDE_DEFAULT];
  return ((u.input_tokens || 0) * p.input + (u.output_tokens || 0) * p.output
    + (u.cache_read_input_tokens || 0) * p.cacheRead + (u.cache_creation_input_tokens || 0) * p.cacheWrite) / 1e6;
}

/** US$ for a month of calls to one Google SKU, after its free allowance. */
export function googleCost(sku, calls) {
  const g = GOOGLE[sku];
  return g ? (Math.max(0, calls - g.free) / 1000) * g.per1000 : 0;
}
