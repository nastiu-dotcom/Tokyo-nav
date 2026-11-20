// Finds the Upstash Redis REST settings, whatever Vercel named them.
// Vercel ↔ Upstash creates KV_REST_API_URL / KV_REST_API_TOKEN, Upstash itself
// uses UPSTASH_REDIS_REST_URL / _TOKEN, and connecting a database can add a
// custom prefix (e.g. STORAGE_REST_API_URL). No Node-only APIs: used by the
// Edge middleware too.

const PAIRS = [
  ["KV_REST_API_URL", "KV_REST_API_TOKEN"],
  ["UPSTASH_REDIS_REST_URL", "UPSTASH_REDIS_REST_TOKEN"],
];

/** {url, token} or null. */
export function kvEnv(env) {
  for (const [u, t] of PAIRS) if (env[u] && env[t]) return { url: env[u], token: env[t] };
  // Prefixed names: any …URL that points at Upstash over https, with a matching …TOKEN.
  let keys = [];
  try { keys = Object.keys(env); } catch { /* some runtimes can't list variables */ }
  for (const k of keys.sort()) {
    if (!k.endsWith("URL") || k.includes("READ_ONLY")) continue;
    const url = String(env[k] || "");
    const token = env[k.replace(/URL$/, "TOKEN")];
    if (/^https:\/\/[^/]+\.upstash\.io/.test(url) && token) return { url, token };
  }
  return null;
}

/** Why the database can't be used – in plain words – or null if it can. */
export function kvProblem(env) {
  if (kvEnv(env)) return null;
  let values = [];
  try { values = Object.values(env); } catch { /* ignore */ }
  if (values.some((v) => /^rediss?:\/\//.test(String(v)))) {
    return "Login is not set up yet: Vercel has a Redis database connected, but not Upstash's REST settings. In Vercel → Storage, connect “Upstash for Redis” (README step d), then Redeploy.";
  }
  return "Login is not set up yet: no database found. In Vercel → Storage, create the free “Upstash for Redis” database and connect it to this project (README step d), then Redeploy.";
}
