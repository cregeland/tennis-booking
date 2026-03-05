require('dotenv').config();
const http        = require('http');
const express     = require('express');
const { WebSocketServer } = require('ws');
const Database    = require('better-sqlite3');
const bcrypt      = require('bcryptjs');
const jwt         = require('jsonwebtoken');
const helmet      = require('helmet');
const rateLimit   = require('express-rate-limit');
const cookieParser= require('cookie-parser');
const path        = require('path');
const os          = require('os');
const fs          = require('fs');
const { notifyBookingCreated, notifyBookingCancelled } = require('./notifications');

const app = express();
const server = http.createServer(app);
const JWT_SECRET = process.env.JWT_SECRET || 'change-this-secret-in-production-use-env-var';
const PORT = process.env.PORT || 3000;

// Security middleware
app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: '10kb' }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

// Rate limiting
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 15,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many login attempts, please try again later.' }
});

const apiLimiter = rateLimit({
  windowMs: 1 * 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false
});

app.use('/api/', apiLimiter);

// Database
const db = new Database(path.join(__dirname, 'tennis.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// Migrate: add phone column if not present
const cols = db.prepare("PRAGMA table_info(users)").all().map(c => c.name);
if (!cols.includes('phone')) {
  db.exec("ALTER TABLE users ADD COLUMN phone TEXT");
}

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'user' CHECK(role IN ('user','admin')),
    phone TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS courts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS bookings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    court_id INTEGER NOT NULL REFERENCES courts(id),
    user_id INTEGER NOT NULL REFERENCES users(id),
    date TEXT NOT NULL,
    start_hour INTEGER NOT NULL CHECK(start_hour >= 7 AND start_hour <= 21),
    end_hour INTEGER NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(court_id, date, start_hour)
  );
  CREATE INDEX IF NOT EXISTS idx_bookings_date ON bookings(date);
`);

// Seed
const userCount = db.prepare('SELECT COUNT(*) as c FROM users').get().c;
if (userCount === 0) {
  const users = [
    { name: 'Admin',            email: 'admin@tennis.local',    password: 'Admin123!',   role: 'admin' },
    { name: 'Emma Johnson',     email: 'emma@tennis.local',     password: 'Tennis123!',  role: 'user' },
    { name: 'Liam Anderson',    email: 'liam@tennis.local',     password: 'Tennis123!',  role: 'user' },
    { name: 'Sofia Martinez',   email: 'sofia@tennis.local',    password: 'Tennis123!',  role: 'user' },
    { name: 'Noah Williams',    email: 'noah@tennis.local',     password: 'Tennis123!',  role: 'user' },
    { name: 'Olivia Chen',      email: 'olivia@tennis.local',   password: 'Tennis123!',  role: 'user' },
    { name: 'James Thompson',   email: 'james@tennis.local',    password: 'Tennis123!',  role: 'user' },
    { name: 'Isabella Davis',   email: 'isabella@tennis.local', password: 'Tennis123!',  role: 'user' },
    { name: 'Ethan Brown',      email: 'ethan@tennis.local',    password: 'Tennis123!',  role: 'user' },
    { name: 'Mia Wilson',       email: 'mia@tennis.local',      password: 'Tennis123!',  role: 'user' },
    { name: 'Alexander Taylor', email: 'alex@tennis.local',     password: 'Tennis123!',  role: 'user' },
  ];
  const ins = db.prepare('INSERT INTO users (name, email, password_hash, role) VALUES (?,?,?,?)');
  for (const u of users) ins.run(u.name, u.email.toLowerCase(), bcrypt.hashSync(u.password, 10), u.role);

  const courtIns = db.prepare('INSERT INTO courts (name) VALUES (?)');
  ['Court 1','Court 2','Court 3','Court 4','Court 5'].forEach(n => courtIns.run(n));
  console.log('Database seeded.');
}

// ── WebSocket Server ──────────────────────────────────────────────────────────

const wss = new WebSocketServer({ server });

// Parse JWT from cookie header string
function parseTokenFromCookieHeader(cookieHeader) {
  if (!cookieHeader) return null;
  const match = cookieHeader.match(/(?:^|;\s*)token=([^;]+)/);
  return match ? match[1] : null;
}

wss.on('connection', (ws, req) => {
  const token = parseTokenFromCookieHeader(req.headers.cookie);
  if (!token) { ws.close(4001, 'Unauthorized'); return; }
  try {
    ws.user = jwt.verify(token, JWT_SECRET);
  } catch {
    ws.close(4001, 'Unauthorized');
    return;
  }
  // Keep connection alive with pings
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });
});

// Ping all clients every 30s to detect dead connections
const pingInterval = setInterval(() => {
  wss.clients.forEach(ws => {
    if (!ws.isAlive) { ws.terminate(); return; }
    ws.isAlive = false;
    ws.ping();
  });
}, 30000);

wss.on('close', () => clearInterval(pingInterval));

/** Broadcast a JSON message to all authenticated connected clients. */
function broadcast(data) {
  const msg = JSON.stringify(data);
  wss.clients.forEach(ws => {
    if (ws.readyState === 1 && ws.user) ws.send(msg);
  });
}

// ── Auth Middleware ───────────────────────────────────────────────────────────

function authenticate(req, res, next) {
  const token = req.cookies.token;
  if (!token) return res.status(401).json({ error: 'Not authenticated' });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    res.clearCookie('token');
    res.status(401).json({ error: 'Session expired, please log in again' });
  }
}

function requireAdmin(req, res, next) {
  if (req.user?.role !== 'admin') return res.status(403).json({ error: 'Admin access required' });
  next();
}

function isValidDate(d) { return /^\d{4}-\d{2}-\d{2}$/.test(d) && !isNaN(Date.parse(d)); }

// ── Auth Routes ───────────────────────────────────────────────────────────────

app.post('/api/login', authLimiter, async (req, res) => {
  try {
    const { email, password } = req.body ?? {};
    if (!email || !password || typeof email !== 'string' || typeof password !== 'string')
      return res.status(400).json({ error: 'Email and password required' });

    const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email.toLowerCase().trim());
    if (!user || !(await bcrypt.compare(password, user.password_hash)))
      return res.status(401).json({ error: 'Invalid email or password' });

    const token = jwt.sign(
      { id: user.id, name: user.name, email: user.email, role: user.role },
      JWT_SECRET,
      { expiresIn: '24h' }
    );
    res.cookie('token', token, {
      httpOnly: true,
      sameSite: 'strict',
      secure: process.env.NODE_ENV === 'production',
      maxAge: 24 * 60 * 60 * 1000
    });
    res.json({ id: user.id, name: user.name, email: user.email, role: user.role });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/api/logout', (req, res) => {
  res.clearCookie('token');
  res.json({ ok: true });
});

app.get('/api/me', authenticate, (req, res) => {
  res.json({ id: req.user.id, name: req.user.name, email: req.user.email, role: req.user.role });
});

// ── Courts ────────────────────────────────────────────────────────────────────

app.get('/api/courts', authenticate, (req, res) => {
  res.json(db.prepare('SELECT * FROM courts ORDER BY id').all());
});

// ── Bookings ──────────────────────────────────────────────────────────────────

app.get('/api/bookings', authenticate, (req, res) => {
  const { date } = req.query;
  if (!isValidDate(date)) return res.status(400).json({ error: 'Valid date required (YYYY-MM-DD)' });
  const rows = db.prepare(`
    SELECT b.id, b.court_id, b.user_id, b.date, b.start_hour, b.end_hour,
           u.name AS user_name, c.name AS court_name
    FROM bookings b
    JOIN users u ON b.user_id = u.id
    JOIN courts c ON b.court_id = c.id
    WHERE b.date = ?
    ORDER BY b.start_hour
  `).all(date);
  res.json(rows);
});

app.post('/api/bookings', authenticate, (req, res) => {
  const { court_id, date, start_hour } = req.body ?? {};
  if (!court_id || !date || start_hour === undefined)
    return res.status(400).json({ error: 'court_id, date, and start_hour required' });
  if (!isValidDate(date)) return res.status(400).json({ error: 'Invalid date' });

  const h = parseInt(start_hour, 10);
  if (isNaN(h) || h < 7 || h > 21) return res.status(400).json({ error: 'Invalid time slot (7–21)' });

  const court = db.prepare('SELECT id FROM courts WHERE id = ?').get(court_id);
  if (!court) return res.status(400).json({ error: 'Invalid court' });

  const slotTime = new Date(`${date}T${String(h).padStart(2,'0')}:00:00`);
  if (slotTime < new Date()) return res.status(400).json({ error: 'Cannot book a past time slot' });

  try {
    const result = db.prepare(`
      INSERT INTO bookings (court_id, user_id, date, start_hour, end_hour) VALUES (?,?,?,?,?)
    `).run(court_id, req.user.id, date, h, h + 1);

    const booking = db.prepare(`
      SELECT b.id, b.court_id, b.user_id, b.date, b.start_hour, b.end_hour,
             u.name AS user_name, c.name AS court_name
      FROM bookings b JOIN users u ON b.user_id=u.id JOIN courts c ON b.court_id=c.id
      WHERE b.id = ?
    `).get(result.lastInsertRowid);

    broadcast({ type: 'bookings_changed', date });
    notifyBookingCreated(
      { email: req.user.email, phone: db.prepare('SELECT phone FROM users WHERE id=?').get(req.user.id)?.phone, name: req.user.name },
      booking
    );
    res.status(201).json(booking);
  } catch (e) {
    if (e.message?.includes('UNIQUE')) return res.status(409).json({ error: 'That slot is already booked' });
    throw e;
  }
});

app.delete('/api/bookings/:id', authenticate, (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) return res.status(400).json({ error: 'Invalid id' });

  const booking = db.prepare('SELECT * FROM bookings WHERE id = ?').get(id);
  if (!booking) return res.status(404).json({ error: 'Booking not found' });

  if (req.user.role !== 'admin' && booking.user_id !== req.user.id)
    return res.status(403).json({ error: 'You can only cancel your own bookings' });

  const booker = db.prepare('SELECT name, email, phone FROM users WHERE id=?').get(booking.user_id);
  const courtName = db.prepare('SELECT name FROM courts WHERE id=?').get(booking.court_id)?.name || '';
  db.prepare('DELETE FROM bookings WHERE id = ?').run(id);
  broadcast({ type: 'bookings_changed', date: booking.date });
  notifyBookingCancelled(booker, { ...booking, court_name: courtName, end_hour: booking.end_hour });
  res.json({ ok: true });
});

app.put('/api/bookings/:id', authenticate, (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) return res.status(400).json({ error: 'Invalid id' });

  const booking = db.prepare('SELECT * FROM bookings WHERE id = ?').get(id);
  if (!booking) return res.status(404).json({ error: 'Booking not found' });

  if (req.user.role !== 'admin' && booking.user_id !== req.user.id)
    return res.status(403).json({ error: 'You can only edit your own bookings' });

  const { court_id, date, start_hour } = req.body ?? {};
  if (!court_id || !date || start_hour === undefined)
    return res.status(400).json({ error: 'court_id, date, and start_hour required' });
  if (!isValidDate(date)) return res.status(400).json({ error: 'Invalid date' });

  const h = parseInt(start_hour, 10);
  if (isNaN(h) || h < 7 || h > 21) return res.status(400).json({ error: 'Invalid time slot (7–21)' });

  if (!db.prepare('SELECT id FROM courts WHERE id = ?').get(court_id))
    return res.status(400).json({ error: 'Invalid court' });

  const slotTime = new Date(`${date}T${String(h).padStart(2, '0')}:00:00`);
  if (slotTime < new Date()) return res.status(400).json({ error: 'Cannot book a past time slot' });

  try {
    const move = db.transaction(() => {
      db.prepare('DELETE FROM bookings WHERE id = ?').run(id);
      return db.prepare(
        'INSERT INTO bookings (court_id, user_id, date, start_hour, end_hour) VALUES (?,?,?,?,?)'
      ).run(court_id, booking.user_id, date, h, h + 1).lastInsertRowid;
    });

    const newId = move();
    const updated = db.prepare(`
      SELECT b.id, b.court_id, b.user_id, b.date, b.start_hour, b.end_hour,
             u.name AS user_name, c.name AS court_name
      FROM bookings b JOIN users u ON b.user_id=u.id JOIN courts c ON b.court_id=c.id
      WHERE b.id = ?
    `).get(newId);

    // Broadcast both old and new date (in case date changed)
    broadcast({ type: 'bookings_changed', date });
    if (booking.date !== date) broadcast({ type: 'bookings_changed', date: booking.date });

    res.json(updated);
  } catch (e) {
    if (e.message?.includes('UNIQUE')) return res.status(409).json({ error: 'That slot is already taken' });
    throw e;
  }
});

// ── Calendar Export (ICS) ─────────────────────────────────────────────────────

function buildICS(bookings, calName) {
  const esc  = s => String(s).replace(/[\\;,]/g, c => '\\' + c);
  const ts   = new Date().toISOString().replace(/[-:]/g,'').replace(/\..+/,'') + 'Z';

  const events = bookings.map(b => {
    const d = b.date.replace(/-/g, '');
    const s = String(b.start_hour).padStart(2, '0');
    const e = String(b.end_hour  ).padStart(2, '0');
    return [
      'BEGIN:VEVENT',
      `UID:booking-${b.id}@tennispro`,
      `DTSTAMP:${ts}`,
      `DTSTART:${d}T${s}0000`,
      `DTEND:${d}T${e}0000`,
      `SUMMARY:${esc(b.court_name)} – Tennis`,
      `DESCRIPTION:Bestilling for ${esc(b.user_name)}`,
      `LOCATION:${esc(b.court_name)}`,
      'STATUS:CONFIRMED',
      'END:VEVENT',
    ].join('\r\n');
  });

  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//TennisPro//Court Booking//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${esc(calName)}`,
    'X-WR-TIMEZONE:Europe/Oslo',
    ...events,
    'END:VCALENDAR',
  ].join('\r\n');
}

