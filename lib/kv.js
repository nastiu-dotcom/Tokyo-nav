// Tiny Upstash Redis REST client (no SDK). Works with the variable names the
// Vercel ↔ Upstash integration creates (KV_REST_API_*) and Upstash's own
// (UPSTASH_REDIS_REST_*).
import { HttpError } from "./common.js";
import { kvEnv, kvProblem } from "./kvenv.js";

function conf() {
  const found = kvEnv(process.env);
  if (!found) throw new HttpError(503, kvProblem(process.env));
  return { url: found.url.replace(/\/$/, ""), token: found.token };
}

async function call(path, body) {
  const { url, token } = conf();
  const r = await fetch(`${url}${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    console.error("Upstash error", r.status, data);
    throw new HttpError(502, "The family database didn't answer – try again in a moment.");
  }
  return data;
}

/** One command, e.g. kv(["MGET", "a", "b"]). Returns its result. */
export async function kv(cmd) {
  const d = await call("", cmd);
  if (d.error) throw new HttpError(502, `Database error: ${d.error}`);
  return d.result;
}

/** Several commands in one request. Returns their results. */
export async function kvPipeline(cmds) {
  const d = await call("/pipeline", cmds);
  return d.map((x) => {
    if (x.error) throw new HttpError(502, `Database error: ${x.error}`);
    return x.result;
  });
}

export const kvConfigured = () => Boolean(kvEnv(process.env));
