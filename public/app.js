/**
 * TennisPro Booking — Frontend Application  v1.2.0
 *
 * Architecture: single-page app, no framework.
 * State is mutated in the `S` object; render functions read from it and
 * write to the DOM.  All API calls go through the `api` helper object.
 *
 * Section index:
 *   1. Constants
 *   2. Application State
 *   3. Utility Helpers
 *   4. HTTP API
 *   5. Toast Notifications
 *   6. Confirm Modal  ← singleton, event listeners wired ONCE at init
 *   7. Dark Mode
 *   8. Router (render)
 *   9. Login View
 *  10. Navigation Bar
 *  11. Sidebar + Mini Calendar
 *  12. Scheduler View + Grid
 *  13. Admin Panel  ← includes user management
 *  14. System Info
 *  15. WebSocket (real-time)
 *  16. Bootstrap (app entry point)
 */

'use strict';

// ── 1. Constants ─────────────────────────────────────────────────────────────

/** Bookable hours: 07:00 – 21:00 (last slot ends at 22:00) */
const HOURS = Array.from({ length: 15 }, (_, i) => i + 7);


// ── 2. Application State ─────────────────────────────────────────────────────

const S = {
  user:      null,          // {id, name, email, role} — null when logged out
  courts:    [],            // [{id, name}] — loaded once after login
  bookings:  [],            // [{id, court_id, user_id, date, ...}] for selDate
  view:      'scheduler',   // 'scheduler' | 'admin' | 'sysinfo'
  adminTab:  'users',       // 'users' | 'bookings' | 'courts'
  adminData: { users: [], bookings: [] },
  sysinfoData: null,
  calDate:   new Date(),
  selDate:   todayStr(),
  darkMode:  initDarkMode(),
  ws:        null,          // WebSocket instance
};

function initDarkMode() {
  const saved = localStorage.getItem('dark');
  if (saved === '1') return true;
  if (saved === '0') return false;
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}


// ── 3. Utility Helpers ───────────────────────────────────────────────────────

function todayStr() { return fmtDate(new Date()); }

