/* functions/_devices.js — anti-sharing signed-in-device lock.
 *
 * Tracks the devices an account is signed in on (KV dev:<uid> -> [{id, at}], newest first). On sign-in
 * the client registers its stable device id; if the account is over its role's limit (deviceLimit), the
 * OLDEST device(s) are evicted (newest wins) and returned so they get signed out on their next check.
 * INERT unless DEVICE_LOCK_ON="1" — the endpoint passes a large limitOverride when off, so nothing is
 * ever evicted until the owner flips it. Deps-injectable store; fail-open (never block a real sign-in).
 */
import { deviceLimit } from "./_entitlements.js";
import { cfgFlag } from "./_billingcfg.js";

const PFX = "dev:";
const TTL = 60 * 60 * 24 * 400;   // ~400 days

export function deviceLockOn(env) { return String(cfgFlag(env, "DEVICE_LOCK_ON")) === "1"; }

export async function listDevices(store, uid) {
  if (!store || !uid) return [];
  try { const a = await store.get(PFX + uid, "json"); return Array.isArray(a) ? a : []; } catch (e) { return []; }
}

// Register/refresh a device. Returns { ok, devices, evicted, limit }. Trims to the effective limit
// (role limit, or limitOverride when the lock is off) keeping the newest. Fail-open on store error.
export async function registerDevice(env, store, uid, deviceId, role, now, limitOverride) {
  now = now || Date.now();
  const limit = (Number.isFinite(limitOverride) && limitOverride >= 1) ? Math.floor(limitOverride) : deviceLimit(env, role);
  if (!store || !uid || !deviceId) return { ok: true, devices: [], evicted: [], limit };
  let list = await listDevices(store, uid);
  const existing = list.find((d) => d.id === deviceId);
  if (existing) existing.at = now;
  else list.push({ id: String(deviceId).slice(0, 80), at: now });
  list.sort((a, b) => (b.at || 0) - (a.at || 0));            // newest first
  const evicted = list.slice(limit).map((d) => d.id);        // over the limit → oldest
  list = list.slice(0, limit);
  try { await store.put(PFX + uid, JSON.stringify(list), { expirationTtl: TTL }); } catch (e) { return { ok: true, devices: list, evicted: [], limit }; }
  return { ok: true, devices: list, evicted, limit };
}

// Is this device still one of the account's authorized devices? Client polls this; false → sign out.
export async function deviceAuthorized(store, uid, deviceId) {
  if (!store || !uid || !deviceId) return true;             // fail-open
  const list = await listDevices(store, uid);
  return list.length === 0 || list.some((d) => d.id === deviceId);
}

export async function removeDevice(store, uid, deviceId) {
  if (!store || !uid) return { ok: true, devices: [] };
  const list = (await listDevices(store, uid)).filter((d) => d.id !== deviceId);
  try { await store.put(PFX + uid, JSON.stringify(list), { expirationTtl: TTL }); } catch (e) {}
  return { ok: true, devices: list };
}
