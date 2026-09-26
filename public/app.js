const $ = (sel) => document.querySelector(sel);

let currentRole = null;
let timers = [];
let pollInterval = null;
let tickInterval = null;

const ROLE_LABELS = { admin: "Администратор", user: "Пользователь", viewer: "Наблюдатель" };

const ICON_PLAY = '<svg viewBox="0 0 16 16" width="14" height="14"><polygon points="3,2 14,8 3,14" fill="currentColor"/></svg>';
const ICON_PAUSE = '<svg viewBox="0 0 16 16" width="14" height="14"><rect x="3" y="2" width="3.5" height="12" fill="currentColor"/><rect x="9.5" y="2" width="3.5" height="12" fill="currentColor"/></svg>';
const ICON_STOP = '<svg viewBox="0 0 16 16" width="14" height="14"><rect x="3" y="3" width="10" height="10" fill="currentColor"/></svg>';
const ICON_DELETE = '<svg viewBox="0 0 16 16" width="14" height="14"><path d="M3 4.5h10M6.2 4.5V2.3h3.6v2.2M4.3 4.5l0.8 9.2h5.8l0.8-9.2" stroke="currentColor" stroke-width="1.3" fill="none" stroke-linejoin="round"/></svg>';

async function api(path, options = {}) {
  const res = await fetch(path, {
    ...options,
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Request failed");
  return data;
}

// ---------- auth ----------

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
      body: JSON.stringify({ password: $("#login-password").value }),
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
  clearInterval(pollInterval);
  clearInterval(tickInterval);
  $("#main-screen").classList.add("hidden");
  $("#auth-screen").classList.remove("hidden");
});

// ---------- theme ----------

function applyTheme(theme) {
  document.documentElement.setAttribute("data-theme", theme);
  $("#theme-btn").textContent = theme === "light" ? "🌙" : "☀️";
}

$("#theme-btn").addEventListener("click", () => {
  const current = document.documentElement.getAttribute("data-theme") || "dark";
  const next = current === "dark" ? "light" : "dark";
  localStorage.setItem("theme", next);
  applyTheme(next);
});

applyTheme(localStorage.getItem("theme") || "dark");

// ---------- language (stub) ----------

$("#lang-btn").addEventListener("click", (e) => {
  e.stopPropagation();
  $("#lang-popup").classList.toggle("hidden");
});
document.addEventListener("click", () => $("#lang-popup").classList.add("hidden"));

// ---------- app screen ----------

function enterApp() {
  $("#auth-screen").classList.add("hidden");
  $("#main-screen").classList.remove("hidden");
  $("#whoami").textContent = ROLE_LABELS[currentRole] || currentRole;
  $("#admin-btn").classList.toggle("hidden", currentRole !== "admin");
  loadTimers();
  pollInterval = setInterval(loadTimers, 5000);
  tickInterval = setInterval(tick, 1000);
}

async function loadTimers() {
  const data = await api("/api/timers");
  timers = data.timers;
  renderAll();
}

// ---------- time helpers ----------

function computeRemaining(t, nowMs) {
  if (t.status === "running" && t.target_time) {
    return Math.max(0, Math.round((new Date(t.target_time).getTime() - nowMs) / 1000));
  }
  return t.status === "stopped" ? t.duration_seconds : t.remaining_seconds;
}

function computeEndDate(t, nowMs) {
  if (t.status === "running" && t.target_time) return new Date(t.target_time);
  const remaining = t.status === "stopped" ? t.duration_seconds : t.remaining_seconds;
  return new Date(nowMs + remaining * 1000);
}

function formatCountdown(totalSeconds) {
  if (totalSeconds <= 0) return "Время вышло";
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const mins = Math.floor((totalSeconds % 3600) / 60);
  const secs = totalSeconds % 60;
  const pad = (n) => String(n).padStart(2, "0");
  return `${days}д ${pad(hours)}:${pad(mins)}:${pad(secs)}`;
}

function formatDateTime(date) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${pad(date.getDate())}.${pad(date.getMonth() + 1)}.${date.getFullYear()} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function secondsToDHMS(totalSeconds) {
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const mins = Math.floor((totalSeconds % 3600) / 60);
  const secs = totalSeconds % 60;
  return { days, hours, mins, secs };
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str || "";
  return div.innerHTML;
}

// ---------- rendering ----------

function renderAll() {
  const grid = $("#timers-grid");
  const now = Date.now();
  const sorted = [...timers].sort((a, b) => computeRemaining(a, now) - computeRemaining(b, now));

  grid.innerHTML = "";
  for (const t of sorted) {
    grid.appendChild(buildCard(t));
  }

  if (currentRole !== "viewer") {
    grid.appendChild(buildAddTile());
  }

  tick();
}

function buildAddTile() {
  const tile = document.createElement("div");
  tile.className = "add-tile";
  tile.innerHTML = `<div class="add-plus">+</div><div>Добавить таймер</div>`;
  tile.addEventListener("click", async () => {
    await api("/api/timers", { method: "POST" });
    await loadTimers();
  });
  return tile;
}

