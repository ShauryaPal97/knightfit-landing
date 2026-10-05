// /api/admin?op=… — every admin operation, behind the kf_admin session cookie.
// One file on purpose: Vercel Hobby caps a deployment at 12 functions.
import { readJson, send, str } from './_util.js';
import { db, getSettings, setSetting, TOGGLEABLE_EVENTS, autoSendOn } from './_db.js';
import { adminConfigured, checkPassword, setSessionCookie, clearSessionCookie, isAdmin } from './_auth.js';
import { buildUserData, sendToMeta, metaConfigured } from './_meta.js';
import { ALERT_TYPES, smtpConfigured, envRecipients, getRecipients, normalizeRecipients, sendTestAlert, adminLink } from './_mail.js';
import { PUSH_TYPES, pushConfigured, publicKey, getDevices, addDevice, updateDevice, removeDevice, sendTestPush } from './_push.js';

const STAGES = ['applied', 'booked', 'showed', 'closed', 'no_show', 'lost', 'disqualified'];
const LEAD_SOURCES = ['ad', 'organic', 'referral', 'dm', 'other'];
const RANGES = { '24h': 1, '7d': 7, '30d': 30, '90d': 90 };

function since(range) {
  const days = RANGES[range];
  return days ? new Date(Date.now() - days * 864e5) : new Date(0);
}

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

export default async function handler(req, res) {
  const url = new URL(req.url, 'http://x');
  const op = url.searchParams.get('op') || '';
  const q = Object.fromEntries(url.searchParams);

  try {
    if (op === 'login') {
      if (req.method !== 'POST') return send(res, 405, { error: 'method_not_allowed' });
      if (!adminConfigured()) return send(res, 503, { error: 'ADMIN_PASSWORD is not set' });
      const body = await readJson(req).catch(() => ({}));
      if (!checkPassword(body.password)) {
        await new Promise((r) => setTimeout(r, 500)); // slow down guessing
        return send(res, 401, { error: 'Incorrect password' });
      }
      setSessionCookie(req, res);
      return send(res, 200, { ok: true });
    }
    if (op === 'logout') {
      clearSessionCookie(req, res);
      return send(res, 200, { ok: true });
    }

    if (!isAdmin(req)) return send(res, 401, { error: 'unauthorized', configured: adminConfigured() });

    const sql = db();
    if (op === 'session') return send(res, 200, { ok: true, db: Boolean(sql) });
    if (!sql) return send(res, 503, { error: 'DATABASE_URL is not set' });

    const body = req.method === 'POST' ? await readJson(req).catch(() => ({})) : {};
    const fn = OPS[op];
    if (!fn) return send(res, 404, { error: 'unknown_op' });
    const result = await fn(sql, q, body, req, res);
    if (result === undefined) return; // handler wrote the response itself (CSV)
    return send(res, 200, result);
  } catch (err) {
    if (err instanceof HttpError) return send(res, err.status, { error: err.message });
    console.error('[admin]', op, err);
    return send(res, 500, { error: 'server_error', detail: String(err.message || err) });
  }
}

/* ------------------------------------------------------------------ */

const OPS = {
  overview, filters, visitors, visitor, leads, lead, updateLead, addNote, archiveLead, sendMeta,
  bookings, bookingStatus, settings, saveSettings, testAlert, pushSubscribe, pushUpdate, pushRemove, pushTest, exportCsv, deleteAll
};

// Group expressions for the ads breakdown (whitelisted, never user input).
const LEVEL = {
  campaign: { key: "COALESCE(v.utm_campaign, '')", label: "COALESCE(v.utm_campaign, '')" },
  adset: { key: "COALESCE(v.utm_campaign, '') || '|' || COALESCE(v.utm_term, '')", label: "COALESCE(v.utm_term, '')" },
  ad: { key: "COALESCE(v.utm_campaign, '') || '|' || COALESCE(v.utm_term, '') || '|' || COALESCE(v.utm_content, '')", label: "COALESCE(v.utm_content, '')" }
};