app.get('/api/calendar/mine.ics', authenticate, (req, res) => {
  const today = new Date().toISOString().slice(0, 10);
  const rows = db.prepare(`
    SELECT b.id, b.date, b.start_hour, b.end_hour,
           u.name AS user_name, c.name AS court_name
    FROM bookings b JOIN users u ON b.user_id=u.id JOIN courts c ON b.court_id=c.id
    WHERE b.user_id = ? AND b.date >= ?
    ORDER BY b.date, b.start_hour
  `).all(req.user.id, today);

  res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="mine-bestillinger.ics"');
  res.send(buildICS(rows, `${req.user.name} – Tennisbane`));
});

app.get('/api/calendar/all.ics', authenticate, requireAdmin, (req, res) => {
  const today = new Date().toISOString().slice(0, 10);
  const rows = db.prepare(`
    SELECT b.id, b.date, b.start_hour, b.end_hour,
           u.name AS user_name, c.name AS court_name
    FROM bookings b JOIN users u ON b.user_id=u.id JOIN courts c ON b.court_id=c.id
    WHERE b.date >= ?
    ORDER BY b.date, b.start_hour
  `).all(today);

  res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="alle-bestillinger.ics"');
  res.send(buildICS(rows, 'Alle bestillinger – Tennisbane'));
});