function fmtDate(d) {
  const y  = d.getFullYear();
  const m  = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

function fmtHour(h) { return `${String(h).padStart(2, '0')}:00`; }

function fmtDateNO(dateStr) {
  const d = new Date(dateStr + 'T12:00:00');
  return d.toLocaleDateString('nb-NO', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function fmtDateLongNO(dateStr) {
  const d = new Date(dateStr + 'T12:00:00');
  return d.toLocaleDateString('nb-NO', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
}

/**
 * Parses a SQLite DATETIME string ("YYYY-MM-DD HH:MM:SS") safely across all
 * browsers including Safari, which requires ISO 8601 "T" separator.
 */
function parseSQLiteDate(str) {
  if (!str) return new Date(NaN);
  return new Date(str.replace(' ', 'T'));
}

function isPast(dateStr, hour) {
  const slot = new Date(`${dateStr}T${String(hour).padStart(2, '0')}:00:00`);
  return slot < new Date();
}

function escHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function initials(name) {
  return name.split(' ').slice(0, 2).map(w => w[0]?.toUpperCase() ?? '').join('');
}


// ── 4. HTTP API ──────────────────────────────────────────────────────────────

async function apiFetch(url, opts = {}) {
  const r = await fetch(url, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
  });
  let data;
  try {
    data = await r.json();
  } catch {
    throw new Error(`Server error (${r.status})`);
  }
  if (!r.ok) throw new Error(data.error || 'Request failed');
  return data;
}

const api = {
  // Auth
  login:   (email, password) => apiFetch('/api/login',  { method: 'POST', body: JSON.stringify({ email, password }) }),
  logout:  ()                => apiFetch('/api/logout',  { method: 'POST' }),
  me:      ()                => apiFetch('/api/me'),

  // Data
  courts:  ()                             => apiFetch('/api/courts'),
  bookings:(date)                         => apiFetch(`/api/bookings?date=${date}`),
  book:    (court_id, date, start_hour)   => apiFetch('/api/bookings', { method: 'POST', body: JSON.stringify({ court_id, date, start_hour }) }),
  edit:    (id, court_id, date, start_hour) => apiFetch(`/api/bookings/${id}`, { method: 'PUT',  body: JSON.stringify({ court_id, date, start_hour }) }),
  cancel:  (id)                           => apiFetch(`/api/bookings/${id}`, { method: 'DELETE' }),

  // Admin — bookings
  adminUsers:    () => apiFetch('/api/admin/users'),
  adminBookings: () => apiFetch('/api/admin/bookings'),

  // Admin — user management
  createUser: (data) => apiFetch('/api/admin/users', { method: 'POST', body: JSON.stringify(data) }),
  updateUser: (id, data) => apiFetch(`/api/admin/users/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteUser:   (id) => apiFetch(`/api/admin/users/${id}`, { method: 'DELETE' }),
  renameCourt:  (id, name) => apiFetch(`/api/courts/${id}`, { method: 'PUT', body: JSON.stringify({ name }) }),

  // System
  sysinfo:   () => apiFetch('/api/sysinfo'),
  changelog: () => apiFetch('/api/changelog'),
};


// ── 5. Toast Notifications ───────────────────────────────────────────────────

function toast(msg, type = 'success') {
  const el = document.createElement('div');
  el.className = `toast-msg ${type}`;
  el.textContent = msg;
  document.getElementById('toast').appendChild(el);
  setTimeout(() => el.remove(), 3000);
}


// ── 6. Confirm Modal ─────────────────────────────────────────────────────────

const Modal = (() => {
  let resolver = null;

  const overlay    = document.getElementById('modal-overlay');
  const titleEl    = document.getElementById('modal-title');
  const msgEl      = document.getElementById('modal-msg');
  const confirmBtn = document.getElementById('modal-confirm');
  const cancelBtn  = document.getElementById('modal-cancel');

  function close(result) {
    if (!resolver) return;
    overlay.classList.remove('active');
    const r = resolver;
    resolver = null;
    r(result);
  }

  confirmBtn.addEventListener('click', () => close(true));
  cancelBtn .addEventListener('click', () => close(false));
  overlay.addEventListener('click', e => { if (e.target === overlay) close(false); });
  document.addEventListener('keydown', e => {
    if (!resolver) return;
    if (e.key === 'Escape') close(false);
    if (e.key === 'Enter')  close(true);
  });

  return {
    ask(title, body) {
      titleEl.textContent = title;
      msgEl.textContent   = body ?? '';
      overlay.classList.add('active');
      confirmBtn.focus();
      return new Promise(resolve => { resolver = resolve; });
    },
    prompt(title, label, defaultValue = '') {
      return new Promise(resolve => {
        const promptOverlay = document.createElement('div');
        promptOverlay.className = 'modal-overlay active';
        promptOverlay.innerHTML = `
          <div class="modal" style="max-width:380px;width:100%">
            <h3 style="margin:0 0 1rem">${escHtml(title)}</h3>
            <div class="form-group">
              <label>${escHtml(label)}</label>
              <input id="modal-prompt-input" type="text" class="form-input" value="${escHtml(defaultValue)}">
            </div>
            <div class="modal-actions" style="margin-top:1rem">
              <button class="btn btn-ghost" id="modal-prompt-cancel">Cancel</button>
              <button class="btn btn-primary" id="modal-prompt-ok">OK</button>
            </div>
          </div>`;
        document.body.appendChild(promptOverlay);
        const input  = promptOverlay.querySelector('#modal-prompt-input');
        const okBtn  = promptOverlay.querySelector('#modal-prompt-ok');
        const cancel = promptOverlay.querySelector('#modal-prompt-cancel');
        input.focus();
        input.select();
        const done = val => { promptOverlay.remove(); resolve(val); };
        okBtn.addEventListener('click', () => done(input.value));
        cancel.addEventListener('click', () => done(null));
        promptOverlay.addEventListener('click', e => { if (e.target === promptOverlay) done(null); });
        input.addEventListener('keydown', e => {
          if (e.key === 'Enter')  done(input.value);
          if (e.key === 'Escape') done(null);
        });
      });
    },
  };
})();


// ── 6b. Edit Booking Modal ───────────────────────────────────────────────────

const EditModal = (() => {
  let onSave   = null;
  let onDelete = null;
  let onClose  = null;

  const overlay  = document.getElementById('edit-overlay');
  const dateEl   = document.getElementById('edit-date');
  const courtEl  = document.getElementById('edit-court');
  const timeEl   = document.getElementById('edit-time');
  const saveBtn  = document.getElementById('edit-save');
  const delBtn   = document.getElementById('edit-delete');
  const closeBtn = document.getElementById('edit-close');
  const cancelBtn= document.getElementById('edit-cancel-btn');
  const titleEl  = document.getElementById('edit-title');

  function close() {
    overlay.classList.remove('active');
    onSave = onDelete = onClose = null;
  }

  async function refreshTimes(currentCourtId, currentHour, currentDate) {
    const selDate  = dateEl.value;
    const selCourt = parseInt(courtEl.value, 10);
    if (!selDate) return;

    timeEl.innerHTML = '<option disabled>Loading…</option>';
    try {
      const bookings = await api.bookings(selDate);
      const taken = new Set(
        bookings
          .filter(b => b.court_id === selCourt && !(b.start_hour === currentHour && selDate === currentDate))
          .map(b => b.start_hour)
      );
      const now  = new Date();
      timeEl.innerHTML = HOURS.map(h => {
        const slotTime = new Date(`${selDate}T${String(h).padStart(2,'0')}:00:00`);
        const past     = slotTime < now;
        const busy     = taken.has(h);
        const disabled = past || busy;
        const label    = `${fmtHour(h)}${busy ? ' (opptatt)' : past ? ' (passert)' : ''}`;
        return `<option value="${h}" ${disabled ? 'disabled' : ''} ${h === currentHour && selDate === currentDate ? 'selected' : ''}>${label}</option>`;
      }).join('');
      if (timeEl.value === '') {
        const first = timeEl.querySelector('option:not([disabled])');
        if (first) first.selected = true;
      }
    } catch {
      timeEl.innerHTML = '<option disabled>Error loading slots</option>';
    }
  }

  dateEl.addEventListener('change',  () => refreshTimes(null, null, null));
  courtEl.addEventListener('change', () => refreshTimes(null, null, null));

  saveBtn.addEventListener('click', () => {
    const court    = parseInt(courtEl.value, 10);
    const date     = dateEl.value;
    const startHour= parseInt(timeEl.value, 10);
    if (!court || !date || isNaN(startHour)) return;
    onSave?.(court, date, startHour);
    close();
  });

  delBtn.addEventListener('click', () => { onDelete?.(); close(); });

  const dismiss = () => { onClose?.(); close(); };
  closeBtn .addEventListener('click', dismiss);
  cancelBtn.addEventListener('click', dismiss);
  overlay  .addEventListener('click', e => { if (e.target === overlay) dismiss(); });
  document.addEventListener('keydown', e => {
    if (overlay.classList.contains('active') && e.key === 'Escape') dismiss();
  });

  return {
    open(booking) {
      titleEl.textContent = `Edit – ${booking.court_name}`;
      courtEl.innerHTML = S.courts.map(c =>
        `<option value="${c.id}" ${c.id === booking.court_id ? 'selected' : ''}>${escHtml(c.name)}</option>`
      ).join('');
      dateEl.value = booking.date;
      refreshTimes(booking.court_id, booking.start_hour, booking.date);
      overlay.classList.add('active');
      return new Promise(resolve => {
        onSave   = (court_id, date, start_hour) => resolve({ action: 'save', court_id, date, start_hour });
        onDelete = ()                            => resolve({ action: 'delete' });
        onClose  = ()                            => resolve(null);
      });
    },
  };
})();


// ── 6c. Calendar Export ──────────────────────────────────────────────────────

function exportCalendar(adminAll = false) {
  const url = adminAll ? '/api/calendar/all.ics' : '/api/calendar/mine.ics';
  const a = document.createElement('a');
  a.href = url;
  a.download = adminAll ? 'alle-bestillinger.ics' : 'mine-bestillinger.ics';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}


// ── 7. Dark Mode ─────────────────────────────────────────────────────────────

function applyTheme() {
  document.documentElement.setAttribute('data-theme', S.darkMode ? 'dark' : 'light');
}

function toggleDark() {
  S.darkMode = !S.darkMode;
  localStorage.setItem('dark', S.darkMode ? '1' : '0');
  applyTheme();
  const icon = document.getElementById('dark-icon');
  if (icon) icon.textContent = S.darkMode ? '☀️' : '🌙';
}

applyTheme();


// ── 8. Router ────────────────────────────────────────────────────────────────

function render() {
  const app = document.getElementById('app');

  if (!S.user) {
    app.innerHTML = '';
    renderLogin();
    return;
  }

  if (!document.getElementById('navbar')) {
    app.innerHTML = `
      <nav id="navbar"></nav>
      <div id="main-view">
        <aside id="sidebar"></aside>
        <main  id="content"></main>
      </div>
      <nav id="bottom-nav"><div class="bnav-inner"></div></nav>
    `;
  }

  renderNav();
  renderBottomNav();
  renderSidebar();
  renderMainContent();
}

function renderMainContent() {
  if (S.view === 'scheduler') renderScheduler();
  else if (S.view === 'admin') renderAdmin();
  else if (S.view === 'sysinfo') renderSysInfo();
}

function renderBottomNav() {
  const inner = document.querySelector('#bottom-nav .bnav-inner');
  if (!inner) return;

  const tabs = [{ view: 'scheduler', icon: '📅', label: 'Book' }];
  if (S.user?.role === 'admin') tabs.push({ view: 'admin', icon: '⚙️', label: 'Admin' });
  tabs.push({ view: 'sysinfo', icon: 'ℹ️', label: 'Info' });

  inner.innerHTML = tabs.map(t => `
    <button class="bnav-btn ${S.view === t.view ? 'active' : ''}" data-view="${t.view}">
      <span class="bnav-icon">${t.icon}</span>
      <span>${t.label}</span>
      <span class="bnav-dot"></span>
    </button>
  `).join('');

  inner.querySelectorAll('[data-view]').forEach(btn => {
    btn.addEventListener('click', () => {
      S.view = btn.dataset.view;
      if (S.view === 'admin')   loadAdminData();
      if (S.view === 'sysinfo') loadSysInfo();
      renderNav();
      renderBottomNav();
      renderMainContent();
    });
  });
}


// ── 9. Login View ────────────────────────────────────────────────────────────

function renderLogin() {
  document.getElementById('app').innerHTML = `
    <div id="login-view">
      <div class="card login-card">

        <div class="login-logo">
          <div class="logo-icon">🎾</div>
          <div>
            <h1>TennisPro</h1>
            <p>Court Booking System</p>
          </div>
        </div>

        <form class="login-form" id="login-form" novalidate>
          <div id="login-error" class="login-error hidden"></div>

          <div class="form-group">
            <label for="email">Email address</label>
            <input id="email" type="email"
              placeholder="you@tennis.local"
              autocomplete="email" required>
          </div>

          <div class="form-group">
            <label for="password">Password</label>
            <input id="password" type="password"
              placeholder="••••••••"
              autocomplete="current-password" required>
          </div>

          <button type="submit" class="btn btn-primary submit-btn" id="login-btn">
            Sign In
          </button>
        </form>

        <div class="login-hint">
          <strong>Admin:</strong> admin@tennis.local / Admin123!<br>
          <strong>Players:</strong> emma@tennis.local … / Tennis123!
        </div>

      </div>
    </div>
  `;

  document.getElementById('login-form').addEventListener('submit', async e => {
    e.preventDefault();

    const btn   = document.getElementById('login-btn');
    const errEl = document.getElementById('login-error');
    const email = document.getElementById('email').value.trim();
    const pass  = document.getElementById('password').value;

    btn.disabled = true;
    btn.innerHTML = '<span class="loader"></span> Signing in…';
    errEl.classList.add('hidden');

    try {
      S.user    = await api.login(email, pass);
      S.courts  = await api.courts();
      await loadBookings();
      connectWS();
      render();
    } catch (err) {
      errEl.textContent = err.message;
      errEl.classList.remove('hidden');
      btn.disabled = false;
      btn.textContent = 'Sign In';
    }
  });
}


// ── 10. Navigation Bar ───────────────────────────────────────────────────────

function renderNav() {
  const nav = document.getElementById('navbar');
  if (!nav) return;

  const isAdmin = S.user?.role === 'admin';

  nav.innerHTML = `
    <div class="nav-logo">
      <div class="logo-icon">🎾</div>
      <span>TennisPro</span>
    </div>

    <div class="nav-divider"></div>

    <button class="nav-tab ${S.view === 'scheduler' ? 'active' : ''}" data-view="scheduler">
      📅 Book Courts
    </button>
    ${isAdmin ? `
    <button class="nav-tab ${S.view === 'admin' ? 'active' : ''}" data-view="admin">
      ⚙️ Admin
    </button>` : ''}
    <button class="nav-tab ${S.view === 'sysinfo' ? 'active' : ''}" data-view="sysinfo">
      ℹ️ System
    </button>

    <span class="nav-user ml-auto">
      <strong>${escHtml(S.user?.name ?? '')}</strong>
    </span>
    <button class="btn-icon" id="dark-toggle" title="Toggle dark mode" aria-label="Toggle dark mode">
      <span id="dark-icon">${S.darkMode ? '☀️' : '🌙'}</span>
    </button>
    <button class="btn btn-ghost btn-sm" id="logout-btn">Sign out</button>
  `;

  nav.querySelectorAll('[data-view]').forEach(btn => {
    btn.addEventListener('click', () => {
      S.view = btn.dataset.view;
      if (S.view === 'admin')   loadAdminData();
      if (S.view === 'sysinfo') loadSysInfo();
      renderNav();
      renderMainContent();
    });
  });

  document.getElementById('dark-toggle').addEventListener('click', toggleDark);

  document.getElementById('logout-btn').addEventListener('click', async () => {
    await api.logout().catch(() => {});
    disconnectWS();
    S.user = null;
    S.bookings = [];
    S.sysinfoData = null;
    render();
  });
}


// ── 11. Sidebar + Mini Calendar ──────────────────────────────────────────────

function renderSidebar() {
  const sidebar = document.getElementById('sidebar');
  if (!sidebar) return;

  const myCount     = S.bookings.filter(b => b.user_id === S.user.id).length;
  const totalBooked = S.bookings.length;
  const totalSlots  = S.courts.length * HOURS.length;

  sidebar.innerHTML = `
    <div class="mini-cal" id="mini-cal"></div>
    <div>
      <div class="section-label">Selected Date</div>
      <div class="stat-row">
        <span>My bookings</span>
        <span class="stat-chip">${myCount}</span>
      </div>
      <div class="stat-row">
        <span>All booked</span>
        <span class="stat-chip">${totalBooked}</span>
      </div>
      <div class="stat-row">
        <span>Available</span>
        <span class="stat-chip">${totalSlots - totalBooked}</span>
      </div>
    </div>
  `;

  renderMiniCal();
}

function renderMiniCal() {
  const el = document.getElementById('mini-cal');
  if (!el) return;

  const y           = S.calDate.getFullYear();
  const m           = S.calDate.getMonth();
  const firstDay    = (new Date(y, m, 1).getDay() + 6) % 7;
  const daysInMonth = new Date(y, m + 1, 0).getDate();
  const monthLabel  = S.calDate.toLocaleString('nb-NO', { month: 'long', year: 'numeric' });
  const tStr        = todayStr();

  const dayLabels = ['Ma','Ti','On','To','Fr','Lø','Sø']
    .map(d => `<div class="mini-cal-day-label">${d}</div>`)
    .join('');

  let cells = '<div class="mini-cal-day empty"></div>'.repeat(firstDay);
  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr    = `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const isToday    = dateStr === tStr;
    const isSelected = dateStr === S.selDate;
    const cls = ['mini-cal-day', isToday ? 'today' : '', isSelected ? 'selected' : ''].filter(Boolean).join(' ');
    cells += `<button class="${cls}" data-date="${dateStr}">${d}</button>`;
  }

  el.innerHTML = `
    <div class="mini-cal-header">
      <button class="btn-icon" id="cal-prev" title="Previous month">‹</button>
      <h3>${monthLabel}</h3>
      <button class="btn-icon" id="cal-next" title="Next month">›</button>
    </div>
    <div class="mini-cal-grid">
      ${dayLabels}
      ${cells}
    </div>
  `;

  el.querySelector('#cal-prev').addEventListener('click', () => {
    S.calDate = new Date(y, m - 1, 1);
    renderMiniCal();
  });
  el.querySelector('#cal-next').addEventListener('click', () => {
    S.calDate = new Date(y, m + 1, 1);
    renderMiniCal();
  });

  el.querySelectorAll('[data-date]').forEach(btn => {
    btn.addEventListener('click', async () => {
      S.selDate = btn.dataset.date;
      await loadBookings();
      renderSidebar();
      renderScheduler();
    });
  });
}


// ── 12. Scheduler View ───────────────────────────────────────────────────────

async function loadBookings() {
  S.bookings = await api.bookings(S.selDate);
}

function renderScheduler() {
  const content = document.getElementById('content');
  if (!content) return;

  const dateLabel = fmtDateLongNO(S.selDate);

  const bookingMap = {};
  S.courts.forEach(c => { bookingMap[c.id] = {}; });
  S.bookings.forEach(b => { bookingMap[b.court_id][b.start_hour] = b; });

  const headerRow =
    `<div class="sched-court-header sched-corner"></div>` +
    S.courts.map(c => `<div class="sched-court-header">${escHtml(c.name)}</div>`).join('');

  const bodyRows = HOURS.map(h => {
    const timeLbl = `<div class="sched-time">${fmtHour(h)}</div>`;
    const slots = S.courts.map(c => {
      const booking = bookingMap[c.id]?.[h];
      const past    = isPast(S.selDate, h);

      if (booking) {
        const canCancel = booking.user_id === S.user.id || S.user.role === 'admin';
        const cls       = canCancel ? 'mine' : 'others';
        const av        = escHtml(initials(booking.user_name));
        const name      = escHtml(booking.user_name);
        return `
          <div class="sched-slot ${cls}" data-id="${booking.id}">
            <div class="slot-pill">
              <div class="slot-avatar">${av}</div>
              <div class="slot-info">
                <div class="slot-name">${name}</div>
              </div>
              ${canCancel
                ? `<button class="slot-cancel" title="Cancel booking" aria-label="Cancel booking">✕</button>`
                : ''}
            </div>
          </div>`;
      }

      if (past) return `<div class="sched-slot past" title="Past"></div>`;

      return `
        <div class="sched-slot available"
             data-court="${c.id}" data-hour="${h}"
             title="Book ${escHtml(c.name)} at ${fmtHour(h)}">
        </div>`;
    }).join('');

    return timeLbl + slots;
  }).join('');

  const now       = new Date();
  const nowMins   = now.getHours() * 60 + now.getMinutes();
  const startMins = 7 * 60;
  const endMins   = 22 * 60;
  const slotH     = 64;
  const headerH   = 36;

  let timeIndicator = '';
  if (S.selDate === todayStr() && nowMins >= startMins && nowMins <= endMins) {
    const pct = (nowMins - startMins) / (endMins - startMins);
    const top  = headerH + pct * (HOURS.length * slotH + 1);
    timeIndicator = `<div class="time-indicator" style="top:${top.toFixed(1)}px"></div>`;
  }

  content.innerHTML = `
    <div class="scheduler-toolbar">
      <div class="date-nav">
        <button class="btn-icon" id="prev-day" title="Previous day">‹</button>
        <h2>${escHtml(dateLabel)}</h2>
        <button class="btn-icon" id="next-day" title="Next day">›</button>
      </div>

      <div class="legend">
        <div class="legend-item"><div class="legend-dot avail"></div> Available</div>
        <div class="legend-item"><div class="legend-dot mine"></div> Your booking</div>
        <div class="legend-item"><div class="legend-dot others"></div> Taken</div>
      </div>

      <div style="display:flex;gap:.4rem;align-items:center">
        <button class="btn btn-ghost btn-sm" id="goto-today">Today</button>
        <button class="btn btn-ghost btn-sm" id="export-cal" title="Export bookings to calendar">📅 Export</button>
        ${S.user?.role === 'admin' ? `<button class="btn btn-ghost btn-sm" id="export-cal-all" title="Export all bookings">📅 All</button>` : ''}
      </div>
    </div>

    <div class="scheduler-wrap">
      <div class="scheduler-grid" id="sched-grid">
        ${timeIndicator}
        ${headerRow}
        ${bodyRows}
      </div>
    </div>
  `;

  document.getElementById('prev-day').addEventListener('click', () => shiftDay(-1));
  document.getElementById('next-day').addEventListener('click', () => shiftDay(+1));
  document.getElementById('goto-today').addEventListener('click', async () => {
    S.selDate = todayStr();
    S.calDate = new Date();
    await loadBookings();
    renderSidebar();
    renderScheduler();
  });

  document.getElementById('export-cal').addEventListener('click', () => exportCalendar(false));
  document.getElementById('export-cal-all')?.addEventListener('click', () => exportCalendar(true));

  // Scroll to current time (or 08:00 for future dates)
  const wrap = content.querySelector('.scheduler-wrap');
  if (wrap) {
    const now = new Date();
    const targetHour = S.selDate === todayStr()
      ? Math.max(7, Math.min(now.getHours(), 21))
      : 8;
    const scrollTo = headerH + (targetHour - 7) * slotH - 80;
    wrap.scrollTop = Math.max(0, scrollTo);
  }

  const grid = document.getElementById('sched-grid');
  grid.addEventListener('click', async e => {
    const slot = e.target.closest('.sched-slot');
    if (!slot) return;

    if (slot.classList.contains('available')) {
      const courtId = parseInt(slot.dataset.court, 10);
      const hour    = parseInt(slot.dataset.hour,  10);
      const court   = S.courts.find(c => c.id === courtId);

      const confirmed = await Modal.ask(
        'Confirm Booking',
        `Reserve ${court?.name} on ${S.selDate} at ${fmtHour(hour)}?`
      );
      if (!confirmed) return;

      try {
        await api.book(courtId, S.selDate, hour);
        toast(`Booked ${court?.name} at ${fmtHour(hour)}`);
        await loadBookings();
        renderSidebar();
        renderScheduler();
      } catch (err) {
        toast(err.message, 'error');
      }
    }

    if (slot.classList.contains('mine')) {
      const id      = parseInt(slot.dataset.id, 10);
      const booking = S.bookings.find(b => b.id === id);
      if (!booking) return;

      const result = await EditModal.open(booking);
      if (!result) return;

      if (result.action === 'delete') {
        const ok = await Modal.ask('Delete Booking',
          `Remove ${booking.court_name} on ${fmtDateNO(booking.date)} at ${fmtHour(booking.start_hour)}?`);
        if (!ok) return;
        try {
          await api.cancel(id);
          toast('Booking deleted');
        } catch (err) { toast(err.message, 'error'); return; }
      }

      if (result.action === 'save') {
        try {
          await api.edit(id, result.court_id, result.date, result.start_hour);
          toast('Booking updated');
        } catch (err) { toast(err.message, 'error'); return; }
      }

      await loadBookings();
      renderSidebar();
      renderScheduler();
    }
  });

  const wrap = content.querySelector('.scheduler-wrap');
  let swipeStartX = 0, swipeStartY = 0;

  wrap.addEventListener('touchstart', e => {
    swipeStartX = e.changedTouches[0].clientX;
    swipeStartY = e.changedTouches[0].clientY;
  }, { passive: true });

  wrap.addEventListener('touchend', e => {
    const dx = e.changedTouches[0].clientX - swipeStartX;
    const dy = e.changedTouches[0].clientY - swipeStartY;
    if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) {
      shiftDay(dx < 0 ? 1 : -1);
    }
  }, { passive: true });
}

async function shiftDay(delta) {
  const d = new Date(S.selDate + 'T12:00:00');
  d.setDate(d.getDate() + delta);
  S.selDate = fmtDate(d);
  S.calDate = new Date(d.getFullYear(), d.getMonth(), 1);
  await loadBookings();
  renderSidebar();
  renderScheduler();
}


// ── 13. Admin Panel ──────────────────────────────────────────────────────────

async function loadAdminData() {
  [S.adminData.users, S.adminData.bookings] = await Promise.all([
    api.adminUsers(),
    api.adminBookings(),
  ]);
  renderAdmin();
}

function renderAdmin() {
  const content = document.getElementById('content');
  if (!content) return;

  const isLoading = S.adminData.users.length === 0 && S.adminData.bookings.length === 0;

  content.innerHTML = `
    <div class="admin-tabs">
      <button class="admin-tab ${S.adminTab === 'users' ? 'active' : ''}" data-tab="users">
        👥 Users
      </button>
      <button class="admin-tab ${S.adminTab === 'bookings' ? 'active' : ''}" data-tab="bookings">
        📋 All Bookings
      </button>
      <button class="admin-tab ${S.adminTab === 'courts' ? 'active' : ''}" data-tab="courts">
        🎾 Courts
      </button>
    </div>
    <div id="admin-content">
      ${isLoading
        ? '<div class="loading-overlay"><span class="loader"></span> Loading…</div>'
        : buildAdminPanel()}
    </div>
  `;

  content.querySelectorAll('.admin-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      S.adminTab = btn.dataset.tab;
      renderAdmin();
    });
  });

  // User management buttons
  content.querySelector('#btn-add-user')?.addEventListener('click', () => openUserForm(null));

  content.querySelectorAll('[data-edit-user]').forEach(btn => {
    btn.addEventListener('click', () => {
      const id   = parseInt(btn.dataset.editUser, 10);
      const user = S.adminData.users.find(u => u.id === id);
      if (user) openUserForm(user);
    });
  });

  content.querySelectorAll('[data-delete-user]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id   = parseInt(btn.dataset.deleteUser, 10);
      const user = S.adminData.users.find(u => u.id === id);
      const confirmed = await Modal.ask('Delete User',
        `Permanently delete "${user?.name}"? Their bookings will also be removed.`);
      if (!confirmed) return;
      try {
        await api.deleteUser(id);
        toast('User deleted');
        await loadAdminData();
      } catch (err) { toast(err.message, 'error'); }
    });
  });

  // Rename court buttons (courts tab)
  content.querySelectorAll('[data-rename-court]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id    = parseInt(btn.dataset.renameCourt, 10);
      const court = S.courts.find(c => c.id === id);
      const name  = await Modal.prompt('Rename Court', 'New name:', court?.name || '');
      if (!name || name.trim() === court?.name) return;
      try {
        const updated = await api.renameCourt(id, name.trim());
        S.courts = S.courts.map(c => c.id === id ? updated : c);
        toast(`Court renamed to "${updated.name}"`);
        renderAdmin();
      } catch (err) { toast(err.message, 'error'); }
    });
  });

  // Cancel booking buttons (bookings tab)
  content.querySelectorAll('[data-cancel-id]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = parseInt(btn.dataset.cancelId, 10);
      const confirmed = await Modal.ask('Cancel Booking', 'Remove this booking from the system?');
      if (!confirmed) return;
      try {
        await api.cancel(id);
        toast('Booking cancelled');
        await loadAdminData();
        await loadBookings();
        renderSidebar();
      } catch (err) { toast(err.message, 'error'); }
    });
  });
}

