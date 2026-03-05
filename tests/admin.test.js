/**
 * Tests for admin-only routes:
 *   GET /api/admin/users
 *   GET /api/admin/bookings
 */

const request = require('supertest');
const { buildTestApp, seedUser } = require('./helpers');

let app, db, admin, user;

beforeEach(() => {
  ({ app, db } = buildTestApp());
  admin = seedUser(db, { name: 'Admin', email: 'admin2@example.com', role: 'admin' });
  user  = seedUser(db, { name: 'Alice', email: 'alice@example.com',  role: 'user'  });
});

// ── GET /api/admin/users ──────────────────────────────────────────────────────

describe('GET /api/admin/users', () => {
  test('admin receives a list of all users', async () => {
    const res = await request(app)
      .get('/api/admin/users')
      .set('Cookie', admin.cookie);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeGreaterThanOrEqual(2); // seeded users + our extras

    const fields = Object.keys(res.body[0]);
    expect(fields).toContain('id');
    expect(fields).toContain('name');
    expect(fields).toContain('email');
    expect(fields).toContain('role');
    expect(fields).not.toContain('password_hash'); // must never be exposed
  });

  test('regular user is denied with 403', async () => {
    const res = await request(app)
      .get('/api/admin/users')
      .set('Cookie', user.cookie);

    expect(res.status).toBe(403);
  });

  test('unauthenticated request is denied with 401', async () => {
    const res = await request(app).get('/api/admin/users');
    expect(res.status).toBe(401);
  });
});

// ── GET /api/admin/bookings ───────────────────────────────────────────────────

describe('GET /api/admin/bookings', () => {
  test('admin receives an array of all bookings', async () => {
    const res = await request(app)
      .get('/api/admin/bookings')
      .set('Cookie', admin.cookie);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  test('regular user is denied with 403', async () => {
    const res = await request(app)
      .get('/api/admin/bookings')
      .set('Cookie', user.cookie);

    expect(res.status).toBe(403);
  });

  test('unauthenticated request is denied with 401', async () => {
    const res = await request(app).get('/api/admin/bookings');
    expect(res.status).toBe(401);
  });
});
