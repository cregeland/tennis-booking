'use strict';

// ── State ────────────────────────────────────────────────────────────────────
const S = {
  user:      null,
  courts:    [],
  bookings:  [],
  view:      'scheduler',  // 'scheduler' | 'admin'
  adminTab:  'users',      // 'users' | 'bookings'
  adminData: { users: [], bookings: [] },
  calDate:   new Date(),   // month shown in mini-calendar
  selDate:   today(),      // selected date (YYYY-MM-DD string)
  loading:   false,
  darkMode:  (localStorage.getItem('dark') === '1') ||
             (window.matchMedia('(prefers-color-scheme: dark)').matches && localStorage.getItem('dark') !== '0'),
};

// ── Helpers ──────────────────────────────────────────────────────────────────
function today() {
  const d = new Date();
  return fmtDate(d);
}

function fmtDate(d) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

function fmtHour(h) {
  const ampm = h >= 12 ? 'PM' : 'AM';
  const h12  = h % 12 || 12;
  return `${h12}:00 ${ampm}`;
}

function isPast(dateStr, hour) {
  const slot = new Date(`${dateStr}T${String(hour).padStart(2,'0')}:00:00`);
  return slot < new Date();
}

function escHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ── API ──────────────────────────────────────────────────────────────────────
async function apiFetch(url, opts = {}) {
  const r = await fetch(url, {
    headers: { 'Content-Type': 'application/json' },
    ...opts
  });
  const data = await r.json();
  if (!r.ok) throw new Error(data.error || 'Request failed');
  return data;
}

const api = {
  login:          (email, password)       => apiFetch('/api/login',  { method:'POST', body: JSON.stringify({email,password}) }),
  logout:         ()                      => apiFetch('/api/logout',  { method:'POST' }),
  me:             ()                      => apiFetch('/api/me'),
  courts:         ()                      => apiFetch('/api/courts'),
  bookings:       (date)                  => apiFetch(`/api/bookings?date=${date}`),
  book:           (court_id,date,start_hour) => apiFetch('/api/bookings', { method:'POST', body: JSON.stringify({court_id,date,start_hour}) }),
  cancel:         (id)                    => apiFetch(`/api/bookings/${id}`, { method:'DELETE' }),
  adminUsers:     ()                      => apiFetch('/api/admin/users'),
  adminBookings:  ()                      => apiFetch('/api/admin/bookings'),
};

// ── Toast ────────────────────────────────────────────────────────────────────
function toast(msg, type = 'success') {
  const el = document.createElement('div');
  el.className = `toast-msg ${type}`;
  el.textContent = msg;
  document.getElementById('toast').appendChild(el);
  setTimeout(() => el.remove(), 2900);
}

// ── Modal ────────────────────────────────────────────────────────────────────
function confirm(msg) {
  return new Promise(resolve => {
    const overlay = document.getElementById('modal-overlay');
    document.getElementById('modal-msg').textContent = msg;
    overlay.hidden = false;

    const ok  = document.getElementById('modal-confirm');
    const no  = document.getElementById('modal-cancel');

    function cleanup(val) {
      overlay.hidden = true;
      ok.onclick = null;
      no.onclick = null;
      resolve(val);
    }
    ok.onclick = () => cleanup(true);
    no.onclick = () => cleanup(false);
  });
}

// ── Dark mode ────────────────────────────────────────────────────────────────
function applyTheme() {
  document.documentElement.setAttribute('data-theme', S.darkMode ? 'dark' : 'light');
}
function toggleDark() {
  S.darkMode = !S.darkMode;
  localStorage.setItem('dark', S.darkMode ? '1' : '0');
  applyTheme();
  renderNav();
}
applyTheme();

// ── Router / Root render ─────────────────────────────────────────────────────
function render() {
  if (!S.user) {
    renderLogin();
  } else {
    renderNav();
    renderMain();
  }
}

