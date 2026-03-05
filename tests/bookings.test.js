/**
 * Tests for booking routes:
 *   GET    /api/bookings?date=
 *   POST   /api/bookings
 *   DELETE /api/bookings/:id
 *   PUT    /api/bookings/:id
 */

const request = require('supertest');
const { buildTestApp, seedUser, seedBooking, futureDate } = require('./helpers');

let app, db, user, admin, otherUser;

beforeEach(() => {
  ({ app, db } = buildTestApp());
  user      = seedUser(db, { name: 'Alice', email: 'alice@example.com', role: 'user' });
  otherUser = seedUser(db, { name: 'Bob',   email: 'bob@example.com',   role: 'user' });
  admin     = seedUser(db, { name: 'Admin', email: 'admin2@example.com', role: 'admin' });
});

// ── GET /api/bookings ─────────────────────────────────────────────────────────

describe('GET /api/bookings', () => {
  test('returns bookings for a given date', async () => {
    const date = futureDate(5);
    seedBooking(db, { userId: user.id, date, startHour: 10 });

    const res = await request(app)
      .get(`/api/bookings?date=${date}`)
      .set('Cookie', user.cookie);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body).toHaveLength(1);
    expect(res.body[0]).toMatchObject({ date, start_hour: 10, end_hour: 11 });
  });

  test('returns empty array when no bookings exist for the date', async () => {
    const res = await request(app)
      .get(`/api/bookings?date=${futureDate(10)}`)
      .set('Cookie', user.cookie);

    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  test('returns 400 for missing date', async () => {
    const res = await request(app)
      .get('/api/bookings')
      .set('Cookie', user.cookie);

    expect(res.status).toBe(400);
  });

  test('returns 400 for malformed date', async () => {
    const res = await request(app)
      .get('/api/bookings?date=not-a-date')
      .set('Cookie', user.cookie);

    expect(res.status).toBe(400);
  });

  test('returns 401 when unauthenticated', async () => {
    const res = await request(app).get(`/api/bookings?date=${futureDate()}`);
    expect(res.status).toBe(401);
  });
});

// ── POST /api/bookings ────────────────────────────────────────────────────────

describe('POST /api/bookings', () => {
  test('creates a booking and returns it with 201', async () => {
    const date = futureDate(3);

    const res = await request(app)
      .post('/api/bookings')
      .set('Cookie', user.cookie)
      .send({ court_id: 1, date, start_hour: 14 });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      court_id: 1,
      user_id: user.id,
      date,
      start_hour: 14,
      end_hour: 15,
    });
    expect(res.body).toHaveProperty('id');
    expect(res.body).toHaveProperty('user_name', user.name);
    expect(res.body).toHaveProperty('court_name');
  });

  test('returns 409 when the slot is already booked', async () => {
    const date = futureDate(3);
    seedBooking(db, { userId: user.id, date, startHour: 10 });

    const res = await request(app)
      .post('/api/bookings')
      .set('Cookie', otherUser.cookie)
      .send({ court_id: 1, date, start_hour: 10 });

    expect(res.status).toBe(409);
    expect(res.body).toHaveProperty('error');
  });

  test('allows booking the same hour on a different court', async () => {
    const date = futureDate(3);
    seedBooking(db, { courtId: 1, userId: user.id, date, startHour: 10 });

    const res = await request(app)
      .post('/api/bookings')
      .set('Cookie', user.cookie)
      .send({ court_id: 2, date, start_hour: 10 });

    expect(res.status).toBe(201);
  });

  test('returns 400 for start_hour before 7', async () => {
    const res = await request(app)
      .post('/api/bookings')
      .set('Cookie', user.cookie)
      .send({ court_id: 1, date: futureDate(), start_hour: 6 });

    expect(res.status).toBe(400);
  });

  test('returns 400 for start_hour after 21', async () => {
    const res = await request(app)
      .post('/api/bookings')
      .set('Cookie', user.cookie)
      .send({ court_id: 1, date: futureDate(), start_hour: 22 });

    expect(res.status).toBe(400);
  });

  test('returns 400 for an invalid date string', async () => {
    const res = await request(app)
      .post('/api/bookings')
      .set('Cookie', user.cookie)
      .send({ court_id: 1, date: '2025-13-01', start_hour: 10 });

    expect(res.status).toBe(400);
  });

  test('returns 400 for a past date', async () => {
    const res = await request(app)
      .post('/api/bookings')
      .set('Cookie', user.cookie)
      .send({ court_id: 1, date: '2020-01-01', start_hour: 10 });

    expect(res.status).toBe(400);
  });

  test('returns 400 for an invalid court id', async () => {
    const res = await request(app)
      .post('/api/bookings')
      .set('Cookie', user.cookie)
      .send({ court_id: 9999, date: futureDate(), start_hour: 10 });

    expect(res.status).toBe(400);
  });

  test('returns 400 when required fields are missing', async () => {
    const res = await request(app)
      .post('/api/bookings')
      .set('Cookie', user.cookie)
      .send({ court_id: 1 }); // missing date and start_hour

    expect(res.status).toBe(400);
  });

  test('returns 401 when unauthenticated', async () => {
    const res = await request(app)
      .post('/api/bookings')
      .send({ court_id: 1, date: futureDate(), start_hour: 10 });

    expect(res.status).toBe(401);
  });
});

