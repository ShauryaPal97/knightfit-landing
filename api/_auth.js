// Single-password admin login with an HMAC-signed session cookie.
import crypto from 'node:crypto';
import { readCookie } from './_util.js';

const COOKIE = 'kf_admin';
const MAX_AGE = 90 * 86400; // seconds (long so the home-screen app rarely asks for the password)

function secret() {
  // Falls back to a key derived from the password, so changing the password signs everyone out.
  const s = process.env.ADMIN_SESSION_SECRET || (process.env.ADMIN_PASSWORD ? 'pw:' + process.env.ADMIN_PASSWORD : '');
  return s ? crypto.createHash('sha256').update('kf-admin-session:' + s).digest() : null;
}

function sign(data) {
  return crypto.createHmac('sha256', secret()).update(data).digest('base64url');
}

function sameHash(a, b) {
  const ha = crypto.createHash('sha256').update(String(a)).digest();
  const hb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}

export function adminConfigured() {
  return Boolean(process.env.ADMIN_PASSWORD);
}

export function checkPassword(input) {
  const pw = process.env.ADMIN_PASSWORD;
  if (!pw || typeof input !== 'string') return false;
  return sameHash(input, pw);
}

function isLocal(req) {
  return /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(String(req.headers.host || ''));
}

function cookieAttrs(req, maxAge) {
  return `Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}` + (isLocal(req) ? '' : '; Secure');
}

export function setSessionCookie(req, res) {
  const payload = Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + MAX_AGE })).toString('base64url');
  res.setHeader('Set-Cookie', `${COOKIE}=${payload}.${sign(payload)}; ${cookieAttrs(req, MAX_AGE)}`);
}

export function clearSessionCookie(req, res) {
  res.setHeader('Set-Cookie', `${COOKIE}=; ${cookieAttrs(req, 0)}`);
}

export function isAdmin(req) {
  if (!secret()) return false;
  const raw = readCookie(req, COOKIE);
  if (!raw || !raw.includes('.')) return false;
  const [payload, sig] = raw.split('.');
  const expected = sign(payload);
  if (sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return false;
  try {
    const { exp } = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    return Number(exp) > Date.now() / 1000;
  } catch {
    return false;
  }
}
