// POST /api/cal-webhook — Cal.com booking webhooks (Cal.com → Settings → Developer → Webhooks).
// Verifies x-cal-signature-256 (HMAC-SHA256 of the raw body with CAL_WEBHOOK_SECRET), then stores the
// booking, links it to the lead/visitor and moves the lead's stage. Each change is also sent to SMSLoop
// (booked → "booked" scenario, no-show → "no_show", cancelled → AI off + coach alert).
import crypto from 'node:crypto';
import { send, str } from './_util.js';
import { db } from './_db.js';
import { sendAlert, adminLink } from './_mail.js';
import { setScenario, aiOff } from './_smsloop.js';

async function rawBody(req) {
  // Read the stream ourselves: the signature must be checked against the exact bytes Cal.com sent.
  const chunks = [];
  for await (const c of req) chunks.push(c);
  return Buffer.concat(chunks).toString('utf8');
}

function validSignature(raw, header, secret) {
  if (!header) return false;
  const expected = crypto.createHmac('sha256', secret).update(raw).digest('hex');
  const got = String(header).trim().toLowerCase();
  return got.length === expected.length && crypto.timingSafeEqual(Buffer.from(got), Buffer.from(expected));
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return send(res, 405, { error: 'method_not_allowed' });

  const secret = process.env.CAL_WEBHOOK_SECRET;
  if (!secret) return send(res, 503, { error: 'CAL_WEBHOOK_SECRET not set' });

  const raw = await rawBody(req);
  if (!validSignature(raw, req.headers['x-cal-signature-256'], secret)) return send(res, 401, { error: 'bad_signature' });

  let body;
  try { body = JSON.parse(raw); } catch { return send(res, 400, { error: 'bad_json' }); }

  const trigger = body.triggerEvent;
  const p = body.payload || {};
  const sql = db();
  if (!sql) return send(res, 503, { error: 'DATABASE_URL not set' });

  try {
    if (trigger === 'BOOKING_CREATED') await created(sql, req, p);
    else if (trigger === 'BOOKING_RESCHEDULED') await rescheduled(sql, req, p);
    else if (trigger === 'BOOKING_CANCELLED') await cancelled(sql, req, p);
    else if (trigger === 'BOOKING_NO_SHOW_UPDATED') await noShow(sql, p);
    else return send(res, 200, { ok: true, ignored: trigger || 'unknown' });
  } catch (err) {
    console.error('[cal] error', trigger, err);
    return send(res, 500, { error: 'processing_failed' });
  }
  return send(res, 200, { ok: true });
}

function attendee(p) {
  const a = (p.attendees && p.attendees[0]) || {};
  const r = p.responses || {};
  const val = (x) => (x && typeof x === 'object' ? x.value : x);
  const loc = val(r.location);
  return {
    name: str(a.name || val(r.name), 200),
    email: str(a.email || val(r.email), 200)?.toLowerCase() || null,
    phone: str(a.phoneNumber || val(r.attendeePhoneNumber) || val(r.phone) ||
      (loc && typeof loc === 'object' && /phone/i.test(loc.value || '') ? loc.optionValue : null), 50)
  };
}

async function findLead(sql, meta, email) {
  const appId = str(meta.applicationId, 80);
  const vid = str(meta.visitorId, 80);
  if (appId) {
    const [l] = await sql`SELECT * FROM leads WHERE id = ${appId}`;
    if (l) return l;
  }
  if (vid) {
    const [l] = await sql`SELECT * FROM leads WHERE visitor_id = ${vid} AND archived_at IS NULL ORDER BY created_at DESC LIMIT 1`;
    if (l) return l;
  }
  if (email) {
    const [l] = await sql`SELECT * FROM leads WHERE lower(email) = ${email} AND archived_at IS NULL ORDER BY created_at DESC LIMIT 1`;
    if (l) return l;
  }
  return null;
}

