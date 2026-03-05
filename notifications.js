const nodemailer = require('nodemailer');
const twilio     = require('twilio');

// ── Email ─────────────────────────────────────────────────────────────────────

let transporter = null;

function getTransporter() {
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host:   process.env.EMAIL_HOST || 'smtp.gmail.com',
      port:   parseInt(process.env.EMAIL_PORT || '587', 10),
      secure: process.env.EMAIL_SECURE === 'true',
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS,
      },
    });
  }
  return transporter;
}

async function sendEmail(to, subject, text) {
  if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) return;
  try {
    await getTransporter().sendMail({
      from: process.env.EMAIL_FROM || process.env.EMAIL_USER,
      to,
      subject,
      text,
    });
  } catch (e) {
    console.error('Email send failed:', e.message);
  }
}

// ── SMS ───────────────────────────────────────────────────────────────────────

let twilioClient = null;

function getTwilio() {
  if (!twilioClient) {
    twilioClient = twilio(process.env.TWILIO_SID, process.env.TWILIO_TOKEN);
  }
  return twilioClient;
}

async function sendSMS(to, body) {
  if (!process.env.TWILIO_SID || !process.env.TWILIO_TOKEN || !process.env.TWILIO_FROM || !to) return;
  try {
    await getTwilio().messages.create({
      from: process.env.TWILIO_FROM,
      to,
      body,
    });
  } catch (e) {
    console.error('SMS send failed:', e.message);
  }
}

// ── Notification helpers ──────────────────────────────────────────────────────

const DAYS_NO   = ['søndag','mandag','tirsdag','onsdag','torsdag','fredag','lørdag'];
const MONTHS_NO = ['januar','februar','mars','april','mai','juni','juli','august','september','oktober','november','desember'];

function formatDateNo(isoDate) {
  const [y, m, d] = isoDate.split('-').map(Number);
  const day = DAYS_NO[new Date(y, m - 1, d).getDay()];
  const dayCapital = day.charAt(0).toUpperCase() + day.slice(1);
  return `${dayCapital}, ${d}. ${MONTHS_NO[m - 1]} ${y}`;
}

function formatSlot(booking) {
  const date  = formatDateNo(booking.date);
  const start = String(booking.start_hour).padStart(2, '0') + ':00';
  const end   = String(booking.end_hour).padStart(2, '0') + ':00';
  return `${booking.court_name} – ${date} kl. ${start}–${end}`;
}

async function notifyBookingCreated({ email, phone, name }, booking) {
  const slot = formatSlot(booking);
  await Promise.all([
    sendEmail(
      email,
      'Tennisbane – bestilling bekreftet',
      `Hei ${name},\n\nDin bestilling er bekreftet:\n${slot}\n\nVi sees på banen!`
    ),
    sendSMS(
      phone,
      `Tennisbane bekreftet: ${slot}`
    ),
  ]);
}

async function notifyBookingCancelled({ email, phone, name }, booking) {
  const slot = formatSlot(booking);
  await Promise.all([
    sendEmail(
      email,
      'Tennisbane – bestilling kansellert',
      `Hei ${name},\n\nDin bestilling er kansellert:\n${slot}`
    ),
    sendSMS(
      phone,
      `Tennisbane kansellert: ${slot}`
    ),
  ]);
}

module.exports = { notifyBookingCreated, notifyBookingCancelled };