function buildAdminPanel() {
  if (S.adminTab === 'users')   return buildUsersTab();
  if (S.adminTab === 'courts')  return buildCourtsTab();
  return buildBookingsTab();
}

function buildUsersTab() {
  const rows = S.adminData.users.map(u => {
    const createdAt = parseSQLiteDate(u.created_at);
    const dateStr   = isNaN(createdAt) ? '—' : createdAt.toLocaleDateString('nb-NO');
    const isSelf    = u.id === S.user.id;
    return `
      <tr>
        <td>${escHtml(u.name)}</td>
        <td>${escHtml(u.email)}</td>
        <td><span class="badge badge-${u.role}">${u.role}</span></td>
        <td>${dateStr}</td>
        <td>
          <div style="display:flex;gap:.4rem">
            <button class="btn btn-ghost btn-sm" data-edit-user="${u.id}">Edit</button>
            <button class="btn btn-danger btn-sm" data-delete-user="${u.id}"
              ${isSelf ? 'disabled title="Cannot delete your own account"' : ''}>
              Delete
            </button>
          </div>
        </td>
      </tr>
    `;
  }).join('');

  return `
    <div style="display:flex;justify-content:flex-end;margin-bottom:.75rem">
      <button class="btn btn-primary btn-sm" id="btn-add-user">+ Add User</button>
    </div>
    <div class="table-wrap">
      <table class="data-table">
        <thead>
          <tr><th>Name</th><th>Email</th><th>Role</th><th>Member since</th><th></th></tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
}

function buildBookingsTab() {
  if (!S.adminData.bookings.length) {
    return `<div class="empty-state"><div class="icon">📭</div>No bookings yet</div>`;
  }

  const rows = S.adminData.bookings.map(b => `
    <tr>
      <td>${fmtDateNO(b.date)}</td>
      <td>${fmtHour(b.start_hour)}</td>
      <td>${escHtml(b.court_name)}</td>
      <td>${escHtml(b.user_name)}</td>
      <td>
        <button class="btn btn-danger btn-sm" data-cancel-id="${b.id}">Cancel</button>
      </td>
    </tr>
  `).join('');

  return `
    <div class="table-wrap">
      <table class="data-table">
        <thead>
          <tr><th>Date</th><th>Time</th><th>Court</th><th>Player</th><th></th></tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
}

