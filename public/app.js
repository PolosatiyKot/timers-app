const $ = (sel) => document.querySelector(sel);

let currentRole = null;
let timers = [];
let countdownInterval = null;

const ROLE_LABELS = { admin: "Администратор", user: "Пользователь", viewer: "Наблюдатель" };

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

$("#login-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  try {
    const data = await api("/api/login", {
      method: "POST",
      body: JSON.stringify({
        role: $("#login-role").value,
        password: $("#login-password").value,
      }),
    });
    currentRole = data.role;
    enterApp();
  } catch (err) {
    showAuthError(err.message);
  }
});

$("#logout-btn").addEventListener("click", async () => {
  await api("/api/logout", { method: "POST" });
  currentRole = null;
  clearInterval(countdownInterval);
  $("#main-screen").classList.add("hidden");
  $("#auth-screen").classList.remove("hidden");
});

// ---------- app screen ----------

function enterApp() {
  $("#auth-screen").classList.add("hidden");
  $("#main-screen").classList.remove("hidden");
  $("#whoami").textContent = ROLE_LABELS[currentRole] || currentRole;
  $("#admin-btn").classList.toggle("hidden", currentRole !== "admin");
  $("#add-timer-btn").classList.toggle("hidden", currentRole === "viewer");
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
    if (currentRole !== "viewer") {
      card.addEventListener("click", () => openTimerModal(t));
    }
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

// ---------- admin: password management ----------

$("#admin-btn").addEventListener("click", () => {
  renderRolesList();
  $("#admin-modal").classList.remove("hidden");
});
$("#admin-close").addEventListener("click", () => $("#admin-modal").classList.add("hidden"));

function renderRolesList() {
  const list = $("#roles-list");
  list.innerHTML = "";
  for (const role of ["admin", "user", "viewer"]) {
    const row = document.createElement("div");
    row.className = "user-row";
    row.innerHTML = `
      <span>${ROLE_LABELS[role]}</span>
      <span class="row-actions">
        <button class="secondary" data-role="${role}">Сменить пароль</button>
      </span>
    `;
    row.querySelector("button").addEventListener("click", async () => {
      const newPassword = prompt(`Новый пароль для роли «${ROLE_LABELS[role]}» (минимум 4 символа):`);
      if (!newPassword) return;
      try {
        await api("/api/password", { method: "PUT", body: JSON.stringify({ role, newPassword }) });
        alert("Пароль обновлён. Все, кто был залогинен под этой ролью, вышли из системы.");
      } catch (err) {
        alert(err.message);
      }
    });
    list.appendChild(row);
  }
}

// ---------- boot ----------

(async function init() {
  try {
    const me = await api("/api/me");
    currentRole = me.role;
    enterApp();
  } catch {
    // not logged in — auth screen is shown by default
  }
})();
