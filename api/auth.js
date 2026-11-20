// Login for the whole app.
// GET  /api/auth                       → {user} for the logged-in user (401 if not)
// POST /api/auth {action: "login", name, password}      → sets the session cookie
// POST /api/auth {action: "logout"}                      → clears it
// POST /api/auth {action: "password", old, password}     → change my password
import { HttpError, handleJson } from "../lib/common.js";
import { clearCookie, loadUsers, login, publicUser, requireUser, saveUsers, sessionCookie, setPassword, setupProblem } from "../lib/users.js";

export default handleJson(async (req, res, body) => {
  if (req.method === "GET") return { user: publicUser(await requireUser(req)) };
  const problem = setupProblem();
  if (problem) throw new HttpError(503, problem);

  switch (body.action) {
    case "login": {
      const u = await login(body.name, body.password);
      res.setHeader("Set-Cookie", await sessionCookie(u, req));
      return { user: publicUser(u) };
    }
    case "logout":
      res.setHeader("Set-Cookie", clearCookie(req));
      return { ok: true };
    case "password": {
      const me = await requireUser(req);
      await login(me.id, body.old); // checks the current password (and rate-limits)
      const doc = await loadUsers();
      const u = doc.users[me.id];
      await setPassword(u, body.password);
      await saveUsers(doc);
      res.setHeader("Set-Cookie", await sessionCookie(u, req)); // stay logged in here only
      return { ok: true };
    }
    default:
      throw new HttpError(400, "Unknown action");
  }
});