function buildCourtsTab() {
  const rows = S.courts.map(c => `
    <tr>
      <td id="court-name-${c.id}">${escHtml(c.name)}</td>
      <td>
        <button class="btn btn-ghost btn-sm" data-rename-court="${c.id}">Rename</button>
      </td>
    </tr>
  `).join('');

  return `
    <div class="table-wrap">
      <table class="data-table">
        <thead>
          <tr><th>Court name</th><th></th></tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
}

/**
 * Opens the user create/edit form as a modal overlay.
 * Pass null for `user` to create; pass an existing user object to edit.
 */
function openUserForm(user) {
  const isEdit  = !!user;
  const overlay = document.createElement('div');
  overlay.id    = 'user-form-overlay';
  overlay.className = 'modal-overlay active';

  overlay.innerHTML = `
    <div class="modal" style="max-width:420px;width:100%">
      <h3 style="margin:0 0 1rem">${isEdit ? 'Edit User' : 'Add User'}</h3>

      <div id="user-form-error" class="login-error hidden" style="margin-bottom:.75rem"></div>

      <div class="form-group">
        <label>Full Name</label>
        <input id="uf-name" type="text" class="form-input" value="${isEdit ? escHtml(user.name) : ''}" placeholder="Emma Johnson">
      </div>
      <div class="form-group">
        <label>Email</label>
        <input id="uf-email" type="email" class="form-input" value="${isEdit ? escHtml(user.email) : ''}" placeholder="emma@tennis.local">
      </div>
      <div class="form-group">
        <label>Role</label>
        <select id="uf-role" class="form-select">
          <option value="user"  ${!isEdit || user.role === 'user'  ? 'selected' : ''}>User</option>
          <option value="admin" ${isEdit  && user.role === 'admin' ? 'selected' : ''}>Admin</option>
        </select>
      </div>
      <div class="form-group">
        <label>Phone (for SMS notifications)</label>
        <input id="uf-phone" type="tel" class="form-input" value="${isEdit && user.phone ? escHtml(user.phone) : ''}" placeholder="+4712345678">
      </div>
      <div class="form-group">
        <label>${isEdit ? 'New Password (leave blank to keep)' : 'Password'}</label>
        <input id="uf-password" type="password" class="form-input" placeholder="${isEdit ? '(unchanged)' : 'Min. 6 characters'}">
      </div>

      <div class="modal-actions" style="margin-top:1.25rem">
        <button class="btn btn-ghost" id="uf-cancel">Cancel</button>
        <button class="btn btn-primary" id="uf-save">${isEdit ? 'Save Changes' : 'Create User'}</button>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);

  const errEl    = overlay.querySelector('#user-form-error');
  const nameEl   = overlay.querySelector('#uf-name');
  const emailEl  = overlay.querySelector('#uf-email');
  const roleEl   = overlay.querySelector('#uf-role');
  const phoneEl  = overlay.querySelector('#uf-phone');
  const passEl   = overlay.querySelector('#uf-password');
  const saveBtn  = overlay.querySelector('#uf-save');
  const cancelBtn= overlay.querySelector('#uf-cancel');

  nameEl.focus();

  const close = () => overlay.remove();
  cancelBtn.addEventListener('click', close);
  overlay.addEventListener('click', e => { if (e.target === overlay) close(); });

  saveBtn.addEventListener('click', async () => {
    errEl.classList.add('hidden');
    saveBtn.disabled = true;

    const data = {
      name:     nameEl.value.trim(),
      email:    emailEl.value.trim(),
      role:     roleEl.value,
      phone:    phoneEl.value.trim() || undefined,
      password: passEl.value || undefined,
    };

    if (!isEdit) {
      if (!data.password) {
        errEl.textContent = 'Password is required for new users';
        errEl.classList.remove('hidden');
        saveBtn.disabled = false;
        return;
      }
      data.password = passEl.value;
    }

    try {
      if (isEdit) {
        await api.updateUser(user.id, data);
        toast(`User "${data.name}" updated`);
      } else {
        await api.createUser(data);
        toast(`User "${data.name}" created`);
      }
      close();
      await loadAdminData();
    } catch (err) {
      errEl.textContent = err.message;
      errEl.classList.remove('hidden');
      saveBtn.disabled = false;
    }
  });
}


