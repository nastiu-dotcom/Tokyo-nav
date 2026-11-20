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
      case "MGET": return a.map((k) => (typeof db.get(k) === "string" ? db.get(k) : null));
      case "GET": { const v = db.get(a[0]); return typeof v === "string" ? v : null; }
      case "SET":
        if (a.slice(2).some((x) => x.toUpperCase() === "NX") && db.has(a[0])) return null;
        db.set(a[0], a[1]); return "OK";
      case "EXPIRE": return db.has(a[0]) ? 1 : 0;
      case "HINCRBY": {
        const h = db.get(a[0]) instanceof Map ? db.get(a[0]) : new Map();
        db.set(a[0], h);
        h.set(a[1], (Number(h.get(a[1])) || 0) + Number(a[2]));
        return h.get(a[1]);
      }
      case "HSET": {
        const h = db.get(a[0]) instanceof Map ? db.get(a[0]) : new Map();
        db.set(a[0], h);
        let added = 0;
        for (let i = 1; i + 1 < a.length; i += 2) { if (!h.has(a[i])) added++; h.set(a[i], a[i + 1]); }
        return added;
      }
      case "HDEL": { const h = db.get(a[0]); return h instanceof Map ? a.slice(1).reduce((n, f) => n + (h.delete(f) ? 1 : 0), 0) : 0; }
      case "INCR": { const n = (Number(db.get(a[0])) || 0) + 1; db.set(a[0], String(n)); return n; }
      case "HGET": { const h = db.get(a[0]); return h instanceof Map && h.has(a[1]) ? String(h.get(a[1])) : null; }
      case "HGETALL": { const h = db.get(a[0]); return h instanceof Map ? [...h.entries()].flatMap(([k, v]) => [k, String(v)]) : []; }
      case "DBSIZE": return db.size;
      case "TYPE": return !db.has(a[0]) ? "none" : db.get(a[0]) instanceof Map ? "hash" : "string";
      case "STRLEN": { const v = db.get(a[0]); return typeof v === "string" ? Buffer.byteLength(v) : 0; }
      case "HLEN": { const h = db.get(a[0]); return h instanceof Map ? h.size : 0; }
      case "SCAN": return ["0", [...db.keys()]];
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
