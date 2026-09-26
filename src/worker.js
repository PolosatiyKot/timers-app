// ---------- helpers ----------

function json(data, status = 200, extraHeaders = {}) {
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

async function getSessionUser(request, env) {
  const token = getCookie(request, "session");
  if (!token) return null;
  const row = await env.DB.prepare(
    `SELECT users.id, users.username, users.role
     FROM sessions JOIN users ON sessions.user_id = users.id
     WHERE sessions.token = ? AND sessions.expires_at > datetime('now')`
  )
    .bind(token)
    .first();
  return row || null;
}

// ---------- route handlers ----------

async function handleSetup(request, env) {
  const { c: userCount } = await env.DB.prepare("SELECT COUNT(*) AS c FROM users").first();
  if (userCount > 0) return json({ error: "Already initialized" }, 403);

  const { username, password } = await request.json();
  if (!username || !password) return json({ error: "username and password are required" }, 400);

  const salt = randomToken(16);
  const hash = await hashPassword(password, salt);
  await env.DB.prepare(
    "INSERT INTO users (username, password_hash, salt, role) VALUES (?, ?, ?, 'admin')"
  )
    .bind(username, hash, salt)
    .run();

  return json({ ok: true, message: "Admin account created. You can now log in." });
}

async function handleLogin(request, env) {
  const { username, password } = await request.json();
  if (!username || !password) return json({ error: "username and password are required" }, 400);

  const user = await env.DB.prepare("SELECT * FROM users WHERE username = ?").bind(username).first();
  if (!user) return json({ error: "Invalid credentials" }, 401);

  const hash = await hashPassword(password, user.salt);
  if (hash !== user.password_hash) return json({ error: "Invalid credentials" }, 401);

  const token = randomToken(32);
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 86400 * 1000).toISOString();
  await env.DB.prepare("INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)")
    .bind(token, user.id, expiresAt)
    .run();

  return json(
    { ok: true, username: user.username, role: user.role },
    200,
    { "Set-Cookie": sessionCookie(token, SESSION_DAYS * 86400) }
  );
}

async function handleLogout(request, env) {
  const token = getCookie(request, "session");
  if (token) await env.DB.prepare("DELETE FROM sessions WHERE token = ?").bind(token).run();
  return json({ ok: true }, 200, { "Set-Cookie": "session=; HttpOnly; Path=/; Max-Age=0" });
}

async function handleGetTimers(env) {
  const { results } = await env.DB.prepare(
    "SELECT id, title, description, target_time, created_by FROM timers ORDER BY target_time ASC"
  ).all();
  return json({ timers: results });
}

async function handleCreateTimer(request, env, user) {
  const { title, description, target_time } = await request.json();
  if (!title || !target_time) return json({ error: "title and target_time are required" }, 400);
  const res = await env.DB.prepare(
    "INSERT INTO timers (title, description, target_time, created_by) VALUES (?, ?, ?, ?)"
  )
    .bind(title, description || "", target_time, user.id)
    .run();
  return json({ ok: true, id: res.meta.last_row_id });
}

async function handleUpdateTimer(request, env, id) {
  const { title, description, target_time } = await request.json();
  if (!title || !target_time) return json({ error: "title and target_time are required" }, 400);
  await env.DB.prepare(
    "UPDATE timers SET title = ?, description = ?, target_time = ? WHERE id = ?"
  )
    .bind(title, description || "", target_time, id)
    .run();
  return json({ ok: true });
}

async function handleDeleteTimer(env, id) {
  await env.DB.prepare("DELETE FROM timers WHERE id = ?").bind(id).run();
  return json({ ok: true });
}

async function handleListUsers(env) {
  const { results } = await env.DB.prepare(
    "SELECT id, username, role, created_at FROM users ORDER BY created_at ASC"
  ).all();
  return json({ users: results });
}

async function handleCreateUser(request, env) {
  const { username, password, role } = await request.json();
  if (!username || !password) return json({ error: "username and password are required" }, 400);
  const existing = await env.DB.prepare("SELECT id FROM users WHERE username = ?").bind(username).first();
  if (existing) return json({ error: "Username already exists" }, 409);
  const salt = randomToken(16);
  const hash = await hashPassword(password, salt);
  await env.DB.prepare("INSERT INTO users (username, password_hash, salt, role) VALUES (?, ?, ?, ?)")
    .bind(username, hash, salt, role === "admin" ? "admin" : "user")
    .run();
  return json({ ok: true });
}

async function handleUpdateUser(request, env, id) {
  const { password, role } = await request.json();
  if (password) {
    const salt = randomToken(16);
    const hash = await hashPassword(password, salt);
    await env.DB.prepare("UPDATE users SET password_hash = ?, salt = ? WHERE id = ?").bind(hash, salt, id).run();
  }
  if (role === "admin" || role === "user") {
    await env.DB.prepare("UPDATE users SET role = ? WHERE id = ?").bind(role, id).run();
  }
  return json({ ok: true });
}

async function handleDeleteUser(env, id, currentUser) {
  if (String(currentUser.id) === String(id)) {
    return json({ error: "You cannot delete your own account" }, 400);
  }
  await env.DB.prepare("DELETE FROM users WHERE id = ?").bind(id).run();
  return json({ ok: true });
}

// ---------- router ----------

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

    if (!path.startsWith("/api/")) {
      // Anything else is a static asset served by the [assets] binding;
      // if we get here it means no asset matched.
      return new Response("Not found", { status: 404 });
    }

    try {
      if (path === "/api/setup" && method === "POST") return await handleSetup(request, env);
      if (path === "/api/login" && method === "POST") return await handleLogin(request, env);
      if (path === "/api/logout" && method === "POST") return await handleLogout(request, env);

      // everything below requires a logged-in user
      const user = await getSessionUser(request, env);
      if (!user) return json({ error: "Not authenticated" }, 401);

      if (path === "/api/me" && method === "GET") {
        return json({ username: user.username, role: user.role });
      }

      if (path === "/api/timers" && method === "GET") return await handleGetTimers(env);
      if (path === "/api/timers" && method === "POST") return await handleCreateTimer(request, env, user);

      const timerMatch = path.match(/^\/api\/timers\/(\d+)$/);
      if (timerMatch) {
        const id = timerMatch[1];
        if (method === "PUT") return await handleUpdateTimer(request, env, id);
        if (method === "DELETE") return await handleDeleteTimer(env, id);
      }

      // admin-only user management
      if (path === "/api/users" && method === "GET") {
        if (user.role !== "admin") return json({ error: "Forbidden" }, 403);
        return await handleListUsers(env);
      }
      if (path === "/api/users" && method === "POST") {
        if (user.role !== "admin") return json({ error: "Forbidden" }, 403);
        return await handleCreateUser(request, env);
      }

      const userMatch = path.match(/^\/api\/users\/(\d+)$/);
      if (userMatch) {
        if (user.role !== "admin") return json({ error: "Forbidden" }, 403);
        const id = userMatch[1];
        if (method === "PUT") return await handleUpdateUser(request, env, id);
        if (method === "DELETE") return await handleDeleteUser(env, id, user);
      }

      return json({ error: "Not found" }, 404);
    } catch (err) {
      return json({ error: err.message || "Internal error" }, 500);
    }
  },
};