// ── Login ────────────────────────────────────────────────────────────────────
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
        <form class="login-form" id="login-form">
          <div id="login-error" class="login-error hidden"></div>
          <div>
            <label for="email">Email</label>
            <input id="email" type="email" placeholder="you@tennis.local" autocomplete="email" required>
          </div>
          <div>
            <label for="password">Password</label>
            <input id="password" type="password" placeholder="••••••••" autocomplete="current-password" required>
          </div>
          <button type="submit" class="btn btn-primary" id="login-btn">Sign In</button>
        </form>
        <div class="login-hint">
          <strong>Admin:</strong> admin@tennis.local / Admin123!<br>
          <strong>Users:</strong> emma@tennis.local … / Tennis123!
        </div>
      </div>
    </div>
  `;

  document.getElementById('login-form').addEventListener('submit', async e => {
    e.preventDefault();
    const btn = document.getElementById('login-btn');
    const errEl = document.getElementById('login-error');
    const email = document.getElementById('email').value.trim();
    const pass  = document.getElementById('password').value;

    btn.disabled = true;
    btn.innerHTML = '<span class="loader"></span> Signing in…';
    errEl.classList.add('hidden');

    try {
      S.user = await api.login(email, pass);
      [S.courts] = await Promise.all([api.courts()]);
      await loadBookings();
      render();
    } catch (err) {
      errEl.textContent = err.message;
      errEl.classList.remove('hidden');
      btn.disabled = false;
      btn.textContent = 'Sign In';
    }
  });
}

// ── Nav ──────────────────────────────────────────────────────────────────────
function renderNav() {
  const existing = document.getElementById('navbar');
  const nav = existing || document.createElement('nav');
  nav.id = 'navbar';

  nav.innerHTML = `
    <div class="nav-logo">
      <div class="logo-icon">🎾</div>
      <span class="logo-text">TennisPro</span>
    </div>
    <div class="nav-divider"></div>
    <button class="nav-tab ${S.view==='scheduler'?'active':''}" data-view="scheduler">📅 Book</button>
    ${S.user?.role === 'admin' ? `<button class="nav-tab ${S.view==='admin'?'active':''}" data-view="admin">⚙️ Admin</button>` : ''}
    <span class="nav-user ml-auto">Signed in as <span>${escHtml(S.user?.name||'')}</span></span>
    <button class="btn-icon" id="dark-toggle" title="Toggle dark mode">${S.darkMode ? '☀️' : '🌙'}</button>
    <button class="btn btn-ghost btn-sm" id="logout-btn">Sign out</button>
  `;

  if (!existing) document.getElementById('app').prepend(nav);

  nav.querySelectorAll('[data-view]').forEach(btn => {
    btn.addEventListener('click', () => {
      S.view = btn.dataset.view;
      if (S.view === 'admin') loadAdminData();
      renderNav();
      renderMainContent();
    });
  });

  document.getElementById('dark-toggle').addEventListener('click', toggleDark);

  document.getElementById('logout-btn').addEventListener('click', async () => {
    await api.logout().catch(() => {});
    S.user = null; S.bookings = [];
    render();
  });
}

// ── Main layout ──────────────────────────────────────────────────────────────
function renderMain() {
  const app = document.getElementById('app');
  if (!document.getElementById('main-view')) {
    app.innerHTML += `
      <div id="main-view">
        <aside id="sidebar"></aside>
        <main id="content"></main>
      </div>
    `;
  }
  renderSidebar();
  renderMainContent();
}

function renderMainContent() {
  if (S.view === 'scheduler') renderScheduler();
  else renderAdmin();
}

// ── Sidebar ──────────────────────────────────────────────────────────────────
function renderSidebar() {
  const sidebar = document.getElementById('sidebar');
  if (!sidebar) return;

  // Count my bookings for selected date
  const myToday = S.bookings.filter(b => b.user_id === S.user.id).length;

  sidebar.innerHTML = `
    <div class="mini-cal" id="mini-cal"></div>
    <div>
      <div class="sidebar-section-title">Today's Summary</div>
      <div class="stat-row">
        <span>My bookings (${S.selDate})</span>
        <span class="stat-badge">${myToday}</span>
      </div>
      <div class="stat-row">
        <span>Total booked slots</span>
        <span class="stat-badge">${S.bookings.length}</span>
      </div>
      <div class="stat-row">
        <span>Available slots</span>
        <span class="stat-badge">${5 * 15 - S.bookings.length}</span>
      </div>
    </div>
  `;

  renderMiniCal();
}

// ── Mini Calendar ────────────────────────────────────────────────────────────
function renderMiniCal() {
  const el = document.getElementById('mini-cal');
  if (!el) return;

  const y  = S.calDate.getFullYear();
  const m  = S.calDate.getMonth();
  const todayStr = today();
  const firstDay = new Date(y, m, 1).getDay();
  const daysInMonth = new Date(y, m+1, 0).getDate();
  const monthName = S.calDate.toLocaleString('default', { month: 'long', year: 'numeric' });

  const dayLabels = ['Su','Mo','Tu','We','Th','Fr','Sa'].map(d =>
    `<div class="mini-cal-day-label">${d}</div>`).join('');

  let cells = '';
  for (let i = 0; i < firstDay; i++) cells += `<div class="mini-cal-day empty"></div>`;
  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = `${y}-${String(m+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
    const isToday    = dateStr === todayStr;
    const isSelected = dateStr === S.selDate;
    cells += `<button class="mini-cal-day${isToday?' today':''}${isSelected?' selected':''}" data-date="${dateStr}">${d}</button>`;
  }

  el.innerHTML = `
    <div class="mini-cal-header">
      <button class="btn-icon" id="cal-prev">‹</button>
      <h3>${monthName}</h3>
      <button class="btn-icon" id="cal-next">›</button>
    </div>
    <div class="mini-cal-grid">
      ${dayLabels}
      ${cells}
    </div>
  `;

  el.querySelector('#cal-prev').addEventListener('click', () => {
    S.calDate = new Date(y, m-1, 1);
    renderMiniCal();
  });
  el.querySelector('#cal-next').addEventListener('click', () => {
    S.calDate = new Date(y, m+1, 1);
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

// ── Load bookings ────────────────────────────────────────────────────────────
async function loadBookings() {
  S.bookings = await api.bookings(S.selDate);
}

// ── Scheduler ────────────────────────────────────────────────────────────────
const HOURS = Array.from({ length: 15 }, (_, i) => i + 7); // 7..21

function renderScheduler() {
  const content = document.getElementById('content');
  if (!content) return;

  const selDateObj = new Date(S.selDate + 'T12:00:00');
  const dateLabel  = selDateObj.toLocaleDateString('default', { weekday:'long', year:'numeric', month:'long', day:'numeric' });

  // Build lookup: bookingMap[courtId][hour] = booking
  const bookingMap = {};
  S.courts.forEach(c => { bookingMap[c.id] = {}; });
  S.bookings.forEach(b => { bookingMap[b.court_id][b.start_hour] = b; });

  // Grid header
  const headerCells = `<div class="sched-cell sched-court-header corner"></div>` +
    S.courts.map(c => `<div class="sched-cell sched-court-header">${escHtml(c.name)}</div>`).join('');

  // Grid body rows
  const bodyRows = HOURS.map(h => {
    const timeCell = `<div class="sched-cell sched-time">${fmtHour(h)}</div>`;
    const slotCells = S.courts.map(c => {
      const booking = bookingMap[c.id]?.[h];
      const past    = isPast(S.selDate, h);

      if (booking) {
        const mine = booking.user_id === S.user.id || S.user.role === 'admin';
        const cls  = mine ? 'mine' : 'others';
        const tip  = mine
          ? (S.user.role === 'admin' && booking.user_id !== S.user.id
              ? `Cancel ${booking.user_name}'s booking`
              : 'Click to cancel your booking')
          : booking.user_name;
        return `<div class="sched-cell sched-slot ${cls}" data-id="${booking.id}" title="${escHtml(tip)}">
          <div class="slot-inner">
            ${mine ? '<span class="slot-cancel-icon">✕</span>' : ''}
            <span class="slot-name">${escHtml(booking.user_name)}</span>
          </div>
        </div>`;
      }

      if (past) {
        return `<div class="sched-cell sched-slot past"><div class="slot-inner"></div></div>`;
      }

      return `<div class="sched-cell sched-slot available" data-court="${c.id}" data-hour="${h}" title="Book ${escHtml(c.name)} at ${fmtHour(h)}"></div>`;
    }).join('');

    return timeCell + slotCells;
  }).join('');

  content.innerHTML = `
    <div class="scheduler-header-row">
      <div class="scheduler-date-nav">
        <button class="btn-icon" id="prev-day">‹</button>
        <h2>${escHtml(dateLabel)}</h2>
        <button class="btn-icon" id="next-day">›</button>
      </div>
      <div class="legend">
        <div class="legend-item"><div class="legend-dot avail"></div> Available</div>
        <div class="legend-item"><div class="legend-dot mine"></div> Your booking</div>
        <div class="legend-item"><div class="legend-dot others"></div> Booked</div>
      </div>
      <button class="btn btn-ghost btn-sm" id="goto-today">Today</button>
    </div>
    <div style="overflow-x:auto">
      <div class="scheduler-grid">
        ${headerCells}
        ${bodyRows}
      </div>
    </div>
  `;

  // Date navigation
  document.getElementById('prev-day').addEventListener('click', () => shiftDay(-1));
  document.getElementById('next-day').addEventListener('click', () => shiftDay(1));
  document.getElementById('goto-today').addEventListener('click', async () => {
    S.selDate = today();
    S.calDate = new Date();
    await loadBookings();
    renderSidebar();
    renderScheduler();
  });

  // Book slot
  content.querySelectorAll('.sched-slot.available').forEach(el => {
    el.addEventListener('click', async () => {
      const courtId = parseInt(el.dataset.court, 10);
      const hour    = parseInt(el.dataset.hour, 10);
      const court   = S.courts.find(c => c.id === courtId);
      const ok = await confirm(`Book ${court?.name} on ${S.selDate} at ${fmtHour(hour)}?`);
      if (!ok) return;
      try {
        await api.book(courtId, S.selDate, hour);
        toast(`Booked ${court?.name} at ${fmtHour(hour)}`);
        await loadBookings();
        renderSidebar();
        renderScheduler();
      } catch (e) {
        toast(e.message, 'error');
      }
    });
  });

  // Cancel booking
  content.querySelectorAll('.sched-slot.mine').forEach(el => {
    el.addEventListener('click', async () => {
      const id      = parseInt(el.dataset.id, 10);
      const booking = S.bookings.find(b => b.id === id);
      if (!booking) return;
      const ok = await confirm(`Cancel booking for ${booking.court_name} at ${fmtHour(booking.start_hour)} on ${booking.date}?`);
      if (!ok) return;
      try {
        await api.cancel(id);
        toast('Booking cancelled');
        await loadBookings();
        renderSidebar();
        renderScheduler();
      } catch (e) {
        toast(e.message, 'error');
      }
    });
  });
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

// ── Admin ────────────────────────────────────────────────────────────────────
async function loadAdminData() {
  [S.adminData.users, S.adminData.bookings] = await Promise.all([
    api.adminUsers(), api.adminBookings()
  ]);
  renderAdmin();
}

function renderAdmin() {
  const content = document.getElementById('content');
  if (!content) return;

  content.innerHTML = `
    <div class="admin-tabs">
      <button class="admin-tab ${S.adminTab==='users'?'active':''}" data-tab="users">👥 Users</button>
      <button class="admin-tab ${S.adminTab==='bookings'?'active':''}" data-tab="bookings">📋 All Bookings</button>
    </div>
    <div id="admin-panel-content">
      ${S.adminData.users.length === 0
        ? `<div class="loading-overlay"><span class="loader"></span> Loading…</div>`
        : renderAdminPanel()}
    </div>
  `;

  content.querySelectorAll('.admin-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      S.adminTab = btn.dataset.tab;
      renderAdmin();
    });
  });

  content.querySelectorAll('[data-cancel-id]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = parseInt(btn.dataset.cancelId, 10);
      const ok = await confirm('Cancel this booking?');
      if (!ok) return;
      try {
        await api.cancel(id);
        toast('Booking cancelled');
        await loadAdminData();
        if (S.selDate) { await loadBookings(); renderSidebar(); }
      } catch (e) { toast(e.message, 'error'); }
    });
  });
}

