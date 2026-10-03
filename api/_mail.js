// Email alerts over Gmail SMTP. Does nothing until SMTP_USER, SMTP_PASS and ALERT_EMAIL_TO are set.
import nodemailer from 'nodemailer';

let transport;

export function mailConfigured() {
  return Boolean(process.env.SMTP_USER && process.env.SMTP_PASS && process.env.ALERT_EMAIL_TO);
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/**
 * rows: [[label, value], ...] rendered as a simple table. link: optional admin URL.
 * Never throws; alerts must not break the request that triggered them.
 */
export async function sendAlert(subject, rows, link) {
  if (!mailConfigured()) return false;
  try {
    if (!transport) {
      transport = nodemailer.createTransport({
        host: process.env.SMTP_HOST || 'smtp.gmail.com',
        port: Number(process.env.SMTP_PORT) || 465,
        secure: (Number(process.env.SMTP_PORT) || 465) === 465,
        auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
      });
    }
    const body = rows.filter((r) => r[1] !== undefined && r[1] !== null && r[1] !== '');
    const html =
      '<table style="font:14px/1.5 -apple-system,Segoe UI,sans-serif;border-collapse:collapse">' +
      body.map(([k, v]) => `<tr><td style="padding:4px 12px 4px 0;color:#777;vertical-align:top">${esc(k)}</td><td style="padding:4px 0">${esc(v)}</td></tr>`).join('') +
      '</table>' +
      (link ? `<p style="font:14px -apple-system,Segoe UI,sans-serif"><a href="${esc(link)}">Open in admin</a></p>` : '');
    const text = body.map(([k, v]) => `${k}: ${v}`).join('\n') + (link ? `\n\n${link}` : '');
    await transport.sendMail({
      from: `"Knight Fit alerts" <${process.env.SMTP_USER}>`,
      to: process.env.ALERT_EMAIL_TO,
      subject,
      text,
      html
    });
    return true;
  } catch (err) {
    console.error('[mail] send failed', err.message);
    return false;
  }
}

export function adminLink(req, hash) {
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  if (!host) return null;
  const proto = req.headers['x-forwarded-proto'] || (/^localhost|^127\./.test(host) ? 'http' : 'https');
  return `${proto}://${host}/admin${hash ? '#' + hash : ''}`;
}