// ── DELETE /api/bookings/:id ──────────────────────────────────────────────────

describe('DELETE /api/bookings/:id', () => {
  test('owner can cancel their own booking', async () => {
    const date = futureDate(3);
    const bookingId = seedBooking(db, { userId: user.id, date, startHour: 10 });

    const res = await request(app)
      .delete(`/api/bookings/${bookingId}`)
      .set('Cookie', user.cookie);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });

    const gone = db.prepare('SELECT id FROM bookings WHERE id = ?').get(bookingId);
    expect(gone).toBeUndefined();
  });

  test('regular user cannot cancel another user\'s booking', async () => {
    const date = futureDate(3);
    const bookingId = seedBooking(db, { userId: user.id, date, startHour: 10 });

    const res = await request(app)
      .delete(`/api/bookings/${bookingId}`)
      .set('Cookie', otherUser.cookie);

    expect(res.status).toBe(403);

    const stillThere = db.prepare('SELECT id FROM bookings WHERE id = ?').get(bookingId);
    expect(stillThere).toBeDefined();
  });

  test('admin can cancel any user\'s booking', async () => {
    const date = futureDate(3);
    const bookingId = seedBooking(db, { userId: user.id, date, startHour: 10 });

    const res = await request(app)
      .delete(`/api/bookings/${bookingId}`)
      .set('Cookie', admin.cookie);

    expect(res.status).toBe(200);
  });

  test('returns 404 for a non-existent booking', async () => {
    const res = await request(app)
      .delete('/api/bookings/99999')
      .set('Cookie', user.cookie);

    expect(res.status).toBe(404);
  });

  test('returns 400 for a non-numeric id', async () => {
    const res = await request(app)
      .delete('/api/bookings/abc')
      .set('Cookie', user.cookie);

    expect(res.status).toBe(400);
  });

  test('returns 401 when unauthenticated', async () => {
    const bookingId = seedBooking(db, { userId: user.id, date: futureDate(3), startHour: 10 });

    const res = await request(app).delete(`/api/bookings/${bookingId}`);
    expect(res.status).toBe(401);
  });
});

// ── PUT /api/bookings/:id ─────────────────────────────────────────────────────

describe('PUT /api/bookings/:id', () => {
  test('owner can move their booking to a free slot', async () => {
    const date = futureDate(3);
    const bookingId = seedBooking(db, { userId: user.id, date, startHour: 10 });

    const res = await request(app)
      .put(`/api/bookings/${bookingId}`)
      .set('Cookie', user.cookie)
      .send({ court_id: 1, date, start_hour: 15 });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ start_hour: 15, end_hour: 16, user_id: user.id });

    const old = db.prepare('SELECT id FROM bookings WHERE id = ?').get(bookingId);
    expect(old).toBeUndefined(); // old record was atomically deleted
  });

  test('returns 409 when moving to an already occupied slot', async () => {
    const date = futureDate(3);
    const bookingId = seedBooking(db, { userId: user.id, date, startHour: 10 });
    seedBooking(db, { courtId: 1, userId: otherUser.id, date, startHour: 14 });

    const res = await request(app)
      .put(`/api/bookings/${bookingId}`)
      .set('Cookie', user.cookie)
      .send({ court_id: 1, date, start_hour: 14 });

    expect(res.status).toBe(409);
  });

  test('regular user cannot edit another user\'s booking', async () => {
    const date = futureDate(3);
    const bookingId = seedBooking(db, { userId: user.id, date, startHour: 10 });

    const res = await request(app)
      .put(`/api/bookings/${bookingId}`)
      .set('Cookie', otherUser.cookie)
      .send({ court_id: 1, date, start_hour: 15 });

    expect(res.status).toBe(403);
  });

  test('admin can edit any booking', async () => {
    const date = futureDate(3);
    const bookingId = seedBooking(db, { userId: user.id, date, startHour: 10 });

    const res = await request(app)
      .put(`/api/bookings/${bookingId}`)
      .set('Cookie', admin.cookie)
      .send({ court_id: 1, date, start_hour: 11 });

    expect(res.status).toBe(200);
  });

  test('returns 400 when moving to a past time slot', async () => {
    const date = futureDate(3);
    const bookingId = seedBooking(db, { userId: user.id, date, startHour: 10 });

    const res = await request(app)
      .put(`/api/bookings/${bookingId}`)
      .set('Cookie', user.cookie)
      .send({ court_id: 1, date: '2020-01-01', start_hour: 10 });

    expect(res.status).toBe(400);
  });

  test('returns 404 for non-existent booking', async () => {
    const res = await request(app)
      .put('/api/bookings/99999')
      .set('Cookie', user.cookie)
      .send({ court_id: 1, date: futureDate(), start_hour: 10 });

    expect(res.status).toBe(404);
  });
});
