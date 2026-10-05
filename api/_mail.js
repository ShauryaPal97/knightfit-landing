// Email alerts over Gmail SMTP. Needs SMTP_USER + SMTP_PASS; recipients come from
// Admin → Settings → Email alerts (stored in the settings table), falling back to ALERT_EMAIL_TO.
import nodemailer from 'nodemailer';
import { getSettings } from './_db.js';

let transport;

// Alert types a recipient can subscribe to. Keys are stored in settings; labels show in admin.
export const ALERT_TYPES = [
  { key: 'application', label: 'New application' },
  { key: 'disqualified', label: 'Disqualified application' },
  { key: 'booked', label: 'Call booked' },
  { key: 'cancelled', label: 'Call cancelled' }
];
const TYPE_KEYS = ALERT_TYPES.map((t) => t.key);
const EMAIL_RE = /^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]{2,}$/;

export function smtpConfigured() {
  return Boolean(process.env.SMTP_USER && process.env.SMTP_PASS);
}

export function envRecipients() {
  return String(process.env.ALERT_EMAIL_TO || '')
    .split(/[,;\s]+/)
    .map((e) => e.trim().toLowerCase())
    .filter((e) => EMAIL_RE.test(e));
}

// Clean a recipient list from user input: valid unique emails, known types only.
export function normalizeRecipients(input) {
  if (!Array.isArray(input)) return [];
  const seen = new Set();
  const out = [];
  for (const r of input) {
    const email = String(r?.email || '').trim().toLowerCase();
    if (!EMAIL_RE.test(email) || email.length > 200 || seen.has(email)) continue;
    seen.add(email);
    const types = Array.isArray(r.types) ? TYPE_KEYS.filter((k) => r.types.includes(k)) : [];
    out.push({ email, types });
    if (out.length >= 20) break;
  }
  return out;
}

/** Active recipients: the admin list if it has any emails, otherwise ALERT_EMAIL_TO (all types). */
export async function getRecipients() {
  const s = await getSettings().catch(() => ({}));
  let saved = [];
  try { saved = normalizeRecipients(JSON.parse(s.alert_recipients || '[]')); } catch { saved = []; }
  if (saved.length) return { list: saved, source: 'admin' };
  const env = envRecipients();
  if (env.length) return { list: env.map((email) => ({ email, types: [...TYPE_KEYS] })), source: 'env' };
  return { list: [], source: 'none' };
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function getTransport() {
  if (!transport) {
    transport = nodemailer.createTransport({
      host: process.env.SMTP_HOST || 'smtp.gmail.com',
      port: Number(process.env.SMTP_PORT) || 465,
      secure: (Number(process.env.SMTP_PORT) || 465) === 465,
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
    });
  }
  return transport;
}

// Test hook: swap the SMTP transport for a fake one.
export function _setTransportForTests(t) { transport = t; }

function deliver(to, subject, rows, link) {
  const body = rows.filter((r) => r[1] !== undefined && r[1] !== null && r[1] !== '');
  const html =
    '<table style="font:14px/1.5 -apple-system,Segoe UI,sans-serif;border-collapse:collapse">' +
    body.map(([k, v]) => `<tr><td style="padding:4px 12px 4px 0;color:#777;vertical-align:top">${esc(k)}</td><td style="padding:4px 0">${esc(v)}</td></tr>`).join('') +
    '</table>' +
    (link ? `<p style="font:14px -apple-system,Segoe UI,sans-serif"><a href="${esc(link)}">Open in admin</a></p>` : '');
  const text = body.map(([k, v]) => `${k}: ${v}`).join('\n') + (link ? `\n\n${link}` : '');
  // Recipients go in BCC so team members don't see each other's addresses.
  return getTransport().sendMail({
    from: `"Knight Fit alerts" <${process.env.SMTP_USER}>`,
    to: process.env.SMTP_USER,
    bcc: to,
    subject,
    text,
    html
  });
}

/**
 * type: one of ALERT_TYPES keys. rows: [[label, value], ...]. link: optional admin URL.
 * Sends only to recipients subscribed to `type`. Never throws; alerts must not break the request.
 */
export async function sendAlert(type, subject, rows, link) {
  if (!smtpConfigured()) return false;
  try {
    const { list } = await getRecipients();
    const to = list.filter((r) => r.types.includes(type)).map((r) => r.email);
    if (!to.length) return false;
    await deliver(to, subject, rows, link);
    return true;
  } catch (err) {
    console.error('[mail] send failed', type, err.message);
    return false;
  }
}

/** Sends a test email to every active recipient. Throws with a readable message on failure. */
export async function sendTestAlert(link) {
  if (!smtpConfigured()) throw new Error('Gmail SMTP is not set up (SMTP_USER / SMTP_PASS).');
  const { list } = await getRecipients();
  if (!list.length) throw new Error('Add at least one email first.');
  const to = list.map((r) => r.email);
  try {
    await deliver(to, 'Test alert from Knight Fit', [
      ['What', 'Test email from Admin → Settings → Email alerts'],
      ['Sent to', to.join(', ')],
      ['Time', new Date().toUTCString()]
    ], link);
  } catch (err) {
    throw new Error('Email failed: ' + err.message);
  }
  return { sent: true, recipients: to };
}

export function adminLink(req, hash) {
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  if (!host) return null;
  const proto = req.headers['x-forwarded-proto'] || (/^localhost|^127\./.test(host) ? 'http' : 'https');
  return `${proto}://${host}/admin${hash ? '#' + hash : ''}`;
}
