const $ = (sel) => document.querySelector(sel);

let currentUser = null;
let timers = [];
let countdownInterval = null;

async function api(path, options = {}) {
  const res = await fetch(path, {
    ...options,
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Request failed");
  return data;
}

// ---------- auth screen ----------

function showAuthError(msg) {
  const el = $("#auth-error");
  el.textContent = msg;
  el.classList.remove("hidden");
}

$("#show-setup").addEventListener("click", (e) => {
  e.preventDefault();
  $("#login-form").classList.add("hidden");
  $("#setup-form").classList.remove("hidden");
  $("#auth-error").classList.add("hidden");
});

$("#show-login").addEventListener("click", (e) => {
  e.preventDefault();
  $("#setup-form").classList.add("hidden");
  $("#login-form").classList.remove("hidden");
  $("#auth-error").classList.add("hidden");
});

$("#login-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  try {
    const data = await api("/api/login", {
      method: "POST",
      body: JSON.stringify({
        username: $("#login-username").value.trim(),
        password: $("#login-password").value,
      }),
    });
    currentUser = { username: data.username, role: data.role };
    enterApp();
  } catch (err) {
    showAuthError(err.message);
  }
});

$("#setup-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  try {
    await api("/api/setup", {
      method: "POST",
      body: JSON.stringify({
        username: $("#setup-username").value.trim(),
        password: $("#setup-password").value,
      }),
    });
    $("#setup-form").classList.add("hidden");
    $("#login-form").classList.remove("hidden");
    showAuthError("Администратор создан. Теперь войдите.");
  } catch (err) {
    showAuthError(err.message);
  }
});

$("#logout-btn").addEventListener("click", async () => {
  await api("/api/logout", { method: "POST" });
  currentUser = null;
  clearInterval(countdownInterval);
  $("#main-screen").classList.add("hidden");
  $("#auth-screen").classList.remove("hidden");
});

// ---------- app screen ----------

function enterApp() {
  $("#auth-screen").classList.add("hidden");
  $("#main-screen").classList.remove("hidden");
  $("#whoami").textContent = `${currentUser.username} (${currentUser.role === "admin" ? "администратор" : "пользователь"})`;
  $("#admin-btn").classList.toggle("hidden", currentUser.role !== "admin");
  loadTimers();
  countdownInterval = setInterval(renderCountdowns, 1000);
}

async function loadTimers() {
  const data = await api("/api/timers");
  timers = data.timers;
  renderTimers();
}

function formatRemaining(ms) {
  if (ms <= 0) return "Время вышло";
  const s = Math.floor(ms / 1000);
  const days = Math.floor(s / 86400);
  const hours = Math.floor((s % 86400) / 3600);
  const mins = Math.floor((s % 3600) / 60);
  const secs = s % 60;
  const pad = (n) => String(n).padStart(2, "0");
  if (days > 0) return `${days}д ${pad(hours)}:${pad(mins)}:${pad(secs)}`;
  return `${pad(hours)}:${pad(mins)}:${pad(secs)}`;
}

function renderTimers() {
  const grid = $("#timers-grid");
  grid.innerHTML = "";
  for (const t of timers) {
    const card = document.createElement("div");
    card.className = "timer-card";
    card.dataset.id = t.id;
    card.innerHTML = `
      <h3>${escapeHtml(t.title)}</h3>
      <div class="desc">${escapeHtml(t.description || "")}</div>
      <div class="countdown" data-target="${t.target_time}"></div>
    `;
    card.addEventListener("click", () => openTimerModal(t));
    grid.appendChild(card);
  }
  renderCountdowns();
}

function renderCountdowns() {
  document.querySelectorAll(".countdown").forEach((el) => {
    const target = new Date(el.dataset.target).getTime();
    const remaining = target - Date.now();
    el.textContent = formatRemaining(remaining);
    el.classList.toggle("expired", remaining <= 0);
  });
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

// ---------- timer modal ----------

function openTimerModal(timer) {
  $("#timer-modal-title").textContent = timer ? "Изменить таймер" : "Новый таймер";
  $("#timer-id").value = timer ? timer.id : "";
  $("#timer-title").value = timer ? timer.title : "";
  $("#timer-description").value = timer ? timer.description || "" : "";
  $("#timer-target").value = timer ? toLocalInputValue(timer.target_time) : "";
  $("#timer-delete").classList.toggle("hidden", !timer);
  $("#timer-modal").classList.remove("hidden");
}

function toLocalInputValue(isoString) {
  const d = new Date(isoString);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

$("#add-timer-btn").addEventListener("click", () => openTimerModal(null));
$("#timer-cancel").addEventListener("click", () => $("#timer-modal").classList.add("hidden"));

$("#timer-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const id = $("#timer-id").value;
  const payload = {
    title: $("#timer-title").value.trim(),
    description: $("#timer-description").value.trim(),
    target_time: new Date($("#timer-target").value).toISOString(),
  };
  if (id) {
    await api(`/api/timers/${id}`, { method: "PUT", body: JSON.stringify(payload) });
  } else {
    await api("/api/timers", { method: "POST", body: JSON.stringify(payload) });
  }
  $("#timer-modal").classList.add("hidden");
  loadTimers();
});

$("#timer-delete").addEventListener("click", async () => {
  const id = $("#timer-id").value;
  if (!id) return;
  if (!confirm("Удалить этот таймер?")) return;
  await api(`/api/timers/${id}`, { method: "DELETE" });
  $("#timer-modal").classList.add("hidden");
  loadTimers();
});

// ---------- admin modal ----------

$("#admin-btn").addEventListener("click", async () => {
  await loadUsers();
  $("#admin-modal").classList.remove("hidden");
});
$("#admin-close").addEventListener("click", () => $("#admin-modal").classList.add("hidden"));

async function loadUsers() {
  const data = await api("/api/users");
  const list = $("#users-list");
  list.innerHTML = "";
  for (const u of data.users) {
    const row = document.createElement("div");
    row.className = "user-row";
    row.innerHTML = `
      <span>${escapeHtml(u.username)} <span class="role-badge">${u.role}</span></span>
      <span class="row-actions">
        <button class="secondary" data-action="reset">Сменить пароль</button>
        <button class="danger" data-action="delete">Удалить</button>
      </span>
    `;
    row.querySelector('[data-action="reset"]').addEventListener("click", async () => {
      const password = prompt(`Новый пароль для ${u.username}:`);
      if (!password) return;
      await api(`/api/users/${u.id}`, { method: "PUT", body: JSON.stringify({ password }) });
      alert("Пароль обновлён");
    });
    row.querySelector('[data-action="delete"]').addEventListener("click", async () => {
      if (!confirm(`Удалить пользователя ${u.username}?`)) return;
      try {
        await api(`/api/users/${u.id}`, { method: "DELETE" });
        loadUsers();
      } catch (err) {
        alert(err.message);
      }
    });
    list.appendChild(row);
  }
}

$("#user-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  try {
    await api("/api/users", {
      method: "POST",
      body: JSON.stringify({
        username: $("#new-username").value.trim(),
        password: $("#new-password").value,
        role: $("#new-role").value,
      }),
    });
    $("#user-form").reset();
    loadUsers();
  } catch (err) {
    alert(err.message);
  }
});

// ---------- boot ----------

(async function init() {
  try {
    const me = await api("/api/me");
    currentUser = me;
    enterApp();
  } catch {
    // not logged in — auth screen is shown by default
  }
})();
