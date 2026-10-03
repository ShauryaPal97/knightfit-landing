// Postgres client (Neon in production, any Postgres locally) + settings helpers.
import postgres from 'postgres';

let client;

export function db() {
  if (!process.env.DATABASE_URL) return null;
  if (!client) {
    client = postgres(process.env.DATABASE_URL, {
      max: 3,
      idle_timeout: 20,
      connect_timeout: 10,
      prepare: false, // required by Neon's pooled (pgbouncer) connection string
      onnotice: () => {}
    });
  }
  return client;
}

// Conversion events whose automatic sending can be switched off in admin Settings.
export const TOGGLEABLE_EVENTS = ['SubmitApplication', 'Lead', 'DisqualifiedLead', 'Schedule'];

let cache = { at: 0, value: null };

export async function getSettings(fresh = false) {
  const sql = db();
  if (!sql) return {};
  if (!fresh && cache.value && Date.now() - cache.at < 15000) return cache.value;
  const rows = await sql`SELECT key, value FROM settings`;
  const out = {};
  for (const r of rows) out[r.key] = r.value;
  cache = { at: Date.now(), value: out };
  return out;
}

export async function setSetting(key, value) {
  const sql = db();
  await sql`INSERT INTO settings (key, value) VALUES (${key}, ${value})
            ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`;
  cache = { at: 0, value: null };
}

// Auto-send is on unless explicitly switched off.
export function autoSendOn(settings, eventName) {
  if (!TOGGLEABLE_EVENTS.includes(eventName)) return true;
  return settings['auto_' + eventName] !== 'off';
}