// ── 14. System Info ──────────────────────────────────────────────────────────

async function loadSysInfo() {
  if (S.sysinfoData) { renderSysInfo(); return; }
  renderSysInfo();
  try {
    const [info, { text: changelogText }] = await Promise.all([
      api.sysinfo(),
      api.changelog(),
    ]);
    S.sysinfoData = { info, changelogText };
  } catch (err) {
    toast(err.message, 'error');
    S.sysinfoData = { error: err.message };
  }
  renderSysInfo();
}

function fmtUptime(secs) {
  const d = Math.floor(secs / 86400);
  const h = Math.floor((secs % 86400) / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = Math.floor(secs % 60);
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m ${s}s`;
  return `${m}m ${s}s`;
}

function renderChangelog(md) {
  const lines = md.split('\n');
  const parts = [];
  let inList   = false;

  for (const line of lines) {
    if (line.startsWith('## ')) {
      if (inList) { parts.push('</ul>'); inList = false; }
      parts.push(`<h3 class="cl-version">${escHtml(line.slice(3))}</h3>`);
    } else if (line.startsWith('### ')) {
      if (inList) { parts.push('</ul>'); inList = false; }
      parts.push(`<h4 class="cl-section">${escHtml(line.slice(4))}</h4>`);
    } else if (line.startsWith('- ')) {
      if (!inList) { parts.push('<ul class="cl-list">'); inList = true; }
      const text = escHtml(line.slice(2)).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
      parts.push(`<li>${text}</li>`);
    } else if (line.startsWith('---')) {
      if (inList) { parts.push('</ul>'); inList = false; }
      parts.push('<hr class="cl-hr">');
    } else if (line.trim() === '') {
      if (inList) { parts.push('</ul>'); inList = false; }
    } else if (!line.startsWith('# ')) {
      if (inList) { parts.push('</ul>'); inList = false; }
      parts.push(`<p class="cl-p">${escHtml(line)}</p>`);
    }
  }
  if (inList) parts.push('</ul>');
  return parts.join('');
}

function renderSysInfo() {
  const content = document.getElementById('content');
  if (!content) return;

  if (!S.sysinfoData) {
    content.innerHTML = `<div class="loading-overlay"><span class="loader"></span> Loading…</div>`;
    return;
  }

  if (S.sysinfoData.error) {
    content.innerHTML = `
      <div class="empty-state">
        <div class="icon">⚠️</div>
        <p>${escHtml(S.sysinfoData.error)}</p>
        <button class="btn btn-ghost btn-sm" id="sysinfo-retry" style="margin-top:.75rem">Retry</button>
      </div>`;
    document.getElementById('sysinfo-retry').addEventListener('click', () => {
      S.sysinfoData = null;
      loadSysInfo();
    });
    return;
  }

  const { info, changelogText } = S.sysinfoData;
  const { server, db, app } = info;

  const wsStatus = S.ws && S.ws.readyState === WebSocket.OPEN
    ? '<span style="color:var(--success)">● Live</span>'
    : '<span style="color:var(--text-muted)">○ Offline</span>';

  content.innerHTML = `
    <div class="sysinfo-wrap">
      <div class="sysinfo-header">
        <h2 class="sysinfo-title">System Info</h2>
        <button class="btn btn-ghost btn-sm" id="sysinfo-refresh">Refresh</button>
      </div>

      <div class="info-grid">

        <div class="info-card">
          <div class="info-card-title">Application</div>
          <div class="info-row"><span>Version</span><strong>v${escHtml(String(app.version))}</strong></div>
          <div class="info-row"><span>Uptime</span><strong>${fmtUptime(server.uptime)}</strong></div>
          <div class="info-row"><span>Node.js</span><strong>${escHtml(server.nodeVersion)}</strong></div>
          <div class="info-row"><span>Platform</span><strong>${escHtml(server.platform)}</strong></div>
          <div class="info-row"><span>Live updates</span><strong>${wsStatus}</strong></div>
        </div>

        <div class="info-card">
          <div class="info-card-title">Server Resources</div>
          <div class="info-row"><span>Process memory</span><strong>${server.memUsedMB} MB</strong></div>
          <div class="info-row"><span>Heap used</span><strong>${server.memHeapMB} MB</strong></div>
          <div class="info-row"><span>System RAM</span><strong>${server.memFreeMB} / ${server.memTotalMB} MB free</strong></div>
          <div class="info-row"><span>Load avg (1/5/15m)</span><strong>${Array.isArray(server.loadAvg) ? server.loadAvg.join(' / ') : '—'}</strong></div>
          <div class="info-row"><span>WS connections</span><strong>${server.wsClients ?? 0}</strong></div>
        </div>

        <div class="info-card">
          <div class="info-card-title">Database</div>
          <div class="info-row"><span>Users</span><strong>${db.users}</strong></div>
          <div class="info-row"><span>Courts</span><strong>${db.courts}</strong></div>
          <div class="info-row"><span>Bookings</span><strong>${db.bookings}</strong></div>
          ${db.sizeKB !== null
            ? `<div class="info-row"><span>DB file size</span><strong>${db.sizeKB} KB</strong></div>`
            : ''}
        </div>

      </div>

      <div class="changelog-section">
        <div class="info-card-title">Changelog</div>
        <div class="changelog-body">${renderChangelog(changelogText)}</div>
      </div>
    </div>
  `;

  document.getElementById('sysinfo-refresh').addEventListener('click', () => {
    S.sysinfoData = null;
    loadSysInfo();
  });
}


// ── 15. WebSocket (real-time) ─────────────────────────────────────────────────

let wsReconnectTimer = null;

function connectWS() {
  if (S.ws && S.ws.readyState !== WebSocket.CLOSED) return;

  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const ws = new WebSocket(`${proto}//${location.host}`);
  S.ws = ws;

  ws.addEventListener('open', () => {
    console.log('[WS] connected');
    if (wsReconnectTimer) { clearTimeout(wsReconnectTimer); wsReconnectTimer = null; }
  });

  ws.addEventListener('message', e => {
    let msg;
    try { msg = JSON.parse(e.data); } catch { return; }

    if (msg.type === 'bookings_changed') {
      // Refresh scheduler if the affected date is currently shown
      if (msg.date === S.selDate && S.view === 'scheduler') {
        loadBookings().then(() => {
          renderSidebar();
          renderScheduler();
        });
      } else if (msg.date === S.selDate) {
        // Update data in background for sidebar accuracy
        loadBookings();
      }
      // Refresh admin bookings tab if it's open
      if (S.view === 'admin' && S.adminTab === 'bookings') {
        api.adminBookings().then(b => { S.adminData.bookings = b; renderAdmin(); });
      }
    }

    if (msg.type === 'courts_changed') {
      api.courts().then(courts => {
        S.courts = courts;
        if (S.view === 'scheduler') renderScheduler();
        if (S.view === 'admin' && S.adminTab === 'courts') renderAdmin();
      });
    }
  });

  ws.addEventListener('close', () => {
    console.log('[WS] disconnected');
    S.ws = null;
    // Auto-reconnect if still logged in
    if (S.user) {
      wsReconnectTimer = setTimeout(connectWS, 3000);
    }
  });

  ws.addEventListener('error', () => ws.close());
}

function disconnectWS() {
  if (wsReconnectTimer) { clearTimeout(wsReconnectTimer); wsReconnectTimer = null; }
  if (S.ws) { S.ws.close(); S.ws = null; }
}


// ── 16. Bootstrap ────────────────────────────────────────────────────────────

(async () => {
  try {
    S.user   = await api.me();
    S.courts = await api.courts();
    await loadBookings();
    connectWS();
  } catch {
    // No session — render() will show the login page
  }
  render();
})();
