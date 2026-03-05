/**
 * Tests for authentication routes:
 *   POST /api/login
 *   POST /api/logout
 *   GET  /api/me
 */

const request = require('supertest');
const { buildTestApp, makeToken, cookieFor } = require('./helpers');

let app, db;

beforeEach(() => {
  ({ app, db } = buildTestApp());
});

// ── POST /api/login ───────────────────────────────────────────────────────────

describe('POST /api/login', () => {
  test('returns user info and sets httpOnly cookie on valid credentials', async () => {
    const res = await request(app)
      .post('/api/login')
      .send({ email: 'admin@tennis.local', password: 'Admin123!' });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ email: 'admin@tennis.local', role: 'admin' });
    expect(res.body).not.toHaveProperty('password_hash');

    const setCookie = res.headers['set-cookie'];
    expect(setCookie).toBeDefined();
    expect(setCookie[0]).toMatch(/^token=/);
    expect(setCookie[0]).toMatch(/HttpOnly/i);
  });

  test('is case-insensitive on email', async () => {
    const res = await request(app)
      .post('/api/login')
      .send({ email: 'ADMIN@TENNIS.LOCAL', password: 'Admin123!' });

    expect(res.status).toBe(200);
    expect(res.body.email).toBe('admin@tennis.local');
  });

  test('returns 401 for wrong password', async () => {
    const res = await request(app)
      .post('/api/login')
      .send({ email: 'admin@tennis.local', password: 'wrongpassword' });

    expect(res.status).toBe(401);
    expect(res.body).toHaveProperty('error');
  });

  test('returns 401 for non-existent email', async () => {
    const res = await request(app)
      .post('/api/login')
      .send({ email: 'nobody@tennis.local', password: 'Tennis123!' });

    expect(res.status).toBe(401);
  });

  test('returns 400 when email is missing', async () => {
    const res = await request(app)
      .post('/api/login')
      .send({ password: 'Tennis123!' });

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('error');
  });

  test('returns 400 when password is missing', async () => {
    const res = await request(app)
      .post('/api/login')
      .send({ email: 'admin@tennis.local' });

    expect(res.status).toBe(400);
  });

  test('returns 400 when body is empty', async () => {
    const res = await request(app).post('/api/login').send({});
    expect(res.status).toBe(400);
  });

  test('rejects non-string email to prevent type injection', async () => {
    const res = await request(app)
      .post('/api/login')
      .send({ email: { $ne: '' }, password: 'Tennis123!' });

    expect(res.status).toBe(400);
  });
});

// ── POST /api/logout ──────────────────────────────────────────────────────────

describe('POST /api/logout', () => {
  test('returns ok and clears the cookie', async () => {
    const res = await request(app).post('/api/logout');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });

    const setCookie = res.headers['set-cookie'];
    // The token cookie should be cleared (max-age=0 or expires in the past)
    expect(setCookie).toBeDefined();
    expect(setCookie[0]).toMatch(/token=/);
  });
});

// ── GET /api/me ───────────────────────────────────────────────────────────────

describe('GET /api/me', () => {
  test('returns current user for a valid token', async () => {
    const token = makeToken({ id: 1, name: 'Admin', email: 'admin@tennis.local', role: 'admin' });

    const res = await request(app)
      .get('/api/me')
      .set('Cookie', cookieFor(token));

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ email: 'admin@tennis.local', role: 'admin' });
  });

  test('returns 401 with no token', async () => {
    const res = await request(app).get('/api/me');
    expect(res.status).toBe(401);
  });

  test('returns 401 for an invalid/tampered token', async () => {
    const res = await request(app)
      .get('/api/me')
      .set('Cookie', 'token=this.is.not.a.valid.jwt');

    expect(res.status).toBe(401);
  });

  test('returns 401 for an expired token', async () => {
    const jwt = require('jsonwebtoken');
    const SECRET = process.env.JWT_SECRET || 'change-this-secret-in-production-use-env-var';
    const expired = jwt.sign(
      { id: 1, name: 'Admin', email: 'admin@tennis.local', role: 'admin' },
      SECRET,
      { expiresIn: -1 } // already expired
    );

    const res = await request(app)
      .get('/api/me')
      .set('Cookie', cookieFor(expired));

    expect(res.status).toBe(401);
  });
});
