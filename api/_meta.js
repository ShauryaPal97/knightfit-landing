// Meta Conversions API sender. Every attempt (sent, failed, held, skipped) is written to meta_sends.
import { hashed, normalizers } from './_util.js';
import { db, getSettings } from './_db.js';

export const SITE_EVENTS = new Set([
  'PageView', 'ViewContent', 'VideoProgress', 'TestimonialPlay',
  'ApplyClick', 'ApplicationStart', 'ApplicationStep', 'SubmitApplication', 'Lead', 'DisqualifiedLead',
  'CalTimeSelected', 'Schedule', 'InstagramClick'
]);

export function cleanCustomData(data) {
  const out = {};
  if (!data || typeof data !== 'object') return out;
  for (const [k, v] of Object.entries(data)) {
    if (v === undefined || v === null) continue;
    if (['string', 'number', 'boolean'].includes(typeof v)) out[k] = typeof v === 'string' ? v.slice(0, 500) : v;
  }
  return out;
}

function splitName(full) {
  const parts = String(full || '').trim().split(/\s+/).filter(Boolean);
  return { fn: parts[0] || '', ln: parts.length > 1 ? parts[parts.length - 1] : '' };
}

// Raw user fields in, Meta user_data out (PII hashed, click ids / ip / ua raw).
export function buildUserData(u = {}) {
  const n = u.name ? splitName(u.name) : { fn: u.fn, ln: u.ln };
  const ud = {
    em: hashed(u.em ?? u.email, normalizers.email),
    ph: hashed(u.ph ?? u.phone, normalizers.phone),
    fn: hashed(n.fn, normalizers.name),
    ln: hashed(n.ln, normalizers.name),
    external_id: hashed(u.external_id, normalizers.id),
    fbp: u.fbp || undefined,
    fbc: u.fbc || undefined,
    client_ip_address: u.ip || undefined,
    client_user_agent: u.user_agent || undefined
  };
  for (const k of Object.keys(ud)) if (ud[k] === undefined || ud[k] === '') delete ud[k];
  return ud;
}

// Meta accepts website events up to 7 days old.
export function clampEventTime(t) {
  const now = Math.floor(Date.now() / 1000);
  const n = Number(t);
  return Number.isFinite(n) && n <= now && n > now - 7 * 86400 + 60 ? Math.floor(n) : now;
}

export function metaConfigured() {
  return Boolean(process.env.META_PIXEL_ID && process.env.META_CAPI_TOKEN);
}

async function testCode() {
  const s = await getSettings().catch(() => ({}));
  return (s.meta_test_event_code || process.env.META_TEST_EVENT_CODE || '').trim() || null;
}

async function log(row) {
  const sql = db();
  if (!sql) return;
  try {
    await sql`INSERT INTO meta_sends ${sql({
      event_name: row.event_name,
      event_id: row.event_id || null,
      origin: row.origin,
      status: row.status,
      lead_id: row.lead_id || null,
      visitor_id: row.visitor_id || null,
      http_status: row.http_status ?? null,
      response: row.response ? sql.json(row.response) : null,
      custom_data: row.custom_data && Object.keys(row.custom_data).length ? sql.json(row.custom_data) : null,
      test_code: row.test_code || null
    })}`;
  } catch (err) {
    console.error('[meta] log failed', err.message);
  }
}

// Record an event that was deliberately not sent because auto-send is off.
export function logHeld(event, ctx) {
  return log({ event_name: event.event_name, event_id: event.event_id, origin: 'auto', status: 'held',
    lead_id: ctx.lead_id, visitor_id: ctx.visitor_id, custom_data: event.custom_data,
    response: { reason: 'auto_send_off' } });
}

/**
 * Send one event to Meta and log the outcome.
 * event: { event_name, event_id, event_time, event_source_url, user_data (already built), custom_data }
 * ctx:   { origin: 'auto'|'manual', lead_id, visitor_id }
 * Returns { ok, status, error?, response? }. Never throws.
 */
export async function sendToMeta(event, ctx) {
  const pixelId = process.env.META_PIXEL_ID;
  const token = process.env.META_CAPI_TOKEN;
  const base = { event_name: event.event_name, event_id: event.event_id, origin: ctx.origin,
    lead_id: ctx.lead_id, visitor_id: ctx.visitor_id, custom_data: event.custom_data };

  if (!pixelId || !token) {
    await log({ ...base, status: 'skipped', response: { reason: 'capi_not_configured' } });
    return { ok: false, status: 'skipped', error: 'META_PIXEL_ID / META_CAPI_TOKEN not set' };
  }

  const code = await testCode();
  const payload = {
    data: [{
      event_name: event.event_name,
      event_id: event.event_id,
      event_time: clampEventTime(event.event_time),
      action_source: 'website',
      event_source_url: event.event_source_url ? String(event.event_source_url).slice(0, 1000) : undefined,
      user_data: event.user_data,
      custom_data: event.custom_data
    }]
  };
  if (code) payload.test_event_code = code;

  const version = process.env.META_API_VERSION || 'v23.0';
  try {
    const r = await fetch(`https://graph.facebook.com/${version}/${pixelId}/events?access_token=${encodeURIComponent(token)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const result = await r.json().catch(() => ({}));
    const ok = r.ok;
    await log({ ...base, status: ok ? 'sent' : 'failed', http_status: r.status, response: result, test_code: code });
    if (!ok) {
      console.error('[meta] error', r.status, JSON.stringify(result));
      return { ok: false, status: 'failed', error: result?.error?.message || 'Meta returned ' + r.status, response: result };
    }
    return { ok: true, status: 'sent', response: result };
  } catch (err) {
    console.error('[meta] request failed', err);
    await log({ ...base, status: 'failed', response: { error: String(err.message || err) }, test_code: code });
    return { ok: false, status: 'failed', error: String(err.message || err) };
  }
}