async function overview(sql, q) {
  const from = since(q.range);
  const hourly = q.range === '24h';
  const level = LEVEL[q.level] || LEVEL.campaign;

  const cohort = sql`
    v AS (SELECT * FROM visitors WHERE first_seen_at >= ${from}),
    l AS (SELECT DISTINCT ON (visitor_id) visitor_id, stage, source, amount_paid
          FROM leads WHERE visitor_id IS NOT NULL ORDER BY visitor_id, created_at DESC),
    b AS (SELECT DISTINCT visitor_id FROM bookings WHERE visitor_id IS NOT NULL AND status <> 'cancelled')`;

  const [funnel] = await sql`
    WITH ${cohort}
    SELECT
      count(*)::int AS landed,
      count(*) FILTER (WHERE v.vsl_seconds > 0)::int AS played,
      count(*) FILTER (WHERE v.vsl_pct >= 50)::int AS vsl50,
      count(*) FILTER (WHERE v.furthest_step >= 1)::int AS started,
      count(*) FILTER (WHERE l.source = 'application')::int AS submitted,
      count(*) FILTER (WHERE l.source = 'application' AND l.stage <> 'disqualified')::int AS qualified,
      count(*) FILTER (WHERE b.visitor_id IS NOT NULL OR l.stage IN ('booked', 'showed', 'closed', 'no_show'))::int AS booked,
      count(*) FILTER (WHERE l.stage IN ('showed', 'closed'))::int AS showed,
      count(*) FILTER (WHERE l.stage = 'closed')::int AS closed,
      COALESCE(avg(v.vsl_seconds) FILTER (WHERE v.vsl_seconds > 0), 0)::float8 AS vsl_avg_seconds,
      COALESCE(avg(v.vsl_pct) FILTER (WHERE v.vsl_seconds > 0), 0)::float8 AS vsl_avg_pct,
      count(*) FILTER (WHERE v.vsl_pct >= 25)::int AS vsl25,
      count(*) FILTER (WHERE v.vsl_pct >= 75)::int AS vsl75,
      count(*) FILTER (WHERE v.vsl_pct >= 95)::int AS vsl95
    FROM v LEFT JOIN l ON l.visitor_id = v.id LEFT JOIN b ON b.visitor_id = v.id`;

  const [kpi] = await sql`
    SELECT
      (SELECT count(*) FROM visitors WHERE first_seen_at >= ${from})::int AS visitors,
      (SELECT count(*) FROM leads WHERE created_at >= ${from} AND source = 'application')::int AS applications,
      (SELECT count(*) FROM leads WHERE created_at >= ${from} AND source = 'application' AND stage <> 'disqualified')::int AS qualified,
      (SELECT count(*) FROM bookings WHERE created_at >= ${from} AND status NOT IN ('cancelled', 'rescheduled'))::int AS bookings,
      (SELECT count(*) FROM leads WHERE updated_at >= ${from} AND stage IN ('showed', 'closed'))::int AS showed,
      (SELECT count(*) FROM leads WHERE updated_at >= ${from} AND stage = 'no_show')::int AS no_show,
      (SELECT count(*) FROM leads WHERE closed_at >= ${from} AND stage = 'closed')::int AS closed,
      (SELECT COALESCE(sum(amount_paid), 0) FROM leads WHERE closed_at >= ${from} AND stage = 'closed')::float8 AS revenue`;

  const bucket = hourly ? sql`date_trunc('hour', first_seen_at)` : sql`date_trunc('day', first_seen_at)`;
  const leadBucket = hourly ? sql`date_trunc('hour', created_at)` : sql`date_trunc('day', created_at)`;
  const series = await sql`SELECT ${bucket} AS t, count(*)::int AS n FROM visitors WHERE first_seen_at >= ${from} GROUP BY 1 ORDER BY 1`;
  const leadSeries = await sql`SELECT ${leadBucket} AS t, count(*)::int AS n FROM leads WHERE created_at >= ${from} AND source = 'application' GROUP BY 1 ORDER BY 1`;

  const steps = await sql`
    SELECT s AS step, count(v.id)::int AS n
    FROM generate_series(1, 7) s LEFT JOIN visitors v ON v.first_seen_at >= ${from} AND v.furthest_step >= s
    GROUP BY s ORDER BY s`;

  const ads = await sql`
    WITH ${cohort}
    SELECT ${sql.unsafe(level.key)} AS k,
      max(${sql.unsafe(level.label)}) AS label,
      max(v.utm_campaign) AS campaign, max(v.utm_term) AS adset,
      max(v.campaign_id) AS campaign_id, max(v.adset_id) AS adset_id, max(v.ad_id) AS ad_id,
      count(*)::int AS visitors,
      count(*) FILTER (WHERE v.vsl_seconds > 0)::int AS played,
      count(*) FILTER (WHERE l.source = 'application')::int AS applications,
      count(*) FILTER (WHERE l.source = 'application' AND l.stage <> 'disqualified')::int AS qualified,
      count(*) FILTER (WHERE b.visitor_id IS NOT NULL OR l.stage IN ('booked', 'showed', 'closed', 'no_show'))::int AS booked,
      count(*) FILTER (WHERE l.stage IN ('showed', 'closed'))::int AS showed,
      count(*) FILTER (WHERE l.stage = 'closed')::int AS closed,
      COALESCE(sum(l.amount_paid) FILTER (WHERE l.stage = 'closed'), 0)::float8 AS revenue
    FROM v LEFT JOIN l ON l.visitor_id = v.id LEFT JOIN b ON b.visitor_id = v.id
    GROUP BY 1 ORDER BY visitors DESC LIMIT 100`;

  const sources = await sql`
    SELECT COALESCE(NULLIF(utm_source, ''), substring(referrer from '^https?://(?:www\\.)?([^/:]+)'), 'direct') AS k, count(*)::int AS n
    FROM visitors WHERE first_seen_at >= ${from} GROUP BY 1 ORDER BY n DESC LIMIT 8`;
  const countries = await sql`
    SELECT COALESCE(country, 'Unknown') AS k, count(*)::int AS n
    FROM visitors WHERE first_seen_at >= ${from} GROUP BY 1 ORDER BY n DESC LIMIT 8`;

  return { kpi, funnel, series, leadSeries, steps, ads, sources, countries, hourly };
}