async function created(sql, req, p) {
  const uid = str(p.uid, 120);
  if (!uid) return;
  const [exists] = await sql`SELECT uid FROM bookings WHERE uid = ${uid}`;
  if (exists) return; // redelivery

  const meta = p.metadata || {};
  const who = attendee(p);
  let vid = str(meta.visitorId, 80);
  if (vid) {
    const [v] = await sql`SELECT id FROM visitors WHERE id = ${vid}`;
    if (!v) vid = null;
  }

  let lead = await findLead(sql, meta, who.email);
  if (!lead) {
    // Booked without applying (direct Cal.com link): create a lead from the booking + visitor attribution.
    const [v] = vid ? await sql`SELECT * FROM visitors WHERE id = ${vid}` : [null];
    const row = {
      id: 'bk_' + uid.slice(0, 60),
      visitor_id: vid,
      source: 'booking',
      stage: 'booked',
      name: who.name,
      email: who.email,
      phone: who.phone,
      utm_source: v?.utm_source || null,
      utm_campaign: v?.utm_campaign || null,
      utm_term: v?.utm_term || null,
      utm_content: v?.utm_content || null,
      campaign_id: v?.campaign_id || null,
      adset_id: v?.adset_id || null,
      ad_id: v?.ad_id || null,
      lead_source: v && (v.utm_campaign || v.fbclid) ? 'ad' : null,
      fbc: v?.fbc || null,
      fbp: v?.fbp || null,
      ip: v?.ip || null,
      user_agent: v?.user_agent || null,
      event_source_url: v?.landing_url || null
    };
    await sql`INSERT INTO leads ${sql(row)} ON CONFLICT (id) DO NOTHING`;
    [lead] = await sql`SELECT * FROM leads WHERE id = ${row.id}`;
  } else {
    if (!vid) vid = lead.visitor_id;
    await sql`UPDATE leads SET
                stage = CASE WHEN stage IN ('showed', 'closed') THEN stage ELSE 'booked' END,
                name = COALESCE(name, ${who.name}), email = COALESCE(email, ${who.email}), phone = COALESCE(phone, ${who.phone}),
                visitor_id = COALESCE(visitor_id, ${vid}), updated_at = now()
              WHERE id = ${lead.id}`;
  }

  await sql`INSERT INTO bookings ${sql({
    uid,
    lead_id: lead?.id || null,
    visitor_id: vid,
    title: str(p.title, 300),
    start_time: p.startTime ? new Date(p.startTime) : null,
    end_time: p.endTime ? new Date(p.endTime) : null,
    attendee_name: who.name,
    attendee_email: who.email,
    attendee_phone: who.phone,
    status: 'accepted',
    raw: sql.json(p)
  })} ON CONFLICT (uid) DO NOTHING`;

  if (lead && vid) {
    // Link the browser's Schedule event (fired on the booking page) to this lead.
    const [s] = await sql`SELECT event_id, status, created_at FROM meta_sends
                          WHERE event_name = 'Schedule' AND visitor_id = ${vid} ORDER BY created_at DESC LIMIT 1`;
    if (s) {
      await sql`UPDATE leads SET schedule_event_id = COALESCE(schedule_event_id, ${s.event_id}),
                  meta_schedule_sent_at = COALESCE(meta_schedule_sent_at, ${s.status === 'sent' ? s.created_at : null})
                WHERE id = ${lead.id}`;
      await sql`UPDATE meta_sends SET lead_id = ${lead.id} WHERE event_id = ${s.event_id} AND lead_id IS NULL`;
    }
  }

  await timeline(sql, vid, 'booking_created', { uid, start_time: p.startTime, lead_id: lead?.id });

  // Booked (or rescheduled: same scenario, SMSLoop only refreshes the call time).
  // Booked without applying → SMSLoop creates the lead from this.
  const a0 = (p.attendees && p.attendees[0]) || {};
  await setScenario(lead?.phone || who.phone, 'booked', {
    name: lead?.name || who.name || '',
    email: lead?.email || who.email || '',
    source: lead?.source === 'booking' ? 'Knight Fit booking (no application)' : 'Knight Fit application',
    context: { call_start: p.startTime, call_end: p.endTime, timezone: a0.timeZone || p.organizer?.timeZone || '' }
  });

  await sendAlert('booked', `Call booked: ${who.name || who.email || 'someone'}`, [
    ['When', fmtTime(p.startTime, p.organizer?.timeZone)],
    ['Name', who.name], ['Email', who.email], ['Phone', who.phone],
    ['Lead', lead ? (lead.source === 'booking' ? 'New (booked without applying)' : 'Applied ' + fmtDate(lead.created_at)) : null],
    ['Campaign', lead?.utm_campaign], ['Ad set', lead?.utm_term], ['Ad', lead?.utm_content]
  ], adminLink(req, '/bookings'));
}

