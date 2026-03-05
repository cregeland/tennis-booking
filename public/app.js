/**
 * TennisPro Booking — Frontend Application  v1.1.0
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
 *  13. Admin Panel
 *  14. Bootstrap (app entry point)
 */

'use strict';

// ── 1. Constants ─────────────────────────────────────────────────────────────

/** Bookable hours: 07:00 – 21:00 (last slot ends at 22:00) */
const HOURS = Array.from({ length: 15 }, (_, i) => i + 7);


// ── 2. Application State ─────────────────────────────────────────────────────

/**
 * Central state object.  Functions read from S and call render functions
 * when they mutate it — no automatic reactivity, just explicit updates.
 */
const S = {
  user:      null,          // {id, name, email, role} — null when logged out
  courts:    [],            // [{id, name}] — loaded once after login
  bookings:  [],            // [{id, court_id, user_id, date, ...}] for selDate
  view:      'scheduler',   // active top-level view: 'scheduler' | 'admin'
  adminTab:  'users',       // active admin sub-tab: 'users' | 'bookings'
  adminData: { users: [], bookings: [] },
  calDate:   new Date(),    // month currently shown in the mini calendar
  selDate:   todayStr(),    // ISO date string (YYYY-MM-DD) shown in scheduler
  darkMode:  initDarkMode(),
};

/** Read saved dark-mode preference; fall back to OS preference. */
function initDarkMode() {
  const saved = localStorage.getItem('dark');
  if (saved === '1') return true;
  if (saved === '0') return false;
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}


// ── 3. Utility Helpers ───────────────────────────────────────────────────────

/** Returns today as a YYYY-MM-DD string in local time. */
function todayStr() {
  return fmtDate(new Date());
}

/** Formats a Date object as YYYY-MM-DD (local time). */
function fmtDate(d) {
  const y  = d.getFullYear();
  const m  = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

/** Formats an integer hour (7–21) as "7:00 AM" / "1:00 PM". */
function fmtHour(h) {
  const ampm = h >= 12 ? 'PM' : 'AM';
  const h12  = h % 12 || 12;
  return `${h12}:00 ${ampm}`;
}

/**
 * Returns true if the given date+hour slot is in the past.
 * Uses local time to avoid timezone issues on a local network server.
 */
function isPast(dateStr, hour) {
  const slot = new Date(`${dateStr}T${String(hour).padStart(2, '0')}:00:00`);
  return slot < new Date();
}

/** Escapes HTML special characters to prevent XSS in innerHTML. */
function escHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Extracts up to two initials from a full name.
 * e.g. "Emma Johnson" → "EJ", "Sofia" → "S"
 */
function initials(name) {
  return name
    .split(' ')
    .slice(0, 2)
    .map(w => w[0]?.toUpperCase() ?? '')
    .join('');
}


// ── 4. HTTP API ──────────────────────────────────────────────────────────────

/**
 * Base fetch wrapper.
 * Throws an Error with the server's error message on non-2xx responses.
 */
async function apiFetch(url, opts = {}) {
  const r = await fetch(url, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
  });
  const data = await r.json();
  if (!r.ok) throw new Error(data.error || 'Request failed');
  return data;
}

/** Typed API methods — all return Promises. */
const api = {
  // Auth
  login:   (email, password)           => apiFetch('/api/login',  { method: 'POST', body: JSON.stringify({ email, password }) }),
  logout:  ()                          => apiFetch('/api/logout',  { method: 'POST' }),
  me:      ()                          => apiFetch('/api/me'),

  // Data
  courts:  ()                          => apiFetch('/api/courts'),
  bookings:(date)                      => apiFetch(`/api/bookings?date=${date}`),
  book:    (court_id, date, start_hour)=> apiFetch('/api/bookings', { method: 'POST', body: JSON.stringify({ court_id, date, start_hour }) }),
  cancel:  (id)                        => apiFetch(`/api/bookings/${id}`, { method: 'DELETE' }),

  // Admin-only
  adminUsers:    () => apiFetch('/api/admin/users'),
  adminBookings: () => apiFetch('/api/admin/bookings'),
};


// ── 5. Toast Notifications ───────────────────────────────────────────────────

/**
 * Shows a temporary notification at the bottom of the screen.
 * @param {string} msg  - Message text
 * @param {'success'|'error'} type - Visual style
 */