function renderAdminPanel() {
  if (S.adminTab === 'users') {
    const rows = S.adminData.users.map(u => `
      <tr>
        <td>${escHtml(u.name)}</td>
        <td>${escHtml(u.email)}</td>
        <td><span class="badge badge-${u.role}">${u.role}</span></td>
        <td>${new Date(u.created_at).toLocaleDateString()}</td>
      </tr>`).join('');
    return `
      <div class="table-wrap">
        <table class="data-table">
          <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Joined</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>`;
  } else {
    if (!S.adminData.bookings.length) return `<div class="empty-state"><div class="icon">📭</div>No bookings yet</div>`;
    const rows = S.adminData.bookings.map(b => `
      <tr>
        <td>${escHtml(b.date)}</td>
        <td>${fmtHour(b.start_hour)}</td>
        <td>${escHtml(b.court_name)}</td>
        <td>${escHtml(b.user_name)}</td>
        <td><button class="btn btn-danger btn-sm" data-cancel-id="${b.id}">Cancel</button></td>
      </tr>`).join('');
    return `
      <div class="table-wrap">
        <table class="data-table">
          <thead><tr><th>Date</th><th>Time</th><th>Court</th><th>User</th><th></th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>`;
  }
}

// ── Boot ─────────────────────────────────────────────────────────────────────
(async () => {
  try {
    S.user   = await api.me();
    S.courts = await api.courts();
    await loadBookings();
  } catch { /* not logged in */ }
  render();
})();
