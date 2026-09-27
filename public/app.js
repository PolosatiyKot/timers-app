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
  pollInterval = setInterval(syncTimers, 5000);
  tickInterval = setInterval(tick, 1000);
}

// Full destructive reload: only used on initial load and right after an
// action we initiated locally (create/delete), when a full rebuild is safe.
async function loadTimers() {
  const data = await api("/api/timers");
  timers = data.timers;
  renderAll();
}

// Background refresh: merges remote data (so other users' start/pause/stop
// show up) WITHOUT ever rebuilding the DOM or touching input values, so it
// never interrupts someone who is currently typing in a field.
let syncing = false;
async function syncTimers() {
  if (syncing) return;
  syncing = true;
  try {
    const data = await api("/api/timers");
    const newTimers = data.timers;

    const oldIds = timers.map((t) => t.id).sort().join(",");
    const newIds = newTimers.map((t) => t.id).sort().join(",");

    if (oldIds !== newIds) {
      // A timer was added/removed elsewhere — safe to fully rebuild.
      timers = newTimers;
      renderAll();
      return;
    }

    for (const nt of newTimers) {
      const existing = timers.find((t) => t.id === nt.id);
      if (existing) Object.assign(existing, nt);
    }

    for (const t of timers) {
      const card = document.querySelector(`.timer-card[data-id="${t.id}"]`);
      if (card) updateCardControlState(card, t);
    }
    tick();
  } finally {
    syncing = false;
  }
}

// ---------- time helpers ----------

function computeRemaining(t, nowMs) {
  if (t.status === "running" && t.target_time) {
    return Math.max(0, Math.round((new Date(t.target_time).getTime() - nowMs) / 1000));
  }
  return t.status === "stopped" ? t.duration_seconds : t.remaining_seconds;
}

function parseEveTime(str) {
  if (!str) return null;
  const d = new Date(str);
  return isNaN(d.getTime()) ? null : d;
}

// End time depends only on the EVE start time and the set duration —
// never on the device/network clock — so it does not tick every second.
function computeEndDate(t) {
  const start = parseEveTime(t.eve_time);
  if (!start) return null;
  return new Date(start.getTime() + t.duration_seconds * 1000);
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

function formatEndTime(date) {
  return date ? formatDateTime(date) : "—";
}

// Patches only the bits of a card that reflect timer status (icon, disabled
// duration inputs, end-time text) — never touches text/EVE/duration input
// values, so it's safe to call from the background sync while someone types.
function updateCardControlState(card, t) {
  const pauseBtn = card.querySelector(".pause");
  if (pauseBtn) pauseBtn.innerHTML = t.status === "paused" ? ICON_PLAY : ICON_PAUSE;

  const countdownEl = card.querySelector(".countdown");
  if (countdownEl) countdownEl.dataset.status = t.status;

  const disable = t.status !== "stopped";
  card.querySelectorAll(".duration-grid input").forEach((el) => {
    if (document.activeElement !== el) el.disabled = disable;
  });

  const endEl = card.querySelector(".end-time-value");
  if (endEl) endEl.textContent = formatEndTime(computeEndDate(t));
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

function splitEveTime(str) {
  const m = str && str.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/);
  if (!m) return { y: "", mo: "", d: "", h: "", mi: "" };
  return { y: m[1], mo: m[2], d: m[3], h: m[4], mi: m[5] };
}

function pad2(v) {
  return v.length === 1 ? "0" + v : v;
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
    try {
      await api("/api/timers", { method: "POST" });
      await loadTimers();
    } catch (err) {
      alert("Не удалось добавить таймер: " + err.message);
    }
  });
  return tile;
}

