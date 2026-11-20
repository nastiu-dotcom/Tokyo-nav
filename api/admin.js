// User management (admins only).
// GET  /api/admin                                   → {users: [...]}
// POST /api/admin {action: "add", name, password, role}
//                 {action: "role", id, role}
//                 {action: "password", id, password}   (reset someone's password)
//                 {action: "disable", id, disabled}
//                 {action: "remove", id}
import { HttpError, handleJson } from "../lib/common.js";
import { ROLES, loadUsers, newUser, publicUser, requireAdmin, saveUsers, setPassword, userId } from "../lib/users.js";

const list = (doc) => Object.values(doc.users).map(publicUser).sort((a, b) => a.created.localeCompare(b.created));
const activeAdmins = (doc) => Object.values(doc.users).filter((u) => u.role === "admin" && !u.disabled);

export default handleJson(async (req, res, body) => {
  const me = await requireAdmin(req);
  const doc = await loadUsers();
  if (req.method === "GET") return { users: list(doc), me: me.id };

  if (body.action === "add") {
    const u = await newUser(body.name, body.role || "member", body.password);
    if (doc.users[u.id]) throw new HttpError(409, "That name is already taken");
    if (Object.keys(doc.users).length >= 50) throw new HttpError(409, "Too many users");
    doc.users[u.id] = u;
  } else {
    const u = doc.users[userId(body.id)];
    if (!u) throw new HttpError(404, "User not found");
    const lastAdmin = u.role === "admin" && activeAdmins(doc).length === 1 && !u.disabled;
    switch (body.action) {
      case "role":
        if (!ROLES.includes(body.role)) throw new HttpError(400, "Unknown role");
        if (lastAdmin && body.role !== "admin") throw new HttpError(409, "Keep at least one admin");
        u.role = body.role;
        u.ver += 1;
        break;
      case "password":
        await setPassword(u, body.password);
        break;
      case "disable":
        if (u.id === me.id) throw new HttpError(409, "You can't disable yourself");
        if (lastAdmin && body.disabled) throw new HttpError(409, "Keep at least one admin");
        u.disabled = !!body.disabled;
        u.ver += 1;
        break;
      case "remove":
        if (u.id === me.id) throw new HttpError(409, "You can't remove yourself");
        if (lastAdmin) throw new HttpError(409, "Keep at least one admin");
        delete doc.users[u.id];
        break;
      default:
        throw new HttpError(400, "Unknown action");
    }
  }
  await saveUsers(doc);
  return { users: list(doc), me: me.id };
});
