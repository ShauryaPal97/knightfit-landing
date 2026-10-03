// Shared helpers for the Vercel functions. Files starting with "_" are not deployed as routes.
import crypto from 'node:crypto';

export function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

// Hash a value for Meta after normalizing it; returns undefined for empty values.
export function hashed(value, normalize = (v) => v) {
  if (value === undefined || value === null) return undefined;
  const v = normalize(String(value).trim().toLowerCase());
  return v ? sha256(v) : undefined;
}

export const normalizers = {
  email: (v) => v,
  phone: (v) => {
    let d = v.replace(/\D/g, '');
    if (d.length === 10) d = '1' + d; // assume US/Canada
    return d;
  },
  name: (v) => v.replace(/[^\p{L}\p{M}]/gu, ''),
  id: (v) => v
};

export async function readJson(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') return JSON.parse(req.body || '{}');
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const raw = Buffer.concat(chunks).toString('utf8');
  return raw ? JSON.parse(raw) : {};
}

export function clientIp(req) {
  const fwd = req.headers['x-forwarded-for'];
  if (fwd) return String(fwd).split(',')[0].trim();
  return req.headers['x-real-ip'] || req.socket?.remoteAddress || undefined;
}

export function send(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

// Vercel geo headers (absent locally). City/region arrive URL-encoded.
export function geo(req) {
  const h = (k) => {
    const v = req.headers[k];
    if (!v) return null;
    try { return decodeURIComponent(String(v)); } catch { return String(v); }
  };
  return {
    country: h('x-vercel-ip-country'),
    region: h('x-vercel-ip-country-region'),
    city: h('x-vercel-ip-city')
  };
}

// Rough device label from a user agent, for list views.
export function deviceFromUa(ua) {
  const s = String(ua || '');
  if (!s) return null;
  const os = /iPhone/.test(s) ? 'iPhone' : /iPad/.test(s) ? 'iPad' : /Android/.test(s) ? 'Android'
    : /Mac OS X/.test(s) ? 'Mac' : /Windows/.test(s) ? 'Windows' : /Linux/.test(s) ? 'Linux' : 'Other';
  const app = /FBAN|FBAV|FB_IAB/.test(s) ? 'Facebook app' : /Instagram/.test(s) ? 'Instagram app'
    : /Edg\//.test(s) ? 'Edge' : /CriOS|Chrome\//.test(s) ? 'Chrome' : /Firefox|FxiOS/.test(s) ? 'Firefox'
    : /Safari\//.test(s) ? 'Safari' : '';
  return app ? os + ' · ' + app : os;
}

export function readCookie(req, name) {
  const m = String(req.headers.cookie || '').match(new RegExp('(?:^|; )' + name + '=([^;]*)'));
  if (!m) return null;
  try { return decodeURIComponent(m[1]); } catch { return m[1]; }
}

// Trim strings to a max length; non-strings become null.
export function str(v, max = 500) {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  return s ? s.slice(0, max) : null;
}