async function filters(sql) {
  const [r] = await sql`
    SELECT
      ARRAY(SELECT DISTINCT utm_campaign FROM visitors WHERE utm_campaign IS NOT NULL ORDER BY 1 LIMIT 300) AS campaigns,
      ARRAY(SELECT DISTINCT utm_term FROM visitors WHERE utm_term IS NOT NULL ORDER BY 1 LIMIT 300) AS adsets,
      ARRAY(SELECT DISTINCT utm_content FROM visitors WHERE utm_content IS NOT NULL ORDER BY 1 LIMIT 300) AS ads,
      ARRAY(SELECT DISTINCT country FROM visitors WHERE country IS NOT NULL ORDER BY 1) AS countries`;
  return r;
}

async function visitors(sql, q) {
  const from = since(q.range);
  const search = str(q.q, 200);
  const like = search ? '%' + search.replace(/[%_\\]/g, (c) => '\\' + c) + '%' : null;
  const did = q.did;
  const rows = await sql`
    SELECT v.id, v.first_seen_at, v.last_seen_at, v.utm_source, v.utm_campaign, v.utm_term, v.utm_content,
           v.campaign_id, v.adset_id, v.ad_id, v.city, v.region, v.country, v.device, v.vsl_seconds, v.vsl_pct,
           v.furthest_step, v.total_sessions, v.total_events, v.referrer, v.landing_url,
           l.id AS lead_id, l.name, l.stage,
           EXISTS (SELECT 1 FROM bookings bk WHERE bk.visitor_id = v.id AND bk.status <> 'cancelled') AS booked
    FROM visitors v
    LEFT JOIN LATERAL (SELECT id, name, stage FROM leads WHERE visitor_id = v.id ORDER BY created_at DESC LIMIT 1) l ON true
    WHERE v.last_seen_at >= ${from}
      ${q.campaign ? sql`AND v.utm_campaign = ${q.campaign}` : sql``}
      ${q.adset ? sql`AND v.utm_term = ${q.adset}` : sql``}
      ${q.ad ? sql`AND v.utm_content = ${q.ad}` : sql``}
      ${q.country ? sql`AND v.country = ${q.country}` : sql``}
      ${did === 'vsl' ? sql`AND v.vsl_seconds > 0` : sql``}
      ${did === 'started' ? sql`AND v.furthest_step >= 1` : sql``}
      ${did === 'applied' ? sql`AND l.id IS NOT NULL` : sql``}
      ${did === 'booked' ? sql`AND EXISTS (SELECT 1 FROM bookings bk WHERE bk.visitor_id = v.id AND bk.status <> 'cancelled')` : sql``}
      ${did === 'none' ? sql`AND l.id IS NULL` : sql``}
      ${did === 'ads' ? sql`AND (v.utm_campaign IS NOT NULL OR v.fbclid IS NOT NULL)` : sql``}
      ${like ? sql`AND (v.id ILIKE ${like} OR l.name ILIKE ${like} OR v.utm_campaign ILIKE ${like} OR v.utm_term ILIKE ${like}
                    OR v.utm_content ILIKE ${like} OR v.city ILIKE ${like} OR v.referrer ILIKE ${like})` : sql``}
    ORDER BY v.last_seen_at DESC
    LIMIT 500`;
  return { rows };
}