async function rescheduled(sql, req, p) {
  const oldUid = str(p.rescheduleUid || p.fromReschedule, 120);
  if (oldUid) {
    await sql`UPDATE bookings SET status = 'rescheduled', updated_at = now() WHERE uid = ${oldUid}`;
    const [old] = await sql`SELECT lead_id, visitor_id FROM bookings WHERE uid = ${oldUid}`;
    if (old) {
      p.metadata = { ...(p.metadata || {}), applicationId: p.metadata?.applicationId || old.lead_id, visitorId: p.metadata?.visitorId || old.visitor_id };
    }
  }
  await created(sql, req, p);
}

async function cancelled(sql, req, p) {
  const uid = str(p.uid, 120);
  if (!uid) return;
  const [b] = await sql`UPDATE bookings SET status = 'cancelled', updated_at = now() WHERE uid = ${uid} RETURNING *`;
  if (!b) return;
  if (b.lead_id) {
    // Back to "applied" unless another live booking exists.
    await sql`UPDATE leads SET stage = 'applied', updated_at = now()
              WHERE id = ${b.lead_id} AND stage = 'booked'
                AND NOT EXISTS (SELECT 1 FROM bookings WHERE lead_id = ${b.lead_id} AND status = 'accepted')`;
  }
  await timeline(sql, b.visitor_id, 'booking_cancelled', { uid, start_time: b.start_time });
  // Stop the AI (coach takes over by hand) unless the lead still has another live booking.
  const [other] = b.lead_id ? await sql`SELECT 1 FROM bookings WHERE lead_id = ${b.lead_id} AND status = 'accepted' LIMIT 1` : [null];
  if (!other) {
    const [l] = b.lead_id ? await sql`SELECT phone FROM leads WHERE id = ${b.lead_id}` : [null];
    await aiOff(l?.phone || b.attendee_phone, 'Booking cancelled' + (p.cancellationReason ? ': ' + String(p.cancellationReason).slice(0, 150) : ''));
  }
  await sendAlert('cancelled', `Call cancelled: ${b.attendee_name || b.attendee_email || ''}`, [
    ['Was', fmtTime(b.start_time)], ['Name', b.attendee_name], ['Email', b.attendee_email],
    ['Reason', p.cancellationReason]
  ], adminLink(req, '/bookings'));
}

async function noShow(sql, p) {
  const uid = str(p.bookingUid || p.uid, 120);
  if (!uid) return;
  const flagged = (p.attendees || []).some((a) => a.noShow);
  const [b] = await sql`UPDATE bookings SET status = ${flagged ? 'no_show' : 'accepted'}, updated_at = now() WHERE uid = ${uid} RETURNING *`;
  if (b?.lead_id && flagged) await sql`UPDATE leads SET stage = 'no_show', updated_at = now() WHERE id = ${b.lead_id} AND stage IN ('applied', 'booked')`;
  if (b) await timeline(sql, b.visitor_id, flagged ? 'booking_no_show' : 'booking_no_show_cleared', { uid });
  if (b && flagged) {
    const [l] = b.lead_id ? await sql`SELECT phone FROM leads WHERE id = ${b.lead_id}` : [null];
    await setScenario(l?.phone || b.attendee_phone, 'no_show', { context: { missed_call_start: b.start_time ? new Date(b.start_time).toISOString() : '' } });
  }
}

async function timeline(sql, vid, name, data) {
  if (!vid) return;
  await sql`INSERT INTO events (visitor_id, type, name, path, data) VALUES (${vid}, 'booking', ${name}, '/booking', ${sql.json(data)})`;
  await sql`UPDATE visitors SET total_events = total_events + 1 WHERE id = ${vid}`;
}

function fmtTime(t, tz) {
  if (!t) return '';
  try {
    return new Date(t).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short', timeZone: tz || 'UTC', timeZoneName: 'short' });
  } catch {
    return new Date(t).toISOString();
  }
}
function fmtDate(t) {
  return t ? new Date(t).toISOString().slice(0, 10) : '';
}