function buildCard(t) {
  const readOnly = currentRole === "viewer";
  const dhms = secondsToDHMS(t.duration_seconds);
  const disabledDuration = t.status !== "stopped" || readOnly;
  const eve = splitEveTime(t.eve_time);
  const dis = readOnly ? "disabled" : "";

  const card = document.createElement("div");
  card.className = "timer-card";
  card.dataset.id = t.id;

  card.innerHTML = `
    <label>Описание
      <input class="f-description" ${dis} value="${escapeHtml(t.description)}" />
    </label>
    <div class="row">
      <label>Система
        <input class="f-system" ${dis} value="${escapeHtml(t.system)}" />
      </label>
      <label>Игрок
        <input class="f-player" ${dis} value="${escapeHtml(t.player)}" />
      </label>
    </div>

    <div class="eve-label">EVE time</div>
    <div class="eve-grid">
      <input class="f-eve-y" ${dis} inputmode="numeric" maxlength="4" placeholder="YYYY" value="${eve.y}" />
      <input class="f-eve-mo" ${dis} inputmode="numeric" maxlength="2" placeholder="MM" value="${eve.mo}" />
      <input class="f-eve-d" ${dis} inputmode="numeric" maxlength="2" placeholder="DD" value="${eve.d}" />
      <input class="f-eve-h" ${dis} inputmode="numeric" maxlength="2" placeholder="HH" value="${eve.h}" />
      <input class="f-eve-mi" ${dis} inputmode="numeric" maxlength="2" placeholder="MM" value="${eve.mi}" />
    </div>

    <div class="countdown" data-status="${t.status}"></div>

    <div class="duration-grid">
      <label>Дни<input type="number" min="0" class="f-days" value="${dhms.days}" ${disabledDuration ? "disabled" : ""} /></label>
      <label>Часы<input type="number" min="0" max="23" class="f-hours" value="${dhms.hours}" ${disabledDuration ? "disabled" : ""} /></label>
      <label>Минуты<input type="number" min="0" max="59" class="f-mins" value="${dhms.mins}" ${disabledDuration ? "disabled" : ""} /></label>
      <label>Секунды<input type="number" min="0" max="59" class="f-secs" value="${dhms.secs}" ${disabledDuration ? "disabled" : ""} /></label>
    </div>

    <div class="end-time">Окончание: <span class="end-time-value">${formatEndTime(computeEndDate(t))}</span></div>

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

  const refreshEndTime = () => {
    card.querySelector(".end-time-value").textContent = formatEndTime(computeEndDate(t));
  };

  const saveField = async (fields) => {
    await api(`/api/timers/${id}`, { method: "PUT", body: JSON.stringify(fields) });
    Object.assign(t, fields);
  };

  card.querySelector(".f-description").addEventListener("change", (e) => saveField({ description: e.target.value }));
  card.querySelector(".f-system").addEventListener("change", (e) => saveField({ system: e.target.value }));
  card.querySelector(".f-player").addEventListener("change", (e) => saveField({ player: e.target.value }));

  // EVE time: 5 separate fields (year/month/day/hour/minute), no seconds.
  const eveY = card.querySelector(".f-eve-y");
  const eveMo = card.querySelector(".f-eve-mo");
  const eveD = card.querySelector(".f-eve-d");
  const eveH = card.querySelector(".f-eve-h");
  const eveMi = card.querySelector(".f-eve-mi");

  const onEveChange = async () => {
    [eveMo, eveD, eveH, eveMi].forEach((el) => {
      if (el.value) el.value = pad2(el.value);
    });
    // Year is kept exactly as typed (1–4 digits), never auto-padded.

    const filled = [eveY.value, eveMo.value, eveD.value, eveH.value, eveMi.value];
    const eve_time = filled.every((v) => v !== "")
      ? `${filled[0]}-${filled[1]}-${filled[2]}T${filled[3]}:${filled[4]}`
      : "";

    await saveField({ eve_time });
    refreshEndTime();
  };
  [eveY, eveMo, eveD, eveH, eveMi].forEach((el) => el.addEventListener("change", onEveChange));

  const durationInputs = [".f-days", ".f-hours", ".f-mins", ".f-secs"].map((sel) => card.querySelector(sel));
  const readDurationSeconds = () => {
    const [days, hours, mins, secs] = durationInputs.map((el) => Math.max(0, parseInt(el.value, 10) || 0));
    return days * 86400 + hours * 3600 + mins * 60 + secs;
  };
  const onDurationChange = async () => {
    const duration_seconds = readDurationSeconds();
    await saveField({ duration_seconds });
    t.remaining_seconds = duration_seconds;
    refreshEndTime();
    tick();
  };
  durationInputs.forEach((el) => el.addEventListener("change", onDurationChange));

  card.querySelector(".start").addEventListener("click", async () => {
    try {
      // Save the currently displayed duration first so Start can never race
      // against a still-pending autosave and use a stale (e.g. 0) value.
      const duration_seconds = readDurationSeconds();
      await saveField({ duration_seconds });
      await api(`/api/timers/${id}/start`, { method: "PUT" });
      t.status = "running";
      t.remaining_seconds = duration_seconds;
      t.target_time = new Date(Date.now() + duration_seconds * 1000).toISOString();
      updateCardControlState(card, t);
      tick();
    } catch (err) {
      alert("Ошибка: " + err.message);
    }
  });
  card.querySelector(".pause").addEventListener("click", async () => {
    try {
      await api(`/api/timers/${id}/pause`, { method: "PUT" });
      if (t.status === "running") {
        t.remaining_seconds = computeRemaining(t, Date.now());
        t.status = "paused";
        t.target_time = null;
      } else if (t.status === "paused") {
        t.target_time = new Date(Date.now() + t.remaining_seconds * 1000).toISOString();
        t.status = "running";
      }
      updateCardControlState(card, t);
      tick();
    } catch (err) {
      alert("Ошибка: " + err.message);
    }
  });
  card.querySelector(".stop").addEventListener("click", async () => {
    try {
      await api(`/api/timers/${id}/stop`, { method: "PUT" });
      t.remaining_seconds = t.duration_seconds;
      t.status = "stopped";
      t.target_time = null;
      updateCardControlState(card, t);
      tick();
    } catch (err) {
      alert("Ошибка: " + err.message);
    }
  });
  card.querySelector(".delete").addEventListener("click", async () => {
    try {
      await api(`/api/timers/${id}`, { method: "DELETE" });
      timers = timers.filter((x) => x.id !== id);
      card.remove();
    } catch (err) {
      alert("Ошибка: " + err.message);
    }
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
    }
    updateCardControlState(card, t);
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
      <span class="role-name">${ROLE_LABELS[role]}</span>
      <input type="text" class="new-password-input" placeholder="Новый пароль" />
      <button class="secondary change-password-btn">Сменить пароль</button>
    `;
    const input = row.querySelector(".new-password-input");
    row.querySelector(".change-password-btn").addEventListener("click", async () => {
      const newPassword = input.value.trim();
      if (!newPassword) return;
      try {
        await api("/api/password", { method: "PUT", body: JSON.stringify({ role, newPassword }) });
        input.value = "";
        input.placeholder = "Пароль обновлён";
      } catch (err) {
        input.placeholder = err.message;
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
