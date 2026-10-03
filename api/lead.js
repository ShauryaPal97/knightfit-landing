// POST /api/lead — receives a completed application, stores it as a lead in Postgres,
// emails an alert, hands qualified applicants to SMSLoop for AI texting (if SMSLOOP_URL is set),
// and forwards it to LEAD_WEBHOOK_URL (GoHighLevel, Zapier, Make, Apps Script…) if set.
import { readJson, clientIp, send, readCookie, str } from './_util.js';
import { db } from './_db.js';
import { sendAlert, adminLink } from './_mail.js';
import { smsloopPost, applicationToSmsloop } from './_smsloop.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return send(res, 405, { error: 'method_not_allowed' });

  let lead;
  try { lead = await readJson(req); } catch { return send(res, 400, { error: 'bad_json' }); }

  const email = lead?.contact?.email;
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
    return send(res, 400, { error: 'invalid_lead' });
  }

  const enriched = {
    ...lead,
    server: {
      received_at: new Date().toISOString(),
      ip: clientIp(req),
      user_agent: req.headers['user-agent'] || null,
      fbp: readCookie(req, '_fbp'),
      fbc: readCookie(req, '_fbc')
    }
  };

  const stored = await store(enriched).catch((err) => {
    console.error('[lead] db error', err.message, JSON.stringify(enriched));
    return false;
  });

  const c = lead.contact || {};
  const a = lead.answers || {};
  const t = lead.attribution?.last_touch?.utm_campaign ? lead.attribution.last_touch : (lead.attribution?.first_touch || {});
  const qualified = lead.lead_status === 'qualified';
  await sendAlert(
    `${qualified ? 'New application' : 'Disqualified application'}: ${c.name || email}`,
    [
      ['Status', qualified ? 'Qualified' : 'Disqualified (' + (lead.dq_reason || '') + ')'],
      ['Name', c.name], ['Email', c.email], ['Phone', c.phone], ['Instagram', c.instagram],
      ['Goal', a.goal?.label], ['Challenge', a.challenge?.label], ['Invest', a.invest?.label],
      ['Age', a.age], ['Occupation', a.occupation],
      ['Campaign', t.utm_campaign], ['Ad set', t.utm_term], ['Ad', t.utm_content]
    ],
    adminLink(req, lead.application_id ? '/leads/' + encodeURIComponent(lead.application_id) : '/leads')
  );

  // Disqualified applicants are never texted.
  if (qualified && c.phone) await smsloopPost('/leads/inbound', applicationToSmsloop(lead));

  const url = process.env.LEAD_WEBHOOK_URL;
  if (!url) {
    if (!stored) console.log('[lead] LEAD_WEBHOOK_URL not set, lead received:', JSON.stringify(enriched));
    return send(res, 200, { ok: true, stored, forwarded: false });
  }

  try {
    const headers = { 'Content-Type': 'application/json' };
    if (process.env.LEAD_WEBHOOK_SECRET) headers['X-Webhook-Secret'] = process.env.LEAD_WEBHOOK_SECRET;
    const r = await fetch(url, { method: 'POST', headers, body: JSON.stringify(enriched) });
    if (!r.ok) {
      console.error('[lead] webhook error', r.status, await r.text().catch(() => ''), JSON.stringify(enriched));
      return send(res, stored ? 200 : 502, { ok: stored, stored, forwarded: false });
    }
    return send(res, 200, { ok: true, stored, forwarded: true });
  } catch (err) {
    console.error('[lead] webhook failed', err, JSON.stringify(enriched));
    return send(res, stored ? 200 : 502, { ok: stored, stored, forwarded: false });
  }
}