async function visitor(sql, q) {
  const id = str(q.id, 80);
  const [v] = await sql`SELECT * FROM visitors WHERE id = ${id}`;
  if (!v) throw new HttpError(404, 'Visitor not found');
  const leadsRows = await sql`SELECT id, name, stage, created_at FROM leads WHERE visitor_id = ${id} ORDER BY created_at DESC`;
  const bookingRows = await sql`SELECT uid, start_time, status FROM bookings WHERE visitor_id = ${id} ORDER BY start_time DESC`;
  const events = await sql`SELECT id, session_id, type, name, path, scroll_pct, data, created_at
                           FROM events WHERE visitor_id = ${id} ORDER BY created_at, id LIMIT 3000`;
  return { visitor: v, leads: leadsRows, bookings: bookingRows, events };
}

async function leads(sql, q) {
  const from = since(q.range);
  const archived = q.archived === '1';
  const search = str(q.q, 200);
  const like = search ? '%' + search.replace(/[%_\\]/g, (c) => '\\' + c) + '%' : null;
  const stage = STAGES.includes(q.stage) ? q.stage : null;
  const source = q.source === 'none' ? 'none' : LEAD_SOURCES.includes(q.source) ? q.source : null;

  const base = sql`
    l.created_at >= ${from}
    AND ${archived ? sql`l.archived_at IS NOT NULL` : sql`l.archived_at IS NULL`}
    ${source === 'none' ? sql`AND l.lead_source IS NULL` : source ? sql`AND l.lead_source = ${source}` : sql``}
    ${like ? sql`AND (l.name ILIKE ${like} OR l.email ILIKE ${like} OR l.phone ILIKE ${like} OR l.instagram ILIKE ${like}
                  OR l.utm_campaign ILIKE ${like} OR l.utm_term ILIKE ${like} OR l.utm_content ILIKE ${like} OR l.id ILIKE ${like})` : sql``}`;

  const rows = await sql`
    SELECT l.id, l.name, l.email, l.phone, l.instagram, l.stage, l.source, l.lead_source, l.created_at, l.updated_at, l.archived_at,
           l.utm_source, l.utm_campaign, l.utm_term, l.utm_content, l.amount_paid::float8 AS amount_paid, l.plan, l.dq_reason,
           l.answers, l.meta_lead_sent_at, l.meta_schedule_sent_at, l.meta_purchase_sent_at, l.visitor_id,
           v.vsl_seconds, v.vsl_pct, v.country, v.city,
           (SELECT min(start_time) FROM bookings bk WHERE bk.lead_id = l.id AND bk.status = 'accepted' AND bk.start_time >= now()) AS next_call
    FROM leads l LEFT JOIN visitors v ON v.id = l.visitor_id
    WHERE ${base} ${stage ? sql`AND l.stage = ${stage}` : sql``}
    ORDER BY l.created_at DESC LIMIT 1000`;

  const [kpi] = await sql`
    SELECT
      count(*) FILTER (WHERE l.stage <> 'disqualified')::int AS total,
      count(*) FILTER (WHERE l.stage = 'disqualified')::int AS disqualified,
      count(*) FILTER (WHERE l.stage IN ('booked', 'showed', 'closed', 'no_show'))::int AS booked,
      count(*) FILTER (WHERE l.stage IN ('showed', 'closed'))::int AS showed,
      count(*) FILTER (WHERE l.stage = 'no_show')::int AS no_show,
      count(*) FILTER (WHERE l.stage = 'closed')::int AS closed,
      COALESCE(sum(l.amount_paid) FILTER (WHERE l.stage = 'closed'), 0)::float8 AS revenue
    FROM leads l WHERE ${base}`;

  return { rows, kpi };
}