// ── Admin Routes ──────────────────────────────────────────────────────────────

app.get('/api/admin/users', authenticate, requireAdmin, (req, res) => {
  res.json(db.prepare('SELECT id, name, email, role, phone, created_at FROM users ORDER BY id').all());
});

// Create user
app.post('/api/admin/users', authenticate, requireAdmin, async (req, res) => {
  try {
    const { name, email, password, role, phone } = req.body ?? {};
    if (!name || !email || !password)
      return res.status(400).json({ error: 'Name, email and password required' });
    if (typeof name !== 'string' || typeof email !== 'string' || typeof password !== 'string')
      return res.status(400).json({ error: 'Invalid input' });
    if (!['user', 'admin'].includes(role))
      return res.status(400).json({ error: 'Role must be user or admin' });
    if (password.length < 6)
      return res.status(400).json({ error: 'Password must be at least 6 characters' });

    const hash = await bcrypt.hash(password, 10);
    const result = db.prepare(
      'INSERT INTO users (name, email, password_hash, role, phone) VALUES (?,?,?,?,?)'
    ).run(name.trim(), email.toLowerCase().trim(), hash, role, phone?.trim() || null);

    const user = db.prepare('SELECT id, name, email, role, phone, created_at FROM users WHERE id = ?')
      .get(result.lastInsertRowid);
    res.status(201).json(user);
  } catch (e) {
    if (e.message?.includes('UNIQUE')) return res.status(409).json({ error: 'Email already in use' });
    console.error(e);
    res.status(500).json({ error: 'Server error' });
  }
});