async function store(l) {
  const sql = db();
  if (!sql) return false;

  const id = str(l.application_id, 80) || 'app_' + Date.now().toString(36);
  const att = l.attribution || {};
  const vid = typeof att.visitor_id === 'string' && /^v_[A-Za-z0-9-]{6,64}$/.test(att.visitor_id) ? att.visitor_id : null;
  // Ads attribution: last touch if it came from an ad, otherwise first touch.
  const t = att.last_touch && (att.last_touch.utm_campaign || att.last_touch.fbclid) ? att.last_touch : (att.first_touch || {});
  const c = l.contact || {};
  const qualified = l.lead_status === 'qualified';

  // Make sure the visitor exists so the foreign key holds even if tracking was blocked.
  if (vid) {
    await sql`INSERT INTO visitors (id, landing_url, utm_source, utm_campaign, utm_term, utm_content, campaign_id, adset_id, ad_id, fbclid)
              VALUES (${vid}, ${str(t.landing_url, 1000)}, ${str(t.utm_source, 200)}, ${str(t.utm_campaign, 300)}, ${str(t.utm_term, 300)},
                      ${str(t.utm_content, 300)}, ${str(t.campaign_id, 64)}, ${str(t.adset_id, 64)}, ${str(t.ad_id, 64)}, ${str(t.fbclid, 500)})
              ON CONFLICT (id) DO NOTHING`;
  }

  const row = {
    id,
    visitor_id: vid,
    source: 'application',
    stage: qualified ? 'applied' : 'disqualified',
    name: str(c.name, 200),
    email: str(c.email, 200)?.toLowerCase(),
    phone: str(c.phone, 50),
    instagram: str(c.instagram, 100),
    answers: sql.json(l.answers || {}),
    dq_reason: str(l.dq_reason, 50),
    cta_source: str(l.cta_source, 30),
    attribution: sql.json(att),
    utm_source: str(t.utm_source, 200),
    utm_campaign: str(t.utm_campaign, 300),
    utm_term: str(t.utm_term, 300),
    utm_content: str(t.utm_content, 300),
    campaign_id: str(t.campaign_id, 64),
    adset_id: str(t.adset_id, 64),
    ad_id: str(t.ad_id, 64),
    lead_source: t.utm_campaign || t.fbclid || /facebook|instagram|^fb$|^ig$|meta/i.test(t.utm_source || '') ? 'ad' : null,
    submit_event_id: str(l.meta?.submit_event_id, 120),
    lead_event_id: qualified ? str(l.meta?.lead_event_id, 120) : null,
    fbc: str(l.server.fbc, 512),
    fbp: str(l.server.fbp, 512),
    ip: str(l.server.ip, 64),
    user_agent: str(l.server.user_agent, 500),
    event_source_url: str(l.page?.url, 1000)
  };

  await sql`INSERT INTO leads ${sql(row)} ON CONFLICT (id) DO NOTHING`;

  // If the browser's Lead event already reached Meta before this row existed, record it.
  if (row.lead_event_id) {
    await sql`UPDATE leads SET meta_lead_sent_at = s.created_at
              FROM (SELECT created_at FROM meta_sends WHERE event_id = ${row.lead_event_id} AND status = 'sent' ORDER BY created_at LIMIT 1) s
              WHERE leads.id = ${id} AND leads.meta_lead_sent_at IS NULL`;
    await sql`UPDATE meta_sends SET lead_id = ${id} WHERE event_id = ${row.lead_event_id} AND lead_id IS NULL`;
  }
  if (row.submit_event_id) await sql`UPDATE meta_sends SET lead_id = ${id} WHERE event_id = ${row.submit_event_id} AND lead_id IS NULL`;

  if (vid) {
    await sql`INSERT INTO events (visitor_id, session_id, type, name, path, data)
              VALUES (${vid}, ${str(att.session_id, 80)}, 'lead', ${qualified ? 'application_qualified' : 'application_disqualified'},
                      '/', ${sql.json({ lead_id: id, dq_reason: row.dq_reason })})`;
    await sql`UPDATE visitors SET furthest_step = GREATEST(furthest_step, 7), total_events = total_events + 1, last_seen_at = now() WHERE id = ${vid}`;
  }
  return true;
}
