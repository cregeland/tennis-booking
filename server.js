const express = require('express');
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const cookieParser = require('cookie-parser');
const path = require('path');

const app = express();
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

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'user' CHECK(role IN ('user','admin')),
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

// Auth middleware
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

// ── Auth Routes ──────────────────────────────────────────────────────────────

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

// ── Courts ───────────────────────────────────────────────────────────────────

app.get('/api/courts', authenticate, (req, res) => {
  res.json(db.prepare('SELECT * FROM courts ORDER BY id').all());
});

// ── Bookings ─────────────────────────────────────────────────────────────────

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

  // Prevent booking in the past (allow today's future hours)
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

  db.prepare('DELETE FROM bookings WHERE id = ?').run(id);
  res.json({ ok: true });
});

// ── Admin Routes ─────────────────────────────────────────────────────────────

app.get('/api/admin/users', authenticate, requireAdmin, (req, res) => {
  res.json(db.prepare('SELECT id, name, email, role, created_at FROM users ORDER BY id').all());
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

app.listen(PORT, '0.0.0.0', () =>
  console.log(`Tennis booking running on http://0.0.0.0:${PORT}`)
);
