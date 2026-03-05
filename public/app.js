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

/** Formats an integer hour as 24-hour "HH:00" (Norwegian standard). */
function fmtHour(h) {
  return `${String(h).padStart(2, '0')}:00`;
}

/**
 * Formats a YYYY-MM-DD string as Norwegian short date: "06.03.2026".
 * Used in table cells and compact displays.
 */
function fmtDateNO(dateStr) {
  const d = new Date(dateStr + 'T12:00:00');
  return d.toLocaleDateString('nb-NO', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

/**
 * Formats a YYYY-MM-DD string as full Norwegian long date: "fredag 6. mars 2026".
 * Used as the scheduler day heading.
 */
function fmtDateLongNO(dateStr) {
  const d = new Date(dateStr + 'T12:00:00');
  return d.toLocaleDateString('nb-NO', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
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
  login:   (email, password)              => apiFetch('/api/login',  { method: 'POST', body: JSON.stringify({ email, password }) }),
  logout:  ()                             => apiFetch('/api/logout',  { method: 'POST' }),
  me:      ()                             => apiFetch('/api/me'),

  // Data
  courts:  ()                             => apiFetch('/api/courts'),
  bookings:(date)                         => apiFetch(`/api/bookings?date=${date}`),
  book:    (court_id, date, start_hour)   => apiFetch('/api/bookings', { method: 'POST', body: JSON.stringify({ court_id, date, start_hour }) }),
  edit:    (id, court_id, date, start_hour) => apiFetch(`/api/bookings/${id}`, { method: 'PUT',  body: JSON.stringify({ court_id, date, start_hour }) }),
  cancel:  (id)                           => apiFetch(`/api/bookings/${id}`, { method: 'DELETE' }),

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


// ── 6b. Edit Booking Modal ───────────────────────────────────────────────────
/**
 * Singleton controller for the edit-booking bottom sheet.
 * Like Modal, event listeners are wired once at init.
 * EditModal.open(booking) resolves with the updated booking or null (closed/deleted).
 */
const EditModal = (() => {
  let onSave   = null; // called with (court_id, date, start_hour)
  let onDelete = null; // called with ()
  let onClose  = null; // called with ()

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

  // Populate available time slots whenever date changes
  async function refreshTimes(currentCourtId, currentHour, currentDate) {
    const selDate  = dateEl.value;
    const selCourt = parseInt(courtEl.value, 10);
    if (!selDate) return;

    timeEl.innerHTML = '<option disabled>Loading…</option>';
    try {
      const bookings = await api.bookings(selDate);
      // Build set of taken slots for the selected court (excluding current booking's slot on same date)
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
      // Default-select first available slot if current is not available
      if (timeEl.value === '') {
        const first = timeEl.querySelector('option:not([disabled])');
        if (first) first.selected = true;
      }
    } catch {
      timeEl.innerHTML = '<option disabled>Error loading slots</option>';
    }
  }

  // Re-fetch times when date or court changes
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

  delBtn.addEventListener('click', () => {
    onDelete?.();
    close();
  });

  const dismiss = () => { onClose?.(); close(); };
  closeBtn .addEventListener('click', dismiss);
  cancelBtn.addEventListener('click', dismiss);
  overlay  .addEventListener('click', e => { if (e.target === overlay) dismiss(); });

  document.addEventListener('keydown', e => {
    if (overlay.classList.contains('active') && e.key === 'Escape') dismiss();
  });

  return {
    /**
     * Opens the edit sheet pre-filled with the given booking.
     * Returns a Promise resolving to:
     *   { action:'save', court_id, date, start_hour } — user saved
     *   { action:'delete' }                           — user deleted
     *   null                                          — user dismissed
     */
    open(booking) {
      titleEl.textContent = `Edit – ${booking.court_name}`;

      // Fill court dropdown
      courtEl.innerHTML = S.courts.map(c =>
        `<option value="${c.id}" ${c.id === booking.court_id ? 'selected' : ''}>${escHtml(c.name)}</option>`
      ).join('');

      // Fill date
      dateEl.value = booking.date;

      // Fill time slots (async)
      refreshTimes(booking.court_id, booking.start_hour, booking.date);

      overlay.classList.add('active');
      dateEl.focus();

      return new Promise(resolve => {
        onSave   = (court_id, date, start_hour) => resolve({ action: 'save', court_id, date, start_hour });
        onDelete = ()                            => resolve({ action: 'delete' });
        onClose  = ()                            => resolve(null);
      });
    },
  };
})();

// ── 6c. Calendar Export ──────────────────────────────────────────────────────
/**
 * Triggers download of user's upcoming bookings as a .ics file.
 * On iOS, Safari will prompt to open the file in Calendar.app automatically.
 */
function exportCalendar(adminAll = false) {
  const url = adminAll ? '/api/calendar/all.ics' : '/api/calendar/mine.ics';
  // Create a temporary link and click it — works on all browsers including iOS Safari
  const a = document.createElement('a');
  a.href = url;
  a.download = adminAll ? 'alle-bestillinger.ics' : 'mine-bestillinger.ics';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

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
    app.innerHTML = '';
    renderLogin();
    return;
  }

  // First time entering the app after login — build the shell.
  // Bottom nav (#bottom-nav) is positioned fixed and lives outside #main-view.
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

/** Dispatches to the correct content view based on S.view. */
function renderMainContent() {
  if (S.view === 'scheduler') renderScheduler();
  else                        renderAdmin();
}

/**
 * Bottom navigation bar — shown only on mobile via CSS.
 * Mirrors the top nav tabs so touch users have a thumb-reachable switch.
 */
function renderBottomNav() {
  const inner = document.querySelector('#bottom-nav .bnav-inner');
  if (!inner) return;

  const tabs = [{ view: 'scheduler', icon: '📅', label: 'Book' }];
  if (S.user?.role === 'admin') tabs.push({ view: 'admin', icon: '⚙️', label: 'Admin' });

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
      if (S.view === 'admin') loadAdminData();
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
  // Norwegian weeks start on Monday: shift getDay() so Mon=0, Sun=6
  const firstDay    = (new Date(y, m, 1).getDay() + 6) % 7;
  const daysInMonth = new Date(y, m + 1, 0).getDate();
  const monthLabel  = S.calDate.toLocaleString('nb-NO', { month: 'long', year: 'numeric' });
  const tStr        = todayStr();

  // Norwegian abbreviated day names starting Monday
  const dayLabels = ['Ma','Ti','On','To','Fr','Lø','Sø']
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

  // Norwegian long date heading e.g. "fredag 6. mars 2026"
  const dateLabel = fmtDateLongNO(S.selDate);

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
          <div class="sched-slot ${cls}" data-id="${booking.id}">
            <div class="slot-pill">
              <div class="slot-avatar">${av}</div>
              <div class="slot-info">
                <div class="slot-name">${name}</div>
              </div>
              ${canCancel
                // Cancel button is always rendered; CSS controls visibility per device type.
                // On touch (hover:none) it's always visible.
                // On mouse (hover:hover) it fades in on slot hover.
                ? `<button class="slot-cancel" title="Cancel booking" aria-label="Cancel booking">✕</button>`
                : ''}
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

  document.getElementById('export-cal').addEventListener('click', () => exportCalendar(false));
  document.getElementById('export-cal-all')?.addEventListener('click', () => exportCalendar(true));

  // ── Grid: event delegation ────────────────────────────────────────────────
  // One listener on the grid handles all slot and button clicks.
  const grid = document.getElementById('sched-grid');

  grid.addEventListener('click', async e => {
    // If user tapped the cancel button specifically, handle cancel directly.
    // stopPropagation is NOT used — we let it bubble and also match the slot below,
    // but we exit early from the 'mine' handler if it came from the cancel btn.
    const cancelBtn = e.target.closest('.slot-cancel');
    const slot      = e.target.closest('.sched-slot');
    if (!slot) return;

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

    // ── Edit / delete own booking ─────────────────────────────────────────
    // Opens the edit sheet where user can move or delete the booking.
    if (slot.classList.contains('mine')) {
      const id      = parseInt(slot.dataset.id, 10);
      const booking = S.bookings.find(b => b.id === id);
      if (!booking) return;

      const result = await EditModal.open(booking);
      if (!result) return; // dismissed with no action

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

  // ── Swipe left/right to change day (touch devices) ───────────────────────
  // Uses the scheduler wrapper (not the grid) so horizontal grid scroll
  // doesn't conflict — only a fast horizontal swipe changes the day.
  const wrap = content.querySelector('.scheduler-wrap');
  let swipeStartX = 0;
  let swipeStartY = 0;

  wrap.addEventListener('touchstart', e => {
    swipeStartX = e.changedTouches[0].clientX;
    swipeStartY = e.changedTouches[0].clientY;
  }, { passive: true });

  wrap.addEventListener('touchend', e => {
    const dx = e.changedTouches[0].clientX - swipeStartX;
    const dy = e.changedTouches[0].clientY - swipeStartY;
    // Only trigger if horizontal motion dominates (not a vertical scroll)
    // and the swipe is at least 60px
    if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) {
      shiftDay(dx < 0 ? 1 : -1);
    }
  }, { passive: true });
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
      <td>${fmtDateNO(b.date)}</td>
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
