/**
 * Shared test helpers: in-memory database setup, token generation, and
 * a future-date factory so tests aren't time-sensitive.
 */

const Database = require('better-sqlite3');
const bcrypt   = require('bcryptjs');
const jwt      = require('jsonwebtoken');
const { createApp, initDb } = require('../server');

const JWT_SECRET = process.env.JWT_SECRET || 'change-this-secret-in-production-use-env-var';

/** Returns a YYYY-MM-DD string N days from today. */
function futureDate(daysAhead = 1) {
  const d = new Date();
  d.setDate(d.getDate() + daysAhead);
  return d.toISOString().slice(0, 10);
}

/** Creates a fresh in-memory database and returns a configured supertest app. */
function buildTestApp() {
  const db = new Database(':memory:');
  initDb(db);
  const app = createApp(db);
  return { app, db };
}

/** Signs a JWT the same way the real server does. */
function makeToken(payload) {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: '1h' });
}

/** Returns a cookie header string for the given JWT token. */
function cookieFor(token) {
  return `token=${token}`;
}

/** Inserts a bare-minimum user and returns their id + a valid cookie header. */
function seedUser(db, { name = 'Test User', email = 'test@example.com', role = 'user' } = {}) {
  const hash = bcrypt.hashSync('Password1!', 4); // low cost for speed
  const result = db.prepare(
    'INSERT INTO users (name, email, password_hash, role) VALUES (?,?,?,?)'
  ).run(name, email, hash, role);
  const id = result.lastInsertRowid;
  const token = makeToken({ id, name, email, role });
  return { id, name, email, role, token, cookie: cookieFor(token) };
}

/** Inserts a booking directly into the DB and returns its id. */
function seedBooking(db, { courtId = 1, userId, date, startHour = 10 } = {}) {
  const result = db.prepare(
    'INSERT INTO bookings (court_id, user_id, date, start_hour, end_hour) VALUES (?,?,?,?,?)'
  ).run(courtId, userId, date, startHour, startHour + 1);
  return result.lastInsertRowid;
}

module.exports = { buildTestApp, makeToken, cookieFor, seedUser, seedBooking, futureDate };