function toast(msg, type = 'success') {
  const el = document.createElement('div');
  el.className = `toast-msg ${type}`;
  el.textContent = msg;
  document.getElementById('toast').appendChild(el);
  // Auto-remove after animation completes (matches CSS animation duration)
  setTimeout(() => el.remove(), 3000);
}


// ── 6. Confirm Modal ─────────────────────────────────────────────────────────

/**
 * Singleton modal controller.
 *
 * WHY SINGLETON: If we re-attach onclick handlers on every call, the old
 * handler references linger and can resolve the wrong promise.  By wiring
 * addEventListener ONCE at startup and storing a `resolver` callback, each
 * call to `Modal.ask()` is guaranteed to resolve exactly once.
 */
const Modal = (() => {
  let resolver = null; // holds the current Promise's resolve fn

  const overlay    = document.getElementById('modal-overlay');
  const titleEl    = document.getElementById('modal-title');
  const msgEl      = document.getElementById('modal-msg');
  const confirmBtn = document.getElementById('modal-confirm');
  const cancelBtn  = document.getElementById('modal-cancel');

  /** Close the modal and resolve the pending promise with `result`. */
  function close(result) {
    if (!resolver) return;           // safety: ignore if no modal is open
    overlay.classList.remove('active');
    const r = resolver;
    resolver = null;
    r(result);
  }

  // Wire up button listeners exactly once — never reassigned
  confirmBtn.addEventListener('click', () => close(true));
  cancelBtn .addEventListener('click', () => close(false));

  // Clicking the backdrop (outside the card) dismisses as "cancel"
  overlay.addEventListener('click', e => {
    if (e.target === overlay) close(false);
  });

  // Keyboard: Escape = cancel, Enter = confirm
  document.addEventListener('keydown', e => {
    if (!resolver) return;
    if (e.key === 'Escape') close(false);
    if (e.key === 'Enter')  close(true);
  });

  return {
    /**
     * Shows the modal and returns a Promise that resolves to
     * true (confirmed) or false (cancelled/dismissed).
     *
     * @param {string} title  - Bold heading line
     * @param {string} body   - Descriptive message
     */
    ask(title, body) {
      titleEl.textContent = title;
      msgEl.textContent   = body ?? '';
      overlay.classList.add('active');
      confirmBtn.focus();
      return new Promise(resolve => { resolver = resolve; });
    },
  };
})();


// ── 7. Dark Mode ─────────────────────────────────────────────────────────────

/** Applies the current dark mode state to the <html> element. */
function applyTheme() {
  document.documentElement.setAttribute('data-theme', S.darkMode ? 'dark' : 'light');
}

/** Toggles dark mode, saves preference, updates theme and nav icon. */
function toggleDark() {
  S.darkMode = !S.darkMode;
  localStorage.setItem('dark', S.darkMode ? '1' : '0');
  applyTheme();
  // Only update the icon in the nav — no need to re-render everything
  const icon = document.getElementById('dark-icon');
  if (icon) icon.textContent = S.darkMode ? '☀️' : '🌙';
}

// Apply saved theme immediately before first render (prevents flash)
applyTheme();


// ── 8. Router ────────────────────────────────────────────────────────────────

/**
 * Top-level render function.
 * Shows the login view when logged out, the main app when logged in.
 */
function render() {
  const app = document.getElementById('app');

  if (!S.user) {
    // Wipe everything and show login
    app.innerHTML = '';
    renderLogin();
    return;
  }

  // First time entering the app after login — build the shell
  if (!document.getElementById('navbar')) {
    app.innerHTML = `
      <nav id="navbar"></nav>
      <div id="main-view">
        <aside id="sidebar"></aside>
        <main  id="content"></main>
      </div>
    `;
  }

  renderNav();
  renderSidebar();
  renderMainContent();
}

/** Dispatches to the correct content view based on S.view. */
function renderMainContent() {
  if (S.view === 'scheduler') renderScheduler();
  else                        renderAdmin();
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

    // Show loading state
    btn.disabled = true;
    btn.innerHTML = '<span class="loader"></span> Signing in…';
    errEl.classList.add('hidden');

    try {
      // Sequential: login → fetch courts + session info → fetch bookings
      S.user    = await api.login(email, pass);
      S.courts  = await api.courts();
      await loadBookings();
      render(); // transition to main app
    } catch (err) {
      errEl.textContent = err.message;
      errEl.classList.remove('hidden');
      btn.disabled = false;
      btn.textContent = 'Sign In';
    }
  });
}


// ── 10. Navigation Bar ───────────────────────────────────────────────────────