// Update user
app.put('/api/admin/users/:id', authenticate, requireAdmin, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ error: 'Invalid id' });

    const existing = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
    if (!existing) return res.status(404).json({ error: 'User not found' });

    const { name, email, role, password, phone } = req.body ?? {};
    if (!name || !email) return res.status(400).json({ error: 'Name and email required' });
    if (typeof name !== 'string' || typeof email !== 'string')
      return res.status(400).json({ error: 'Invalid input' });
    if (!['user', 'admin'].includes(role))
      return res.status(400).json({ error: 'Role must be user or admin' });
    // Prevent removing the last admin
    if (existing.role === 'admin' && role === 'user') {
      const adminCount = db.prepare("SELECT COUNT(*) as c FROM users WHERE role = 'admin'").get().c;
      if (adminCount <= 1) return res.status(400).json({ error: 'Cannot demote the last admin' });
    }

    if (password) {
      if (typeof password !== 'string' || password.length < 6)
        return res.status(400).json({ error: 'Password must be at least 6 characters' });
      const hash = await bcrypt.hash(password, 10);
      db.prepare('UPDATE users SET name=?, email=?, role=?, phone=?, password_hash=? WHERE id=?')
        .run(name.trim(), email.toLowerCase().trim(), role, phone?.trim() || null, hash, id);
    } else {
      db.prepare('UPDATE users SET name=?, email=?, role=?, phone=? WHERE id=?')
        .run(name.trim(), email.toLowerCase().trim(), role, phone?.trim() || null, id);
    }

    const user = db.prepare('SELECT id, name, email, role, phone, created_at FROM users WHERE id = ?').get(id);
    res.json(user);
  } catch (e) {
    if (e.message?.includes('UNIQUE')) return res.status(409).json({ error: 'Email already in use' });
    console.error(e);
    res.status(500).json({ error: 'Server error' });
  }
});