async function lead(sql, q) {
  const id = str(q.id, 80);
  const [l] = await sql`SELECT *, amount_paid::float8 AS amount_paid FROM leads WHERE id = ${id}`;
  if (!l) throw new HttpError(404, 'Lead not found');
  const [v] = l.visitor_id ? await sql`SELECT id, vsl_seconds, vsl_pct, furthest_step, city, region, country, device, first_seen_at,
                                         last_seen_at, total_sessions, landing_url, fbc, fbp, placement FROM visitors WHERE id = ${l.visitor_id}` : [null];
  const notes = await sql`SELECT id, note, created_at FROM lead_notes WHERE lead_id = ${id} ORDER BY created_at DESC`;
  const bookingRows = await sql`SELECT uid, title, start_time, end_time, status, created_at FROM bookings WHERE lead_id = ${id} ORDER BY start_time DESC`;
  const ids = [l.lead_event_id, l.schedule_event_id, l.submit_event_id].filter(Boolean);
  const sends = await sql`
    SELECT id, created_at, event_name, event_id, origin, status, http_status, response, custom_data, test_code
    FROM meta_sends
    WHERE lead_id = ${id} ${ids.length ? sql`OR event_id IN ${sql(ids)}` : sql``}
    ORDER BY created_at DESC LIMIT 100`;
  return { lead: l, visitor: v, notes, bookings: bookingRows, sends, metaConfigured: metaConfigured() };
}

async function updateLead(sql, q, body) {
  const id = str(body.id, 80);
  const f = body.fields || {};
  const set = {};
  if ('stage' in f) {
    if (!STAGES.includes(f.stage)) throw new HttpError(400, 'Invalid stage');
    set.stage = f.stage;
  }
  for (const k of ['name', 'email', 'phone', 'instagram', 'plan']) if (k in f) set[k] = str(f[k], 200);
  if ('email' in set && set.email) set.email = set.email.toLowerCase();
  if ('lead_source' in f) {
    if (f.lead_source && !LEAD_SOURCES.includes(f.lead_source)) throw new HttpError(400, 'Invalid lead source');
    set.lead_source = f.lead_source || null;
  }
  if ('amount_paid' in f) {
    const n = f.amount_paid === '' || f.amount_paid === null ? null : Number(f.amount_paid);
    if (n !== null && (!Number.isFinite(n) || n < 0)) throw new HttpError(400, 'Invalid amount');
    set.amount_paid = n;
  }
  if (!Object.keys(set).length) return { ok: true };
  const [l] = await sql`
    UPDATE leads SET ${sql(set)}, updated_at = now(),
      closed_at = CASE WHEN ${set.stage === 'closed'} THEN COALESCE(closed_at, now()) ELSE closed_at END
    WHERE id = ${id} RETURNING id`;
  if (!l) throw new HttpError(404, 'Lead not found');
  return { ok: true };
}

