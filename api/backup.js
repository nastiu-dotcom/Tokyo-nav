// GET /api/backup (admins only) → one JSON file with everything the family
// keeps on the server: users (names and roles – never passwords), the whole-trip
// timeline, the wallet (spending, category budgets, hand-typed rates), the plan
// shared with the kids and their suggestions, and the spending settings.
// Tax-refund receipts and photos live on each phone (save them in 🧾 Backup).
import { handleJson } from "../lib/common.js";
import { kv, kvPipeline } from "../lib/kv.js";
import { loadUsers, publicUser, requireAdmin } from "../lib/users.js";

const parse = (s) => { try { return s ? JSON.parse(s) : null; } catch { return null; } };

export default handleJson(async (req, res) => {
  const me = await requireAdmin(req);
  const users = await loadUsers();
  const main = await kv(["GET", "fam:main"]);
  const [timeline, expRaw, plan, manualRates, cfg, famData] = await kvPipeline([
    ["GET", "trip:timeline"], ["HGETALL", "wallet:exp"], ["GET", "wallet:plan"], ["GET", "fx:manual"], ["GET", "cfg:costs"],
    ["GET", main ? `fam:${main}:data` : "fam:none"],
  ]);
  const expenses = [];
  for (let i = 1; i < (expRaw || []).length; i += 2) expenses.push(parse(expRaw[i]));
  const day = new Date().toISOString().slice(0, 10);
  res.setHeader("Content-Disposition", `attachment; filename="trip-backup-${day}.json"`);
  return {
    app: "tokyo-kids-explorer", kind: "backup", version: 1, exportedAt: new Date().toISOString(), by: me.id,
    users: Object.values(users.users).map(publicUser),
    timeline: parse(timeline),
    wallet: { expenses: expenses.filter(Boolean), plan: parse(plan) || {}, manualRates: parse(manualRates) || {} },
    family: parse(famData),
    settings: parse(cfg),
  };
});
