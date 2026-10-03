// /api/track — public endpoint for the landing pages.
//   GET  ?op=config  → which conversion events auto-send to Meta (read by tracking.js on load)
//   POST             → { visitor, session, events[], meta? }
//     events: first-party analytics stored in Postgres (page views, clicks, video progress, form steps…)
//     meta:   one Meta event mirrored to the Conversions API with the browser pixel's event_id (dedup),
//             unless auto-send for that event is switched off in admin Settings (then logged as "held").
import { readJson, clientIp, send, geo, deviceFromUa, str } from './_util.js';
import { db, getSettings, autoSendOn, TOGGLEABLE_EVENTS } from './_db.js';
import { SITE_EVENTS, cleanCustomData, buildUserData, sendToMeta, logHeld } from './_meta.js';

const ID_RE = /^[vs]_[A-Za-z0-9-]{6,64}$/;
const BOT_RE = /bot|crawler|spider|facebookexternalhit|Lighthouse|HeadlessChrome|Prerender/i;
const MAX_EVENTS = 50;

export default async function handler(req, res) {
  const url = new URL(req.url, 'http://x');

  if (req.method === 'GET' && url.searchParams.get('op') === 'config') {
    const settings = await getSettings().catch(() => ({}));
    const auto = {};
    for (const e of TOGGLEABLE_EVENTS) auto[e] = autoSendOn(settings, e);
    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Cache-Control', 'public, max-age=30, s-maxage=60, stale-while-revalidate=300');
    return res.end(JSON.stringify({ auto }));
  }

  if (req.method !== 'POST') return send(res, 405, { error: 'method_not_allowed' });

  let body;
  try { body = await readJson(req); } catch { return send(res, 400, { error: 'bad_json' }); }

  const ua = str(req.headers['user-agent'], 500);
  if (BOT_RE.test(ua || '')) return send(res, 202, { skipped: 'bot' });

  const vid = body?.visitor?.id;
  const sid = body?.session?.id;
  if (typeof vid !== 'string' || !ID_RE.test(vid) || (sid && !ID_RE.test(sid))) {
    return send(res, 400, { error: 'invalid_ids' });
  }

  const sql = db();
  const out = { ok: true };

  if (sql) {
    try {
      await upsertVisitor(sql, req, body, ua);
      await insertEvents(sql, vid, sid, body);
    } catch (err) {
      console.error('[track] db error', err.message);
      out.db = 'error';
    }
  }

  if (body.meta) out.meta = await handleMeta(sql, req, body.meta, vid, ua);

  return send(res, 200, out);
}

async function upsertVisitor(sql, req, body, ua) {
  const v = body.visitor || {};
  const ft = v.first_touch || {};
  const dev = v.device || {};
  const g = geo(req);
  const isNewSession = body.session?.is_new ? 1 : 0;
  const row = {
    id: v.id,
    landing_url: str(ft.landing_url, 1000),
    referrer: str(ft.referrer, 1000),
    utm_source: str(ft.utm_source, 200),
    utm_medium: str(ft.utm_medium, 200),
    utm_campaign: str(ft.utm_campaign, 300),
    utm_content: str(ft.utm_content, 300),
    utm_term: str(ft.utm_term, 300),
    campaign_id: str(ft.campaign_id, 64),
    adset_id: str(ft.adset_id, 64),
    ad_id: str(ft.ad_id, 64),
    placement: str(ft.placement, 100),
    site_source_name: str(ft.site_source_name, 50),
    fbclid: str(ft.fbclid, 500),
    fbc: str(v.fbc, 512),
    fbp: str(v.fbp, 512),
    ip: str(clientIp(req), 64),
    country: str(g.country, 8),
    region: str(g.region, 64),
    city: str(g.city, 120),
    user_agent: ua,
    device: deviceFromUa(ua),
    screen: str(dev.screen, 20),
    language: str(dev.language, 20),
    timezone: str(dev.timezone, 60),
    total_sessions: isNewSession || 1
  };

  // Attribution: first value wins. Click id cookies, ip and geo: latest value wins (fresher for Meta matching).
  await sql`
    INSERT INTO visitors ${sql(row)}
    ON CONFLICT (id) DO UPDATE SET
      last_seen_at     = now(),
      landing_url      = COALESCE(visitors.landing_url, EXCLUDED.landing_url),
      referrer         = COALESCE(visitors.referrer, EXCLUDED.referrer),
      utm_source       = COALESCE(visitors.utm_source, EXCLUDED.utm_source),
      utm_medium       = COALESCE(visitors.utm_medium, EXCLUDED.utm_medium),
      utm_campaign     = COALESCE(visitors.utm_campaign, EXCLUDED.utm_campaign),
      utm_content      = COALESCE(visitors.utm_content, EXCLUDED.utm_content),
      utm_term         = COALESCE(visitors.utm_term, EXCLUDED.utm_term),
      campaign_id      = COALESCE(visitors.campaign_id, EXCLUDED.campaign_id),
      adset_id         = COALESCE(visitors.adset_id, EXCLUDED.adset_id),
      ad_id            = COALESCE(visitors.ad_id, EXCLUDED.ad_id),
      placement        = COALESCE(visitors.placement, EXCLUDED.placement),
      site_source_name = COALESCE(visitors.site_source_name, EXCLUDED.site_source_name),
      fbclid           = COALESCE(visitors.fbclid, EXCLUDED.fbclid),
      fbc              = COALESCE(EXCLUDED.fbc, visitors.fbc),
      fbp              = COALESCE(EXCLUDED.fbp, visitors.fbp),
      ip               = COALESCE(EXCLUDED.ip, visitors.ip),
      country          = COALESCE(EXCLUDED.country, visitors.country),
      region           = COALESCE(EXCLUDED.region, visitors.region),
      city             = COALESCE(EXCLUDED.city, visitors.city),
      user_agent       = COALESCE(EXCLUDED.user_agent, visitors.user_agent),
      device           = COALESCE(EXCLUDED.device, visitors.device),
      screen           = COALESCE(visitors.screen, EXCLUDED.screen),
      language         = COALESCE(visitors.language, EXCLUDED.language),
      timezone         = COALESCE(visitors.timezone, EXCLUDED.timezone),
      total_sessions   = visitors.total_sessions + ${isNewSession}
  `;
}