async function addNote(sql, q, body) {
  const id = str(body.id, 80);
  const note = str(body.note, 5000);
  if (!note) throw new HttpError(400, 'Empty note');
  const [l] = await sql`SELECT id FROM leads WHERE id = ${id}`;
  if (!l) throw new HttpError(404, 'Lead not found');
  await sql`INSERT INTO lead_notes (lead_id, note) VALUES (${id}, ${note})`;
  return { ok: true };
}

async function archiveLead(sql, q, body) {
  const id = str(body.id, 80);
  await sql`UPDATE leads SET archived_at = ${body.archived ? sql`now()` : null}, updated_at = now() WHERE id = ${id}`;
  return { ok: true };
}

// Manual "Send to Meta" from the lead drawer.
async function sendMeta(sql, q, body) {
  const id = str(body.id, 80);
  const name = body.event;
  if (!['Lead', 'Schedule', 'Purchase'].includes(name)) throw new HttpError(400, 'Invalid event');
  const [l] = await sql`SELECT * FROM leads WHERE id = ${id}`;
  if (!l) throw new HttpError(404, 'Lead not found');
  const [v] = l.visitor_id ? await sql`SELECT * FROM visitors WHERE id = ${l.visitor_id}` : [null];

  const sentCol = { Lead: 'meta_lead_sent_at', Schedule: 'meta_schedule_sent_at', Purchase: 'meta_purchase_sent_at' }[name];
  if (l[sentCol] && !body.force) return { needConfirm: true, sent_at: l[sentCol] };

  let eventId, eventTime, custom;
  if (name === 'Lead') {
    // Same id as the browser's Lead (if any) so Meta merges duplicates instead of counting twice.
    eventId = l.lead_event_id || 'Lead.manual.' + l.id;
    eventTime = Math.floor(new Date(l.created_at).getTime() / 1000);
    custom = { lead_status: l.stage === 'disqualified' ? 'disqualified' : 'qualified', content_name: 'Coaching application' };
  } else if (name === 'Schedule') {
    const [bk] = await sql`SELECT created_at FROM bookings WHERE lead_id = ${id} ORDER BY created_at LIMIT 1`;
    eventId = l.schedule_event_id || 'Schedule.manual.' + l.id;
    eventTime = Math.floor(new Date(bk?.created_at || Date.now()).getTime() / 1000);
    custom = { content_name: 'Consultation call' };
  } else {
    const value = Number(body.value ?? l.amount_paid);
    if (!Number.isFinite(value) || value <= 0) throw new HttpError(400, 'Enter the purchase amount');
    const currency = /^[A-Z]{3}$/.test(body.currency || '') ? body.currency : (l.currency || 'USD');
    eventId = 'Purchase.' + l.id;
    eventTime = Math.floor(Date.now() / 1000);
    custom = { value, currency, content_name: l.plan || 'Coaching' };
    if (l.amount_paid === null) await sql`UPDATE leads SET amount_paid = ${value}, currency = ${currency} WHERE id = ${id}`;
  }

  const r = await sendToMeta({
    event_name: name,
    event_id: eventId,
    event_time: eventTime,
    event_source_url: l.event_source_url || v?.landing_url || process.env.SITE_URL || 'https://knightfit.io/',
    custom_data: custom,
    user_data: buildUserData({
      email: l.email, phone: l.phone, name: l.name,
      external_id: l.visitor_id || l.id,
      fbc: l.fbc || v?.fbc, fbp: l.fbp || v?.fbp,
      ip: l.ip || v?.ip, user_agent: l.user_agent || v?.user_agent
    })
  }, { origin: 'manual', lead_id: l.id, visitor_id: l.visitor_id });

  if (r.ok) await sql`UPDATE leads SET ${sql(sentCol)} = now(), updated_at = now() WHERE id = ${id}`;
  return { ok: r.ok, status: r.status, error: r.error, response: r.response };
}