/**
 * Renders (or re-renders) the top navigation bar.
 * Called after login, on tab switch, and on dark mode toggle.
 */
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

    <!-- View tabs -->
    <button class="nav-tab ${S.view === 'scheduler' ? 'active' : ''}" data-view="scheduler">
      📅 Book Courts
    </button>
    ${isAdmin ? `
    <button class="nav-tab ${S.view === 'admin' ? 'active' : ''}" data-view="admin">
      ⚙️ Admin
    </button>` : ''}

    <!-- Right-side controls -->
    <span class="nav-user ml-auto">
      <strong>${escHtml(S.user?.name ?? '')}</strong>
    </span>
    <button class="btn-icon" id="dark-toggle" title="Toggle dark mode" aria-label="Toggle dark mode">
      <span id="dark-icon">${S.darkMode ? '☀️' : '🌙'}</span>
    </button>
    <button class="btn btn-ghost btn-sm" id="logout-btn">Sign out</button>
  `;

  // View tab navigation
  nav.querySelectorAll('[data-view]').forEach(btn => {
    btn.addEventListener('click', () => {
      S.view = btn.dataset.view;
      if (S.view === 'admin') loadAdminData(); // load data on first visit
      renderNav();
      renderMainContent();
    });
  });

  document.getElementById('dark-toggle').addEventListener('click', toggleDark);

  document.getElementById('logout-btn').addEventListener('click', async () => {
    await api.logout().catch(() => {}); // best-effort — clear cookie on server
    S.user = null;
    S.bookings = [];
    render();
  });
}


// ── 11. Sidebar + Mini Calendar ──────────────────────────────────────────────

/** Renders the sidebar: mini calendar + stats for the selected date. */
function renderSidebar() {
  const sidebar = document.getElementById('sidebar');
  if (!sidebar) return;

  // Stats for the selected date
  const myCount    = S.bookings.filter(b => b.user_id === S.user.id).length;
  const totalBooked = S.bookings.length;
  const totalSlots  = S.courts.length * HOURS.length;

  sidebar.innerHTML = `
    <!-- Mini month calendar -->
    <div class="mini-cal" id="mini-cal"></div>

    <!-- Quick stats -->
    <div>
      <div class="sidebar-section-title">Selected Date</div>
      <div class="stat-row">
        <span>My bookings</span>
        <span class="stat-badge">${myCount}</span>
      </div>
      <div class="stat-row">
        <span>All booked</span>
        <span class="stat-badge">${totalBooked}</span>
      </div>
      <div class="stat-row">
        <span>Available</span>
        <span class="stat-badge">${totalSlots - totalBooked}</span>
      </div>
    </div>
  `;

  renderMiniCal();
}

/**
 * Renders the mini month calendar inside #mini-cal.
 * Separated from renderSidebar so we can re-render the calendar
 * alone when navigating months without rebuilding the stats section.
 */
function renderMiniCal() {
  const el = document.getElementById('mini-cal');
  if (!el) return;

  const y           = S.calDate.getFullYear();
  const m           = S.calDate.getMonth();
  const firstDay    = new Date(y, m, 1).getDay();   // 0=Sun
  const daysInMonth = new Date(y, m + 1, 0).getDate();
  const monthLabel  = S.calDate.toLocaleString('default', { month: 'long', year: 'numeric' });
  const tStr        = todayStr();

  // Day-of-week header labels
  const dayLabels = ['Su','Mo','Tu','We','Th','Fr','Sa']
    .map(d => `<div class="mini-cal-day-label">${d}</div>`)
    .join('');

  // Empty leading cells + day buttons
  let cells = '<div class="mini-cal-day empty"></div>'.repeat(firstDay);
  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr    = `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const isToday    = dateStr === tStr;
    const isSelected = dateStr === S.selDate;
    const cls = [
      'mini-cal-day',
      isToday    ? 'today'    : '',
      isSelected ? 'selected' : '',
    ].filter(Boolean).join(' ');
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

  // Month navigation
  el.querySelector('#cal-prev').addEventListener('click', () => {
    S.calDate = new Date(y, m - 1, 1);
    renderMiniCal();
  });
  el.querySelector('#cal-next').addEventListener('click', () => {
    S.calDate = new Date(y, m + 1, 1);
    renderMiniCal();
  });

  // Date selection — load bookings and refresh scheduler
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

/** Fetches bookings for S.selDate and stores them in S.bookings. */
async function loadBookings() {
  S.bookings = await api.bookings(S.selDate);
}