// Delete user
app.delete('/api/admin/users/:id', authenticate, requireAdmin, (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) return res.status(400).json({ error: 'Invalid id' });

  if (id === req.user.id) return res.status(400).json({ error: 'Cannot delete your own account' });

  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  if (!user) return res.status(404).json({ error: 'User not found' });

  if (user.role === 'admin') {
    const adminCount = db.prepare("SELECT COUNT(*) as c FROM users WHERE role = 'admin'").get().c;
    if (adminCount <= 1) return res.status(400).json({ error: 'Cannot delete the last admin' });
  }

  // Delete user's bookings first (foreign key), then the user
  db.prepare('DELETE FROM bookings WHERE user_id = ?').run(id);
  db.prepare('DELETE FROM users WHERE id = ?').run(id);
  res.json({ ok: true });
});

app.get('/api/admin/bookings', authenticate, requireAdmin, (req, res) => {
  const rows = db.prepare(`
    SELECT b.id, b.date, b.start_hour, b.end_hour,
           u.name AS user_name, c.name AS court_name
    FROM bookings b
    JOIN users u ON b.user_id = u.id
    JOIN courts c ON b.court_id = c.id
    ORDER BY b.date DESC, b.start_hour
    LIMIT 200
  `).all();
  res.json(rows);
});

// ── System Info ───────────────────────────────────────────────────────────────

app.get('/api/sysinfo', authenticate, (req, res) => {
  const mem   = process.memoryUsage();
  const toMB  = b => Math.round(b / 1024 / 1024 * 10) / 10;
  const load  = os.loadavg();

  const userCount    = db.prepare('SELECT COUNT(*) as c FROM users').get().c;
  const courtCount   = db.prepare('SELECT COUNT(*) as c FROM courts').get().c;
  const bookingCount = db.prepare('SELECT COUNT(*) as c FROM bookings').get().c;

  let dbSizeKB = null;
  try {
    const stat = fs.statSync(path.join(__dirname, 'tennis.db'));
    dbSizeKB = Math.round(stat.size / 1024 * 10) / 10;
  } catch {}

  let pkg = { version: '?' };
  try { pkg = require('./package.json'); } catch {}

  res.json({
    app: { name: 'TennisPro Booking', version: pkg.version },
    server: {
      uptime:      process.uptime(),
      nodeVersion: process.version,
      platform:    `${os.type()} ${os.release()}`,
      loadAvg:     load.map(l => Math.round(l * 100) / 100),
      memUsedMB:   toMB(mem.rss),
      memHeapMB:   toMB(mem.heapUsed),
      memTotalMB:  toMB(os.totalmem()),
      memFreeMB:   toMB(os.freemem()),
      wsClients:   wss.clients.size,
    },
    db: { users: userCount, courts: courtCount, bookings: bookingCount, sizeKB: dbSizeKB },
  });
});

app.get('/api/changelog', authenticate, (req, res) => {
  try {
    const text = fs.readFileSync(path.join(__dirname, 'CHANGELOG.md'), 'utf8');
    res.json({ text });
  } catch {
    res.json({ text: '# Changelog\n\nNot available.' });
  }
});

server.listen(PORT, '0.0.0.0', () =>
  console.log(`Tennis booking running on http://0.0.0.0:${PORT}`)
);