async function insertEvents(sql, vid, sid, body) {
  const list = Array.isArray(body.events) ? body.events.slice(0, MAX_EVENTS) : [];
  if (body.meta && SITE_EVENTS.has(body.meta.event_name)) {
    // Every Meta event also lands on the visitor's timeline.
    list.push({ type: 'meta', name: body.meta.event_name, path: body.meta.path, data: cleanCustomData(body.meta.custom_data), ts: body.meta.event_time * 1000 });
  }
  if (!list.length) return;

  const now = Date.now();
  let vslSeconds = 0, vslPct = 0, step = 0;
  const rows = list.map((e) => {
    const data = e.data && typeof e.data === 'object' ? e.data : null;
    if (e.type === 'video_progress' && data) {
      vslSeconds = Math.max(vslSeconds, Math.min(36000, Math.round(Number(data.seconds) || 0)));
      vslPct = Math.max(vslPct, Math.min(100, Math.round(Number(data.pct) || 0)));
    }
    if (e.type === 'app_step' && data) step = Math.max(step, Math.min(20, Number(data.step) || 0));
    const ts = Number(e.ts);
    return {
      visitor_id: vid,
      session_id: sid || null,
      type: str(e.type, 40) || 'custom',
      name: str(e.name, 120),
      path: str(e.path, 300),
      scroll_pct: Number.isFinite(Number(e.scroll_pct)) ? Math.max(0, Math.min(100, Math.round(e.scroll_pct))) : null,
      data: data ? sql.json(JSON.stringify(data).length <= 4000 ? data : { truncated: true }) : null,
      // Trust client time only if it's within the last day (keeps event order right for beacons).
      created_at: Number.isFinite(ts) && ts <= now + 60000 && ts > now - 864e5 ? new Date(Math.min(ts, now)) : new Date(now)
    };
  });

  await sql`INSERT INTO events ${sql(rows)}`;
  await sql`
    UPDATE visitors SET
      total_events  = total_events + ${rows.length},
      vsl_seconds   = GREATEST(vsl_seconds, ${vslSeconds}),
      vsl_pct       = GREATEST(vsl_pct, ${vslPct}),
      furthest_step = GREATEST(furthest_step, ${step}),
      last_seen_at  = now()
    WHERE id = ${vid}
  `;
}

async function handleMeta(sql, req, m, vid, ua) {
  const name = m.event_name;
  if (!SITE_EVENTS.has(name) || typeof m.event_id !== 'string') return { error: 'invalid_event' };

  const leadId = str(m.lead_id, 80);
  const custom = cleanCustomData(m.custom_data);
  const u = m.user_data || {};
  const event = {
    event_name: name,
    event_id: m.event_id.slice(0, 120),
    event_time: m.event_time,
    event_source_url: m.event_source_url,
    custom_data: custom,
    user_data: buildUserData({
      em: u.em, ph: u.ph, fn: u.fn, ln: u.ln,
      external_id: vid, fbp: u.fbp, fbc: u.fbc,
      ip: clientIp(req), user_agent: ua
    })
  };
  const ctx = { origin: 'auto', lead_id: leadId, visitor_id: vid };

  const settings = await getSettings().catch(() => ({}));
  if (!autoSendOn(settings, name)) {
    await logHeld(event, ctx);
    if (sql && name === 'Schedule' && leadId) {
      await sql`UPDATE leads SET schedule_event_id = COALESCE(schedule_event_id, ${event.event_id}) WHERE id = ${leadId}`.catch(() => {});
    }
    return { status: 'held' };
  }

  const r = await sendToMeta(event, ctx);
  if (sql && r.ok) {
    // The lead row may be written before or after this call; /api/lead checks meta_sends for the other order.
    if (name === 'Lead') await sql`UPDATE leads SET meta_lead_sent_at = COALESCE(meta_lead_sent_at, now()) WHERE lead_event_id = ${event.event_id}`.catch(() => {});
    if (name === 'Schedule' && leadId) {
      await sql`UPDATE leads SET meta_schedule_sent_at = COALESCE(meta_schedule_sent_at, now()),
                schedule_event_id = COALESCE(schedule_event_id, ${event.event_id}) WHERE id = ${leadId}`.catch(() => {});
    }
  }
  return { status: r.status };
}