/**
 * Builds and injects the full scheduler view into #content.
 * Uses event delegation (one listener on the grid) instead of per-cell
 * listeners — this is the root fix for "booking button does nothing".
 */
function renderScheduler() {
  const content = document.getElementById('content');
  if (!content) return;

  // Human-readable date heading
  const selDateObj = new Date(S.selDate + 'T12:00:00');
  const dateLabel  = selDateObj.toLocaleDateString('default', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
  });

  // Build a fast lookup: bookingMap[courtId][hour] = booking object
  const bookingMap = {};
  S.courts.forEach(c => { bookingMap[c.id] = {}; });
  S.bookings.forEach(b => { bookingMap[b.court_id][b.start_hour] = b; });

  // ── Grid HTML ─────────────────────────────────────────────────────────────

  // Header row: blank corner + one cell per court
  const headerRow =
    `<div class="sched-court-header sched-corner"></div>` +
    S.courts.map(c =>
      `<div class="sched-court-header">${escHtml(c.name)}</div>`
    ).join('');

  // Body rows: one row per hour
  const bodyRows = HOURS.map(h => {
    const timeLbl = `<div class="sched-time">${fmtHour(h)}</div>`;

    const slots = S.courts.map(c => {
      const booking = bookingMap[c.id]?.[h];
      const past    = isPast(S.selDate, h);

      // ── Booked slot ───────────────────────────────────────────────────────
      if (booking) {
        // Admins can cancel anyone's booking; regular users can only cancel own
        const canCancel = booking.user_id === S.user.id || S.user.role === 'admin';
        const cls       = canCancel ? 'mine' : 'others';
        const av        = escHtml(initials(booking.user_name));
        const name      = escHtml(booking.user_name);
        return `
          <div class="sched-slot ${cls}" data-id="${booking.id}"
               title="${canCancel ? 'Click to cancel' : name}">
            <div class="slot-pill">
              <div class="slot-avatar">${av}</div>
              <div class="slot-info">
                <div class="slot-name">${name}</div>
                ${canCancel ? '<div class="slot-hint">Cancel booking</div>' : ''}
              </div>
            </div>
          </div>`;
      }

      // ── Past empty slot ───────────────────────────────────────────────────
      if (past) {
        return `<div class="sched-slot past" title="Past"></div>`;
      }

      // ── Available slot ────────────────────────────────────────────────────
      return `
        <div class="sched-slot available"
             data-court="${c.id}" data-hour="${h}"
             title="Book ${escHtml(c.name)} at ${fmtHour(h)}">
        </div>`;

    }).join('');

    return timeLbl + slots;
  }).join('');

  // Current-time red indicator position
  const now       = new Date();
  const nowMins   = now.getHours() * 60 + now.getMinutes();
  const startMins = 7 * 60;  // grid starts at 07:00
  const endMins   = 22 * 60; // grid ends at 22:00
  const slotH     = 64;      // must match CSS .sched-slot height
  const headerH   = 36;      // approximate height of the header row

  let timeIndicator = '';
  if (S.selDate === todayStr() && nowMins >= startMins && nowMins <= endMins) {
    const pct = (nowMins - startMins) / (endMins - startMins);
    const top  = headerH + pct * (HOURS.length * slotH + 1); // +1 for gaps
    timeIndicator = `<div class="time-indicator" style="top:${top.toFixed(1)}px"></div>`;
  }

  // ── Inject HTML ───────────────────────────────────────────────────────────
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

      <button class="btn btn-ghost btn-sm" id="goto-today">Today</button>
    </div>

    <div class="scheduler-wrap">
      <div class="scheduler-grid" id="sched-grid">
        ${timeIndicator}
        ${headerRow}
        ${bodyRows}
      </div>
    </div>
  `;

  // ── Toolbar event listeners ───────────────────────────────────────────────
  document.getElementById('prev-day').addEventListener('click', () => shiftDay(-1));
  document.getElementById('next-day').addEventListener('click', () => shiftDay(+1));
  document.getElementById('goto-today').addEventListener('click', async () => {
    S.selDate = todayStr();
    S.calDate = new Date();
    await loadBookings();
    renderSidebar();
    renderScheduler();
  });

  // ── Grid: event delegation ────────────────────────────────────────────────
  // ONE click listener on the entire grid catches all slot interactions.
  // This is reliable regardless of how/when slots are rendered.
  document.getElementById('sched-grid').addEventListener('click', async e => {
    const slot = e.target.closest('.sched-slot');
    if (!slot) return; // click was on a non-slot area (header, time label)

    // ── Book an available slot ────────────────────────────────────────────
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

    // ── Cancel a booking (own, or admin cancelling any) ───────────────────
    if (slot.classList.contains('mine')) {
      const id      = parseInt(slot.dataset.id, 10);
      const booking = S.bookings.find(b => b.id === id);
      if (!booking) return;

      const confirmed = await Modal.ask(
        'Cancel Booking',
        `Cancel ${booking.court_name} on ${booking.date} at ${fmtHour(booking.start_hour)}?`
      );
      if (!confirmed) return;

      try {
        await api.cancel(id);
        toast('Booking cancelled');
        await loadBookings();
        renderSidebar();
        renderScheduler();
      } catch (err) {
        toast(err.message, 'error');
      }
    }
  });
}

/** Navigates the scheduler by `delta` days (±1). */
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

/** Fetches all admin data in parallel then re-renders the panel. */
async function loadAdminData() {
  [S.adminData.users, S.adminData.bookings] = await Promise.all([
    api.adminUsers(),
    api.adminBookings(),
  ]);
  renderAdmin();
}

/** Renders the admin panel container + dispatches to the active sub-tab. */
function renderAdmin() {
  const content = document.getElementById('content');
  if (!content) return;

  const isLoading = S.adminData.users.length === 0;

  content.innerHTML = `
    <div class="admin-tabs">
      <button class="admin-tab ${S.adminTab === 'users' ? 'active' : ''}" data-tab="users">
        👥 Users
      </button>
      <button class="admin-tab ${S.adminTab === 'bookings' ? 'active' : ''}" data-tab="bookings">
        📋 All Bookings
      </button>
    </div>
    <div id="admin-content">
      ${isLoading
        ? '<div class="loading-overlay"><span class="loader"></span> Loading…</div>'
        : buildAdminPanel()}
    </div>
  `;

  // Sub-tab switching
  content.querySelectorAll('.admin-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      S.adminTab = btn.dataset.tab;
      renderAdmin();
    });
  });

  // Cancel booking buttons (admin bookings tab)
  content.querySelectorAll('[data-cancel-id]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = parseInt(btn.dataset.cancelId, 10);
      const confirmed = await Modal.ask('Cancel Booking', 'Remove this booking from the system?');
      if (!confirmed) return;
      try {
        await api.cancel(id);
        toast('Booking cancelled');
        // Refresh both admin data and the scheduler if it was the same date
        await loadAdminData();
        await loadBookings();
        renderSidebar();
      } catch (err) {
        toast(err.message, 'error');
      }
    });
  });
}

/**
 * Returns the HTML for the active admin sub-tab.
 * Called only when data has loaded.
 */
function buildAdminPanel() {
  if (S.adminTab === 'users') {
    const rows = S.adminData.users.map(u => `
      <tr>
        <td>${escHtml(u.name)}</td>
        <td>${escHtml(u.email)}</td>
        <td><span class="badge badge-${u.role}">${u.role}</span></td>
        <td>${new Date(u.created_at).toLocaleDateString()}</td>
      </tr>
    `).join('');

    return `
      <div class="table-wrap">
        <table class="data-table">
          <thead>
            <tr><th>Name</th><th>Email</th><th>Role</th><th>Member since</th></tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>`;
  }

  // Bookings sub-tab
  if (!S.adminData.bookings.length) {
    return `<div class="empty-state"><div class="icon">📭</div>No bookings yet</div>`;
  }

  const rows = S.adminData.bookings.map(b => `
    <tr>
      <td>${escHtml(b.date)}</td>
      <td>${fmtHour(b.start_hour)}</td>
      <td>${escHtml(b.court_name)}</td>
      <td>${escHtml(b.user_name)}</td>
      <td>
        <button class="btn btn-danger btn-sm" data-cancel-id="${b.id}">
          Cancel
        </button>
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


// ── 14. Bootstrap ────────────────────────────────────────────────────────────

/**
 * Application entry point.
 * Attempts to restore an existing session (via the httpOnly cookie),
 * then calls render() to show either the login page or the app.
 */
(async () => {
  try {
    // If a valid JWT cookie exists, these will succeed silently
    S.user   = await api.me();
    S.courts = await api.courts();
    await loadBookings();
  } catch {
    // No session — render() will show the login page
  }
  render();
})();