async function bookings(sql, q) {
  const tab = q.tab || 'upcoming';
  const where =
    tab === 'past' ? sql`b.start_time < now() AND b.status NOT IN ('cancelled', 'rescheduled')`
    : tab === 'cancelled' ? sql`b.status IN ('cancelled', 'rescheduled')`
    : sql`b.start_time >= now() AND b.status NOT IN ('cancelled', 'rescheduled')`;
  const rows = await sql`
    SELECT b.uid, b.title, b.start_time, b.end_time, b.status, b.created_at, b.attendee_name, b.attendee_email, b.attendee_phone,
           b.lead_id, b.visitor_id, l.name AS lead_name, l.stage, l.source AS lead_origin,
           COALESCE(l.utm_campaign, v.utm_campaign) AS utm_campaign, COALESCE(l.utm_term, v.utm_term) AS utm_term,
           COALESCE(l.utm_content, v.utm_content) AS utm_content
    FROM bookings b LEFT JOIN leads l ON l.id = b.lead_id LEFT JOIN visitors v ON v.id = b.visitor_id
    WHERE ${where}
    ORDER BY b.start_time ${tab === 'upcoming' ? sql`ASC` : sql`DESC`} LIMIT 500`;
  return { rows };
}

async function bookingStatus(sql, q, body) {
  const uid = str(body.uid, 120);
  const status = body.status;
  if (!['showed', 'no_show', 'accepted'].includes(status)) throw new HttpError(400, 'Invalid status');
  const [b] = await sql`UPDATE bookings SET status = ${status}, updated_at = now() WHERE uid = ${uid} RETURNING lead_id, visitor_id`;
  if (!b) throw new HttpError(404, 'Booking not found');
  if (b.lead_id) {
    const stage = status === 'accepted' ? 'booked' : status;
    await sql`UPDATE leads SET stage = ${stage}, updated_at = now() WHERE id = ${b.lead_id} AND stage <> 'closed'`;
  }
  if (b.visitor_id) {
    await sql`INSERT INTO events (visitor_id, type, name, path, data) VALUES (${b.visitor_id}, 'booking', ${'call_' + status}, '/admin', ${sql.json({ uid })})`;
  }
  return { ok: true };
}

async function settings(sql) {
  const s = await getSettings(true);
  const auto = {};
  for (const e of TOGGLEABLE_EVENTS) auto[e] = autoSendOn(s, e);
  const [{ n }] = await sql`SELECT count(*)::int AS n FROM visitors`;
  const rcpt = await getRecipients();
  const devices = await getDevices(true);
  return {
    auto,
    alerts: {
      recipients: rcpt.source === 'admin' ? rcpt.list : [],
      source: rcpt.source,
      env_fallback: envRecipients(),
      types: ALERT_TYPES,
      smtp: smtpConfigured()
    },
    push: {
      configured: pushConfigured(),
      public_key: publicKey(),
      types: PUSH_TYPES,
      devices: devices.map((d) => ({ endpoint: d.endpoint, name: d.name, types: d.types, created_at: d.created_at }))
    },
    test_code: s.meta_test_event_code || '',
    env_test_code: Boolean(process.env.META_TEST_EVENT_CODE),
    status: {
      database: true,
      pixel: Boolean(process.env.META_PIXEL_ID),
      capi: metaConfigured(),
      cal: Boolean(process.env.CAL_WEBHOOK_SECRET),
      smtp: smtpConfigured() && rcpt.list.length > 0,
      push: pushConfigured(),
      lead_webhook: Boolean(process.env.LEAD_WEBHOOK_URL),
      session_secret: Boolean(process.env.ADMIN_SESSION_SECRET)
    },
    visitors: n
  };
}

