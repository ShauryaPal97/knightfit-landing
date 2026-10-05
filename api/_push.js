// Web push to the admin phone app. Needs VAPID_PUBLIC_KEY + VAPID_PRIVATE_KEY.
// Devices are stored in the settings table (key push_devices), each with the alert types it wants.
import webpush from 'web-push';
import { getSettings, setSetting } from './_db.js';
import { ALERT_TYPES } from './_mail.js';

// Same types as email alerts, plus no-show (push only).
export const PUSH_TYPES = [...ALERT_TYPES, { key: 'no_show', label: 'No-show' }];
const TYPE_KEYS = PUSH_TYPES.map((t) => t.key);
const MAX_DEVICES = 20;

export function pushConfigured() {
  return Boolean(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY);
}

export function publicKey() {
  return process.env.VAPID_PUBLIC_KEY || '';
}

let vapidSet = false;
function setup() {
  if (vapidSet) return;
  const subject = process.env.VAPID_SUBJECT || process.env.SITE_URL || 'https://knightfit-landing.vercel.app';
  webpush.setVapidDetails(subject, process.env.VAPID_PUBLIC_KEY, process.env.VAPID_PRIVATE_KEY);
  vapidSet = true;
}

function cleanDevice(d) {
  const endpoint = String(d?.endpoint || '');
  const p256dh = String(d?.keys?.p256dh || '');
  const auth = String(d?.keys?.auth || '');
  if (!/^https:\/\//.test(endpoint) || endpoint.length > 1000 || !p256dh || !auth || p256dh.length > 200 || auth.length > 100) return null;
  return {
    endpoint,
    keys: { p256dh, auth },
    name: String(d.name || 'Device').slice(0, 60),
    types: Array.isArray(d.types) ? TYPE_KEYS.filter((k) => d.types.includes(k)) : [...TYPE_KEYS],
    created_at: d.created_at || new Date().toISOString()
  };
}

export async function getDevices(fresh = false) {
  const s = await getSettings(fresh).catch(() => ({}));
  try {
    const list = JSON.parse(s.push_devices || '[]');
    return Array.isArray(list) ? list.map(cleanDevice).filter(Boolean) : [];
  } catch {
    return [];
  }
}

async function saveDevices(list) {
  await setSetting('push_devices', JSON.stringify(list.slice(0, MAX_DEVICES)));
}

/** Add or refresh a device (matched by endpoint). Keeps its type choices when it already exists. */
export async function addDevice(sub, name) {
  const list = await getDevices(true);
  const existing = list.find((d) => d.endpoint === sub?.endpoint);
  const dev = cleanDevice({ ...sub, name: name || existing?.name, types: existing?.types, created_at: existing?.created_at });
  if (!dev) throw new Error('Invalid push subscription');
  const rest = list.filter((d) => d.endpoint !== dev.endpoint);
  if (rest.length >= MAX_DEVICES) throw new Error(`You can add up to ${MAX_DEVICES} devices. Remove one first.`);
  await saveDevices([...rest, dev]);
  return dev;
}

export async function updateDevice(endpoint, patch) {
  const list = await getDevices(true);
  const dev = list.find((d) => d.endpoint === endpoint);
  if (!dev) throw new Error('Device not found');
  if (Array.isArray(patch.types)) dev.types = TYPE_KEYS.filter((k) => patch.types.includes(k));
  if (typeof patch.name === 'string' && patch.name.trim()) dev.name = patch.name.trim().slice(0, 60);
  await saveDevices(list);
}

export async function removeDevice(endpoint) {
  const list = await getDevices(true);
  await saveDevices(list.filter((d) => d.endpoint !== endpoint));
}

// Without a Content-Encoding hint web-push defaults to aes128gcm, which Apple, Google and Mozilla all accept.
function deliver(dev, payload) {
  setup();
  return webpush.sendNotification({ endpoint: dev.endpoint, keys: dev.keys }, JSON.stringify(payload), { TTL: 86400, urgency: 'high' });
}

/**
 * type: one of PUSH_TYPES keys. msg: { title, body, url, tag }.
 * Sends to every device subscribed to `type`; drops devices the push service says are gone. Never throws.
 */
export async function sendPush(type, msg) {
  if (!pushConfigured()) return false;
  try {
    const devices = (await getDevices()).filter((d) => d.types.includes(type));
    if (!devices.length) return false;
    const payload = { title: msg.title, body: String(msg.body || '').slice(0, 300), url: msg.url || '/admin', tag: msg.tag };
    const results = await Promise.allSettled(devices.map((d) => deliver(d, payload)));
    const gone = devices.filter((d, i) => results[i].status === 'rejected' && [404, 410].includes(results[i].reason?.statusCode));
    results.forEach((r, i) => {
      if (r.status === 'rejected' && !gone.includes(devices[i])) console.error('[push] send failed', type, devices[i].name, r.reason?.statusCode, r.reason?.body || r.reason?.message);
    });
    if (gone.length) {
      const drop = new Set(gone.map((d) => d.endpoint));
      await saveDevices((await getDevices(true)).filter((d) => !drop.has(d.endpoint)));
    }
    return results.some((r) => r.status === 'fulfilled');
  } catch (err) {
    console.error('[push] failed', type, err.message);
    return false;
  }
}

/** Sends a test notification to one device. Throws with a readable message on failure. */
export async function sendTestPush(endpoint) {
  if (!pushConfigured()) throw new Error('Push isn\'t set up (VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY).');
  const dev = (await getDevices(true)).find((d) => d.endpoint === endpoint);
  if (!dev) throw new Error('Device not found. Turn notifications on again.');
  try {
    await deliver(dev, { title: 'Knight Fit', body: 'Test notification. Alerts for ' + dev.name + ' are working.', url: '/admin#/settings', tag: 'test' });
  } catch (err) {
    if ([404, 410].includes(err.statusCode)) {
      await removeDevice(endpoint);
      throw new Error('This device\'s subscription expired. Turn notifications on again.');
    }
    throw new Error('Push failed: ' + (err.body || err.message));
  }
  return { sent: true };
}
