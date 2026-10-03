// SMSLoop (AI texting, separate Railway app). Knight tells it about each qualified application and
// each Cal.com booking change; SMSLoop picks the scenario prompt and texts the lead.
// Does nothing until SMSLOOP_URL and SMSLOOP_SECRET are set. Never throws: texting must not break
// the request that triggered it.

const TIMEOUT_MS = 4000;

export function smsloopConfigured() {
  return Boolean(process.env.SMSLOOP_URL && process.env.SMSLOOP_SECRET);
}

export async function smsloopPost(path, body) {
  if (!smsloopConfigured() || !body?.phone) return null;
  const url = process.env.SMSLOOP_URL.replace(/\/+$/, '') + path;
  try {
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-SMSLoop-Secret': process.env.SMSLOOP_SECRET },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS)
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      console.error('[smsloop]', path, r.status, data.detail || '', JSON.stringify(body));
      return null;
    }
    return data;
  } catch (err) {
    console.error('[smsloop]', path, 'failed', err.message, JSON.stringify(body));
    return null;
  }
}

// New qualified application → SMSLoop lead in the "not_booked" scenario. SMSLoop waits 15 min
// (the scenario's opener delay) before texting; a booking in that window switches it to "booked".
export function applicationToSmsloop(lead) {
  const c = lead.contact || {};
  const a = lead.answers || {};
  const [first, ...rest] = String(c.name || '').trim().split(/\s+/);
  return {
    phone: c.phone,
    first_name: first || '',
    last_name: rest.join(' '),
    email: c.email || '',
    source: 'Knight Fit application',
    scenario: 'not_booked',
    fields: {
      goal: a.goal?.label || '',
      hardest_part: a.challenge?.label || '',
      tried_before: (a.tried_before || []).map((t) => t.label).filter(Boolean).join(', '),
      ready_to_invest: a.invest?.label || '',
      age: a.age ? String(a.age) : '',
      occupation: a.occupation || '',
      instagram: c.instagram || '',
      application_id: lead.application_id || ''
    }
  };
}

export function setScenario(phone, scenario, extra = {}) {
  return smsloopPost('/leads/event', { phone, event: 'set_scenario', scenario, ...extra });
}

export function aiOff(phone, reason) {
  return smsloopPost('/leads/event', { phone, event: 'ai_off', reason });
}