async function saveSettings(sql, q, body) {
  if (body.auto && typeof body.auto === 'object') {
    for (const e of TOGGLEABLE_EVENTS) {
      if (e in body.auto) await setSetting('auto_' + e, body.auto[e] ? 'on' : 'off');
    }
  }
  if ('test_code' in body) await setSetting('meta_test_event_code', str(body.test_code, 40) || '');
  if ('alert_recipients' in body) {
    if (!Array.isArray(body.alert_recipients)) throw new HttpError(400, 'alert_recipients must be a list');
    await setSetting('alert_recipients', JSON.stringify(normalizeRecipients(body.alert_recipients)));
  }
  return settings(sql);
}

async function testAlert(sql, q, body, req) {
  if (req.method !== 'POST') throw new HttpError(405, 'method_not_allowed');
  try {
    return await sendTestAlert(adminLink(req, '/settings'));
  } catch (err) {
    throw new HttpError(400, err.message);
  }
}

// Phone notifications: each device subscribes itself from Settings and picks its alert types.
async function pushOp(req, fn) {
  if (req.method !== 'POST') throw new HttpError(405, 'method_not_allowed');
  try {
    return await fn();
  } catch (err) {
    throw new HttpError(400, err.message);
  }
}
function pushSubscribe(sql, q, body, req) {
  return pushOp(req, async () => {
    if (!pushConfigured()) throw new Error('Push isn\'t set up (VAPID keys missing on Vercel).');
    await addDevice(body.subscription, str(body.name, 60));
    return settings(sql);
  });
}
function pushUpdate(sql, q, body, req) {
  return pushOp(req, async () => { await updateDevice(String(body.endpoint || ''), body); return settings(sql); });
}
function pushRemove(sql, q, body, req) {
  return pushOp(req, async () => { await removeDevice(String(body.endpoint || '')); return settings(sql); });
}
function pushTest(sql, q, body, req) {
  return pushOp(req, () => sendTestPush(String(body.endpoint || '')));
}

const EXPORTS = {
  visitors: (sql) => sql`SELECT * FROM visitors ORDER BY first_seen_at DESC LIMIT 100000`,
  events: (sql) => sql`SELECT * FROM events ORDER BY created_at DESC LIMIT 200000`,
  leads: (sql) => sql`SELECT * FROM leads ORDER BY created_at DESC LIMIT 100000`,
  bookings: (sql) => sql`SELECT uid, lead_id, visitor_id, title, start_time, end_time, attendee_name, attendee_email, attendee_phone, status, created_at FROM bookings ORDER BY start_time DESC`
};

function csvCell(v) {
  if (v === null || v === undefined) return '';
  let s = v instanceof Date ? v.toISOString() : typeof v === 'object' ? JSON.stringify(v) : String(v);
  // Stop spreadsheet apps from running visitor-supplied text as a formula (phone numbers like +1… are left alone).
  if (/^[=@\t\r]/.test(s) || /^[+-][^\d\s(]/.test(s)) s = "'" + s;
  return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

async function exportCsv(sql, q, body, req, res) {
  const table = q.table;
  if (!EXPORTS[table]) throw new HttpError(400, 'Unknown table');
  const rows = await EXPORTS[table](sql);
  const cols = rows.columns ? rows.columns.map((c) => c.name) : Object.keys(rows[0] || {});
  const out = [cols.join(',')].concat(rows.map((r) => cols.map((c) => csvCell(r[c])).join(','))).join('\n');
  res.statusCode = 200;
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Disposition', `attachment; filename="knight-${table}-${new Date().toISOString().slice(0, 10)}.csv"`);
  res.end(out);
}

async function deleteAll(sql, q, body) {
  if (body.confirm !== 'DELETE') throw new HttpError(400, 'Type DELETE to confirm');
  await sql`TRUNCATE events, lead_notes, meta_sends, bookings, leads, visitors RESTART IDENTITY`;
  return { ok: true };
}
