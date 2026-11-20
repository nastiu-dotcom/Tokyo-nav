// Minimal local server (no Vercel CLI needed): serves the static files and
// runs the /api/*.js functions with a Vercel-like req/res.
//   GOOGLE_MAPS_API_KEY=... ANTHROPIC_API_KEY=... node scripts/dev-server.js
//   FAKE_KV=1 INITIAL_PASSWORD=... → in-memory Redis, so login works locally
import http from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { installFakeKv } from "./fake-kv.js";
import middleware from "../middleware.js";

if (process.env.FAKE_KV === "1") {
  const db = installFakeKv(); // local testing of login, family sharing, usage
  if (process.env.SEED_USAGE === "1") (await import("./seed-usage.js")).seedUsage(db);
}

const root = fileURLToPath(new URL("..", import.meta.url));
const port = Number(process.env.PORT) || 3000;
const types = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css",
  ".svg": "image/svg+xml", ".png": "image/png", ".webmanifest": "application/manifest+json",
  ".json": "application/json",
};

http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  // Same login gate as on Vercel (middleware.js).
  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers)) headers.set(k, Array.isArray(v) ? v.join(", ") : v);
  const gate = await middleware(new Request(url, { headers }));
  if (!gate.headers.get("x-middleware-next")) {
    res.statusCode = gate.status;
    gate.headers.forEach((v, k) => res.setHeader(k, v));
    return res.end(Buffer.from(await gate.arrayBuffer()));
  }
  if (url.pathname.startsWith("/api/")) {
    const name = url.pathname.slice(5).replace(/[^a-z]/g, "");
    try {
      const mod = await import(join(root, "api", `${name}.js`));
      req.query = Object.fromEntries(url.searchParams);
      if (req.method === "POST") {
        let raw = "";
        for await (const chunk of req) raw += chunk;
        try { req.body = JSON.parse(raw || "{}"); } catch { req.body = {}; }
      }
      res.status = (code) => { res.statusCode = code; return res; };
      res.json = (obj) => { res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify(obj)); };
      return await mod.default(req, res);
    } catch {
      res.statusCode = 404; return res.end("Not found");
    }
  }
  const path = normalize(join(root, url.pathname === "/" ? "index.html" : url.pathname));
  if (!path.startsWith(root) || /node_modules|\.git|\/api\/|\/lib\//.test(path)) {
    res.statusCode = 404; return res.end("Not found");
  }
  try {
    const body = await readFile(path);
    res.setHeader("Content-Type", types[extname(path)] || "application/octet-stream");
    res.end(body);
  } catch {
    res.statusCode = 404; res.end("Not found");
  }
}).listen(port, () => console.log(`Tokyo Kids Explorer on http://localhost:${port}`));