function buildCard(t) {
  const readOnly = currentRole === "viewer";
  const dhms = secondsToDHMS(t.duration_seconds);
  const disabledDuration = t.status !== "stopped" || readOnly;

  const card = document.createElement("div");
  card.className = "timer-card";
  card.dataset.id = t.id;

  card.innerHTML = `
    <label>Описание
      <input class="f-description" ${readOnly ? "disabled" : ""} value="${escapeHtml(t.description)}" />
    </label>
    <div class="row">
      <label>Система
        <input class="f-system" ${readOnly ? "disabled" : ""} value="${escapeHtml(t.system)}" />
      </label>
      <label>Игрок
        <input class="f-player" ${readOnly ? "disabled" : ""} value="${escapeHtml(t.player)}" />
      </label>
    </div>
    <label>EVE time
      <input class="f-eve" ${readOnly ? "disabled" : ""} value="${escapeHtml(t.eve_time)}" placeholder="дата/время начала" />
    </label>

    <div class="countdown" data-status="${t.status}"></div>

    <div class="duration-grid">
      <label>Дни<input type="number" min="0" class="f-days" value="${dhms.days}" ${disabledDuration ? "disabled" : ""} /></label>
      <label>Часы<input type="number" min="0" max="23" class="f-hours" value="${dhms.hours}" ${disabledDuration ? "disabled" : ""} /></label>
      <label>Минуты<input type="number" min="0" max="59" class="f-mins" value="${dhms.mins}" ${disabledDuration ? "disabled" : ""} /></label>
      <label>Секунды<input type="number" min="0" max="59" class="f-secs" value="${dhms.secs}" ${disabledDuration ? "disabled" : ""} /></label>
    </div>

    <div class="end-time">Окончание: <span class="end-time-value"></span></div>

    ${
      readOnly
        ? ""
        : `<div class="card-actions">
        <button class="icon-action start" title="Старт">${ICON_PLAY}</button>
        <button class="icon-action pause" title="Пауза">${t.status === "paused" ? ICON_PLAY : ICON_PAUSE}</button>
        <button class="icon-action stop" title="Стоп (сброс)">${ICON_STOP}</button>
        <button class="icon-action delete danger" title="Удалить">${ICON_DELETE}</button>
      </div>`
    }
  `;

  if (!readOnly) {
    bindCardEvents(card, t);
  }

  return card;
}

function bindCardEvents(card, t) {
  const id = t.id;

  const saveField = async (fields) => {
    await api(`/api/timers/${id}`, { method: "PUT", body: JSON.stringify(fields) });
    Object.assign(t, fields);
  };

  card.querySelector(".f-description").addEventListener("change", (e) => saveField({ description: e.target.value }));
  card.querySelector(".f-system").addEventListener("change", (e) => saveField({ system: e.target.value }));
  card.querySelector(".f-player").addEventListener("change", (e) => saveField({ player: e.target.value }));
  card.querySelector(".f-eve").addEventListener("change", (e) => saveField({ eve_time: e.target.value }));

  const durationInputs = [".f-days", ".f-hours", ".f-mins", ".f-secs"].map((sel) => card.querySelector(sel));
  const onDurationChange = async () => {
    const [days, hours, mins, secs] = durationInputs.map((el) => Math.max(0, parseInt(el.value, 10) || 0));
    const duration_seconds = days * 86400 + hours * 3600 + mins * 60 + secs;
    await saveField({ duration_seconds });
    t.remaining_seconds = duration_seconds;
    tick();
  };
  durationInputs.forEach((el) => el.addEventListener("change", onDurationChange));

  card.querySelector(".start").addEventListener("click", async () => {
    await api(`/api/timers/${id}/start`, { method: "PUT" });
    await loadTimers();
  });
  card.querySelector(".pause").addEventListener("click", async () => {
    await api(`/api/timers/${id}/pause`, { method: "PUT" });
    await loadTimers();
  });
  card.querySelector(".stop").addEventListener("click", async () => {
    await api(`/api/timers/${id}/stop`, { method: "PUT" });
    await loadTimers();
  });
  card.querySelector(".delete").addEventListener("click", async () => {
    if (!confirm("Удалить этот таймер?")) return;
    await api(`/api/timers/${id}`, { method: "DELETE" });
    await loadTimers();
  });
}

// ---------- tick: live countdown + reordering, no DOM rebuild ----------

function tick() {
  const now = Date.now();
  const grid = $("#timers-grid");
  if (!grid) return;

  const cards = [...grid.querySelectorAll(".timer-card")];
  const withRemaining = cards
    .map((card) => {
      const t = timers.find((x) => String(x.id) === card.dataset.id);
      if (!t) return null;
      return { card, remaining: computeRemaining(t, now), t };
    })
    .filter(Boolean);

  withRemaining.sort((a, b) => a.remaining - b.remaining);

  for (const { card, remaining, t } of withRemaining) {
    const countdownEl = card.querySelector(".countdown");
    if (countdownEl) {
      countdownEl.textContent = formatCountdown(remaining);
      countdownEl.classList.toggle("expired", remaining <= 0 && t.status === "running");
      countdownEl.dataset.status = t.status;
    }
    const endEl = card.querySelector(".end-time-value");
    if (endEl) endEl.textContent = formatDateTime(computeEndDate(t, now));

    const pauseBtn = card.querySelector(".pause");
    if (pauseBtn) pauseBtn.innerHTML = t.status === "paused" ? ICON_PLAY : ICON_PAUSE;

    grid.appendChild(card); // reorder without recreating (preserves focus/values)
  }

  const addTile = grid.querySelector(".add-tile");
  if (addTile) grid.appendChild(addTile);
}

// ---------- admin: settings / role passwords ----------

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
    // not logged in
  }
})();
