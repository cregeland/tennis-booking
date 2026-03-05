/**
 * Tests for the ICS calendar export routes and the buildICS utility:
 *   GET /api/calendar/mine.ics
 *   GET /api/calendar/all.ics
 */

const request   = require('supertest');
const { buildICS, isValidDate } = require('../server');
const { buildTestApp, seedUser, seedBooking, futureDate } = require('./helpers');

let app, db, user, admin;

beforeEach(() => {
  ({ app, db } = buildTestApp());
  user  = seedUser(db, { name: 'Alice', email: 'alice@example.com', role: 'user'  });
  admin = seedUser(db, { name: 'Admin', email: 'admin2@example.com', role: 'admin' });
});

// ── buildICS unit tests ───────────────────────────────────────────────────────

describe('buildICS()', () => {
  const sampleBooking = {
    id: 42,
    date: '2026-06-15',
    start_hour: 10,
    end_hour: 11,
    user_name: 'Alice',
    court_name: 'Court 1',
  };

  test('returns a string starting with BEGIN:VCALENDAR', () => {
    const ics = buildICS([sampleBooking], 'My Calendar');
    expect(ics).toMatch(/^BEGIN:VCALENDAR/);
  });

  test('ends with END:VCALENDAR', () => {
    const ics = buildICS([sampleBooking], 'My Calendar');
    expect(ics).toMatch(/END:VCALENDAR\s*$/);
  });

  test('includes a VEVENT for each booking', () => {
    const ics = buildICS([sampleBooking, { ...sampleBooking, id: 43 }], 'Test');
    const count = (ics.match(/BEGIN:VEVENT/g) || []).length;
    expect(count).toBe(2);
  });

  test('produces empty VCALENDAR for an empty booking list', () => {
    const ics = buildICS([], 'Empty');
    expect(ics).not.toMatch(/BEGIN:VEVENT/);
    expect(ics).toMatch(/BEGIN:VCALENDAR/);
  });

  test('encodes DTSTART and DTEND correctly', () => {
    const ics = buildICS([sampleBooking], 'Test');
    expect(ics).toContain('DTSTART:20260615T100000');
    expect(ics).toContain('DTEND:20260615T110000');
  });

  test('sets unique UID per booking', () => {
    const ics = buildICS([sampleBooking], 'Test');
    expect(ics).toContain('UID:booking-42@tennispro');
  });

  test('escapes backslash, semicolons and commas in court name', () => {
    const tricky = { ...sampleBooking, court_name: 'Court; A\\B,C' };
    const ics = buildICS([tricky], 'Test');
    expect(ics).toContain('Court\\; A\\\\B\\,C');
  });

  test('uses CRLF line endings (RFC 5545 requirement)', () => {
    const ics = buildICS([sampleBooking], 'Test');
    expect(ics).toContain('\r\n');
  });
});

// ── isValidDate unit tests ────────────────────────────────────────────────────

describe('isValidDate()', () => {
  test('accepts a properly formatted future date', () => {
    expect(isValidDate('2026-12-25')).toBe(true);
  });

  test('rejects wrong separator', () => {
    expect(isValidDate('2026/12/25')).toBe(false);
  });

  test('rejects invalid calendar date (month 13)', () => {
    expect(isValidDate('2026-13-01')).toBe(false);
  });

  test('rejects invalid calendar date (day 32)', () => {
    expect(isValidDate('2026-01-32')).toBe(false);
  });

  test('rejects free-form strings', () => {
    expect(isValidDate('tomorrow')).toBe(false);
  });

  test('rejects empty string', () => {
    expect(isValidDate('')).toBe(false);
  });
});

// ── GET /api/calendar/mine.ics ────────────────────────────────────────────────

describe('GET /api/calendar/mine.ics', () => {
  test('returns a text/calendar response for authenticated user', async () => {
    const res = await request(app)
      .get('/api/calendar/mine.ics')
      .set('Cookie', user.cookie);

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/calendar/);
    expect(res.text).toMatch(/BEGIN:VCALENDAR/);
  });

  test('includes only the requesting user\'s bookings', async () => {
    const date = futureDate(5);
    seedBooking(db, { userId: user.id,  date, startHour: 10 });
    seedBooking(db, { courtId: 2, userId: admin.id, date, startHour: 11 });

    const res = await request(app)
      .get('/api/calendar/mine.ics')
      .set('Cookie', user.cookie);

    expect(res.status).toBe(200);
    const eventCount = (res.text.match(/BEGIN:VEVENT/g) || []).length;
    expect(eventCount).toBe(1);
  });

  test('returns 401 when unauthenticated', async () => {
    const res = await request(app).get('/api/calendar/mine.ics');
    expect(res.status).toBe(401);
  });
});

// ── GET /api/calendar/all.ics ─────────────────────────────────────────────────

describe('GET /api/calendar/all.ics', () => {
  test('admin receives all bookings', async () => {
    const date = futureDate(5);
    seedBooking(db, { userId: user.id,  date, startHour: 10 });
    seedBooking(db, { courtId: 2, userId: admin.id, date, startHour: 11 });

    const res = await request(app)
      .get('/api/calendar/all.ics')
      .set('Cookie', admin.cookie);

    expect(res.status).toBe(200);
    const eventCount = (res.text.match(/BEGIN:VEVENT/g) || []).length;
    expect(eventCount).toBe(2);
  });

  test('regular user is denied with 403', async () => {
    const res = await request(app)
      .get('/api/calendar/all.ics')
      .set('Cookie', user.cookie);

    expect(res.status).toBe(403);
  });

  test('unauthenticated request is denied with 401', async () => {
    const res = await request(app).get('/api/calendar/all.ics');
    expect(res.status).toBe(401);
  });
});
