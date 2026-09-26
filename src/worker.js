// ---------- helpers ----------

function jsonRes(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=UTF-8", ...extraHeaders },
  });
}

function bytesToHex(buf) {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function randomToken(len = 32) {
  const arr = new Uint8Array(len);
  crypto.getRandomValues(arr);
  return bytesToHex(arr);
}

async function hashPassword(password, salt) {
  const data = new TextEncoder().encode(salt + ":" + password);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return bytesToHex(digest);
}

function getCookie(request, name) {
  const header = request.headers.get("Cookie") || "";
  const match = header.match(new RegExp("(?:^|;\\s*)" + name + "=([^;]*)"));
  return match ? decodeURIComponent(match[1]) : null;
}

function sessionCookie(token, maxAgeSeconds) {
  return `session=${token}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${maxAgeSeconds}`;
}

const SESSION_DAYS = 30;
const ROLES = ["admin", "user", "viewer"];

// Seed the accounts table from Cloudflare secrets the very first time the
// worker is called after a fresh deploy. Safe to run on every request:
// it's a no-op once accounts already exist.
async function ensureSeeded(env) {
  const { c } = await env.DB.prepare("SELECT COUNT(*) AS c FROM accounts").first();
  if (c > 0) return;

  const initial = {
    admin: env.INITIAL_ADMIN_PASSWORD,
    user: env.INITIAL_USER_PASSWORD,
    viewer: env.INITIAL_VIEWER_PASSWORD,
  };

  for (const role of ROLES) {
    const password = initial[role];
    if (!password) continue; // that role just won't be usable until a secret is set + redeployed
    const salt = randomToken(16);
    const hash = await hashPassword(password, salt);
    await env.DB.prepare(
      "INSERT OR IGNORE INTO accounts (role, password_hash, salt) VALUES (?, ?, ?)"
    )
      .bind(role, hash, salt)
      .run();
  }
}

async function getSessionRole(request, env) {
  const token = getCookie(request, "session");
  if (!token) return null;
  const row = await env.DB.prepare(
    "SELECT role FROM sessions WHERE token = ? AND expires_at > datetime('now')"
  )
    .bind(token)
    .first();
  return row ? row.role : null;
}

// ---------- route handlers ----------

async function handleLogin(request, env) {
  const { password } = await request.json();
  if (!password) return jsonRes({ error: "Введите пароль" }, 400);

  const { results: accounts } = await env.DB.prepare("SELECT * FROM accounts").all();

  let matchedRole = null;
  for (const account of accounts) {
    const hash = await hashPassword(password, account.salt);
    if (hash === account.password_hash) {
      matchedRole = account.role;
      break;
    }
  }

  if (!matchedRole) return jsonRes({ error: "Неверный пароль" }, 401);

  const token = randomToken(32);
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 86400 * 1000).toISOString();
  await env.DB.prepare("INSERT INTO sessions (token, role, expires_at) VALUES (?, ?, ?)")
    .bind(token, matchedRole, expiresAt)
    .run();

  return jsonRes(
    { ok: true, role: matchedRole },
    200,
    { "Set-Cookie": sessionCookie(token, SESSION_DAYS * 86400) }
  );
}

async function handleLogout(request, env) {
  const token = getCookie(request, "session");
  if (token) await env.DB.prepare("DELETE FROM sessions WHERE token = ?").bind(token).run();
  return jsonRes({ ok: true }, 200, { "Set-Cookie": "session=; HttpOnly; Path=/; Max-Age=0" });
}

async function handleChangePassword(request, env, currentRole) {
  if (currentRole !== "admin") return jsonRes({ error: "Только администратор может менять пароли" }, 403);

  const { role, newPassword } = await request.json();
  if (!ROLES.includes(role) || !newPassword || newPassword.length < 4) {
    return jsonRes({ error: "Некорректная роль или пароль (минимум 4 символа)" }, 400);
  }

  const salt = randomToken(16);
  const hash = await hashPassword(newPassword, salt);
  await env.DB.prepare(
    "INSERT INTO accounts (role, password_hash, salt, updated_at) VALUES (?, ?, ?, datetime('now')) " +
      "ON CONFLICT(role) DO UPDATE SET password_hash = excluded.password_hash, salt = excluded.salt, updated_at = datetime('now')"
  )
    .bind(role, hash, salt)
    .run();

  // Changing a role's password invalidates existing sessions for that role.
  await env.DB.prepare("DELETE FROM sessions WHERE role = ?").bind(role).run();

  return jsonRes({ ok: true });
}

async function handleGetTimers(env) {
  const { results } = await env.DB.prepare(
    "SELECT id, title, description, target_time, created_by FROM timers ORDER BY target_time ASC"
  ).all();
  return jsonRes({ timers: results });
}

async function handleCreateTimer(request, env, role) {
  const { title, description, target_time } = await request.json();
  if (!title || !target_time) return jsonRes({ error: "title and target_time are required" }, 400);
  const res = await env.DB.prepare(
    "INSERT INTO timers (title, description, target_time, created_by) VALUES (?, ?, ?, ?)"
  )
    .bind(title, description || "", target_time, role)
    .run();
  return jsonRes({ ok: true, id: res.meta.last_row_id });
}

async function handleUpdateTimer(request, env, id) {
  const { title, description, target_time } = await request.json();
  if (!title || !target_time) return jsonRes({ error: "title and target_time are required" }, 400);
  await env.DB.prepare("UPDATE timers SET title = ?, description = ?, target_time = ? WHERE id = ?")
    .bind(title, description || "", target_time, id)
    .run();
  return jsonRes({ ok: true });
}

async function handleDeleteTimer(env, id) {
  await env.DB.prepare("DELETE FROM timers WHERE id = ?").bind(id).run();
  return jsonRes({ ok: true });
}

// ---------- router ----------

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

    if (!path.startsWith("/api/")) {
      return new Response("Not found", { status: 404 });
    }

    try {
      await ensureSeeded(env);

      if (path === "/api/login" && method === "POST") return await handleLogin(request, env);
      if (path === "/api/logout" && method === "POST") return await handleLogout(request, env);

      // everything below requires a logged-in role
      const role = await getSessionRole(request, env);
      if (!role) return jsonRes({ error: "Not authenticated" }, 401);

      if (path === "/api/me" && method === "GET") return jsonRes({ role });

      if (path === "/api/timers" && method === "GET") return await handleGetTimers(env);

      if (path === "/api/timers" && method === "POST") {
        if (role === "viewer") return jsonRes({ error: "Наблюдателю нельзя создавать таймеры" }, 403);
        return await handleCreateTimer(request, env, role);
      }

      const timerMatch = path.match(/^\/api\/timers\/(\d+)$/);
      if (timerMatch) {
        if (role === "viewer") return jsonRes({ error: "Наблюдателю нельзя изменять таймеры" }, 403);
        const id = timerMatch[1];
        if (method === "PUT") return await handleUpdateTimer(request, env, id);
        if (method === "DELETE") return await handleDeleteTimer(env, id);
      }

      if (path === "/api/password" && method === "PUT") {
        return await handleChangePassword(request, env, role);
      }

      return jsonRes({ error: "Not found" }, 404);
    } catch (err) {
      return jsonRes({ error: err.message || "Internal error" }, 500);
    }
  },
};
