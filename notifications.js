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

function formatSlot(booking) {
  return `${booking.court_name} on ${booking.date} at ${String(booking.start_hour).padStart(2,'0')}:00–${String(booking.end_hour).padStart(2,'0')}:00`;
}

async function notifyBookingCreated({ email, phone, name }, booking) {
  const slot = formatSlot(booking);
  await Promise.all([
    sendEmail(
      email,
      'Tennis court booking confirmed',
      `Hi ${name},\n\nYour booking is confirmed:\n${slot}\n\nSee you on the court!`
    ),
    sendSMS(
      phone,
      `Tennis booking confirmed: ${slot}`
    ),
  ]);
}

async function notifyBookingCancelled({ email, phone, name }, booking) {
  const slot = formatSlot(booking);
  await Promise.all([
    sendEmail(
      email,
      'Tennis court booking cancelled',
      `Hi ${name},\n\nYour booking has been cancelled:\n${slot}`
    ),
    sendSMS(
      phone,
      `Tennis booking cancelled: ${slot}`
    ),
  ]);
}

module.exports = { notifyBookingCreated, notifyBookingCancelled };
