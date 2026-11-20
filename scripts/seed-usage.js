// Local demo only: fills the in-memory database with 3 weeks of plausible
// usage so the 💰 Running costs page has something to show (SEED_USAGE=1).
export function seedUsage(db) {
  const rnd = (a, b) => Math.round(a + Math.random() * (b - a));
  const now = new Date();
  const month = now.toISOString().slice(0, 7);
  const m = new Map(), u = new Map();
  const add = (map, f, n) => map.set(f, (Number(map.get(f)) || 0) + n);
  for (let back = 20; back >= 0; back--) {
    const day = new Date(now.getTime() - back * 86400000);
    const key = day.toISOString().slice(0, 10);
    if (!key.startsWith(month)) continue;
    const d = new Map();
    const v = {
      "g:places.autocomplete": rnd(5, 60), "g:places.details": rnd(2, 20), "g:places.textsearch.enterprise": rnd(4, 40),
      "g:places.textsearch.pro": rnd(0, 6), "g:places.nearby.pro": rnd(2, 16), "g:routes.compute": rnd(3, 30),
      "ai:guides": rnd(0, 3), "fn:activities": rnd(4, 40), "fn:autocomplete": rnd(5, 60), "fn:route": rnd(3, 30),
      "fn:timeline": rnd(5, 25), "fn:family": rnd(10, 60), "fn:auth": rnd(2, 10), "kv:cmds": rnd(150, 600),
    };
    v["ai:usd_micro"] = v["ai:guides"] * rnd(9000, 16000);
    v["ai:in"] = v["ai:guides"] * 1400; v["ai:out"] = v["ai:guides"] * 420;
    v["fn:guide"] = v["ai:guides"];
    for (const [f, n] of Object.entries(v)) {
      d.set(f, n); add(m, f, n);
      if (!f.startsWith("kv:")) { add(u, `nastia|${f}`, Math.ceil(n * 0.6)); add(u, `eden|${f}`, Math.floor(n * 0.25)); add(u, `noam|${f}`, Math.floor(n * 0.15)); }
    }
    db.set(`use:d:${key}`, d);
  }
  db.set(`use:m:${month}`, m);
  db.set(`use:u:${month}`, u);
}
