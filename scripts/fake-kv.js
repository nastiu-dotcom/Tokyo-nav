// In-memory stand-in for the Upstash Redis REST API (tests + local dev only).
// Install with installFakeKv(): sets KV_REST_API_* and intercepts fetch().
export function installFakeKv() {
  const db = new Map();
  const realFetch = globalThis.fetch;
  process.env.KV_REST_API_URL = "http://fake-kv.local";
  process.env.KV_REST_API_TOKEN = "fake-token";
  const run = (cmd) => {
    const [op, ...a] = cmd.map(String);
    switch (op.toUpperCase()) {
      case "MGET": return a.map((k) => db.get(k) ?? null);
      case "GET": return db.get(a[0]) ?? null;
      case "SET":
        if (a.slice(2).some((x) => x.toUpperCase() === "NX") && db.has(a[0])) return null;
        db.set(a[0], a[1]); return "OK";
      case "EXPIRE": return db.has(a[0]) ? 1 : 0;
      case "DEL": return a.reduce((n, k) => n + (db.delete(k) ? 1 : 0), 0);
      default: throw new Error(`fake-kv: unsupported ${op}`);
    }
  };
  globalThis.fetch = async (input, init = {}) => {
    const url = typeof input === "string" ? input : input.url;
    if (!url.startsWith("http://fake-kv.local")) return realFetch(input, init);
    const body = JSON.parse(init.body);
    const out = url.endsWith("/pipeline") ? body.map((c) => ({ result: run(c) })) : { result: run(body) };
    return new Response(JSON.stringify(out), { status: 200, headers: { "content-type": "application/json" } });
  };
  return db;
}
